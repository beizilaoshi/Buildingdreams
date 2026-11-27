import { dialog, type BrowserWindow } from 'electron';
import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { SETTINGS_TRANSFER_MAX_BYTES, parseSettingsTransfer, serializeSettingsTransfer, type PortableSettings } from '../shared/settings-transfer';
import { noPayload, type CommandRouter } from './ipc';
import type { SettingsStore } from './services/settings';
export function registerSettingsFileCommands(router:CommandRouter,store:Pick<SettingsStore,'read'|'restorePortable'>,getWindow:()=>BrowserWindow|null):void{
 let pending:{token:string;value:PortableSettings;expires:number;inFlight?:boolean}|undefined;
 router.register('settings.export',noPayload,async()=>{
  const text=serializeSettingsTransfer(await store.read());const win=getWindow();const options={title:'备份筑梦设置',defaultPath:'筑梦设置备份.json',filters:[{name:'筑梦设置备份',extensions:['json']}]};const result=await(win?dialog.showSaveDialog(win,options):dialog.showSaveDialog(options));if(result.canceled||!result.filePath)return null;
  const temporary=result.filePath+'.'+randomUUID()+'.tmp';try{const handle=await open(temporary,'wx',0o600);try{await handle.writeFile(text,'utf8');await handle.sync();}finally{await handle.close();}await rename(temporary,result.filePath);}finally{await rm(temporary,{force:true});}return result.filePath;
 });
 router.register('settings.importPreview',noPayload,async()=>{
  pending=undefined;const win=getWindow();const options={title:'选择筑梦设置备份',filters:[{name:'筑梦设置备份',extensions:['json']}],properties:['openFile'] as ['openFile']};const result=await(win?dialog.showOpenDialog(win,options):dialog.showOpenDialog(options));if(result.canceled||!result.filePaths[0])return null;
  const handle=await open(result.filePaths[0],'r');let text:string;try{const info=await handle.stat();if(!info.isFile()||info.size>SETTINGS_TRANSFER_MAX_BYTES)throw Error('备份文件过大或不是普通文件');const bytes=Buffer.alloc(SETTINGS_TRANSFER_MAX_BYTES+1);const {bytesRead}=await handle.read(bytes,0,bytes.length,0);if(bytesRead>SETTINGS_TRANSFER_MAX_BYTES)throw Error('备份文件过大');text=bytes.subarray(0,bytesRead).toString('utf8');}finally{await handle.close();}
  const value=parseSettingsTransfer(text);const token=randomUUID();pending={token,value,expires:Date.now()+600000};return {token,fields:Object.keys(value.settings),notes:value.notes};
 });
 router.register('settings.importApply',value=>{if(typeof value!=='string'||!/^[a-f0-9-]{36}$/.test(value))throw Error('无效设置预览');return value;},async token=>{
  const selected=pending;if(!selected||selected.token!==token||selected.expires<Date.now())throw Error('设置预览已过期，请重新选择文件');
  if(selected.inFlight)throw Error('正在恢复设置，请等待完成');selected.inFlight=true;
  try{const result=await store.restorePortable(selected.value.settings);if(pending===selected)pending=undefined;return result;}
  catch(error){if(pending===selected)selected.inFlight=false;throw error;}
 });
}
