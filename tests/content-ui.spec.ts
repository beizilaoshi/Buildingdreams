import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("content browser shows actual identities, nested dependencies, back state and distinct mod/pack actions", async () => {
  const data = await mkdtemp(join(tmpdir(), "content-ui-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    const theme = async (value: "light" | "dark") =>
      page.evaluate(async (value) => {
        await window.launcher.invoke("settings.patch", { theme: value });
        document.documentElement.dataset.theme = value;
      }, value);
    const fixtures = await Promise.all(
      ["sodium", "fabric-api", "fabulously-optimized"].map(async (slug) => ({
        project: JSON.parse(
          await readFile(`tests/fixtures/content/${slug}.json`, "utf8"),
        ),
        team: JSON.parse(
          await readFile(`tests/fixtures/content/${slug}-team.json`, "utf8"),
        ),
        image: await readFile(`tests/fixtures/content/${slug}.png`),
      })),
    );
    for (const fixture of fixtures)
      await page.route(fixture.project.icon_url, (route) =>
        route.fulfill({
          body: fixture.image,
          contentType: fixture.project.icon_url.endsWith(".webp")
            ? "image/webp"
            : "image/png",
        }),
      );
    await app.evaluate(
      ({ dialog, shell, clipboard }, fixtures) => {
        (globalThis as any).contentActions = [];
        dialog.showSaveDialog = async () => {
          (globalThis as any).contentActions.push("save");
          return { canceled: true, filePath: "" };
        };
        shell.openExternal = async (url: string) => {
          (globalThis as any).contentActions.push(url);
        };
        clipboard.writeText = async (text: string) => {
          (globalThis as any).contentActions.push(text);
        };
        globalThis.fetch = async (url: any) => {
          const u = new URL(String(url)),
            pack = u.searchParams.get("facets")?.includes("modpack");
          const id = pack ? "pack" : "sodium";
          const project = (id: string) => ({
            ...fixtures[id === "pack" ? 2 : id === "dependency" ? 1 : 0]
              .project,
            id,
          });
          if (u.pathname.endsWith("/members"))
            return new Response(
              JSON.stringify(
                fixtures.find((f) => u.pathname.includes(f.project.team))!.team,
              ),
            );
          if (u.pathname.endsWith("/search"))
            return new Response(
              JSON.stringify({
                hits: [
                  {
                    project_id: id,
                    title: project(id).title,
                    description: project(id).description,
                    author: fixtures[pack ? 2 : 0].team[0].user.username,
                    downloads: project(id).downloads,
                    icon_url: project(id).icon_url,
                    categories: project(id).categories,
                  },
                ],
                offset: 0,
                limit: 40,
                total_hits: 1,
              }),
            );
          const p = u.pathname.split("/")[3];
          const version = (p: string) => ({
            id: p + "-v1",
            project_id: p,
            name: "Release 1.0",
            version_number: "1.0",
            version_type: "release",
            date_published: "2026-10-15T10:00:00Z",
            game_versions: ["1.21.1"],
            loaders: ["fabric"],
            files: [
              {
                url: "https://cdn.modrinth.com/file",
                filename: p + (p === "pack" ? ".mrpack" : ".jar"),
                primary: true,
                size: 123,
                hashes: { sha1: "a".repeat(40) },
              },
            ],
            dependencies:
              p === "sodium"
                ? [{ project_id: "dependency", dependency_type: "required" }]
                : [],
          });
          if (u.pathname.includes("/v2/version/"))
            return new Response(JSON.stringify(version(p.replace("-v1", ""))));
          if (u.pathname.endsWith("/version"))
            return new Response(
              JSON.stringify(
                p === "sodium"
                  ? [
                      version(p),
                      {
                        ...version(p),
                        id: p + "-old",
                        game_versions: ["1.20.1"],
                        dependencies: [],
                      },
                    ]
                  : [version(p)],
              ),
            );
          if (u.pathname.includes("/project/"))
            return new Response(JSON.stringify(project(p)));
          throw new Error("unexpected " + url);
        };
      },
      fixtures.map(({ project, team }) => ({ project, team })),
    );
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await expect(page.locator(".content-project-row h3")).toHaveText("Sodium");
    await page.getByLabel("搜索 Mod").fill("sodium");
    await page.getByLabel("兼容版本", { exact: true }).fill("1.21.1");
    await page
      .getByRole("radiogroup", { name: "兼容加载器" })
      .getByRole("radio", { name: "Fabric", exact: true })
      .click();
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.locator(".content-project-row").click();
    await expect(page.locator(".content-back")).toBeFocused();
    await expect(page.locator(".content-detail h2")).toHaveText("钠 (Sodium)");
    await expect(page.locator(".content-project-header .content-original-title")).toHaveText("Sodium");
    await expect(page.locator(".content-detail")).toContainText("jellysquid3");
    await expect
      .poll(() =>
        page
          .locator(".content-project-header img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await expect(
      page.getByRole("button", { name: "另存为 sodium.jar", exact: true }),
    ).toBeVisible();
    const selectedGroup = page.getByRole("button", { name: /fabric 1.21.1/ });
    await selectedGroup.focus();
    await page.keyboard.press("Space");
    await expect(selectedGroup).toHaveAttribute("aria-expanded", "false");
    await expect(selectedGroup).toBeFocused();
    await page.keyboard.press("Space");
    await expect(selectedGroup).toHaveAttribute("aria-expanded", "true");
    await expect(selectedGroup).toBeFocused();
    expect(
      await app.evaluate(() => (globalThis as any).contentActions),
    ).toEqual([]);
    await page
      .getByRole("button", { name: "另存为 sodium.jar", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).contentActions))
      .toEqual(["save"]);
    await page.getByRole("button", { name: "复制名称", exact: true }).click();
    await page
      .getByRole("button", { name: "转到 Modrinth", exact: true })
      .click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).contentActions))
      .toEqual(["save", "Sodium", "https://modrinth.com/mod/sodium"]);
    await page
      .getByRole("radiogroup", { name: "Minecraft 版本筛选" })
      .getByRole("radio", { name: "全部", exact: true })
      .click();
    await page.getByRole("button", { name: /fabric 1.20.1/ }).click();
    await expect(
      page.getByRole("button", { name: /fabric 1.20.1/ }),
    ).toHaveAttribute("aria-expanded", "true");
    await page.locator(".content-dependencies .content-project-row").focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".content-detail h2")).toHaveText("Fabric API");
    await page.getByRole("button", { name: "返回上一级", exact: true }).click();
    await expect(page.locator(".content-detail h2")).toHaveText("钠 (Sodium)");
    await expect(
      page.locator(".content-dependencies .content-project-row"),
    ).toBeFocused();
    await expect(
      page.getByRole("button", { name: /fabric 1.20.1/ }),
    ).toHaveAttribute("aria-expanded", "true");
    await page
      .getByRole("button", { name: "返回搜索结果", exact: true })
      .click();
    await expect(page.locator(".content-project-row")).toBeFocused();
    await expect(page.getByLabel("搜索 Mod")).toHaveValue("sodium");
    for (const value of ["dark", "light"] as const) {
      await theme(value);
      await page.screenshot({
        path: `validation/content-mod-results-${value}.png`,
      });
    }
    await page.locator(".content-project-row").click();
    await expect(page.locator(".content-detail h2")).toHaveText("钠 (Sodium)");
    await page.screenshot({ path: "validation/content-mod-detail-light.png" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    await page.screenshot({
      path: "validation/content-mod-detail-light-min.png",
    });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(1280, 820),
    );
    await theme("dark");
    await page.screenshot({ path: "validation/content-mod-detail-dark.png" });
    await page.getByRole("button", { name: "整合包", exact: true }).click();
    await expect(page.locator(".content-project-row h3")).toHaveText(
      "Fabulously Optimized",
    );
    await page.screenshot({ path: "validation/content-pack-results-dark.png" });
    await theme("light");
    await page.screenshot({
      path: "validation/content-pack-results-light.png",
    });
    await page.locator(".content-project-row").click();
    await expect(page.locator(".content-detail h2")).toHaveText(
      "Fabulously Optimized",
    );
    await expect
      .poll(() =>
        page
          .locator(".content-project-header img")
          .evaluate((img: HTMLImageElement) => img.naturalWidth),
      )
      .toBeGreaterThan(0);
    await page.getByRole("button", { name: "安装此版本", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText("新实例名称");
    await page.getByLabel("新实例名称").fill("../escape");
    await page.getByRole("button", { name: "创建并安装", exact: true }).click();
    await expect(page.getByRole("dialog")).toContainText(
      "请输入有效的新实例名称",
    );
    await page.keyboard.press("Escape");
    await page
      .getByRole("button", { name: "另存为 pack.mrpack", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await page.screenshot({ path: "validation/content-pack-detail-light.png" });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    await page.screenshot({
      path: "validation/content-pack-detail-light-min.png",
    });
    await theme("dark");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    await page.screenshot({
      path: "validation/content-pack-detail-dark-min.png",
    });
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
test("out-of-order searches and project responses cannot replace the current detail; paging and filters survive Back", async () => {
  const data = await mkdtemp(join(tmpdir(), "content-races-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await app.evaluate(() => {
      const project = (id: string) => ({
        id,
        slug: id,
        project_type: "mod",
        title: id,
        description: "<img onerror=alert(1)> remote text",
        body: "",
        team: "team",
        downloads: 1,
        followers: 0,
        categories: [],
      });
      globalThis.fetch = async (url: any) => {
        const u = new URL(String(url));
        if (u.pathname.endsWith("/search")) {
          const query = u.searchParams.get("query") || "initial",
            offset = Number(u.searchParams.get("offset"));
          const result = {
            hits: [
              {
                project_id: query,
                title: query,
                description: project(query).description,
                downloads: 1,
              },
            ],
            offset,
            limit: 40,
            total_hits: 100,
          };
          if (query === "slow")
            return new Promise((resolve) => {
              (globalThis as any).releaseSearch = () =>
                resolve(new Response(JSON.stringify(result)));
            });
          return new Response(JSON.stringify(result));
        }
        if (u.pathname.endsWith("/members")) return new Response("[]");
        if (u.pathname.endsWith("/version"))
          return new Response(
            JSON.stringify(
              u.pathname.includes("/many/")
                ? [
                    {
                      id: "many-v",
                      project_id: "many",
                      name: "Many dependencies",
                      version_number: "v",
                      date_published: "2026-01-01",
                      game_versions: ["1.21.1"],
                      loaders: ["fabric"],
                      files: [],
                      dependencies: Array.from({ length: 31 }, (_, i) => ({
                        project_id: "dep" + i,
                        dependency_type: "required",
                      })),
                    },
                  ]
                : [],
            ),
          );
        const id = u.pathname.split("/")[3];
        if (id === "slowproject")
          return new Promise((resolve) => {
            (globalThis as any).releaseProject = () =>
              resolve(new Response(JSON.stringify(project(id))));
          });
        if (id === "broken") return new Response("missing", { status: 404 });
        return new Response(JSON.stringify(project(id)));
      };
    });
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await expect(page.locator(".content-project-row h3")).toHaveText("initial");
    const search = async (query: string) => {
      await page.getByLabel("搜索 Mod").fill(query);
      await page.getByRole("button", { name: "搜索", exact: true }).click();
    };
    await search("slow");
    await expect
      .poll(() => app.evaluate(() => typeof (globalThis as any).releaseSearch))
      .toBe("function");
    await search("fast");
    await expect(page.locator(".content-project-row h3")).toHaveText("fast");
    await app.evaluate(() => (globalThis as any).releaseSearch());
    await expect(page.locator(".content-project-row h3")).toHaveText("fast");
    await page.getByRole("button", { name: "下一页", exact: true }).click();
    await expect(page.locator(".content-result-count")).toContainText(
      "第 2 页",
    );
    await page.locator(".content-project-row").click();
    await expect(page.locator(".content-detail h2")).toHaveText("fast");
    await expect(page.locator(".content-detail")).toContainText(
      "没有符合条件的版本",
    );
    expect(await page.locator(".content-detail img").count()).toBe(0);
    await page
      .getByRole("button", { name: "返回搜索结果", exact: true })
      .click();
    await expect(page.getByLabel("搜索 Mod")).toHaveValue("fast");
    await expect(page.locator(".content-result-count")).toContainText(
      "第 2 页",
    );
    await search("slowproject");
    await expect(page.locator(".content-project-row h3")).toHaveText(
      "slowproject",
    );
    await page.locator(".content-project-row").click();
    await expect
      .poll(() => app.evaluate(() => typeof (globalThis as any).releaseProject))
      .toBe("function");
    await page
      .getByRole("button", { name: "返回搜索结果", exact: true })
      .click();
    await search("other");
    await expect(page.locator(".content-project-row h3")).toHaveText("other");
    await page.locator(".content-project-row").click();
    await expect(page.locator(".content-detail h2")).toHaveText("other");
    await app.evaluate(() => (globalThis as any).releaseProject());
    await expect(page.locator(".content-detail h2")).toHaveText("other");
    await page
      .getByRole("button", { name: "返回搜索结果", exact: true })
      .click();
    await search("broken");
    await expect(page.locator(".content-project-row h3")).toHaveText("broken");
    await page.locator(".content-project-row").click();
    await expect(page.locator(".content-project-status")).toContainText(
      "HTTP 404",
    );
    await page.screenshot({ path: "validation/content-project-error.png" });
    await page
      .getByRole("button", { name: "返回搜索结果", exact: true })
      .click();
    await search("slow");
    await page.getByRole("button", { name: "首页", exact: true }).click();
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await expect(page.locator(".content-search-results")).toContainText(
      "正在搜索",
    );
    await expect(page.locator(".content-project-row")).toHaveCount(0);
    await search("fastfinal");
    await expect(page.locator(".content-project-row h3")).toHaveText(
      "fastfinal",
    );
    await app.evaluate(() => (globalThis as any).releaseSearch());
    await expect(page.locator(".content-project-row h3")).toHaveText(
      "fastfinal",
    );
    await search("many");
    await expect(page.locator(".content-project-row h3")).toHaveText("many");
    await page.locator(".content-project-row").click();
    await expect(page.locator(".content-dependency-slot")).toHaveCount(30);
    await page
      .getByRole("button", { name: "显示更多前置资源", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.locator(".content-dependency-slot")).toHaveCount(31);
    await expect(
      page.locator(".content-dependencies .content-project-row").last(),
    ).toContainText("dep30");
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
test("explicit mod install uses its captured instance and real dependency task despite selection changing", async () => {
  const data = await mkdtemp(join(tmpdir(), "content-target-")),
    root = join(data, "game");
  for (const id of ["1.21.1", "1.20.1"]) {
    await mkdir(join(root, "versions", id, "mods"), { recursive: true });
    await writeFile(join(root, "versions", id, "mods", "keep.jar"), "keep");
    await writeFile(
      join(root, "versions", id, id + ".json"),
      JSON.stringify({
        id,
        mainClass: "Main",
        minecraftArguments: "",
        libraries: [{ name: "net.fabricmc:fabric-loader:0.16.10" }],
      }),
    );
  }
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    const imported = await page.evaluate(
      (root) => window.launcher.invoke("instances.import", root),
      root,
    );
    const target = imported.find((i) => i.versionId === "1.21.1")!;
    await page.evaluate(
      (id) => localStorage.setItem("instance", id),
      target.id,
    );
    const bytes = "verified mod bytes",
      sha1 = createHash("sha1").update(bytes).digest("hex");
    await app.evaluate(
      ({}, fixture) => {
        globalThis.fetch = async (url: any) => {
          const u = new URL(String(url));
          const v = {
            id: "v",
            project_id: "p",
            name: "Explicit version",
            version_number: "v",
            date_published: "2026-10-01",
            game_versions: ["1.21.1"],
            loaders: ["fabric"],
            dependencies: [],
            files: [
              {
                url: "https://cdn.modrinth.com/mod.jar",
                filename: "selected.jar",
                primary: true,
                size: fixture.bytes.length,
                hashes: { sha1: fixture.sha1 },
              },
            ],
          };
          if (u.hostname === "cdn.modrinth.com")
            return new Response(fixture.bytes);
          if (u.pathname.endsWith("/search"))
            return new Response(
              JSON.stringify({
                hits: [
                  {
                    project_id: "p",
                    title: "Targeted Mod",
                    description: "Fixture",
                    downloads: 1,
                  },
                ],
                offset: 0,
                limit: 40,
                total_hits: 1,
              }),
            );
          if (u.pathname.endsWith("/members")) return new Response("[]");
          if (u.pathname.includes("/v2/version/"))
            return new Response(JSON.stringify(v));
          if (u.pathname.endsWith("/version"))
            return new Response(JSON.stringify([v]));
          return new Response(
            JSON.stringify({
              id: "p",
              slug: "p",
              title: "Targeted Mod",
              description: "Fixture",
              body: "",
              team: "t",
              project_type: "mod",
              downloads: 1,
              followers: 0,
              categories: [],
            }),
          );
        };
      },
      { bytes, sha1 },
    );
    await page.reload();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await page.locator(".content-project-row").click();
    await page
      .getByRole("button", { name: "安装到 1.21.1", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("1.21.1");
    await page
      .getByRole("radiogroup", { name: "当前实例", exact: true })
      .getByRole("radio", { name: "1.20.1", exact: true })
      .evaluate((n: HTMLElement) => n.click());
    await page
      .getByRole("button", { name: "确认安装到此实例", exact: true })
      .click();
    await expect
      .poll(async () => {
        const tasks = await page.evaluate(() =>
          window.launcher.invoke("tasks.list", undefined),
        );
        return tasks.find((t) => t.label === "安装 Mod")?.status;
      })
      .toBe("completed");
    expect(
      await readFile(
        join(root, "versions", "1.21.1", "mods", "selected.jar"),
        "utf8",
      ),
    ).toBe(bytes);
    await expect(
      readFile(join(root, "versions", "1.20.1", "mods", "selected.jar")),
    ).rejects.toThrow();
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
