import type { LaunchSettings } from "./launch-settings";
import type { MinecraftCatalog } from "./minecraft-versions";
import type {
  ContentFilter,
  SearchPage,
  ContentVersion,
  LocalMod,
  ModUpdate,
  ModBatchAction, ModBatchItem, ModBatchResult, ModUpdateCheck,
} from "./content";
export type UpdateChannel = 'preview' | 'stable';
export interface UpdateStatus { currentVersion:string; channel:UpdateChannel; state:'idle'|'checking'|'current'|'available'|'error'; latest?:{version:string;releaseUrl:string;downloadUrl?:string}; checkedAt?:number; error?:string; }
export interface Settings {
  checkUpdatesOnStartup: boolean;
  updateChannel: UpdateChannel;
  backgroundAnimation: "off" | "ambient" | "interactive";
  backgroundMotionIntensity: number;
  backgroundMotionSpeed: number;
  backgroundEffect: "auto" | "petals" | "stars" | "none";
  backgroundQuality: "low" | "balanced" | "high";
  backgroundStyle: "image" | "gradient" | "solid";
  backgroundColor: string;
  gradientColor: string;
  backgroundOverlay: number;
  backgroundVignette: number;
  wallpaperSaturation: number;
  wallpaperPositionX: number;
  wallpaperPositionY: number;
  wallpaperScale: number;
  glassStyle: "frosted" | "clear" | "solid";
  glassBorderOpacity: number;
  glassShadow: number;
  fontFamily: "system" | "yahei" | "segoe";
  fontScale: number;
  navWidth: number;
  contentWidth: number;
  cardSpacing: number;
  homeTitle: string;
  homeSubtitle: string;
  homeTitleSize: number;
  homeTextAlign: "left" | "center";
  showHomeIntro: boolean;
  pageTransition: "slide" | "fade" | "none";
  notificationPosition: "top-right" | "bottom-right";
  startupPage: "home" | "library" | "download";
  startMaximized: boolean;
  notifyTaskCompletion: boolean;
  notifyTaskFailure: boolean;
  appearanceProfiles: AppearanceProfile[];
  launch: LaunchSettings;
  theme: "light" | "dark" | "system";
  wallpaper: string;
  wallpaperFit: "cover" | "contain" | "stretch";
  wallpaperBrightness: number;
  wallpaperBlur: number;
  glassOpacity: number;
  glassBlur: number;
  glassRefraction: number;
  accentColor: string;
  cornerRadius: number;
  density: "compact" | "comfortable";
  navigationLabels: boolean;
  libraryView: "cards" | "list";
  openingTheme: "dream" | "aurora" | "minimal";
  openingSpeed: number;
  openingEnabled: boolean;
  particles: boolean;
  parallax: boolean;
  animationSpeed: number;
  reducedMotion: boolean;
  javaPath: string;
  autoDownloadJava: boolean;
  memoryMb: number;
  javaArgs: string[];
  gameDirectory: string;
  microsoftClientId: string;
}
export interface AppearanceProfile { id: string; name: string; settings: Partial<Settings>; }
export type LoaderKind = "fabric" | "quilt" | "forge" | "neoforge";
export interface LoaderVersion {
  version: string;
  stable: boolean;
}
export interface JavaRuntime {
  path: string;
  version: string;
  major: number;
  arch: string;
}
export type JavaContext =
  | { instanceId: string }
  | { minecraft: string; loader?: { kind: LoaderKind; version: string } }
  | { family: 8 | 16 | 17 | 21 | 25 };
