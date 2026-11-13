import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

async function fixture() {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-feedback-"));
  const app = await electron.launch({ args: ["."], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  const page = await app.firstWindow(); await page.waitForSelector(".home-intro"); await page.keyboard.press("Escape");
  await page.evaluate(() => window.launcher.invoke("settings.patch", { openingEnabled: false, reducedMotion: true }));
  await app.evaluate((_e, cwd) => {
    const require = (process as any).mainModule.require.bind((process as any).mainModule);
    const { TaskService } = require(require("node:path").join(cwd, "dist/main/services/tasks.js"));
    const list = TaskService.prototype.list;
    TaskService.prototype.list = function () {
      (globalThis as any).feedbackTasks = this;
      if (!(globalThis as any).feedbackSnapshots) { (globalThis as any).feedbackSnapshots = []; this.onSnapshot((snapshot: any) => (globalThis as any).feedbackSnapshots.push(snapshot)); }
      return list.call(this);
    };
    const { JavaService } = require(require("node:path").join(cwd, "dist/main/services/java.js"));
    const detect = JavaService.prototype.detect;
    (globalThis as any).feedbackDetects = 0;
    JavaService.prototype.detect = function () { (globalThis as any).feedbackDetects++; return detect.call(this); };
  }, process.cwd());
  await page.reload(); await page.waitForSelector(".home-intro");
  return { app, page, cleanup: async () => { await app.close(); await rm(data, { recursive: true, force: true }); } };
}
async function start(app: ElectronApplication, label: string, mode: "hold" | "fail" | "complete" = "hold") {
  return app.evaluate((_e, { label, mode }) => {
    const tasks = (globalThis as any).feedbackTasks; let attempts = 0;
    return tasks.start(label, async ({ report, signal }: any) => {
      report(0.42, 2097152); attempts++;
      (globalThis as any).feedbackReport = report;
      if (mode === "fail" && attempts === 1) throw new Error("Fixture checksum mismatch");
      if (mode === "complete" || (mode === "fail" && attempts > 1)) return;
      await new Promise<void>((resolve, reject) => { signal.addEventListener("abort", () => reject(new Error("Fixture cancelled")), { once: true }); (globalThis as any).feedbackRelease = resolve; });
    });
  }, { label, mode });
}
test("global real tasks cancel/retry, terminal dedup, historical bootstrap and focused inputs", async () => {
  const { app, page, cleanup } = await fixture();
  try {
    await expect(page.locator("#task-toggle")).toBeVisible();
    const id = await start(app, "自动配置 Java 21 · 手动任务");
    await page.locator("#task-toggle").click();
    const row = page.locator(`#task-panel [data-task-id="${id}"]`);
    await expect(row).toContainText("运行中"); await expect(row).toContainText("42%"); await expect(row).toContainText("2.00 MB/s");
    await expect(page.locator(".java-task-summary")).not.toHaveAttribute("role", "status");
    await expect(page.locator("#notice-count")).toHaveText("");
    const detects = await app.evaluate(() => (globalThis as any).feedbackDetects);
    await page.keyboard.press("Escape"); await expect(page.locator("#task-toggle")).toBeFocused();
    await page.locator("#task-toggle").click(); expect(await app.evaluate(() => (globalThis as any).feedbackDetects)).toBe(detects);
    await page.keyboard.press("Tab"); await expect(row.getByRole("button", { name: "取消任务", exact: true })).toBeFocused();
    await app.evaluate(() => (globalThis as any).feedbackReport(0.71, 1048576)); await expect(row).toContainText("71%"); await expect(row.getByRole("button", { name: "取消任务", exact: true })).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("navigate", { detail: "about" })));
    await expect(page.locator("#task-panel")).toBeVisible(); await expect(row.getByRole("button", { name: "取消任务", exact: true })).toBeFocused();
    await page.evaluate(() => window.dispatchEvent(new CustomEvent("navigate", { detail: "home" })));
    await row.getByRole("button", { name: "取消任务", exact: true }).click();
    await expect(row).toContainText("已取消");
    await expect.poll(() => page.evaluate(async () => (await window.launcher.invoke("tasks.list", undefined))[0].status)).toBe("cancelled");
    await expect(page.locator(".java-task-summary")).toContainText("Java 配置已取消"); await expect(page.locator(".java-task-summary")).not.toContainText("游戏未启动");
    await expect(page.locator("#notice-count")).toHaveText("1");
    await app.evaluate(({ BrowserWindow }) => { const snapshot = (globalThis as any).feedbackTasks.list()[0]; for (let i = 0; i < 5; i++) BrowserWindow.getAllWindows()[0].webContents.send("launcher:task", snapshot); });
    await page.waitForTimeout(180); await expect(page.locator("#notice-count")).toHaveText("1");
    await page.locator("#notice-toggle").click(); await expect(page.locator("#task-panel")).toBeHidden();
    await page.getByRole("button", { name: "清除通知记录" }).click();
    expect(await page.evaluate(async () => (await window.launcher.invoke("tasks.list", undefined)).length)).toBe(1);
    await page.keyboard.press("Escape"); await expect(page.locator("#notice-toggle")).toBeFocused();
    const failed = await start(app, "Fixture retry", "fail");
    await page.locator("#task-toggle").click(); const failedRow = page.locator(`#task-panel [data-task-id="${failed}"]`);
    await expect(failedRow).toContainText("Fixture checksum mismatch");
    await failedRow.getByRole("button", { name: "重试", exact: true }).click();
    await expect.poll(() => page.evaluate(async () => (await window.launcher.invoke("tasks.list", undefined)).filter(t => t.label === "Fixture retry").map(t => t.status))).toEqual(["failed", "completed"]);
    const ids = await page.evaluate(async () => (await window.launcher.invoke("tasks.list", undefined)).filter(t => t.label === "Fixture retry").map(t => t.id)); expect(ids[0]).not.toBe(ids[1]);
    const actualStates = await app.evaluate(() => [...new Set((globalThis as any).feedbackSnapshots.map((snapshot: any) => snapshot.status))]);
    expect(actualStates).toEqual(expect.arrayContaining(["queued", "running", "failed", "completed", "cancelled"]));
    await page.keyboard.press("Escape"); await page.reload(); await page.waitForSelector(".home-intro"); await expect(page.locator("#notice-count")).toHaveText(""); await expect(page.locator(".notice-toast")).toHaveCount(0);
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const input = page.getByLabel("最大内存（MB）", { exact: true });
    // A stable existing settings text field must survive unrelated task events.
    const field = input; await field.fill("2048"); await field.focus();
    await start(app, "Background complete", "complete"); await expect(field).toBeFocused(); await expect(field).toHaveValue("2048");
  } finally { await cleanup(); }
});

