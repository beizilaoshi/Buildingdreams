import type { PackPreview } from '../../shared/packs';
import type { LoaderKind } from '../../shared/types';
import { archivePath } from './archive';
import { instanceName, versionSegment } from './install';
export type LegacyPackFormat = 'hmcl'|'multimc'|'mcbbs';
export interface PackDescriptor {format:PackPreview['format'];manifestPath:string;prefix:string}
const markers:Record<string,PackPreview['format']>={'modrinth.index.json':'modrinth','manifest.json':'curseforge','modpack.json':'hmcl','mmc-pack.json':'multimc','mcbbs.packmeta':'mcbbs'};
export function detectPack(names:string[]):PackDescriptor {
 const candidates=names.filter(n=>n.split('/').length<=2 && markers[n.split('/').at(-1)!]).map(manifestPath=>({manifestPath,prefix:manifestPath.includes('/')?manifestPath.slice(0,manifestPath.lastIndexOf('/')+1):'',format:markers[manifestPath.split('/').at(-1)!]}));
 // MCBBS commonly includes a compatibility manifest in the same folder.
 const selected=candidates.filter(c=>!(c.format==='curseforge' && candidates.some(x=>x.prefix===c.prefix && x.format==='mcbbs')));
 if(selected.length!==1)throw new Error(selected.length?'ZIP 中包含多个整合包清单，无法确定安装目标':'未识别的整合包格式；不支持猜测普通 ZIP 的游戏版本');
 return selected[0];
}
function record(v:unknown):Record<string,any>{if(!v||typeof v!=='object'||Array.isArray(v))throw new Error('无效整合包清单');return v as Record<string,any>;}
function hasCustomVersionPayload(names:string[]):boolean {
 return names.some(raw=>{
  const path=raw.replace(/\\/g,'/').replace(/^\.\//,'').replace(/\/$/,'');
  if(!path)return false;
  const parts=path.split('/').filter(Boolean);
  const lower=parts.map(part=>part.toLowerCase());
  if(lower.some((part,index)=>
   part==='hmcl'||part==='multimc'||part==='prismlauncher'||part==='launcher_profiles.json'||part==='instance.cfg'||part==='mmc-pack.json'||part==='modpack.json'||
   (part==='pcl'&&lower[index+1]==='setup.ini')))return true;
  // A root-level or launcher-prefixed Minecraft instance tree can override the
  // version JSON/libraries/patches that our installer reconstructs itself.
  for(let i=0;i<parts.length;i++){
   const segment=parts[i].toLowerCase();
   if((segment==='minecraft'||segment==='.minecraft') && /^(versions|libraries|patches|bin)$/i.test(parts[i+1]||''))return true;
   if(i===0 && /^(versions|libraries|patches|bin)$/i.test(segment))return true;
   if(segment==='versions' && parts[i+1] && parts[i+2] && parts[i+2].toLowerCase()===`${parts[i+1].toLowerCase()}.json`)return true;
  }
  return false;
 });
}
export function parseLegacyPack(raw:unknown,format:LegacyPackFormat,cfg='',archiveNames:string[]=[]):PackPreview {
 const data=record(raw),warnings:string[]=['仅迁移游戏文件和已支持的加载器；包内 Java 路径、启动命令及启动参数不会自动应用。'];
 let minecraft:string|undefined,loader:PackPreview['loader'];
 const add=(id:unknown,value:unknown)=>{
  if(typeof id!=='string'||typeof value!=='string')throw new Error('无效整合包组件');
  const version=versionSegment(value);
  if(id==='game'||id==='net.minecraft'){if(minecraft)throw new Error('重复游戏组件');minecraft=version;return;}
  if(id.startsWith('org.lwjgl')){warnings.push('沿用游戏官方 LWJGL，不迁移整合包自定义 LWJGL。');return;}
  const kind:LoaderKind|undefined=({'fabric':'fabric','net.fabricmc.fabric-loader':'fabric','quilt':'quilt','org.quiltmc.quilt-loader':'quilt','forge':'forge','net.minecraftforge':'forge','neoforge':'neoforge','net.neoforged':'neoforge'} as Record<string,LoaderKind>)[id];
  if(!kind||loader)throw new Error('整合包包含尚不支持或冲突的加载器组件：'+id);
  loader={kind,version};
 };
 let name=data.name;
 if(format==='hmcl'){
  minecraft=versionSegment(data.gameVersion);
  // HMCL's legacy gameVersion format does not declare loader components.
  if(data.addons || data.components || data.patches || data.version || data.versionJson || data.libraries || data.mainClass)throw new Error('此 HMCL 自定义组件组合暂不支持，请使用标准整合包格式');
  if(archiveNames.some(n=>/^minecraft\/(versions|libraries|bin|patches)\//i.test(n) || /^minecraft\/(version|pack)\.json$/i.test(n)))
   throw new Error('此 HMCL 整合包包含自定义版本或组件文件，暂不能安全迁移；请重新导出标准整合包');
 }else if(format==='multimc'){
  if(data.formatVersion!==1||!Array.isArray(data.components)||data.components.length>32)throw new Error('无效 MultiMC 整合包组件');
  if(data.patches || archiveNames.some(n=>/^(?:patches|\.minecraft\/(?:versions|libraries|bin|patches))\//i.test(n)))
   throw new Error('此 MultiMC 整合包包含自定义版本或补丁，暂不能安全迁移');
  for(const c of data.components){
   const part=record(c);
   if(part.patches || (part.cachedPatches !== undefined && (!Array.isArray(part.cachedPatches) || part.cachedPatches.length > 0)) ||
     (part.cachedVersion !== undefined && (typeof part.cachedVersion !== 'string' || part.cachedVersion !== part.version)))
    throw new Error('此 MultiMC 组件含自定义补丁或版本缓存，暂不能安全迁移');
   // A matching string is a display/version cache, not executable component metadata.
   // Empty patch caches are reconstructible; nonempty/structured patch caches are not.
   if(part.cachedPatches !== undefined || part.cachedVersion !== undefined)warnings.push('标准组件名称/版本缓存由官方组件重新获取；不导入自定义补丁。');
   add(part.uid,part.version);
  }
  const names=cfg.split(/\r?\n/).filter(l=>/^name=/.test(l));
  name=names.length===1?names[0].slice(5).trim():undefined;
 }else{
  if(!Array.isArray(data.addons)||data.addons.length===0||data.addons.length>32)throw new Error('无效 MCBBS 整合包组件');
  if(data.patches!==undefined||data.components!==undefined||data.versionJson!==undefined||data.version!==undefined||data.libraries!==undefined||data.mainClass!==undefined)
   throw new Error('此 MCBBS 整合包包含自定义版本、补丁或启动配置，暂不能安全迁移；请重新导出标准整合包');
  if(data.launchInfo!==undefined){
   const info=record(data.launchInfo);
   const allowed=new Set(['minMemory','supportedJavaVersions','launchArgument','javaArgument','preLaunchCommand','postExitCommand']);
   if(Object.keys(info).some(key=>!allowed.has(key))||
    (info.minMemory!==undefined&&(!Number.isInteger(info.minMemory)||info.minMemory<0))||
    (info.supportedJavaVersions!==undefined&&(!Array.isArray(info.supportedJavaVersions)||info.supportedJavaVersions.some((v:unknown)=>!Number.isInteger(v)||Number(v)<1)))||
    (info.launchArgument!==undefined&&(!Array.isArray(info.launchArgument)||info.launchArgument.some((v:unknown)=>typeof v!=='string')))||
    (info.javaArgument!==undefined&&(!Array.isArray(info.javaArgument)||info.javaArgument.some((v:unknown)=>typeof v!=='string')))||
    (info.preLaunchCommand!==undefined&&typeof info.preLaunchCommand!=='string')||
    (info.postExitCommand!==undefined&&typeof info.postExitCommand!=='string'))
    throw new Error('MCBBS launchInfo 结构无效或包含未知字段');
   warnings.push('已识别 MCBBS launchInfo，但不会应用其中的内存、Java 版本、启动参数或命令。');
  }
  if(hasCustomVersionPayload(archiveNames))throw new Error('此 MCBBS 整合包包含自定义版本、库、补丁或启动器配置文件，暂不能安全迁移；请重新导出标准整合包');
  const seen=new Set<string>();
  const supportedIds=new Set(['game','net.minecraft','fabric','net.fabricmc.fabric-loader','quilt','org.quiltmc.quilt-loader','forge','net.minecraftforge','neoforge','net.neoforged']);
  for(const c of data.addons){
   const part=record(c);
   if(Object.keys(part).some(key=>key!=='id'&&key!=='version'))throw new Error('MCBBS 组件包含无法识别的自定义字段');
   if(typeof part.id!=='string')throw new Error('无效 MCBBS 整合包组件');
   if(part.id==='optifine'||part.id==='liteloader')throw new Error('此 MCBBS 整合包包含当前未支持的组件：'+part.id);
   if(!supportedIds.has(part.id))throw new Error('整合包包含尚不支持或自定义的 MCBBS 组件：'+part.id);
   if(seen.has(part.id))throw new Error('重复 MCBBS 整合包组件：'+part.id);
   seen.add(part.id);
   add(part.id,part.version);
  }
 }
 if(!minecraft)throw new Error('整合包缺少 Minecraft 游戏组件');
 const overrides=format==='hmcl'?'minecraft':format==='multimc'?'.minecraft':'overrides';archivePath(overrides);
 return {format,name:instanceName(typeof name==='string'&&name.trim()?name:'导入的整合包'),minecraft,loader,files:[],missingFiles:[],overrides,warnings};
}
