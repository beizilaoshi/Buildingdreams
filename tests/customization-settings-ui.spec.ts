import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

test("startup preferences, stable settings search and task notification switches", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-custom-settings-"));
  await writeFile(join(data, "settings.json"), JSON.stringify({ startupPage: "library", startMaximized: true, openingEnabled: false, notifyTaskCompletion: false, notifyTaskFailure: false }));
  await writeFile(join(data, "notices-seen.json"), JSON.stringify({ betaNotice: true }));
  const app = await electron.launch({ args: ["."], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    await expect(page.locator('[data-page="library"]')).toHaveAttribute("aria-current", "page");
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())).toBe(true);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const search = page.getByRole("searchbox", { name: "搜索设置" });
    const memory = page.getByLabel("最大内存（MB）", { exact: true });
    await memory.fill("3072");
    await search.fill("Microsoft");
    await expect(page.getByLabel("Microsoft 客户端 ID", { exact: true })).toBeVisible();
    await expect(memory).toBeHidden();
    await search.fill("不存在的设置xyz");
    await expect(page.locator(".settings-search-empty")).toBeVisible();
    await search.fill("Java"); await expect(memory).toHaveValue("3072");
    await expect(page.getByRole("button", { name: "自动检测 Java", exact: true })).toBeVisible();
    await search.fill("");
    await app.evaluate(({ BrowserWindow }) => { const window = BrowserWindow.getAllWindows()[0]; window.unmaximize(); window.setSize(960, 640); });
    await expect.poll(() => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByRole("navigation", { name: "设置分类", exact: true }).getByRole("button", { name: "账号", exact: true }).click();
    await expect(page.getByRole("button", { name: "保存客户端 ID", exact: true })).toBeVisible();
    await app.evaluate((_e, cwd) => {
      const require = (process as any).mainModule.require.bind((process as any).mainModule);
      const { TaskService } = require(require("node:path").join(cwd, "dist/main/services/tasks.js"));
      const list = TaskService.prototype.list;
      TaskService.prototype.list = function () { (globalThis as any).customSettingsTasks = this; return list.call(this); };
    }, process.cwd());
    await page.evaluate(() => window.launcher.invoke("tasks.list", undefined));
    await app.evaluate(() => {
      const tasks = (globalThis as any).customSettingsTasks;
      tasks.start("Quiet complete fixture", async () => {});
      tasks.start("Quiet failure fixture", async () => { throw Error("Quiet fixture failure"); });
    });
    await expect.poll(() => page.evaluate(async () => (await window.launcher.invoke("tasks.list", undefined)).filter(t => ["completed", "failed"].includes(t.status)).length)).toBe(2);
    await expect(page.locator(".notice-toast")).toHaveCount(0);
    await page.locator("#task-toggle").click();
    await expect(page.locator("#task-panel")).toContainText("Quiet fixture failure");
    await page.keyboard.press("Escape");
    await search.fill("Java");
    await memory.fill("1");
    await page.getByRole("button", { name: "保存运行配置", exact: true }).click();
    await expect(page.locator(".notice-toast[data-kind=error]")).toHaveCount(1);
    await page.locator(".notice-toast[data-kind=error] .notice-dismiss").click();
    await search.fill("常用");
    await page.getByLabel("任务完成通知", { exact: true }).check();
    await page.getByLabel("任务失败通知", { exact: true }).check();
    await expect.poll(() => page.evaluate(async () => { const s = await window.launcher.invoke("settings.read", undefined); return [s.notifyTaskCompletion,s.notifyTaskFailure]; })).toEqual([true,true]);
    await app.evaluate(() => {
      const tasks = (globalThis as any).customSettingsTasks;
      tasks.start("Visible complete fixture", async () => {});
      tasks.start("Visible failure fixture", async () => { throw Error("Visible fixture failure"); });
    });
    await expect(page.locator(".notice-toast[data-kind=success]")).toContainText("Visible complete fixture");
    await expect(page.locator(".notice-toast[data-kind=error]")).toContainText("Visible fixture failure");
    for (const startupPage of ["download", "home", "library"] as const) {
      await page.evaluate(startupPage => window.launcher.invoke("settings.patch", { startupPage }), startupPage);
      await page.reload();
      await expect(page.locator(`[data-page="${startupPage}"]`)).toHaveAttribute("aria-current", "page");
    }
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});
