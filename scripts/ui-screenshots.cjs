const { _electron: electron } = require("@playwright/test");
const { mkdir, mkdtemp } = require("node:fs/promises");
const { tmpdir } = require("node:os");
const { join } = require("node:path");
(async () => {
  await mkdir("validation/task7", { recursive: true });
  const data = await mkdtemp(join(tmpdir(), "zhumeng-shots-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  const page = await app.firstWindow();
  await page.waitForSelector(".opening");
  await page.waitForTimeout(1100);
  await page.screenshot({ path: "validation/task7/opening.png" });
  await page.keyboard.press("Escape");
  await page.waitForSelector(".home-intro");
  for (const [w, h] of [
    [1280, 820],
    [960, 640],
  ]) {
    await app.evaluate(
      ({ BrowserWindow }, size) =>
        BrowserWindow.getAllWindows()[0].setSize(...size),
      [w, h],
    );
    for (const theme of ["dark", "light"]) {
      await page.evaluate(
        (theme) =>
          window.launcher.invoke("settings.patch", {
            theme,
            openingEnabled: false,
          }),
        theme,
      );
      await page.reload();
      await page.waitForSelector(".home-intro");
      await page.waitForTimeout(400);
      await page.screenshot({
        path: `validation/task7/home-${w}-${theme}.png`,
      });
    }
  }
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(1280, 820),
  );
  await page.evaluate(() =>
    window.launcher.invoke("settings.patch", {
      theme: "dark",
      reducedMotion: true,
    }),
  );
  await page.reload();
  await page.waitForSelector(".home-intro");
  for (const [id, label] of [
    ["library", "游戏库"],
    ["download", "下载"],
    ["mods", "模组"],
    ["packs", "整合包"],
    ["personalize", "个性化"],
    ["settings", "设置"],
    ["about", "关于"],
  ]) {
    await page.getByRole("button", { name: label, exact: true }).click();
    await page.waitForTimeout(400);
    await page.screenshot({ path: `validation/task7/${id}-1280-dark.png` });
  }
  await app.close();
})();
