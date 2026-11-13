import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
test("resource cards drill into ZIP details, isolate searches and install to explicit real world", async () => {
  const data = await mkdtemp(join(tmpdir(), "resource-ui-")),
    game = join(data, "game");
  await mkdir(join(game, "saves", "First world"), { recursive: true });
  await mkdir(join(game, "saves", "Chosen world"), { recursive: true });
  for (const world of ["First world", "Chosen world"])
    await writeFile(join(game, "saves", world, "level.dat"), "world");
  await writeFile(
    join(data, "instances.json"),
    JSON.stringify([
      {
        id: "target",
        name: "Resource target",
        versionId: "1.21.1",
        minecraft: "1.21.1",
        resourceDir: game,
        gameDir: game,
        status: "ready",
        memoryMb: 1024,
        javaArgs: [],
        loader: { kind: "fabric", version: "1" },
      },
    ]),
  );
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    const fixtures = await Promise.all(
      ["minecraft-dark-mode", "complementary-reimagined", "terralith"].map(
        async (slug) => ({
          project: JSON.parse(
            await readFile(`tests/fixtures/content/${slug}.json`, "utf8"),
          ),
          team: JSON.parse(
            await readFile(`tests/fixtures/content/${slug}-team.json`, "utf8"),
          ),
          icon: await readFile(`tests/fixtures/content/${slug}.webp`),
        }),
      ),
    );
    for (const fixture of fixtures)
      await page.route(fixture.project.icon_url, (route) =>
        route.fulfill({ body: fixture.icon, contentType: "image/webp" }),
      );
    const bytes = "PK resource fixture",
      sha256 = createHash("sha256").update(bytes).digest("hex");
    await app.evaluate(
      ({}, f) => {
        globalThis.fetch = async (url: any) => {
          const u = new URL(String(url));
          const meta = (kind: string) =>
            f.fixtures[kind === "resourcepack" ? 0 : kind === "shader" ? 1 : 2];
          if (u.hostname === "cdn.modrinth.com") return new Response(f.bytes);
          if (u.pathname.endsWith("/members"))
            return new Response(
              JSON.stringify(
                f.fixtures.find((x) => u.pathname.includes(x.project.team))
                  ?.team ?? [],
              ),
            );
          const facets = u.searchParams.get("facets") ?? "",
            kind =
              ["resourcepack", "shader", "datapack"].find((k) =>
                facets.includes("project_type:" + k),
              ) ?? "mod";
          if (u.pathname.endsWith("/search")) {
            const result = new Response(
              JSON.stringify({
                hits: [
                  {
                    project_id: kind,
                    title: meta(kind).project.title,
                    description: meta(kind).project.description,
                    icon_url: meta(kind).project.icon_url,
                    author: meta(kind)
                      .team.map((m: any) => m.user.username)
                      .join("、"),
                    downloads: meta(kind).project.downloads,
                  },
                ],
                offset: 0,
                limit: 40,
                total_hits: 1,
              }),
            );
            if (u.searchParams.get("query") === "slow")
              return new Promise((resolve) => {
                (globalThis as any).releaseResource = () => resolve(result);
              });
            return result;
          }
          const p = u.pathname.split("/")[3].replace("-v", "");
          const v = {
            id: p + "-v",
            project_id: p,
            name: "Resource release",
            version_number: "1",
            date_published: "2026-10-01",
            game_versions: ["1.21.1"],
            loaders:
              p === "datapack"
                ? ["fabric", "datapack"]
                : p === "shader"
                  ? ["iris"]
                  : ["minecraft"],
            dependencies: [],
            files: [
              ...(p === "datapack"
                ? [
                    {
                      filename: "primary.jar",
                      primary: true,
                      url: "https://cdn.modrinth.com/primary.jar",
                      size: f.bytes.length,
                      hashes: { sha256: f.sha256 },
                    },
                  ]
                : []),
              {
                filename: p + ".zip",
                primary: p !== "datapack",
                url: "https://cdn.modrinth.com/" + p + ".zip",
                size: f.bytes.length,
                hashes: { sha256: f.sha256 },
              },
            ],
          };
          if (u.pathname.includes("/version/"))
            return new Response(JSON.stringify(v));
          if (u.pathname.endsWith("/version"))
            return new Response(JSON.stringify([v]));
          return new Response(
            JSON.stringify({ ...meta(p).project, id: p, slug: p }),
          );
        };
      },
      {
        bytes,
        sha256,
        fixtures: fixtures.map(({ project, team }) => ({ project, team })),
      },
    );
    await page.getByRole("button", { name: "模组", exact: true }).click();
    for (const [kind, label, folder] of [
      ["resourcepack", "资源包", "resourcepacks"],
      ["shader", "光影", "shaderpacks"],
      ["datapack", "数据包", "saves/Chosen world/datapacks"],
    ]) {
      await page.getByRole("radio", { name: label, exact: true }).click();
      await expect(page.locator(".content-project-row h3")).toHaveText(
        fixtures[kind === "resourcepack" ? 0 : kind === "shader" ? 1 : 2]
          .project.title,
      );
      await expect(
        page.getByRole("radiogroup", { name: "兼容加载器" }),
      ).toHaveCount(0);
      await page.locator(".content-project-row").click();
      await expect(page.locator(".content-detail h2")).toHaveText(
        fixtures[kind === "resourcepack" ? 0 : kind === "shader" ? 1 : 2]
          .project.title,
      );
      if (kind === "shader")
        await expect(page.locator(".content-detail")).toContainText(
          "Iris / OptiFine",
        );
      await expect(
        page.getByRole("button", {
          name: "另存为 " + kind + ".zip",
          exact: true,
        }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: /安装.*primary.jar/ }),
      ).toHaveCount(0);
      await page
        .getByRole("button", {
          name: "安装 " + kind + ".zip 到 Resource target",
          exact: true,
        })
        .click();
      await expect(page.getByRole("dialog")).toContainText("Resource target");
      if (kind === "datapack") {
        await expect(page.getByRole("radio", { name: "First world", exact: true })).toHaveAttribute("aria-checked", "false");
        await page
          .getByRole("radio", { name: "First world", exact: true })
          .focus();
        await expect(
          page.getByRole("button", { name: "确认安装所选文件", exact: true }),
        ).toBeDisabled();
        await page
          .getByRole("radio", { name: "Chosen world", exact: true })
          .click();
        await expect(page.getByRole("dialog")).toContainText("Chosen world");
      }
      await page
        .getByRole("button", { name: "确认安装所选文件", exact: true })
        .click();
      await expect
        .poll(() =>
          readFile(join(game, folder, kind + ".zip"), "utf8").catch(() => ""),
        )
        .toBe(bytes);
      await page.locator(".content-back").click();
    }
    for (const world of ["First world", "Chosen world"])
      await rm(join(game, "saves", world, "level.dat"));
    await page.locator(".content-project-row").click();
    await page
      .getByRole("button", {
        name: "安装 datapack.zip 到 Resource target",
        exact: true,
      })
      .click();
    await expect(page.getByRole("dialog")).toContainText("没有可用存档");
    await expect(
      page.getByRole("button", { name: "确认安装所选文件", exact: true }),
    ).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.locator(".content-back").click();
    await page.getByRole("radio", { name: "资源包", exact: true }).click();
    await page.getByLabel("搜索资源包", { exact: true }).fill("slow");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByRole("radio", { name: "光影", exact: true }).click();
    await app.evaluate(() => (globalThis as any).releaseResource());
    await expect(page.locator(".content-project-row h3")).toHaveText(
      fixtures[1].project.title,
    );
    await page.getByRole("radio", { name: "资源包", exact: true }).click();
    await expect(page.getByLabel("搜索资源包", { exact: true })).toHaveValue(
      "slow",
    );
    // Re-enter after category switch and retain search on Back.
    await page.getByLabel("搜索资源包", { exact: true }).fill("retained");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.locator(".content-project-row").click();
    await page.locator(".content-back").click();
    await expect(page.getByLabel("搜索资源包", { exact: true })).toHaveValue(
      "retained",
    );
    await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10000 });
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    for (const theme of ["dark", "light"]) {
      await page.evaluate(async (theme) => {
        await window.launcher.invoke("settings.patch", {
          theme: theme as "dark" | "light",
        });
        document.documentElement.dataset.theme = theme;
      }, theme);
      await page.screenshot({
        path: "validation/resource-results-" + theme + "-min.png",
      });
      await page.locator(".content-project-row").click();
      await expect(page.locator(".content-project-header img")).toBeVisible();
      await page.screenshot({
        path: "validation/resource-detail-" + theme + "-min.png",
      });
      await page.locator(".content-back").click();
    }
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
