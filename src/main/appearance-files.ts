import { dialog, type BrowserWindow } from 'electron';
import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { APPEARANCE_MAX_BYTES, parseAppearance, serializeAppearance } from '../shared/appearance';
import { noPayload, type CommandRouter } from './ipc';
import type { SettingsStore } from './services/settings';
export function registerAppearanceFileCommands(router: CommandRouter, store: Pick<SettingsStore,'read'>, getWindow:()=>BrowserWindow|null): void {
  const filters=[{name:'筑梦外观 JSON',extensions:['json']}];
  router.register('appearance.export',noPayload,async()=>{
    const window=getWindow();
    const options={title:'导出外观方案',defaultPath:'筑梦外观.json',filters};
    const result=await (window?dialog.showSaveDialog(window,options):dialog.showSaveDialog(options));
    if(result.canceled||!result.filePath)return null;
    const text=serializeAppearance(await store.read());
    const temporary=`${result.filePath}.${randomUUID()}.tmp`;
    const handle=await open(temporary,'wx',0o600);
    try {
      try { await handle.writeFile(text,'utf8'); await handle.sync(); }
      finally { await handle.close(); }
      await rename(temporary,result.filePath);
    } finally { await rm(temporary,{force:true}); }
    return result.filePath;
  });
  router.register('appearance.import',noPayload,async()=>{
    const window=getWindow();
    const options={title:'导入外观方案',properties:['openFile'] as ['openFile'],filters};
    const result=await (window?dialog.showOpenDialog(window,options):dialog.showOpenDialog(options));
    if(result.canceled||!result.filePaths[0])return null;
    const handle=await open(result.filePaths[0],'r');
    try{
      const info=await handle.stat();
      if(!info.isFile()||info.size>APPEARANCE_MAX_BYTES)throw Error('外观文件过大或不是普通文件');
      // A bounded read also handles a file growing after stat.
      const buffer=Buffer.alloc(APPEARANCE_MAX_BYTES+1);
      const {bytesRead}=await handle.read(buffer,0,buffer.length,0);
      if(bytesRead>APPEARANCE_MAX_BYTES)throw Error('外观文件过大');
      return parseAppearance(buffer.subarray(0,bytesRead).toString('utf8'));
    }finally{await handle.close();}
  });
}
