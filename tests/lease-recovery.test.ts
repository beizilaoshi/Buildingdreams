import { it, expect, vi } from 'vitest';
import { randomUUID } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { InstanceService } from '../src/main/services/instances';
import { LaunchService } from '../src/main/services/launch';
import { JavaService } from '../src/main/services/java';
import { decideLeaseProcess, decideLeaseSnapshot, verifyLaunchMarker } from '../src/main/services/lease-recovery';
import { fixture } from './minecraft-fixture';

async function registryFixture() {
  const root=await fixture(), file=join(root,'registry.json');
  const instances=new InstanceService(file), [item]=await instances.importDirectory(root);
  const launch=new LaunchService(instances,new JavaService(),async()=>({name:'n',uuid:'u',accessToken:'t'}));
  return {root,file,instances,item,launch};
}

it('classifies exact marker matches, absence, inaccessible rows and duplicate matches',()=>{
  const marker='11111111-2222-4333-8444-555555555555';
  expect(decideLeaseProcess([],marker)).toEqual({status:'dead'});
  expect(decideLeaseProcess([{pid:42,commandLine:`java -Dzhumeng.launchMarker=${marker} Main`}],marker)).toEqual({status:'running',pid:42});
  expect(decideLeaseProcess([{pid:42,commandLine:'java Main'}],marker)).toEqual({status:'dead'});
  expect(decideLeaseProcess([{pid:42,commandLine:null}],marker).status).toBe('ambiguous');
  expect(decideLeaseProcess([{pid:42,commandLine:`java -Dzhumeng.launchMarker=${marker}`},{pid:43,commandLine:`java -Dzhumeng.launchMarker=${marker}`}],marker).status).toBe('ambiguous');
  expect(decideLeaseSnapshot({matches:[],inaccessible:false})).toEqual({status:'dead'});
  expect(decideLeaseSnapshot({matches:[42],inaccessible:false})).toEqual({status:'running',pid:42});
  expect(decideLeaseSnapshot({matches:[42],inaccessible:true}).status).toBe('ambiguous');
  expect(decideLeaseSnapshot({matches:['42'],inaccessible:false}).status).toBe('ambiguous');
});

it.runIf(process.platform==='win32')('runs the bounded Windows verifier without returning process command lines',async()=>{
  const result=await verifyLaunchMarker(randomUUID(),2500);
  expect(['dead','ambiguous']).toContain(result.status);
});

it('releases only verifier-confirmed dead leases and updates an exact live PID',async()=>{
  const f=await registryFixture();
  const deadAttempt=await f.instances.beginLaunch(f.item.id);
  const result=await f.launch.recoverPreviousLeases(async()=>({status:'dead'}));
  expect(result).toEqual([]);
  expect((await f.instances.snapshot()).leases[f.item.id]).toBeUndefined();
  const liveAttempt=await f.instances.beginLaunch(f.item.id);
  expect(await f.launch.recoverPreviousLeases(async()=>({status:'running',pid:4242}))).toEqual([]);
  expect((await f.instances.snapshot()).leases[f.item.id]).toMatchObject({attempt:liveAttempt,phase:'spawned',pid:4242});
  await f.instances.endLaunch(f.item.id,deadAttempt);
  await f.instances.endLaunch(f.item.id,liveAttempt);
});

it('keeps ambiguous leases protected and requires an explicit matching main-process release',async()=>{
  const f=await registryFixture(), attempt=await f.instances.beginLaunch(f.item.id);
  const unresolved=await f.launch.recoverPreviousLeases(async()=>({status:'ambiguous',reason:'命令行不可读'}));
  expect(unresolved).toEqual([{id:f.item.id,name:f.item.name,attempt,reason:'命令行不可读'}]);
  f.instances.busy=id=>id===f.item.id;
  await expect(f.instances.confirmReleaseLease(f.item.id,attempt)).rejects.toThrow(/当前启动器/);
  f.instances.busy=()=>false;
  await f.instances.confirmReleaseLease(f.item.id,'wrong-attempt');
  expect((await f.instances.snapshot()).leases[f.item.id]).toBeDefined();
  await f.instances.confirmReleaseLease(f.item.id,attempt);
  expect((await f.instances.snapshot()).leases[f.item.id]).toBeUndefined();
});

it('migrates old string leases to legacy unresolved records and never auto-clears them',async()=>{
  const f=await registryFixture(), attempt=await f.instances.beginLaunch(f.item.id);
  const raw=JSON.parse(await readFile(f.file,'utf8'));
  raw.leases[f.item.id]=attempt;
  await writeFile(f.file,JSON.stringify(raw));
  const restarted=new InstanceService(f.file), launch=new LaunchService(restarted,new JavaService(),async()=>({name:'n',uuid:'u',accessToken:'t'}));
  const verify=vi.fn(async()=>({status:'dead' as const}));
  const unresolved=await launch.recoverPreviousLeases(verify);
  expect(verify).not.toHaveBeenCalled();
  expect(unresolved).toMatchObject([{id:f.item.id,attempt,reason:expect.stringContaining('旧版')}]);
  expect((await restarted.snapshot()).leases[f.item.id]).toMatchObject({attempt,phase:'legacy'});
  await restarted.confirmReleaseLease(f.item.id,attempt);
  expect((await restarted.snapshot()).leases[f.item.id]).toBeUndefined();
});
