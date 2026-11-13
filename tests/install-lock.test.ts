import { it, expect } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { acquireInstallCache, installationLocation } from '../src/main/services/install-location';

it('keeps a live OS transaction exclusive and recovers after holder death', async () => {
  const root = await mkdtemp(join(tmpdir(), 'install-lock-'));
  const location = installationLocation(root, 'test');
  let child: ReturnType<typeof spawn> | undefined;
  try {
    const initial = await acquireInstallCache(location, 'fixture');
    const database = initial.lockDatabase;
    await initial.release();
    child = spawn(process.execPath, ['-e', `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);d.exec('BEGIN IMMEDIATE');console.log('locked');setInterval(()=>{},1000);`, database], {stdio:['ignore','pipe','pipe']});
    await new Promise<void>((resolve, reject) => { child!.stdout!.once('data', () => resolve()); child!.once('error', reject); child!.once('exit', () => reject(Error('holder exited'))); });
    const contender = spawn(process.execPath, ['-e', `const {DatabaseSync}=require('node:sqlite');const d=new DatabaseSync(process.argv[1]);try{d.exec('BEGIN IMMEDIATE');console.log('unexpected')}catch{console.log('busy')}process.stdin.once('data',()=>{try{d.exec('BEGIN IMMEDIATE');console.log('recovered');d.exec('ROLLBACK')}catch(e){console.error(e);process.exitCode=1}d.close()});`, database], {stdio:['pipe','pipe','pipe']});
    try {
      const first = await new Promise<string>(r => contender.stdout!.once('data', b => r(String(b))));
      expect(first).toContain('busy');
      await expect(acquireInstallCache(location, 'fixture')).rejects.toThrow();
      child.kill(); await new Promise<void>(r => child!.once('exit', () => r())); child = undefined;
      const recoveredMessage = new Promise<string>(r => contender.stdout!.once('data', b => r(String(b))));
      contender.stdin!.end('retry');
      expect(await recoveredMessage).toContain('recovered');
      await new Promise<void>(r => contender.once('exit', () => r()));
    } finally { if (contender.exitCode === null) contender.kill(); }
    const recovered = await acquireInstallCache(location, 'fixture');
    await recovered.release();
  } finally { if (child) child.kill(); await rm(root, {recursive:true, force:true}); }
});


it('refuses a cache with a mismatched ownership marker without changing it', async () => {
  const root = await mkdtemp(join(tmpdir(), 'install-marker-'));
  try {
    const location = installationLocation(root, 'test');
    const first = await acquireInstallCache(location, 'one');
    const cache = first.cache;
    await first.release();
    await expect(acquireInstallCache(location, 'two')).rejects.toThrow(/配置冲突/);
    expect(await import('node:fs/promises').then(fs => fs.readFile(join(cache, '.zhumeng-install-cache.json'), 'utf8'))).toContain('one');
  } finally { await rm(root, {recursive:true, force:true}); }
});
