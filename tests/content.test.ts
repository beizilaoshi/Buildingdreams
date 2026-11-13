import { expect, it } from "vitest";
import { ModrinthService } from "../src/main/services/modrinth";
import { NetworkService } from "../src/main/services/network";
import { contentGroups, versionFilters } from "../src/shared/content-groups";
import type { ContentVersion } from "../src/shared/content";
import { readFile } from "node:fs/promises";
import { newPackName } from "../src/shared/content";
const project = {
  id: "p",
  slug: "sodium",
  project_type: "mod",
  title: "Sodium",
  description: "Fast renderer",
  body: "<script>text</script>",
  team: "t",
  downloads: 42,
  followers: 3,
  categories: ["optimization"],
  icon_url: "https://cdn.modrinth.com/icon.png",
  license: { id: "LGPL-3.0", name: "LGPL" },
  source_url: "https://github.com/CaffeineMC/sodium",
  issues_url: null,
  wiki_url: null,
};
function service(data: Record<string, unknown>) {
  return new ModrinthService(
    new NetworkService({
      fetch: (async (url: string) =>
        new Response(
          JSON.stringify(data[new URL(url).pathname]),
        )) as typeof fetch,
    }),
  );
}
it("loads validated project and actual team author without rendering remote HTML", async () => {
  const api = service({
    "/v2/project/p": project,
    "/v2/team/t/members": [{ user: { username: "jellysquid" }, role: "Owner" }],
  });
  const p = await api.project("p");
  expect(p.title).toBe("Sodium");
  expect(p.authors).toEqual(["jellysquid"]);
  expect(p.body).toBe("<script>text</script>");
  expect(p.website).toBe("https://modrinth.com/mod/sodium");
});
it("rejects wrong project and unsafe metadata URL", async () => {
  await expect(
    service({ "/v2/project/x": project }).project("x"),
  ).rejects.toThrow();
  const p = await service({
    "/v2/project/p": { ...project, icon_url: "javascript:alert(1)" },
    "/v2/team/t/members": [],
  }).project("p");
  expect(p.icon_url).toBeUndefined();
});
it("rejects project version list containing another project", async () => {
  const api = service({
    "/v2/project/p/version": [
      {
        id: "v",
        project_id: "other",
        name: "v",
        version_number: "v",
        date_published: "2026-01-01",
        game_versions: ["1.21"],
        loaders: ["fabric"],
        files: [],
        dependencies: [],
      },
    ],
  });
  await expect(api.versions("p")).rejects.toThrow();
});
const v = (
  id: string,
  games: string[],
  loaders = ["fabric"],
): ContentVersion => ({
  id,
  project_id: "p",
  name: "Same release",
  version_number: id,
  date_published: "2026-01-01",
  game_versions: games,
  loaders,
  files: [],
  dependencies: [],
});
it("pins exact selected Minecraft and loader, deduplicates multi-game files, and sorts modern versions numerically", () => {
  const groups = contentGroups(
    [v("a", ["1.9", "1.21.1", "26.1"]), v("b", ["1.21.1"], ["forge"])],
    "mod",
    "1.21.1",
    "fabric",
  );
  expect(groups[0].recommended).toBe(true);
  expect(groups[0].versions.map((x) => x.id)).toEqual(["a"]);
  expect(groups.map((g) => g.key)).toEqual([
    "fabric 1.21.1",
    "fabric 26.1",
    "forge 1.21.1",
    "fabric 1.9",
  ]);
});
it("reduces many Minecraft filter options without merging 26.x into legacy 1.x", () => {
  const versions = Array.from({ length: 12 }, (_, i) =>
    v(String(i), ["1.21." + i, "26.1"]),
  );
  const filters = versionFilters(versions);
  expect(filters.labels).toEqual(["26.1", "1.21"]);
  expect(filters.label("1.21.10")).toBe("1.21");
});
it("validates captured official mod and modpack metadata and retains actual names, icons and authors", async () => {
  for (const slug of ["sodium", "fabulously-optimized"]) {
    const p = JSON.parse(
      await readFile(`tests/fixtures/content/${slug}.json`, "utf8"),
    );
    const team = JSON.parse(
      await readFile(`tests/fixtures/content/${slug}-team.json`, "utf8"),
    );
    const result = await service({
      ["/v2/project/" + p.id]: p,
      ["/v2/team/" + p.team + "/members"]: team,
    }).project(p.id);
    expect(result.title).toBe(p.title);
    expect(result.icon_url).toBe(p.icon_url);
    expect(result.authors).toEqual(team.map((m: any) => m.user.username));
    expect(result.projectType).toBe(p.project_type);
  }
});
it("validates new pack instance names before task submission", () => {
  expect(newPackName("筑梦整合包")).toBe("筑梦整合包");
  for (const name of [
    "",
    "../escape",
    "CON",
    "nul.txt",
    "a/b",
    "name.",
    "name ",
    "a:b",
  ])
    expect(() => newPackName(name)).toThrow();
});
it("folds snapshot and nonstandard version groups but keeps an exact recommended snapshot separate", () => {
  const groups = contentGroups(
    [v("a", ["24w01a"]), v("b", ["24w02a"]), v("c", ["b1.7.3"])],
    "mod",
    "24w01a",
    "fabric",
  );
  expect(groups[0].key).toBe("fabric 24w01a");
  expect(groups[0].versions.map((v) => v.id)).toEqual(["a"]);
  expect(
    groups.find((g) => g.key === "fabric 快照版")?.versions.map((v) => v.id),
  ).toEqual(["a", "b"]);
  expect(groups.find((g) => g.key === "fabric 远古版")).toBeDefined();
});
it("optional team failure keeps a validated project usable and strips unsafe public links", async () => {
  const result = await service({
    "/v2/project/p": {
      ...project,
      wiki_url: "file:///secret",
      source_url: "https://127.0.0.1/private",
    },
  }).project("p");
  expect(result.title).toBe("Sodium");
  expect(result.authors).toEqual([]);
  expect(result.authorError).toBeTruthy();
  expect(result.wiki_url).toBeUndefined();
  expect(result.source_url).toBeUndefined();
});
it("rejects non-string dates and malformed version files instead of forwarding unsound typed metadata", async () => {
  const base = { ...v("v", ["1.21"]), date_published: 2026 };
  await expect(
    service({ "/v2/version/v": base }).version("v"),
  ).rejects.toThrow();
  for (const files of [
    [{ url: "javascript:alert(1)", filename: "mod.jar", size: 1, hashes: {} }],
    [
      {
        url: "https://cdn.modrinth.com/mod.jar",
        filename: "../escape.jar",
        size: 1,
        hashes: {},
      },
    ],
  ])
    await expect(
      service({
        "/v2/version/v": { ...base, date_published: "2026-01-01", files },
      }).version("v"),
    ).rejects.toThrow();
});
