import {spawn,execFile, type ChildProcess} from 'node:child_process';
import {randomBytes,randomUUID} from 'node:crypto';
import {readFile,writeFile,mkdir,rename,stat,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {createServer} from 'node:net';
import {setTimeout as delay} from 'node:timers/promises';
import {validateLinkConfig,decodeInvite,encodeInvite,type LinkRoom,type LinkConfig,type LinkState} from '../../shared/link';

const componentFailure='EasyTier 组件执行失败，请检查组件版本、权限和驱动';
function run(path:string,args:string[],signal?:AbortSignal):Promise<string>{
 return new Promise((resolve,reject)=>{
  const fail=()=>reject(Error(signal?.aborted?'操作已取消':componentFailure));
  try{execFile(path,args,{windowsHide:true,shell:false,timeout:5000,maxBuffer:256*1024,signal,env:cleanEnv()},(err,stdout)=>err?fail():resolve(stdout));}
  catch{fail();}
 });
}
function cleanEnv(){return Object.fromEntries(Object.entries(process.env).filter(([k])=>!k.toUpperCase().startsWith('ET_')));}
async function freePort():Promise<number>{const s=createServer();return new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',()=>{const p=(s.address() as {port:number}).port;s.close(err=>err?reject(err):resolve(p));});});}
function diagnostic(value:string,room:LinkRoom):string{
 // CLI output is untrusted diagnostics. Credentials belong only in memory and the explicit invite field.
 return value.split(encodeInvite(room)).join('[私密邀请码已隐藏]').split(room.networkSecret).join('[网络密钥已隐藏]');
}

export class LinkService {
 private config:LinkConfig={corePath:'',cliPath:'',peers:[]};
 private loaded=false;private loading?:Promise<void>;
 private stopping?:Promise<void>;private leaving?:Promise<LinkState>;
 private pending?:Promise<LinkState>;private operation?:AbortController;private generation=0;
 private child?:ChildProcess;private room?:LinkRoom;private port=0;private instance='';
 private current:LinkState={status:'idle',config:this.config};
 private refreshing?:{child:ChildProcess;generation:number;operation:AbortController;task:Promise<LinkState>};
 private rollback?:{temp:string;previous:string|undefined};
 constructor(private readonly file:string){}
 private async load(){if(this.loaded)return;if(!this.loading)this.loading=(async()=>{try{this.config=validateLinkConfig(JSON.parse(await readFile(this.file,'utf8')));}catch{}this.current.config=this.config;this.loaded=true;})();await this.loading;}
 private snapshot():LinkState{return structuredClone(this.current);}
 private track(task:Promise<LinkState>){
  this.pending=task;
  void task.finally(()=>{if(this.pending===task)this.pending=undefined;}).catch(()=>undefined);
  return task;
 }
 private cancelRefresh(){this.refreshing?.operation.abort();this.refreshing=undefined;}
 async state():Promise<LinkState>{
  await this.load();
  if(this.child&&this.current.status==='connected'&&!this.leaving){
   const child=this.child;const generation=this.generation;
   if(this.refreshing?.child===child&&this.refreshing.generation===generation)return this.refreshing.task;
   const operation=new AbortController();
   const task=this.refresh(child,generation,operation.signal).finally(()=>{operation.abort();if(this.refreshing?.task===task)this.refreshing=undefined;});
   this.refreshing={child,generation,operation,task};return task;
  }
  return this.snapshot();
 }
 private async refresh(child:ChildProcess,generation:number,signal:AbortSignal){
  const room=this.room;
  const active=()=>this.child===child&&this.generation===generation&&this.current.status==='connected'&&!signal.aborted&&!this.leaving;
  if(!room||!active())return this.snapshot();
  try{
   const [node,peers]=await Promise.all([this.query('node',room,signal),this.query('peer',room,signal)]);
   if(!node.trim()||!peers.trim())throw Error(componentFailure);
   if(active()){
    this.current.node=node;this.current.peers=peers;
    this.current.virtualIp=node.match(/Virtual IP\s*[│|]\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1];this.current.error=undefined;
   }
  }catch{
   if(active()){
    this.current.node=undefined;this.current.peers=undefined;this.current.virtualIp=undefined;
    this.current.error='状态读取失败，将自动重试；请检查 EasyTier 进程、RPC 或驱动，也可离开后重新加入';
   }
  }
  return this.snapshot();
 }
 private async query(command:string,room:LinkRoom,signal:AbortSignal){
  return diagnostic(await run(this.config.cliPath,['-p',`127.0.0.1:${this.port}`,'-n',this.instance,'--no-trunc',command],signal),room);
 }
 private async restoreConfig(){
  const rollback=this.rollback;if(!rollback)return;
  try{
   if(rollback.previous===undefined)await rm(this.file,{force:true});
   else{await writeFile(rollback.temp,rollback.previous,{mode:0o600});await rename(rollback.temp,this.file);}
   this.rollback=undefined;
  }catch{throw Error('恢复 EasyTier 组件配置失败，请检查配置目录权限并重试离开');}
 }
 configure(value:LinkConfig):Promise<LinkState>{
  if(this.child||this.operation||this.stopping||this.leaving||this.rollback)return Promise.reject(Error('请先离开房间再修改组件'));
  const operation=new AbortController();this.operation=operation;const generation=this.generation;
  const check=()=>{if(operation.signal.aborted||generation!==this.generation||this.operation!==operation)throw Error('操作已取消');};
  return this.track((async()=>{
   const temp=this.file+'.'+randomUUID()+'.tmp';let committed=false;let previous:string|undefined;
   try{
    await this.load();check();const config=validateLinkConfig(value);
    for(const p of [config.corePath,config.cliPath]){if(!(await stat(p)).isFile())throw Error('组件路径必须是文件');check();}
    const [core,cli]=await Promise.all([run(config.corePath,['--version'],operation.signal),run(config.cliPath,['--help'],operation.signal)]);check();
    if(!core.startsWith('easytier-core ')||!cli.includes('--rpc-portal')||!cli.includes('--instance-name')||!cli.includes('node')||!cli.includes('peer'))throw Error('组件不兼容，请使用官方 EasyTier 2.6.4 或兼容版本');
    try{previous=await readFile(this.file,'utf8');}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT')throw error;}
    check();await mkdir(dirname(this.file),{recursive:true});check();await writeFile(temp,JSON.stringify(config),{mode:0o600});check();
    await rename(temp,this.file);committed=true;check();
    this.config=config;this.current={status:'idle',config,version:core.match(/^easytier-core [\w.+-]+/)?.[0]??'easytier-core'};return this.snapshot();
   }catch(error){
    // Leave waits for both this operation and a successful rollback, including an in-flight rename.
    if(committed){this.rollback={temp,previous};await this.restoreConfig();}
    if(operation.signal.aborted)throw Error('操作已取消');
    // Filesystem errors can echo user-controlled paths; never expose raw component diagnostics.
    if(error instanceof Error&&['组件路径必须是文件','组件不兼容，请使用官方 EasyTier 2.6.4 或兼容版本',componentFailure,'请选择可信组件的绝对可执行路径','无效组件配置','最多配置 16 个节点','无效节点','节点须为 tcp://主机:端口 或 udp://主机:端口','无效节点地址'].includes(error.message))throw error;
    throw Error('无法验证或保存 EasyTier 组件配置，请检查文件、版本和目录权限');
   }finally{
    try{await rm(temp,{force:true});}catch{/* A remaining staging file contains only public component configuration. */}
    operation.abort();if(this.operation===operation)this.operation=undefined;
   }
  })());
 }

 create():Promise<LinkState>{return this.start();}
 async join(invite:string):Promise<LinkState>{return this.start(decodeInvite(invite));}
 private start(invitedRoom?:LinkRoom):Promise<LinkState>{
  // Reserve before load/freePort: leave must be able to cancel even before there is a child.
  if(this.child||this.operation||this.stopping||this.leaving||this.rollback)return Promise.reject(Error('已有房间或操作正在进行，请先离开'));
  const operation=new AbortController();this.operation=operation;const generation=this.generation;
  const check=()=>{if(operation.signal.aborted||generation!==this.generation||this.operation!==operation)throw Error('操作已取消');};
  return this.track((async()=>{
   let failure='EasyTier 启动失败，请检查组件、权限、驱动和网络配置';
   let child:ChildProcess|undefined;
   const fail=(message:string):never=>{failure=message;throw Error(message);};
   try{
    await this.load();check();
    if(!this.config.corePath||!this.config.cliPath)fail('请先配置并验证 EasyTier 组件');
    if(!invitedRoom&&!this.config.peers.length)fail('请先配置至少一个可达节点（自行托管或可信共享节点）');
    const room=invitedRoom??{networkName:'zm-'+randomUUID(),networkSecret:randomBytes(32).toString('base64url'),peers:this.config.peers};
    if(!room.peers.length)fail('邀请码缺少可达节点');
    this.current={status:'starting',config:this.config,networkName:room.networkName};
    this.instance='zhumeng-'+randomUUID();this.port=await freePort();check();
    child=spawn(this.config.corePath,['--dhcp','true','--network-name',room.networkName,'--rpc-portal',`127.0.0.1:${this.port}`,'--rpc-portal-whitelist','127.0.0.1/32','--instance-name',this.instance,'--no-listener','--disable-upnp','true','--relay-network-whitelist','--peers',...room.peers],{shell:false,windowsHide:true,stdio:['ignore','pipe','pipe'],env:{...cleanEnv(),ET_NETWORK_SECRET:room.networkSecret}});
    const owned=child;this.child=owned;this.room=room;
    owned.stdout?.resume();owned.stderr?.resume();
    let startupFailure='';
    owned.once('error',()=>{startupFailure='EasyTier 启动失败，请检查组件路径和权限';});
    const exited=(code:number|null)=>{
     if(this.child!==owned)return;
     this.child=undefined;this.room=undefined;this.cancelRefresh();
     if(!operation.signal.aborted&&!this.leaving&&!this.stopping)this.current={status:'error',config:this.config,error:`EasyTier 已退出（${code??'未知'}），请检查管理员权限、wintun.dll 和网络配置`};
    };
    // Failed spawn emits close without exit; listen immediately, before a later stop can miss it.
    owned.once('exit',exited);owned.once('close',exited);
    let node='';
    for(let i=0;i<30;i++){
     check();if(startupFailure||this.child!==owned||owned.exitCode!==null||owned.signalCode)fail(startupFailure||'EasyTier 提前退出，请检查驱动与权限');
     try{node=await this.query('node',room,operation.signal);if(node.trim())break;}catch{/* Startup RPC may not be ready yet. */}
     await delay(400,undefined,{signal:operation.signal});
    }
    check();if(this.child!==owned)fail('EasyTier 提前退出，请检查驱动与权限');
    if(!node.trim())fail('等待 EasyTier 启动超时，请检查权限、wintun.dll 和组件版本');
    this.current={status:'connected',config:this.config,networkName:room.networkName,invite:encodeInvite(room),node,virtualIp:node.match(/Virtual IP\s*[│|]\s*(\d+\.\d+\.\d+\.\d+)/i)?.[1]};
    return await this.state();
   }catch{
    // This operation may stop only the process it created, never a later session.
    if(child&&this.child===child){
     try{await this.stopOwned();}
     catch{
      if(this.operation===operation&&generation===this.generation)this.current={status:'error',config:this.config,error:'EasyTier 进程尚未退出，请稍后重试退出'};
      throw Error('EasyTier 进程尚未退出，请稍后重试退出');
     }
    }
    if(this.operation===operation&&generation===this.generation){
     this.room=undefined;this.current={status:operation.signal.aborted?'idle':'error',config:this.config,error:operation.signal.aborted?undefined:failure};
    }
    return this.snapshot();
   }finally{if(this.operation===operation)this.operation=undefined;}
  })());
 }
 private stopOwned():Promise<void>{
  if(this.stopping)return this.stopping;
  const child=this.child;if(!child)return Promise.resolve();
  // Install the shared promise and listeners synchronously, before kill can emit an event.
  let resolve!:()=>void;let reject!:(error:Error)=>void;
  const task=new Promise<void>((done,fail)=>{resolve=done;reject=fail;});
  this.stopping=task;
  void task.finally(()=>{if(this.stopping===task)this.stopping=undefined;}).catch(()=>undefined);
   let forceTimer:ReturnType<typeof setTimeout>|undefined;let bound:ReturnType<typeof setTimeout>|undefined;
   const cleanup=()=>{clearTimeout(forceTimer);clearTimeout(bound);child.removeListener('exit',done);child.removeListener('close',done);};
   const done=()=>{cleanup();if(this.child===child){this.child=undefined;this.room=undefined;}resolve();};
   const kill=(signal?:NodeJS.Signals)=>{try{child.kill(signal);}catch{/* Keep ownership and wait for exit or the bounded failure. */}};
   child.once('exit',done);child.once('close',done);
   if(this.child!==child||child.exitCode!==null||child.signalCode)done();
   else{
    forceTimer=setTimeout(()=>{bound=setTimeout(()=>{cleanup();reject(Error('EasyTier 进程尚未退出，请稍后重试退出'));},2500);kill('SIGKILL');},2500);
    kill();
   }
  return task;
 }
 leave():Promise<LinkState>{
  if(this.leaving)return this.leaving;
  this.generation++;this.operation?.abort();this.cancelRefresh();const pending=this.pending;
  let resolve!:(state:LinkState)=>void;let reject!:(error:unknown)=>void;
  const task=new Promise<LinkState>((done,fail)=>{resolve=done;reject=fail;});
  this.leaving=task;
  void task.finally(()=>{if(this.leaving===task)this.leaving=undefined;}).catch(()=>undefined);
  void (async()=>{
   try{
    await this.stopOwned();
    // Pending start/configure must finish cleanup before configure or another start can proceed.
    if(pending)await pending.catch(()=>undefined);
    await this.restoreConfig();
    this.room=undefined;this.current={status:'idle',config:this.config};return this.snapshot();
   }catch{
    this.current={status:'error',config:this.config,error:this.rollback?'恢复 EasyTier 组件配置失败，请检查配置目录权限并重试离开':'EasyTier 进程尚未退出，请稍后重试退出'};
    throw Error(this.current.error);
   }
  })().then(resolve,reject);
  return task;
 }

 async copyValue(kind:'ip'|'invite'){const state=await this.state();const value=kind==='ip'?state.virtualIp:state.invite;if(this.leaving||!this.child||this.current.status!=='connected'||state.status!=='connected'||!value)throw Error(kind==='ip'?'虚拟 IP 尚未就绪':'尚未加入房间');return value;}
}
