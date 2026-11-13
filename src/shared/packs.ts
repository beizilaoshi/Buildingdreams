import type { LoaderKind } from "./types";
export interface MissingPackFile {
  projectID: number;
  fileID: number;
}
export interface PackPreview {
  format: "modrinth" | "curseforge";
  name: string;
  minecraft: string;
  loader?: { kind: LoaderKind; version: string };
  missingFiles: MissingPackFile[];
  files: PackFile[];
  overrides: string;
}
export interface PackFile {
  path: string;
  downloads: string[];
  hashes: { sha1?: string; sha256?: string };
  fileSize: number;
  env?: { client?: "required" | "optional" | "unsupported"; server?: string };
}
export interface PackInstallOptions {
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
