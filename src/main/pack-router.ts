import { validateProviderKey } from "./services/provider-secrets";
import type { CommandRouter } from "./ipc";
import type { PackInstallOptions, PackExportOptions } from "../shared/packs";
import { PackService } from "./services/packs";
import type { InstallService } from "./services/install";
import type { LoaderService } from "./services/loaders";
import type { ContentSource } from "./services/content-provider";
function text(v: unknown): string {
  if (typeof v !== "string" || !v.trim() || v.length > 4096 || v.includes("\0"))
    throw new Error("无效字符串");
  return v;
}
function object(v: unknown, keys: string[]): Record<string, unknown> {
  if (
    !v ||
    typeof v !== "object" ||
    Array.isArray(v) ||
    Object.keys(v).some((k) => !keys.includes(k))
  )
    throw new Error("无效整合包参数");
  return v as Record<string, unknown>;
}
function options(v: unknown): PackInstallOptions {
  if (v === undefined) return {};
  const d = object(v, ["suppliedFiles", "includeOptional", "curseForgeKey"]);
  const result: PackInstallOptions = {};
  if (d.includeOptional !== undefined) {
    if (typeof d.includeOptional !== "boolean")
      throw new Error("无效可选文件参数");
    result.includeOptional = d.includeOptional;
  }
  if (d.curseForgeKey !== undefined)
    result.curseForgeKey = validateProviderKey(d.curseForgeKey);
  if (d.suppliedFiles !== undefined) {
    if (!Array.isArray(d.suppliedFiles) || d.suppliedFiles.length > 20000)
      throw new Error("无效补齐文件");
    result.suppliedFiles = d.suppliedFiles.map((v) => {
      const f = object(v, ["projectID", "fileID", "path", "sha1", "target"]);
      if (
        !Number.isSafeInteger(f.projectID) ||
        Number(f.projectID) <= 0 ||
        !Number.isSafeInteger(f.fileID) ||
        Number(f.fileID) <= 0 ||
        typeof f.sha1 !== "string" ||
        !/^[a-f0-9]{40}$/i.test(f.sha1)
      )
        throw new Error("无效文件标识或 SHA1");
      if (
        f.target !== undefined &&
        !["mods", "resourcepacks", "shaderpacks"].includes(String(f.target))
      )
        throw new Error("无效补齐文件类型");
      return {
        target: f.target as
          "mods" | "resourcepacks" | "shaderpacks" | undefined,
        projectID: f.projectID as number,
        fileID: f.fileID as number,
        path: text(f.path),
        sha1: f.sha1,
      };
    });
  }
  return result;
}
export function registerPackCommands(
  router: CommandRouter,
  services: { install: InstallService; loaders: LoaderService },
  modrinth: ContentSource,
  curseforge?: ContentSource,
) {
  const packs = new PackService(
    services.install,
    services.loaders,
    modrinth,
    undefined,
    curseforge,
  );
  router.register(
    "packs.installOnline",
    (v) => {
      const d = object(v, ["projectId", "versionId", "filename", "name"]);
      return {
        projectId: text(d.projectId),
        versionId: text(d.versionId),
        filename: text(d.filename),
        name: text(d.name),
      };
    },
    async (d) =>
      packs.installOnline(d.projectId, d.versionId, d.filename, d.name),
  );
  router.register("packs.hashSupplied", text, (file) =>
    packs.hashSupplied(file),
  );
  router.register("packs.inspect", text, (file) => packs.inspect(file));
  router.register("packs.previewExport", text, (id) => packs.previewExport(id));
  router.register(
    "packs.install",
    (v) => {
      const d = object(v, ["file", "name", "options"]);
      return {
        file: text(d.file),
        name: text(d.name),
        options: options(d.options),
      };
    },
    async (d) => packs.install(d.file, d.name, d.options),
  );
  router.register(
    "packs.installModrinth",
    (v) => {
      const d = object(v, ["versionId", "name", "options"]);
      return {
        versionId: text(d.versionId),
        name: text(d.name),
        options: options(d.options),
      };
    },
    async (d) => packs.installModrinth(d.versionId, d.name, d.options),
  );
  router.register(
    "packs.export",
    (v) => {
      const d = object(v, ["instanceId", "destination", "options"]);
      let selected: PackExportOptions = {};
      if (d.options !== undefined) {
        const o = object(d.options, ["overridePaths"]);
        if (o.overridePaths !== undefined) {
          if (!Array.isArray(o.overridePaths) || o.overridePaths.length > 20000)
            throw new Error("无效导出文件选择");
          selected = { overridePaths: o.overridePaths.map(text) };
        }
      }
      return {
        instanceId: text(d.instanceId),
        destination: text(d.destination),
        options: selected,
      };
    },
    async (d) => packs.export(d.instanceId, d.destination, d.options),
  );
  return { packs };
}
