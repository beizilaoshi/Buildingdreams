import { validateExternalAuthPolicy, type ExternalAuthPolicy } from '../../shared/external-auth';
import { validateLaunchSettings } from "../../shared/launch-settings";
import { validateInstance, validateMetadata, bounded } from "../../shared/instance-metadata";
import { readdir, readFile, mkdir, rename, stat, open } from "node:fs/promises";
import { resolve, join, dirname, basename, isAbsolute } from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { safeDestination } from './network';
import { Version, type ResolvedVersion } from "@xmcl/core";
import type { Instance, GameDirectory } from "../../shared/types";
export interface Ownership { schema: 1; receipt: string; root: string; instanceId: string }
export interface LaunchLease { attempt: string; phase: 'legacy'|'preparing'|'spawned'; marker?: string; pid?: number }
export interface Registry {
  schema: 1; instances: Instance[]; directories: GameDirectory[];
  ownership: Record<string,Ownership>; leases: Record<string,LaunchLease>;
  maintenance: Record<string,{token:string;kind:'repair'|'deleting'|'backup'}>;
}
const empty = (): Registry => ({schema:1,instances:[],directories:[],ownership:{},leases:{},maintenance:{}});
const uuid = (x: unknown) => typeof x === 'string' && /^[a-f0-9-]{36}$/.test(x);
function pathKey(path:string):string { return resolve(path).replace(/[\\/]+$/,'').toLowerCase(); }
function inferGameDirMode(item:Pick<Instance,'resourceDir'|'gameDir'|'versionId'>):Instance['gameDirMode'] {
  const game=pathKey(item.gameDir),root=pathKey(item.resourceDir);
  if(game===root)return 'shared';
  if(game===pathKey(join(item.resourceDir,'versions',item.versionId))||game===pathKey(join(item.resourceDir,'game')))return 'isolated';
  return 'custom';
}
function validateRegistry(value: unknown): Registry {
  const data = Array.isArray(value) ? {...empty(),instances:value} : value as Registry;
  if(!data || data.schema !== 1 || !Array.isArray(data.instances) || !Array.isArray(data.directories) || Object.keys(data).some(k=>!['schema','instances','directories','ownership','leases','maintenance'].includes(k))) throw Error('实例注册表格式损坏，已停止维护');
  data.instances = data.instances.map(validateInstance);
  if(new Set(data.instances.map(x=>x.id)).size !== data.instances.length) throw Error('重复实例记录');
  for(const item of data.instances) {
    for(const path of [item.resourceDir,item.gameDir]) if(!isAbsolute(path)) throw Error('实例目录必须是绝对路径');
    item.gameDirMode ??= inferGameDirMode(item);
  }
  for(const dir of data.directories) { bounded(dir.id,200); bounded(dir.name,120); bounded(dir.path,4096); if(!isAbsolute(dir.path)||Object.keys(dir).some(k=>!['id','name','path'].includes(k))) throw Error('无效目录映射'); }
  for(const field of ['ownership','leases','maintenance'] as const) if(!data[field] || typeof data[field] !== 'object' || Array.isArray(data[field])) throw Error('维护状态损坏');
  for(const [id,o] of Object.entries(data.ownership)) if(!o || o.schema !== 1 || !uuid(o.receipt) || o.instanceId !== id || !isAbsolute(o.root) || Object.keys(o).some(k=>!['schema','receipt','root','instanceId'].includes(k))) throw Error('所有权记录损坏');
  for(const [id,rawLease] of Object.entries(data.leases)) {
    if(!data.instances.some(x=>x.id===id)) throw Error('启动租约损坏');
    // Schema-1 string leases predate process markers. Keep them as legacy unresolved
    // leases: they might belong to a game that outlived the launcher.
    const lease: LaunchLease = typeof rawLease === 'string'
      ? {attempt:rawLease,phase:'legacy'}
      : rawLease as LaunchLease;
    if(!lease || !uuid(lease.attempt) || !['legacy','preparing','spawned'].includes(lease.phase) ||
      Object.keys(lease).some(k=>!['attempt','phase','marker','pid'].includes(k)) ||
      (lease.phase==='legacy' && (lease.marker!==undefined||lease.pid!==undefined)) ||
      (lease.phase!=='legacy' && !uuid(lease.marker)) ||
      (lease.pid!==undefined && (!Number.isSafeInteger(lease.pid)||lease.pid<1)) ||
      (lease.phase==='spawned' && lease.pid===undefined)) throw Error('启动租约损坏');
    data.leases[id]=lease;
  }
  for(const [id,m] of Object.entries(data.maintenance)) if(!data.instances.some(x=>x.id===id) || !m || !uuid(m.token) || !['repair','deleting','backup'].includes(m.kind)) throw Error('维护记录损坏');
  // Legacy arrays derive display-only mappings, never ownership.
  for(const item of data.instances) if(!data.directories.some(d=>d.path===item.resourceDir)) data.directories.push({id:randomUUID(),path:item.resourceDir,name:basename(item.resourceDir)||'游戏目录'});
  return data;
}
export class InstanceService {
  private data = empty();
  private loading?: Promise<void>;
  private queue: Promise<unknown> = Promise.resolve();
  busy: (id:string)=>boolean = ()=>false;
  constructor(private file?: string, private defaults?: ()=>Promise<Pick<Instance,'memoryMb'|'javaArgs'|'javaPath'>>) {}
  private async load() {
    if(!this.file) return;
    try { this.data = validateRegistry(JSON.parse(await readFile(this.file,'utf8'))); }
    catch(error) { if((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
  }
  async snapshot(): Promise<Registry> { this.loading ??= this.load(); await this.loading; return structuredClone(this.data); }
  async list(): Promise<Instance[]> { return (await this.snapshot()).instances; }
  /** One main-only transaction queue; drafts are invisible until durable publication. */
  transaction<T>(change:(draft:Registry)=>Promise<T>|T):Promise<T> {
    const operation=this.queue.then(async()=>{
      const draft=await this.snapshot(); const result=await change(draft); validateRegistry(draft);
      if(this.file) {
        await mkdir(dirname(this.file),{recursive:true}); const temporary=this.file+'.'+randomUUID()+'.tmp';
        const handle=await open(temporary,'wx'); try { await handle.writeFile(JSON.stringify(draft,null,2)); await handle.sync(); } finally { await handle.close(); }
        await rename(temporary,this.file);
      }
      this.data=draft; return structuredClone(result);
    });
    this.queue=operation.catch(()=>{}); return operation;
  }
  find(draft:Registry,id:string):Instance { const item=draft.instances.find(x=>x.id===id); if(!item) throw Error('实例不存在'); return item; }
  assertIdle(draft:Registry,id:string) { if(this.busy(id)||draft.leases[id]) throw Error('实例存在运行中或未解决的启动租约；请保留注册记录'); if(draft.maintenance[id]) throw Error('实例维护尚未完成'); }
  async get(id:string):Promise<Instance> { return this.find(await this.snapshot(),id); }
  async resolve(id:string):Promise<ResolvedVersion> { const item=await this.get(id); return Version.parse(item.resourceDir,item.versionId); }
  async applyNewDefaults(item:Instance):Promise<Instance> { if(!this.defaults)return item; const defaults=await this.defaults();return {...item,...defaults,javaPath:item.javaPath??defaults.javaPath}; }
  private async importedGameDirectory(
    root: string,
    versionId: string,
  ): Promise<string> {
    const version = join(root, "versions", versionId);
    // Compatibility reference: PCL 2.12.7.3 ModMinecraft.PathIndie and
    // Settings.vb (PCL/Setup.ini). Independently implemented read-only mapping.
    try {
      const ini = await readFile(join(version, "PCL", "Setup.ini"), "utf8");
      const modern = /^VersionArgumentIndieV2\s*[:=]\s*(true|false)\s*$/im.exec(
        ini,
      );
      if (modern) return modern[1].toLowerCase() === "true" ? version : root;
      const legacy = /^VersionArgumentIndie\s*[:=]\s*([12])\s*$/im.exec(ini);
      if (legacy) return legacy[1] === "1" ? version : root;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    for (const candidate of [
      join(root, "versions", versionId),
      join(root, "game"),
    ]) {
      for (const folder of [
        "saves",
        "mods",
        "config",
        "resourcepacks",
        "shaderpacks",
        "defaultconfigs",
        "kubejs",
        "scripts",
      ]) {
        try {
          if ((await readdir(join(candidate, folder))).length) return candidate;
        } catch (error) {
          if (
            (error as NodeJS.ErrnoException).code !== "ENOENT" &&
            (error as NodeJS.ErrnoException).code !== "ENOTDIR"
          )
            throw error;
        }
      }
      if (candidate === join(root, "game")) {
        try {
          if ((await stat(candidate)).isDirectory()) return candidate;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        }
      }
    }
    return root;
  }
  async mapGameDirectory(id:string,path:string):Promise<Instance> {
    const gameDir=resolve(path); if(!(await stat(gameDir)).isDirectory()) throw Error('请选择现有游戏数据目录');
    return this.transaction(d=>{this.assertIdle(d,id);const item=this.find(d,id);item.gameDir=gameDir;item.gameDirMode='custom';return item;});
  }
  async setIsolation(id:string,isolated:boolean):Promise<Instance> {
    if(typeof isolated!=='boolean')throw Error('无效版本隔离设置');
    const current=await this.get(id),{canonicalRoot}=await import('./instance-maintenance'),root=await canonicalRoot(current.resourceDir);
    const gameDir=isolated?await safeDestination(root,join('versions',current.versionId)):root;
    await mkdir(gameDir,{recursive:true});
    return this.transaction(d=>{this.assertIdle(d,id);const item=this.find(d,id);if(item.resourceDir!==current.resourceDir||item.versionId!==current.versionId)throw Error('版本目录已变化，请刷新后重试');item.gameDir=gameDir;item.gameDirMode=isolated?'isolated':'shared';return item;});
  }
  async useVanilla(id:string):Promise<Instance> {
    const current=await this.get(id);
    if(!current.loader)throw Error('此版本已经是原版');
    const vanilla=bounded(current.minecraft,200);
    const resolved=await Version.parse(current.resourceDir,vanilla);
    if(resolved.minecraftVersion!==current.minecraft || resolved.libraries.some(l=>/fabric-loader|quilt-loader|neoforge|minecraftforge/i.test(l.name)))
      throw Error('找不到可用的原版配置；加载器文件已保留');
    return this.transaction(d=>{this.assertIdle(d,id);const item=this.find(d,id);if(item.versionId!==current.versionId||item.resourceDir!==current.resourceDir)throw Error('实例版本已变化，请刷新后重试');item.versionId=vanilla;delete item.loader;item.status='ready';delete item.error;return item;});
  }
  async importDirectory(path:string):Promise<Instance[]> {
    const root=resolve(path); const entries=await readdir(join(root,'versions'),{withFileTypes:true});
    return this.transaction(async d=>{
      const imported:Instance[]=[];
      if(!d.directories.some(x=>x.path===root)) d.directories.push({id:randomUUID(),path:root,name:basename(root)||'游戏目录'});
      for(const entry of entries.filter(e=>e.isDirectory())) {
        const versionId=entry.name;
        const id=createHash('sha256').update(root+'\0'+versionId).digest('hex').slice(0,24);
        let item=d.instances.find(i=>i.resourceDir===root&&i.versionId===versionId);
        if(item) this.assertIdle(d,item.id);
        if(!item) { const gameDir=await this.importedGameDirectory(root,versionId);item={id,name:versionId,versionId,resourceDir:root,gameDir,gameDirMode:gameDir===root?'shared':'isolated',minecraft:versionId,memoryMb:2048,javaArgs:[],status:'ready'};d.instances.push(item); }
        item.gameDirMode ??= inferGameDirMode(item);
        try {
          const version=await Version.parse(root,versionId);item.minecraft=version.minecraftVersion;item.status='ready';delete item.error;delete item.loader;
          const library=version.libraries.find(l=>/fabric-loader|quilt-loader|neoforge|minecraftforge/.test(l.name));
          if(library) item.loader={kind:library.name.includes('fabric')?'fabric':library.name.includes('quilt')?'quilt':library.name.includes('neoforge')?'neoforge':'forge',version:library.version};
        } catch(error) {item.status='invalid';item.error=String(error).slice(0,16384);}
        imported.push(item);
      }
      return imported;
    });
  }
  async register(item:Instance,expected?:Instance,signal?:AbortSignal):Promise<Instance> {
    return this.transaction(async d=>{
      item.gameDirMode ??= inferGameDirMode(item);
      signal?.throwIfAborted();const index=d.instances.findIndex(x=>x.id===item.id);
      if(expected) {this.assertIdle(d,item.id);if(index<0||JSON.stringify(d.instances[index])!==JSON.stringify(expected))throw Error('实例已被修改，请重新安装加载器');}
      else if(index>=0||d.instances.some(x=>x.name===item.name)) throw Error('实例已经存在');
      if(index<0)item=await this.applyNewDefaults(item);signal?.throwIfAborted();item=validateInstance(item);
      if(index<0)d.instances.push(item);else d.instances[index]=item;
      return item;
    });
  }
  /** Only trusted completed install/pack publication may call this method. */
  async registerOwned(item:Instance,signal?:AbortSignal):Promise<Instance> {
    return this.transaction(async d=>{
      item.gameDirMode ??= inferGameDirMode(item);
      if(d.instances.some(x=>x.id===item.id||x.name===item.name))throw Error('实例已经存在');
      item=validateInstance(await this.applyNewDefaults(item));
      const {canonicalRoot}=await import('./instance-maintenance');
      const root=await canonicalRoot(item.resourceDir);
      if(resolve(item.gameDir)!==join(root,'game'))throw Error('所有权要求独立游戏目录');
      const receipt:Ownership={schema:1,receipt:randomUUID(),root,instanceId:item.id};
      const handle=await open(join(root,'.zhumeng-owner.json'),'wx');try {await handle.writeFile(JSON.stringify(receipt));await handle.sync();} finally{await handle.close();}
      signal?.throwIfAborted();d.instances.push(item);d.ownership[item.id]=receipt;return item;
    });
  }
  async patch(id:string,patch:Pick<Instance,'memoryMb'|'javaArgs'|'javaPath'|'javaMinMajor'|'javaMaxMajor'|'javaMode'>):Promise<Instance> {return this.transaction(d=>{this.assertIdle(d,id);const item=this.find(d,id);Object.assign(item,patch);validateInstance(item);return item;});}
  async setAuthentication(id:string,authentication:ExternalAuthPolicy):Promise<Instance> {const valid=validateExternalAuthPolicy(authentication);return this.transaction(d=>{this.assertIdle(d,id);const item=this.find(d,id);item.authentication=valid;return item;});}
  async patchLaunch(id:string,launch:unknown):Promise<Instance> {const valid=validateLaunchSettings(launch);return this.transaction(d=>{this.assertIdle(d,id);const item=this.find(d,id);item.launch=valid;return item;});}
  async metadata(id:string,value:unknown):Promise<Instance> {const patch=validateMetadata(value);return this.transaction(d=>{const item=this.find(d,id);if(d.maintenance[id])throw Error('实例正在维护');Object.assign(item,patch);return item;});}
  async setIcon(id:string,icon:string|null):Promise<Instance> {return this.transaction(d=>{const item=this.find(d,id);if(d.maintenance[id])throw Error('实例正在维护');if(icon===null)delete item.icon;else item.icon=icon;validateInstance(item);return item;});}
  async setCover(id:string,cover:string|null):Promise<Instance> {return this.transaction(d=>{const item=this.find(d,id);if(d.maintenance[id])throw Error('实例正在维护');if(cover===null)delete item.cover;else item.cover=cover;validateInstance(item);return item;});}
  async mergeFavorites(ids:string[]):Promise<void> {await this.transaction(d=>{for(const item of d.instances)if(item.favorite===undefined)item.favorite=ids.includes(item.id);});}
  async directories():Promise<GameDirectory[]> {return (await this.snapshot()).directories;}
  async renameDirectory(id:string,name:string):Promise<void> {bounded(name,120);await this.transaction(d=>{const entry=d.directories.find(x=>x.id===id);if(!entry)throw Error('目录不存在');entry.name=name;});}
  async removeDirectory(id:string):Promise<void> {await this.transaction(d=>{const entry=d.directories.find(x=>x.id===id);if(!entry)throw Error('目录不存在');for(const item of d.instances.filter(x=>x.resourceDir===entry.path)) {this.assertIdle(d,item.id);delete d.ownership[item.id];} d.instances=d.instances.filter(x=>x.resourceDir!==entry.path);d.directories=d.directories.filter(x=>x.id!==id);});}
  async unregister(id:string):Promise<void> {await this.transaction(d=>{this.find(d,id);this.assertIdle(d,id);d.instances=d.instances.filter(x=>x.id!==id);delete d.ownership[id];});}
  async beginLaunch(id:string,marker:string=randomUUID()):Promise<string> {if(!uuid(marker))throw Error('启动标记无效');return this.transaction(d=>{this.find(d,id);if(d.leases[id]||d.maintenance[id])throw Error('启动租约或维护状态尚未解决');const attempt=randomUUID();d.leases[id]={attempt,phase:'preparing',marker};return attempt;});}
  async markLaunchSpawned(id:string,attempt:string,pid:number):Promise<void> {if(!Number.isSafeInteger(pid)||pid<1)throw Error('游戏进程号无效');await this.transaction(d=>{const lease=d.leases[id];if(lease?.attempt===attempt&&lease.phase!=='legacy'){lease.phase='spawned';lease.pid=pid;}});}
  async endLaunch(id:string,attempt:string):Promise<void> {await this.transaction(d=>{if(d.leases[id]?.attempt===attempt)delete d.leases[id];});}
  async unresolvedLeases():Promise<Array<{id:string;name:string;lease:LaunchLease}>> {const d=await this.snapshot();return Object.entries(d.leases).map(([id,lease])=>({id,name:d.instances.find(x=>x.id===id)?.name??id,lease:{...lease}}));}
  async updateRecoveredLease(id:string,attempt:string,pid:number):Promise<void> {await this.transaction(d=>{const lease=d.leases[id];if(lease?.attempt===attempt&&lease.marker){lease.phase='spawned';lease.pid=pid;}});}
  async confirmReleaseLease(id:string,attempt:string):Promise<void> {await this.transaction(d=>{if(this.busy(id))throw Error('实例仍由当前启动器启动');if(d.leases[id]?.attempt===attempt)delete d.leases[id];});}
}
