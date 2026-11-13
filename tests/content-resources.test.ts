import { it, expect } from "vitest";
import { ModrinthService } from "../src/main/services/modrinth";
import { NetworkService } from "../src/main/services/network";
it.each(["resourcepack", "shader", "datapack"] as const)(
  "uses resource %s facets and ignores mod loader",
  async (kind) => {
    let address = "";
    const service = new ModrinthService(
      new NetworkService({
        fetch: (async (url: any) => {
          address = String(url);
          return new Response(
            JSON.stringify({ hits: [], offset: 0, limit: 20, total_hits: 0 }),
          );
        }) as typeof fetch,
      }),
    );
    await service.search("", { projectType: kind, loader: "fabric" });
    const facets = JSON.parse(new URL(address).searchParams.get("facets")!);
    expect(facets).toEqual([[`project_type:${kind}`]]);
  },
);
it("datapack versions retain mixed upstream mod ZIP versions only", async () => {
  const v = (id: string, loaders: string[]) => ({
    id,
    project_id: "p",
    name: id,
    version_number: id,
    date_published: "2026-01-01",
    game_versions: ["1.21"],
    loaders,
    files: [],
    dependencies: [],
  });
  const service = new ModrinthService(
    new NetworkService({
      fetch: (async () =>
        new Response(
          JSON.stringify([
            v("data", ["datapack", "fabric"]),
            v("mod", ["fabric"]),
          ]),
        )) as typeof fetch,
    }),
  );
  expect(
    (
      await service.versions("p", { projectType: "datapack", loader: "fabric" })
    ).map((v) => v.id),
  ).toEqual(["data"]);
});
