import type { LoaderKind } from "./types";
export type ContentKind =
  "mod" | "modpack" | "resourcepack" | "shader" | "datapack";
export type ResourceKind = Exclude<ContentKind, "mod" | "modpack">;
export interface ContentWorld {
  id: string;
  name: string;
}
export interface ResourceInstall {
  instanceId: string;
  kind: ResourceKind;
  projectId: string;
  versionId: string;
  filename: string;
  worldId?: string;
}
export type ContentProvider = "modrinth" | "curseforge";
export interface ContentFilter {
  provider?: ContentProvider;
  projectType?: ContentKind;
  tag?: string;
  minecraft?: string;
  loader?: LoaderKind;
  offset?: number;
  limit?: number;
}
export interface SearchPage {
  hits: {
    provider?: ContentProvider;
    project_id: string;
    slug?: string;
    chineseTitle?: string;
    categoryLabels?: string[];
    title: string;
    description: string;
    icon_url?: string;
    downloads: number;
    author?: string;
    categories?: string[];
    versions?: string[];
    date_modified?: string;
  }[];
  offset: number;
  limit: number;
  total_hits: number;
  mappingNotice?: string;
}
export interface ContentVersion {
  provider?: ContentProvider;
  availabilityNotice?: string;
  id: string;
  project_id: string;
  name: string;
  version_number: string;
  date_published: string;
  game_versions: string[];
  loaders: string[];
  files: {
    url: string;
    unavailableReason?: string;
    website?: string;
    filename: string;
    primary: boolean;
    size: number;
    hashes: { sha1?: string; sha256?: string; sha512?: string };
  }[];
  version_type?: "release" | "beta" | "alpha";
  downloads?: number;
  dependencies: {
    version_id?: string | null;
    project_id?: string | null;
    dependency_type: "required" | "optional" | "incompatible" | "embedded";
  }[];
}
export interface LocalMod {
  name?: string;
  version?: string;
  loader?: "fabric" | "quilt" | "forge" | "neoforge";
  provider?: ContentProvider;
  parseWarning?: string;
  fileName: string;
  enabled: boolean;
  projectId?: string;
  versionId?: string;
  sha1: string;
}
export interface ModUpdate {
  fileName: string;
  projectId: string;
  currentVersionId: string;
  version: ContentVersion;
}

export interface ContentProject {
  distributionRestricted?: boolean;
  provider?: ContentProvider;
  chineseTitle?: string;
  categoryLabels?: string[];
  id: string;
  slug: string;
  projectType: ContentKind;
  title: string;
  description: string;
  body: string;
  icon_url?: string;
  authors: string[];
  authorError?: string;
  categories: string[];
  downloads: number;
  followers: number;
  license?: string;
  website: string;
  source_url?: string;
  issues_url?: string;
  wiki_url?: string;
}
export function newPackName(value: string): string {
  if (
    typeof value !== "string" ||
    !value.trim() ||
    value.length > 100 ||
    /[\\/:<>"|?*\x00-\x1f]/.test(value) ||
    /[. ]$/.test(value) ||
    /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value.trim()) ||
    value.trim() === "." ||
    value.trim() === ".."
  )
    throw new Error("请输入有效的新实例名称");
  return value.trim();
}
export type ModBatchAction = "enable" | "disable" | "remove" | "update";
export interface ModBatchItem { fileName: string; sha1: string; versionId?: string }
export interface ModBatchResult { fileName: string; status: "completed" | "failed" | "skipped"; reason?: "previously-completed"; error?: string }
export interface ModUpdateCheck { updates: ModUpdate[]; errors: {fileName: string; error: string}[] }
