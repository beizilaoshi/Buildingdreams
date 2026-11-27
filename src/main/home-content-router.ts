import {dialog,shell,type BrowserWindow} from 'electron';
import {open} from 'node:fs/promises';
import {CommandRouter,noPayload} from './ipc';
import {HomeContentService} from './services/home-content';
import {homeHttps} from '../shared/home-content';
import {validateHomePublicUrl} from './services/home-content-network';
export function registerHomeContentCommands(router:CommandRouter,service:HomeContentService,window:()=>BrowserWindow|null){
 router.register('homeContent.read',noPayload,()=>service.read());
 router.register('homeContent.preset',noPayload,()=>service.preset());
 router.register('homeContent.refresh',noPayload,()=>service.refresh());
 router.register('homeContent.clear',noPayload,()=>service.clear());
 router.register('homeContent.enable',v=>{if(typeof v!=='boolean')throw Error('无效启用状态');return v;},v=>service.enable(v));
 router.register('homeContent.remote',homeHttps,v=>service.remote(v));
 router.register('homeContent.import',noPayload,async()=>{const parent=window();if(!parent)throw Error('窗口不可用');const result=await dialog.showOpenDialog(parent,{title:'导入受限主页 JSON（不执行 XAML）',properties:['openFile'],filters:[{name:'JSON 主页',extensions:['json']}]});if(result.canceled)return null;const file=await open(result.filePaths[0],'r');try{if(!(await file.stat()).isFile()||(await file.stat()).size>65536)throw Error('主页文件必须小于 64 KiB');const buffer=Buffer.alloc(65537);const {bytesRead}=await file.read(buffer,0,buffer.length,0);if(bytesRead>65536)throw Error('主页文件过大');return await service.importJson(buffer.subarray(0,bytesRead).toString('utf8'));}finally{await file.close();}});
 router.register('homeContent.openExternal',homeHttps,async v=>{await validateHomePublicUrl(v);await shell.openExternal(v);});
}
