import { it,expect } from 'vitest';
import { mkdtemp,mkdir,writeFile,readFile,access } from 'node:fs/promises';
import { join,dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { createHash } from 'node:crypto';
import { InstanceService } from '../src/main/services/instances';
import { TaskService } from '../src/main/services/tasks';
import { NetworkService } from '../src/main/services/network';
import { InstanceRepair } from '../src/main/services/instance-repair';
async function fixture() {
  const parent=await mkdtemp(join(tmpdir(),'repair-')),root=join(parent,'game'), bytes=Buffer.from('verified bytes');
  const hash=(b:Buffer|string)=>createHash('sha1').update(b).digest('hex');
  const index=JSON.stringify({objects:{sound:{hash:hash(bytes),size:bytes.length}}});
  const artifact=(url:string)=>({url,sha1:hash(bytes),size:bytes.length});
  const profile={id:'1.fixture',type:'release',time:'2024-01-01T00:00:00Z',releaseTime:'2024-01-01T00:00:00Z',mainClass:'net.minecraft.client.main.Main',minecraftArguments:'',libraries:[{name:'test:library:1',downloads:{artifact:{...artifact('https://libraries.minecraft.net/library'),path:'test/library/1/library-1.jar'}}}],assets:'fixture',assetIndex:{id:'fixture',url:'https://piston-meta.mojang.com/index',sha1:hash(index),size:Buffer.byteLength(index)},downloads:{client:artifact('https://piston-data.mojang.com/client')}};
  const json=JSON.stringify(profile), local=JSON.stringify({...profile,minecraftArguments:'--custom keep-me'});
  const files:Record<string,Buffer|string>={
    'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json':JSON.stringify({versions:[{id:profile.id,url:'https://piston-meta.mojang.com/version',sha1:hash(json)}]}),
    'https://piston-meta.mojang.com/version':json,'https://piston-meta.mojang.com/index':index,
    'https://piston-data.mojang.com/client':bytes,'https://libraries.minecraft.net/library':bytes,
    [`https://resources.download.minecraft.net/${hash(bytes).slice(0,2)}/${hash(bytes)}`]:bytes,
  };
  await mkdir(join(root,'versions',profile.id),{recursive:true});await mkdir(join(root,'game','saves'),{recursive:true});await mkdir(join(root,'game','mods'));
  await writeFile(join(root,'versions',profile.id,profile.id+'.json'),local);
  await writeFile(join(root,'versions',profile.id,profile.id+'.jar'),'corrupt client');
  await writeFile(join(root,'game','saves','world'),'user save');await writeFile(join(root,'game','mods','user.jar'),'user mod');
  const instances=new InstanceService(join(parent,'registry.json'));
  const item=await instances.registerOwned({id:'fixture',name:'Repair fixture',versionId:profile.id,minecraft:profile.id,resourceDir:root,gameDir:join(root,'game'),memoryMb:2048,javaArgs:[],status:'ready'});
  const tasks=new TaskService(), requested:string[]=[];
  const network=new NetworkService({fetch:(async(url: string|URL|Request)=>{const key=String(url);requested.push(key);if(!(key in files))throw Error('unexpected URL '+key);const value=files[key];return new Response(typeof value==='string'?value:Uint8Array.from(value));}) as unknown as typeof fetch});
  const repair=new InstanceRepair(instances,tasks,network);
  return {root,item,instances,tasks,repair,files,bytes,local,requested};
}
it('repairs deficient official bytes while preserving version modifications, mods and saves',async()=>{
  const f=await fixture();const result=await f.tasks.wait<{replaced:number}>(f.repair.start(f.item.id));
  expect(result.replaced).toBe(4);
  expect(await readFile(join(f.root,'versions','1.fixture','1.fixture.jar'))).toEqual(f.bytes);
  expect(await readFile(join(f.root,'libraries/test/library/1/library-1.jar'))).toEqual(f.bytes);
  expect(await readFile(join(f.root,'versions','1.fixture','1.fixture.json'),'utf8')).toBe(f.local);
  expect(await readFile(join(f.root,'game/saves/world'),'utf8')).toBe('user save');
  expect(await readFile(join(f.root,'game/mods/user.jar'),'utf8')).toBe('user mod');
  const again=await f.tasks.wait<{replaced:number}>(f.repair.start(f.item.id));expect(again.replaced).toBe(0);
});
it('failed staged verification preserves original bytes and unregisters no instance',async()=>{
  const f=await fixture();f.files['https://libraries.minecraft.net/library']='bad downloaded bytes';
  await expect(f.tasks.wait(f.repair.start(f.item.id))).rejects.toThrow(/SHA1|大小/);
  expect(await readFile(join(f.root,'versions','1.fixture','1.fixture.jar'),'utf8')).toBe('corrupt client');
  expect(await f.instances.list()).toHaveLength(1);
  expect((await f.instances.snapshot()).maintenance).toEqual({});
});
it('rejects custom libraries without treating local declared hashes as official provenance',async()=>{
  const f=await fixture(),path=join(f.root,'versions/1.fixture/1.fixture.json');
  const raw=JSON.parse(f.local);raw.libraries.push({name:'custom:extra:1'});await writeFile(path,JSON.stringify(raw));
  await expect(f.tasks.wait(f.repair.start(f.item.id))).rejects.toThrow(/自定义|上游/);
  expect(await readFile(join(f.root,'versions','1.fixture','1.fixture.jar'),'utf8')).toBe('corrupt client');
});
