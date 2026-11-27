import { aggregateSearch } from "./content-aggregate";
import type {
  ContentFilter,
  ContentProject,
  ContentVersion,
  SearchPage,
} from "../../shared/content";
export interface ContentSource {
  search(
    query: string,
    filter?: ContentFilter,
    signal?: AbortSignal,
  ): Promise<SearchPage>;
  project(id: string, signal?: AbortSignal): Promise<ContentProject>;
  version(id: string, signal?: AbortSignal): Promise<ContentVersion>;
  versions(
    id: string,
    filter?: ContentFilter,
    signal?: AbortSignal,
  ): Promise<ContentVersion[]>;
}
export function parseContentId(
  id: string,
  kind: "project" | "version",
): { provider: "modrinth" | "curseforge"; project?: number; file?: number } {
  if (typeof id !== "string") throw new Error("无效内容标识");
  if (!id.includes(":")) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new Error("无效内容标识");
    return { provider: "modrinth" };
  }
  const match = (
    kind === "project" ? /^cf:([1-9]\d*)$/ : /^cf:([1-9]\d*):([1-9]\d*)$/
  ).exec(id);
  if (!match || match.slice(1).some((x) => !Number.isSafeInteger(Number(x))))
    throw new Error("无效 CurseForge 标识");
  return {
    provider: "curseforge",
    project: Number(match[1]),
    ...(match[2] ? { file: Number(match[2]) } : {}),
  };
}
export class ContentProviders implements ContentSource {
  private readonly searchSnapshots = new Map<string, string>();
  constructor(
    readonly modrinth: ContentSource,
    readonly curseforge: ContentSource,
  ) {}
  private source(id: string, kind: "project" | "version") {
    return this[parseContentId(id, kind).provider];
  }
  search(q: string, f: ContentFilter = {}, s?: AbortSignal) {
    if (f.provider === "all") {
      const key = JSON.stringify([q, f.projectType, f.tag, f.minecraft, f.loader]);
      return aggregateSearch(this, q, f, s).then(page => {
        s?.throwIfAborted();
        const snapshot = JSON.stringify(page.sources?.map(source => [source.provider, source.status, source.total]));
        const previous = this.searchSnapshots.get(key);
        if ((f.offset ?? 0) > 0 && previous !== undefined && previous !== snapshot)
          throw new Error("来源或项目总数已变化，请从第一页重新搜索，避免翻页重复或遗漏");
        if ((f.offset ?? 0) === 0 || previous === undefined) {
          this.searchSnapshots.delete(key);
          this.searchSnapshots.set(key, snapshot);
          if (this.searchSnapshots.size > 100) this.searchSnapshots.delete(this.searchSnapshots.keys().next().value!);
        }
        return page;
      });
    }
    return this[f.provider ?? "modrinth"].search(q, f, s);
  }
  project(id: string, s?: AbortSignal) {
    return this.source(id, "project").project(id, s);
  }
  version(id: string, s?: AbortSignal) {
    return this.source(id, "version").version(id, s);
  }
  versions(id: string, f: ContentFilter = {}, s?: AbortSignal) {
    const p = parseContentId(id, "project").provider;
    if (f.provider && f.provider !== p) throw new Error("内容来源与项目不匹配");
    return this[p].versions(id, f, s);
  }
}
