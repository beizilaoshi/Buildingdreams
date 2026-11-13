import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
test("PCL Chinese search, visible per-kind tags, native pack title and back state", async () => {
  const data = await mkdtemp(join(tmpdir(), "pcl-search-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    const raw = JSON.parse(
      await readFile("tests/fixtures/content/sodium.json", "utf8"),
    );
    await app.evaluate(({}, raw) => {
      (globalThis as any).pclQueries = [];
      globalThis.fetch = async (url: any) => {
        const u = new URL(String(url));
        (globalThis as any).pclQueries.push(u.href);
        const pack = u.searchParams.get("facets")?.includes("modpack");
        if (
          u.pathname.endsWith("/search") &&
          u.searchParams.get("query") === "slow"
        )
          return new Promise(
            (resolve) =>
              ((globalThis as any).releasePcl = () =>
                resolve(
                  new Response(
                    JSON.stringify({
                      hits: [],
                      offset: 0,
                      limit: 40,
                      total_hits: 0,
                    }),
                  ),
                )),
          );
        if (u.pathname.endsWith("/search"))
          return new Response(
            JSON.stringify({
              hits: [
                {
                  project_id: pack ? "nativepack" : raw.id,
                  slug: pack ? "sodium" : "sodium",
                  title: pack ? "原生中文整合包" : raw.title,
                  description: "真实项目 fixture",
                  downloads: 10,
                  categories: ["technology", "optimization"],
                },
              ],
              offset: 0,
              limit: 40,
              total_hits: 1,
            }),
          );
        if (u.pathname.endsWith("/members")) return new Response("[]");
        if (u.pathname.endsWith("/version")) return new Response("[]");
        return new Response(
          JSON.stringify({ ...raw, id: u.pathname.split("/").at(-1) }),
        );
      };
    }, raw);
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索 Mod", exact: true })
      .fill("钠");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".content-project-row")).toContainText(
      "钠 (Sodium)",
    );
    await expect(page.locator(".content-project-row")).toContainText("Sodium");
    await page.getByRole("button", { name: "性能优化", exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => (globalThis as any).pclQueries.at(-1)))
      .toContain("categories%3Aoptimization");
    await page.locator(".content-project-row").click();
    await page
      .getByRole("button", { name: "返回搜索结果", exact: true })
      .click();
    await expect(
      page.getByRole("textbox", { name: "搜索 Mod", exact: true }),
    ).toHaveValue("钠");
    await expect(page.locator(".content-tag-summary")).toContainText(
      "性能优化",
    );
    await page
      .getByRole("textbox", { name: "搜索 Mod", exact: true })
      .fill("slow");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect
      .poll(() => app.evaluate(() => typeof (globalThis as any).releasePcl))
      .toBe("function");
    await page
      .getByRole("textbox", { name: "搜索 Mod", exact: true })
      .fill("钠");
    await page.getByRole("button", { name: "科技", exact: true }).click();
    await expect(page.locator(".content-project-row")).toContainText(
      "钠 (Sodium)",
    );
    await app.evaluate(() => (globalThis as any).releasePcl());
    await expect(page.locator(".content-project-row")).toContainText(
      "钠 (Sodium)",
    );
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (theme) => (document.documentElement.dataset.theme = theme),
        theme,
      );
      await page.screenshot({ animations: "disabled", path: `validation/pcl-search-${theme}.png` });
    }
    await page.getByRole("button", { name: "整合包", exact: true }).click();
    await page
      .getByRole("textbox", { name: "搜索整合包", exact: true })
      .fill("原生中文");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator(".content-project-row")).toContainText(
      "原生中文整合包",
    );
    await expect(page.locator(".content-project-row")).not.toContainText("钠");
    await page.getByRole("button", { name: "科技", exact: true }).click();
    await expect(page.locator(".content-tag-summary")).toContainText("科技");
    await page.getByRole("button", { name: "更多标签", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "空岛 · 仅 CurseForge", exact: true }),
    ).toBeDisabled();
    await page.getByRole("button", { name: "关闭", exact: true }).click();
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    await expect.poll(() => page.evaluate(() => [innerWidth, innerHeight])).toEqual([960, 640]);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.screenshot({ animations: "disabled", path: "validation/pcl-pack-min.png" });
    await page.getByRole("button", { name: "更多标签", exact: true }).click();
    await page.getByRole("textbox", { name: "搜索标签", exact: true }).fill("空岛");
    await expect(page.getByRole("button", { name: "空岛 · 仅 CurseForge", exact: true })).toBeDisabled();
    await page.screenshot({ animations: "disabled", path: "validation/pcl-pack-tags-min.png" });
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

for (const mode of ["missing", "corrupt"])
  test(`PCL ${mode} snapshot falls back visibly through production Electron IPC`, async () => {
    const asset = join(process.cwd(), "dist/renderer/data/pcl-moddata.zip");
    const original = await readFile(asset),
      data = await mkdtemp(join(tmpdir(), "pcl-fallback-"));
    let app: Awaited<ReturnType<typeof electron.launch>> | undefined;
    try {
      if (mode === "missing") await rm(asset);
      else {
        const { writeFile } = await import("node:fs/promises");
        await writeFile(asset, "broken zip");
      }
      app = await electron.launch({
        args: ["."],
        env: { ...process.env, ZHUMENG_DATA_DIR: data },
      });
      const page = await app.firstWindow();
      await page.waitForSelector(".home-intro");
      await page.keyboard.press("Escape");
      await app.evaluate(() => {
        globalThis.fetch = async () =>
          new Response(
            JSON.stringify({
              hits: [
                {
                  project_id: "AANobbMI",
                  slug: "sodium",
                  title: "Sodium",
                  description: "fallback",
                  downloads: 1,
                },
              ],
              offset: 0,
              limit: 40,
              total_hits: 1,
            }),
          );
      });
      await page.getByRole("button", { name: "模组", exact: true }).click();
      await page
        .getByRole("textbox", { name: "搜索 Mod", exact: true })
        .fill("钠");
      await page.getByRole("button", { name: "搜索", exact: true }).click();
      await expect(page.locator(".content-search-results")).toContainText(
        "快照暂不可用",
      );
      await expect(page.locator(".content-project-row")).toContainText(
        "Sodium",
      );
      await expect(page.locator(".content-project-row")).not.toContainText(
        "钠",
      );
    } finally {
      if (app) await app.close();
      const { writeFile } = await import("node:fs/promises");
      await writeFile(asset, original);
      await rm(data, { recursive: true, force: true });
    }
  });
