import type { LaunchService } from "./services/launch";
import { copyInstanceIcon, instanceIcon } from './services/instance-icons';
import { safeDestination } from './services/network';
import { canonicalRoot } from './services/instance-maintenance';
import { publishLaunchScript } from "./services/launch-export";
import { rememberModSelection } from "./services/mod-selection";
import { app, BrowserWindow, dialog, shell, protocol, net } from "electron";
import { copyFile, mkdir, stat, readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { randomUUID } from "node:crypto";
import { pathToFileURL } from "node:url";
import { noPayload, type CommandRouter } from "./ipc";
import type { InstanceService } from "./services/instances";
const purposes = [
  "wallpaper",
  "java",
  "game",
  "mod",
  "pack",
  "supplied",
  "export",
] as const;
export function registerUiCommands(
  router: CommandRouter,
  instances: InstanceService,
  getWindow: () => BrowserWindow | null,
  launch?: LaunchService,
) {
  const instanceId=(value:unknown)=>{if(typeof value!=='string'||!value||value.length>200)throw Error('无效实例');return value;};
  router.register('instances.chooseIcon',instanceId,async id=>{
    await instances.get(id);
    const selection=await dialog.showOpenDialog(getWindow()!,{title:'选择 PNG 图标（2 MB、1024 像素以内）',properties:['openFile'],filters:[{name:'PNG 图标',extensions:['png']}]});
    if(selection.canceled||!selection.filePaths[0])return null;
    const icon=await copyInstanceIcon(join(app.getPath('userData'),'instance-icons'),selection.filePaths[0]);return instances.setIcon(id,icon);
  });
  router.register('instances.icon',instanceId,async id=>{const item=await instances.get(id);return item.icon?instanceIcon(join(app.getPath('userData'),'instance-icons'),item.icon):null;});
  router.register('instances.openFolder',value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效目录');const d=value as Record<string,unknown>;
    if(Object.keys(d).some(k=>!['id','folder'].includes(k))||!['root','mods','saves','resourcepacks','screenshots'].includes(String(d.folder)))throw Error('无效目录类型');
    return {id:instanceId(d.id),folder:d.folder as 'root'|'mods'|'saves'|'resourcepacks'|'screenshots'};
  },async d=>{const item=await instances.get(d.id),root=await canonicalRoot(item.gameDir);const path=d.folder==='root'?root:await safeDestination(root,d.folder);await mkdir(path,{recursive:true});const error=await shell.openPath(path);if(error)throw Error(error);});
  router.register('launch.export', value=>{
    if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效导出参数');
    const data=value as Record<string,unknown>;
    if(Object.keys(data).some(k=>!['instanceId','environment'].includes(k))||typeof data.instanceId!=='string'||!data.instanceId||data.instanceId.length>4096||typeof data.environment!=='boolean')throw Error('无效导出参数');
    return {instanceId:data.instanceId,environment:data.environment};
  },async data=>{
    if(!launch)throw Error('启动服务未连接');
    const script=await launch.exportScript(data.instanceId,data.environment);
    const result=await dialog.showSaveDialog(getWindow()!,{title:'导出脱敏启动脚本',defaultPath:'启动游戏.ps1',filters:[{name:'PowerShell',extensions:['ps1']}],properties:['showOverwriteConfirmation']});
    if(result.canceled||!result.filePath)return null;
    return publishLaunchScript(result.filePath,script);
  });
  router.register(
    "window.action",
    (value) => {
      if (!["minimize", "maximize", "close"].includes(String(value)))
        throw new Error("无效窗口操作");
      return value as "minimize" | "maximize" | "close";
    },
    async (action) => {
      const win = getWindow();
      if (action === "close") win?.close();
      else if (action === "minimize") win?.minimize();
      else if (win?.isMaximized()) win.unmaximize();
      else win?.maximize();
    },
  );
  router.register("dialog.chooseMods", noPayload, async () => {
    const result = await dialog.showOpenDialog(getWindow()!, {title:"选择本地 Mod（最多 200 个）",properties:["openFile","multiSelections"],filters:[{name:"Mod",extensions:["jar"]}]});
    return result.canceled || !result.filePaths.length ? null : rememberModSelection(result.filePaths);
  });
  router.register(
    "dialog.choose",
    (value) => {
      if (!purposes.includes(value as any)) throw new Error("无效文件选择");
      return value as (typeof purposes)[number];
    },
    async (purpose) => {
      if (purpose === "export") {
        const result = await dialog.showSaveDialog(getWindow()!, {
          title: "导出整合包",
          defaultPath: "筑梦整合包.mrpack",
          filters: [{ name: "Modrinth 整合包", extensions: ["mrpack"] }],
        });
        return result.canceled ? null : (result.filePath ?? null);
      }
      const filters =
        purpose === "wallpaper"
          ? [{ name: "壁纸", extensions: ["png", "jpg", "jpeg", "webp"] }]
          : purpose === "java"
            ? [{ name: "Java", extensions: ["exe"] }]
            : purpose === "mod"
              ? [{ name: "Mod", extensions: ["jar"] }]
              : purpose === "pack"
                ? [{ name: "整合包", extensions: ["mrpack", "zip"] }]
                : [{ name: "文件", extensions: ["jar", "zip"] }];
      const result = await dialog.showOpenDialog(getWindow()!, {
        title: "选择文件",
        properties: [purpose === "game" ? "openDirectory" : "openFile"],
        filters,
      });
      if (result.canceled || !result.filePaths[0]) return null;
      const file = result.filePaths[0];
      if (purpose !== "wallpaper") return file;
      const info = await stat(file);
      if (
        !info.isFile() ||
        info.size > 30 * 1024 * 1024 ||
        !/^\.(png|jpe?g|webp)$/i.test(extname(file))
      )
        throw new Error("请选择 30 MB 以内的图片");
      const name = randomUUID() + extname(file).toLowerCase();
      const root = join(app.getPath("userData"), "wallpapers");
      await mkdir(root, { recursive: true });
      await copyFile(file, join(root, name));
      return "zhumeng-wallpaper://local/" + name;
    },
  );
  router.register(
    "app.openInstance",
    (value) => {
      if (typeof value !== "string" || value.length > 200)
        throw new Error("无效实例");
      return value;
    },
    async (id) => {
      const instance = await instances.get(id);
      const error = await shell.openPath(instance.gameDir);
      if (error) throw new Error(error);
    },
  );
  router.register(
    "app.openVerification",
    (value) => {
      if (typeof value !== "string") throw new Error("无效网址");
      const url = new URL(value);
      if (
        url.protocol !== "https:" ||
        ![
          "www.microsoft.com",
          "microsoft.com",
          "login.microsoftonline.com",
        ].includes(url.hostname) ||
        url.username ||
        url.password
      )
        throw new Error("不允许的验证网址");
      return url.href;
    },
    async (url) => {
      await shell.openExternal(url);
    },
  );
  router.register("app.licenses", noPayload, async () =>
    readFile(join(__dirname, "../renderer/licenses.txt"), "utf8"),
  );
}
export function installWallpaperProtocol() {
  protocol.handle("zhumeng-wallpaper", (request) => {
    const url = new URL(request.url);
    const name = url.pathname.slice(1);
    if (
      url.hostname !== "local" ||
      !/^[0-9a-f-]{36}\.(png|jpe?g|webp)$/i.test(name)
    )
      return new Response("", { status: 403 });
    return net.fetch(
      pathToFileURL(join(app.getPath("userData"), "wallpapers", name)).href,
    );
  });
}
