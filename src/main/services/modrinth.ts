import type {
  ContentFilter,
  ContentProject,
  ContentVersion,
  SearchPage,
} from "../../shared/content";
import {
  validateProject,
  validateAuthors,
  validateSearch,
  validateVersion,
  id,
} from "./content-validation";
import { loadPclDictionary } from "./content-localization";
import { categoryLabel, resolveTag } from "../../shared/content-tags";
import { NetworkService } from "./network";
export class ModrinthService {
  constructor(
    private network: NetworkService,
    private base = "https://api.modrinth.com/v2",
  ) {}
  async search(
    query: string,
    filter: ContentFilter = {},
    signal?: AbortSignal,
  ): Promise<SearchPage> {
    const kind = filter.projectType ?? "mod";
    const tag = filter.tag ? resolveTag(kind, filter.tag) : undefined;
    const dictionary = await loadPclDictionary();
    const decorate = (hit: SearchPage["hits"][number]) => ({
      ...hit,
      provider: "modrinth" as const,
      chineseTitle: hit.slug
        ? dictionary.lookup(hit.slug, kind)?.chineseName || undefined
        : undefined,
      categoryLabels: (hit.categories ?? []).map((c) => categoryLabel(c)),
    });
    const candidates =
      /[\u3400-\u9fff]/.test(query) && ["mod", "datapack"].includes(kind)
        ? dictionary
            .query(query)
            .filter(
              (e) => e.modrinthSlug && /^[a-zA-Z0-9_-]+$/.test(e.modrinthSlug),
            )
        : [];
    const facets = [[`project_type:${filter.projectType ?? "mod"}`]];
    if (filter.minecraft) facets.push([`versions:${filter.minecraft}`]);
    if (
      filter.loader &&
      (!filter.projectType || ["mod", "modpack"].includes(filter.projectType))
    )
      facets.push([`categories:${filter.loader}`]);
    if (tag) facets.push([`categories:${tag.modrinth}`]);
    const request = async (term: string, offset: number, limit: number) => {
      const params = new URLSearchParams({
        query: term,
        facets: JSON.stringify(facets),
        offset: String(offset),
        limit: String(limit),
      });
      return validateSearch(
        await this.network.json(`${this.base}/search?${params}`, signal),
      );
    };
    const offset = filter.offset ?? 0,
      limit = filter.limit ?? 20;
    if (!candidates.length) {
      const page = await request(query, offset, limit);
      return {
        ...page,
        hits: page.hits.map(decorate),
        ...(dictionary.notice ? { mappingNotice: dictionary.notice } : {}),
      };
    }
    // Snapshot candidates are bounded, each provider request retains every compatibility facet.
    const hits: SearchPage["hits"] = [];
    for (const candidate of candidates) {
      signal?.throwIfAborted();
      const page = await request(candidate.modrinthSlug!, 0, 20);
      for (const hit of page.hits)
        if (
          hit.slug === candidate.modrinthSlug &&
          !hits.some((h) => h.project_id === hit.project_id)
        )
          hits.push(decorate(hit));
    }
    if (!hits.length) {
      const page = await request(query, offset, limit);
      return {
        ...page,
        hits: page.hits.map(decorate),
        mappingNotice:
          "PCL 快照映射未找到兼容项目；已搜索原关键词，可尝试英文名称。",
      };
    }
    return {
      hits: hits.slice(offset, offset + limit),
      offset,
      limit,
      total_hits: hits.length,
      mappingNotice:
        "中文名称来自 PCL / MC百科快照；中文别名匹配最多显示 8 个项目，可用英文名继续搜索。",
    };
  }
  async versions(
    projectId: string,
    filter: ContentFilter = {},
    signal?: AbortSignal,
  ): Promise<ContentVersion[]> {
    id(projectId);
    const params = new URLSearchParams();
    if (filter.minecraft)
      params.set("game_versions", JSON.stringify([filter.minecraft]));
    if (filter.projectType === "datapack")
      params.set("loaders", JSON.stringify(["datapack"]));
    else if (
      filter.loader &&
      (!filter.projectType || ["mod", "modpack"].includes(filter.projectType))
    )
      params.set("loaders", JSON.stringify([filter.loader]));
    const versions = await this.network.json<ContentVersion[]>(
      `${this.base}/project/${encodeURIComponent(projectId)}/version?${params}`,
      signal,
    );
    if (
      !Array.isArray(versions) ||
      versions.length > 20000 ||
      versions.some((v) => v?.project_id !== projectId)
    )
      throw new Error("Modrinth 版本响应无效");
    return versions
      .map((v) => ({ ...validateVersion(v), provider: "modrinth" as const }))
      .filter((v) => compatible(v, filter))
      .sort((a, b) => b.date_published.localeCompare(a.date_published));
  }
  async version(
    versionId: string,
    signal?: AbortSignal,
  ): Promise<ContentVersion> {
    id(versionId);
    const version = validateVersion(
      await this.network.json(
        `${this.base}/version/${encodeURIComponent(versionId)}`,
        signal,
      ),
    );
    if (version.id !== versionId) throw new Error("Modrinth 版本标识不匹配");
    return { ...version, provider: "modrinth" };
  }
  async project(
    projectId: string,
    signal?: AbortSignal,
  ): Promise<ContentProject> {
    id(projectId);
    const { team, ...project } = validateProject(
      await this.network.json(
        `${this.base}/project/${encodeURIComponent(projectId)}`,
        signal,
      ),
      projectId,
    );
    const dictionary = await loadPclDictionary();
    const localized = {
      ...project,
      provider: "modrinth" as const,
      chineseTitle:
        dictionary.lookup(project.slug, project.projectType)?.chineseName ||
        undefined,
      categoryLabels: project.categories.map((c) => categoryLabel(c)),
    };
    try {
      return {
        ...localized,
        authors: validateAuthors(
          await this.network.json(
            `${this.base}/team/${encodeURIComponent(team)}/members`,
            signal,
          ),
        ),
      };
    } catch {
      return { ...localized, authors: [], authorError: "作者信息暂时不可用" };
    }
  }
}
export function compatible(
  version: ContentVersion,
  filter: ContentFilter,
): boolean {
  return (
    (!filter.minecraft || version.game_versions.includes(filter.minecraft)) &&
    (filter.projectType !== "datapack" ||
      version.loaders.includes("datapack")) &&
    (!filter.loader ||
      (!!filter.projectType &&
        !["mod", "modpack"].includes(filter.projectType)) ||
      version.loaders.includes(filter.loader))
  );
}
