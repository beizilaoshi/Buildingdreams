const {readFile,writeFile,mkdir}=require('node:fs/promises');
const {join,resolve}=require('node:path');
const {randomUUID}=require('node:crypto');
const {registerGameCommands}=require('../dist/main/game-router.js');
const {CommandRouter}=require('../dist/main/ipc.js');
const {DEFAULT_SETTINGS}=require('../dist/shared/settings.js');
(async()=>{
 const root=resolve('validation/java-live');await mkdir(root,{recursive:true});
 const original=JSON.parse(await readFile('validation/live/instances.json','utf8')).find(i=>i.id==='de6f734a-6fbe-454f-b9df-c98fd910f249');
 if(!original)throw Error('Owned live vanilla fixture missing');
 const item={...original,id:randomUUID(),name:'Java auto validation 1.21.1',gameDir:join(root,'game-'+randomUUID()),javaPath:'',memoryMb:2048};
 const registry=join(root,'instances-'+randomUUID()+'.json');await writeFile(registry,JSON.stringify([item]));
 const router=new CommandRouter();const services=registerGameCommands(router,registry,async()=>({name:'Validation',uuid:'00000000000040008000000000000001',accessToken:'local-validation'}),async()=>({...DEFAULT_SETTINGS,autoDownloadJava:false}));
 const plan=await router.invoke('java.plan',{instanceId:item.id});
 if(plan.selected?.major!==21)throw Error('Expected production automatic selection of Java21: '+JSON.stringify(plan));
 let pid,initialized=false;
 try {
   const result=await router.invoke('launch.start',{instanceId:item.id,accountId:'validation'});pid=result.pid;console.log('OWNED_GAME_TEST_PID',pid,'JAVA',JSON.stringify(plan.selected));
   for(let i=0;i<45;i++){
     await new Promise(r=>setTimeout(r,1000));const logs=services.launch.logs(item.id);
     initialized ||= logs.some(e=>/OpenAL initialized|Created:.*texture|Sound engine started/.test(e.text||''));
     if(initialized||logs.some(e=>e.type==='exit'))break;
   }
 } finally {
   if(pid && !services.launch.logs(item.id).some(e=>e.type==='exit'))try{process.kill(pid);}catch{}
   for(let i=0;pid&&i<30;i++){try{process.kill(pid,0);}catch{break;}await new Promise(r=>setTimeout(r,100));}
   let stillRunning=false;if(pid)try{process.kill(pid,0);stillRunning=true;}catch{}
   const evidence={date:new Date().toISOString(),registry,gameDir:item.gameDir,sourceResourceDir:original.resourceDir,plan,pid,initialized,stillRunning,logs:services.launch.logs(item.id)};
   await writeFile('scratch/pcl-java-game-launch.json',JSON.stringify(evidence,null,2));
   console.log(JSON.stringify({pid,initialized,stillRunning,logLines:evidence.logs.length}));
   if(stillRunning||!initialized)throw Error('Game initialization validation failed; see scratch/pcl-java-game-launch.json');
 }
})().catch(e=>{console.error(e);process.exitCode=1});
