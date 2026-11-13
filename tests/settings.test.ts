import { afterEach, beforeEach, expect, test } from 'vitest';
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { SettingsStore } from '../src/main/services/settings';
let dir: string;
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'zhumeng-')); });
afterEach(async () => { await rm(dir, { recursive: true, force: true }); });
test('clamps opacity to the display range', async () => {
  const store = new SettingsStore(join(dir, 'settings.json'));
  expect((await store.patch({ glassOpacity: 5 })).glassOpacity).toBe(1);
  expect((await store.patch({ glassOpacity: -2 })).glassOpacity).toBe(0);
});
test('persists reduced motion across store instances', async () => {
  await new SettingsStore(join(dir, 'settings.json')).patch({ reducedMotion: true });
  expect((await new SettingsStore(join(dir, 'settings.json')).read()).reducedMotion).toBe(true);
});
test('recovers corrupt JSON and preserves the original bytes', async () => {
  const path = join(dir, 'settings.json');
  await writeFile(path, '{broken');
  expect((await new SettingsStore(path).read()).theme).toBe('system');
  const backup = (await readdir(dir)).find(name => name.includes('.corrupt-'))!;
  expect(await readFile(join(dir, backup), 'utf8')).toBe('{broken');
  expect(JSON.parse(await readFile(path, 'utf8')).theme).toBe('system');
});
test('serializes concurrent updates without losing fields', async () => {
  const store = new SettingsStore(join(dir, 'settings.json'));
  await Promise.all([store.patch({ reducedMotion: true }), store.patch({ theme: 'dark' }), store.patch({ javaPath: 'C:\\Java\\java.exe' })]);
  expect(await store.read()).toMatchObject({ reducedMotion: true, theme: 'dark', javaPath: 'C:\\Java\\java.exe' });
});
test('rejects malformed fields and does not poison subsequent updates', async () => {
  const store = new SettingsStore(join(dir, 'settings.json'));
  await expect(store.patch({ reducedMotion: 'yes' } as never)).rejects.toThrow();
  await expect(store.patch({ secret: 'value' } as never)).rejects.toThrow();
  await expect(store.patch({ glassOpacity: NaN })).rejects.toThrow();
  expect((await store.patch({ theme: 'light' })).theme).toBe('light');
});

test('Java auto-download defaults migrate and strict boolean choice persists without freezing executable',async()=>{
  const path = join(dir,'settings.json'); await writeFile(path,JSON.stringify({javaPath:''}));
  const store = new SettingsStore(path); expect((await store.read()).autoDownloadJava).toBe(true);
  await expect(store.patch({autoDownloadJava:'yes'} as never)).rejects.toThrow();
  await store.patch({autoDownloadJava:false});
  expect(await new SettingsStore(path).read()).toMatchObject({autoDownloadJava:false,javaPath:''});
});
