import { it, expect, vi } from 'vitest';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createWriteStream } from 'node:fs';
import { pipeline } from 'node:stream/promises';
import { ZipFile } from 'yazl';
import { PackService } from '../src/main/services/packs';
import { InstallService } from '../src/main/services/install';
import { InstanceService } from '../src/main/services/instances';
import { TaskService } from '../src/main/services/tasks';
import { NetworkService } from '../src/main/services/network';
async function setup(entries:Record<string,string>) {
 const root=await mkdtemp(join(tmpdir(),'legacy-pack-')),file=join(root,'pack.zip'),zip=new ZipFile();
 for(const [name,body] of Object.entries(entries))zip.addBuffer(Buffer.from(body),name);
 zip.end();await pipeline(zip.outputStream,createWriteStream(file));
 const tasks=new TaskService(),instances=new InstanceService(),install=new InstallService(instances,tasks,new NetworkService(),join(root,'instances'));
 vi.spyOn(install,'installInto').mockResolvedValue({} as any);
 const loader= {installInto:vi.fn().mockResolvedValue('loaded')};
 return {root,file,tasks,instances,install,loader,packs:new PackService(install,loader as any)};
}
it.each([
 ['hmcl',{'modpack.json':JSON.stringify({name:'HMCL Demo',gameVersion:'1.20.1'}),'minecraft/config/demo.txt':'hmcl'}],
 ['multimc',{'Bundle/mmc-pack.json':JSON.stringify({formatVersion:1,components:[{uid:'net.minecraft',version:'1.20.1'},{uid:'net.fabricmc.fabric-loader',version:'0.15.0'}]}),'Bundle/instance.cfg':'name=MMC Demo\nPreLaunchCommand=malicious-command','Bundle/.minecraft/config/demo.txt':'multimc'}],
 ['mcbbs',{'mcbbs.packmeta':JSON.stringify({name:'MCBBS Demo',addons:[{id:'game',version:'1.20.1'},{id:'forge',version:'47.2.0'}]}),'overrides/config/demo.txt':'mcbbs'}],
] as const)('inspects and transactionally installs %s without importing commands',async(format,entries)=>{
 const f=await setup(entries);try{
  const p=await f.packs.inspect(f.file);expect(p.format).toBe(format);expect(p.minecraft).toBe('1.20.1');
  const item=await f.tasks.wait<any>(f.packs.install(f.file,'Imported'));expect(await readFile(join(item.gameDir,'config/demo.txt'),'utf8')).toBe(format);
  expect(item.javaArgs).toEqual([]);expect(await f.instances.list()).toHaveLength(1);
  if(format==='multimc')expect(f.loader.installInto).toHaveBeenCalledWith(expect.any(String),expect.anything(),'fabric','0.15.0',expect.anything());
 }finally{await rm(f.root,{recursive:true,force:true});}
});
it('rejects unsupported simultaneous legacy components before installation',async()=>{
 const f=await setup({'mmc-pack.json':JSON.stringify({formatVersion:1,components:[{uid:'net.minecraft',version:'1.20.1'},{uid:'net.minecraftforge',version:'47.0.0'},{uid:'com.mumfrey.liteloader',version:'1.12.2'}]}),'instance.cfg':'name=Bad'});
 try{await expect(f.packs.inspect(f.file)).rejects.toThrow(/组件|加载器/);expect(f.install.installInto).not.toHaveBeenCalled();}finally{await rm(f.root,{recursive:true,force:true});}
});
it('rejects ambiguous manifests instead of guessing',async()=>{
 const f=await setup({'a/modpack.json':JSON.stringify({name:'A',gameVersion:'1.20.1'}),'b/modpack.json':JSON.stringify({name:'B',gameVersion:'1.21.1'})});
 try{await expect(f.packs.inspect(f.file)).rejects.toThrow(/多个|歧义/);}finally{await rm(f.root,{recursive:true,force:true});}
});
it('rolls back unpublished legacy installation if loader fails',async()=>{
 const f=await setup({'mcbbs.packmeta':JSON.stringify({name:'Bad',addons:[{id:'game',version:'1.20.1'},{id:'forge',version:'47.0.0'}]}),'overrides/config/demo.txt':'data'});
 f.loader.installInto.mockRejectedValue(new Error('fixture installer failure'));
 try{await expect(f.tasks.wait(f.packs.install(f.file,'Bad'))).rejects.toThrow('fixture installer failure');expect(await f.instances.list()).toEqual([]);expect(await readdir(join(f.root,'instances'))).toEqual([]);}finally{await rm(f.root,{recursive:true,force:true});}
});
it('imports a single-folder modern pack including client overrides',async()=>{
 const f=await setup({'Bundle/modrinth.index.json':JSON.stringify({formatVersion:1,game:'minecraft',name:'Nested',versionId:'1',dependencies:{minecraft:'1.20.1'},files:[]}),'Bundle/overrides/config/common.txt':'base','Bundle/client-overrides/config/client.txt':'client'});
 try{const p=await f.packs.inspect(f.file);expect(p.format).toBe('modrinth');const item=await f.tasks.wait<any>(f.packs.install(f.file,'Nested'));expect(await readFile(join(item.gameDir,'config/client.txt'),'utf8')).toBe('client');expect(await readFile(join(item.gameDir,'config/common.txt'),'utf8')).toBe('base');}finally{await rm(f.root,{recursive:true,force:true});}
});
it.each([
 {name:'Bad',addons:[{id:'game',version:'1.20.1'},{id:'optifine',version:'HD_U_I5'}]},
 {name:'Bad',addons:[{id:'game',version:'1.20.1'},{id:'forge',version:'47.0.0'},{id:'fabric',version:'0.15.0'}]},
 {name:'Bad',addons:[{id:'game',version:'../escape'}]},
 {name:'Bad',addons:[{id:'game',version:'1.20.1'},{id:'game',version:'1.21.1'}]},
])('rejects invalid or unimplemented MCBBS components: %j',async(meta)=>{
 const f=await setup({'mcbbs.packmeta':JSON.stringify(meta)});try{await expect(f.packs.inspect(f.file)).rejects.toThrow();expect(f.install.installInto).not.toHaveBeenCalled();}finally{await rm(f.root,{recursive:true,force:true});}
});
it('supports MCBBS manifest compatibility and does not leak metadata into game files',async()=>{
 const f=await setup({'manifest.json':JSON.stringify({name:'Compatibility',addons:[{id:'game',version:'1.20.1'}]}),'overrides/config/demo.txt':'ok'});
 try{expect((await f.packs.inspect(f.file)).format).toBe('mcbbs');const item=await f.tasks.wait<any>(f.packs.install(f.file,'Compatibility'));expect(await readdir(item.gameDir)).toEqual(['config']);}finally{await rm(f.root,{recursive:true,force:true});}
});
it.each([
 {'modpack.json':JSON.stringify({name:'HMCL Forge',gameVersion:'1.12.2'}),'minecraft/versions/1.12.2/1.12.2.json':JSON.stringify({id:'1.12.2',mainClass:'net.minecraft.launchwrapper.Launch',libraries:[{name:'net.minecraftforge:forge:1.12.2-14.23.5.2860'}]})},
 {'modpack.json':JSON.stringify({name:'HMCL Forge',gameVersion:'1.20.1',patches:[{id:'forge',version:'47.2.0'}]})},
 {'mmc-pack.json':JSON.stringify({formatVersion:1,components:[{uid:'net.minecraft',version:'1.20.1'}]}),'instance.cfg':'name=Patched','patches/net.minecraft.json':JSON.stringify({uid:'net.minecraft','+libraries':[{name:'custom:required:1'}]})},
 {'mmc-pack.json':JSON.stringify({formatVersion:1,components:[{uid:'net.minecraft',version:'1.20.1',cachedPatches:[{uid:'custom.required',version:'1'}]}]}),'instance.cfg':'name=Patched'},
 {'mmc-pack.json':JSON.stringify({formatVersion:1,components:[{uid:'net.minecraft',version:'1.20.1',cachedVersion:{mainClass:'custom.Entry',libraries:[{name:'custom:required:1'}]}}]}),'instance.cfg':'name=Patched'},
] as Record<string,string>[])('rejects legacy custom version and patch data instead of registering vanilla: %j',async(entries)=>{
 const f=await setup(entries);try{await expect(f.packs.inspect(f.file)).rejects.toThrow(/自定义|补丁|组件/);await expect(f.tasks.wait(f.packs.install(f.file,'Unsupported'))).rejects.toThrow();expect(f.install.installInto).not.toHaveBeenCalled();expect(await f.instances.list()).toEqual([]);}finally{await rm(f.root,{recursive:true,force:true});}
});
it('rebuilds standard MultiMC component metadata caches with matching explicit identity',async()=>{
 const f=await setup({'mmc-pack.json':JSON.stringify({formatVersion:1,components:[{uid:'net.minecraft',version:'1.20.1',cachedVersion:'1.20.1',cachedName:'Minecraft',cachedRequires:[],cachedPatches:[]}]}),'instance.cfg':'name=Cached','.minecraft/config/demo.txt':'cached'});
 try{const p=await f.packs.inspect(f.file);expect(p.minecraft).toBe('1.20.1');const item=await f.tasks.wait<any>(f.packs.install(f.file,'Cached'));expect(await readFile(join(item.gameDir,'config/demo.txt'),'utf8')).toBe('cached');}finally{await rm(f.root,{recursive:true,force:true});}
});
