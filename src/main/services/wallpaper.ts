import {mkdir,readFile,writeFile,rename,lstat,readdir} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {DEFAULT_ROTATION,validateRotation,type WallpaperRotation,type RotationPatch} from '../../shared/wallpaper';
export class WallpaperStore {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private root:string,private dimensions:(bytes:Buffer)=>{width:number;height:number}){}
 private serial<T>(job:()=>Promise<T>):Promise<T>{const next=this.queue.then(job);this.queue=next.catch(()=>{});return next;}
 async read():Promise<WallpaperRotation>{try{const data=JSON.parse(await readFile(join(this.root,'wallpaper-rotation.json'),'utf8'));const {images,...patch}=data;const valid=validateRotation(patch);if(!Array.isArray(images)||images.length>100||images.some(x=>typeof x!=='string'||!/^zhumeng-wallpaper:\/\/local\/[0-9a-f-]{36}\.(png|jpe?g|webp)$/.test(x)))throw Error('无效图片列表');return {...DEFAULT_ROTATION,...valid,images};}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return structuredClone(DEFAULT_ROTATION);throw Error('壁纸轮换配置读取失败，请清空列表后重新选择');}}
 private async write(config:WallpaperRotation){await mkdir(this.root,{recursive:true});const file=join(this.root,'wallpaper-rotation.json'),temp=file+'.'+randomUUID()+'.tmp';await writeFile(temp,JSON.stringify(config));await rename(temp,file);return config;}
 configure(patch:RotationPatch){const valid=validateRotation(patch);return this.serial(async()=>this.write({...await this.read(),...valid}));}
 clear(){return this.serial(()=>this.write(structuredClone(DEFAULT_ROTATION)));}
 async folder(path:string){const entries=await readdir(path,{withFileTypes:true});return entries.filter(x=>x.isFile()&&/^\.(png|jpe?g|webp)$/i.test(extname(x.name))).sort((a,b)=>a.name.localeCompare(b.name,'zh-CN',{numeric:true})).map(x=>join(path,x.name));}
 private async validated(path:string,title=false){const info=await lstat(path);if(!info.isFile()||info.size>(title?5:30)*1024*1024||!/^\.(png|jpe?g|webp)$/i.test(extname(path)))throw Error('图片格式或大小不符合限制');const bytes=await readFile(path);if(bytes.length>(title?5:30)*1024*1024)throw Error('图片过大');const size=this.dimensions(bytes);if(size.width<1||size.height<1||size.width>8192||size.height>8192||size.width*size.height>32_000_000)throw Error('图片尺寸过大或无法解码');return bytes;}
 async copyTitle(path:string){const bytes=await this.validated(path,true);return this.copy(path,bytes);}
 private async copy(path:string,bytes:Buffer){const name=randomUUID()+extname(path).toLowerCase();await mkdir(join(this.root,'wallpapers'),{recursive:true});await writeFile(join(this.root,'wallpapers',name),bytes,{flag:'wx'});return 'zhumeng-wallpaper://local/'+name;}
 select(paths:string[]){return this.serial(async()=>{if(!paths.length||paths.length>100)throw Error('请选择1–100张图片');const buffers:Buffer[]=[];let total=0;for(const path of paths){const bytes=await this.validated(path);total+=bytes.length;if(total>200*1024*1024)throw Error('图片总大小不得超过200 MB');buffers.push(bytes);}const images:string[]=[];for(let i=0;i<paths.length;i++)images.push(await this.copy(paths[i],buffers[i]));return this.write({...await this.read(),images,enabled:true});});}
}
