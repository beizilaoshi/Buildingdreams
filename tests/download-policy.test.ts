import { afterEach, expect, test, vi } from 'vitest';
import { DownloadScheduler } from '../src/main/services/download-scheduler';
import { NetworkService } from '../src/main/services/network';
import { configureDownloadPolicy } from '../src/main/services/download-scheduler';
import { mkdtemp, rm, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

afterEach(() => vi.useRealTimers());
test('queued cancellation never takes a slot and failures release slots', async () => {
  const scheduler = new DownloadScheduler({ downloadConcurrency: 1, downloadSpeedLimitKib: 0 });
  const release = await scheduler.acquire(new AbortController().signal);
  const controller = new AbortController();
  const cancelled = scheduler.acquire(controller.signal);
  controller.abort();
  await expect(cancelled).rejects.toBeDefined();
  let acquired = false;
  const next = scheduler.acquire(new AbortController().signal).then(done => { acquired = true; done(); });
  await Promise.resolve(); expect(acquired).toBe(false);
  release(); await next; expect(acquired).toBe(true);
});
test('bandwidth reservations aggregate across concurrent consumers and cancel promptly', async () => {
  vi.useFakeTimers();
  const scheduler = new DownloadScheduler({ downloadConcurrency: 2, downloadSpeedLimitKib: 1 });
  let completed = 0;
  const a = scheduler.consume(1024, new AbortController().signal).then(() => completed++);
  const b = scheduler.consume(1024, new AbortController().signal).then(() => completed++);
  await vi.advanceTimersByTimeAsync(999); expect(completed).toBe(0);
  await vi.advanceTimersByTimeAsync(1); expect(completed).toBe(1);
  await vi.advanceTimersByTimeAsync(1000); await Promise.all([a,b]); expect(completed).toBe(2);
  const controller = new AbortController();
  const waiting = scheduler.consume(1024, controller.signal);
  controller.abort(); await expect(waiting).rejects.toBeDefined();
});
test('separate services share admission, queued cancellation, stream cancellation and failure release', async () => {
  const root = await mkdtemp(join(tmpdir(), 'network-policy-'));
  configureDownloadPolicy({ downloadConcurrency: 1, downloadSpeedLimitKib: 0 });
  let started = 0;
  const fetcher = (async () => { started++; return new Response(new ReadableStream({ pull: () => new Promise(() => {}) })); }) as typeof fetch;
  const first = new NetworkService({ fetch: fetcher, retries: 0 });
  const second = new NetworkService({ fetch: fetcher, retries: 0 });
  const a = new AbortController(), b = new AbortController();
  const running = first.download(root, { url: 'https://example.com/a', path: 'a' }, { signal: a.signal, report() {} });
  const runningRejected = expect(running).rejects.toBeDefined();
  while (!started) await new Promise(resolve => setTimeout(resolve, 1));
  const queued = second.download(root, { url: 'https://example.com/b', path: 'b' }, { signal: b.signal, report() {} });
  b.abort(); await expect(queued).rejects.toBeDefined(); expect(started).toBe(1);
  a.abort(); await runningRejected;
  const failed = new NetworkService({ fetch: (async () => new Response('failure', { status: 500 })) as typeof fetch, retries: 0 });
  await expect(failed.download(root, { url: 'https://example.com/f', path: 'f' }, { signal: new AbortController().signal, report() {} })).rejects.toThrow('500');
  const success = new NetworkService({ fetch: (async () => new Response('ok')) as typeof fetch });
  await success.download(root, { url: 'https://example.com/c', path: 'c' }, { signal: new AbortController().signal, report() {} });
  expect(await readdir(root)).toEqual(['c']);
  await rm(root, { recursive: true, force: true });
  configureDownloadPolicy({ downloadConcurrency: 6, downloadSpeedLimitKib: 0 });
});
test('file downloads from multiple service instances obey one aggregate speed limit', async () => {
  const root = await mkdtemp(join(tmpdir(), 'network-bandwidth-'));
  configureDownloadPolicy({ downloadConcurrency: 2, downloadSpeedLimitKib: 20 });
  const fetcher = (async () => new Response(new Uint8Array(4096))) as typeof fetch;
  const started = Date.now();
  try {
    await Promise.all([new NetworkService({ fetch: fetcher }), new NetworkService({ fetch: fetcher }).restricted(['example.com'])].map((service, index) =>
      service.download(root, { url: 'https://example.com/file', path: String(index), size: 4096 }, { signal: new AbortController().signal, report() {} })));
    expect(Date.now() - started).toBeGreaterThanOrEqual(380);
  } finally {
    configureDownloadPolicy({ downloadConcurrency: 6, downloadSpeedLimitKib: 0 });
    await rm(root, { recursive: true, force: true });
  }
});
test('changing policy releases queued slots and removes an active speed limit', async () => {
  vi.useFakeTimers();
  const scheduler = new DownloadScheduler({ downloadConcurrency: 1, downloadSpeedLimitKib: 1 });
  const release = await scheduler.acquire(new AbortController().signal);
  const queued = scheduler.acquire(new AbortController().signal);
  scheduler.configure({ downloadConcurrency: 2, downloadSpeedLimitKib: 1 });
  const releaseSecond = await queued;
  const consuming = scheduler.consume(10240, new AbortController().signal);
  await vi.advanceTimersByTimeAsync(50);
  scheduler.configure({ downloadConcurrency: 2, downloadSpeedLimitKib: 0 });
  await vi.advanceTimersByTimeAsync(50); await consuming;
  release(); releaseSecond();
});