test("task actions disable while IPC is pending, report honest errors, and clear records leaves active work", async () => {
  const { app, page, cleanup } = await fixture();
  try {
    const id = await start(app, "Pending cancel fixture");
    await app.evaluate(() => {
      const tasks = (globalThis as any).feedbackTasks, cancel = tasks.cancel.bind(tasks); let rejectOnce = true;
      tasks.cancel = async (id: string) => {
        if (rejectOnce) { rejectOnce = false; await new Promise<void>(resolve => { (globalThis as any).feedbackReject = resolve; }); throw Error("Fixture cancel refused"); }
        return cancel(id);
      };
    });
    await page.locator("#task-toggle").click(); const row = page.locator(`#task-panel [data-task-id="${id}"]`);
    await row.getByRole("button", { name: "取消任务", exact: true }).click(); await expect(row.getByRole("button", { name: "处理中…" })).toBeDisabled();
    await app.evaluate(() => (globalThis as any).feedbackReject());
    await expect(page.locator(".notice-toast[data-kind=error]")).toContainText("Fixture cancel refused");
    await expect(row.getByRole("button", { name: "取消任务", exact: true })).toBeEnabled(); await expect(row).toContainText("运行中");
    await page.locator("#notice-toggle").click(); await page.getByRole("button", { name: "清除通知记录" }).click();
    expect(await page.evaluate(async () => (await window.launcher.invoke("tasks.list", undefined))[0].status)).toBe("running");
    await page.locator("#task-toggle").click(); await row.getByRole("button", { name: "取消任务", exact: true }).click(); await expect(row).toContainText("已取消");
  } finally { await cleanup(); }
});

