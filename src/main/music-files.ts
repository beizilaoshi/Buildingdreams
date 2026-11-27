import {dialog,protocol,type BrowserWindow} from 'electron';
import {open} from 'node:fs/promises';
import {noPayload,type CommandRouter} from './ipc';
import {validateMusicPatch} from '../shared/music';
import {MusicService,MUSIC_EXTENSIONS,MUSIC_LIMIT} from './services/music';
export function registerMusicCommands(router:CommandRouter,service:MusicService,getWindow:()=>BrowserWindow|null){
 router.register('music.read',noPayload,()=>service.read());router.register('music.patch',validateMusicPatch,p=>service.patch(p));router.register('music.clear',noPayload,()=>service.clear());
 router.register('music.remove',value=>{if(typeof value!=='string'||! /^[a-f0-9-]{36}$/.test(value))throw Error('无效音乐标识');return value;},id=>service.remove(id));
 for(const folder of [false,true])router.register(folder?'music.addFolder':'music.addFiles',noPayload,async()=>{const options={title:folder?'选择音乐目录（仅当前层）':'选择背景音乐',properties:folder?['openDirectory'] as ['openDirectory']:['openFile','multiSelections'] as ['openFile','multiSelections'],filters:[{name:'音频',extensions:MUSIC_EXTENSIONS}]};const window=getWindow();const result=await(window?dialog.showOpenDialog(window,options):dialog.showOpenDialog(options));if(result.canceled)return service.read();return folder?service.addFolder(result.filePaths[0]):service.add(result.filePaths);});
}
export function registerMusicProtocol(service:MusicService){
 protocol.handle('zhumeng-music',async request=>{
  try{const url=new URL(request.url);if(url.hostname!=='track'||url.search||url.hash||request.method!=='GET')return new Response(null,{status:404});const path=await service.resolve(url.pathname.slice(1));if(!path)return new Response(null,{status:404});const file=await open(path,'r');try{const stat=await file.stat();if(!stat.isFile()||stat.size>MUSIC_LIMIT)return new Response(null,{status:413});const range=request.headers.get('Range');let start=0,end=stat.size-1;let partial=false;if(range){const match=/^bytes=(\d+)-(\d*)$/.exec(range);if(!match)return new Response(null,{status:416});start=Number(match[1]);end=match[2]?Math.min(Number(match[2]),end):end;partial=true;if(start>end||start>=stat.size)return new Response(null,{status:416});}const buffer=Buffer.alloc(end-start+1);const {bytesRead}=await file.read(buffer,0,buffer.length,start);if(bytesRead!==buffer.length)return new Response(null,{status:409});const headers:Record<string,string>={'Accept-Ranges':'bytes','Content-Length':String(buffer.length),'Content-Type':path.toLowerCase().endsWith('.mp3')?'audio/mpeg':path.toLowerCase().endsWith('.m4a')?'audio/mp4':`audio/${path.split('.').pop()?.toLowerCase()}`,'Cache-Control':'no-store'};if(partial)headers['Content-Range']=`bytes ${start}-${end}/${stat.size}`;return new Response(new Uint8Array(buffer),{status:partial?206:200,headers});}finally{await file.close();}}catch{return new Response(null,{status:404});}
 });
}
