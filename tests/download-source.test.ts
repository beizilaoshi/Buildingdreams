import { afterEach, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { bmclapiUrl, configureDownloadSource, downloadCandidates } from '../src/main/services/download-source';
import { NetworkService } from '../src/main/services/network';

afterEach(() => configureDownloadSource('auto'));
test('rewrites only documented public Minecraft endpoints', () => {
  expect(bmclapiUrl('https://piston-meta.mojang.com/v1/packages/abc/version.json')).toBe('https://bmclapi2.bangbang93.com/v1/packages/abc/version.json');
  expect(bmclapiUrl('https://resources.download.minecraft.net/ab/' + 'a'.repeat(40))).toBe('https://bmclapi2.bangbang93.com/assets/ab/' + 'a'.repeat(40));
  expect(bmclapiUrl('https://libraries.minecraft.net/org/example/lib/1/lib-1.jar')).toBe('https://bmclapi2.bangbang93.com/maven/org/example/lib/1/lib-1.jar');
  for (const url of ['https://api.minecraftservices.com/minecraft/profile', 'https://libraries.minecraft.net/../secret', 'https://name:pass@libraries.minecraft.net/a.jar', 'https://piston-meta.mojang.com/v1/packages/a.json?token=secret']) expect(bmclapiUrl(url)).toBeUndefined();
  configureDownloadSource('bmclapi');
  expect(downloadCandidates('https://libraries.minecraft.net/a.jar')).toEqual(['https://bmclapi2.bangbang93.com/maven/a.jar', 'https://libraries.minecraft.net/a.jar']);
  expect(downloadCandidates('https://libraries.minecraft.net/a.jar', true)).toEqual(['https://libraries.minecraft.net/a.jar']);
});

test('verified binary falls back after mirror serves corrupt bytes', async () => {
  configureDownloadSource('bmclapi');
  const root = await mkdtemp(join(tmpdir(), 'zhumeng-source-'));
  const good = Buffer.from('trusted bytes'), sha1 = createHash('sha1').update(good).digest('hex');
  const urls: string[] = [];
  const service = new NetworkService({ retries: 0, fetch: async input => {
    const url = String(input); urls.push(url);
    return new Response(url.includes('bmclapi') ? 'wrong content' : good, { status: 200 });
  }});
  try {
    await service.download(root, { url: 'https://libraries.minecraft.net/example.jar', path: 'example.jar', sha1, size: good.length }, { signal: new AbortController().signal, report() {} });
    expect(await readFile(join(root, 'example.jar'))).toEqual(good);
    expect(urls).toEqual(['https://bmclapi2.bangbang93.com/maven/example.jar', 'https://libraries.minecraft.net/example.jar']);
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('JSON source falls back on server failure; restricted and aborted calls do not mirror', async () => {
  configureDownloadSource('bmclapi');
  const urls: string[] = [];
  const service = new NetworkService({ retries: 0, fetch: async input => {
    const url = String(input); urls.push(url);
    return url.includes('bmclapi') ? new Response('', { status: 503 }) : Response.json({ versions: [] });
  }});
  expect(await service.json<{versions: unknown[]}>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json')).toEqual({ versions: [] });
  expect(urls).toEqual(['https://bmclapi2.bangbang93.com/mc/game/version_manifest_v2.json', 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json']);
  urls.length = 0;
  await service.restricted(['piston-meta.mojang.com']).json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json');
  expect(urls).toHaveLength(1);
  const cancelled = new AbortController(); cancelled.abort(); urls.length = 0;
  await expect(service.json('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json', cancelled.signal)).rejects.toBeDefined();
  expect(urls).toHaveLength(0);
});
