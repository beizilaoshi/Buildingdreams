import { validateLaunchSettings } from "../shared/launch-settings";
import { validateMetadata } from "../shared/instance-metadata";
import { InstanceMaintenance } from './services/instance-maintenance';
import { InstanceRepair } from './services/instance-repair';
import type { CommandRouter } from "./ipc";
import { noPayload } from "./ipc";
import { InstanceService } from "./services/instances";
import { JavaService, type JavaResolveOptions } from "./services/java";
import { JavaRuntimeService } from "./services/java-runtime";
import type { JavaContext } from "../shared/types";
import type { JavaRequirementInput } from "../shared/java-requirements";
import { createHash } from "node:crypto";
import { LaunchService, type AccountProvider } from "./services/launch";
import type { Settings } from "../shared/types";
import type { Instance } from "../shared/types";
import type { LoaderKind } from "../shared/types";
import { dirname, join } from "node:path";
import { TaskService } from "./services/tasks";
import { NetworkService } from "./services/network";
import {
  InstallService,
  instanceName,
  versionSegment,
} from "./services/install";
import { LoaderService, XmclLoaderAdapter } from "./services/loaders";
function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 4096 ||
    value.includes("\0")
  )
    throw new Error("无效字符串");
  return value;
}
function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("无效参数");
  return value as Record<string, unknown>;
}
function fields(value: unknown, keys: string[]) {
  const result = object(value);
  if (Object.keys(result).some((key) => !keys.includes(key)))
    throw new Error("未知字段");
  return result;
}
export function registerGameCommands(
  router: CommandRouter,
  file: string,
  accounts: AccountProvider = async () => {
    throw new Error("账号服务尚未连接");
  },
  defaults?: () => Promise<Settings>,
) {
  const tasks = new TaskService(), network = new NetworkService();
  const inspector = new JavaService();
  const managed = new JavaRuntimeService(join(dirname(file),"java"),network,path=>inspector.inspect(path));
  const instances = new InstanceService(
      file,
      defaults
        ? async () => {
            const s = await defaults();
            return {
              memoryMb: s.memoryMb,
              javaArgs: s.javaArgs,
              javaPath: s.javaPath || undefined,
            };
          }
        : undefined,
    ),
    java = new JavaService(managed,tasks),
    launch = new LaunchService(
      instances,
      java,
      accounts,
      undefined,
      undefined,
      async () => (await defaults?.())?.javaPath ?? "",
      async () => (await defaults?.())?.autoDownloadJava !== false,
      async () => (await defaults?.())?.launch ?? {},
      tasks,
      network,
    );
  instances.busy = id => launch.isBusy(id);
  const maintenance = new InstanceMaintenance(instances,tasks);
  const repair = new InstanceRepair(instances,tasks,network);
  router.register('instances.metadata',value=>{const d=fields(value,['id','metadata']);return {id:text(d.id),metadata:validateMetadata(d.metadata)};},d=>instances.metadata(d.id,d.metadata));
  router.register('instances.mergeFavorites',value=>{if(!Array.isArray(value)||value.length>10000)throw Error('无效收藏列表');return value.map(text);},ids=>instances.mergeFavorites(ids));
  router.register('instances.components',text,async id=>{const v=await instances.resolve(id);return {minecraft:v.minecraftVersion,components:v.libraries.filter(l=>/fabric-loader|quilt-loader|neoforge|minecraftforge|optifine|liteloader/i.test(l.name)).map(l=>l.name+':'+l.version)};});
  router.register('instances.unregister',text,id=>instances.unregister(id));
  router.register('instances.deletePlan',text,id=>maintenance.planDelete(id));
  router.register('instances.delete',value=>{const d=fields(value,['token','externalGamesClosed']);if(d.externalGamesClosed!==true)throw Error('请先确认外部游戏已关闭');return {token:text(d.token),externalGamesClosed:true};},d=>maintenance.delete(d.token,d.externalGamesClosed));
  router.register('instances.repair',text,async id=>repair.start(id));
  router.register('directories.list',noPayload,()=>instances.directories());
  router.register('directories.rename',value=>{const d=fields(value,['id','name']);return {id:text(d.id),name:text(d.name)};},d=>instances.renameDirectory(d.id,d.name));
  router.register('directories.remove',text,id=>instances.removeDirectory(id));
  router.register('directories.scan',text,async id=>{const d=(await instances.directories()).find(x=>x.id===id);if(!d)throw Error('目录不存在');return instances.importDirectory(d.path);});
  const install = new InstallService(
    instances,
    tasks,
    network,
    join(dirname(file), "installations"),
  );
  const loaders = new LoaderService(
    install,
    new XmclLoaderAdapter(network, java, undefined,async()=>await defaults?.() ?? {}),
  );
  const kind = (value: unknown): LoaderKind => {
    if (!["fabric", "quilt", "forge", "neoforge"].includes(String(value)))
      throw new Error("无效加载器");
    return value as LoaderKind;
  };
  router.register("tasks.list", noPayload, async () => tasks.list());
  router.register("tasks.cancel", text, (id) => tasks.cancel(id));
  router.register("tasks.retry", text, async (id) => tasks.retry(id));
  router.register("install.catalog", noPayload, () => install.catalog());
  router.register("install.versions", noPayload, () => install.versions());
  router.register("install.preview", value => {
    const data = fields(value, ["name", "root"]);
    return { name: instanceName(text(data.name)), root: data.root === undefined ? undefined : text(data.root) };
  }, async data => install.previewForUi(data.name, data.root));
  router.register(
    "install.vanilla",
    (value) => {
      const data = fields(value, ["name", "version", "loader", "root"]);
      return {
        name: instanceName(text(data.name)),
        version: versionSegment(text(data.version)),
        root: data.root === undefined ? undefined : text(data.root),
        ...(data.loader === undefined
          ? {}
          : {
              loader: (() => {
                const l = fields(data.loader, ["kind", "version"]);
                return {
                  kind: kind(l.kind),
                  version: versionSegment(text(l.version)),
                };
              })(),
            }),
      };
    },
    async (data) =>
      install.installVanilla(
        data.name,
        data.version,
        data.loader
          ? async (item, context) => {
              const loader = data.loader!;
              item.versionId = await loaders.installInto(
                item.resourceDir,
                item,
                loader.kind,
                loader.version,
                context,
              );
              item.loader = loader;
            }
          : undefined,
        { root: data.root, loaderFingerprint: data.loader ? `${data.loader.kind}:${data.loader.version}` : undefined },
      ),
  );
  router.register(
    "loaders.versions",
    (value) => {
      const data = fields(value, ["kind", "minecraft"]);
      return {
        kind: kind(data.kind),
        minecraft: versionSegment(text(data.minecraft)),
      };
    },
    (data) => loaders.versions(data.kind, data.minecraft),
  );
  router.register(
    "loaders.install",
    (value) => {
      const data = fields(value, ["instanceId", "kind", "version"]);
      return {
        instanceId: text(data.instanceId),
        kind: kind(data.kind),
        version: versionSegment(text(data.version)),
      };
    },
    async (data) => loaders.install(data.instanceId, data.kind, data.version),
  );
  router.register("instances.list", noPayload, () => instances.list());
  router.register("instances.import", text, (path) =>
    instances.importDirectory(path),
  );
  router.register(
    "instances.mapGameDirectory",
    (value) => {
      const data = fields(value, ["id", "gameDir"]);
      return { id: text(data.id), gameDir: text(data.gameDir) };
    },
    ({ id, gameDir }) => instances.mapGameDirectory(id, gameDir),
  );
  router.register(
    "instances.patch",
    (value) => {
      const data = fields(value, ["id", "memoryMb", "javaArgs", "javaPath"]);
      const id = text(data.id);
      if (
        !Number.isInteger(data.memoryMb) ||
        Number(data.memoryMb) < 512 ||
        Number(data.memoryMb) > 1048576
      )
        throw new Error("无效内存");
      if (
        !Array.isArray(data.javaArgs) ||
        data.javaArgs.length > 128 ||
        data.javaArgs.some(
          (x) => typeof x !== "string" || x.length > 4096 || x.includes("\0"),
        )
      )
        throw new Error("无效 Java 参数");
      return {
        id,
        memoryMb: data.memoryMb as number,
        javaArgs: data.javaArgs as string[],
        javaPath: data.javaPath === undefined ? undefined : data.javaPath === "" ? "" : text(data.javaPath),
      };
    },
    ({ id, ...patch }) =>
      instances.patch(
        id,
        patch as Pick<Instance, "memoryMb" | "javaArgs" | "javaPath">,
      ),
  );
  const javaContext = (value: unknown): JavaContext => {
    const data = object(value);
    if (Object.hasOwn(data,"instanceId")) { fields(data,["instanceId"]); return {instanceId:text(data.instanceId)}; }
    if (Object.hasOwn(data,"family")) {
      fields(data,["family"]);
      if (![8,16,17,21,25].includes(Number(data.family)) || typeof data.family !== "number") throw new Error("无效 Java 下载系列");
      return {family:data.family as 8|16|17|21|25};
    }
    fields(data,["minecraft","loader"]);
    const minecraft = versionSegment(text(data.minecraft));
    if (data.loader === undefined) return {minecraft};
    const l = fields(data.loader,["kind","version"]);
    return {minecraft,loader:{kind:kind(l.kind),version:versionSegment(text(l.version))}};
  };
  const javaInput = async (context: JavaContext): Promise<{input:JavaRequirementInput;options:JavaResolveOptions}> => {
    const settings = await defaults?.();
    const options: JavaResolveOptions = {memoryMb:settings?.memoryMb ?? 4096,manualPath:settings?.javaPath,autoDownload:settings?.autoDownloadJava !== false};
    if ("family" in context) return {input:{minecraft:"手动下载运行环境",metadataMajor:context.family,exactMajor:context.family},options:{...options,manualPath:undefined,autoDownload:true}};
    if ("instanceId" in context) {
      const item = await instances.get(context.instanceId), version = await instances.resolve(item.id);
      return {input:{minecraft:version.minecraftVersion,metadataMajor:version.javaVersion?.majorVersion,loader:item.loader,optifine:version.libraries.some(l=>/optifine/i.test(l.name)),liteLoader:version.libraries.some(l=>/liteloader/i.test(l.name))},options:{...options,memoryMb:item.memoryMb,manualPath:item.javaPath ?? options.manualPath,roots:[item.resourceDir,item.gameDir]}};
    }
    // Renderer supplies only selected identities; official main-resolved metadata supplies requirements.
    const signal = AbortSignal.timeout(30000);
    const meta = (await install.versions(signal)).find(v=>v.id === context.minecraft);
    if (!meta?.sha1) throw new Error("Minecraft 版本不存在或缺少元数据校验和");
    const official = network.restricted(["piston-meta.mojang.com","launchermeta.mojang.com"]);
    const response = await official.response(meta.url,signal);
    const reader = response.body?.getReader(); if (!reader) throw new Error("空版本元数据");
    const chunks: Uint8Array[] = []; let size = 0;
    try { while(true) { const part = await reader.read(); if(part.done) break; size += part.value.length; if(size > 8*1024*1024) throw new Error("版本元数据过大"); chunks.push(part.value); } }
    finally { await reader.cancel().catch(()=>{}); }
    const bytes = Buffer.concat(chunks);
    if (createHash("sha1").update(bytes).digest("hex") !== meta.sha1.toLowerCase()) throw new Error("版本元数据 SHA1 校验失败");
    const raw = JSON.parse(bytes.toString("utf8")); install.validateProfile(raw,context.minecraft);
    if (context.loader && !(await loaders.versions(context.loader.kind,context.minecraft)).some(v=>v.version === context.loader!.version)) throw new Error("加载器版本不支持此 Minecraft 版本");
    return {input:{minecraft:context.minecraft,metadataMajor:raw.javaVersion?.majorVersion,loader:context.loader},options};
  };
  router.register("java.plan",javaContext,async context=>{const {input,options}=await javaInput(context);return java.plan(input,options);});
  router.register("java.ensure",javaContext,async context=>{const {input,options}=await javaInput(context);return java.ensure(input,options);});
  router.register("java.managed",noPayload,()=>java.managedList());
  router.register("java.detect", noPayload, () => java.detect());
  router.register("java.inspect", text, (path) => java.inspect(path));
  router.register(
    "launch.start",
    (value) => {
      const data = fields(value, ["instanceId", "accountId"]);
      return {
        instanceId: text(data.instanceId),
        accountId: text(data.accountId),
      };
    },
    (data) => launch.launch(data.instanceId, data.accountId),
  );
  router.register("launch.status", text, async id=>launch.status(id));
  router.register("launch.stop", text, id=>launch.stop(id));
  router.register("launch.cancel", text, id=>launch.cancel(id));
  router.register("instances.launchSettings", value=>{const data=fields(value,["id","launch"]);return {id:text(data.id),launch:validateLaunchSettings(data.launch)};}, data=>instances.patchLaunch(data.id,data.launch));
  router.register("launch.logs", text, async (id) => launch.logs(id));
  return { instances, java, launch, tasks, network, install, loaders };
}
