import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
test("CurseForge all five kinds, compact cards, source isolation, key settings and blocked file flow", async () => {
  const data = await mkdtemp(join(tmpdir(), "cf-ui-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await page.route("https://images.example/cf.png", async (route) =>
      route.fulfill({
        body: await readFile("tests/fixtures/content/sodium.png"),
        contentType: "image/png",
      }),
    );
    await page.evaluate(() =>
      window.launcher.invoke("settings.patch", {
        openingEnabled: false,
        reducedMotion: true,
      }),
    );
    await app.evaluate(() => {
      (globalThis as any).cfCalls = [];
      (globalThis as any).cfKind = 6;
      (globalThis as any).cfBlocked = false;
      const classes: any = {
        6: "mod",
        4471: "modpack",
        12: "resourcepack",
        6552: "shader",
        6945: "datapack",
      };
      globalThis.fetch = async (input: any, options: any) => {
        const u = new URL(String(input));
        if (u.hostname === "api.curseforge.com") {
          (globalThis as any).cfCalls.push({
            url: u.href,
            key: options?.headers?.["x-api-key"],
          });
          if (options?.headers?.["x-api-key"] !== "fixture-only-key")
            throw new Error("wrong fixture credential");
          const project = (id: number) => ({
            id,
            gameId: 432,
            classId: (globalThis as any).cfKind,
            name:
              classes[(globalThis as any).cfKind] + " Native 中文项目 " + id,
            slug: "native-" + id,
            summary:
              "Compact introduction with real project identity and complete readable metadata.",
            authors: [{ name: "Fixture Author" }],
            logo: { url: "https://images.example/cf.png" },
            categories: [],
            downloadCount: 100,
            links: {
              websiteUrl: "https://www.curseforge.com/minecraft/mc-mods/native",
            },
          });
          if (u.pathname.endsWith("/search")) {
            (globalThis as any).cfKind = Number(u.searchParams.get("classId"));
            return new Response(
              JSON.stringify({
                data: [project(12), project(13), project(14)],
                pagination: {
                  index: 0,
                  pageSize: 40,
                  resultCount: 3,
                  totalCount: 3,
                },
              }),
            );
          }
          if (u.pathname.endsWith("/files"))
            return new Response(
              JSON.stringify({
                data: [
                  {
                    id: 34,
                    modId: 12,
                    gameId: 432,
                    isAvailable: true,
                    fileName:
                      classes[(globalThis as any).cfKind] === "mod"
                        ? "native.jar"
                        : "native.zip",
                    displayName: "Exact CF File",
                    releaseType: 1,
                    fileDate: "2026-10-01T00:00:00Z",
                    fileLength: 9,
                    downloadCount: 10,
                    downloadUrl: (globalThis as any).cfBlocked
                      ? null
                      : "https://cdn.example/native",
                    gameVersions: ["1.21.1", "Fabric"],
                    hashes: [{ algo: 1, value: "a".repeat(40) }],
                    dependencies: [],
                  },
                ],
                pagination: {
                  index: 0,
                  pageSize: 50,
                  resultCount: 1,
                  totalCount: 1,
                },
              }),
            );
          return new Response(JSON.stringify({ data: project(12) }));
        }
        if (options?.headers?.["x-api-key"]) throw new Error("credential leak");
        if (u.pathname.endsWith("/search"))
          return new Response(
            JSON.stringify({ hits: [], offset: 0, limit: 40, total_hits: 0 }),
          );
        throw new Error("unexpected fixture fetch");
      };
    });
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "内容来源", exact: true })
      .getByRole("radio", { name: "CurseForge", exact: true })
      .click();
    await expect(page.locator(".content-search-results")).toContainText(
      "尚未配置密钥",
    );
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(
      page.getByText("CurseForge 尚未配置；Modrinth 可直接使用"),
    ).toBeVisible();
    await page
      .getByLabel("CurseForge API 密钥", { exact: true })
      .fill("fixture-only-key");
    await page
      .getByRole("button", { name: "保存来源密钥", exact: true })
      .click();
    await expect(
      page.getByLabel("CurseForge API 密钥", { exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByText("CurseForge 已配置 · 仅本次会话"),
    ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.stringify(localStorage)),
    ).not.toContain("fixture-only-key");
    expect(await readFile(join(data, "settings.json"), "utf8")).not.toContain(
      "fixture-only-key",
    );
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await expect(
      page.locator(".content-search-results .content-project-row"),
    ).toHaveCount(3);
    await expect(page.locator(".toast")).toHaveCount(0, { timeout: 10000 });
    const geometry: any[] = [];
    for (const [width, height] of [
      [1280, 820],
      [960, 640],
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, [w, h]) =>
          BrowserWindow.getAllWindows()[0].setSize(w, h),
        [width, height],
      );
      await page.locator(".content").evaluate((n) => (n.scrollTop = 0));
      const bounds = await page
        .locator(".content-search-results .content-project-row")
        .first()
        .evaluate((n) => ({
          top: n.getBoundingClientRect().top,
          height: n.getBoundingClientRect().height,
          width: innerWidth,
          viewport: innerHeight,
          overflow: document.documentElement.scrollWidth > innerWidth,
        }));
      geometry.push(bounds);
      expect(bounds.overflow).toBe(false);
      expect(bounds.top).toBeLessThan(height - 44);
      expect(bounds.height).toBeLessThanOrEqual(120);
      await page.screenshot({
        animations: "disabled",
        path: `validation/curseforge-search-${width}.png`,
      });
    }
    await writeFile(
      "scratch/pcl-curseforge-card-bounds.json",
      JSON.stringify(geometry, null, 2),
    );
    for (const kind of [
      "mod",
      "resourcepack",
      "shader",
      "datapack",
      "modpack",
    ]) {
      if (kind === "modpack")
        await page.getByRole("button", { name: "整合包", exact: true }).click();
      else if (kind !== "mod")
        await page
          .getByRole("radiogroup", { name: "资源类型", exact: true })
          .getByRole("radio", {
            name: (
              {
                resourcepack: "资源包",
                shader: "光影",
                datapack: "数据包",
              } as any
            )[kind],
            exact: true,
          })
          .click();
      const source = page.getByRole("radiogroup", {
        name: "内容来源",
        exact: true,
      });
      if (
        (await source
          .getByRole("radio", { name: "CurseForge", exact: true })
          .getAttribute("aria-checked")) !== "true"
      )
        await source
          .getByRole("radio", { name: "CurseForge", exact: true })
          .click();
      await expect(
        page.locator(".content-search-results .content-project-row h3").first(),
      ).toContainText(kind + " Native");
      await page
        .locator(".content-search-results .content-project-row")
        .first()
        .click();
      await expect(page.locator(".content-detail h2")).toContainText(
        kind + " Native",
      );
      await expect(
        page.getByRole("button", { name: "转到 CurseForge", exact: true }),
      ).toBeVisible();
      await expect(page.locator(".content-detail")).toContainText(
        "Exact CF File",
      );
      expect(
        await page
          .locator(".content-detail .content-project-icon")
          .first()
          .evaluate((n) => n.getBoundingClientRect().width),
      ).toBe(44);
      await page.screenshot({
        animations: "disabled",
        path: `validation/curseforge-detail-${kind}.png`,
      });
      await page.locator(".content-back").click();
    }
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "资源类型", exact: true })
      .getByRole("radio", { name: "Mod", exact: true })
      .click();
    await page.getByLabel("搜索 Mod", { exact: true }).fill("CF remembered");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    const source = page.getByRole("radiogroup", {
      name: "内容来源",
      exact: true,
    });
    await source.getByRole("radio", { name: "Modrinth", exact: true }).click();
    await expect(page.getByLabel("搜索 Mod", { exact: true })).toHaveValue("");
    await source
      .getByRole("radio", { name: "CurseForge", exact: true })
      .click();
    await expect(page.getByLabel("搜索 Mod", { exact: true })).toHaveValue(
      "CF remembered",
    );
    await app.evaluate(() => ((globalThis as any).cfBlocked = true));
    await page
      .locator(".content-search-results .content-project-row")
      .first()
      .click();
    await expect(
      page.getByRole("button", { name: "另存为 native.jar", exact: true }),
    ).toBeDisabled();
    await expect(page.locator(".content-detail")).toContainText(
      "作者限制第三方下载",
    );
    await expect(
      page.getByRole("button", { name: "前往官方文件页面", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: "validation/curseforge-blocked-file.png",
    });
    expect(
      await app.evaluate(() =>
        (globalThis as any).cfCalls.every(
          (c: any) =>
            c.key === "fixture-only-key" && !c.url.includes("fixture-only-key"),
        ),
      ),
    ).toBe(true);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("button", { name: "清除来源密钥", exact: true })
      .click();
    await expect(
      page.getByText("CurseForge 尚未配置；Modrinth 可直接使用"),
    ).toBeVisible();
    await page.screenshot({
      animations: "disabled",
      path: "validation/curseforge-settings-cleared.png",
    });
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});
