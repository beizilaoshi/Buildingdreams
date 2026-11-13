import { LibraryInfo, MinecraftFolder } from "@xmcl/core";
import { resolveProcessors, type InstallProfile } from "@xmcl/installer";
import { open, readAllEntries, readEntry } from "@xmcl/unzip";
import { isAbsolute, relative, sep, resolve } from "node:path";
import { lstatSync } from "node:fs";
import { contained, NetworkService } from "./network";
import { secureLibraryUrl, versionSegment } from "./install";

function archivePath(path: string): void {
  if (
    !path ||
    /[\\:\x00-\x1f]/.test(path) ||
    path.startsWith("/") ||
    path.split("/").some((part) => part === ".." || part === ".")
  )
    throw new Error("安装包包含无效路径");
}
export function checkInstallerDestination(root: string, path: string): void {
  const target = contained(root, path);
  let current = resolve(root);
  for (const component of ["", ...relative(current, target).split(sep)]) {
    current = resolve(current, component);
    try {
      if (lstatSync(current).isSymbolicLink())
        throw new Error("安装路径包含符号链接");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
function coordinate(root: string, name: string): void {
  if (
    typeof name !== "string" ||
    !/^[a-zA-Z0-9_\-]+(?:\.[a-zA-Z0-9_\-]+)*:[a-zA-Z0-9_.\-]+:[a-zA-Z0-9_.+\-]+(?::[a-zA-Z0-9_.\-]+)?(?:@[a-zA-Z0-9]+)?$/.test(
      name,
    )
  )
    throw new Error("无效 Maven 安装路径");
  const path = LibraryInfo.resolve(name).path;
  archivePath(path);
  checkInstallerDestination(root, "libraries/" + path);
}
function libraries(
  root: string,
  items: unknown,
  network: NetworkService,
): void {
  if (!Array.isArray(items)) throw new Error("无效安装依赖清单");
  for (const library of items) {
    coordinate(root, library.name);
    if (library.url) network.validateUrl(secureLibraryUrl(library.url));
    for (const artifact of [
      library.downloads?.artifact,
      ...Object.values(library.downloads?.classifiers ?? {}),
    ] as { path?: string; url?: string }[]) {
      if (!artifact) continue;
      if (artifact.path !== undefined) {
        archivePath(artifact.path);
        checkInstallerDestination(root, "libraries/" + artifact.path);
      }
      if (artifact.url) network.validateUrl(secureLibraryUrl(artifact.url));
    }
  }
}
/** Validate all metadata consumed by XMCL before it extracts or downloads anything. */
export async function preflightInstaller(
  jar: string,
  root: string,
  minecraft: string,
  network: NetworkService,
): Promise<void> {
  const zip = await open(jar, { lazyEntries: true, autoClose: false });
  try {
    const entries = await readAllEntries(zip);
    for (const entry of entries) {
      archivePath(entry.fileName);
      if (((entry.externalFileAttributes >>> 16) & 0xf000) === 0xa000)
        throw new Error("安装包包含符号链接路径");
      // XMCL extracts selected maven and data entries; validate their complete source names first.
      if (entry.fileName.startsWith("maven/"))
        checkInstallerDestination(root, "libraries/" + entry.fileName.slice(6));
    }
    const json = async (name: string): Promise<any> => {
      const entry = entries.find((item) => item.fileName === name);
      if (!entry || entry.uncompressedSize > 8 * 1024 * 1024)
        throw new Error("安装包缺少有效清单: " + name);
      return JSON.parse((await readEntry(zip, entry)).toString("utf8"));
    };
    // Universal-only legacy Forge contains no profile and extracts no profile-derived paths.
    if (!entries.some((entry) => entry.fileName === "install_profile.json"))
      return;
    const profile = await json("install_profile.json");
    const version = entries.some((entry) => entry.fileName === "version.json")
      ? await json("version.json")
      : profile.versionInfo;
    if (!version) throw new Error("安装包缺少版本清单");
    versionSegment(version.id);
    checkInstallerDestination(
      root,
      `versions/${version.id}/${version.id}.json`,
    );
    if (version.inheritsFrom !== undefined)
      versionSegment(version.inheritsFrom);
    libraries(root, version.libraries, network);
    if (profile.versionInfo) return; // Legacy installer does not run modern profile processors.
    versionSegment(profile.version);
    versionSegment(profile.minecraft);
    if (profile.minecraft !== minecraft || version.id !== profile.version)
      throw new Error("安装包版本清单不一致");
    libraries(root, profile.libraries, network);
    if (profile.path) coordinate(root, profile.path);
    for (const values of Object.values(profile.data ?? {}) as Record<
      string,
      string
    >[]) {
      for (const value of Object.values(values)) {
        if (typeof value !== "string") throw new Error("无效处理器数据路径");
        if (value.startsWith("[") && value.endsWith("]"))
          coordinate(root, value.slice(1, -1));
        else if (/(^|[\\/])\.\.([\\/]|$)/.test(value))
          throw new Error("处理器数据路径超出目录");
      }
    }
    for (const processor of profile.processors ?? []) {
      coordinate(root, processor.jar);
      for (const name of processor.classpath) coordinate(root, name);
    }
    // unpackForgeInstaller replaces these archive-relative aliases before processing.
    // Use the already-contained installer path as a validation stand-in for their generated Maven paths.
    const processorProfile = structuredClone(profile);
    processorProfile.data ??= {};
    processorProfile.data.INSTALLER = { client: jar, server: jar };
    for (const side of ["client", "server"]) {
      if (entries.some((entry) => entry.fileName === `data/${side}.lzma`)) {
        processorProfile.data.BINPATCH ??= {};
        processorProfile.data.BINPATCH[side] = jar;
      }
    }
    const processors = resolveProcessors(
      "client",
      processorProfile as InstallProfile,
      MinecraftFolder.from(root),
    );
    for (const processor of processors) {
      for (const path of Object.keys(processor.outputs ?? {}))
        checkInstallerDestination(root, path.replace(/^'|'$/g, ""));
      for (const argument of processor.args) {
        const value = argument.replace(/^'|'$/g, "").replace(/^--?[^=]+=/, "");
        if (/^https?:\/\//.test(value)) {
          network.validateUrl(value);
          continue;
        }
        if (
          isAbsolute(value) ||
          /^[a-z]:/i.test(value) ||
          /(^|[\\/])\.\.([\\/]|$)/.test(value)
        )
          checkInstallerDestination(root, value);
      }
    }
  } finally {
    zip.close();
  }
}
