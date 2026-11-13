import type {
  ContentFilter,
  ContentKind,
  ContentProject,
  ContentVersion,
  SearchPage,
} from "../../shared/content";
import { resolveTag, contentTags } from "../../shared/content-tags";
import type { ContentSource } from "./content-provider";
import { parseContentId } from "./content-provider";
import { loadPclDictionary } from "./content-localization";
import type { ProviderSecrets } from "./provider-secrets";
export const curseForgeClasses: Record<ContentKind, number> = {
  mod: 6,
  modpack: 4471,
  resourcepack: 12,
  shader: 6552,
  datapack: 6945,
};
const loaders: Record<string, number> = {
  forge: 1,
  fabric: 4,
  quilt: 5,
  neoforge: 6,
};
const fail = () => new Error("CurseForge 响应格式无效");
function obj(v: any) {
  if (!v || typeof v !== "object" || Array.isArray(v)) throw fail();
  return v;
}
function str(v: any, max = 4096): string {
  if (
    typeof v !== "string" ||
    v.length > max ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(v)
  )
    throw fail();
  return v;
}
function num(v: any): number {
  if (!Number.isSafeInteger(v) || v < 0) throw fail();
  return v;
}
function arr(v: any, max: number): any[] {
  if (!Array.isArray(v) || v.length > max) throw fail();
  return v;
}
function https(v: any, official = false): string {
  const value = str(v);
  let u: URL;
  try {
    u = new URL(value);
  } catch {
    throw fail();
  }
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    u.port ||
    (official && !["www.curseforge.com", "curseforge.com"].includes(u.hostname))
  )
    throw fail();
  return value;
}
function kindOf(v: any): ContentKind {
  if (v.gameId !== 432) throw fail();
  const kind = (Object.keys(curseForgeClasses) as ContentKind[]).find(
    (k) => curseForgeClasses[k] === v.classId,
  );
  if (!kind) throw fail();
  return kind;
}
function projectRecord(v: any): ContentProject {
  obj(v);
  const kind = kindOf(v),
    id = num(v.id);
  if (!id) throw fail();
  const categories = arr(v.categories, 100).map((c) => String(num(obj(c).id)));
  return {
    distributionRestricted: v.allowModDistribution === false,
    provider: "curseforge",
    id: `cf:${id}`,
    slug: str(v.slug, 256),
    projectType: kind,
    title: str(v.name, 512),
    description: str(v.summary, 16000),
    body: "",
    icon_url: v.logo ? https(obj(v.logo).url) : undefined,
    authors: arr(v.authors, 100).map((a) => str(obj(a).name, 512)),
    categories,
    categoryLabels: categories.map(
      (c) => contentTags[kind].find((t) => t.curseforge === c)?.label ?? c,
    ),
    downloads: num(v.downloadCount),
    followers: num(v.thumbsUpCount ?? 0),
    website: https(obj(v.links).websiteUrl, true),
    source_url: v.links.sourceUrl ? https(v.links.sourceUrl) : undefined,
    issues_url: v.links.issuesUrl ? https(v.links.issuesUrl) : undefined,
    wiki_url: v.links.wikiUrl ? https(v.links.wikiUrl) : undefined,
  };
}
function fileRecord(v: any, project: ContentProject): ContentVersion {
  obj(v);
  const file = num(v.id),
    projectId = Number(project.id.slice(3));
  if (
    !file ||
    v.modId !== projectId ||
    v.gameId !== 432 ||
    typeof v.isAvailable !== "boolean"
  )
    throw fail();
  const name = str(v.fileName, 255);
  if (!name || /[\\/:<>"|?*\x00-\x1f]/.test(name) || /[. ]$/.test(name))
    throw fail();
  const date = str(v.fileDate, 100);
  if (!Number.isFinite(Date.parse(date))) throw fail();
  const values = arr(v.gameVersions, 200).map((x) => str(x, 100));
  const fileLoaders = Object.keys(loaders).filter((k) =>
    values.some((x) => x.toLowerCase() === k),
  );
  if (project.projectType === "datapack") fileLoaders.push("datapack");
  const hashes: ContentVersion["files"][number]["hashes"] = {};
  for (const h of arr(v.hashes, 10)) {
    obj(h);
    if (h.algo === 1) {
      if (!/^[a-f0-9]{40}$/i.test(h.value)) throw fail();
      hashes.sha1 = h.value.toLowerCase();
    } else if (h.algo === 2 && !/^[a-f0-9]{32}$/i.test(h.value)) throw fail();
  }
  const url = v.downloadUrl == null ? "" : https(v.downloadUrl);
  const unavailableReason = project.distributionRestricted
    ? "作者限制第三方下载，请前往官方页面"
    : !v.isAvailable
      ? "此文件已不可用，请前往官方页面"
      : !url
        ? "作者限制第三方下载，请前往官方页面"
        : !hashes.sha1
          ? "此文件仅提供不支持的校验算法，请手动从官方页面获取"
          : undefined;
  const relation: Record<
    number,
    ContentVersion["dependencies"][number]["dependency_type"]
  > = {
    1: "embedded",
    2: "optional",
    3: "required",
    5: "incompatible",
    6: "embedded",
  };
  const deps = arr(v.dependencies, 1000).flatMap((d) => {
    obj(d);
    if (![1, 2, 3, 4, 5, 6].includes(d.relationType) || !num(d.modId))
      throw fail();
    return d.relationType === 4
      ? []
      : [
          {
            project_id: `cf:${d.modId}`,
            dependency_type: relation[d.relationType],
          },
        ];
  });
  if (![1, 2, 3].includes(v.releaseType)) throw fail();
  return {
    provider: "curseforge",
    id: `cf:${projectId}:${file}`,
    project_id: project.id,
    name: str(v.displayName, 512),
    version_number: str(v.displayName, 512),
    date_published: date,
    game_versions: values.filter(
      (x) =>
        !Object.keys(loaders).includes(x.toLowerCase()) &&
        !["client", "server"].includes(x.toLowerCase()),
    ),
    loaders: fileLoaders,
    version_type: ({ 1: "release", 2: "beta", 3: "alpha" } as const)[
      v.releaseType as 1 | 2 | 3
    ],
    downloads: num(v.downloadCount),
    dependencies: deps,
    files: [
      {
        url,
        filename: name,
        primary: true,
        size: num(v.fileLength),
        hashes,
        unavailableReason,
        website: project.website.replace(/\/$/, "") + `/files/${file}`,
      },
    ],
  };
}
export class CurseForgeContent implements ContentSource {
  constructor(
    private secrets: ProviderSecrets,
    private fetcher: typeof fetch = (...args) => fetch(...args),
  ) {}
  private async run<T>(
    job: (request: (path: string) => Promise<any>) => Promise<T>,
    signal?: AbortSignal,
  ): Promise<T> {
    const captured = await this.secrets.capture();
    if (!captured.key)
      throw new Error("CurseForge 尚未配置密钥，请前往设置 → 内容来源");
    const signalAll = AbortSignal.any([
      AbortSignal.timeout(20000),
      ...(signal ? [signal] : []),
    ]);
    const request = async (path: string) => {
      if (!/^\/v1\/mods(?:\/|\?|$)/.test(path)) throw new Error("无效来源请求");
      let response: Response;
      try {
        response = await this.fetcher("https://api.curseforge.com" + path, {
          headers: { "x-api-key": captured.key!, accept: "application/json" },
          redirect: "error",
          signal: signalAll,
        });
      } catch {
        signal?.throwIfAborted();
        throw new Error("CurseForge 网络请求失败");
      }
      if (
        response.redirected ||
        (response.status >= 300 && response.status < 400)
      )
        throw new Error("CurseForge 拒绝重定向");
      if (!response.ok)
        throw new Error(
          response.status === 401 || response.status === 403
            ? "CurseForge 密钥无效或没有访问权限"
            : response.status === 429
              ? "CurseForge 请求过于频繁，请稍后重试"
              : `CurseForge 请求失败 (${response.status})`,
        );
      if (Number(response.headers.get("content-length")) > 4 * 1024 * 1024)
        throw fail();
      const reader = response.body?.getReader();
      if (!reader) throw fail();
      let size = 0;
      const chunks: Uint8Array[] = [];
      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          size += value.length;
          if (size > 4 * 1024 * 1024) throw fail();
          chunks.push(value);
        }
      } catch {
        signal?.throwIfAborted();
        throw new Error("CurseForge 响应读取失败或超过大小限制");
      } finally {
        await reader.cancel().catch(() => {});
      }
      try {
        return obj(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        throw fail();
      }
    };
    const result = await job(request);
    await this.secrets.assertCurrent(captured.revision);
    return result;
  }
  private async projectWith(
    request: (p: string) => Promise<any>,
    projectId: string,
  ) {
    const parsed = parseContentId(projectId, "project");
    if (parsed.provider !== "curseforge") throw fail();
    const value = projectRecord(
      (await request(`/v1/mods/${parsed.project}`)).data,
    );
    if (value.id !== projectId) throw fail();
    const dictionary = await loadPclDictionary();
    return {
      ...value,
      chineseTitle:
        dictionary.lookup(value.slug, value.projectType, "curseforge")
          ?.chineseName || undefined,
    };
  }
  project(id: string, signal?: AbortSignal) {
    return this.run((r) => this.projectWith(r, id), signal);
  }
  version(id: string, signal?: AbortSignal) {
    const parsed = parseContentId(id, "version");
    if (parsed.provider !== "curseforge") throw fail();
    return this.run(async (r) => {
      const p = await this.projectWith(r, `cf:${parsed.project}`),
        v = fileRecord(
          (await r(`/v1/mods/${parsed.project}/files/${parsed.file}`)).data,
          p,
        );
      if (v.id !== id) throw fail();
      return v;
    }, signal);
  }
  versions(id: string, filter: ContentFilter = {}, signal?: AbortSignal) {
    return this.run(async (r) => {
      const p = await this.projectWith(r, id);
      if (filter.projectType && filter.projectType !== p.projectType)
        throw new Error("内容类型不匹配");
      const result: ContentVersion[] = [];
      let offset = 0;
      while (offset < 10000) {
        signal?.throwIfAborted();
        const params = this.params(filter);
        params.set("index", String(offset));
        params.set("pageSize", "50");
        const page = await r(`/v1/mods/${Number(id.slice(3))}/files?${params}`);
        const data = arr(page.data, 50);
        this.pagination(page.pagination, offset, 50, data.length);
        result.push(...data.map((v) => fileRecord(v, p)));
        offset += data.length;
        if (offset >= page.pagination.totalCount) break;
        if (!data.length) throw new Error("CurseForge 版本分页未前进，请重试");
        if (offset >= 10000)
          throw new Error(
            "CurseForge 版本列表达到 10000 条上限，请选择兼容版本后重试",
          );
      }
      return result
        .filter(
          (v) =>
            (!filter.minecraft || v.game_versions.includes(filter.minecraft)) &&
            (!filter.loader ||
              !["mod", "modpack"].includes(p.projectType) ||
              v.loaders.includes(filter.loader)),
        )
        .sort((a, b) => b.date_published.localeCompare(a.date_published));
    }, signal);
  }
  private params(filter: ContentFilter) {
    const p = new URLSearchParams();
    if (filter.minecraft) p.set("gameVersion", filter.minecraft);
    if (
      filter.loader &&
      filter.minecraft &&
      ["mod", "modpack"].includes(filter.projectType ?? "mod")
    )
      p.set("modLoaderType", String(loaders[filter.loader]));
    return p;
  }
  private pagination(v: any, index: number, size: number, count: number) {
    obj(v);
    if (
      v.index !== index ||
      v.pageSize !== size ||
      v.resultCount !== count ||
      num(v.totalCount) < index + count
    )
      throw fail();
  }
  search(query: string, filter: ContentFilter = {}, signal?: AbortSignal) {
    return this.run(async (r) => {
      const kind = filter.projectType ?? "mod",
        offset = filter.offset ?? 0,
        limit = filter.limit ?? 20;
      if (
        !Number.isInteger(offset) ||
        !Number.isInteger(limit) ||
        offset < 0 ||
        limit < 1 ||
        limit > 50 ||
        offset + limit > 10000
      )
        throw new Error("CurseForge 分页上限为 10000，每页最多 50");
      const tag = filter.tag
        ? resolveTag(kind, filter.tag, "curseforge")
        : undefined;
      const dictionary = await loadPclDictionary();
      const request = async (term: string, index: number, size: number) => {
        const params = this.params(filter);
        params.set("gameId", "432");
        params.set("classId", String(curseForgeClasses[kind]));
        params.set("sortField", "2");
        params.set("sortOrder", "desc");
        params.set("searchFilter", term);
        params.set("index", String(index));
        params.set("pageSize", String(size));
        if (tag) params.set("categoryId", tag.curseforge!);
        const page = await r(`/v1/mods/search?${params}`);
        const data = arr(page.data, size);
        this.pagination(page.pagination, index, size, data.length);
        const projects = data.map(projectRecord);
        if (projects.some((p) => p.projectType !== kind)) throw fail();
        return { projects, total: page.pagination.totalCount as number };
      };
      const candidates =
        /[\u3400-\u9fff]/.test(query) && ["mod", "datapack"].includes(kind)
          ? dictionary.query(query).filter((e) => e.curseforgeSlug)
          : [];
      let projects: ContentProject[] = [],
        total = 0,
        notice = dictionary.notice;
      if (candidates.length) {
        for (const c of candidates) {
          const page = await request(c.curseforgeSlug!, 0, 20);
          for (const p of page.projects)
            if (
              p.slug === c.curseforgeSlug &&
              !projects.some((x) => x.id === p.id)
            )
              projects.push(p);
        }
        if (projects.length) {
          total = projects.length;
          projects = projects.slice(offset, offset + limit);
          notice =
            "中文名称来自 PCL / MC百科快照；中文别名匹配最多显示 8 个项目。";
        }
      }
      if (!total) {
        const page = await request(query, offset, limit);
        projects = page.projects;
        total = page.total;
      }
      return {
        hits: projects.map((p) => ({
          provider: "curseforge" as const,
          project_id: p.id,
          slug: p.slug,
          chineseTitle:
            dictionary.lookup(p.slug, kind, "curseforge")?.chineseName ||
            undefined,
          title: p.title,
          description: p.description,
          icon_url: p.icon_url,
          downloads: p.downloads,
          author: p.authors.join("、"),
          categories: p.categories,
          categoryLabels: p.categoryLabels,
        })),
        offset,
        limit,
        total_hits: total,
        ...(notice ? { mappingNotice: notice } : {}),
      };
    }, signal);
  }
}
