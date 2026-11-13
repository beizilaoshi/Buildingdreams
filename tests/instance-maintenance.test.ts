import { it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, access } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceService } from '../src/main/services/instances';
import { fixture } from './minecraft-fixture';
import { InstanceMaintenance } from '../src/main/services/instance-maintenance';
import { TaskService } from '../src/main/services/tasks';

it('rejects malformed persisted records instead of trusting arbitrary JSON', async () => {
  const root = await mkdtemp(join(tmpdir(),'maintenance-'));
  const file = join(root,'instances.json');
  await writeFile(file, JSON.stringify([{id:'bad', memoryMb:'2048'}]));
  await expect(new InstanceService(file).list()).rejects.toThrow();
});

async function ownedFixture() {
  const parent=await mkdtemp(join(tmpdir(),'owned-maintenance-')), root=join(parent,'owned');
  await mkdir(join(root,'game'),{recursive:true});
  await writeFile(join(root,'game','sentinel'),'save');
  const service=new InstanceService(join(parent,'registry.json'));
  const item=await service.registerOwned({id:'owned',name:'Owned',versionId:'base',resourceDir:root,gameDir:join(root,'game'),minecraft:'base',status:'ready',memoryMb:2048,javaArgs:[]});
  return {parent,root,service,item};
}
it('rejects unmarked roots and preserves imported files on unregister',async()=>{
  const root=await fixture(), service=new InstanceService();const [item]=await service.importDirectory(root);
  const maintenance=new InstanceMaintenance(service,new TaskService());
  await expect(maintenance.planDelete(item.id)).rejects.toThrow(/所有权/);
  await service.unregister(item.id);await access(join(root,'versions','base','base.json'));
});
it('owned deletion survives restart, rejects references and stale plans, and moves only its exact owned root',async()=>{
  const f=await ownedFixture(), service=new InstanceService(join(f.parent,'registry.json')), moved:string[]=[];
  const maintenance=new InstanceMaintenance(service,new TaskService(),async path=>{moved.push(path);await access(join(path,'game','sentinel'));});
  const plan=await maintenance.planDelete(f.item.id);
  expect(plan.paths).toEqual([f.root]);
  await service.metadata(f.item.id,{description:'changed'});
  await expect(maintenance.delete(plan.token,true)).rejects.toThrow(/变化/);
  await service.register({...f.item,id:'other',name:'Other',resourceDir:f.parent,gameDir:f.root});
  await expect(maintenance.planDelete(f.item.id)).rejects.toThrow(/引用/);
  await service.unregister('other');
  const next=await maintenance.planDelete(f.item.id);await maintenance.delete(next.token,true);
  expect(moved).toHaveLength(1);expect(await service.list()).toEqual([]);
  await expect(access(f.root)).rejects.toThrow();
});
it('failed trash rolls back exact root and registry; unresolved lease remains a hard deny',async()=>{
  const f=await ownedFixture(), tasks=new TaskService();
  const maintenance=new InstanceMaintenance(f.service,tasks,async()=>{throw Error('OS busy');});
  const lease=await f.service.beginLaunch(f.item.id);
  await expect(maintenance.planDelete(f.item.id)).rejects.toThrow(/启动/);
  await f.service.endLaunch(f.item.id,lease);
  const plan=await maintenance.planDelete(f.item.id);
  await expect(maintenance.delete(plan.token,true)).rejects.toThrow('OS busy');
  expect((await f.service.get(f.item.id)).id).toBe(f.item.id);
  expect(await readFile(join(f.root,'game','sentinel'),'utf8')).toBe('save');
  expect((await f.service.snapshot()).maintenance).toEqual({});
});
it('blocks newly admitted tasks and starts while destructive filesystem action is pending',async()=>{
  const f=await ownedFixture(), tasks=new TaskService();let release!:()=>void, entered!:()=>void;
  const started=new Promise<void>(r=>entered=r), gate=new Promise<void>(r=>release=r);
  const maintenance=new InstanceMaintenance(f.service,tasks,async()=>{entered();await gate;});
  const plan=await maintenance.planDelete(f.item.id), operation=maintenance.delete(plan.token,true);
  await started;
  expect(()=>tasks.start('racing install',async()=>{})).toThrow(/维护/);
  const launch=f.service.beginLaunch(f.item.id);release();await operation;
  await expect(launch).rejects.toThrow();
});
it('migrates legacy records, metadata and explicit false without changing physical identity', async () => {
  const root = await fixture(), file = join(root,'registry.json');
  const service = new InstanceService(file); const [item] = await service.importDirectory(root);
  await (service as any).metadata(item.id,{name:'我的世界',description:'留住存档',category:'创造',favorite:false});
  await (service as any).mergeFavorites([item.id]);
  const loaded = await new InstanceService(file).get(item.id);
  expect(loaded).toMatchObject({name:'我的世界',versionId:item.versionId,description:'留住存档',favorite:false});
  await access(join(root,'versions',item.versionId,item.versionId+'.json'));
});
it('keeps unresolved launch leases across restart and clears only the matching attempt', async () => {
  const root = await fixture(), file = join(root,'registry.json');
  const service = new InstanceService(file); const [item] = await service.importDirectory(root);
  const attempt = await (service as any).beginLaunch(item.id);
  const restarted = new InstanceService(file);
  await expect((restarted as any).unregister(item.id)).rejects.toThrow(/启动|运行/);
  await (restarted as any).endLaunch(item.id,'wrong-attempt');
  await expect((restarted as any).unregister(item.id)).rejects.toThrow();
  await (restarted as any).endLaunch(item.id,attempt);
  await (restarted as any).unregister(item.id);
  expect(await restarted.list()).toEqual([]);
  await access(join(root,'versions','base','base.json'));
});
it('directory removal retains all files and metadata rename survives a rescan', async () => {
  const root = await fixture(), service = new InstanceService(join(root,'registry.json'));
  const [item] = await service.importDirectory(root);
  const [directory] = await (service as any).directories();
  await (service as any).renameDirectory(directory.id,'常用目录');
  await (service as any).metadata(item.id,{name:'显示名称'});
  await service.importDirectory(root);
  expect((await service.get(item.id)).name).toBe('显示名称');
  await (service as any).removeDirectory(directory.id);
  expect(await service.list()).toEqual([]);
  expect(await readFile(join(root,'versions','base','base.json'),'utf8')).toContain('base');
});
