import type { LoaderKind } from "./types";
export interface MissingPackFile {
  projectID: number;
  fileID: number;
}
export interface PackPreview {
  format: "modrinth" | "curseforge" | "hmcl" | "multimc" | "mcbbs" | "minecraft-zip";
  manifestPath?: string;
  archivePrefix?: string;
  warnings?: string[];
  name: string;
  minecraft: string;
  loader?: { kind: LoaderKind; version: string };
  missingFiles: MissingPackFile[];
  files: PackFile[];
  overrides: string;
  /** Vanilla versions found in a plain .minecraft/launcher export. */
  vanillaVersions?: { id: string; type?: string; rootPrefix: string }[];
}
export interface PackFile {
  path: string;
  downloads: string[];
  hashes: { sha1?: string; sha256?: string };
  fileSize: number;
  env?: { client?: "required" | "optional" | "unsupported"; server?: string };
}
export interface PackInstallOptions {
  /** Required when a plain Minecraft ZIP contains multiple vanilla versions. */
  selectedVersionId?: string;
  suppliedFiles?: {
    projectID: number;
    fileID: number;
    path: string;
    sha1: string;
    target?: "mods" | "resourcepacks" | "shaderpacks";
  }[];
  includeOptional?: boolean;
  curseForgeKey?: string;
}
export interface PackExportOptions {
  /** Empty by default. Relative paths selected from preview.overrides. */
  overridePaths?: string[];
}
export interface PackExportPreview {
  overrides: { path: string; size: number }[];
  references: PackFile[];
}
