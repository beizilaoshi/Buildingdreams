import { open, readFile, rename, rm, lstat, stat, mkdir } from 'node:fs/promises';
import { basename, dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

export interface ResumeEntry {
  identity: string;
  partial: string;
  bytes: number;
  validator: string;
  validatorHeader: 'etag' | 'last-modified';
  updated: number;
  root: string;
  rootIdentity: string;
}
const entries = new Map<string, ResumeEntry>();
const active = new Set<string>();
const queues = new Map<string, Promise<void>>();
const MAX_BYTES = 512 * 1024 * 1024, MAX_ENTRIES = 16, TTL = 30 * 60 * 1000;
let manifestPath: string | undefined;
let loading: Promise<void> | undefined;
let writes: Promise<void> = Promise.resolve();
const processLockNonce = randomUUID();

interface DownloadLockRecord { version: 1; pid: number; processNonce: string; lockNonce: string; }


/** Configure once from Electron userData. Resumes are never discovered by scanning partial files. */
export function configureResumeStore(path: string): void {
  const next = resolve(path);
  if (manifestPath && manifestPath !== next) throw new Error('下载续传存储路径冲突');
  manifestPath = next;
}

function validRecord(value: unknown): value is [string, ResumeEntry] {
  if (!Array.isArray(value) || value.length !== 2 || typeof value[0] !== 'string' || !value[0]) return false;
  const e = value[1] as Partial<ResumeEntry> | null;
  if (!e || typeof e !== 'object' || typeof e.identity !== 'string' || e.identity.length > 8192 ||
      typeof e.partial !== 'string' || !isAbsolute(e.partial) || !Number.isSafeInteger(e.bytes) || e.bytes! <= 0 || e.bytes! > MAX_BYTES ||
      typeof e.validator !== 'string' || !e.validator || e.validator.length > 1024 ||
      (e.validatorHeader !== 'etag' && e.validatorHeader !== 'last-modified') || !Number.isSafeInteger(e.updated) ||
      typeof e.root !== 'string' || !isAbsolute(e.root) || typeof e.rootIdentity !== 'string' || e.rootIdentity.length > 256) return false;
  if (Object.keys(e).sort().join(',') !== 'bytes,identity,partial,root,rootIdentity,updated,validator,validatorHeader') return false;
  const target = resolve(value[0]), root = resolve(e.root), partial = resolve(e.partial);
  if (target !== value[0] || root !== e.root || partial !== e.partial) return false;
  const rel = relative(root, target);
  if (!rel || rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel)) return false;
  const partialDir = dirname(partial);
  if (partialDir !== dirname(target)) return false;
  const pattern = new RegExp(`^${escapeRegExp(basename(target))}\\.[0-9a-f-]{36}\\.partial$`, 'i');
  return pattern.test(basename(partial));
}
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); }

