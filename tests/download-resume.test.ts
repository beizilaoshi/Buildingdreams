import { afterEach, expect, test } from 'vitest';
import { createServer, type IncomingMessage, type ServerResponse, type Server } from 'node:http';
import { mkdtemp, readFile, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { NetworkService } from '../src/main/services/network';
const content = Buffer.from('0123456789abcdef');
const sha256 = createHash('sha256').update(content).digest('hex');
const roots: string[] = [], servers: Server[] = [];
afterEach(async () => { for (const server of servers.splice(0)) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); } for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
async function fixture(handler: (req: IncomingMessage, res: ServerResponse) => void) {
  const root = await mkdtemp(join(tmpdir(), 'resume-')); roots.push(root);
  const server = createServer(handler); servers.push(server);
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  return { root, url: `http://127.0.0.1:${(server.address() as { port: number }).port}/file` };
}
const context = () => ({ signal: new AbortController().signal, report() {} });
// Removing Range or losing cancelled bytes must cause this real HTTP test to fail.
test('cancelled validated bytes resume across service instances with Range and If-Range', async () => {
  const ranges: (string | undefined)[] = [], validators: (string | undefined)[] = [];
  const { root, url } = await fixture((req, res) => {
    ranges.push(req.headers.range); validators.push(req.headers['if-range'] as string | undefined);
    if (!req.headers.range) { res.writeHead(200, { 'Content-Length': 16, ETag: '"stable"' }); res.write(content.subarray(0, 8)); }
    else { res.writeHead(206, { 'Content-Length': 8, 'Content-Range': 'bytes 8-15/16', ETag: '"stable"' }); res.end(content.subarray(8)); }
  });
  const abort = new AbortController();
  await expect(new NetworkService({ allowHttpLocalhost: true, retries: 0 }).download(root, { url, path: 'file', sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  expect((await readdir(root)).some(name => name.endsWith('.partial'))).toBe(true);
  await new NetworkService({ allowHttpLocalhost: true, retries: 0 }).download(root, { url, path: 'file', sha256, size: 16 }, context());
  expect(await readFile(join(root, 'file'))).toEqual(content);
  expect(ranges).toEqual([undefined, 'bytes=8-']); expect(validators).toEqual([undefined, '"stable"']);
  expect(await readdir(root)).toEqual(['file']);
});
// Removing the transport retry classification must leave this download incomplete.
test('a disconnected response retries only the missing bytes', async () => {
  const ranges: (string | undefined)[] = [];
  const { root, url } = await fixture((req, res) => {
    ranges.push(req.headers.range);
    if (ranges.length === 1) { res.writeHead(200, { 'Content-Length': 16, ETag: '"stable"' }); res.write(content.subarray(0, 8)); setTimeout(() => res.destroy(), 30); }
    else { res.writeHead(206, { 'Content-Range': 'bytes 8-15/16', ETag: '"stable"' }); res.end(content.subarray(8)); }
  });
  await new NetworkService({ allowHttpLocalhost: true, retries: 1 }).download(root, { url, path: 'file', sha256, size: 16 }, context());
  expect(await readFile(join(root, 'file'))).toEqual(content);
  expect(ranges).toEqual([undefined, 'bytes=8-']);
});
// Appending an invalid range, stale representation or ignored Range corrupts the result.
test.each(['ignored', 'wrong-start', 'wrong-total', 'changed-etag', 'unsatisfiable', 'corrupt-prefix'] as const)('falls back to a full verified request for %s', async mode => {
  const ranges: (string | undefined)[] = [];
  const { root, url } = await fixture((req, res) => {
    ranges.push(req.headers.range);
    if (ranges.length === 1) { res.writeHead(200, { 'Content-Length': 16, ETag: '"stable"' }); res.write(mode === 'corrupt-prefix' ? Buffer.from('xxxxxxxx') : content.subarray(0, 8)); }
    else if (!req.headers.range || mode === 'ignored') { res.writeHead(200, { ETag: '"stable"' }); res.end(content); }
    else if (mode === 'unsatisfiable') { res.writeHead(416, { 'Content-Range': 'bytes */16' }); res.end(); }
    else { res.writeHead(206, { 'Content-Range': mode === 'wrong-start' ? 'bytes 7-15/16' : mode === 'wrong-total' ? 'bytes 8-15/17' : 'bytes 8-15/16', ETag: mode === 'changed-etag' ? '"changed"' : '"stable"' }); res.end(content.subarray(8)); }
  });
  const abort = new AbortController();
  const service = new NetworkService({ allowHttpLocalhost: true, retries: 0 });
  await expect(service.download(root, { url, path: 'file', sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  await service.download(root, { url, path: 'file', sha256, size: 16 }, context());
  expect(await readFile(join(root, 'file'))).toEqual(content);
  expect(ranges).toEqual([undefined, 'bytes=8-', undefined]);
  expect(await readdir(root)).toEqual(['file']);
});

test('416 only commits a complete retained file after hashing every byte', async () => {
  const ranges: (string | undefined)[] = [];
  const { root, url } = await fixture((req, res) => {
    ranges.push(req.headers.range);
    if (!req.headers.range) { res.writeHead(200, { ETag: '"stable"' }); res.end(content); }
    else { res.writeHead(416, { 'Content-Range': 'bytes */16' }); res.end(); }
  });
  const abort = new AbortController(), service = new NetworkService({ allowHttpLocalhost: true, retries: 0 });
  await expect(service.download(root, { url, path: 'file', sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  await service.download(root, { url, path: 'file', sha256, size: 16 }, context());
  expect(await readFile(join(root, 'file'))).toEqual(content); expect(ranges).toEqual([undefined, 'bytes=16-']);
});

test.each(['no-hash', 'no-size', 'weak-etag', 'no-validator'] as const)('does not retain unsafe partials for %s', async mode => {
  const { root, url } = await fixture((_req, res) => { res.writeHead(200, mode === 'no-validator' ? {} : { ETag: mode === 'weak-etag' ? 'W/"weak"' : '"stable"' }); res.write(content.subarray(0, 8)); });
  const abort = new AbortController();
  await expect(new NetworkService({ allowHttpLocalhost: true, retries: 0 }).download(root, { url, path: 'file', sha256: mode === 'no-hash' ? undefined : sha256, size: mode === 'no-size' ? undefined : 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  expect(await readdir(root)).toEqual([]);
});

test('a different URL identity discards previous bytes without sending Range', async () => {
  const ranges: (string | undefined)[] = [];
  const { root, url } = await fixture((req, res) => { ranges.push(req.headers.range); res.writeHead(200, { ETag: '"stable"' }); if (ranges.length === 1) res.write(content.subarray(0, 8)); else res.end(content); });
  const abort = new AbortController(), service = new NetworkService({ allowHttpLocalhost: true, retries: 0 });
  await expect(service.download(root, { url, path: 'file', sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  await service.download(root, { url: url + '?changed', path: 'file', sha256, size: 16 }, context());
  expect(ranges).toEqual([undefined, undefined]); expect(await readFile(join(root, 'file'))).toEqual(content);
});

test('concurrent services serialize one destination, reuse verified result and abort waiting promptly', async () => {
  let requests = 0;
  let finish!: () => void;
  const ready = new Promise<void>(resolve => { finish = resolve; });
  const { root, url } = await fixture((_req, res) => { requests++; res.writeHead(200, { ETag: '"stable"' }); res.write(content.subarray(0, 8)); void ready.then(() => res.end(content.subarray(8))); });
  const spec = { url, path: 'file', sha256, size: 16 };
  const first = new NetworkService({ allowHttpLocalhost: true }).download(root, spec, context());
  while (!requests) await new Promise(resolve => setTimeout(resolve, 1));
  const abort = new AbortController();
  const queued = new NetworkService({ allowHttpLocalhost: true }).download(root, spec, { signal: abort.signal, report() {} });
  abort.abort(); await expect(queued).rejects.toBeDefined();
  const second = new NetworkService({ allowHttpLocalhost: true }).download(root, spec, context());
  finish(); await Promise.all([first, second]);
  expect(requests).toBe(1); expect(await readdir(root)).toEqual(['file']);
});

test('a removed retained file restarts without adopting other disk bytes', async () => {
  const ranges: (string | undefined)[] = [];
  const { root, url } = await fixture((req, res) => { ranges.push(req.headers.range); res.writeHead(200, { ETag: '"stable"' }); if (ranges.length === 1) res.write(content.subarray(0, 8)); else res.end(content); });
  const abort = new AbortController(), service = new NetworkService({ allowHttpLocalhost: true, retries: 0 });
  await expect(service.download(root, { url, path: 'file', sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  const partial = (await readdir(root)).find(name => name.endsWith('.partial'))!; await rm(join(root, partial));
  await service.download(root, { url, path: 'file', sha256, size: 16 }, context());
  expect(ranges).toEqual([undefined, undefined]); expect(await readFile(join(root, 'file'))).toEqual(content);
});

test('Last-Modified provides If-Range when no strong ETag exists', async () => {
  const ranges: (string | undefined)[] = [], validators: unknown[] = [];
  const modified = 'Wed, 21 Oct 2015 07:28:00 GMT';
  const { root, url } = await fixture((req, res) => { ranges.push(req.headers.range); validators.push(req.headers['if-range']); res.writeHead(req.headers.range ? 206 : 200, { 'Last-Modified': modified, ...(req.headers.range ? { 'Content-Range': 'bytes 8-15/16' } : {}) }); if (req.headers.range) res.end(content.subarray(8)); else res.write(content.subarray(0, 8)); });
  const abort = new AbortController(), service = new NetworkService({ allowHttpLocalhost: true, retries: 0 });
  await expect(service.download(root, { url, path: 'file', sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  await service.download(root, { url, path: 'file', sha256, size: 16 }, context());
  expect(validators).toEqual([undefined, modified]); expect(await readFile(join(root, 'file'))).toEqual(content);
});

test('wrong final hash discards unverified bytes and never replaces the destination', async () => {
  const { root, url } = await fixture((_req, res) => { res.writeHead(200, { ETag: '"stable"' }); res.end(content); });
  await expect(new NetworkService({ allowHttpLocalhost: true, retries: 0 }).download(root, { url, path: 'file', sha256: '0'.repeat(64), size: 16 }, context())).rejects.toThrow('SHA256');
  expect(await readdir(root)).toEqual([]);
});

test('an existing cross-process lock is never stolen or overwritten', async () => {
  const { writeFile } = await import('node:fs/promises');
  let requests = 0;
  const { root, url } = await fixture((_req, res) => { requests++; res.end(content); });
  await writeFile(join(root, 'file.download.lock'), 'foreign owner');
  await expect(new NetworkService({ allowHttpLocalhost: true }).download(root, { url, path: 'file', sha256, size: 16 }, context())).rejects.toMatchObject({ code: 'EEXIST' });
  expect(requests).toBe(0); expect(await readFile(join(root, 'file.download.lock'), 'utf8')).toBe('foreign owner');
});

test('retained partial count is bounded and evicts only files owned by this process', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { root, url } = await fixture((_req, res) => { res.writeHead(200, { ETag: '"stable"' }); res.write(content.subarray(0, 8)); });
  await writeFile(join(root, 'user.partial'), 'not ours');
  const service = new NetworkService({ allowHttpLocalhost: true, retries: 0 });
  for (let i = 0; i < 18; i++) {
    const abort = new AbortController();
    await expect(service.download(root, { url, path: 'file' + i, sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  }
  expect((await readdir(root)).filter(name => name.endsWith('.partial')).length).toBeLessThanOrEqual(17);
  expect(await readFile(join(root, 'user.partial'), 'utf8')).toBe('not ours');
});

test('an existing destination must satisfy every supplied hash before reuse', async () => {
  const { writeFile } = await import('node:fs/promises');
  const { root, url } = await fixture((_req, res) => res.end(content));
  await writeFile(join(root, 'file'), content);
  await expect(new NetworkService({ allowHttpLocalhost: true, retries: 0 }).download(root, { url, path: 'file', sha256, sha1: '0'.repeat(40), size: 16 }, context())).rejects.toThrow('SHA1');
  expect(await readFile(join(root, 'file'))).toEqual(content);
});

test('reusing a completed destination releases its obsolete retained partial', async () => {
  const { writeFile } = await import('node:fs/promises');
  let requests = 0;
  const { root, url } = await fixture((_req, res) => { requests++; res.writeHead(200, { ETag: '"stable"' }); res.write(content.subarray(0, 8)); });
  const abort = new AbortController(), service = new NetworkService({ allowHttpLocalhost: true, retries: 0 });
  await expect(service.download(root, { url, path: 'file', sha256, size: 16 }, { signal: abort.signal, report() { abort.abort(); } })).rejects.toBeDefined();
  await writeFile(join(root, 'file'), content);
  await service.download(root, { url, path: 'file', sha256, size: 16 }, context());
  expect(requests).toBe(1); expect(await readdir(root)).toEqual(['file']);
});
