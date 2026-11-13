import { app, dialog } from "electron";
import { join } from "node:path";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { PclBridge, privatePclRuntime } from "./pcl-bridge";

/** Dependency paths are main-owned configuration, never renderer-selected argv. */
export function productPclBridge(): PclBridge {
  const data=app.getPath("userData"), config=join(data,"pcl-dependency.json");
  const dependency=async () => {
    try {
      const value=JSON.parse(await readFile(config,"utf8"));
      if(typeof value.path === "string" && value.path.length < 32768 && !value.path.includes("\0")) return value.path;
    } catch {}
    return join(app.getPath("desktop"),"Plain Craft Launcher 2.exe");
  };
  const worker=app.isPackaged ? join(process.resourcesPath,"pcl-bridge") : join(app.getAppPath(),"tools","pcl-bridge","bin","Release");
  const bridge=new PclBridge(privatePclRuntime(join(data,"pcl-private"),worker,dependency),Date.now,async () => {
    const choice=await dialog.showOpenDialog({title:"选择受支持的 Plain Craft Launcher 2.exe",properties:["openFile"],filters:[{name:"PCL 可执行文件",extensions:["exe"]}]});
    if(choice.canceled || choice.filePaths.length !== 1) return false;
    await mkdir(data,{recursive:true});
    await writeFile(config,JSON.stringify({path:choice.filePaths[0]}),{mode:0o600});
    return true;
  });
  // Keep Electron alive until only this adapter's children have exited and cleanup completes.
  let quitting=false;
  app.on("before-quit",event=>{ if(quitting) return; event.preventDefault(); quitting=true; void bridge.dispose().finally(()=>app.quit()); });
  return bridge;
}
