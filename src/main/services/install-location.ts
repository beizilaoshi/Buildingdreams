import { createHash, randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { lstat, mkdir, open, readFile, rename, rm } from 'node:fs/promises';
import { isAbsolute, join, parse, resolve } from 'node:path';

export interface InstallLocation { installRoot: string; resourceDir: string; gameDir: string }
export function installationLocation(root: string, name: string): InstallLocation {
  if (!isAbsolute(root)) throw Error('安装根目录必须是绝对路径');
  const installRoot = resolve(root), resourceDir = join(installRoot, name);
  return { installRoot, resourceDir, gameDir: join(resourceDir, 'game') };
}
async function noLinks(path: string) {
  const absolute = resolve(path); let current = parse(absolute).root;
  for (const part of absolute.slice(current.length).split(/[\\/]/).filter(Boolean)) {
    current = join(current, part);
    try { if ((await lstat(current)).isSymbolicLink()) throw Error('安装路径不能包含符号链接'); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== 'ENOENT') throw e; }
  }
}
async function exists(path: string) { try { await lstat(path); return true; } catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return false; throw e; } }
export async function acquireInstallCache(location: InstallLocation, fingerprint: string) {
  await noLinks(location.installRoot);
  await mkdir(location.installRoot, { recursive: true });
  await noLinks(location.installRoot);
  const key = createHash('sha256').update(location.resourceDir.toLowerCase()).digest('hex');
  const container = join(location.installRoot, `.zhumeng-install-${key}`);
  const marker = join(container, '.zhumeng-install-cache.json');
  const expected = JSON.stringify({schema:1, target:location.resourceDir});
  if (!await exists(container)) {
    const prepared = container + '.prepare-' + randomUUID();
    await mkdir(prepared);
    try {
      const h = await open(join(prepared, '.zhumeng-install-cache.json'), 'wx');
      try { await h.writeFile(expected); } finally { await h.close(); }
      try { await rename(prepared, container); }
      catch(e) { if (!await exists(container)) throw e; }
    } finally { await rm(prepared, {recursive:true, force:true}); }
  }
  await noLinks(container);
  await noLinks(marker);
  let saved: string; try { saved = await readFile(marker, 'utf8'); } catch { throw Error('安装缓存缺少有效所有权标记'); }
  if (saved !== expected) throw Error('安装缓存所有权标记无效');
  const lockDatabase = join(container, 'lock.sqlite');
  await noLinks(lockDatabase);
  const db = new DatabaseSync(lockDatabase);
  try { db.exec('PRAGMA busy_timeout=0; BEGIN IMMEDIATE'); }
  catch(e) { db.close(); throw Error('安装目标正被其他进程使用或锁无法获取', {cause:e}); }
  try {
    if (await exists(location.resourceDir)) throw Error('安装目标已存在，请选择其他名称或目录');
    const cache = join(container, 'work');
    const workMarker = join(cache, '.zhumeng-install-cache.json');
    if (await exists(cache)) {
      await noLinks(cache);
      let saved: unknown; try { saved = JSON.parse(await readFile(workMarker, 'utf8')); } catch { throw Error('安装缓存缺少有效所有权标记'); }
      if (JSON.stringify(saved) !== JSON.stringify({schema:1, fingerprint})) throw Error('安装缓存配置冲突');
    } else {
      const prepared = join(container, 'work.prepare-' + randomUUID());
      await mkdir(prepared);
      try {
        const h = await open(join(prepared, '.zhumeng-install-cache.json'), 'wx');
        try { await h.writeFile(JSON.stringify({schema:1, fingerprint})); } finally { await h.close(); }
        await rename(prepared, cache);
      } finally { await rm(prepared, {recursive:true, force:true}); }
    }
    return { cache, lockDatabase, async release() { try { db.exec('ROLLBACK'); } finally { db.close(); } } };
  } catch(e) { try { db.exec('ROLLBACK'); } finally { db.close(); } throw e; }
}

/** Inspect only; caller decides whether to offer the existing import flow. */
export async function inspectExistingInstall(location: InstallLocation, name: string): Promise<{existingDirectory?: string; recoverableDirectory?: string}> {
  await noLinks(location.installRoot);
  if (!await exists(location.resourceDir)) return {};
  await noLinks(location.resourceDir);
  const marker = join(location.resourceDir, '.zhumeng-install-cache.json');
  try {
    await noLinks(marker);
    const saved = JSON.parse(await readFile(marker, 'utf8'));
    const config = JSON.parse(saved.fingerprint);
    if (saved.schema === 1 && typeof config.version === 'string' && typeof config.loader === 'string' && config.name === name && config.root === location.installRoot)
      return {existingDirectory: location.resourceDir, recoverableDirectory: location.resourceDir};
  } catch { /* Unknown folders are never adopted. */ }
  return {existingDirectory: location.resourceDir};
}
