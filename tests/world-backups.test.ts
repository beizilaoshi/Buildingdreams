import { afterEach, expect, it } from 'vitest';
import { mkdtemp, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import { fixture } from './minecraft-fixture';
import { InstanceService } from '../src/main/services/instances';
import { WorldBackupService } from '../src/main/services/world-backups';

const roots:string[]=[];
afterEach(async()=>Promise.all(roots.splice(0).map(path=>rm(path,{recursive:true,force:true}))));

it('creates, lists, restores and deletes isolated world backups',async()=>{
 const root=await fixture(),data=await mkdtemp(join(tmpdir(),'zhumeng-world-backups-'));roots.push(root,data);
 const instances=new InstanceService(),[item]=await instances.importDirectory(root);
 const world=join(item.gameDir,'saves','Dream');await mkdir(world,{recursive:true});await writeFile(join(world,'level.dat'),'original');
 const backups=new WorldBackupService(instances,join(data,'world-backups'));
 const saved=await backups.create(item.id,'Dream');
 expect(saved.world).toBe('Dream');expect((await backups.list(item.id,'Dream'))).toHaveLength(1);
 await writeFile(join(world,'level.dat'),'changed');
 const beforeRestore=await backups.restore(item.id,'Dream',saved.id);
 expect(await readFile(join(world,'level.dat'),'utf8')).toBe('original');
 if(!beforeRestore)throw new Error('expected current world safety backup');
 expect(beforeRestore.bytes).toBeGreaterThan(0);
 expect((await backups.list(item.id,'Dream'))).toHaveLength(2);
 await backups.delete(item.id,'Dream',saved.id);
 expect(await backups.list(item.id,'Dream')).toHaveLength(1);
 await backups.delete(item.id,'Dream',beforeRestore.id);
 expect(await backups.list(item.id,'Dream')).toEqual([]);
});

it('reports backup storage usage across every saved world',async()=>{
 const root=await fixture(),data=await mkdtemp(join(tmpdir(),'zhumeng-world-backup-usage-'));roots.push(root,data);
 const instances=new InstanceService(),[item]=await instances.importDirectory(root),backups=new WorldBackupService(instances,join(data,'backups'));
 await mkdir(join(item.gameDir,'saves','Dream'),{recursive:true});await writeFile(join(item.gameDir,'saves','Dream','level.dat'),'dream');
 await mkdir(join(item.gameDir,'saves','Island'),{recursive:true});await writeFile(join(item.gameDir,'saves','Island','level.dat'),'island');
 await backups.create(item.id,'Dream');await backups.create(item.id,'Island');
 expect(await backups.usage(item.id)).toEqual({backups:2,bytes:11});
 await backups.delete(item.id,'Dream',(await backups.list(item.id,'Dream'))[0].id);
 expect(await backups.usage(item.id)).toEqual({backups:1,bytes:6});
});

it('ignores backup metadata with impossible storage counters',async()=>{
 const root=await fixture(),data=await mkdtemp(join(tmpdir(),'zhumeng-world-backup-invalid-usage-'));roots.push(root,data);
 const instances=new InstanceService(),[item]=await instances.importDirectory(root),backupRoot=join(data,'backups'),backups=new WorldBackupService(instances,backupRoot);
 const world=join(item.gameDir,'saves','Dream');await mkdir(world,{recursive:true});await writeFile(join(world,'level.dat'),'valid');
 const saved=await backups.create(item.id,'Dream'),meta=join(backupRoot,createHash('sha256').update(item.id).digest('hex'),'Dream',saved.id,'backup.json');
 await writeFile(meta,JSON.stringify({...saved,bytes:-1}));
 expect(await backups.usage(item.id)).toEqual({backups:0,bytes:0});
});

it('rejects world traversal and symbolic links without copying external files',async()=>{
 const parent=await mkdtemp(join(tmpdir(),'zhumeng-world-backup-boundary-')),root=await fixture();roots.push(parent,root);
 const outside=join(parent,'outside');await mkdir(outside);await writeFile(join(outside,'secret'),'secret');
 const instances=new InstanceService(),[item]=await instances.importDirectory(root),backups=new WorldBackupService(instances,join(parent,'backups'));
 await expect(backups.list(item.id,'../outside')).rejects.toThrow();
 const saves=join(item.gameDir,'saves');await mkdir(saves,{recursive:true});
 const {symlink}=await import('node:fs/promises');await symlink(outside,join(saves,'Linked'),'junction');
 await expect(backups.create(item.id,'Linked')).rejects.toThrow();
 expect(await readFile(join(outside,'secret'),'utf8')).toBe('secret');
});

it('refuses to modify a world while its game instance has a launch lease',async()=>{
 const root=await fixture(),data=await mkdtemp(join(tmpdir(),'zhumeng-world-backup-lease-'));roots.push(root,data);
 const instances=new InstanceService(),[item]=await instances.importDirectory(root),world=join(item.gameDir,'saves','Dream');await mkdir(world,{recursive:true});await writeFile(join(world,'level.dat'),'safe');
 const backups=new WorldBackupService(instances,join(data,'backups')),attempt=await instances.beginLaunch(item.id);
 await expect(backups.create(item.id,'Dream')).rejects.toThrow('运行中');
 await expect(backups.restore(item.id,'Dream','00000000-0000-0000-0000-000000000000')).rejects.toThrow('运行中');
 await instances.endLaunch(item.id,attempt);
});

it('restores a deleted world from its backup and rejects changed backup contents before replacing data',async()=>{
 const root=await fixture(),data=await mkdtemp(join(tmpdir(),'zhumeng-world-backup-recovery-'));roots.push(root,data);
 const instances=new InstanceService(),[item]=await instances.importDirectory(root),world=join(item.gameDir,'saves','Dream');await mkdir(world,{recursive:true});await writeFile(join(world,'level.dat'),'old state');
 const backupRoot=join(data,'backups'),backups=new WorldBackupService(instances,backupRoot),saved=await backups.create(item.id,'Dream');
 await rm(world,{recursive:true});expect(await backups.worlds(item.id)).toContain('Dream');
 expect(await backups.restore(item.id,'Dream',saved.id)).toBeNull();expect(await readFile(join(world,'level.dat'),'utf8')).toBe('old state');
 const path=join(backupRoot,createHash('sha256').update(item.id).digest('hex'),'Dream',saved.id,'world','level.dat');await writeFile(path,'bad state');await writeFile(join(world,'level.dat'),'current state');
 await expect(backups.restore(item.id,'Dream',saved.id)).rejects.toThrow('备份校验失败');expect(await readFile(join(world,'level.dat'),'utf8')).toBe('current state');
 const nested=join(item.gameDir,'saves','Nested'),region=join(nested,'region');await mkdir(region,{recursive:true});await writeFile(join(region,'chunk.dat'),'same bytes');
 const nestedBackup=await backups.create(item.id,'Nested'),nestedBackupPath=join(backupRoot,createHash('sha256').update(item.id).digest('hex'),'Nested',nestedBackup.id,'world');
 await rename(join(nestedBackupPath,'region','chunk.dat'),join(nestedBackupPath,'chunk.dat'));await rm(join(nestedBackupPath,'region'),{recursive:true});
 await expect(backups.restore(item.id,'Nested',nestedBackup.id)).rejects.toThrow('备份校验失败');
});
