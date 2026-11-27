import {lstat,readFile,writeFile,rename,mkdir,readdir,realpath} from 'node:fs/promises';
import {resolve,parse,join,extname,basename,dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DEFAULT_MUSIC,validateMusicPatch,type MusicPreferences,type MusicSnapshot} from '../../shared/music';
export const MUSIC_LIMIT=64*1024*1024;
export const MUSIC_EXTENSIONS=['mp3','wav','flac','ogg','m4a','aac','opus'];
const MAX_TRACKS=300;
export async function approvedMusicPath(path:string,directory=false):Promise<string>{
 if(typeof path!=='string'||path.length>4096)throw Error('无效音乐路径');
 const absolute=resolve(path);let cursor=parse(absolute).root;
 for(const part of absolute.slice(cursor.length).split(/[\\/]/).filter(Boolean)){cursor=join(cursor,part);if((await lstat(cursor)).isSymbolicLink())throw Error('不支持链接目录或文件');}
 const canonical=await realpath(absolute);const stat=await lstat(canonical);
 if(directory){if(!stat.isDirectory())throw Error('请选择普通目录');}
 else if(!stat.isFile()||stat.size>MUSIC_LIMIT||!MUSIC_EXTENSIONS.includes(extname(canonical).slice(1).toLowerCase()))throw Error('音乐格式不支持或文件超过 64 MiB');
 return canonical;
}
export class MusicService {
 private paths:string[]=[];private preferences={...DEFAULT_MUSIC};private tokens=new Map<string,string>();private loaded?:Promise<void>;private writes=Promise.resolve();
 constructor(private readonly storage:string){}
 private load(){return this.loaded??=this.initialize();}
 private async initialize(){try{const stat=await lstat(this.storage);if(!stat.isFile()||stat.size>1024*1024)throw Error('音乐配置过大');const data=JSON.parse(await readFile(this.storage,'utf8'));this.preferences={...DEFAULT_MUSIC,...validateMusicPatch(data.preferences)};if(!Array.isArray(data.paths)||data.paths.length>MAX_TRACKS)throw Error('无效播放列表');for(const path of data.paths){try{this.paths.push(await approvedMusicPath(path));}catch{/* Missing or unsafe persisted entries are discarded. */}}}catch(error){if((error as NodeJS.ErrnoException).code!=='ENOENT'){this.paths=[];this.preferences={...DEFAULT_MUSIC};}}}
 private async snapshot():Promise<MusicSnapshot>{for(const [token,path] of this.tokens)if(!this.paths.includes(path))this.tokens.delete(token);return {preferences:{...this.preferences},tracks:this.paths.map(path=>{let id=[...this.tokens].find(([,p])=>p===path)?.[0];if(!id){id=randomUUID();this.tokens.set(id,path);}return {id,name:basename(path),url:`zhumeng-music://track/${id}`};})};}
 async read(){await this.load();await this.writes;return this.snapshot();}
 private async save(){await mkdir(dirname(this.storage),{recursive:true});const temporary=this.storage+'.'+randomUUID()+'.tmp';await writeFile(temporary,JSON.stringify({preferences:this.preferences,paths:this.paths}),'utf8');await rename(temporary,this.storage);}
 private mutate(fn:()=>Promise<void>){const result=this.writes.then(async()=>{await this.load();const oldPaths=[...this.paths],oldPreferences={...this.preferences};try{await fn();await this.save();return await this.snapshot();}catch(error){this.paths=oldPaths;this.preferences=oldPreferences;throw error;}});this.writes=result.then(()=>{},()=>{});return result;}
 patch(patch:Partial<MusicPreferences>){const valid=validateMusicPatch(patch);return this.mutate(async()=>{Object.assign(this.preferences,valid);});}
 add(paths:string[]){return this.mutate(async()=>{if(paths.length>MAX_TRACKS)throw Error('最多 300 首音乐');const approved=await Promise.all(paths.map(path=>approvedMusicPath(path)));const combined=[...new Set([...this.paths,...approved])];if(combined.length>MAX_TRACKS)throw Error('最多 300 首音乐');this.paths=combined;});}
 async addFolder(path:string){const folder=await approvedMusicPath(path,true);const entries=await readdir(folder,{withFileTypes:true});if(entries.length>2000)throw Error('目录项目过多，请选择较小目录');return this.add(entries.filter(entry=>entry.isFile()&&MUSIC_EXTENSIONS.includes(extname(entry.name).slice(1).toLowerCase())).map(entry=>join(folder,entry.name)));}
 remove(id:string){return this.mutate(async()=>{const path=this.tokens.get(id);if(!path)throw Error('音乐已不存在');this.paths=this.paths.filter(p=>p!==path);});}
 clear(){return this.mutate(async()=>{this.paths=[];});}
 async resolve(id:string){await this.load();await this.writes;const path=this.tokens.get(id);if(!path||!this.paths.includes(path))return null;try{return await approvedMusicPath(path);}catch{return null;}}
}
