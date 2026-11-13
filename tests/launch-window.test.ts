import { it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LaunchService } from '../src/main/services/launch';
import { InstanceService } from '../src/main/services/instances';
import { JavaService } from '../src/main/services/java';
import { fixture } from './minecraft-fixture';
it('keeps running distinct from window readiness and delays hiding until owned readiness', async () => {
 const root=await fixture(); await writeFile(join(root,'versions/base/base.jar'),'not executed');
 const instances=new InstanceService(); const [item]=await instances.importDirectory(root); await instances.patchLaunch(item.id,{launcherAction:'hide'});
 const java=new JavaService(); vi.spyOn(java,'detect').mockResolvedValue([{path:process.execPath,major:17,version:'17',arch:'amd64'}]);
 let ready!:(value:boolean)=>void; let detectorSignal!:AbortSignal;
 const service=new LaunchService(instances,java,async()=>({name:'n',uuid:'u',accessToken:'s'}),async()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)']));
 service.windowDetector=async (_child,signal)=>{detectorSignal=signal; return new Promise(resolve=>ready=resolve);};
 const actions:string[]=[]; service.windowAction=a=>actions.push(a);
 try { await service.launch(item.id,'a'); expect(service.status(item.id).phase).toBe('running'); expect(service.status(item.id).windowReady).not.toBe(true); expect(actions).not.toContain('hide'); ready(true); await vi.waitFor(()=>expect(service.status(item.id).windowReady).toBe(true)); expect(actions).toEqual(['hide']); await service.stop(item.id); await vi.waitFor(()=>expect(service.isBusy(item.id)).toBe(false)); expect(detectorSignal.aborted).toBe(true); }
 finally {await service.stop(item.id);}
});

it('ignores late window readiness after exit and resets readiness for a new attempt', async () => {
 const root=await fixture(); await writeFile(join(root,'versions/base/base.jar'),'not executed'); const instances=new InstanceService(); const [item]=await instances.importDirectory(root);
 const java=new JavaService(); vi.spyOn(java,'detect').mockResolvedValue([{path:process.execPath,major:17,version:'17',arch:'amd64'}]);
 const completions:((value:boolean)=>void)[]=[];
 const service=new LaunchService(instances,java,async()=>({name:'n',uuid:'u',accessToken:'s'}),async()=>spawn(process.execPath,['-e','setInterval(()=>{},1000)']));
 service.windowDetector=async()=>new Promise(resolve=>completions.push(resolve));
 try {await service.launch(item.id,'a'); await service.stop(item.id); await vi.waitFor(()=>expect(service.isBusy(item.id)).toBe(false)); await service.launch(item.id,'a'); completions[0](true); await new Promise(resolve=>setImmediate(resolve)); expect(service.status(item.id).windowReady).not.toBe(true); completions[1](false); await new Promise(resolve=>setImmediate(resolve)); expect(service.status(item.id).windowReady).not.toBe(true);}
 finally {await service.stop(item.id);}
});
import { waitForGameWindow } from '../src/main/services/launch-window';
it.runIf(process.platform==='win32')('detects a real delayed visible owned Windows form and cleans its helper', async () => {
 const script="Add-Type -AssemblyName System.Windows.Forms; Add-Type 'using System;using System.Runtime.InteropServices;public class ShowProbe{[DllImport(\"user32.dll\")] public static extern bool ShowWindow(IntPtr h,int n);}'; Start-Sleep -Milliseconds 1800; $f=New-Object System.Windows.Forms.Form; $f.Text='Zhumeng detector test'; $f.Width=200; $f.Height=100; $timer=New-Object System.Windows.Forms.Timer; $timer.Interval=200; $timer.Add_Tick({[ShowProbe]::ShowWindow($f.Handle,5);$timer.Stop()}); $timer.Start(); [System.Windows.Forms.Application]::Run($f)";
 const child=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],{windowsHide:true,stdio:'ignore'});
 const helpers=new Set<ReturnType<typeof spawn>>(), controller=new AbortController(); let ready=false;
 try {await new Promise<void>((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject);});
 const result=waitForGameWindow(child,controller.signal,h=>{helpers.add(h);h.once('close',()=>helpers.delete(h));},()=>child.exitCode===null && child.signalCode===null).then(value=>{ready=value;return value;});
 await new Promise(resolve=>setTimeout(resolve,500)); expect(ready).toBe(false); expect(await result).toBe(true); expect(helpers.size).toBe(0);
 const other=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{windowsHide:true,stdio:'ignore'});
 const abort=new AbortController(); let unrelatedReady=false;
 try {await new Promise<void>((resolve,reject)=>{other.once('spawn',resolve);other.once('error',reject);});
 const pending=waitForGameWindow(other,abort.signal,h=>{helpers.add(h);h.once('close',()=>helpers.delete(h));},()=>other.exitCode===null && other.signalCode===null).then(value=>{unrelatedReady=value;return value;});
 await new Promise(resolve=>setTimeout(resolve,800)); expect(unrelatedReady).toBe(false); abort.abort(); expect(await pending).toBe(false); expect(helpers.size).toBe(0);
 } finally {abort.abort();other.kill();}

 } finally {controller.abort();child.kill();for(const helper of helpers)helper.kill();}
},15000);
it('accepts only final owned graphics logs as PCL readiness and never claims a window', async () => {
 const root=await fixture(); await writeFile(join(root,'versions/base/base.jar'),'not executed'); const instances=new InstanceService(); const [item]=await instances.importDirectory(root);await instances.patchLaunch(item.id,{launcherAction:'hide'});
 const java=new JavaService(); vi.spyOn(java,'detect').mockResolvedValue([{path:process.execPath,major:17,version:'17',arch:'amd64'}]);
 let child!:ReturnType<typeof spawn>; const service=new LaunchService(instances,java,async()=>({name:'n',uuid:'u',accessToken:'s'}),async()=>child=spawn(process.execPath,['-e',"setInterval(()=>{},1000)"])); service.windowDetector=async()=>false;const actions:string[]=[];service.windowAction=a=>actions.push(a);
 try {await service.launch(item.id,'a');child.stdout!.emit('data','Setting user: n\nlwjgl version 3\nOpenAL initialized\n[CHAT] Created textures -atlas\n');expect(service.status(item.id).gameReady).not.toBe(true);expect(actions).toEqual([]);child.stdout!.emit('data','Created 256 textures/minecraft-atlas\n');expect(service.status(item.id)).toMatchObject({phase:'running',gameReady:true,readinessSource:'graphics-log'});expect(service.status(item.id).windowReady).not.toBe(true);expect(actions).toEqual(['hide']);await service.stop(item.id);child.stdout!.emit('data','Found animation info\n');expect(service.status(item.id).phase).toBe('stopping');expect(actions).toEqual(['hide']);}
 finally{await service.stop(item.id);}
});