export interface JavaPlan {
  requirement: import("./java-requirements").JavaRequirement;
  detected: JavaRuntime[];
  selected?: JavaRuntime;
  mode: "auto" | "manual";
  autoDownload: boolean;
  reason: string;
  error?: string;
}
export interface LaunchEvent {
  instanceId: string;
  type: "log" | "exit" | "error";
  time: number;
  source?: "stdout" | "stderr";
  text?: string;
  code?: number | null;
  signal?: string | null;
}
export interface LaunchState {
  instanceId: string; phase: "idle" | "preparing" | "running" | "stopping" | "exited" | "failed" | "cancelled";
  gameReady?: boolean; readinessSource?: 'window' | 'graphics-log';
  windowReady?: boolean;
  pid?: number; code?: number | null; signal?: string | null; error?: string; time: number;
}
export interface Instance {
  description?: string;
  category?: string;
  favorite?: boolean;
  /** Managed PNG basename, never an arbitrary URI. */
  icon?: string;
  launch?: Partial<LaunchSettings>;
  versionId: string;
  resourceDir: string;
  status: "ready" | "invalid";
  error?: string;
  id: string;
  name: string;
  gameDir: string;
  minecraft: string;
  loader?: { kind: LoaderKind; version: string };
  memoryMb: number;
  javaArgs: string[];
  javaPath?: string;
}
export interface GameDirectory { id: string; path: string; name: string }
export interface InstanceDeletePlan { token: string; instanceId: string; paths: string[]; expires: number }
export interface InstanceComponents { minecraft: string; components: string[] }
export interface AccountSummary {
  id: string;
  name: string;
  kind: "local" | "microsoft";
  status: "ready" | "expired" | "unlicensed";
  uuid: string;
}
export type AccountAppearance =
  | { accountId: string; source: "official"; png: string }
  | {
      accountId: string;
      source: "default";
      reason: "local" | "missing" | "unavailable";
    };
export interface DeviceLogin {
  provider?: "pcl";
  loginId: string;
  userCode: string;
  verificationUri: string;
  expiresAt: number;
  interval: number;
}
export type DevicePoll =
  | { status: "pending"; interval: number; stage?: "preparing" | "authenticating" | "waiting" | "reconnecting"; device?: DeviceLogin }
  | { status: "failed"; code: string }
  | { status: "completed"; account: AccountSummary }
  | { status: "expired" | "cancelled" | "declined" | "unlicensed" };
