const { JavaRuntimeService } = require('../dist/main/services/java-runtime.js');
const { JavaService } = require('../dist/main/services/java.js');
const { NetworkService } = require('../dist/main/services/network.js');
const { TaskService } = require('../dist/main/services/tasks.js');
const { join,resolve } = require('node:path');
const { writeFile,mkdir,readFile } = require('node:fs/promises');
const { javaRequirement } = require('../dist/shared/java-requirements.js');
(async()=>{
 const root=resolve('scratch/java-live-17');await mkdir(root,{recursive:true});
 const inspector=new JavaService();const managed=new JavaRuntimeService(root,new NetworkService(),p=>inspector.inspect(p));const tasks=new TaskService();const java=new JavaService(managed,tasks);
 const runtime=await managed.install(javaRequirement({minecraft:'1.18'}),{signal:AbortSignal.timeout(600000),report:()=>{}});
 const manifest=JSON.parse(await readFile(join(runtime.path,"../../zhumeng-runtime.json"),"utf8"));
 const result={asset:manifest.asset,fileCount:manifest.files.length,date:new Date().toISOString(),root,runtime,inventory:await managed.list(),javaw:await inspector.inspect(join(runtime.path,'../javaw.exe'))};
 // Resolve through the same production resolver after restarting its inventory service.
 const restarted=new JavaService(new JavaRuntimeService(root,new NetworkService(),p=>inspector.inspect(p)),tasks);
 result.resolved=await restarted.resolve({minecraft:'1.18'},{memoryMb:4096,autoDownload:false,roots:[]});
 if(result.resolved.path !== runtime.path)throw Error('Production resolver did not reuse installed managed runtime');
 await writeFile('scratch/pcl-java-live.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
