import { UpdateService } from './services/updates';
import { registerUpdateCommands } from './update-router';
import { registerDiagnosticsCommands } from './diagnostics-router';
import { registerSettingsFileCommands } from './settings-files';
import { configureDownloadPolicy } from './services/download-scheduler';
import { configureDownloadSource } from './services/download-source';
import { MusicService } from './services/music';
import { registerMusicCommands,registerMusicProtocol } from './music-files';
import { InstallComponentService } from './services/install-components';
import { registerInstallComponentCommands } from './install-components-router';
import { registerHomeContentCommands } from './home-content-router';
import { registerWallpaperCommands } from './wallpaper-router';
import { HomeContentService } from './services/home-content';
import { LinkService } from './services/link';
import { registerLinkCommands } from './link-router';
import { registerAppearanceFileCommands } from "./appearance-files";
import { productPclBridge } from "./services/pcl-product";
import { registerUiCommands, installWallpaperProtocol } from "./ui-router";
import { AccountService } from "./services/accounts";
import { registerAccountCommands } from "./account-router";
import { registerSkinCommands } from './skin-router';
import { ExternalAccountService } from './services/external-accounts';
import { registerExternalAuthCommands } from './external-auth-router';
import { registerPackCommands } from "./pack-router";
import { ProviderSecrets } from "./services/provider-secrets";
import { registerModCommands } from "./mod-router";
import { registerGameCommands } from "./game-router";
import {
  app,
  BrowserWindow,
  ipcMain,
  session,
  shell,
  dialog,
  safeStorage,
  protocol,
  clipboard,
  nativeImage,
  screen,
} from "electron";
import { join } from "node:path";
import { readFile, writeFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { SettingsStore } from "./services/settings";
import { assertTrustedSender, CommandRouter, noPayload } from "./ipc";
import { validateSettingsPatch } from "../shared/settings";

if (process.env.ZHUMENG_DATA_DIR)
  app.setPath("userData", process.env.ZHUMENG_DATA_DIR);
protocol.registerSchemesAsPrivileged([
  {scheme:'zhumeng-music',privileges:{standard:true,secure:true,supportFetchAPI:true,stream:true}},
  {
    scheme: "zhumeng-wallpaper",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const applicationFile = join(__dirname, "../renderer/index.html");
const applicationUrl = pathToFileURL(applicationFile).href;
let window: BrowserWindow | null = null;
let startupSplash: BrowserWindow | null = null;
let startupSplashReady: Promise<BrowserWindow | null> = Promise.resolve(null);
let startupWindowPresented = false;
let musicService: MusicService;
let linkService: LinkService | undefined;
let linkShutdown=false;
let linkStopping=false;

async function createStartupSplash(iconPath: string): Promise<BrowserWindow | null> {
  const source = nativeImage.createFromPath(iconPath);
  if (source.isEmpty()) return null;
  const icon = source.resize({ width: 192, height: 192, quality: "best" }).toDataURL();
  const splash = new BrowserWindow({
    width: 240,
    height: 240,
    show: false,
    x: Math.round(screen.getPrimaryDisplay().bounds.x + (screen.getPrimaryDisplay().bounds.width - 240) / 2),
    y: Math.round(screen.getPrimaryDisplay().bounds.y + (screen.getPrimaryDisplay().bounds.height - 240) / 2),
    frame: false,
    transparent: true,
    backgroundColor: "#00000000",
    hasShadow: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    closable: true,
    focusable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    webPreferences: { nodeIntegration: false, contextIsolation: true, sandbox: true },
  });
  splash.setMenuBarVisibility(false);
  const particles = Array.from({ length: 10 }, (_, index) =>
    `<i class="particle particle-${index}" style="--angle:${index * 36}deg;--delay:${-index * .31}s"></i>`,
  ).join("");
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    *{box-sizing:border-box}html,body{width:100%;height:100%;margin:0;overflow:hidden;background:transparent}
    body{display:grid;place-items:center}.mark{position:relative;width:164px;height:164px;border-radius:34px;animation:float 2.4s ease-in-out infinite}
    .mark img{display:block;width:100%;height:100%;border-radius:inherit}.orbit{position:absolute;inset:-20px;border-radius:50%;animation:orbit 8s linear infinite}
    .particle{position:absolute;top:50%;left:50%;width:4px;height:4px;border-radius:50%;background:#c9d9ff;box-shadow:0 0 8px 2px #9cc8ff99;transform:rotate(var(--angle)) translateY(-103px);transform-origin:0 0;animation:twinkle 2.2s ease-in-out var(--delay) infinite alternate}
    .particle:nth-child(3n){width:3px;height:3px;background:#e9d7ff;box-shadow:0 0 7px 2px #c8aaff88}
    .particle:nth-child(4n){width:5px;height:5px;background:#a8e9ff;box-shadow:0 0 9px 3px #8bdcff99}
    @keyframes orbit{to{transform:rotate(360deg)}}@keyframes twinkle{from{opacity:.28;scale:.68}to{opacity:.92;scale:1.12}}
    @keyframes float{0%,100%{transform:translateY(0) scale(1)}50%{transform:translateY(-4px) scale(1.018)}}
    @media(prefers-reduced-motion:reduce){.mark,.orbit,.particle{animation:none}}
  </style></head><body><div class="mark"><div class="orbit" aria-hidden="true">${particles}</div><img src="${icon}" alt="筑梦"></div></body></html>`;
  await splash.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
  if (!splash.isDestroyed()) splash.showInactive();
  return splash;
}

function fadeWindowOpacity(target: BrowserWindow, from: number, to: number, duration: number, closeAtEnd = false): Promise<void> {
  if (target.isDestroyed()) return Promise.resolve();
  target.setOpacity(from);
  const started = Date.now();
  return new Promise(resolve => {
    const timer = setInterval(() => {
      if (target.isDestroyed()) { clearInterval(timer); resolve(); return; }
      const progress = Math.min(1, (Date.now() - started) / Math.max(1, duration));
      const eased = 1 - (1 - progress) ** 3;
      target.setOpacity(from + (to - from) * eased);
      if (progress >= 1) {
        clearInterval(timer);
        if (closeAtEnd && !target.isDestroyed()) { target.hide(); target.close(); }
        resolve();
      }
    }, 16);
    target.once("closed", () => { clearInterval(timer); resolve(); });
  });
}

async function createWindow(): Promise<void> {
  const store = new SettingsStore(
    join(app.getPath("userData"), "settings.json"),
  );
  const startupSettings = await store.read();
  startupWindowPresented = false;
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "筑梦启动器",
    icon: join(__dirname, "../renderer/assets/logos/zhumeng-mengmiao.png"),
    show: false,
    frame: false,
    backgroundColor: "#141b33",
    webPreferences: {
      preload: join(__dirname, "preload.js"),
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      webviewTag: false,
    },
  });
  window.on("closed", () => { window = null; });
  const router = new CommandRouter();
  const contents = window.webContents;
  let markRouterReady!: () => void;
  const routerReady = new Promise<void>(resolve => { markRouterReady = resolve; });
  ipcMain.removeHandler("launcher:invoke");
  ipcMain.handle("launcher:invoke", async (event, command: unknown, payload: unknown) => {
    assertTrustedSender(event, contents.id, applicationUrl);
    await routerReady;
    return router.invoke(command, payload);
  });
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => { if (url !== applicationUrl) event.preventDefault(); });
  contents.on("will-attach-webview", event => event.preventDefault());
  const mainLoad = window.loadFile(applicationFile);
  startupSplashReady = startupSettings.openingEnabled && !startupSettings.reducedMotion
    ? createStartupSplash(join(__dirname, "../renderer/assets/logos/zhumeng-mengmiao.png"))
    : Promise.resolve(null);
  app.on("before-quit", () => {
    if (startupSplash && !startupSplash.isDestroyed()) startupSplash.close();
    startupSplash = null;
  });
  configureDownloadPolicy(startupSettings);
  configureDownloadSource(startupSettings.downloadSource);
  const updates = new UpdateService(app.getVersion(), async () => (await store.read()).updateChannel);
  registerUpdateCommands(router, updates, url => shell.openExternal(url));
  if (startupSettings.checkUpdatesOnStartup) void updates.check().catch(() => undefined);
  const accounts = new AccountService(
    join(app.getPath("userData"), "accounts.vault"),
    safeStorage,
    async () => (await store.read()).microsoftClientId,
    undefined,
    undefined,
    productPclBridge(),
  );
  registerAppearanceFileCommands(router, store, () => window);
  const external=new ExternalAccountService(join(app.getPath('userData'),'external-accounts.vault'),join(app.getPath('userData'),'authlib-injector'),safeStorage);
  registerExternalAuthCommands(router,external,url=>shell.openExternal(url));
  registerAccountCommands(router, accounts, undefined, external);
  registerSkinCommands(router,accounts,()=>window);
  const game = registerGameCommands(
    router,
    join(app.getPath("userData"), "instances.json"),
    async (id, signal, policy) => {await external.assertPolicy(id,policy);return external.owns(id)?external.getLaunchIdentity(id,signal):accounts.getLaunchIdentity(id, signal);},
    () => store.read(),
  );
  const unresolvedLaunches=await game.launch.recoverPreviousLeases().catch(error=>{
    dialog.showErrorBox('无法自动核对游戏进程',`筑梦会保留相关实例的安全保护。\n${error instanceof Error?error.message:String(error)}`);
    return [] as Array<{id:string;name:string;attempt:string;reason:string}>;
  });
  for(const initialLease of unresolvedLaunches){
    let lease=initialLease;
    if(lease.reason==='此实例正由当前启动器启动或运行'){
      await dialog.showMessageBox({type:'info',title:'游戏仍在运行',message:`实例“${lease.name}”仍由当前启动器保护。`,detail:'游戏关闭后会自动解除保护。',buttons:['知道了'],noLink:true});
      continue;
    }
    while(true){
      const choice=await dialog.showMessageBox({
        type:'warning',
        title:'存在未解决的游戏启动记录',
        message:`实例“${lease.name}”的运行状态无法自动确认。`,
        detail:`${lease.reason}\n\n如果游戏仍在运行，请保留保护。只有确认相关游戏已完全关闭后，才解除这条记录。`,
        buttons:['保留保护','重新检查','我确认游戏已关闭，解除保护'],
        defaultId:0,
        cancelId:0,
        noLink:true,
      });
      if(choice.response===0)break;
      if(choice.response===1){
        const refreshed=await game.launch.recoverPreviousLeases().catch(()=>[]);
        const same=refreshed.find(item=>item.id===lease.id&&item.attempt===lease.attempt);
        if(!same)break;
        lease=same;
        continue;
      }
      try{await game.instances.confirmReleaseLease(lease.id,lease.attempt);}
      catch(error){dialog.showErrorBox('无法解除启动记录',error instanceof Error?error.message:String(error));}
      break;
    }
  }
  game.install.root = (await store.read()).gameDirectory || game.install.root;
  registerInstallComponentCommands(router,new InstallComponentService(game.install,game.java,async()=>{const s=await store.read();return {javaPath:s.javaPath,autoDownloadJava:s.autoDownloadJava};}),async query=>{
    if(!window||window.isDestroyed())return null;
    const prefix=query.kind==='server'?'minecraft-server':`${query.kind}-installer`;
    const result=await dialog.showSaveDialog(window,{title:'选择安装器保存位置',defaultPath:join(app.getPath('downloads'),`${prefix}-${query.minecraft}-${query.version}.jar`),filters:[{name:'Java 文件',extensions:['jar']}],properties:['showOverwriteConfirmation']});
    return result.canceled?null:result.filePath??null;
  });
  const defaultInstallRoot = join(app.getPath("userData"), "installations");
  const providerSecrets = new ProviderSecrets(join(app.getPath("userData"), "providers.vault"), safeStorage);
  const content = registerModCommands(router, game, providerSecrets);
  registerPackCommands(router, game, content.modrinth, content.curseforge);
  registerUiCommands(router, game.instances, () => window, game.launch);
  registerMusicCommands(router,musicService,()=>window);
  registerLinkCommands(router,linkService!,{
    chooseBinary:async()=>{if(!window)return null;const r=await dialog.showOpenDialog(window,{title:'选择官方 EasyTier 组件',properties:['openFile'],filters:[{name:'EasyTier 可执行组件',extensions:['exe']}]});return r.canceled?null:r.filePaths[0]??null;},
    copy:text=>{clipboard.writeText(text);},
  });
  registerHomeContentCommands(router,new HomeContentService(join(app.getPath('userData'),'home-content.json')),()=>window);
  registerWallpaperCommands(router,()=>window);
  registerSettingsFileCommands(router, {read:()=>store.read(),restorePortable:async patch=>{const settings=await store.restorePortable(patch);configureDownloadPolicy(settings);configureDownloadSource(settings.downloadSource);return settings;}}, () => window);
  registerDiagnosticsCommands(router, {
    gameDirectory: async id => (await game.instances.get(id)).gameDir,
    sessionLog: id => game.launch.logs(id).map(x => x.text ?? (x.type === 'exit' ? `退出码 ${x.code}` : x.type)).join('\n'),
    chooseImport: async () => { const r=await dialog.showOpenDialog(window!,{title:'导入游戏日志',properties:['openFile'],filters:[{name:'游戏日志',extensions:['log','txt']}]});return r.canceled?null:r.filePaths[0]??null; },
    chooseExport: async () => { const r=await dialog.showSaveDialog(window!,{title:'导出脱敏诊断报告',defaultPath:'筑梦-游戏诊断.json',filters:[{name:'JSON 诊断报告',extensions:['json']}],properties:['showOverwriteConfirmation']});return r.canceled?null:r.filePath??null; },
    copy: text => clipboard.writeText(text),
  });
  router.register("settings.read", noPayload, () => store.read());
  router.register(
    "settings.patch",
    (value) => validateSettingsPatch(value),
    async (patch) => {
      const settings = await store.patch(patch);
      configureDownloadPolicy(settings);
      configureDownloadSource(settings.downloadSource);
      game.install.root = settings.gameDirectory || defaultInstallRoot;
      return settings;
    },
  );
  router.register("settings.reset", noPayload, async () => {
    const settings = await store.reset();
    configureDownloadPolicy(settings);
    configureDownloadSource(settings.downloadSource);
    game.install.root = defaultInstallRoot;
    return settings;
  });
  router.register("app.openDeveloper", noPayload, () =>
    shell.openExternal("https://github.com/beizilaoshi"),
  );
  router.register("app.openCommunity", noPayload, () =>
    shell.openExternal("https://qm.qq.com/q/C28ONm8EQa"),
  );
  router.register('app.openFeedback', noPayload, () => shell.openExternal('https://github.com/beizilaoshi/Buildingdreams/issues'));
  router.register('app.copySupportInfo', noPayload, async () => { const {clipboard}=await import('electron'); clipboard.writeText(`筑梦启动器 ${app.getVersion()}\n系统 ${process.platform} ${process.arch}\nElectron ${process.versions.electron}\nChromium ${process.versions.chrome}\nNode ${process.versions.node}`); });
  router.register("app.copyCommunityGroup", noPayload, async () => {
    const { clipboard } = await import("electron");
    clipboard.writeText("638500178");
  });
  router.register("window.ready", (value) => {
    if (typeof value !== "boolean") throw new Error("无效窗口就绪状态");
    return value;
  }, async animate => {
    if (startupWindowPresented) return;
    startupWindowPresented = true;
    const mainWindow = window;
    if (!mainWindow || mainWindow.isDestroyed()) return;
    const splash = startupSplash ?? await startupSplashReady;
    startupSplash = null;
    if (startupSettings.startMaximized) mainWindow.maximize();
    const speed = Math.max(.0625, Math.min(16, startupSettings.openingSpeed * startupSettings.animationSpeed || 1));
    const duration = animate && splash ? Math.max(1, 400 / speed) : 0;
    if (duration && splash && !splash.isDestroyed()) {
      // Keep the launcher hidden until the centered logo has completely faded away.
      await fadeWindowOpacity(splash, 1, 0, duration, true);
      mainWindow.setOpacity(0);
      mainWindow.show();
      mainWindow.focus();
      void fadeWindowOpacity(mainWindow, 0, 1, Math.max(180, 440 / speed));
    } else {
      if (splash && !splash.isDestroyed()) splash.close();
      mainWindow.show();
      mainWindow.focus();
    }
  });
  const unsubscribeTasks = game.tasks.onSnapshot((task) => {
    if (!contents.isDestroyed()) contents.send("launcher:task", task);
  });
  const launchState = (state: import('../shared/types').LaunchState) => { if(!contents.isDestroyed())contents.send('launcher:launch',state); };
  game.launch.events.on('state',launchState);
  game.launch.windowAction = action => { if(action==='exit'){app.quit();return;} if(!window||window.isDestroyed())return; if(action==='hide')window.hide(); else if(action==='minimize')window.minimize(); else {window.show();if(window.isMinimized())window.restore();} };
  window.once('closed',()=>{game.launch.dispose();game.launch.events.off('state',launchState);});
  window.once("closed", unsubscribeTasks);
  startupSplash = await startupSplashReady;
  markRouterReady();
  await mainLoad;
  const notices = join(app.getPath("userData"), "notices-seen.json");
  const seen = await readFile(notices, "utf8")
    .then((raw) => Boolean(JSON.parse(raw).betaNotice))
    .catch(() => false);
  if (!seen) {
    // Renderer subscriptions attach during init; wait for the boot class to clear so the notice is not clipped by the opening.
    setTimeout(() => {
      if (!contents.isDestroyed())
        contents.send("launcher:notice", {
          title: "内部测试版",
          message:
            "当前为内部测试版本，可能仍有 BUG，敬请见谅。欢迎加入 QQ 群 638500178 反馈问题。",
          community: "https://qm.qq.com/q/C28ONm8EQa",
          group: "638500178",
        });
    }, 9000);
    await writeFile(notices, JSON.stringify({ betaNotice: true })).catch(
      () => undefined,
    );
  }
}

if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    window?.restore();
    window?.focus();
  });
  app
    .whenReady()
    .then(async () => {
      session.defaultSession.setPermissionRequestHandler(
        (_contents, _permission, callback) => callback(false),
      );
      session.defaultSession.setPermissionCheckHandler(() => false);
      installWallpaperProtocol();
      musicService=new MusicService(join(app.getPath('userData'),'music.json'));
      linkService=new LinkService(join(app.getPath('userData'),'link.json'));
      registerMusicProtocol(musicService);
      await createWindow();
      app.on("activate", () => {
        if (!window) void createWindow().catch(showFailure);
      });
    })
    .catch(showFailure);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on('before-quit',event=>{
    if(!linkService||linkShutdown)return;
    event.preventDefault();
    if(linkStopping)return;linkStopping=true;
    const service=linkService;
    void service.leave().then(()=>{linkShutdown=true;app.quit();},error=>{linkStopping=false;dialog.showErrorBox('无法结束联机',error instanceof Error?error.message:String(error));});
  });
}
function showFailure(error: unknown): void {
  dialog.showErrorBox(
    "筑梦启动器启动失败",
    error instanceof Error ? error.message : String(error),
  );
  app.quit();
}
