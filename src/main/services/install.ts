import {
  sortMinecraftVersions,
  type MinecraftCatalog,
} from "../../shared/minecraft-versions";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, access, rm } from "node:fs/promises";
import { join } from "node:path";
import { acquireInstallCache, installationLocation, inspectExistingInstall, type InstallLocation } from "./install-location";
import { Version, type ResolvedVersion } from "@xmcl/core";
import type { Instance } from "../../shared/types";
import { InstanceService } from "./instances";
import { NetworkService, contained, type DownloadSpec } from "./network";
import { TaskService, type TaskContext } from "./tasks";

export function versionSegment(value: string): string {
  // Official historical versions include spaces and Unicode (e.g. 20w14∞).
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 160 ||
    /[\\/:*?"<>|\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  )
    throw new Error("无效版本标识");
  return value;
}
export function instanceName(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 120 ||
    /[\\/:*?"<>|\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  )
    throw new Error("无效实例名称");
  return value.trim();
}
interface ManifestEntry {
  id: string;
  url: string;
  sha1?: string;
  type?: string;
  releaseTime?: string;
}
interface AssetIndex {
  objects: Record<string, { hash: string; size: number }>;
}
export class InstallService {
  private active = new Map<string, { fingerprint: string; taskId: string }>();
  preview(name: string, root = this.root): InstallLocation & { activeTaskId?: string } {
    const location = installationLocation(root, instanceName(name));
    const activeTaskId = this.active.get(location.resourceDir.toLowerCase())?.taskId;
    return { ...location, ...(activeTaskId ? { activeTaskId } : {}) };
  }
  async previewForUi(name: string, root = this.root): Promise<InstallLocation & { activeTaskId?: string; existingDirectory?: string; recoverableDirectory?: string }> {
    const location = this.preview(name, root);
    const existing = await inspectExistingInstall(location, instanceName(name));
    if (existing.recoverableDirectory && (await this.instances.list()).some(x => x.resourceDir.toLowerCase() === location.resourceDir.toLowerCase())) delete existing.recoverableDirectory;
    return { ...location, ...existing };
  }
  constructor(
    readonly instances: InstanceService,
    readonly tasks: TaskService,
    readonly network: NetworkService,
    public root: string,
    private sources: {
      manifestUrl?: string;
      assetUrl?: (hash: string) => string;
    } = {},
  ) {}
  async versions(signal?: AbortSignal): Promise<ManifestEntry[]> {
    return (await this.catalog(signal)).versions;
  }
  async catalog(signal?: AbortSignal): Promise<MinecraftCatalog> {
    const manifest = await this.network.json<{
      versions: ManifestEntry[];
      latest?: { release?: string; snapshot?: string };
    }>(
      this.sources.manifestUrl ??
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json",
      signal,
    );
    if (
      !manifest ||
      !Array.isArray(manifest.versions) ||
      manifest.versions.length > 10000
    )
      throw new Error("无效 Minecraft 清单");
    const ids = new Set<string>();
    const versions = sortMinecraftVersions(
      manifest.versions.map((entry) => {
        if (!entry || typeof entry !== "object")
          throw new Error("无效 Minecraft 清单项");
        versionSegment(entry.id);
        if (ids.has(entry.id)) throw new Error("重复 Minecraft 版本");
        ids.add(entry.id);
        if (typeof entry.url !== "string") throw new Error("无效版本地址");
        this.network.validateUrl(entry.url);
        if (
          entry.type !== undefined &&
          ![
            "release",
            "snapshot",
            "old_alpha",
            "old_beta",
            "special",
            "pending",
          ].includes(entry.type)
        )
          throw new Error("无效版本类型");
        if (
          entry.releaseTime !== undefined &&
          (typeof entry.releaseTime !== "string" ||
            entry.releaseTime.length > 64 ||
            !Number.isFinite(Date.parse(entry.releaseTime)))
        )
          throw new Error("无效版本时间");
        if (
          entry.sha1 !== undefined &&
          (typeof entry.sha1 !== "string" ||
            !/^[a-f0-9]{40}$/i.test(entry.sha1))
        )
          throw new Error("无效版本校验和");
        return {
          id: entry.id,
          url: entry.url,
          type: entry.type,
          sha1: entry.sha1,
          releaseTime: entry.releaseTime,
        };
      }),
    );
    const latest: MinecraftCatalog["latest"] = {};
    if (manifest.latest !== undefined) {
      if (!manifest.latest || typeof manifest.latest !== "object")
        throw new Error("无效最新版本信息");
      for (const kind of ["release", "snapshot"] as const) {
        const id = manifest.latest[kind];
        if (id !== undefined) {
          if (typeof id !== "string" || !ids.has(id))
            throw new Error("最新版本不存在");
          latest[kind] = id;
        }
      }
    }
    return { latest, versions };
  }
  installVanilla(
    name: string,
    version: string,
    prepare?: (item: Instance, context: TaskContext) => Promise<void>,
    options: { root?: string; loaderFingerprint?: string } = {},
  ): string {
    name = instanceName(name);
    versionSegment(version);
    const location = this.preview(name, options.root ?? this.root);
    const fingerprint = JSON.stringify({ name, version, loader: options.loaderFingerprint ?? "vanilla", root: location.installRoot });
    const key = location.resourceDir.toLowerCase();
    const existing = this.active.get(key);
    if (existing) {
      if (existing.fingerprint !== fingerprint) throw Error("安装目标正在用于其他配置");
      return existing.taskId;
    }
    if ([...this.active.values()].some(x => JSON.parse(x.fingerprint).name.toLowerCase() === name.toLowerCase())) throw Error("同名实例正在安装，请选择其他名称");
    const start = () => this.installVanilla(name, version, prepare, { root: location.installRoot, loaderFingerprint: options.loaderFingerprint });
    const taskId = this.tasks.start(`安装 ${name} / ${version}`, async (context) => {
      if ((await this.instances.list()).some((x) => x.name.toLowerCase() === name.toLowerCase()))
        throw new Error("实例已经存在，请选择其他名称");
      const locked = await acquireInstallCache(location, fingerprint);
      let promoted = false;
      const id = randomUUID();
      try {
        let progress = 0;
        const wrapped: TaskContext = { ...context, report: (p, rate) => {
          progress = Math.max(progress, Math.min(0.98, Math.max(0, p)));
          context.report(progress, rate);
        }};
        await this.installInto(locked.cache, version, wrapped);
        context.signal.throwIfAborted();
        const item: Instance = await this.instances.applyNewDefaults({
          id, name, versionId: version, minecraft: version,
          resourceDir: locked.cache, gameDir: join(locked.cache, "game"),
          status: "ready", memoryMb: 2048, javaArgs: [],
        });
        await Promise.all(["saves", "mods", "config", "resourcepacks", "shaderpacks"].map(x => mkdir(join(item.gameDir, x), { recursive: true })));
        if (prepare) await prepare(item, { ...wrapped, report: (p, rate) => wrapped.report(0.8 + Math.max(0, Math.min(1, p)) * 0.18, rate) });
        context.signal.throwIfAborted();
        // On Windows a directory rename fails if the destination already exists.
        // Check immediately before promotion for a useful error, and never remove it.
        try { await access(location.resourceDir); throw Error("安装目标已存在，请选择其他名称或目录"); }
        catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
        await rename(locked.cache, location.resourceDir);
        promoted = true;
        item.resourceDir = location.resourceDir;
        item.gameDir = location.gameDir;
        context.report(0.98);
        context.signal.throwIfAborted();
        const owned = this.instances as InstanceService & { registerOwned?: (item: Instance, signal?: AbortSignal) => Promise<Instance> };
        const result = owned.registerOwned ? await owned.registerOwned(item, context.signal) : await this.instances.register(item, undefined, context.signal);
        promoted = false;
        return result;
      } catch (error) {
        if (promoted) {
          // Only the directory promoted by this operation is moved back, and only
          // when its marker still matches; never delete an unfamiliar target.
          try {
            const marker = JSON.parse(await readFile(join(location.resourceDir, ".zhumeng-install-cache.json"), "utf8"));
            if (marker.schema === 1 && marker.fingerprint === fingerprint) {
              // registerOwned can write its receipt before the registry transaction fails.
              // Remove only the receipt for this new instance, never an unfamiliar one.
              const receiptPath = join(location.resourceDir, ".zhumeng-owner.json");
              try {
                const receipt = JSON.parse(await readFile(receiptPath, "utf8"));
                if (receipt.instanceId === id && receipt.root === location.resourceDir) await rm(receiptPath);
                else throw Error("所有权收据不匹配");
              } catch (receiptError) { if ((receiptError as NodeJS.ErrnoException).code !== "ENOENT") throw receiptError; }
              await rename(location.resourceDir, locked.cache);
            }
          } catch { /* leave ambiguous publication untouched */ }
        }
        throw error;
      } finally { await locked.release(); }
    }, start, () => { if (this.active.get(key)?.taskId === taskId) this.active.delete(key); });
    this.active.set(key, { fingerprint, taskId });
    return taskId;
  }
  async installInto(
    root: string,
    id: string,
    context: TaskContext,
  ): Promise<ResolvedVersion> {
    versionSegment(id);
    const phase = (start: number, end: number): TaskContext => ({ ...context, report: (p, rate) => context.report(start + (end - start) * Math.max(0, Math.min(1, p)), rate) });
    const meta = (await this.versions(context.signal)).find((x) => x.id === id);
    if (!meta) throw new Error("Minecraft 版本不存在");
    const path = `versions/${id}/${id}.json`;
    await this.network.download(
      root,
      { url: meta.url, path, sha1: meta.sha1 },
      phase(0, 0.1),
    );
    const raw = JSON.parse(await readFile(contained(root, path), "utf8"));
    this.validateProfile(raw, id);
    const version = await Version.parse(root, id);
    const client = version.downloads?.client;
    if (!client?.sha1) throw new Error("Minecraft 客户端缺少校验和");
    await this.network.download(
      root,
      { ...client, path: `versions/${id}/${id}.jar` },
      phase(0.1, 0.25),
    );
    const logging = version.logging?.client?.file;
    if (logging) {
      versionSegment(logging.id);
      if (!logging.sha1) throw new Error("日志配置缺少校验和");
      await this.network.download(
        root,
        { ...logging, path: `assets/log_configs/${logging.id}` },
        phase(0.25, 0.3),
      );
    }
    await this.dependencies(version, phase(0.3, 0.8));
    return version;
  }
  validateProfile(raw: Record<string, unknown>, expectedId: string): void {
    if (raw.id !== expectedId) throw new Error("版本清单标识不匹配");
    if (raw.inheritsFrom !== undefined)
      versionSegment(String(raw.inheritsFrom));
    if (!Array.isArray(raw.libraries)) throw new Error("无效依赖清单");
    for (const library of raw.libraries) {
      if (
        typeof library.name !== "string" ||
        !/^[a-zA-Z0-9_.\-]+:[a-zA-Z0-9_.\-]+:[a-zA-Z0-9_.+\-]+(?::[a-zA-Z0-9_.\-]+)?(?:@[a-zA-Z0-9]+)?$/.test(
          library.name,
        )
      )
        throw new Error("无效 Maven 依赖路径");
    }
  }
  async dependencies(
    version: ResolvedVersion,
    context: TaskContext,
    verifiedLocal = new Set<string>(),
  ): Promise<void> {
    const root = version.minecraftDirectory;
    const specs: DownloadSpec[] = [];
    for (const library of version.libraries) {
      context.signal.throwIfAborted();
      const path = "libraries/" + library.download.path;
      contained(root, path);
      if (!library.download.sha1 && verifiedLocal.has(library.download.path)) {
        await access(contained(root, path));
        continue;
      }
      if (!library.download.url) {
        // Forge processors produce local artifacts with no remote download URL.
        await access(contained(root, path));
        continue;
      }
      const url = secureLibraryUrl(library.download.url);
      let sha1 = library.download.sha1 || undefined;
      if (!sha1) {
        sha1 = (
          await (
            await this.network.response(url + ".sha1", context.signal)
          ).text()
        )
          .trim()
          .split(/\s/)[0];
        if (!/^[a-f0-9]{40}$/i.test(sha1))
          throw new Error("依赖缺少有效 SHA1: " + library.name);
      }
      specs.push({
        url,
        sha1,
        size: library.download.size >= 0 ? library.download.size : undefined,
        path,
      });
    }
    // Keep most of this phase for the library and asset worker pool.
    const indexShare = version.assetIndex ? 0.1 : 0;
    if (version.assetIndex) {
      versionSegment(version.assets);
      const path = `assets/indexes/${version.assets}.json`;
      if (!version.assetIndex.sha1) throw new Error("资源索引缺少校验和");
      await this.network.download(
        root,
        { ...version.assetIndex, path },
        { ...context, report: (progress, rate) => context.report(indexShare * progress, rate) },
      );
      const index = JSON.parse(
        await readFile(contained(root, path), "utf8"),
      ) as AssetIndex;
      if (!index.objects || typeof index.objects !== "object")
        throw new Error("无效资源索引");
      for (const asset of Object.values(index.objects)) {
        if (
          !/^[a-f0-9]{40}$/.test(asset.hash) ||
          !Number.isSafeInteger(asset.size) ||
          asset.size < 0
        )
          throw new Error("无效资源哈希或大小");
        specs.push({
          path: `assets/objects/${asset.hash.slice(0, 2)}/${asset.hash}`,
          sha1: asset.hash,
          size: asset.size,
          url:
            this.sources.assetUrl?.(asset.hash) ??
            `https://resources.download.minecraft.net/${asset.hash.slice(0, 2)}/${asset.hash}`,
        });
      }
    }
    // Settle every active worker before the caller removes a failed staging directory.
    let next = 0,
      completed = 0,
      failed: unknown;
    await Promise.all(
      Array.from({ length: Math.min(8, specs.length) }, async () => {
        while (next < specs.length && !failed) {
          const spec = specs[next++];
          try {
            await this.network.download(root, spec, {
              signal: context.signal,
              report: (_p, rate) =>
                context.report(indexShare + (1 - indexShare) * completed / specs.length, rate),
            });
            completed++;
            context.report(indexShare + (1 - indexShare) * completed / specs.length);
          } catch (error) {
            failed ??= error;
          }
        }
      }),
    );
    if (failed) throw failed;
    context.signal.throwIfAborted();
  }
}
export function secureLibraryUrl(value: string): string {
  // Historical Mojang profiles contain HTTP Maven URLs; request the same resource over TLS.
  const url = new URL(value);
  if (
    url.protocol === "http:" &&
    [
      "libraries.minecraft.net",
      "files.minecraftforge.net",
      "maven.minecraftforge.net",
    ].includes(url.hostname)
  )
    url.protocol = "https:";
  return url.href;
}
