import {mkdir,readFile,writeFile,rename,rm} from 'node:fs/promises';
import {dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {HOME_PRESET,homeHttps,parseHomeDocument,parseHomeJson,type HomeContentState} from '../../shared/home-content';
import {fetchHomeJson} from './home-content-network';
const empty=():HomeContentState=>({enabled:false,source:null,document:null,updatedAt:null});
export class HomeContentService {
 private queue:Promise<unknown>=Promise.resolve();
 constructor(private path:string,private fetcher=fetchHomeJson){}
 private serialize<T>(job:()=>Promise<T>):Promise<T>{const result=this.queue.then(job);this.queue=result.catch(()=>undefined);return result;}
 private async load():Promise<HomeContentState>{try{const raw=JSON.parse(await readFile(this.path,'utf8'));return {enabled:raw.enabled===true,source:raw.source===null?null:homeHttps(raw.source),document:raw.document===null?null:parseHomeDocument(raw.document),updatedAt:typeof raw.updatedAt==='string'?raw.updatedAt:null};}catch(e){if((e as NodeJS.ErrnoException).code==='ENOENT')return empty();return {...empty(),error:'主页配置损坏；已回退到原有首页，可重新导入。'};}}
 private async save(value:HomeContentState){await mkdir(dirname(this.path),{recursive:true});const temp=this.path+'.'+randomUUID()+'.tmp';try{await writeFile(temp,JSON.stringify(value,null,2),'utf8');await rename(temp,this.path);}finally{await rm(temp,{force:true});}return value;}
 read(){return this.serialize(()=>this.load());}
 enable(enabled:boolean){return this.serialize(async()=>this.save({...await this.load(),enabled}));}
 importJson(json:string){const document=parseHomeJson(json);return this.serialize(async()=>this.save({enabled:true,source:null,document,updatedAt:new Date().toISOString()}));}
 preset(){return this.importJson(JSON.stringify(HOME_PRESET));}
 remote(source:string){source=homeHttps(source);return this.serialize(async()=>this.refreshState({...await this.load(),enabled:true,source}));}
 refresh(){return this.serialize(async()=>this.refreshState(await this.load()));}
 private async refreshState(state:HomeContentState){if(!state.source)throw Error('请先配置远程 HTTPS 来源');try{const document=parseHomeJson(await this.fetcher(state.source));return await this.save({...state,document,updatedAt:new Date().toISOString(),error:undefined});}catch(e){await this.save(state);return {...state,error:`刷新失败，保留上次内容：${e instanceof Error?e.message:String(e)}`};}}
 clear(){return this.serialize(async()=>this.save({...await this.load(),document:null,updatedAt:null}));}
}