async function persist(): Promise<void> {
  if (!manifestPath) return;
  const path = manifestPath;
  // A failed write must not poison the queue permanently; the next mutation
  // still gets a chance to publish the latest in-memory snapshot.
  writes = writes.catch(() => {}).then(async () => {
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${randomUUID()}.tmp`;
    let file;
    try {
      file = await open(temp, 'wx', 0o600);
      await file.writeFile(JSON.stringify({ version: 1, entries: [...entries.entries()] }), 'utf8');
      await file.sync();
      await file.close(); file = undefined;
      await rename(temp, path);
    } finally {
      await file?.close().catch(() => {});
      await rm(temp, { force: true }).catch(() => {});
    }
  });
  await writes;
}

async function safelyOwnedPartial(target: string, entry: ResumeEntry): Promise<boolean> {
  if (!validRecord([target, entry])) return false;
  try {
    const rootInfo = await lstat(entry.root), rootStat = await stat(entry.root);
    const partialStat = await lstat(entry.partial);
    if (rootInfo.isSymbolicLink() || !rootStat.isDirectory() || `${rootStat.dev}:${rootStat.ino}` !== entry.rootIdentity ||
        partialStat.isSymbolicLink() || !partialStat.isFile() || partialStat.nlink !== 1 || partialStat.size !== entry.bytes) return false;
    let current = entry.root;
    const pathRel = relative(current, entry.partial);
    for (const component of pathRel.split(sep).slice(0, -1)) {
      current = resolve(current, component);
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory()) return false;
    }
    return true;
  } catch { return false; }
}

export async function loadResumeStore(): Promise<void> {
  if (loading) return loading;
  loading = (async () => {
  if (!manifestPath) return;
  try {
    const info = await lstat(manifestPath);
    if (info.isSymbolicLink() || !info.isFile() || info.nlink !== 1 || info.size > 128 * 1024) return;
    const data: unknown = JSON.parse(await readFile(manifestPath, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data) || Object.keys(data).sort().join(',') !== 'entries,version' || (data as {version?:unknown}).version !== 1 || !Array.isArray((data as {entries?:unknown}).entries) || (data as {entries:unknown[]}).entries.length > MAX_ENTRIES) return;
    let bytes = 0, changed = false;
    for (const row of (data as {entries:unknown[]}).entries) {
      if (!validRecord(row)) { changed = true; continue; }
      const [target, entry] = row;
      const safe = await safelyOwnedPartial(target, entry);
      const age = Date.now() - entry.updated;
      if (age > TTL || age < -60_000 || bytes + entry.bytes > MAX_BYTES || entries.size >= MAX_ENTRIES || entries.has(target) || !safe) {
        changed = true;
        if (safe && (age > TTL || age < -60_000 || bytes + entry.bytes > MAX_BYTES || entries.size >= MAX_ENTRIES || entries.has(target)))
          await rm(entry.partial, { force: true }).catch(() => {});
        continue;
      }
      entries.set(target, entry); bytes += entry.bytes;
    }
    if (changed) await persist().catch(() => {});
  } catch { /* Missing or malformed manifests are ignored; never scan or adopt partials. */ }
  })();
  return loading;
}

export async function discardResume(target: string): Promise<void> {
  const entry = entries.get(target);
  if (entry) {
    entries.delete(target);
    // Delete only a path matching the app's registered partial naming contract.
    if (await safelyOwnedPartial(target, entry)) await rm(entry.partial).catch(() => {});
    await persist().catch(() => {});
  }
}
export function resumeEligible(size: number | undefined): boolean { return Number.isSafeInteger(size) && size! > 0 && size! <= MAX_BYTES; }
export async function getResume(target: string, root: string, rootIdentity: string): Promise<ResumeEntry | undefined> {
  const entry = entries.get(target);
  if (!entry) return undefined;
  if (entry.root !== resolve(root) || entry.rootIdentity !== rootIdentity || !validRecord([target, entry])) {
    await discardResume(target);
    return undefined;
  }
  return entry;
}
export async function retainResume(target: string, entry: ResumeEntry): Promise<void> {
  if (!validRecord([target, entry])) throw new Error('拒绝保存不安全的续传记录');
  entries.delete(target); entries.set(target, entry);
  let bytes = [...entries.values()].reduce((sum, item) => sum + item.bytes, 0);
  for (const [key, item] of entries) {
    if (active.has(key) && key !== target) continue;
    const age = Date.now() - item.updated;
    if (age > TTL || age < -60_000 || entries.size > MAX_ENTRIES || bytes > MAX_BYTES) {
      bytes -= item.bytes;
      if (key === target) entries.delete(key);
      else await discardResume(key);
    }
  }
  await persist();
}
export async function forgetResume(target: string): Promise<void> {
  if (entries.delete(target)) await persist();
}
export async function lockDownload(target: string, signal: AbortSignal): Promise<() => Promise<void>> {
  const previous = queues.get(target) ?? Promise.resolve();
  let unlock!: () => void;
  const turn = new Promise<void>(resolve => { unlock = resolve; });
  const tail = previous.then(() => turn); queues.set(target, tail);
  let abort!: () => void;
  try {
    signal.throwIfAborted();
    await Promise.race([previous, new Promise<never>((_, reject) => { abort = () => reject(signal.reason); signal.addEventListener('abort', abort, { once: true }); })]);
    signal.throwIfAborted();
  } catch (error) { unlock(); if (queues.get(target) === tail) void tail.then(() => { if (queues.get(target) === tail) queues.delete(target); }); throw error; }
  finally { if (abort) signal.removeEventListener('abort', abort); }
  let file;
  const lock = target + '.download.lock';
  let lockStat;
  const lockNonce = randomUUID();
  try {
    file = await open(lock, 'wx', 0o600);
    lockStat = await file.stat();
    const record: DownloadLockRecord = { version: 1, pid: process.pid, processNonce: processLockNonce, lockNonce };
    await file.writeFile(JSON.stringify(record), 'utf8');
    await file.sync();
  } catch (error) {
    await file?.close().catch(() => {});
    // Only remove a file we can identify as this call's partially written lock.
    if (file) {
      try {
        const current = await lstat(lock);
        if (current.isFile() && current.ino === lockStat?.ino && current.dev === lockStat?.dev) await rm(lock, { force: true });
      } catch { /* leave uncertain lock for safe manual recovery */ }
    }
    unlock(); if (queues.get(target) === tail) queues.delete(target); throw error;
  }
  active.add(target);
  let released = false;
  return async () => {
    if (released) return; released = true;
    try {
      await file.close();
      try {
        const current = await lstat(lock);
        const currentRecord: unknown = JSON.parse(await readFile(lock, 'utf8'));
        if (current.isFile() && current.nlink === 1 && current.dev === lockStat.dev && current.ino === lockStat.ino &&
            !!currentRecord && typeof currentRecord === 'object' &&
            (currentRecord as DownloadLockRecord).lockNonce === lockNonce &&
            (currentRecord as DownloadLockRecord).processNonce === processLockNonce) await rm(lock);
      } catch { /* do not delete a replaced, malformed, or already-removed lock */ }
    }
    finally { active.delete(target); unlock(); if (queues.get(target) === tail) queues.delete(target); }
  };
}
