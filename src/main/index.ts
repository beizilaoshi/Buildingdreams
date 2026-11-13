import { UpdateService } from './services/updates';
import { registerUpdateCommands } from './update-router';
import { registerAppearanceFileCommands } from "./appearance-files";
import { productPclBridge } from "./services/pcl-product";
import { registerUiCommands, installWallpaperProtocol } from "./ui-router";
import { AccountService } from "./services/accounts";
import { registerAccountCommands } from "./account-router";
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
  {
    scheme: "zhumeng-wallpaper",
    privileges: { standard: true, secure: true, supportFetchAPI: true },
  },
]);
const applicationFile = join(__dirname, "../renderer/index.html");
const applicationUrl = pathToFileURL(applicationFile).href;
let window: BrowserWindow | null = null;

async function createWindow(): Promise<void> {
  const store = new SettingsStore(
    join(app.getPath("userData"), "settings.json"),
  );
  const startupSettings = await store.read();
  const router = new CommandRouter();
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
  registerAccountCommands(router, accounts);
  const game = registerGameCommands(
    router,
    join(app.getPath("userData"), "instances.json"),
    (id, signal) => accounts.getLaunchIdentity(id, signal),
    () => store.read(),
  );
  game.install.root = (await store.read()).gameDirectory || game.install.root;
  const defaultInstallRoot = join(app.getPath("userData"), "installations");
  const providerSecrets = new ProviderSecrets(join(app.getPath("userData"), "providers.vault"), safeStorage);
  const content = registerModCommands(router, game, providerSecrets);
  registerPackCommands(router, game, content.modrinth, content.curseforge);
  registerUiCommands(router, game.instances, () => window, game.launch);
  router.register("settings.read", noPayload, () => store.read());
  router.register(
    "settings.patch",
    (value) => validateSettingsPatch(value),
    async (patch) => {
      const settings = await store.patch(patch);
      game.install.root = settings.gameDirectory || defaultInstallRoot;
      return settings;
    },
  );
  router.register("settings.reset", noPayload, async () => {
    const settings = await store.reset();
    game.install.root = defaultInstallRoot;
    return settings;
  });
  router.register("app.openDeveloper", noPayload, () =>
    shell.openExternal("https://github.com/beizilaoshi"),
  );
  router.register("app.openCommunity", noPayload, () =>
    shell.openExternal("https://qm.qq.com/q/C28ONm8EQa"),
  );
  router.register("app.copyCommunityGroup", noPayload, async () => {
    const { clipboard } = await import("electron");
    clipboard.writeText("638500178");
  });
  window = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "筑梦启动器",
    icon: join(__dirname, "../renderer/assets/logos/zhumeng-generated.png"),
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
  const contents = window.webContents;
  const unsubscribeTasks = game.tasks.onSnapshot((task) => {
    if (!contents.isDestroyed()) contents.send("launcher:task", task);
  });
  const launchState = (state: import('../shared/types').LaunchState) => { if(!contents.isDestroyed())contents.send('launcher:launch',state); };
  game.launch.events.on('state',launchState);
  game.launch.windowAction = action => { if(!window||window.isDestroyed())return; if(action==='hide')window.hide(); else if(action==='minimize')window.minimize(); else {window.show();if(window.isMinimized())window.restore();} };
  window.once('closed',()=>{game.launch.dispose();game.launch.events.off('state',launchState);});
  window.once("closed", unsubscribeTasks);
  ipcMain.removeHandler("launcher:invoke");
  ipcMain.handle(
    "launcher:invoke",
    (event, command: unknown, payload: unknown) => {
      assertTrustedSender(event, contents.id, applicationUrl);
      return router.invoke(command, payload);
    },
  );
  contents.setWindowOpenHandler(() => ({ action: "deny" }));
  contents.on("will-navigate", (event, url) => {
    if (url !== applicationUrl) event.preventDefault();
  });
  contents.on("will-attach-webview", (event) => event.preventDefault());
  window.once("ready-to-show", () => {
    if (startupSettings.startMaximized) window?.maximize();
    window?.show();
  });
  window.on("closed", () => {
    window = null;
  });
  await window.loadFile(applicationFile);
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
      await createWindow();
      app.on("activate", () => {
        if (!window) void createWindow().catch(showFailure);
      });
    })
    .catch(showFailure);
  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
}
function showFailure(error: unknown): void {
  dialog.showErrorBox(
    "筑梦启动器启动失败",
    error instanceof Error ? error.message : String(error),
  );
  app.quit();
}
