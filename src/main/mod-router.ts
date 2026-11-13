import { consumeModSelection } from "./services/mod-selection";
import type { ModBatchItem, ModBatchAction } from "../shared/content";
import { noPayload } from "./ipc";
import { ContentProviders } from "./services/content-provider";
import { CurseForgeContent } from "./services/curseforge-content";
import {
  ProviderSecrets,
  validateProviderKey,
} from "./services/provider-secrets";
import { resolveTag } from "../shared/content-tags";
import type { CommandRouter } from "./ipc";
import type {
  ContentFilter,
  ContentKind,
  ResourceKind,
} from "../shared/content";
import type { LoaderKind } from "../shared/types";
import { ModService, modFile, validateBatch } from "./services/mods";
import { ModrinthService } from "./services/modrinth";
import type { InstanceService } from "./services/instances";
import type { TaskService } from "./services/tasks";
import type { NetworkService } from "./services/network";
import { ContentInstallService } from "./services/content-install";
import { ContentSaveService } from "./services/content-save";
function text(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.length > 4096 || v.includes("\0"))
    throw new Error("无效字符串");
  return v;
}
function fields(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw new Error("无效参数字段");
  return v as Record<string, unknown>;
}
function filter(v: unknown): ContentFilter {
  const d = fields(v, [
    "provider",
    "projectType",
    "tag",
    "minecraft",
    "loader",
    "offset",
    "limit",
  ]);
  const result: ContentFilter = {};
  if (d.provider !== undefined) {
    if (!["modrinth", "curseforge"].includes(String(d.provider)))
      throw new Error("无效内容来源");
    result.provider = d.provider as ContentFilter["provider"];
  }
  if (d.projectType !== undefined) {
    if (
      !["mod", "modpack", "resourcepack", "shader", "datapack"].includes(
        String(d.projectType),
      )
    )
      throw new Error("无效内容类型");
    result.projectType = d.projectType as ContentKind;
  }
  if (d.tag !== undefined) {
    result.tag = text(d.tag);
    resolveTag(result.projectType ?? "mod", result.tag, result.provider);
  }
  if (d.minecraft !== undefined) result.minecraft = text(d.minecraft);
  if (d.loader !== undefined) {
    if (!["fabric", "quilt", "forge", "neoforge"].includes(String(d.loader)))
      throw new Error("无效加载器");
    result.loader = d.loader as LoaderKind;
  }
  for (const key of ["offset", "limit"] as const)
    if (d[key] !== undefined) {
      if (
        !Number.isInteger(d[key]) ||
        Number(d[key]) < (key === "limit" ? 1 : 0) ||
        Number(d[key]) > (key === "limit" ? 100 : 1000000)
      )
        throw new Error("无效分页");
      result[key] = d[key] as number;
    }
  return result;
}
export function registerModCommands(
  router: CommandRouter,
  services: {
    instances: InstanceService;
    tasks: TaskService;
    network: NetworkService;
  },
  secrets?: ProviderSecrets,
) {
  const vault =
    secrets ??
    new ProviderSecrets("", {
      isEncryptionAvailable: () => false,
      encryptString: () => {
        throw new Error("未配置保险库");
      },
      decryptString: () => {
        throw new Error("未配置保险库");
      },
    });
  const curseforge = new CurseForgeContent(vault);
  const modrinth = new ContentProviders(
      new ModrinthService(services.network),
      curseforge,
    ),
    mods = new ModService(
      services.instances,
      services.tasks,
      services.network,
      modrinth,
    );
  router.register("content.providerStatus", noPayload, () => vault.status());
  router.register(
    "content.setProviderKey",
    (v) => {
      const d = fields(v, ["provider", "key", "remember"]);
      if (d.provider !== "curseforge" || typeof d.remember !== "boolean")
        throw new Error("无效来源凭据参数");
      return {
        provider: "curseforge" as const,
        key: validateProviderKey(d.key),
        remember: d.remember,
      };
    },
    (d) => vault.set(d.key, d.remember),
  );
  router.register(
    "content.clearProviderKey",
    (v) => {
      const d = fields(v, ["provider"]);
      if (d.provider !== "curseforge") throw new Error("无效内容来源");
      return { provider: "curseforge" as const };
    },
    () => vault.clear(),
  );
  const resources = new ContentInstallService(
    services.instances,
    modrinth,
    services.network,
    services.tasks,
  );
  router.register(
    "content.worlds",
    (v) => {
      const d = fields(v, ["instanceId"]);
      return { instanceId: text(d.instanceId) };
    },
    (d) => resources.worlds(d.instanceId),
  );
  router.register(
    "content.installResource",
    (v) => {
      const d = fields(v, [
        "instanceId",
        "kind",
        "projectId",
        "versionId",
        "filename",
        "worldId",
      ]);
      if (!["resourcepack", "shader", "datapack"].includes(String(d.kind)))
        throw new Error("无效资源类型");
      return {
        instanceId: text(d.instanceId),
        kind: d.kind as ResourceKind,
        projectId: text(d.projectId),
        versionId: text(d.versionId),
        filename: text(d.filename),
        ...(d.worldId !== undefined ? { worldId: text(d.worldId) } : {}),
      };
    },
    (d) => resources.install(d),
  );
  const save = new ContentSaveService(
    modrinth,
    services.network,
    services.tasks,
    async (defaultPath) => {
      const { dialog } = await import("electron");
      const result = await dialog.showSaveDialog({
        title: "资源另存为",
        defaultPath,
        properties: ["showOverwriteConfirmation", "createDirectory"],
      });
      return result.canceled ? null : (result.filePath ?? null);
    },
  );
  router.register(
    "content.project",
    (v) => {
      const d = fields(v, ["projectId"]);
      return { projectId: text(d.projectId) };
    },
    (d) => modrinth.project(d.projectId),
  );
  router.register(
    "content.version",
    (v) => {
      const d = fields(v, ["versionId"]);
      return { versionId: text(d.versionId) };
    },
    (d) => modrinth.version(d.versionId),
  );
  router.register(
    "content.saveVersion",
    (v) => {
      const d = fields(v, ["projectId", "versionId", "filename"]);
      return {
        projectId: text(d.projectId),
        versionId: text(d.versionId),
        filename: text(d.filename),
      };
    },
    (d) => save.save(d.projectId, d.versionId, d.filename),
  );
  router.register(
    "content.openFilePage",
    (v) => {
      const d = fields(v, ["versionId", "filename"]);
      return { versionId: text(d.versionId), filename: text(d.filename) };
    },
    async (d) => {
      const version = await modrinth.version(d.versionId);
      const file = version.files.find((f) => f.filename === d.filename);
      if (!file?.website) throw new Error("无官方文件链接");
      const url = new URL(file.website);
      if (
        url.protocol !== "https:" ||
        !["www.curseforge.com", "curseforge.com"].includes(url.hostname)
      )
        throw new Error("无效官方文件链接");
      const { shell } = await import("electron");
      await shell.openExternal(file.website);
    },
  );
  router.register(
    "content.copyName",
    (v) => {
      const d = fields(v, ["projectId"]);
      return { projectId: text(d.projectId) };
    },
    async (d) => {
      const project = await modrinth.project(d.projectId);
      const { clipboard } = await import("electron");
      await clipboard.writeText(project.title);
    },
  );
  router.register(
    "content.openProject",
    (v) => {
      const d = fields(v, ["projectId", "link"]);
      if (
        !["website", "source_url", "issues_url", "wiki_url"].includes(
          String(d.link),
        )
      )
        throw new Error("无效项目链接");
      return {
        projectId: text(d.projectId),
        link: d.link as "website" | "source_url" | "issues_url" | "wiki_url",
      };
    },
    async (d) => {
      const project = await modrinth.project(d.projectId);
      const url = project[d.link];
      if (!url) throw new Error("项目未提供此链接");
      const { shell } = await import("electron");
      await shell.openExternal(url);
    },
  );
  router.register(
    "content.search",
    (v) => {
      const d = fields(v, ["query", "filter"]);
      return {
        query:
          typeof d.query === "string" && d.query.length === 0
            ? ""
            : text(d.query),
        filter: filter(d.filter),
      };
    },
    (d) => modrinth.search(d.query, d.filter),
  );
  router.register(
    "content.versions",
    (v) => {
      const d = fields(v, ["projectId", "filter"]);
      return { projectId: text(d.projectId), filter: filter(d.filter) };
    },
    (d) => modrinth.versions(d.projectId, d.filter),
  );
  for (const command of ["mods.install", "mods.update"] as const)
    router.register(
      command,
      (v) => {
        const d = fields(v, ["instanceId", "versionId"]);
        return { instanceId: text(d.instanceId), versionId: text(d.versionId) };
      },
      async (d) => mods.install(d.instanceId, d.versionId),
    );
  router.register("mods.checkUpdatesDetailed", text, id => mods.checkUpdatesDetailed(id));
  router.register("mods.batchResult", text, async id => mods.batchResult(id));
  router.register("mods.importMany", v => {
    const d = fields(v,["instanceId","selectionId"]);
    return {instanceId:text(d.instanceId),selectionId:text(d.selectionId)};
  }, d => mods.importMany(d.instanceId, consumeModSelection(d.selectionId)));
  router.register("mods.batch", v => {
    const d = fields(v,["instanceId","action","items"]);
    if (!["enable","disable","remove"].includes(String(d.action))) throw new Error("无效批量操作");
    validateBatch(d.action as ModBatchAction,d.items as ModBatchItem[]);
    return {instanceId:text(d.instanceId),action:d.action as "enable"|"disable"|"remove",items:d.items as ModBatchItem[]};
  }, d => mods.batch(d.instanceId,d.action,d.items));
  router.register("mods.batchUpdate", v => {
    const d = fields(v,["instanceId","items"]);
    validateBatch("update",d.items as ModBatchItem[]);
    return {instanceId:text(d.instanceId),items:d.items as ModBatchItem[]};
  }, async d => mods.startBatchUpdate(d.instanceId,d.items));
  router.register("mods.list", text, (id) => mods.list(id));
  router.register("mods.checkUpdates", text, (id) => mods.checkUpdates(id));
  router.register(
    "mods.import",
    (v) => {
      const d = fields(v, ["instanceId", "path"]);
      return { instanceId: text(d.instanceId), path: text(d.path) };
    },
    (d) => mods.importJar(d.instanceId, d.path),
  );
  router.register(
    "mods.remove",
    (v) => {
      const d = fields(v, ["instanceId", "fileName"]);
      return {
        instanceId: text(d.instanceId),
        fileName: modFile(text(d.fileName)),
      };
    },
    (d) => mods.remove(d.instanceId, d.fileName),
  );
  router.register(
    "mods.toggle",
    (v) => {
      const d = fields(v, ["instanceId", "fileName", "enabled"]);
      if (typeof d.enabled !== "boolean") throw new Error("无效启用状态");
      return {
        instanceId: text(d.instanceId),
        fileName: modFile(text(d.fileName)),
        enabled: d.enabled,
      };
    },
    (d) => mods.toggle(d.instanceId, d.fileName, d.enabled),
  );
  return { mods, modrinth, curseforge, vault };
}
