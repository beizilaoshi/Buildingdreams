import { randomUUID, createHash } from "node:crypto";
import {
  mkdir,
  readFile,
  writeFile,
  rm,
  rename,
  lstat,
  readdir,
} from "node:fs/promises";
import { createReadStream, createWriteStream } from "node:fs";
import { join, dirname, basename } from "node:path";
import { pipeline } from "node:stream/promises";
import { Transform } from "node:stream";
import { ZipFile } from "yazl";
import type { Instance, LoaderKind } from "../../shared/types";
import type {
  PackPreview,
  PackFile,
  PackInstallOptions,
  PackExportPreview,
  PackExportOptions,
} from "../../shared/packs";
import { archivePath, readArchive } from "./archive";
import { detectPack, parseLegacyPack } from "./pack-formats";
import { contained, safeDestination } from "./network";
import { InstallService, instanceName, versionSegment } from "./install";
import { newPackName } from "../../shared/content";
import type { LoaderService } from "./loaders";
import type { TaskContext } from "./tasks";
import type { ContentSource } from "./content-provider";
const kinds: Record<string, LoaderKind> = {
  "fabric-loader": "fabric",
  "quilt-loader": "quilt",
  forge: "forge",
  neoforge: "neoforge",
};
export function parsePack(
  raw: any,
  format: PackPreview["format"],
): PackPreview {
  if (!raw || typeof raw.name !== "string" || !Array.isArray(raw.files))
    throw new Error("无效整合包清单");
  let minecraft: string, loader: PackPreview["loader"];
  if (format === "modrinth") {
    if (
      raw.formatVersion !== 1 ||
      raw.game !== "minecraft" ||
      !raw.dependencies ||
      typeof raw.versionId !== "string"
    )
      throw new Error("无效 Modrinth 整合包");
    minecraft = versionSegment(raw.dependencies.minecraft);
    for (const [key, value] of Object.entries(raw.dependencies)) {
      if (key === "minecraft") continue;
      if (!kinds[key] || loader) throw new Error("不支持的整合包依赖");
      loader = { kind: kinds[key], version: versionSegment(value as string) };
    }
    const paths = new Set<string>();
    for (const f of raw.files) {
      archivePath(f.path);
      if (f.path.endsWith("/") || paths.has(f.path.toLowerCase()))
        throw new Error("重复整合包路径");
      paths.add(f.path.toLowerCase());
      if (
        !Array.isArray(f.downloads) ||
        !f.downloads.length ||
        f.downloads.some(
          (u: unknown) =>
            typeof u !== "string" || new URL(u).protocol !== "https:",
        ) ||
        !Number.isSafeInteger(f.fileSize) ||
        f.fileSize < 0 ||
        (!/^[a-f0-9]{40}$/i.test(f.hashes?.sha1 ?? "") &&
          !/^[a-f0-9]{64}$/i.test(f.hashes?.sha256 ?? ""))
      )
        throw new Error("整合包文件缺少有效下载校验");
      if (
        f.env?.client &&
        !["required", "optional", "unsupported"].includes(f.env.client)
      )
        throw new Error("无效客户端环境");
    }
  } else {
    if (format !== "curseforge") throw new Error("请使用传统整合包解析器");
    if (
      raw.manifestType !== "minecraftModpack" ||
      raw.manifestVersion !== 1 ||
      !raw.minecraft ||
      !Array.isArray(raw.minecraft.modLoaders)
    )
      throw new Error("无效 CurseForge 整合包");
    minecraft = versionSegment(raw.minecraft.version);
    for (const l of raw.minecraft.modLoaders) {
      if (l.primary === false) continue;
      const match = /^(forge|fabric|quilt|neoforge)-(.+)$/.exec(l.id);
      if (!match || loader) throw new Error("不支持的加载器");
      loader = {
        kind: match[1] as LoaderKind,
        version: versionSegment(match[2]),
      };
    }
    for (const f of raw.files)
      if (
        !Number.isSafeInteger(f.projectID) ||
        f.projectID <= 0 ||
        !Number.isSafeInteger(f.fileID) ||
        f.fileID <= 0
      )
        throw new Error("无效 CurseForge 文件标识");
  }
  const overrides =
    format === "modrinth" ? "overrides" : (raw.overrides ?? "overrides");
  archivePath(overrides);
  return {
    format,
    name: instanceName(raw.name),
    minecraft,
    loader,
    files: format === "modrinth" ? raw.files : [],
    overrides,
    missingFiles:
      format === "curseforge"
        ? raw.files
            .filter((f: any) => f.required !== false)
            .map((f: any) => ({ projectID: f.projectID, fileID: f.fileID }))
        : [],
  };
}
function publishable(path: string): boolean {
  return (
    /^(config|mods|resourcepacks|shaderpacks|kubejs|scripts|defaultconfigs)\//.test(
      path,
    ) &&
    !/(^|\/)\.zhumeng-/i.test(path) &&
    !/(^|\/)(accounts?[^/]*|.*token.*|.*secret.*|logs?|saves|worlds?)(\/|\.|$)/i.test(
      path,
    )
  );
}
async function sha1(file: string) {
  const hash = createHash("sha1");
  for await (const c of createReadStream(file)) hash.update(c);
  return hash.digest("hex");
}
export class PackService {
  private onlineNameLocks = new Map<string, Promise<unknown>>();
  private async withOnlineName<T>(
    name: string,
    job: () => Promise<T>,
  ): Promise<T> {
    const key = name.toLocaleLowerCase();
    const next = (this.onlineNameLocks.get(key) ?? Promise.resolve())
      .catch(() => {})
      .then(job);
    this.onlineNameLocks.set(key, next);
    try {
      return await next;
    } finally {
      if (this.onlineNameLocks.get(key) === next)
        this.onlineNameLocks.delete(key);
    }
  }
  constructor(
    readonly installService: InstallService,
    readonly loaders: LoaderService,
    readonly modrinth?: ContentSource,
    readonly secret: () => Promise<string | undefined> = async () => undefined,
    readonly curseforge?: ContentSource,
  ) {}
  private async validateSupplied(file: string): Promise<void> {
    const info = await lstat(file);
    if (
      !info.isFile() ||
      info.isSymbolicLink() ||
      info.size > 2 * 1024 * 1024 * 1024
    )
      throw new Error("无效补齐文件");
  }
  async hashSupplied(file: string): Promise<string> {
    await this.validateSupplied(file);
    return sha1(file);
  }
  private async copySupplied(
    source: string,
    root: string,
    path: string,
    expected: string,
    context: TaskContext,
  ) {
    await this.validateSupplied(source);
    const target = await safeDestination(root, path);
    await mkdir(dirname(target), { recursive: true });
    const hash = createHash("sha1");
    let size = 0;
    const guard = new Transform({
      transform(chunk, _encoding, done) {
        size += chunk.length;
        hash.update(chunk);
        done(
          size > 2 * 1024 * 1024 * 1024 ? new Error("补齐文件过大") : null,
          chunk,
        );
      },
    });
    await pipeline(
      createReadStream(source),
      guard,
      createWriteStream(target, { flags: "wx" }),
      { signal: context.signal },
    );
    if (hash.digest("hex") !== expected.toLowerCase())
      throw new Error("补齐文件 SHA1 不匹配");
  }
  async inspect(file: string): Promise<PackPreview> {
    const zip = await readArchive(file);
    try {
      let descriptor;
      try {
        descriptor = detectPack(zip.entries.map(e => e.fileName));
      } catch (error) {
        if (!(error instanceof Error) || !error.message.startsWith("未识别的整合包格式")) throw error;
        return await this.inspectPlainMinecraftZip(zip);
      }
      const raw = JSON.parse((await zip.read(descriptor.manifestPath)).toString("utf8"));
      let format = descriptor.format;
      if (format === "minecraft-zip") throw new Error("整合包清单格式无效");
      // MCBBS also permits its metadata under manifest.json.
      if (format === "curseforge" && Array.isArray(raw.addons) && raw.manifestType !== "minecraftModpack") format = "mcbbs";
      const preview = format === "modrinth" || format === "curseforge"
        ? parsePack(raw, format)
        : parseLegacyPack(raw, format, format === "multimc" ? (await zip.read(descriptor.prefix + "instance.cfg", 1024 * 1024)).toString("utf8") : "",
          zip.entries.map(e => e.fileName).filter(n => n.startsWith(descriptor.prefix)).map(n => n.slice(descriptor.prefix.length)));
      return {...preview, manifestPath: descriptor.manifestPath, archivePrefix: descriptor.prefix,
        overrides: descriptor.prefix + preview.overrides};
    } finally {
      zip.close();
    }
  }
  private async inspectPlainMinecraftZip(zip: Awaited<ReturnType<typeof readArchive>>): Promise<PackPreview> {
    const versions: NonNullable<PackPreview["vanillaVersions"]> = [];
    const entries = zip.entries.map((entry) => entry.fileName);
    const seen = new Set<string>();
    for (const path of entries) {
      const parts = path.split("/");
      const marker = parts.findIndex((part) => part.toLowerCase() === "versions");
      if (marker < 0 || marker + 2 >= parts.length) continue;
      const id = parts[marker + 1];
      if (parts[marker + 2] !== `${id}.json` || path.endsWith("/")) continue;
      const rootPrefix = parts.slice(0, marker).join("/") + (marker ? "/" : "");
      // Accept only a direct versions/ tree or a conventional .minecraft/versions tree.
      if (marker !== 0 && parts[marker - 1].toLowerCase() !== ".minecraft") continue;
      try { versionSegment(id); } catch { continue; }
      const key = `${rootPrefix.toLowerCase()}\0${id.toLowerCase()}`;
      if (seen.has(key)) continue;
      let raw: any;
      try { raw = JSON.parse((await zip.read(path, 4 * 1024 * 1024)).toString("utf8")); }
      catch { continue; }
      if (!this.isPlainVanillaMetadata(raw, id)) continue;
      seen.add(key);
      versions.push({ id, ...(typeof raw.type === "string" ? { type: raw.type } : {}), rootPrefix });
    }
    if (!versions.length) throw new Error("此 ZIP 不是可安全导入的标准 Minecraft 版本目录；自定义版本、加载器与启动配置暂不支持");
    const ids = new Set<string>();
    for (const candidate of versions) {
      const key = candidate.id.toLowerCase();
      if (ids.has(key)) throw new Error("ZIP 中存在多个同名版本目录，无法安全确定对应的 .minecraft 内容");
      ids.add(key);
    }
    versions.sort((a, b) => a.id.localeCompare(b.id));
    return {
      format: "minecraft-zip",
      name: "导入的 Minecraft 游戏文件",
      minecraft: versions.length === 1 ? versions[0].id : "",
      files: [], missingFiles: [], overrides: "",
      warnings: ["将通过 Mojang 官方清单重新安装所选原版；仅导入 mods、config、resourcepacks、shaderpacks、kubejs、scripts、defaultconfigs 文件夹。版本 JSON、JAR、库、存档和启动器配置不会从 ZIP 导入。"],
      vanillaVersions: versions,
    };
  }
  private isPlainVanillaMetadata(raw: any, id: string): boolean {
    if (!raw || typeof raw !== "object" || Array.isArray(raw) || raw.id !== id || raw.inheritsFrom !== undefined) return false;
    const allowed = new Set(["id", "type", "time", "releaseTime", "minimumLauncherVersion", "assets", "assetIndex", "downloads", "libraries", "mainClass", "arguments", "minecraftArguments", "logging", "javaVersion", "complianceLevel"]);
    if (Object.keys(raw).some((key) => !allowed.has(key))) return false;
    // A launcher ZIP's profile is only a hint for finding a version ID. Restrict
    // it to the known vanilla entry points and dependency namespaces so an
    // OptiFine/custom profile cannot be advertised as a vanilla import.
    const vanillaMainClasses = new Set([
      "net.minecraft.client.main.Main",
      "net.minecraft.client.Minecraft",
    ]);
    const vanillaLibraryGroups = new Set([
      "at.yawk.lz4", "ca.weblite", "com.azure", "com.fasterxml.jackson.core",
      "com.github.oshi", "com.github.stephenc.jcip", "com.google.code.findbugs", "com.google.code.gson",
      "com.google.errorprone", "com.google.guava", "com.google.j2objc",
      "com.ibm.icu", "com.microsoft.azure", "com.mojang", "com.nimbusds",
      "com.paulscode", "commons-codec", "commons-io", "commons-logging", "io.netty",
      "it.unimi.dsi", "java3d", "net.java.dev.jna", "net.java.jinput",
      "net.java.jutils", "net.minecraft", "net.minidev", "net.sf.jopt-simple",
      "net.sf.trove4j", "org.apache.commons", "org.apache.httpcomponents",
      "org.apache.logging.log4j", "org.jcraft", "org.jetbrains", "org.joml",
      "org.jspecify", "org.lz4", "org.lwjgl", "org.lwjgl.lwjgl", "org.ow2.asm",
      "org.slf4j", "oshi-project", "tv.twitch",
    ]);
    if (typeof raw.mainClass !== "string" || !vanillaMainClasses.has(raw.mainClass) || !Array.isArray(raw.libraries) || !raw.downloads?.client ||
      typeof raw.downloads.client.url !== "string" || typeof raw.downloads.client.sha1 !== "string" ||
      !/^https:\/\//i.test(raw.downloads.client.url) ||
      !/^[a-f0-9]{40}$/i.test(raw.downloads.client.sha1)) return false;
    // Recognize only vanilla-style launcher metadata. The ZIP's executable
    // metadata is never installed or used; the official manifest is fetched
    // afresh during installation.
    for (const library of raw.libraries) {
      if (!library || typeof library.name !== "string" || /optifine|fabric-loader|quilt-loader|forge|neoforge/i.test(library.name)) return false;
      const coordinates = /^([A-Za-z0-9_.-]+):([A-Za-z0-9_.-]+):([A-Za-z0-9_.+\-]+)(?::[A-Za-z0-9_.-]+)?(?:@[A-Za-z0-9]+)?$/.exec(library.name);
      if (!coordinates || !vanillaLibraryGroups.has(coordinates[1])) return false;
    }
    return typeof raw.assets === "string" || (!!raw.assetIndex && typeof raw.assetIndex.id === "string");
  }
  install(
    file: string,
    name: string,
    options: PackInstallOptions = {},
  ): string {
    return this.installService.tasks.start(
      `导入整合包 ${instanceName(name)}`,
      (c) => this.installFile(file, name, options, c),
    );
  }
  private async installFile(
    file: string,
    name: string,
    options: PackInstallOptions,
    context: TaskContext,
  ) {
    const preview = await this.inspect(file),
      service = this.installService,
      id = randomUUID(),
      root = contained(service.root, id),
      gameDir = join(root, "game");
    if (preview.format !== "minecraft-zip" && options.selectedVersionId !== undefined)
      throw new Error("版本选择参数仅适用于普通 Minecraft ZIP");
    const zip = await readArchive(file);
    try {
      if (preview.format === "minecraft-zip") {
        const candidates = preview.vanillaVersions ?? [];
        const selectedId = options.selectedVersionId ?? (candidates.length === 1 ? candidates[0].id : undefined);
        if (!selectedId || !candidates.some((candidate) => candidate.id === selectedId))
          throw new Error(candidates.length > 1 ? "请明确选择要导入的 Minecraft 原版版本" : "所选版本不在 ZIP 检查结果中");
        const selectedVersion = candidates.find((candidate) => candidate.id === selectedId)!;
        if (options.suppliedFiles?.length || options.curseForgeKey || options.includeOptional !== undefined)
          throw new Error("原版 ZIP 导入不接受整合包补齐参数");
        await mkdir(gameDir, { recursive: true });
        await service.installInto(root, selectedId, context);
        const allowedUserDirs = ["mods", "config", "resourcepacks", "shaderpacks", "kubejs", "scripts", "defaultconfigs"];
        for (const dir of allowedUserDirs) {
          context.signal.throwIfAborted();
          await zip.extract(gameDir, `${selectedVersion.rootPrefix}${dir}/`, context.signal);
        }
        let item: Instance = await service.instances.applyNewDefaults({
          id, name: instanceName(name), resourceDir: root, gameDir,
          minecraft: selectedId, versionId: selectedId, status: "ready",
          memoryMb: 2048, javaArgs: [],
        });
        context.signal.throwIfAborted();
        return await service.instances.registerOwned(item, context.signal);
      }
      const downloads: PackFile[] = [...preview.files];
      const localFiles: { source: string; path: string; sha1: string }[] = [];
      for (const missing of preview.missingFiles) {
        context.signal.throwIfAborted();
        const supplied = options.suppliedFiles?.find(
          (f) =>
            f.projectID === missing.projectID && f.fileID === missing.fileID,
        );
        if (supplied) {
          const target =
            supplied.target ??
            (/\.jar$/i.test(supplied.path) ? "mods" : undefined);
          if (
            !target ||
            !["mods", "resourcepacks", "shaderpacks"].includes(target)
          )
            throw new Error("补齐文件需要明确目标类型");
          await this.validateSupplied(supplied.path);
          if (!/^[a-f0-9]{40}$/i.test(supplied.sha1))
            throw new Error("无效补齐文件 SHA1");
          localFiles.push({
            source: supplied.path,
            path: target + "/" + basename(supplied.path),
            sha1: supplied.sha1,
          });
          continue;
        }
        const key = options.curseForgeKey ?? (await this.secret());
        if (!key && !this.curseforge)
          throw new Error(
            "CurseForge 缺少文件: " +
              JSON.stringify(
                preview.missingFiles.filter(
                  (m) =>
                    !options.suppliedFiles?.some(
                      (f) =>
                        f.projectID === m.projectID && f.fileID === m.fileID,
                    ),
                ),
              ),
          );
        let source = this.curseforge;
        if (!source || key) {
          const { CurseForgeContent } = await import("./curseforge-content");
          // Legacy local-import submission stays main-only; never persisted or exported.
          const { ProviderSecrets } = await import("./provider-secrets");
          const vault = new ProviderSecrets("", {
            isEncryptionAvailable: () => false,
            encryptString: () => {
              throw new Error();
            },
            decryptString: () => {
              throw new Error();
            },
          });
          await vault.set(key!, false);
          source = new CurseForgeContent(vault);
        }
        const project = await source.project(
          `cf:${missing.projectID}`,
          context.signal,
        );
        const version = await source.version(
          `cf:${missing.projectID}:${missing.fileID}`,
          context.signal,
        );
        if (
          !version.game_versions.includes(preview.minecraft) ||
          (project.projectType === "mod" &&
            preview.loader &&
            !version.loaders.includes(preview.loader.kind))
        )
          throw new Error("CurseForge 整合包引用文件不兼容");
        const file = version.files[0];
        const target = (
          {
            mod: "mods",
            resourcepack: "resourcepacks",
            shader: "shaderpacks",
          } as Record<string, string>
        )[project.projectType];
        if (
          !target ||
          !file?.url ||
          file.unavailableReason ||
          !file.hashes.sha1
        )
          throw new Error(
            "CurseForge 文件不可下载或缺少 SHA1；请在本地导入预览中补齐文件",
          );
        downloads.push({
          path: target + "/" + file.filename,
          downloads: [file.url],
          hashes: { sha1: file.hashes.sha1 },
          fileSize: file.size,
        });
      }
      const destinations = new Set<string>();
      for (const entry of [...downloads, ...localFiles]) {
        archivePath(entry.path);
        const canonical = entry.path.toLowerCase();
        if (destinations.has(canonical)) throw new Error("整合包文件路径碰撞");
        destinations.add(canonical);
      }
      await mkdir(gameDir, { recursive: true });
      for (const file of localFiles)
        await this.copySupplied(
          file.source,
          gameDir,
          file.path,
          file.sha1,
          context,
        );
      await service.installInto(root, preview.minecraft, context);
      let item: Instance = await service.instances.applyNewDefaults({
        id,
        name: instanceName(name),
        resourceDir: root,
        gameDir,
        minecraft: preview.minecraft,
        versionId: preview.minecraft,
        status: "ready",
        memoryMb: 2048,
        javaArgs: [],
      });
      if (preview.loader)
        item = {
          ...item,
          versionId: await this.loaders.installInto(
            root,
            item,
            preview.loader.kind,
            preview.loader.version,
            context,
          ),
          loader: preview.loader,
        };
      for (const f of downloads) {
        context.signal.throwIfAborted();
        archivePath(f.path);
        if (
          f.env?.client === "unsupported" ||
          (f.env?.client === "optional" && !options.includeOptional)
        )
          continue;
        let error: unknown;
        for (const url of f.downloads) {
          try {
            await service.network.download(
              gameDir,
              { url, path: f.path, size: f.fileSize, ...f.hashes },
              context,
            );
            error = undefined;
            break;
          } catch (e) {
            error = e;
            context.signal.throwIfAborted();
          }
        }
        if (error) throw error;
      }
      await zip.extract(
        gameDir,
        preview.overrides.replace(/\/$/, "") + "/",
        context.signal,
      );
      if (preview.format === "modrinth")
        await zip.extract(gameDir, (preview.archivePrefix ?? "") + "client-overrides/", context.signal);
      await writeFile(
        join(root, "pack-source.json"),
        JSON.stringify({
          preview,
          downloads,
          manifest: JSON.parse(
            (
              await zip.read(
                preview.manifestPath ?? (preview.format === "modrinth"
                  ? "modrinth.index.json"
                  : "manifest.json"),
              )
            ).toString("utf8"),
          ),
        }),
      );
      context.signal.throwIfAborted();
      return await service.instances.registerOwned(item, context.signal);
    } catch (e) {
      await rm(root, { recursive: true, force: true });
      throw e;
    } finally {
      zip.close();
    }
  }
  installOnline(
    projectId: string,
    versionId: string,
    filename: string,
    name: string,
  ): string {
    return this.installSelected(versionId, name, {}, { projectId, filename });
  }
  installModrinth(
    versionId: string,
    name: string,
    options: PackInstallOptions = {},
  ): string {
    return this.installSelected(versionId, name, options);
  }
  private installSelected(
    versionId: string,
    name: string,
    options: PackInstallOptions,
    selected?: { projectId: string; filename: string },
  ): string {
    name = newPackName(name);
    return this.installService.tasks.start(
      `安装在线整合包 ${instanceName(name)}`,
      async (c) =>
        this.withOnlineName(name, async () => {
          c.signal.throwIfAborted();
          if (!this.modrinth) throw new Error("未配置 Modrinth");
          if (
            (await this.installService.instances.list()).some(
              (item) =>
                item.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
            )
          )
            throw new Error("实例名称已存在，请使用其他名称");
          const version = await this.modrinth.version(versionId, c.signal);
          if (selected && version.project_id !== selected.projectId)
            throw new Error("项目与版本不匹配");
          if (
            selected &&
            (await this.modrinth.project(selected.projectId, c.signal))
              .projectType !== "modpack"
          )
            throw new Error("所选项目不是整合包");
          const file = selected
            ? version.files.find(
                (f) =>
                  f.filename === selected.filename &&
                  /\.(zip|mrpack)$/i.test(f.filename),
              )
            : (version.files.find(
                (f) => f.filename.endsWith(".mrpack") && f.primary,
              ) ?? version.files.find((f) => f.filename.endsWith(".mrpack")));
          if (
            !file ||
            !file.url ||
            file.unavailableReason ||
            (!file.hashes.sha1 && !file.hashes.sha256)
          )
            throw new Error("整合包缺少校验文件");
          const root = contained(this.installService.root, randomUUID());
          try {
            const path = await this.installService.network.download(
              root,
              {
                url: file.url,
                path: "pack.mrpack",
                size: file.size,
                ...file.hashes,
              },
              c,
            );
            return await this.installFile(path, name, options, c);
          } finally {
            await rm(root, { recursive: true, force: true });
          }
        }),
    );
  }
  private async exportInventory(instanceId: string) {
    const item = await this.installService.instances.get(instanceId);
    let source:
      | {
          preview: PackPreview;
          downloads: PackFile[];
          manifest?: { versionId?: string };
        }
      | undefined;
    try {
      source = JSON.parse(
        await readFile(join(item.resourceDir, "pack-source.json"), "utf8"),
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const candidates: PackFile[] = [...(source?.downloads ?? [])];
    // New records retain URLs; resolve legacy Modrinth identity when available.
    try {
      const managed = JSON.parse(
        await readFile(
          await safeDestination(item.gameDir, "mods/.zhumeng-mods.json"),
          "utf8",
        ),
      );
      for (const [name, data] of Object.entries(managed) as [string, any][]) {
        if (!/^[a-f0-9]{40}$/i.test(data.sha1 ?? "")) continue;
        let downloads = data.downloads,
          fileSize = data.fileSize;
        if (
          !downloads?.length &&
          this.modrinth &&
          typeof data.versionId === "string" &&
          typeof data.projectId === "string"
        ) {
          try {
            const version = await this.modrinth.version(data.versionId);
            const file =
              version.project_id === data.projectId &&
              version.files.find(
                (f) =>
                  f.hashes?.sha1?.toLowerCase() === data.sha1.toLowerCase(),
              );
            if (file) {
              downloads = [file.url];
              fileSize = file.size;
            }
          } catch {
            /* Offline/unresolvable provenance remains an explicit override. */
          }
        }
        if (
          !Array.isArray(downloads) ||
          !downloads.length ||
          !Number.isSafeInteger(fileSize) ||
          fileSize < 0
        )
          continue;
        candidates.push({
          path: "mods/" + name,
          downloads,
          hashes: { sha1: data.sha1 },
          fileSize,
        });
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    const files: PackFile[] = [];
    for (const f of candidates) {
      archivePath(f.path);
      if (!publishable(f.path) || f.env?.client === "unsupported") continue;
      if (
        !f.downloads?.length ||
        f.downloads.some((url) => {
          try {
            return new URL(url).protocol !== "https:";
          } catch {
            return true;
          }
        })
      )
        continue;
      if (files.some((x) => x.path.toLowerCase() === f.path.toLowerCase()))
        continue;
      try {
        const path = await safeDestination(item.gameDir, f.path);
        let size = 0;
        const algorithm = f.hashes.sha256 ? "sha256" : "sha1";
        const hash = createHash(algorithm);
        for await (const chunk of createReadStream(path)) {
          hash.update(chunk);
          size += chunk.length;
        }
        if (
          hash.digest("hex") ===
            (f.hashes.sha256 ?? f.hashes.sha1)?.toLowerCase() &&
          size === f.fileSize
        )
          files.push(f);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    const overrides: PackExportPreview["overrides"] = [];
    async function walk(dir: string, prefix = "") {
      for (const entry of await readdir(dir, { withFileTypes: true })) {
        const path = prefix + entry.name;
        archivePath(path);
        if (entry.isSymbolicLink()) throw new Error("导出不能包含符号链接");
        if (entry.isDirectory()) {
          if (
            [
              "config",
              "mods",
              "resourcepacks",
              "shaderpacks",
              "kubejs",
              "scripts",
              "defaultconfigs",
            ].includes(path) ||
            publishable(path + "/")
          )
            await walk(join(dir, entry.name), path + "/");
        } else if (
          entry.isFile() &&
          publishable(path) &&
          !files.some((f) => f.path === path)
        ) {
          const info = await lstat(await safeDestination(item.gameDir, path));
          overrides.push({ path, size: info.size });
        }
      }
    }
    await walk(item.gameDir);
    overrides.sort((a, b) => a.path.localeCompare(b.path));
    return { item, source, files, overrides };
  }
  async previewExport(instanceId: string): Promise<PackExportPreview> {
    const inventory = await this.exportInventory(instanceId);
    return { overrides: inventory.overrides, references: inventory.files };
  }
  export(
    instanceId: string,
    destination: string,
    options: PackExportOptions = {},
  ): string {
    return this.installService.tasks.start("导出整合包", async (c) => {
      const { item, source, files, overrides } =
        await this.exportInventory(instanceId);
      const selected = new Set<string>();
      if (
        options.overridePaths !== undefined &&
        (!Array.isArray(options.overridePaths) ||
          options.overridePaths.length > 20000)
      )
        throw new Error("无效导出文件选择");
      for (const path of options.overridePaths ?? []) {
        archivePath(path);
        // Hard exclusions apply to direct IPC/service callers too.
        if (!publishable(path)) continue;
        if (!overrides.some((f) => f.path === path))
          throw new Error("导出文件已变化或不在可选列表: " + path);
        selected.add(path);
      }
      const zip = new ZipFile();
      const temporary = destination + "." + randomUUID() + ".partial";
      await mkdir(dirname(destination), { recursive: true });
      const dependencies: Record<string, string> = {
        minecraft: item.minecraft,
      };
      if (item.loader)
        dependencies[
          Object.keys(kinds).find((k) => kinds[k] === item.loader!.kind)!
        ] = item.loader.version;
      zip.addBuffer(
        Buffer.from(
          JSON.stringify(
            {
              formatVersion: 1,
              game: "minecraft",
              versionId: source?.manifest?.versionId ?? "1.0.0",
              name: item.name,
              dependencies,
              files,
            },
            null,
            2,
          ),
        ),
        "modrinth.index.json",
      );
      try {
        for (const path of selected) {
          c.signal.throwIfAborted();
          zip.addFile(
            await safeDestination(item.gameDir, path),
            "overrides/" + path,
          );
        }
        zip.end();
        await pipeline(
          zip.outputStream,
          createWriteStream(temporary, { flags: "wx" }),
          { signal: c.signal },
        );
        c.signal.throwIfAborted();
        await rename(temporary, destination);
      } finally {
        (zip.outputStream as import("node:stream").Readable).destroy();
        await rm(temporary, { force: true });
      }
    });
  }
}
