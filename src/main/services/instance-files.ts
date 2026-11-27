import { lstat, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { InstanceFileEntry, InstanceFolder } from "../../shared/types";
import { canonicalRoot } from "./instance-maintenance";
import { safeDestination } from "./network";
import type { InstanceService } from "./instances";

const folders: InstanceFolder[] = ["root", "version", "mods", "saves", "resourcepacks", "screenshots"];

export class InstanceFiles {
  constructor(private instances: InstanceService) {}

  async browse(id: string, folder: InstanceFolder, relativePath = "", offset = 0) {
    if (!folders.includes(folder)) throw new Error("不支持的实例目录");
    if (typeof relativePath !== "string" || relativePath.length > 4096 || relativePath.includes("\0"))
      throw new Error("无效目录路径");
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) throw new Error("无效目录分页位置");
    const item = await this.instances.get(id);
    const root = await canonicalRoot(folder === "version" ? item.resourceDir : item.gameDir);
    const base = folder === "root" ? root
      : folder === "version" ? await safeDestination(root, join("versions", item.versionId))
      : await safeDestination(root, folder);
    let target = base;
    if (relativePath) target = await safeDestination(base, relativePath);
    let targetInfo;
    try { targetInfo = await lstat(target); }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT")
        return { folder, relativePath, entries: [] as InstanceFileEntry[], truncated: false };
      throw error;
    }
    if (targetInfo.isSymbolicLink() || !targetInfo.isDirectory()) throw new Error("只能浏览实例内的普通目录");
    const names = (await readdir(target)).sort((a, b) => a.localeCompare(b, "zh-CN", { numeric: true, sensitivity: "base" }));
    const page = names.slice(offset, offset + 500);
    const entries: InstanceFileEntry[] = [];
    for (const name of page) {
      const path = await safeDestination(target, name), info = await lstat(path);
      if (info.isSymbolicLink()) continue;
      if (!info.isDirectory() && !info.isFile()) continue;
      entries.push({ name, kind: info.isDirectory() ? "directory" : "file", size: info.isFile() ? info.size : 0, modifiedAt: info.mtimeMs });
    }
    const nextOffset=offset+page.length<names.length?offset+page.length:undefined;
    return { folder, relativePath, entries, truncated: nextOffset!==undefined, ...(nextOffset!==undefined?{nextOffset}:{}) };
  }
}
