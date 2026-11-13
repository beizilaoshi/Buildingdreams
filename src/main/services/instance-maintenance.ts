import { lstat, realpath, readFile, readdir, rename } from 'node:fs/promises';
import { resolve, parse, join, relative, isAbsolute, dirname, sep } from 'node:path';
import { randomUUID } from 'node:crypto';
import type { InstanceDeletePlan } from '../../shared/types';
import type { InstanceService, Registry } from './instances';
import type { TaskService } from './tasks';

/** Check every ancestor, not just descendants below a caller-selected root. */
export async function canonicalRoot(input:string):Promise<string> {
  const path=resolve(input), base=parse(path).root;
  if(path===base)throw Error('不能维护磁盘根目录');
  let current=base;
  for(const segment of relative(base,path).split(/[\\/]/)) {
    current=join(current,segment);const info=await lstat(current);
    if(info.isSymbolicLink())throw Error('目录包含符号链接或重解析点');
  }
  const actual=await realpath(path);
  if(actual.toLowerCase()!==path.toLowerCase() || !(await lstat(actual)).isDirectory())throw Error('目录身份已变化');
  return actual;
}
export function inside(root:string,target:string):boolean {const r=relative(root,resolve(target));return r===''||(!r.startsWith('..'+sep)&&r!=='..'&&!isAbsolute(r));}
async function noLinks(root:string):Promise<void> {
  for(const entry of await readdir(root,{withFileTypes:true})) {
    const path=join(root,entry.name), info=await lstat(path);
    if(info.isSymbolicLink())throw Error('实例含有链接目录或文件，不能物理删除');
    if(info.isDirectory())await noLinks(path);
  }
}
export class InstanceMaintenance {
  private plans=new Map<string,{plan:InstanceDeletePlan;expected:string}>();
  constructor(private instances:InstanceService,private tasks:TaskService,private trash:(path:string)=>Promise<void> = async path=>{const {shell}=await import('electron');await shell.trashItem(path);}) {}
  private tasksIdle() {if(this.tasks.list().some(t=>t.status==='queued'||t.status==='running'))throw Error('请等待所有活动任务完成');}
  private async owned(d:Registry,id:string):Promise<string> {
    const item=this.instances.find(d,id), owner=d.ownership[id];
    if(!owner)throw Error('导入、共享或旧实例没有可信所有权凭据；只能注销并保留文件');
    const root=await canonicalRoot(item.resourceDir);
    if(root!==owner.root || item.gameDir!==join(root,'game'))throw Error('实例目录已映射或共享；只能注销');
    if(JSON.stringify(JSON.parse(await readFile(join(root,'.zhumeng-owner.json'),'utf8')))!==JSON.stringify(owner))throw Error('所有权侧车不匹配');
    for(const other of d.instances.filter(x=>x.id!==id))for(const path of [other.resourceDir,other.gameDir]) {
      // Referenced paths may not exist; lexical ancestry is still a conservative block.
      if(inside(root,path)||inside(path,root))throw Error('目录被其他实例引用，不能删除');
      try {const actual=await realpath(path);if(inside(root,actual)||inside(actual,root))throw Error('目录通过其他映射引用');} catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    }
    await noLinks(root);return root;
  }
  async planDelete(id:string):Promise<InstanceDeletePlan> {
    this.tasksIdle();const d=await this.instances.snapshot();this.instances.assertIdle(d,id);const root=await this.owned(d,id);
    const plan={token:randomUUID(),instanceId:id,paths:[root],expires:Date.now()+5*60*1000};
    if(this.plans.size>100)this.plans.clear();this.plans.set(plan.token,{plan,expected:JSON.stringify(d)});return plan;
  }
  async delete(token:string,externalGamesClosed:boolean):Promise<void> {
    const release=this.tasks.exclusiveMaintenance();
    try { await this.executeDelete(token,externalGamesClosed); } finally { release(); }
  }
  private async executeDelete(token:string,externalGamesClosed:boolean):Promise<void> {
    const saved=this.plans.get(token);this.plans.delete(token);
    if(!saved||saved.plan.expires<Date.now()||externalGamesClosed!==true)throw Error('删除计划已过期或未确认关闭外部游戏');
    const {instanceId:id}=saved.plan;
    await this.instances.transaction(async d=>{this.tasksIdle();this.instances.assertIdle(d,id);if(JSON.stringify(d)!==saved.expected)throw Error('实例或目录映射已变化，请重新预览');await this.owned(d,id);d.maintenance[id]={kind:'deleting',token};});
    let moved=false,trashed=false;const root=saved.plan.paths[0],holding=join(dirname(root),'.zhumeng-deleting-'+token);
    try {
      await this.instances.transaction(async d=>{
        this.tasksIdle();if(d.maintenance[id]?.token!==token||d.leases[id]||this.instances.busy(id))throw Error('删除状态已变化');
        await this.owned(d,id);
        try {await lstat(holding);throw Error('删除暂存路径已存在');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
        await rename(root,holding);moved=true;
        await this.trash(holding);trashed=true;
        d.instances=d.instances.filter(x=>x.id!==id);delete d.ownership[id];delete d.maintenance[id];
        d.directories=d.directories.filter(x=>x.path!==root);
      });
    } catch(error) {
      if(!trashed) {
        try {if(moved)await rename(holding,root);await this.instances.transaction(d=>{if(d.maintenance[id]?.token===token)delete d.maintenance[id];});}
        catch {throw Error('删除未完成，目录或注册表恢复失败；维护锁已保留，请勿继续启动。暂存路径：'+holding);}
      } else throw Error('文件已移入回收站，但注册表提交失败；维护锁已保留，请检查回收站。');
      throw error;
    }
  }
}
