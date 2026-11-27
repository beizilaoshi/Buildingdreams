import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, rename, rm, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { canonicalRoot } from './instance-maintenance';
import { safeDestination } from './network';
import type { InstanceService } from './instances';

export interface WorldBackup { id:string; world:string; createdAt:number; bytes:number; files:number; sha256:string }
export interface WorldBackupUsage { backups:number; bytes:number }
const MAX_FILES=100_000,MAX_BYTES=100*1024*1024*1024;
function validateWorldName(name:string){if(typeof name!=='string'||!name.trim()||name.length>200||name!==basename(name)||/[\\/:\0-\x1f<>|?*"]/.test(name)||/[. ]$/.test(name)||name.startsWith('.zhumeng-'))throw Error('无效存档名称');return name;}
function key(id:string){return createHash('sha256').update(id).digest('hex');}
async function readBackupMeta(directory:string):Promise<WorldBackup>{const path=await safeDestination(directory,'backup.json'),info=await lstat(path);if(info.isSymbolicLink()||!info.isFile()||info.size>4096)throw Error('备份信息文件无效');const handle=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));try{const actual=await handle.stat();if(actual.dev!==info.dev||actual.ino!==info.ino||actual.size!==info.size)throw Error('备份信息文件发生变化');return JSON.parse(await handle.readFile('utf8')) as WorldBackup;}finally{await handle.close();}}
type CopyState={files:number;bytes:number;hash:ReturnType<typeof createHash>};
async function walkTree(source:string,target:string,state:CopyState,relativePath=''):Promise<void>{
 const info=await lstat(source);if(info.isSymbolicLink())throw Error('存档内包含符号链接，已停止备份');if(!info.isDirectory())throw Error('存档必须是普通目录');
 await mkdir(target,{recursive:true});
 for(const name of (await readdir(source)).sort()){
  const from=await safeDestination(source,name),to=await safeDestination(target,name),entry=await lstat(from);
  const entryPath=relativePath?`${relativePath}/${name}`:name;
  if(entry.isSymbolicLink())throw Error('存档内包含符号链接，已停止备份');
  if(entry.isDirectory()){state.hash.update(`D\0${entryPath}\0`);await walkTree(from,to,state,entryPath);state.hash.update(`E\0${entryPath}\0`);}
   else if(entry.isFile()){
   const input=await open(from,constants.O_RDONLY|(constants.O_NOFOLLOW??0));
   try{
    const opened=await input.stat();if(!opened.isFile()||opened.dev!==entry.dev||opened.ino!==entry.ino||opened.size!==entry.size||opened.mtimeMs!==entry.mtimeMs)throw Error('存档文件在备份期间发生变化');
    state.files++;state.bytes+=opened.size;if(state.files>MAX_FILES||state.bytes>MAX_BYTES)throw Error('存档超过备份安全上限');
    state.hash.update(`F\0${entryPath}\0${opened.size}\0`);
    const output=await open(to,'wx');
    try{const buffer=Buffer.allocUnsafe(1024*1024);let position=0;while(position<opened.size){const {bytesRead}=await input.read(buffer,0,Math.min(buffer.length,opened.size-position),position);if(!bytesRead)throw Error('读取存档文件时遇到意外结束');state.hash.update(buffer.subarray(0,bytesRead));let written=0;while(written<bytesRead){const result=await output.write(buffer,written,bytesRead-written,position+written);if(!result.bytesWritten)throw Error('写入备份文件失败');written+=result.bytesWritten;}position+=bytesRead;}const after=await input.stat();if(after.size!==opened.size||after.mtimeMs!==opened.mtimeMs||after.ctimeMs!==opened.ctimeMs)throw Error('存档文件在备份期间发生变化');}
    finally{await output.close();}
   }finally{await input.close();}
  }else throw Error('存档包含不支持的文件类型');
 }
}
async function copyTree(source:string,target:string):Promise<{files:number;bytes:number;sha256:string}>{
 const state:CopyState={files:0,bytes:0,hash:createHash('sha256')};await walkTree(source,target,state);return {files:state.files,bytes:state.bytes,sha256:state.hash.digest('hex')};
}
export class WorldBackupService {
 constructor(private instances:InstanceService,private root:string){}
 private async locked<T>(id:string,job:(gameDir:string)=>Promise<T>):Promise<T>{
  const token=randomUUID();await this.instances.transaction(d=>{this.instances.assertIdle(d,id);d.maintenance[id]={kind:'backup',token};});
  try{const item=await this.instances.get(id);return await job(await canonicalRoot(item.gameDir));}
  finally{await this.instances.transaction(d=>{if(d.maintenance[id]?.token===token)delete d.maintenance[id];});}
 }
 private async saves(gameDir:string){const root=await safeDestination(gameDir,'saves');try{await mkdir(root,{recursive:true});}catch{}return await canonicalRoot(root);}
 private async backupWorldRoot(id:string,world:string){const root=await safeDestination(this.root,key(id));await mkdir(root,{recursive:true});return safeDestination(root,encodeURIComponent(validateWorldName(world)));}
 private async snapshot(id:string,world:string,source:string):Promise<WorldBackup>{const parent=await this.backupWorldRoot(id,world);await mkdir(parent,{recursive:true});const backupId=randomUUID(),stage=await safeDestination(parent,`.stage-${backupId}`),target=await safeDestination(parent,backupId);try{const count=await copyTree(source,await safeDestination(stage,'world'));const backup={id:backupId,world,createdAt:Date.now(),bytes:count.bytes,files:count.files,sha256:count.sha256};await writeFile(await safeDestination(stage,'backup.json'),JSON.stringify(backup));await rename(stage,target);return backup;}catch(error){await rm(stage,{recursive:true,force:true});throw error;}}
 async worlds(id:string):Promise<string[]>{const item=await this.instances.get(id),saves=await safeDestination(await canonicalRoot(item.gameDir),'saves'),result=new Set<string>();try{const info=await lstat(saves);if(info.isSymbolicLink()||!info.isDirectory())throw Error('存档目录不是普通目录');for(const name of await readdir(saves)){if(name.startsWith('.zhumeng-'))continue;const path=await safeDestination(saves,name),entry=await lstat(path);if(entry.isDirectory()&&!entry.isSymbolicLink())result.add(name);}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}try{const root=await safeDestination(this.root,key(id));const info=await lstat(root);if(info.isSymbolicLink()||!info.isDirectory())throw Error('备份目录不是普通目录');for(const encoded of await readdir(root)){let name:string;try{name=validateWorldName(decodeURIComponent(encoded));}catch{continue;}if((await this.list(id,name)).length)result.add(name);}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}return [...result].sort((a,b)=>a.localeCompare(b,'zh-CN',{numeric:true,sensitivity:'base'}));}
 async usage(id:string):Promise<WorldBackupUsage>{const result:WorldBackupUsage={backups:0,bytes:0};for(const world of await this.worlds(id))for(const backup of await this.list(id,world)){result.backups++;result.bytes+=backup.bytes;}return result;}
 async list(id:string,world:string):Promise<WorldBackup[]>{validateWorldName(world);const parent=await this.backupWorldRoot(id,world);let names:string[];try{names=await readdir(parent);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return [];throw error;}const result:WorldBackup[]=[];for(const name of names){if(!/^[a-f0-9-]{36}$/.test(name))continue;try{const dir=await safeDestination(parent,name),info=await lstat(dir);if(info.isSymbolicLink()||!info.isDirectory())continue;const meta=await readBackupMeta(dir);if(meta.id===name&&meta.world===world&&Number.isSafeInteger(meta.createdAt)&&Number.isSafeInteger(meta.bytes)&&meta.bytes>=0&&meta.bytes<=MAX_BYTES&&Number.isSafeInteger(meta.files)&&meta.files>=0&&meta.files<=MAX_FILES&&/^[a-f0-9]{64}$/.test(meta.sha256))result.push(meta);}catch{continue;}}return result.sort((a,b)=>b.createdAt-a.createdAt);}
 async create(id:string,world:string):Promise<WorldBackup>{validateWorldName(world);return this.locked(id,async gameDir=>{const saves=await this.saves(gameDir),source=await safeDestination(saves,world),sourceInfo=await lstat(source);if(sourceInfo.isSymbolicLink()||!sourceInfo.isDirectory())throw Error('存档不存在或不是普通目录');return this.snapshot(id,world,source);});}
 async delete(id:string,world:string,backupId:string):Promise<void>{validateWorldName(world);if(!/^[a-f0-9-]{36}$/.test(backupId))throw Error('无效备份');await this.locked(id,async()=>{const parent=await this.backupWorldRoot(id,world),target=await safeDestination(parent,backupId),meta=await readBackupMeta(target);if(meta.id!==backupId||meta.world!==world)throw Error('备份信息不匹配');const info=await lstat(target);if(info.isSymbolicLink()||!info.isDirectory())throw Error('备份不是普通目录');await rm(target,{recursive:true});});}
 async restore(id:string,world:string,backupId:string):Promise<WorldBackup|null>{validateWorldName(world);if(!/^[a-f0-9-]{36}$/.test(backupId))throw Error('无效备份');return this.locked(id,async gameDir=>{const parent=await this.backupWorldRoot(id,world),backupDir=await safeDestination(parent,backupId),meta=await readBackupMeta(backupDir);if(meta.id!==backupId||meta.world!==world||!Number.isSafeInteger(meta.bytes)||meta.bytes<0||meta.bytes>MAX_BYTES||!Number.isSafeInteger(meta.files)||meta.files<0||meta.files>MAX_FILES||!/^[a-f0-9]{64}$/.test(meta.sha256))throw Error('备份信息不匹配');const source=await safeDestination(backupDir,'world'),saves=await this.saves(gameDir),target=await safeDestination(saves,world),stage=await safeDestination(saves,`.zhumeng-restore-${randomUUID()}`),previous=await safeDestination(saves,`.zhumeng-previous-${randomUUID()}`);let hasCurrent=false;try{const current=await lstat(target);if(current.isSymbolicLink()||!current.isDirectory())throw Error('当前存档不是普通目录');hasCurrent=true;}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}let restored:{files:number;bytes:number;sha256:string};try{restored=await copyTree(source,stage);}catch(error){await rm(stage,{recursive:true,force:true});throw error;}if(restored.bytes!==meta.bytes||restored.files!==meta.files||restored.sha256!==meta.sha256){await rm(stage,{recursive:true,force:true});throw Error('备份校验失败，文件内容或结构已变化，拒绝恢复');}const safety=hasCurrent?await this.snapshot(id,world,target):null;let moved=false;try{if(hasCurrent){await rename(target,previous);moved=true;}await rename(stage,target);}catch(error){if(moved){try{await rename(previous,target);}catch{throw Error(`恢复失败，原存档已保留在 ${previous}；请不要删除该目录`);}}await rm(stage,{recursive:true,force:true});throw error;}if(moved)await rm(previous,{recursive:true,force:true});return safety;});}
}
