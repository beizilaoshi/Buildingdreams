import type {
  ContentProject,
  ContentVersion,
  SearchPage,
} from "../../shared/content";
const invalid = () => new Error("Modrinth 响应无效");
export function boundedText(value: unknown, max = 4096): string {
  if (typeof value !== "string" || value.length > max || value.includes("\0"))
    throw invalid();
  return value;
}
export function id(value: unknown): string {
  const text = boundedText(value, 128);
  if (!/^[a-zA-Z0-9_-]+$/.test(text)) throw invalid();
  return text;
}
function count(value: unknown): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw invalid();
  return value as number;
}
function list(value: unknown, max: number): unknown[] {
  if (!Array.isArray(value) || value.length > max) throw invalid();
  return value;
}
function strings(value: unknown, max = 256): string[] {
  return list(value, max).map((v) => boundedText(v, 128));
}
export function publicHttps(value: unknown): string | undefined {
  if (value == null || value === "") return undefined;
  if (typeof value !== "string" || value.length > 4096) return undefined;
  try {
    const u = new URL(value);
    if (
      u.protocol !== "https:" ||
      u.username ||
      u.password ||
      u.port ||
      !u.hostname.includes(".") ||
      /^(localhost|.*\.local|.*\.localhost)$/.test(u.hostname) ||
      /^[\d.]+$/.test(u.hostname) ||
      u.hostname.includes(":")
    )
      return undefined;
    return u.href;
  } catch {
    return undefined;
  }
}
function icon(value: unknown): string | undefined {
  const url = publicHttps(value);
  return url && new URL(url).hostname === "cdn.modrinth.com" ? url : undefined;
}
export function validateProject(
  raw: any,
  requested: string,
): Omit<ContentProject, "authors"> & { team: string } {
  if (
    !raw ||
    (raw.id !== requested && raw.slug !== requested) ||
    !["mod", "modpack", "resourcepack", "shader", "datapack"].includes(
      raw.project_type,
    )
  )
    throw invalid();
  const slug = id(raw.slug),
    projectType = raw.project_type as ContentProject["projectType"];
  return {
    id: id(raw.id),
    slug,
    projectType,
    title: boundedText(raw.title, 256),
    description: boundedText(raw.description, 4096),
    body: boundedText(raw.body, 1024 * 1024),
    team: id(raw.team),
    icon_url: icon(raw.icon_url),
    categories: strings(raw.categories, 100),
    downloads: count(raw.downloads),
    followers: count(raw.followers),
    license: raw.license
      ? boundedText(raw.license.name ?? raw.license.id, 256)
      : undefined,
    website: `https://modrinth.com/${projectType}/${slug}`,
    source_url: publicHttps(raw.source_url),
    issues_url: publicHttps(raw.issues_url),
    wiki_url: publicHttps(raw.wiki_url),
  };
}
export function validateAuthors(raw: unknown): string[] {
  return [
    ...new Set(
      list(raw, 100).map((m: any) => boundedText(m?.user?.username, 128)),
    ),
  ];
}
export function validateSearch(raw: any): SearchPage {
  if (!raw) throw invalid();
  return {
    offset: count(raw.offset),
    limit: count(raw.limit),
    total_hits: count(raw.total_hits),
    hits: list(raw.hits, 100).map((h: any) => ({
      project_id: id(h.project_id),
      slug: h.slug == null ? undefined : boundedText(h.slug, 256),
      title: boundedText(h.title, 256),
      description: boundedText(h.description, 4096),
      icon_url: icon(h.icon_url),
      downloads: count(h.downloads),
      author: h.author == null ? undefined : boundedText(h.author, 128),
      categories: h.categories == null ? [] : strings(h.categories, 100),
      versions: h.versions == null ? [] : strings(h.versions, 2000),
      date_modified:
        typeof h.date_modified === "string" &&
        Number.isFinite(Date.parse(h.date_modified))
          ? h.date_modified
          : undefined,
    })),
  };
}
export function validateVersion(raw: any): ContentVersion {
  if (
    !raw ||
    typeof raw.date_published !== "string" ||
    raw.date_published.length > 64 ||
    !Number.isFinite(Date.parse(raw.date_published))
  )
    throw invalid();
  return {
    id: id(raw.id),
    project_id: id(raw.project_id),
    name: boundedText(raw.name, 256),
    version_number: boundedText(raw.version_number, 256),
    date_published: raw.date_published,
    game_versions: strings(raw.game_versions, 2000),
    loaders: strings(raw.loaders, 100),
    version_type: ["release", "beta", "alpha"].includes(raw.version_type)
      ? raw.version_type
      : undefined,
    downloads: raw.downloads == null ? undefined : count(raw.downloads),
    files: list(raw.files, 100).map((f: any) => {
      const url = boundedText(f.url, 4096); // NetworkService also validates redirects; localhost is only allowed by explicit test configuration.
      const parsed = new URL(url);
      if (
        !["https:", "http:"].includes(parsed.protocol) ||
        parsed.username ||
        parsed.password
      )
        throw invalid();
      const filename = boundedText(f.filename, 255);
      if (
        !filename ||
        /[\\/:\x00-\x1f<>"|?*]/.test(filename) ||
        /[. ]$/.test(filename) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(filename) ||
        filename === "." ||
        filename === ".."
      )
        throw new Error("无效内容文件名");
      const hashes: ContentVersion["files"][number]["hashes"] = {};
      for (const [key, len] of [
        ["sha1", 40],
        ["sha256", 64],
        ["sha512", 128],
      ] as const)
        if (f.hashes?.[key] != null) {
          if (
            typeof f.hashes[key] !== "string" ||
            !new RegExp(`^[a-f0-9]{${len}}$`, "i").test(f.hashes[key])
          )
            throw invalid();
          hashes[key] = f.hashes[key].toLowerCase();
        }
      return {
        url,
        filename,
        primary: f.primary === true,
        size: count(f.size),
        hashes,
      };
    }),
    dependencies: list(raw.dependencies, 1000).map((d: any) => {
      if (
        !["required", "optional", "incompatible", "embedded"].includes(
          d.dependency_type,
        )
      )
        throw invalid();
      return {
        project_id: d.project_id == null ? null : id(d.project_id),
        version_id: d.version_id == null ? null : id(d.version_id),
        dependency_type: d.dependency_type,
      };
    }),
  };
}
