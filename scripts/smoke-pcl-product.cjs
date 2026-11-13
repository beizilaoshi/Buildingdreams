// Production adapter initial-device/cancel only. Never prints protocol or credential values.
const {app}=require('electron');
const {join}=require('node:path');
const {mkdtemp,rm,access}=require('node:fs/promises');
const {tmpdir}=require('node:os');
const {PclBridge,privatePclRuntime}=require('../dist/main/services/pcl-bridge');
app.whenReady().then(async()=>{
  const root=await mkdtemp(join(tmpdir(),'zhumeng-pcl-product-'));
  const flags={device:false,heartbeat:false,registryOwned:false,childExited:false,cleanup:false,privateRemoved:false,cancelled:false};
  let directory;
  const runtime=privatePclRuntime(root,join(__dirname,'../tools/pcl-bridge/bin/Release'),async()=>join(app.getPath('desktop'),'Plain Craft Launcher 2.exe'));
  const actual={
    prepare:async session=>{const p=await runtime.prepare(session);directory=p.directory;return p;},
    spawn:(exe,dir)=>{
      const child=runtime.spawn(exe,dir);let buffered='';
      child.stdout.on('data',data=>{buffered+=data.toString('utf8');let i;while((i=buffered.indexOf('\n'))>=0){const line=buffered.slice(0,i);buffered=buffered.slice(i+1);try{const e=JSON.parse(line);flags.heartbeat ||= e.kind==='heartbeat';flags.registryOwned ||= e.kind==='progress'&&e.registryOwned===true;}catch{}}if(buffered.length>65536)buffered='';});
      child.once('close',()=>{flags.childExited=true;});return child;
    },
    cleanup:async(...args)=>{await runtime.cleanup(...args);flags.cleanup=true;},
  };
  const bridge=new PclBridge(actual),attempt=bridge.begin();
  try {
    const deadline=Date.now()+90000;
    while(Date.now()<deadline) {
      const state=attempt.poll();
      if(state.status!=='pending')break;
      if(state.device?.userCode&&state.device?.verificationUri){flags.device=true;break;}
      await new Promise(r=>setTimeout(r,100));
    }
    await attempt.cancel();flags.cancelled=attempt.poll().status==='cancelled';
    try{await attempt.result;}catch{}
    if(directory)flags.privateRemoved=await access(directory).then(()=>false,()=>true);
    process.stdout.write(JSON.stringify(flags)+'\n');
    process.exitCode=Object.values(flags).every(Boolean)?0:1;
  } catch {process.stdout.write(JSON.stringify(flags)+'\n');process.exitCode=1;}
  finally{await bridge.dispose();await rm(root,{recursive:true,force:true});app.exit(process.exitCode||0);}
}).catch(()=>{process.stdout.write('{"smokeFailed":true}\n');app.exit(1);});
