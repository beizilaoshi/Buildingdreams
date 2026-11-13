import { modMetadata } from "./mod-metadata";
import type { ModBatchAction, ModBatchItem, ModBatchResult, ModUpdateCheck } from "../../shared/content";
import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import {
  readFile,
  writeFile,
  readdir,
  mkdir,
  rename,
  rm,
  copyFile,
  lstat,
} from "node:fs/promises";
import { join, basename } from "node:path";
import type { ContentVersion, LocalMod, ModUpdate } from "../../shared/content";
import { InstanceService } from "./instances";
import { compatible } from "./modrinth";
import type { ContentSource } from "./content-provider";
import { NetworkService, safeDestination } from "./network";
import { TaskService, type TaskContext } from "./tasks";
type Sources = Record<
  string,
  {
    projectId: string;
    versionId: string;
    sha1: string;
    downloads?: string[];
    fileSize?: number;
  }
>;
const manifest = ".zhumeng-mods.json";
// Use a conservative Windows case key even when tests run on a case-sensitive host.
function fileKey(name: string): string {
  return name.toUpperCase();
}
function isDisabled(name: string): boolean {
  return /\.disabled$/i.test(name);
}
async function snapshot(dir: string): Promise<string> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return "missing";
    throw error;
  }
  const files: [string, string][] = [];
  for (const name of names.sort()) {
    const path = await safeDestination(dir, name);
    if (!(await lstat(path)).isFile()) throw new Error("mods 目录含非普通文件");
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path)) hash.update(chunk);
    files.push([name, hash.digest("hex")]);
  }
  return JSON.stringify(files);
}
export function modFile(value: string): string {
  if (
    value !== basename(value) ||
    /[\\/:\x00-\x1f<>"|?*]/.test(value) ||
    !/^.+\.jar(?:\.disabled)?$/i.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])\./i.test(value)
  )
    throw new Error("无效 Mod 文件名");
  return value;
}
export class ModService {
  private locks = new Map<string, Promise<unknown>>();
  constructor(
    private instances: InstanceService,
    private tasks: TaskService,
    private network: NetworkService,
    private modrinth: ContentSource,
  ) {}
  private async locked<T>(id: string, job: () => Promise<T>): Promise<T> {
    const next = (this.locks.get(id) ?? Promise.resolve())
      .catch(() => {})
      .then(job);
    this.locks.set(id, next);
    try {
      return await next;
    } finally {
      if (this.locks.get(id) === next) this.locks.delete(id);
    }
  }
  private async directory(id: string): Promise<string> {
    const instance = await this.instances.get(id);
    return safeDestination(instance.gameDir, "mods");
  }
  private async sources(dir: string): Promise<Sources> {
    try {
      await safeDestination(dir, manifest);
      return JSON.parse(await readFile(join(dir, manifest), "utf8"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
      throw error;
    }
  }
  async list(id: string): Promise<LocalMod[]> {
    return this.locked(id, () => this.listUnlocked(id));
  }
  private async listUnlocked(id: string): Promise<LocalMod[]> {
    const dir = await this.directory(id);
    const sources = await this.sources(dir);
    let files: string[];
    try {
      files = await readdir(dir);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const result: LocalMod[] = [];
    for (const fileName of files.filter((f) =>
      /\.jar(?:\.disabled)?$/i.test(f),
    )) {
      const file = await safeDestination(dir, modFile(fileName));
      if (!(await lstat(file)).isFile()) throw new Error("Mod 不是普通文件");
      const sha1 = createHash("sha1")
        .update(await readFile(file))
        .digest("hex");
      const source = sources[fileName];
      result.push({
        ...(await modMetadata(file)),
        fileName,
        enabled: !isDisabled(fileName),
        sha1,
        ...(source?.sha1 === sha1 && typeof source.projectId === "string" && typeof source.versionId === "string" && source.projectId.length > 0 && source.projectId.length <= 200 && source.versionId.length > 0 && source.versionId.length <= 200 && !/[\x00-\x1f]/.test(source.projectId + source.versionId)
          ? {projectId:source.projectId,versionId:source.versionId,provider:source.projectId.startsWith("cf:") ? "curseforge" as const : "modrinth" as const} : {}),
      });
    }
    return result;
  }
  private async transaction<T>(
    id: string,
    operation: (dir: string, sources: Sources) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const target = await this.directory(id),
      parent = (await this.instances.get(id)).gameDir;
    await mkdir(parent, { recursive: true });
    const stage = await safeDestination(parent, `.mods-stage-${randomUUID()}`),
      backup = await safeDestination(parent, `.mods-backup-${randomUUID()}`);
    await mkdir(stage);
    let moved = false,
      published = false;
    let initial: string | undefined;
    try {
      initial = await snapshot(target);
      let files: string[] = [];
      try {
        files = await readdir(target);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        if (initial !== "missing")
          throw new Error("mods 目录发生外部变化，请重试");
      }
      for (const name of files) {
        const source = await safeDestination(target, name);
        if (!(await lstat(source)).isFile())
          throw new Error("mods 目录含非普通文件");
        await copyFile(source, join(stage, name));
      }
      if (initial !== "missing" && (await snapshot(stage)) !== initial)
        throw new Error("mods 目录发生外部变化，请重试");
      const sources = await this.sources(stage),
        result = await operation(stage, sources);
      await writeFile(join(stage, manifest), JSON.stringify(sources, null, 2));
      signal?.throwIfAborted();
      await safeDestination(parent, "mods");
      if ((await snapshot(target)) !== initial)
        throw new Error("mods 目录发生外部变化，请重试");
      try {
        await rename(target, backup);
        moved = true;
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        if (initial !== "missing")
          throw new Error("mods 目录发生外部变化，请重试");
      }
      if (moved && (await snapshot(backup)) !== initial) {
        // Restore the claimed directory, including every external change.
        try {
          await rename(backup, target);
          moved = false;
        } catch {
          throw new Error(`mods 目录发生外部变化；原文件保留在 ${backup}`);
        }
        throw new Error("mods 目录发生外部变化，请重试");
      }
      try {
        await rename(stage, target);
        published = true;
      } catch (e) {
        if (moved) {
          await rename(backup, target);
          moved = false;
        }
        throw e;
      }
      return result;
    } finally {
      await rm(stage, { recursive: true, force: true });
      if (published && moved) {
        if ((await snapshot(backup)) !== initial)
          throw new Error(`mods 备份发生外部变化，已保留在 ${backup}`);
        await rm(backup, { recursive: true, force: true });
      }
    }
  }
  install(id: string, versionId: string): string {
    return this.tasks.start("安装 Mod", (context) =>
      this.locked(id, () => this.installInto(id, versionId, context)),
    );
  }
  update(id: string, versionId: string): string {
    return this.install(id, versionId);
  }
  private async installInto(
    id: string,
    versionId: string,
    context: TaskContext,
  ): Promise<LocalMod[]> {
    const instance = await this.instances.get(id);
    if (!instance.loader) throw new Error("实例没有 Mod 加载器");
    const filter = {
      minecraft: instance.minecraft,
      loader: instance.loader.kind,
    };
    const selected = new Map<string, ContentVersion>(),
      visiting = new Set<string>();
    const visit = async (version: ContentVersion): Promise<void> => {
      if (
        version.provider === "curseforge" &&
        (await this.modrinth.project(version.project_id, context.signal))
          .projectType !== "mod"
      )
        throw new Error("依赖项目不是 Mod");
      if (!compatible(version, filter))
        throw new Error(`版本不兼容: ${version.id}`);
      const existing = selected.get(version.project_id);
      if (visiting.has(version.id))
        throw new Error(`必需依赖环: ${version.id}`);
      if (existing) {
        if (existing.id !== version.id)
          throw new Error(`依赖版本冲突: ${version.project_id}`);
        return;
      }
      if (selected.size >= 256) throw new Error("依赖数量超过 256 上限");
      selected.set(version.project_id, version);
      visiting.add(version.id);
      for (const dependency of version.dependencies) {
        if (dependency.dependency_type !== "required") continue;
        let next: ContentVersion | undefined;
        if (dependency.version_id)
          next = await this.modrinth.version(
            dependency.version_id,
            context.signal,
          );
        else if (dependency.project_id)
          next =
            selected.get(dependency.project_id) ??
            (
              await this.modrinth.versions(
                dependency.project_id,
                filter,
                context.signal,
              )
            )[0];
        if (
          !next ||
          (dependency.project_id && next.project_id !== dependency.project_id)
        )
          throw new Error("找不到兼容必需依赖");
        await visit(next);
      }
      visiting.delete(version.id);
    };
    await visit(await this.modrinth.version(versionId, context.signal));
    await this.transaction(
      id,
      async (dir, sources) => {
        const installedVersions: ContentVersion[] = [];
        for (const source of Object.values(sources)) {
          if (
            !selected.has(source.projectId) &&
            !installedVersions.some((v) => v.id === source.versionId)
          )
            installedVersions.push(
              await this.modrinth.version(source.versionId, context.signal),
            );
        }
        const combined = [...selected.values(), ...installedVersions];
        const disabledProjects = new Set(
          Object.entries(sources)
            .filter(([name]) => isDisabled(name))
            .map(([, source]) => source.projectId),
        );
        for (const version of combined) {
          for (const dep of version.dependencies.filter(
            (d) => d.dependency_type === "incompatible",
          )) {
            if (
              combined.some((v) =>
                dep.version_id
                  ? v.id === dep.version_id
                  : v.project_id === dep.project_id,
              )
            )
              throw new Error(`不兼容 Mod 冲突: ${version.id}`);
          }
          for (const dep of version.dependencies.filter(
            (d) => d.dependency_type === "required",
          )) {
            const dependencyVersion = combined.find((v) =>
              dep.version_id
                ? v.id === dep.version_id
                : v.project_id === dep.project_id,
            );
            if (
              !disabledProjects.has(version.project_id) &&
              dependencyVersion &&
              disabledProjects.has(dependencyVersion.project_id)
            )
              throw new Error(
                `必需依赖已禁用: ${version.id} 需要 ${dependencyVersion.id}，请先启用依赖`,
              );
            if (
              !combined.some(
                (v) =>
                  (dep.version_id
                    ? v.id === dep.version_id
                    : v.project_id === dep.project_id) &&
                  (!dep.project_id || v.project_id === dep.project_id),
              )
            )
              throw new Error(`已有 Mod 必需依赖冲突: ${version.id}`);
          }
        }
        for (const version of selected.values()) {
          for (const dep of version.dependencies.filter(
            (d) => d.dependency_type === "incompatible",
          )) {
            if (
              [...selected.values()].some((v) =>
                dep.version_id
                  ? v.id === dep.version_id
                  : v.project_id === dep.project_id,
              ) ||
              Object.values(sources).some(
                (v) =>
                  !selected.has(v.projectId) &&
                  (dep.version_id
                    ? v.versionId === dep.version_id
                    : v.projectId === dep.project_id),
              )
            )
              throw new Error(`不兼容 Mod 冲突: ${version.id}`);
          }
          const file = version.files.find((f) => f.primary) ?? version.files[0];
          if (
            !file ||
            !file.url ||
            file.unavailableReason ||
            !file.hashes?.sha1 ||
            !Number.isSafeInteger(file.size) ||
            file.size < 0
          )
            throw new Error("Mod 文件缺少完整性信息");
          const name = modFile(file.filename);
          if (!name.endsWith(".jar")) throw new Error("Mod 文件必须为 JAR");
          const owned = Object.entries(sources).filter(
            ([, s]) => s.projectId === version.project_id,
          );
          const disabled = owned.some(([n]) => isDisabled(n));
          let destination = name + (disabled ? ".disabled" : "");
          for (const [old, source] of owned) {
            const bytes = await readFile(await safeDestination(dir, old));
            if (createHash("sha1").update(bytes).digest("hex") !== source.sha1)
              throw new Error(`已有 Mod 被修改: ${old}`);
          }
          const names = await readdir(dir);
          const alias = names.find((n) => fileKey(n) === fileKey(destination));
          if (alias && !owned.some(([n]) => fileKey(n) === fileKey(alias)))
            throw new Error(`文件名冲突: ${destination}`);
          // Retain the physical filename spelling for a same-project case-only update.
          // Removing the old spelling afterward would remove the new file on Windows.
          if (alias) destination = alias;
          await this.network.download(
            dir,
            {
              url: file.url,
              path: destination,
              sha1: file.hashes.sha1,
              size: file.size,
            },
            context,
          );
          for (const [old, source] of owned) {
            if (fileKey(old) !== fileKey(destination)) {
              const bytes = await readFile(await safeDestination(dir, old));
              if (
                createHash("sha1").update(bytes).digest("hex") !== source.sha1
              )
                throw new Error(`已有 Mod 被修改: ${old}`);
              await rm(join(dir, old));
              delete sources[old];
            } else if (old !== destination) delete sources[old];
          }
          sources[destination] = {
            projectId: version.project_id,
            versionId: version.id,
            sha1: file.hashes.sha1.toLowerCase(),
            downloads: [file.url],
            fileSize: file.size,
          };
        }
      },
      context.signal,
    );
    return this.listUnlocked(id);
  }
  async toggle(id: string, fileName: string, enabled: boolean): Promise<void> {
    modFile(fileName);
    if (typeof enabled !== "boolean") throw new Error("无效启用状态");
    return this.locked(id, () =>
      this.transaction(id, async (dir, sources) => {
        const next =
          fileName.replace(/\.disabled$/i, "") + (enabled ? "" : ".disabled");
        const source = await safeDestination(dir, fileName);
        await lstat(source);
        if (next === fileName) return;
        try {
          await lstat(join(dir, next));
          throw new Error("目标 Mod 已存在");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        await rename(source, join(dir, next));
        if (sources[fileName]) {
          sources[next] = sources[fileName];
          delete sources[fileName];
        }
      }),
    );
  }
  async remove(id: string, fileName: string): Promise<void> {
    modFile(fileName);
    return this.locked(id, () =>
      this.transaction(id, async (dir, sources) => {
        await rm(await safeDestination(dir, fileName));
        delete sources[fileName];
      }),
    );
  }
  async importJar(id: string, path: string): Promise<void> {
    const name = modFile(basename(path));
    if (!name.endsWith(".jar") || !(await lstat(path)).isFile())
      throw new Error("请选择普通 JAR 文件");
    return this.locked(id, () =>
      this.transaction(id, async (dir) => {
        if (
          (await readdir(dir)).some(
            (existing) => fileKey(existing.replace(/\.disabled$/i, "")) === fileKey(name),
          )
        )
          throw new Error("Mod 已存在");
        await copyFile(path, join(dir, name));
      }),
    );
  }
  async batch(id: string, action: ModBatchAction, items: ModBatchItem[], context?: TaskContext): Promise<ModBatchResult[]> {
    validateBatch(action, items);
    const results: ModBatchResult[] = [];
    // Per-item publication intentionally preserves independently completed items.
    for (const item of items) {
      if (context?.signal.aborted) {
        results.push({fileName:item.fileName,status:"skipped",error:"已取消"});
        continue;
      }
      try {
        await this.locked(id, async () => {
          const current = (await this.listUnlocked(id)).find(m => m.fileName === item.fileName);
          if (!current || current.sha1 !== item.sha1) throw new Error("Mod 已发生变化，请刷新后重新选择");
          if (action === "update") {
            if (!context || !item.versionId || !current.projectId) throw new Error("缺少可验证的更新来源");
            const version = await this.modrinth.version(item.versionId, context.signal);
            if (version.project_id !== current.projectId) throw new Error("更新项目不匹配");
            await this.installInto(id, item.versionId, context);
          } else await this.transaction(id, async (dir, sources) => {
            const path = await safeDestination(dir, item.fileName);
            if (createHash("sha1").update(await readFile(path)).digest("hex") !== item.sha1) throw new Error("Mod 已发生变化，请刷新后重新选择");
            if (action === "remove") {
              await rm(path); delete sources[item.fileName]; return;
            }
            const next = item.fileName.replace(/\.disabled$/i, "") + (action === "disable" ? ".disabled" : "");
            if (next === item.fileName) return;
            if ((await readdir(dir)).some(n => fileKey(n) === fileKey(next))) throw new Error("目标 Mod 已存在");
            await rename(path, join(dir, next));
            if (sources[item.fileName]) {sources[next] = sources[item.fileName]; delete sources[item.fileName];}
          }, context?.signal);
        });
        results.push({fileName:item.fileName,status:"completed"});
      } catch (error) {
        results.push({fileName:item.fileName,status:context?.signal.aborted ? "skipped" : "failed",error:error instanceof Error ? error.message : String(error)});
      }
      context?.report(results.length / items.length);
    }
    return results;
  }
  private batchResults = new Map<string, ModBatchResult[]>();
  startBatchUpdate(id: string, items: ModBatchItem[]): string {
    validateBatch("update", items);
    const reviewed = items.map(item => ({...item}));
    const completed = new Set<string>();
    // A retried historical task can be invoked more than once. Serialize this family's
    // attempts so an overlapping retry cannot replay an already published item.
    let priorAttempt: Promise<unknown> = Promise.resolve();
    return this.tasks.start("批量更新 Mod", context => {
      const attempt = priorAttempt.catch(() => {}).then(async () => {
        if (!context.taskId) throw new Error("缺少任务执行标识");
        const pending = reviewed.filter(item => !completed.has(item.fileName));
        const actual = pending.length ? await this.batch(id, "update", pending, context) : [];
        for (const result of actual) if (result.status === "completed") completed.add(result.fileName);
        const results: ModBatchResult[] = reviewed.map(item =>
          actual.find(result => result.fileName === item.fileName) ??
          {fileName:item.fileName,status:"skipped",reason:"previously-completed"});
        // Each execution owns an immutable report under its actual TaskService ID.
        this.batchResults.set(context.taskId, results.map(result => ({...result})));
        if (context.signal.aborted) throw new Error("批量更新已取消");
        if (results.some(result => result.status !== "completed" && result.reason !== "previously-completed"))
          throw new Error("部分 Mod 更新失败，请查看逐项结果");
        return results;
      });
      priorAttempt = attempt;
      return attempt;
    });
  }

  batchResult(taskId: string): ModBatchResult[] | null {
    return this.batchResults.get(taskId)?.map(r => ({...r})) ?? null;
  }
  async importMany(id: string, paths: string[]): Promise<ModBatchResult[]> {
    if (!Array.isArray(paths) || !paths.length || paths.length > 200) throw new Error("请选择 1 至 200 个文件");
    const results: ModBatchResult[] = [];
    for (const path of paths) {
      try {await this.importJar(id,path); results.push({fileName:basename(path),status:"completed"});}
      catch(error) {results.push({fileName:basename(path),status:"failed",error:error instanceof Error ? error.message : String(error)});}
    }
    return results;
  }
  async checkUpdates(id: string): Promise<ModUpdate[]> {
    return (await this.checkUpdatesDetailed(id)).updates;
  }
  async checkUpdatesDetailed(id: string): Promise<ModUpdateCheck> {
    const instance = await this.instances.get(id);
    const result: ModUpdateCheck = {updates:[], errors:[]};
    for (const mod of await this.list(id)) {
      if (!mod.projectId || !mod.versionId) continue;
      try {
        const versions = await this.modrinth.versions(mod.projectId, {
          minecraft: instance.minecraft, loader: instance.loader?.kind,
        });
        const latest = versions[0], current = versions.find(v => v.id === mod.versionId);
        if (latest && latest.id !== mod.versionId && (!current || latest.date_published > current.date_published))
          result.updates.push({fileName:mod.fileName,projectId:mod.projectId,currentVersionId:mod.versionId,version:latest});
      } catch(error) {result.errors.push({fileName:mod.fileName,error:error instanceof Error ? error.message : String(error)});}
    }
    return result;
  }
}
export function validateBatch(action: ModBatchAction, items: ModBatchItem[]): void {
  if (!["enable","disable","remove","update"].includes(action) || !Array.isArray(items) || !items.length || items.length > 200) throw new Error("批量操作须选择 1 至 200 个 Mod");
  const seen = new Set<string>();
  for (const item of items) {
    if (!item || typeof item !== "object" || Object.keys(item).some(k => !["fileName","sha1","versionId"].includes(k)) || typeof item.fileName !== "string" || typeof item.sha1 !== "string" || !/^[a-f0-9]{40}$/i.test(item.sha1)) throw new Error("无效 Mod 快照");
    modFile(item.fileName);
    const key = fileKey(item.fileName);
    if (seen.has(key)) throw new Error("重复 Mod 文件名");
    seen.add(key);
    if (action === "update" && (typeof item.versionId !== "string" || !item.versionId || item.versionId.length > 200 || /[\x00-\x1f]/.test(item.versionId))) throw new Error("无效更新版本");
    if (action !== "update" && item.versionId !== undefined) throw new Error("无效参数字段");
  }
}
