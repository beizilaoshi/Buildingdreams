import {
  test,
  expect,
  _electron as electron,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
let app: ElectronApplication, page: Page, data: string;
const evidence = ".superpowers/sdd/2026-11-11-accounts";
test.beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), "zhumeng-accounts-ui-"));
  app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  page = await app.firstWindow();
  await page.waitForSelector(".home-intro");
  await page.keyboard.press("Escape");
  await page.evaluate(() =>
    window.launcher.invoke("settings.patch", {
      openingEnabled: false,
      reducedMotion: true,
    }),
  );
  await page.reload();
});
test.afterEach(async () => {
  await app.close();
  await rm(data, { recursive: true, force: true });
});
test("offline modal validates Enter, duplicates and direct home rename preserves selected record", async () => {
  await page
    .getByRole("button", { name: "登录 / 添加账号 →", exact: true })
    .click();
  await page.getByRole("button", { name: "添加本地账号", exact: true }).click();
  const modal = page.getByRole("dialog", { name: "添加本地账号", exact: true });
  await expect(modal).toBeVisible();
  await modal.getByLabel("本地玩家名").fill("x");
  await modal.getByLabel("本地玩家名").press("Enter");
  await expect(modal.getByRole("alert")).toContainText("3–16");
  await modal.getByLabel("本地玩家名").fill("Steve");
  await modal.getByLabel("本地玩家名").press("Enter");
  await expect(modal).toHaveCount(0);
  const id = await page.evaluate(() => localStorage.getItem("account"));
  await page.getByRole("button", { name: "添加本地账号", exact: true }).click();
  await page.getByRole("dialog").getByLabel("本地玩家名").fill("Alex");
  await page.getByRole("dialog").getByLabel("本地玩家名").press("Enter");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.getByRole("button", { name: "首页", exact: true }).click();
  await page.getByRole("button", { name: "修改名字", exact: true }).click();
  const rename = page.getByRole("dialog", {
    name: "修改本地玩家名",
    exact: true,
  });
  await expect(rename).toContainText("UUID");
  await rename.getByLabel("本地玩家名").fill("Steve");
  await rename.getByLabel("本地玩家名").press("Enter");
  await expect(rename.getByRole("alert")).toContainText("同名");
  await expect(rename.getByRole("alert")).not.toContainText(
    "Error invoking remote method",
  );
  await rename.getByLabel("本地玩家名").fill("Notch");
  await page.setViewportSize({ width: 960, height: 760 });
  await page.screenshot({ path: evidence + "/offline-960.png" });
  await rename.getByLabel("本地玩家名").press("Enter");
  await expect(rename).toHaveCount(0);
  await expect(page.locator(".player-summary")).toContainText("Notch");
  const accounts = await page.evaluate(() =>
    window.launcher.invoke("accounts.list", undefined),
  );
  expect(accounts).toHaveLength(2);
  expect(accounts[0].id).toBe(id);
  expect(accounts[1].uuid).toBe("b50ad385829d3141a2167e7d7539ba7f");
  await page.getByRole("button", { name: "修改名字", exact: true }).click();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
async function fixture() {
  await app.evaluate((_e, cwd) => {
    const req = (process as any).mainModule.require.bind(
      (process as any).mainModule,
    );
    const Router = req(
      req("node:path").join(cwd, "dist/main/ipc.js"),
    ).CommandRouter;
    const original = Router.prototype.invoke;
    const f: any = ((globalThis as any).accountsFixture = {
      calls: [],
      mode: "pending",
      hold: false,
    });
    Router.prototype.invoke = async function (command: string, payload: any) {
      f.calls.push({ command, payload });
      if (command === "accounts.beginMicrosoftLogin") {
        if (f.missingClient) throw Error("请配置有效微软客户端 ID");
        if (f.hold) await new Promise((r) => (f.release = r));
        return {
          loginId: "fixture-session",
          userCode: "ABCD-EFGH",
          verificationUri: "https://www.microsoft.com/link",
          expiresAt: Date.now() + 900000,
          interval: 0.02,
        };
      }
      if (command === "accounts.pollMicrosoftLogin") {
        if (f.holdPoll) await new Promise((r) => (f.releasePoll = r));
        if (f.mode === "completed") {
          const account = await original.call(
            this,
            "accounts.addLocal",
            "MicrosoftFixture",
          );
          return { status: "completed", account };
        }
        return f.mode === "pending"
          ? { status: "pending", interval: 0.02 }
          : { status: f.mode };
      }
      if (command === "accounts.copyUserCode") {
        if (f.copyFail) throw Error("clipboard fixture failure");
        return;
      }
      if (command === "app.openVerification") {
        if (f.openFail) throw Error("browser fixture failure");
        return;
      }
      if (command === "accounts.cancelMicrosoftLogin") return;
      if (command === "accounts.addLocal" && f.holdLocal)
        await new Promise((r) => (f.releaseLocal = r));
      return original.call(this, command, payload);
    };
  }, process.cwd());
}
test("Microsoft immediate pending, automatic copy/open, failures, retry and persisted success", async () => {
  await fixture();
  await page
    .getByRole("button", { name: "登录 / 添加账号 →", exact: true })
    .click();
  await app.evaluate(() => {
    const f = (globalThis as any).accountsFixture;
    f.hold = true;
    f.openFail = true;
    f.copyFail = true;
  });
  await page
    .getByRole("button", { name: "登录 Microsoft", exact: true })
    .click();
  const modal = page.getByRole("dialog", {
    name: "登录 Microsoft",
    exact: true,
  });
  await expect(modal).toContainText("正在");
  await app.evaluate(() => {
    const f = (globalThis as any).accountsFixture;
    f.hold = false;
    f.release();
  });
  await expect(modal).toContainText("ABCD-EFGH");
  await expect(modal).toContainText("复制失败");
  await expect(modal).toContainText("打开失败");
  await app.evaluate(() => {
    const f = (globalThis as any).accountsFixture;
    f.openFail = false;
    f.copyFail = false;
  });
  await modal.getByRole("button", { name: "复制代码", exact: true }).click();
  await modal
    .getByRole("button", { name: "重新打开验证页面", exact: true })
    .click();
  await expect(modal).toContainText("代码已复制");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.screenshot({ path: evidence + "/microsoft-1280.png" });
  await app.evaluate(
    () => ((globalThis as any).accountsFixture.mode = "declined"),
  );
  await expect(modal).toContainText("已拒绝");
  await modal.getByRole("button", { name: "重试登录", exact: true }).click();
  await app.evaluate(
    () => ((globalThis as any).accountsFixture.mode = "completed"),
  );
  await expect(modal).toHaveCount(0);
  const selected = await page.evaluate(() => localStorage.getItem("account"));
  const accounts = await page.evaluate(() =>
    window.launcher.invoke("accounts.list", undefined),
  );
  expect(accounts.find((a) => a.id === selected)?.name).toBe(
    "MicrosoftFixture",
  );
});
test("legacy client fixture and late closed begin never opens browser or selects", async () => {
  await fixture();
  await app.evaluate(() => ((globalThis as any).accountsFixture.missingClient = true));
  await page
    .getByRole("button", { name: "登录 / 添加账号 →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "登录 Microsoft", exact: true })
    .click();
  let modal = page.getByRole("dialog", { name: "登录 Microsoft", exact: true });
  await expect(modal.getByLabel("Microsoft 客户端 ID")).toBeVisible();
  await fixture();
  await app.evaluate(() => ((globalThis as any).accountsFixture.hold = true));
  await modal
    .getByLabel("Microsoft 客户端 ID")
    .fill("12345678-1234-1234-1234-123456789abc");
  await modal.getByRole("button", { name: "保存并重试", exact: true }).click();
  await modal.getByRole("button", { name: "关闭", exact: true }).click();
  await app.evaluate(() => (globalThis as any).accountsFixture.release());
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as any).accountsFixture.calls.filter(
            (c: any) => c.command === "accounts.cancelMicrosoftLogin",
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await app.evaluate(
      () =>
        (globalThis as any).accountsFixture.calls.filter((c: any) =>
          ["app.openVerification", "accounts.copyUserCode"].includes(c.command),
        ).length,
    ),
  ).toBe(0);
  expect(await page.evaluate(() => localStorage.getItem("account"))).toBeNull();
});

for (const outcome of ["expired", "unlicensed", "cancelled"] as const)
  test(`Microsoft ${outcome} remains readable and retryable`, async () => {
    await fixture();
    await app.evaluate(
      (_e, value) => ((globalThis as any).accountsFixture.mode = value),
      outcome,
    );
    await page
      .getByRole("button", { name: "登录 / 添加账号 →", exact: true })
      .click();
    await page
      .getByRole("button", { name: "登录 Microsoft", exact: true })
      .click();
    const modal = page.getByRole("dialog", {
      name: "登录 Microsoft",
      exact: true,
    });
    await expect(modal).toContainText(
      outcome === "expired"
        ? "已过期"
        : outcome === "unlicensed"
          ? "没有 Minecraft"
          : "已取消",
    );
    await expect(
      modal.getByRole("button", { name: "重试登录", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(modal).toHaveCount(0);
  });
test("duplicate Microsoft action creates one pending session and navigation cancels late response", async () => {
  await fixture();
  await app.evaluate(() => ((globalThis as any).accountsFixture.hold = true));
  await page
    .getByRole("button", { name: "登录 / 添加账号 →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "登录 Microsoft", exact: true })
    .evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
      node.click();
    });
  await expect(
    page.getByRole("dialog", { name: "登录 Microsoft", exact: true }),
  ).toBeVisible();
  expect(
    await app.evaluate(
      () =>
        (globalThis as any).accountsFixture.calls.filter(
          (c: any) => c.command === "accounts.beginMicrosoftLogin",
        ).length,
    ),
  ).toBe(1);
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("navigate", { detail: "home" })),
  );
  await app.evaluate(() => (globalThis as any).accountsFixture.release());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect
    .poll(() =>
      app.evaluate(
        () =>
          (globalThis as any).accountsFixture.calls.filter(
            (c: any) => c.command === "accounts.cancelMicrosoftLogin",
          ).length,
      ),
    )
    .toBe(1);
  expect(
    await app.evaluate(
      () =>
        (globalThis as any).accountsFixture.calls.filter((c: any) =>
          [
            "app.openVerification",
            "accounts.copyUserCode",
            "accounts.pollMicrosoftLogin",
          ].includes(c.command),
        ).length,
    ),
  ).toBe(0);
});
test("late completed poll after navigation never selects an account", async () => {
  await fixture();
  await app.evaluate(() => {
    const f = (globalThis as any).accountsFixture;
    f.holdPoll = true;
    f.mode = "completed";
  });
  await page
    .getByRole("button", { name: "登录 / 添加账号 →", exact: true })
    .click();
  await page
    .getByRole("button", { name: "登录 Microsoft", exact: true })
    .click();
  await expect
    .poll(() =>
      app.evaluate(
        () => typeof (globalThis as any).accountsFixture.releasePoll,
      ),
    )
    .toBe("function");
  await page.evaluate(() =>
    window.dispatchEvent(new CustomEvent("navigate", { detail: "home" })),
  );
  await app.evaluate(() => (globalThis as any).accountsFixture.releasePoll());
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // The fixture delivers a completed account after cancellation, deliberately ignoring the real service's cancellation barrier.
  await expect
    .poll(() =>
      page.evaluate(
        async () =>
          (await window.launcher.invoke("accounts.list", undefined)).length,
      ),
    )
    .toBe(1);
  expect(await page.evaluate(() => localStorage.getItem("account"))).toBeNull();
});
test("offline pending submit guard, duplicate reuse, select and remove preserve other identities", async () => {
  await fixture();
  await app.evaluate(
    () => ((globalThis as any).accountsFixture.holdLocal = true),
  );
  await page
    .getByRole("button", { name: "登录 / 添加账号 →", exact: true })
    .click();
  await page.getByRole("button", { name: "添加本地账号", exact: true }).click();
  let modal = page.getByRole("dialog");
  await modal.getByLabel("本地玩家名").fill("Steve");
  await modal
    .getByRole("button", { name: "保存", exact: true })
    .evaluate((node: HTMLButtonElement) => {
      node.click();
      node.click();
    });
  await modal.getByLabel("本地玩家名").press("Enter");
  await expect(
    modal.getByRole("button", { name: "保存", exact: true }),
  ).toBeDisabled();
  expect(
    await app.evaluate(
      () =>
        (globalThis as any).accountsFixture.calls.filter(
          (c: any) => c.command === "accounts.addLocal",
        ).length,
    ),
  ).toBe(1);
  await app.evaluate(() => {
    const f = (globalThis as any).accountsFixture;
    f.holdLocal = false;
    f.releaseLocal();
  });
  await expect(modal).toHaveCount(0);
  for (const name of ["Steve", "Alex"]) {
    await page
      .getByRole("button", { name: "添加本地账号", exact: true })
      .click();
    modal = page.getByRole("dialog");
    await modal.getByLabel("本地玩家名").fill(name);
    await modal.getByLabel("本地玩家名").press("Enter");
    await expect(modal).toHaveCount(0);
  }
  expect(
    await page.evaluate(
      async () =>
        (await window.launcher.invoke("accounts.list", undefined)).length,
    ),
  ).toBe(2);
  const row = page
    .locator(".version-row")
    .filter({ has: page.getByText("Steve", { exact: true }) });
  await row.getByRole("button", { name: "选择", exact: true }).click();
  await expect(
    row.getByRole("button", { name: "已选择", exact: true }),
  ).toBeVisible();
  await row.getByRole("button", { name: "移除", exact: true }).click();
  await expect(row).toHaveCount(0);
  const remaining = await page.evaluate(() =>
    window.launcher.invoke("accounts.list", undefined),
  );
  expect(remaining.map((a) => a.name)).toEqual(["Alex"]);
  expect(await page.evaluate(() => localStorage.getItem("account"))).toBe(
    remaining[0].id,
  );
});

test('inline client configuration synchronizes advanced save without losing directory draft', async () => {
  await fixture();
  await app.evaluate(() => ((globalThis as any).accountsFixture.missingClient = true));
  const clientId = '12345678-1234-1234-1234-123456789abc';
  await page.getByRole('button', { name: '登录 / 添加账号 →', exact: true }).click();
  const advanced = page.locator('section').filter({ has: page.getByRole('heading', { name: '高级配置', exact: true }) });
  await expect(advanced.getByLabel('Microsoft 客户端 ID', { exact: true })).toHaveValue('');
  const directoryDraft = 'E:\\UnsavedAccountRegressionDraft';
  await advanced.getByLabel('新游戏安装目录（留空使用应用数据目录）').fill(directoryDraft);
  await page.getByRole('button', { name: '登录 Microsoft', exact: true }).click();
  const modal = page.getByRole('dialog', { name: '登录 Microsoft', exact: true });
  await expect(modal.getByLabel('Microsoft 客户端 ID', { exact: true })).toBeVisible();
  await fixture();
  await modal.getByLabel('Microsoft 客户端 ID', { exact: true }).fill(clientId);
  await modal.getByRole('button', { name: '保存并重试', exact: true }).click();
  await expect(modal).toContainText('ABCD-EFGH');
  await modal.getByRole('button', { name: '关闭', exact: true }).click();
  await expect(modal).toHaveCount(0);
  await expect(advanced.getByLabel('Microsoft 客户端 ID', { exact: true })).toHaveValue(clientId);
  await expect(advanced.getByLabel('新游戏安装目录（留空使用应用数据目录）')).toHaveValue(directoryDraft);
  await advanced.getByRole('button', { name: '保存客户端 ID', exact: true }).click();
  const saved = await page.evaluate(() => window.launcher.invoke('settings.read', undefined));
  expect(saved.microsoftClientId).toBe(clientId);
  expect(saved.gameDirectory).toBe('');
});
