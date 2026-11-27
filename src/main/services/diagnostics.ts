import {open,lstat,readdir,realpath} from 'node:fs/promises';
import {join,resolve,relative,isAbsolute,sep} from 'node:path';
import {constants} from 'node:fs';
import type {DiagnosticFile,DiagnosticReport} from '../../shared/diagnostics';
import {canonicalRoot} from './instance-maintenance';
const MAX_FILE=2*1024*1024,MAX_TOTAL=4*1024*1024;
export function redactDiagnostics(text:string):string {
 // Binary/hostile single-line logs must not trigger quadratic regex scans.
 return text.split(/\r?\n/).map(line=>line.length>8192?'[超长日志行已省略]':line).join('\n').replace(/(--(?:accessToken|clientToken|uuid|username)(?:=|\s+))(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s]+)/gi,'$1[已脱敏]')
 .replace(/(Bearer\s+)[A-Za-z0-9._~+\/-]+/gi,'$1[已脱敏]')
 .replace(/((?:["']?)(?:access[_-]?token|refresh[_-]?token|client[_-]?token|password|authorization)(?:["']?)\s*[:=]\s*)(?:"[^"\r\n]*"|'[^'\r\n]*'|[^\s,;}]+)/gi,'$1[已脱敏]')
 .replace(/eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g,'[令牌已脱敏]')
 .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi,'[邮箱已脱敏]')
 .replace(/\b[a-f0-9]{8}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{4}-?[a-f0-9]{12}\b/gi,'[标识已脱敏]')
 .replace(/[A-Z]:[\\/](?:[^\r\n"<>|]*?)(?=\s+(?:at\b|--|\[)|[\r\n"<>|]|$)/gi,'[本地路径已脱敏]')
 .replace(/\/(?:home|Users)\/[^\s"'<>]+/g,'[本地路径已脱敏]');
}
const rules=[
 ['heap','Java 堆内存不足',/OutOfMemoryError:\s*(?:Java heap space|GC overhead)|insufficient memory for the Java Runtime/i,'关闭其他占用内存的软件，适当增加游戏内存；同时确认没有分配超过可用物理内存。'],
 ['java-version','Java 版本不兼容',/UnsupportedClassVersionError|class file version \d+|only recognizes class file versions/i,'使用实例的自动 Java 配置，或按游戏和加载器要求选择匹配的 Java 版本。'],
 ['java-arguments','Java 启动参数或内存配置无效',/Unrecognized (?:VM )?option|Invalid maximum heap size|Could not reserve enough space|Could not create the Java Virtual Machine/i,'先恢复默认 Java 参数，检查最大内存及 Java 位数后重试。'],
 ['mod-dependencies','模组依赖或版本冲突',/Incompatible mod set|ModResolutionException|Missing mandatory dependencies|DuplicateModsFoundException/i,'按错误中的模组名核对游戏版本、加载器及前置依赖；逐一禁用最近添加的模组。'],
 ['mixin','模组注入失败',/MixinApplyError|MixinTransformerError|InvalidMixinException|InjectionError/i,'查看错误附近的模组类名，核对模组与加载器版本，优先排查最近更新的模组。'],
 ['graphics','显卡或 OpenGL 初始化失败',/GLFW error (?:65542|65543)|Failed to create (?:the )?(?:OpenGL|window)|Pixel format not accelerated|OpenGL version .*not supported/i,'安装显卡厂商驱动并检查游戏所需 OpenGL 支持；双显卡设备尝试高性能显卡。'],
 ['native','原生库加载失败',/UnsatisfiedLinkError|no lwjgl in java.library.path|Failed to locate library:.*lwjgl/i,'确认 Java 与系统架构匹配，并使用游戏库的补全/修复文件功能重新准备原生库。'],
 ['files','游戏或依赖文件缺失',/Could not find or load main class|ClassNotFoundException: (?:net.minecraft|cpw.mods|net.fabricmc)|Invalid or corrupt jarfile|zip END header not found/i,'使用游戏库的修复功能；若来自第三方整合包，请核对受限文件是否已补齐。'],
 ['jvm-crash','Java 虚拟机发生原生崩溃',/A fatal error has been detected by the Java Runtime|EXCEPTION_ACCESS_VIOLATION|SIGSEGV/i,'检查同一报告的 Problematic frame；更新匹配的 Java 与显卡驱动，排查原生库或覆盖层。'],
 ['network','游戏资源或服务器连接失败',/ConnectException|Connection timed out|Connection reset|UnknownHostException|Failed to connect to the server|Read timed out/i,'检查网络和 DNS，确认游戏服务器在线；资源下载失败时可在设置中切换下载源后重试。'],
 ['loader','模组加载器初始化失败',/Failed to load (?:mod|plugin)|ModLoadingException|LoaderException|Errors during mod loading|Exception in thread "main".*(?:forge|fabric|quilt|neoforge)/i,'确认加载器版本与 Minecraft 版本匹配；打开实例的 Mod 管理，暂时禁用最近安装或更新的模组后重试。'],
 ['disk','磁盘空间不足或游戏文件无法写入',/No space left on device|There is not enough space on the disk|AccessDeniedException|Permission denied.*(?:\.minecraft|minecraft)/i,'检查游戏目录所在磁盘剩余空间和文件夹权限；确保启动器与游戏目录没有被安全软件锁定。'],
 ['shader','光影或资源包导致渲染失败',/Shader compilation failed|Invalid shader|Error loading shader|Could not load shader pack/i,'先关闭光影包并恢复默认资源包；确认 Iris、OptiFine 或 Oculus 与当前加载器兼容。'],
 ['world','存档读取或保存失败',/Failed to load world|Exception loading level|AnvilChunkLoader|Corrupted.*(?:region|chunk)|Failed to save the world/i,'先备份存档再尝试修复；若问题只在一个世界出现，暂时不要覆盖原存档文件。'],
] as const;
export function analyzeCrash(files:DiagnosticFile[],omitted:string[]=[]):DiagnosticReport {
 const safe=files.map(f=>({name:redactDiagnostics(f.name),text:redactDiagnostics(f.text)}));
 const findings=rules.flatMap(([id,title,pattern,suggestion])=>{
  for(const file of safe){const line=file.text.split(/\r?\n/).find(l=>pattern.test(l));if(line)return [{id,title,suggestion,evidence:`${file.name}: ${line.slice(0,500)}`}];}
  return [];
 });
 return {schema:1,generatedAt:Date.now(),files:safe,findings,omitted:omitted.map(redactDiagnostics)};
}
async function boundedRead(file:string):Promise<string>{
 const before=await lstat(file);if(!before.isFile()||before.isSymbolicLink()||before.size>MAX_FILE)throw Error('不是常规日志或超过 2 MB');
 const handle=await open(file,constants.O_RDONLY|(constants.O_NOFOLLOW||0));
 try{const actual=await handle.stat();if(actual.dev!==before.dev||actual.ino!==before.ino||actual.size>MAX_FILE)throw Error('日志已变化');
 const bytes=Buffer.alloc(MAX_FILE+1);let used=0;
 while(used<bytes.length){const {bytesRead}=await handle.read(bytes,used,bytes.length-used,null);if(!bytesRead)break;used+=bytesRead;}
 if(used>MAX_FILE)throw Error('日志超过 2 MB');return bytes.subarray(0,used).toString('utf8');
 }finally{await handle.close();}
}
export async function importDiagnostic(file:string):Promise<DiagnosticReport>{
 if(!/\.(?:log|txt)$/i.test(file))throw Error('请选择 .log 或 .txt 日志');
 return analyzeCrash([{name:'手动导入日志',text:await boundedRead(file)}]);
}
export async function collectDiagnostics(directory:string,sessionLog=''):Promise<DiagnosticReport>{
 const root=await canonicalRoot(directory),files:DiagnosticFile[]=[],omitted:string[]=[];
 let total=0;
 async function add(name:string){
  try{
   const path=join(root,name),actual=await realpath(path),rel=relative(root,actual);
   if(rel==='..'||rel.startsWith('..'+sep)||isAbsolute(rel)||actual.toLowerCase()!==resolve(path).toLowerCase())throw Error('日志包含链接');
   // Parent directories are checked separately, including Windows junctions.
   if(name.includes('/'))await canonicalRoot(join(root,name.split('/')[0]));
   const text=await boundedRead(path),size=Buffer.byteLength(text);
   if(total+size>MAX_TOTAL)throw Error('报告总量超过 4 MB');total+=size;files.push({name,text});
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')omitted.push(`${name}: ${e instanceof Error?e.message:'读取失败'}`);}
 }
 await add('logs/latest.log');await add('logs/debug.log');
 for(const [dir,pattern,limit] of [['crash-reports',/^crash-.*\.txt$/i,3],['',/^hs_err_pid\d+\.log$/i,2]] as const){
  try{
   const folder=dir?await canonicalRoot(join(root,dir)):root;
   const names=(await readdir(folder,{withFileTypes:true})).filter(e=>e.isFile()&&pattern.test(e.name));
   const entries=await Promise.all(names.slice(0,500).map(async e=>({name:e.name,time:(await lstat(join(folder,e.name))).mtimeMs})));
   for(const e of entries.sort((a,b)=>b.time-a.time).slice(0,limit))await add(dir?`${dir}/${e.name}`:e.name);
  }catch(e){if((e as NodeJS.ErrnoException).code!=='ENOENT')omitted.push(`${dir||'游戏目录'}: 不能读取日志目录`);}
 }
 if(sessionLog){const text=sessionLog.slice(-128*1024);if(total+Buffer.byteLength(text)<=MAX_TOTAL)files.push({name:'本次启动会话',text});}
 return analyzeCrash(files,omitted);
}
