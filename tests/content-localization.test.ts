import { it, expect } from "vitest";
import {
  loadPclDictionary,
  parsePclDictionary,
} from "../src/main/services/content-localization";
import { contentTags, resolveTag } from "../src/shared/content-tags";
it("loads original PCL snapshot and resolves exact single-character and alias queries", async () => {
  const d = await loadPclDictionary();
  for (const [q, s] of [
    ["工业时代2", "industrial-craft"],
    ["建筑", "buildcraft"],
    ["钠", "sodium"],
    ["机械动力", "create"],
  ])
    expect(d.query(q).map((x) => x.modrinthSlug ?? x.curseforgeSlug)).toContain(
      s,
    );
  expect(d.query("机械动力").map((x) => x.modrinthSlug)).toContain(
    "create-fabric",
  );
  expect(d.lookup("sodium", "mod")?.chineseName).toContain("钠");
  expect(d.lookup("sodium", "modpack")).toBeUndefined();
});
it("preserves source line IDs, mapping variants, raw aliases and star suffix", () => {
  const d = parsePclDictionary(
    "1|cf\n\n2|same@|别名/另名*¨3|cf-other@mr-other|中文\n4|@only|\n",
  );
  expect(d.entries[1]).toMatchObject({
    mcmodId: 3,
    curseforgeSlug: "same",
    modrinthSlug: "same",
    chineseName: "别名/另名 (Same)",
  });
  expect(d.entries[2].modrinthSlug).toBe("mr-other");
  expect(d.entries[3]).toMatchObject({ modrinthSlug: "only", chineseName: "" });
  expect(() => parsePclDictionary("1|../../x|坏")).toThrow();
});
it("keeps exact per-kind PCL facets and rejects unavailable or injected facets", () => {
  expect(resolveTag("mod", "mr-technology").curseforge).toBe("412");
  expect(resolveTag("modpack", "mr-technology").curseforge).toBe("4472");
  expect(
    contentTags.modpack.find((x) => x.curseforge === "4736")?.modrinth,
  ).toBeUndefined();
  expect(() => resolveTag("modpack", "cf-4736")).toThrow(/Modrinth/);
  expect(() => resolveTag("mod", "categories:magic")).toThrow();
});
import { ModrinthService } from "../src/main/services/modrinth";
import { NetworkService } from "../src/main/services/network";
it("expands Chinese aliases through real provider search with AND facets, dedupes and preserves identity", async () => {
  const urls: URL[] = [];
  const api = new ModrinthService(
    new NetworkService({
      fetch: (async (url: string) => {
        const u = new URL(url);
        urls.push(u);
        return new Response(
          JSON.stringify({
            hits:
              u.searchParams.get("query") === "sodium"
                ? [
                    {
                      project_id: "AANobbMI",
                      slug: "sodium",
                      title: "Sodium",
                      description: "Fast",
                      downloads: 12,
                      categories: ["optimization"],
                    },
                  ]
                : [],
            offset: 0,
            limit: 40,
            total_hits: 1,
          }),
        );
      }) as typeof fetch,
    }),
  );
  const result = await api.search("钠", {
    projectType: "mod",
    minecraft: "1.21.1",
    loader: "fabric",
    tag: "mr-optimization",
  });
  expect(result.hits).toHaveLength(1);
  expect(result.hits[0]).toMatchObject({
    project_id: "AANobbMI",
    title: "Sodium",
    chineseTitle: "钠 (Sodium)",
  });
  expect(urls.some((u) => u.searchParams.get("query") === "sodium")).toBe(true);
  for (const u of urls)
    expect(JSON.parse(u.searchParams.get("facets")!)).toEqual([
      ["project_type:mod"],
      ["versions:1.21.1"],
      ["categories:fabric"],
      ["categories:optimization"],
    ]);
  expect(result.total_hits).toBe(1);
});
it("sends native Chinese pack query unchanged and rejects CF-only tags before network", async () => {
  const urls: URL[] = [];
  const api = new ModrinthService(
    new NetworkService({
      fetch: (async (url: string) => {
        urls.push(new URL(url));
        return new Response(
          JSON.stringify({ hits: [], offset: 0, limit: 20, total_hits: 0 }),
        );
      }) as typeof fetch,
    }),
  );
  await api.search("中文整合包", { projectType: "modpack" });
  expect(urls).toHaveLength(1);
  expect(urls[0].searchParams.get("query")).toBe("中文整合包");
  await expect(
    api.search("", { projectType: "modpack", tag: "cf-4736" }),
  ).rejects.toThrow(/Modrinth/);
  expect(urls).toHaveLength(1);
});
it("keeps provider search slugs as bounded metadata while validating raw project IDs", async () => {
  const api = new ModrinthService(
    new NetworkService({
      fetch: (async () =>
        new Response(
          JSON.stringify({
            hits: [
              {
                project_id: "p",
                slug: "sodium-extra!",
                title: "Extra",
                description: "",
                downloads: 1,
              },
            ],
            offset: 0,
            limit: 20,
            total_hits: 1,
          }),
        )) as typeof fetch,
    }),
  );
  await expect(api.search("sodium")).resolves.toMatchObject({
    hits: [{ project_id: "p", slug: "sodium-extra!" }],
  });
});
import { categoryLabel } from "../src/shared/content-tags";
import { CommandRouter } from "../src/main/ipc";
import { registerModCommands } from "../src/main/mod-router";
it("translates source category badges and retains unknown categories", () => {
  expect(
    ["decoration", "mobs", "equipment", "lightweight", "low", "unknown"].map(
      categoryLabel,
    ),
  ).toEqual(["装饰", "生物", "装备", "轻量", "low", "unknown"]);
});
it.each([
  "|@slug|坏",
  "1|@slug|坏\u0001",
  "-1|@slug|坏",
  "NaN|@slug|坏",
  "1000001|@slug|坏",
  "1|@slug|坏\0",
  "1|a@b@c|坏",
])("rejects invalid bounded source entry %s", (value) =>
  expect(() => parsePclDictionary(value)).toThrow(),
);
it("bounds snapshot text, line and entry lengths", () => {
  expect(() => parsePclDictionary("x".repeat(1024 * 1024 + 1))).toThrow();
  expect(() => parsePclDictionary("\n".repeat(30001))).toThrow();
  expect(() => parsePclDictionary("1|@slug|" + "字".repeat(4096))).toThrow();
});
it("ranks exact aliases before partial matches and supports mixed terms deterministically", () => {
  const d = parsePclDictionary(
    "1|@exact|钠/别名 (Sodium)\n100|@partial|钠扩展",
  );
  expect(d.query("钠")[0].modrinthSlug).toBe("exact");
  expect(d.query("钠 fabric")[0].modrinthSlug).toBe("exact");
  expect(d.query("别名")[0].modrinthSlug).toBe("exact");
  expect(d.query("SODIUM")).toEqual(d.query("sodium"));
});
it("validates canonical tag/type at IPC before any network request", async () => {
  const router = new CommandRouter();
  registerModCommands(router, {
    instances: {} as any,
    tasks: {} as any,
    network: new NetworkService({
      fetch: (async () => {
        throw new Error("must not request");
      }) as typeof fetch,
    }),
  });
  for (const filter of [
    { projectType: "mod", tag: "categories:magic" },
    { projectType: "modpack", tag: "cf-4736" },
    { projectType: "shader", tag: "mr-technology" },
  ])
    await expect(
      router.invoke("content.search", { query: "", filter }),
    ).rejects.toThrow(/无效内容标签|Modrinth/);
});
it("falls back to the exact original query when aliases have no compatible hits and bounds provider calls", async () => {
  const queries: string[] = [];
  const api = new ModrinthService(
    new NetworkService({
      fetch: (async (url: string) => {
        const u = new URL(url);
        queries.push(u.searchParams.get("query")!);
        return new Response(
          JSON.stringify({
            hits: [],
            offset: Number(u.searchParams.get("offset")),
            limit: Number(u.searchParams.get("limit")),
            total_hits: 0,
          }),
        );
      }) as typeof fetch,
    }),
  );
  const result = await api.search("机械动力", {
    projectType: "datapack",
    minecraft: "1.21.1",
    offset: 40,
    limit: 40,
  });
  expect(queries.at(-1)).toBe("机械动力");
  expect(queries.length).toBeLessThanOrEqual(9);
  expect(result).toMatchObject({ offset: 40, limit: 40, total_hits: 0 });
  expect(result.mappingNotice).toContain("未找到兼容项目");
});
