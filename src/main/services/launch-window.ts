import { spawn, type ChildProcess } from 'node:child_process';
export type WindowDetector = (child: ChildProcess, signal: AbortSignal, own: (helper: ChildProcess) => void, held: () => boolean) => Promise<boolean>;
/** No title, log or elapsed-time heuristic: only this process's visible top-level window. */
const source = `$ErrorActionPreference='Stop'
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
$target=Get-Process -Id ([int]$data.pid) -ErrorAction Stop
$handle=$target.Handle
$birth=$target.StartTime.ToUniversalTime().Ticks
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class ZhumengReadyWindow {
 public delegate bool EnumProc(IntPtr h, IntPtr p);
 [StructLayout(LayoutKind.Sequential)] public struct Rect { public int Left,Top,Right,Bottom; }
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc callback, IntPtr p);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
 [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out Rect rect);
 public static bool HasWindow(uint pid) {
  bool found=false;
  EnumWindows((h,p)=>{uint owner; Rect r; GetWindowThreadProcessId(h,out owner);
   if(owner==pid && IsWindowVisible(h) && GetWindowRect(h,out r) && r.Right>r.Left && r.Bottom>r.Top) {found=true; return false;} return true;
  },IntPtr.Zero); return found;
 }
}
'@
while($true) {
 $target.Refresh(); if($target.HasExited){exit 2}
 $current=Get-Process -Id ([int]$data.pid) -ErrorAction Stop
 if($current.StartTime.ToUniversalTime().Ticks -ne $birth){exit 2}
 if([ZhumengReadyWindow]::HasWindow([uint32]$data.pid)) { [Console]::Out.Write('ready'); exit 0 }
 Start-Sleep -Milliseconds 150
}`;
export const waitForGameWindow: WindowDetector = async (child, signal, own, held) => {
 if(process.platform!=='win32' || !child.pid || !held() || signal.aborted) return false;
 return new Promise<boolean>((resolve) => {
  const helper=spawn('powershell.exe',['-NoProfile','-NonInteractive','-EncodedCommand',Buffer.from(source,'utf16le').toString('base64')],{windowsHide:true,shell:false,stdio:['pipe','pipe','ignore']});
  own(helper);
  let output='', settled=false;
  const finish=(ready:boolean)=>{if(settled)return;settled=true;signal.removeEventListener('abort',abort);resolve(ready && held() && !signal.aborted);};
  const abort=()=>{helper.kill();};
  signal.addEventListener('abort',abort,{once:true});
  helper.stdin?.on('error',()=>{}); helper.stdin?.end(JSON.stringify({pid:child.pid}));
  helper.stdout?.on('data',chunk=>{output+=String(chunk);if(output.length>32)helper.kill();});
  helper.once('error',()=>finish(false));
  helper.once('close',code=>finish(code===0 && output==='ready'));
  if(signal.aborted || !held())abort();
 });
};
