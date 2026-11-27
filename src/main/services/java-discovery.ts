import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readdir,lstat} from 'node:fs/promises';
import {join,win32} from 'node:path';
const exec=promisify(execFile);
/** Registry strings are data, never inserted into shell commands. */
export function parseJavaRegistry(output:string):string[]{
 const paths=new Set<string>();
 for(const line of output.slice(0,262144).split(/\r?\n/)){
  const match=/^\s*(?:JavaHome|JDKHome|InstallationPath|Path)\s+REG_(?:SZ|EXPAND_SZ)\s+(.+?)\s*$/i.exec(line);
  if(!match)continue;const path=match[1];
  if(path.length>4096||!win32.isAbsolute(path)||path.startsWith('\\\\')||/[%\x00-\x1f]/.test(path))continue;
  paths.add(/java(?:w)?\.exe$/i.test(path)?path:/[\\/]bin[\\/]?$/i.test(path)?win32.join(path,'java.exe'):win32.join(path,'bin','java.exe'));
 }
 return [...paths].slice(0,128);
}
export async function officialRuntimeCandidates(roots:string[]):Promise<string[]>{
 const result:string[]=[],queue=roots.slice(0,64).map((path,index)=>({path,depth:0,index}));let visited=0;
 while(queue.length&&visited++<1024){
  const {path,depth}=queue.shift()!;
  try{const info=await lstat(path);if(info.isSymbolicLink()||!info.isDirectory())continue;
   const entries=await readdir(path,{withFileTypes:true});
   for(const entry of entries.slice(0,96)){
    if(entry.isSymbolicLink())continue;
    if(entry.isFile()&&['java.exe','java'].includes(entry.name.toLowerCase())&&/[\\/]bin$/i.test(path))result.push(join(path,entry.name));
    if(entry.isDirectory()&&depth<4)queue.push({path:join(path,entry.name),depth:depth+1,index:0});
   }
  }catch{/* Optional launcher installations are often absent. */}
 }
 return result.slice(0,128);
}
/** Bounded conventional roots used for both candidate discovery and deterministic auto-selection. */
export function windowsJavaRoots(instanceRoots:string[]=[]):string[]{
 const roots:string[]=[];
 const user=process.env.USERPROFILE;
 const app=process.env.APPDATA;
 const local=process.env.LOCALAPPDATA;
 const add=(base:string|undefined,...parts:string[])=>{if(base)roots.push(join(base,...parts));};
 // Instance-local runtimes are preferred so a launcher can honor the Java
 // shipped/configured alongside that game before choosing a machine runtime.
 // Scan the instance root itself as well as its conventional Java subfolders.
 // PCL supports a version-local Java; restricting discovery to `java/` and
 // `runtime/` misses layouts such as versions/<id>/java/bin/java.exe.
 for(const base of instanceRoots.slice(0,8)) {
  roots.push(base);
  for(const suffix of ["java", "jre", "jdk", "runtime", "runtime/java", "runtime/jre", ".minecraft/runtime"])
   roots.push(join(base,suffix));
 }
 add(app,".minecraft","runtime");
 add(user,".minecraft","runtime");
 add(app,".hmcl","java"); add(user,".hmcl","java");
 add(app,"ATLauncher","jre"); add(app,"ATLauncher"); add(user,"ATLauncher");
 add(app,"ModrinthApp","meta","java"); add(local,"ModrinthApp","meta","java");
 add(app,"PrismLauncher","java"); add(local,"PrismLauncher","java");
 add(app,"CurseForge","Minecraft","Install","runtime"); add(local,"CurseForge","Minecraft","Install","runtime");
 add(user,"curseforge","minecraft","Install","runtime");
 add(app,"FTBApp","java"); add(local,"FTBApp","java"); add(app,"FTBA","java"); add(local,"FTBA","java");
 add(user,".jdks"); add(user,".sdkman","candidates","java");
 add(local,"Packages","Microsoft.4297127D64EC6_8wekyb3d8bbwe","LocalCache","Local","runtime");
 for(const folder of [process.env.ProgramFiles,process.env["ProgramFiles(x86)"]].filter((v):v is string=>!!v)){
  add(folder,"Minecraft Launcher","runtime");
  for(const vendor of ["Java","Eclipse Adoptium","Microsoft","Zulu","BellSoft","Amazon Corretto","Semeru"])
   add(folder,vendor);
 }
 return [...new Set(roots)].slice(0,64);
}
export function javaPreferenceRoots(instanceRoots:string[]=[]):string[]{
 return windowsJavaRoots(instanceRoots);
}
const cache=new Map<string,{at:number;result:Promise<string[]>}>();
export function discoverWindowsJava(instanceRoots:string[]=[]):Promise<string[]>{
 if(process.platform!=='win32')return Promise.resolve([]);
 const key=JSON.stringify(instanceRoots.slice(0,8).map(path=>path.toLowerCase()));
 const current=cache.get(key);if(current&&Date.now()-current.at<60000)return current.result;
 const result=(async()=>{
  const registries=['HKLM\\SOFTWARE\\JavaSoft','HKLM\\SOFTWARE\\WOW6432Node\\JavaSoft','HKLM\\SOFTWARE\\Eclipse Adoptium','HKLM\\SOFTWARE\\Microsoft\\JDK'];
  const registry=await Promise.all(registries.map(async key=>{try{const {stdout}=await exec(join(process.env.SystemRoot||'C:\\Windows','System32','reg.exe'),['query',key,'/s'],{shell:false,windowsHide:true,timeout:2000,maxBuffer:262144});return parseJavaRegistry(stdout);}catch{return [];}}));
  const roots=windowsJavaRoots(instanceRoots);
  return [...new Set([...registry.flat(),...await officialRuntimeCandidates(roots)])].slice(0,256);
 })().catch(()=>[]);
 cache.set(key,{at:Date.now(),result});
 if(cache.size>8){const oldest=[...cache.entries()].sort((a,b)=>a[1].at-b[1].at)[0];if(oldest)cache.delete(oldest[0]);}
 return result;
}