test("bounded notifications, expiring errors, paused expiry and accessible panel focus", async () => {
  const { app, page, cleanup } = await fixture();
  try {
    await page.clock.install();
    for (let i = 0; i < 35; i++) await start(app, `History ${i}`, "fail");
    await expect(page.locator("#notice-count")).toHaveText("30"); await expect(page.locator(".notice-toast")).toHaveCount(3);
    await expect(page.locator(".notice-toast[data-kind=error]")).toHaveCount(3);
    await page.locator("#notice-toggle").click(); await expect(page.locator("#notice-panel .notice-item")).toHaveCount(30); await expect(page.locator("#notice-panel .notice-item").first()).toContainText("History 34");
    await page.screenshot({ path: "validation/feedback-notice-populated-error-stack.png" });
    await page.locator("#notice-panel .notice-item").last().scrollIntoViewIfNeeded(); await expect(page.locator("#notice-panel .notice-item").last()).toBeInViewport();
    await page.locator(".home-intro").click(); await expect(page.locator("#notice-panel")).toBeHidden(); await expect(page.locator("#notice-toggle")).toBeFocused();
    await page.screenshot({ path: "validation/feedback-error-toast-stack.png" });
    // Errors are read-and-gone: they stay a while, then dismiss themselves without user action.
    await page.clock.fastForward(8000); await expect(page.locator(".notice-toast")).toHaveCount(3);
    await page.clock.fastForward(4000); await expect(page.locator(".notice-toast")).toHaveCount(0);
    await page.locator("#notice-toggle").click(); await expect(page.locator("#notice-panel .notice-item")).toHaveCount(30);
    await page.getByRole("button", { name: "清除通知记录" }).click({ timeout: 2000 }); await expect(page.locator("#notice-count")).toHaveText("");
    await page.locator(".home-intro").click(); await expect(page.locator("#notice-panel")).toBeHidden();
    await start(app, "Expiry fixture", "complete");
    const toast = page.locator(".notice-toast").filter({ hasText: "Expiry fixture" }); await expect(toast).toBeVisible();
    await page.clock.fastForward(1000); await toast.hover(); await toast.getByRole("button").focus(); await page.clock.fastForward(20000);
    await page.locator("#task-toggle").focus(); await page.clock.fastForward(20000); await expect(toast).toBeVisible();
    await page.mouse.move(10, 90); await page.clock.fastForward(2500); await expect(toast).toBeVisible(); await page.clock.fastForward(1400); await expect(toast).toHaveCount(0);
    const errors: string[] = []; page.on("pageerror", err => errors.push(err.message));
    await start(app, '<img src=x onerror="window.bad=true">', "complete"); await expect(page.locator(".notice-toast img")).toHaveCount(0); expect(errors).toEqual([]);
  } finally { await cleanup(); }
});

test("390px panels stay usable at 960/1280 in light/dark with reduced motion and preserve home", async () => {
  const { app, page, cleanup } = await fixture();
  try {
    await start(app, "资源安装 · 真实受控任务");
    for (const width of [960, 1280]) for (const theme of ["light", "dark"] as const) {
      await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, width === 960 ? 640 : 820), width);
      await page.evaluate(async theme => { await window.launcher.invoke("settings.patch", { theme }); }, theme);
      await page.reload(); await page.waitForSelector(".home-intro");
      await expect(page.locator(".home-intro h1")).toContainText("让每一个世界"); await expect(page.locator(".launch-panel")).toBeInViewport({ ratio: 1 }); await expect(page.locator(".home-aside")).toBeInViewport({ ratio: 1 });
      for (const panel of ["task", "notice"]) {
        await page.locator(`#${panel}-toggle`).click(); await expect(page.locator(`#${panel}-panel`)).toBeVisible();
        const bounds = await page.locator(`#${panel}-panel`).evaluate(el => { const b = el.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, width: b.width, viewport: innerWidth, height: innerHeight, overflow: document.documentElement.scrollWidth > innerWidth }; });
        expect(bounds.width).toBe(390); expect(bounds.x).toBeGreaterThanOrEqual(0); expect(bounds.right).toBeLessThanOrEqual(bounds.viewport); expect(bounds.bottom).toBeLessThanOrEqual(bounds.height); expect(bounds.overflow).toBe(false);
        await page.screenshot({ path: `validation/feedback-${panel}-${width}-${theme}.png` }); await page.keyboard.press("Escape"); await expect(page.locator(`#${panel}-toggle`)).toBeFocused();
      }
      expect(await page.locator("html").getAttribute("data-motion")).toBe("reduced");
    }
  } finally { await cleanup(); }
});
