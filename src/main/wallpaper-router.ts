import {app,dialog,nativeImage,type BrowserWindow} from 'electron';
import {noPayload,type CommandRouter} from './ipc';
import {WallpaperStore} from './services/wallpaper';
import {validateRotation} from '../shared/wallpaper';
export function registerWallpaperCommands(router:CommandRouter,getWindow:()=>BrowserWindow|null){
 const store=new WallpaperStore(app.getPath('userData'),bytes=>nativeImage.createFromBuffer(bytes).getSize());
 router.register('wallpaper.rotation',noPayload,()=>store.read());
 router.register('wallpaper.configure',validateRotation,patch=>store.configure(patch));
 router.register('wallpaper.clear',noPayload,()=>store.clear());
 router.register('wallpaper.select',v=>{if(v!=='files'&&v!=='folder')throw Error('无效选择');return v;},async mode=>{const result=await dialog.showOpenDialog(getWindow()!,{title:'选择壁纸（最多100张，共200 MB）',properties:mode==='folder'?['openDirectory']:['openFile','multiSelections'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});if(result.canceled||!result.filePaths.length)return null;return store.select(mode==='folder'?await store.folder(result.filePaths[0]):result.filePaths);});
 router.register('wallpaper.titleImage',noPayload,async()=>{const result=await dialog.showOpenDialog(getWindow()!,{title:'选择标题图片（5 MB以内）',properties:['openFile'],filters:[{name:'图片',extensions:['png','jpg','jpeg','webp']}]});return result.canceled||!result.filePaths[0]?null:store.copyTitle(result.filePaths[0]);});
}