export interface TaskSnapshot {
  id: string;
  label: string;
  status: "queued" | "running" | "completed" | "failed" | "cancelled";
  progress: number;
  bytesPerSecond: number;
  error?: string;
}
/** Extend this map and register a runtime validator when adding a capability. */
export interface CommandMap {
  "appearance.export": { payload: undefined; result: string | null };
  "appearance.import": { payload: undefined; result: Partial<Settings> | null };
  "window.action": { payload: "minimize" | "maximize" | "close"; result: void };
  "dialog.choose": {
    payload:
      "wallpaper" | "java" | "game" | "mod" | "pack" | "supplied" | "export";
    result: string | null;
  };
  "app.openInstance": { payload: string; result: void };
  "app.openVerification": { payload: string; result: void };
  "updates.status": { payload: undefined; result: UpdateStatus };
  "updates.check": { payload: undefined; result: UpdateStatus };
  "updates.open": { payload: "release" | "download"; result: void };
  "app.licenses": { payload: undefined; result: string };
  "accounts.choosePcl": { payload: undefined; result: boolean };
  "accounts.list": { payload: undefined; result: AccountSummary[] };
  "accounts.appearance": { payload: string; result: AccountAppearance };
  "accounts.addLocal": { payload: string; result: AccountSummary };
  "accounts.renameLocal": { payload: { id: string; name: string }; result: AccountSummary };
  "accounts.copyUserCode": { payload: string; result: void };
  "accounts.beginMicrosoftLogin": { payload: undefined; result: DeviceLogin };
  "accounts.pollMicrosoftLogin": { payload: string; result: DevicePoll };
  "accounts.cancelMicrosoftLogin": { payload: string; result: void };
  "accounts.remove": { payload: string; result: void };
  "packs.hashSupplied": { payload: string; result: string };
  "packs.inspect": { payload: string; result: import("./packs").PackPreview };
  "packs.install": {
    payload: {
      file: string;
      name: string;
      options?: import("./packs").PackInstallOptions;
    };
    result: string;
  };
  "packs.installModrinth": {
    payload: {
      versionId: string;
      name: string;
      options?: import("./packs").PackInstallOptions;
    };
    result: string;
  };
  "packs.export": {
    payload: {
      instanceId: string;
      destination: string;
      options?: import("./packs").PackExportOptions;
    };
    result: string;
  };
  "packs.previewExport": {
    payload: string;
    result: import("./packs").PackExportPreview;
  };
  "content.providerStatus": {
    payload: undefined;
    result: {
      configured: boolean;
      session: boolean;
      persisted: boolean;
      encryption: boolean;
    };
  };
  "content.setProviderKey": {
    payload: { provider: "curseforge"; key: string; remember: boolean };
    result: {
      configured: boolean;
      session: boolean;
      persisted: boolean;
      encryption: boolean;
    };
  };
  "content.clearProviderKey": {
    payload: { provider: "curseforge" };
    result: {
      configured: boolean;
      session: boolean;
      persisted: boolean;
      encryption: boolean;
    };
  };
  "packs.installOnline": {
    payload: {
      projectId: string;
      versionId: string;
      filename: string;
      name: string;
    };
    result: string;
  };
  "content.worlds": {
    payload: { instanceId: string };
    result: import("./content").ContentWorld[];
  };
  "content.installResource": {
    payload: import("./content").ResourceInstall;
    result: string;
  };
  "content.search": {
    payload: { query: string; filter: ContentFilter };
    result: SearchPage;
  };
  "content.project": {
    payload: { projectId: string };
    result: import("./content").ContentProject;
  };
  "content.version": { payload: { versionId: string }; result: ContentVersion };
  "content.saveVersion": {
    payload: { projectId: string; versionId: string; filename: string };
    result: string | null;
  };
  "content.openProject": {
    payload: {
      projectId: string;
      link: "website" | "source_url" | "issues_url" | "wiki_url";
    };
    result: void;
  };
  "content.openFilePage": {
    payload: { versionId: string; filename: string };
    result: void;
  };
  "content.copyName": { payload: { projectId: string }; result: void };
  "content.versions": {
    payload: { projectId: string; filter: ContentFilter };
    result: ContentVersion[];
  };
  "mods.install": {
    payload: { instanceId: string; versionId: string };
    result: string;
  };
  "mods.update": {
    payload: { instanceId: string; versionId: string };
    result: string;
  };
  "dialog.chooseMods": {payload: undefined; result: {selectionId:string; names:string[]} | null};
  "mods.importMany": {payload:{instanceId:string;selectionId:string};result:ModBatchResult[]};
  "mods.batch": {payload:{instanceId:string;action:Exclude<ModBatchAction,"update">;items:ModBatchItem[]};result:ModBatchResult[]};
  "mods.batchUpdate": {payload:{instanceId:string;items:ModBatchItem[]};result:string};
  "mods.batchResult": {payload:string;result:ModBatchResult[] | null};
  "mods.checkUpdatesDetailed": {payload:string;result:ModUpdateCheck};
  "mods.list": { payload: string; result: LocalMod[] };
  "mods.checkUpdates": { payload: string; result: ModUpdate[] };
  "mods.import": {
    payload: { instanceId: string; path: string };
    result: void;
  };
  "mods.remove": {
    payload: { instanceId: string; fileName: string };
    result: void;
  };
  "mods.toggle": {
    payload: { instanceId: string; fileName: string; enabled: boolean };
    result: void;
  };
  "tasks.list": { payload: undefined; result: TaskSnapshot[] };
  "tasks.cancel": { payload: string; result: void };
  "tasks.retry": { payload: string; result: string };
  "install.catalog": { payload: undefined; result: MinecraftCatalog };
  "install.versions": {
    payload: undefined;
    result: { id: string; url: string; type?: string }[];
  };
  "install.preview": { payload: { name: string; root?: string }; result: { installRoot: string; resourceDir: string; gameDir: string; activeTaskId?: string; existingDirectory?: string; recoverableDirectory?: string } };
  "install.vanilla": {
    payload: {
      name: string;
      version: string;
      root?: string;
      loader?: { kind: LoaderKind; version: string };
    };
    result: string;
  };
  "loaders.versions": {
    payload: { kind: LoaderKind; minecraft: string };
    result: LoaderVersion[];
  };
  "loaders.install": {
    payload: { instanceId: string; kind: LoaderKind; version: string };
    result: string;
  };
  "instances.list": { payload: undefined; result: Instance[] };
  "instances.metadata": {payload:{id:string;metadata:Partial<Pick<Instance,'name'|'description'|'category'|'favorite'>>};result:Instance};
  "instances.mergeFavorites": {payload:string[];result:void};
  "instances.components": {payload:string;result:InstanceComponents};
  "instances.unregister": {payload:string;result:void};
  "instances.deletePlan": {payload:string;result:InstanceDeletePlan};
  "instances.delete": {payload:{token:string;externalGamesClosed:boolean};result:void};
  "instances.repair": {payload:string;result:string};
  "directories.list": {payload:undefined;result:GameDirectory[]};
  "directories.rename": {payload:{id:string;name:string};result:void};
  "directories.remove": {payload:string;result:void};
  "directories.scan": {payload:string;result:Instance[]};
  "instances.chooseIcon": {payload:string;result:Instance|null};
  "instances.icon": {payload:string;result:string|null};
  "instances.openFolder": {payload:{id:string;folder:'root'|'mods'|'saves'|'resourcepacks'|'screenshots'};result:void};
  "instances.import": { payload: string; result: Instance[] };
  "instances.mapGameDirectory": {
    payload: { id: string; gameDir: string };
    result: Instance;
  };
  "instances.patch": {
    payload: {
      id: string;
      memoryMb: number;
      javaArgs: string[];
      javaPath?: string;
    };
    result: Instance;
  };
  "java.plan": { payload: JavaContext; result: JavaPlan };
  "java.ensure": { payload: JavaContext; result: string };
  "java.managed": { payload: undefined; result: JavaRuntime[] };
  "java.detect": { payload: undefined; result: JavaRuntime[] };
  "java.inspect": { payload: string; result: JavaRuntime };
  "launch.start": {
    payload: { instanceId: string; accountId: string };
    result: { pid: number };
  };
  "launch.status": { payload: string; result: LaunchState };
  "launch.stop": { payload: string; result: LaunchState };
  "launch.cancel": { payload: string; result: LaunchState };
  "launch.export": { payload: {instanceId: string; environment: boolean}; result: string | null };
  "instances.launchSettings": { payload: {id: string; launch: Partial<LaunchSettings>}; result: Instance };
  "launch.logs": { payload: string; result: LaunchEvent[] };
  "settings.read": { payload: undefined; result: Settings };
  "settings.patch": { payload: Partial<Settings>; result: Settings };
  "settings.reset": { payload: undefined; result: Settings };
  "app.openDeveloper": { payload: undefined; result: void };
  "app.openCommunity": { payload: undefined; result: void };
  "app.copyCommunityGroup": { payload: undefined; result: void };
}
export interface LauncherNotice {
  title: string;
  message: string;
  community: string;
  group: string;
}
export interface LauncherBridge {
  invoke<K extends keyof CommandMap>(
    command: K,
    payload: CommandMap[K]["payload"],
  ): Promise<CommandMap[K]["result"]>;
  onLaunch(callback: (state: LaunchState) => void): () => void;
  onTask(callback: (task: TaskSnapshot) => void): () => void;
  onNotice(callback: (notice: LauncherNotice) => void): () => void;
}
declare global {
  interface Window {
    launcher: LauncherBridge;
  }
}
