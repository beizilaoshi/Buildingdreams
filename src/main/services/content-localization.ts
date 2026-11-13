import type { ContentKind } from "../../shared/content";
import { readArchive } from "./archive";
import { readFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join } from "node:path";
export interface PclEntry {
  mcmodId: number;
  rank: number;
  curseforgeSlug?: string;
  modrinthSlug?: string;
  chineseName: string;
}
const normalize = (s: string) => s.toLowerCase().replace(/[\s()（）/_-]/g, "");
export function parsePclDictionary(text: string) {
  if (
    Buffer.byteLength(text) > 1024 * 1024 ||
    /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(text)
  )
    throw new Error("PCL 数据大小无效");
  const lines = text
    .replace(/^\uFEFF/, "")
    .replace(/\r\n?/g, "\n")
    .split("\n");
  if (lines.length > 30000) throw new Error("PCL 数据行数无效");
  const entries: PclEntry[] = [];
  for (const [i, line] of lines.entries()) {
    if (!line) continue;
    if (line.length > 4096) throw new Error("PCL 数据行过长");
    for (const raw of line.split("¨")) {
      const fields = raw.split("|");
      const rank = Number(fields[0]),
        mapping = fields[1];
      if (
        fields.length < 2 ||
        fields.length > 3 ||
        !/^\d+$/.test(fields[0]) ||
        !Number.isSafeInteger(rank) ||
        rank < 0 ||
        rank > 1000000 ||
        !mapping ||
        mapping.length > 256 ||
        /[\/\\\x00-\x1f]/.test(mapping) ||
        mapping.split("@").length > 2
      )
        throw new Error("PCL 数据条目无效");
      const [cf, mr] = mapping.split("@");
      const curseforgeSlug = cf || undefined,
        modrinthSlug = mapping.includes("@") ? mr || cf : undefined;
      const name = (curseforgeSlug ?? modrinthSlug ?? "")
        .replace(/-/g, " ")
        .replace(/\b\w/g, (x) => x.toUpperCase());
      entries.push({
        mcmodId: i + 1,
        rank,
        curseforgeSlug,
        modrinthSlug,
        chineseName: (fields[2] ?? "").replace(/\*/g, ` (${name})`),
      });
      if (entries.length > 40000) throw new Error("PCL 数据条目过多");
    }
  }
  const bySlug = new Map(
    entries.filter((x) => x.modrinthSlug).map((x) => [x.modrinthSlug!, x]),
  );
  // Cache recent display lookups only; installation/project metadata remains freshly validated.
  const recent = new Map<string, PclEntry | undefined>();
  const indexed = entries.map((entry) => ({
    entry,
    terms: [
      entry.chineseName,
      ...entry.chineseName.split(/[/(（]/),
      entry.modrinthSlug ?? "",
      entry.curseforgeSlug ?? "",
    ]
      .filter(Boolean)
      .map(normalize),
  }));
  return {
    entries,
    lookup(
      slug: string,
      kind: ContentKind,
      provider: "modrinth" | "curseforge" = "modrinth",
    ) {
      const key = `${provider}:${kind}:${slug}`;
      if (recent.has(key)) return recent.get(key);
      const entry = ["mod", "datapack"].includes(kind)
        ? provider === "curseforge"
          ? entries.find((e) => e.curseforgeSlug === slug)
          : bySlug.get(slug)
        : undefined;
      if (recent.size >= 128) recent.delete(recent.keys().next().value!);
      recent.set(key, entry);
      return entry;
    },
    query(query: string) {
      const q = normalize(query.trim());
      if (!q || q.length > 256) return [];
      return indexed
        .map(({ entry, terms }) => ({
          entry,
          score: terms.some((t) => t === q)
            ? 3
            : terms.some((t) => t.includes(q))
              ? 2
              : terms.some(
                    (t) =>
                      q.includes(t) &&
                      (t.length >= 2 || /[\u3400-\u9fff]/.test(t)),
                  )
                ? 1
                : 0,
        }))
        .filter((x) => x.score)
        .sort(
          (a, b) =>
            b.score - a.score ||
            b.entry.rank - a.entry.rank ||
            a.entry.mcmodId - b.entry.mcmodId,
        )
        .slice(0, 8)
        .map((x) => x.entry);
    },
  };
}
export async function readPclDictionary(path: string) {
  if (
    (await stat(path)).size > 1024 * 1024 ||
    createHash("sha256")
      .update(await readFile(path))
      .digest("hex") !==
      "12cd763062f0cc361f38db5f370e2725257a2a8d59f301a1fd1c5b59b63fb644"
  )
    throw new Error("PCL 快照校验失败");
  const archive = await readArchive(path);
  try {
    if (
      archive.entries.length !== 1 ||
      archive.entries[0].fileName !== "moddata.txt"
    )
      throw new Error("PCL 数据清单无效");
    return parsePclDictionary(
      (await archive.read("moddata.txt", 1024 * 1024)).toString("utf8"),
    );
  } finally {
    archive.close();
  }
}
let pending:
  | Promise<ReturnType<typeof parsePclDictionary> & { notice?: string }>
  | undefined;
export function loadPclDictionary(): Promise<
  ReturnType<typeof parsePclDictionary> & { notice?: string }
> {
  return (pending ??= readPclDictionary(
    join(
      __dirname,
      __dirname.replace(/\\/g, "/").endsWith("/src/main/services")
        ? "../../../public/data/pcl-moddata.zip"
        : "../../renderer/data/pcl-moddata.zip",
    ),
  ).catch(() => ({
    ...parsePclDictionary(""),
    notice: "PCL 中文名称快照暂不可用；已直接搜索原关键词，可尝试英文名称。",
  })));
}
