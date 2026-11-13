import { createHash, randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { readFile, mkdir, mkdtemp, rename, rm, lstat } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { Version } from '@xmcl/core';
import { InstanceService } from './instances';
import { TaskService, type TaskContext } from './tasks';
import { NetworkService, safeDestination, type DownloadSpec } from './network';
import { canonicalRoot, inside } from './instance-maintenance';
import { versionSegment } from './install';
const hosts=['piston-meta.mojang.com','launchermeta.mojang.com','piston-data.mojang.com','launcher.mojang.com','libraries.minecraft.net','resources.download.minecraft.net'];
type Required = DownloadSpec & {sha1:string;size:number};
function required(value:unknown,path:string):Required {
  const x=value as Record<string,unknown>;
  if(!x||typeof x.url!=='string'||typeof x.sha1!=='string'||!/^[a-f0-9]{40}$/i.test(x.sha1)||!Number.isSafeInteger(x.size)||Number(x.size)<0)throw Error('官方上游缺少可信大小或哈希，暂不支持自动修复');
  return {path,url:x.url,sha1:x.sha1.toLowerCase(),size:Number(x.size)};
}
async function matches(path:string,spec:Required,signal:AbortSignal):Promise<boolean> {
  try {
    const info=await lstat(path);if(!info.isFile()||info.isSymbolicLink())throw Error('修复目标不是普通文件');
    if(info.size!==spec.size)return false;
    const hash=createHash('sha1');for await(const bytes of createReadStream(path,{signal}))hash.update(bytes);
    return hash.digest('hex')===spec.sha1;
  } catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return false;throw error;}
}
export class InstanceRepair {
  private network:NetworkService;
  constructor(private instances:InstanceService,private tasks:TaskService,network:NetworkService) {this.network=network.restricted(hosts);}
  start(id:string):string {return this.tasks.start('修复游戏必需资源',context=>this.run(id,context));}
  private async run(id:string,context:TaskContext):Promise<{checked:number;replaced:number}> {
    const release=this.tasks.exclusiveMaintenance(context.taskId),token=randomUUID();let locked=false,stage:string|undefined,rollbackFailed=false;
    try {
      const item=await this.instances.transaction(d=>{
        const item=this.instances.find(d,id);this.instances.assertIdle(d,id);
        for(const other of d.instances)if(inside(item.resourceDir,other.resourceDir)||inside(other.resourceDir,item.resourceDir))this.instances.assertIdle(d,other.id);
        d.maintenance[id]={kind:'repair',token};return item;
      });locked=true;
      const root=await canonicalRoot(item.resourceDir);context.signal.throwIfAborted();
      if(item.loader)throw Error('此加载器的完整官方上游无法验证，请手动修复；未修改任何游戏文件');
      const local=await this.instances.resolve(id),base=versionSegment(local.minecraftVersion);
      if(item.versionId!==base)throw Error('自定义继承版本的上游无法完整验证，请手动修复');
      stage=await mkdtemp(join(root,'.zhumeng-repair-'));
      const manifest=await this.network.json<{versions:{id:string;url:string;sha1:string}[]}>('https://piston-meta.mojang.com/mc/game/version_manifest_v2.json',context.signal);
      if(!Array.isArray(manifest.versions)||manifest.versions.length>10000)throw Error('无效官方版本清单');
      const meta=manifest.versions.find(x=>x.id===base);
      if(!meta||!/^[a-f0-9]{40}$/i.test(meta.sha1))throw Error('此版本没有可信官方上游，请手动修复');
      const profilePath=`versions/${base}/${base}.json`;
      await this.network.download(stage,{path:profilePath,url:meta.url,sha1:meta.sha1},{...context,report:()=>{}});
      const raw=JSON.parse(await readFile(join(stage,profilePath),'utf8'));
      if(raw.id!==base||raw.inheritsFrom!==undefined||!Array.isArray(raw.libraries)||raw.libraries.length>10000)throw Error('无效官方版本描述');
      // XMCL evaluates official platform/rule/native selections in an isolated metadata tree.
      const official=await Version.parse(stage,base);
      const paths=new Map(official.libraries.map(l=>[l.download.path,l.download.sha1]));
      if(local.libraries.some(l=>!paths.has(l.download.path)||paths.get(l.download.path)!==l.download.sha1))throw Error('存在无法验证上游的自定义依赖，请手动修复；已保留版本 JSON');
      if(local.mainClass!==official.mainClass||local.assets!==official.assets)throw Error('自定义入口或资源索引无法验证，请手动修复');
      const specs:Required[]=[required(official.downloads?.client,`versions/${base}/${base}.jar`)];
      for(const library of official.libraries)specs.push(required(library.download,'libraries/'+library.download.path));
      const logging=official.logging?.client?.file;
      if(logging)specs.push(required(logging,'assets/log_configs/'+versionSegment(logging.id)));
      if(official.assetIndex) {
        const spec=required(official.assetIndex,`assets/indexes/${versionSegment(official.assets)}.json`);specs.push(spec);
        await this.network.download(stage,spec,{...context,report:()=>{}});
        const index=JSON.parse(await readFile(join(stage,spec.path),'utf8'));
        if(!index.objects||typeof index.objects!=='object'||Array.isArray(index.objects)||Object.keys(index.objects).length>500000)throw Error('无效官方资源索引');
        for(const asset of Object.values(index.objects) as {hash:string;size:number}[]) {
          if(!asset||!/^[a-f0-9]{40}$/.test(asset.hash))throw Error('无效官方资源哈希');
          specs.push(required({url:`https://resources.download.minecraft.net/${asset.hash.slice(0,2)}/${asset.hash}`,sha1:asset.hash,size:asset.size},`assets/objects/${asset.hash.slice(0,2)}/${asset.hash}`));
        }
      }
      const unique=new Map<string,Required>();for(const spec of specs){this.network.validateUrl(spec.url);const old=unique.get(spec.path);if(old&&(old.sha1!==spec.sha1||old.size!==spec.size))throw Error('官方目标冲突');unique.set(spec.path,spec);}
      const deficient:Required[]=[];let checked=0;
      for(const spec of unique.values()) {
        context.signal.throwIfAborted();const path=await safeDestination(root,spec.path);
        if(!await matches(path,spec,context.signal)){deficient.push(spec);await this.network.download(stage,spec,{...context,report:()=>{}});}
        context.report(++checked/unique.size*0.85);
      }
      // No target writes before ALL downloads and verification have succeeded.
      const installed:{target:string;backup:string;hadOld:boolean;published:boolean}[]=[];
      try {
        for(const spec of deficient) {
          context.signal.throwIfAborted();await canonicalRoot(root);
          const target=await safeDestination(root,spec.path),source=await safeDestination(stage,spec.path),backup=join(stage,'rollback',spec.path);
          if(!await matches(source,spec,context.signal))throw Error('暂存资源校验失败');
          await mkdir(dirname(target),{recursive:true});await mkdir(dirname(backup),{recursive:true});
          let hadOld=false;try{await lstat(target);hadOld=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
          const record={target,backup,hadOld,published:false};installed.push(record);
          if(hadOld)await rename(target,backup);
          await rename(source,target);record.published=true;
        }
        for(const spec of deficient)if(!await matches(await safeDestination(root,spec.path),spec,context.signal))throw Error('修复后校验失败');
        context.signal.throwIfAborted();context.report(1);
      } catch(error) {
        for(const record of installed.reverse()) {
          try{if(record.published)await rm(record.target);if(record.hadOld)await rename(record.backup,record.target);}
          catch {rollbackFailed=true;}
        }
        if(rollbackFailed)throw Error('修复回滚失败，维护锁与备份已保留：'+stage);
        throw error;
      }
      return {checked:unique.size,replaced:deficient.length};
    } finally {
      try {
        if(stage&&!rollbackFailed) {await canonicalRoot(stage);await rm(stage,{recursive:true,force:true});}
        if(locked&&!rollbackFailed)await this.instances.transaction(d=>{if(d.maintenance[id]?.token===token)delete d.maintenance[id];});
      } finally {release();}
    }
  }
}
