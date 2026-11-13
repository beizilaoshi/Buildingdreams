import './local-mods-ui.spec';
import './feedback-ui.spec';
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PNG } from "pngjs";
import './content-ui.spec';

test("real account appearance IPC composites face and hat, handles legacy skins, and ignores stale identity responses", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-avatar-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  const root = join(data, "minecraft");
  await mkdir(join(root, "versions", "DreamWorld"), { recursive: true });
  await writeFile(join(root, "versions", "DreamWorld", "DreamWorld.json"), JSON.stringify({ id: "DreamWorld", mainClass: "Main", libraries: [], minecraftArguments: "" }));
  const makeSkin = (height: number, opaque = false) => {
    const image = new PNG({ width: 64, height });
    image.data.fill(opaque ? 255 : 0);
    for (let y = 8; y < 16; y++) for (let x = 8; x < 16; x++) image.data.set([200, 90, 40, 255], (y * 64 + x) * 4);
    const face = ["11111111", "00000000", "01111110", "11211211", "11311311", "11144111", "11444411", "11144111"];
    const colors = [[73, 48, 37, 255], [185, 137, 105, 255], [244, 240, 223, 255], [91, 104, 177, 255], [112, 69, 53, 255]];
    face.forEach((row, y) => [...row].forEach((v, x) => { if (x || y) image.data.set(colors[Number(v)], ((y + 8) * 64 + x + 8) * 4); }));
    image.data.set([20, 180, 240, opaque ? 255 : 128], (8 * 64 + 40) * 4);
    return PNG.sync.write(image).toString("base64");
  };
  const app = await electron.launch({ args: ["."], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro"); await page.keyboard.press("Escape");
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await app.evaluate(async ({ app, safeStorage }, fixture) => {
      const require = (process as any).mainModule.require.bind((process as any).mainModule);
      const fs = require("node:fs/promises"), path = require("node:path");
      const { AccountService } = require(path.join(fixture.cwd, "dist/main/services/accounts.js"));
      const accounts = ["SlowPlayer", "Dreamer", "LegacyPlayer"].map((name, i) => ({ summary: { id: "official-" + i, uuid: String(i + 1).repeat(32), name, kind: "microsoft", status: "ready" }, texture: "https://textures.minecraft.net/texture/" + String(i + 1).repeat(64), expiresAt: Date.now() + 3600000 }));
      await fs.writeFile(path.join(app.getPath("userData"), "accounts.vault"), safeStorage.encryptString(JSON.stringify(accounts)));
      let once = false;
      const original = AccountService.prototype.list;
      const originalAppearance = AccountService.prototype.appearance;
      AccountService.prototype.appearance = async function (id: string) {
        const result = await originalAppearance.call(this, id);
        (globalThis as any).finishedAppearance = id;
        return result;
      };
      AccountService.prototype.list = function () {
        if (!once) { once = true; this.loaded = false; }
        this.fetcher = async (url: string, init: RequestInit) => {
          if ((init?.headers as any)?.Authorization) throw new Error("credential leak");
          if (url.endsWith("1".repeat(64))) return new Promise((resolve) => { (globalThis as any).releaseAvatar = () => resolve(new Response(Buffer.from(fixture.modern, "base64"))); });
          return new Response(Buffer.from(url.endsWith("3".repeat(64)) ? fixture.legacy : fixture.modern, "base64"));
        };
        return original.call(this);
      };
    }, { cwd: process.cwd(), modern: makeSkin(64), legacy: makeSkin(32, true) });
    await page.evaluate(async (root) => {
      await window.launcher.invoke("instances.import", root);
      await window.launcher.invoke("settings.patch", { openingEnabled: false, reducedMotion: true });
      localStorage.setItem("account", "official-0");
      localStorage.removeItem("accountSelection"); // Seed a legacy selection for migration.
    }, root);
    await page.reload(); await page.waitForSelector(".home-intro");
    await expect(page.locator(".home-aside h3")).toHaveText("SlowPlayer");
    const pixel = () => page.locator(".avatar-head").evaluate((canvas: HTMLCanvasElement) => [...canvas.getContext("2d")!.getImageData(0, 0, 1, 1).data]);
    const switchTo = async (name: string) => {
      await page.getByRole("button", { name: "切换账号", exact: true }).click();
      await page.getByRole("radiogroup", { name: "当前账号", exact: true }).getByRole("radio", { name, exact: true }).click();
    };
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).releaseAvatar)).toBe("function");
    await switchTo("Dreamer");
    await expect(page.locator(".avatar-head")).toHaveAttribute("aria-label", "Dreamer 的 Minecraft 皮肤头像");
    await expect.poll(pixel).toEqual([110, 135, 140, 255]);
    await page.screenshot({ path: "validation/cinematic-home-official-avatar.png" });
    await app.evaluate(() => (globalThis as any).releaseAvatar());
    await expect.poll(() => app.evaluate(() => (globalThis as any).finishedAppearance)).toBe("official-0");
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.locator(".home-aside h3")).toHaveText("Dreamer");
    await expect.poll(pixel).toEqual([110, 135, 140, 255]);
    await switchTo("LegacyPlayer");
    await expect(page.locator(".avatar-head")).toHaveAttribute("aria-label", "LegacyPlayer 的 Minecraft 皮肤头像");
    await expect.poll(pixel).toEqual([200, 90, 40, 255]);
    expect(errors).toEqual([]);
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});

test("cinematic home keeps scenery and both action cards visible at all supported sizes", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-cinematic-"));
  const app = await electron.launch({ args: ["."], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await page.evaluate(() => window.launcher.invoke("settings.patch", { openingEnabled: false, reducedMotion: true }));
    for (const theme of ["dark", "light"] as const) {
      await page.evaluate((theme) => window.launcher.invoke("settings.patch", { theme }), theme);
      await page.reload();
      await page.waitForSelector(".home-intro");
      for (const [width, height] of [[1280, 820], [960, 640]]) {
        await app.evaluate(({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0].setSize(w, h), [width, height]);
        await expect(page.locator(".home-intro h1")).toContainText("让每一个世界");
        await expect(page.locator(".home-intro h1")).toHaveCSS("white-space", "pre-line");
        expect(await page.locator(".home-intro h1").evaluate((n) => parseFloat(getComputedStyle(n).fontSize))).toBeGreaterThanOrEqual(38);
        const rail = await page.locator(".navigation").boundingBox();
        expect(rail!.width).toBeLessThanOrEqual(100);
        for (const card of [".launch-panel", ".home-aside"])
          await expect(page.locator(card)).toBeInViewport({ ratio: 1 });
        for (const nav of await page.locator(".nav-item").all()) {
          await expect(nav).toBeInViewport({ ratio: 1 });
          await expect(nav.locator(".nav-label")).toBeVisible();
        }
        const geometry = await page.locator(".home-lower").evaluate((n) => ({ top: n.getBoundingClientRect().top, bottom: n.getBoundingClientRect().bottom, viewport: innerHeight }));
        expect(geometry.top).toBeGreaterThan(geometry.viewport * .48);
        expect(geometry.bottom).toBeLessThanOrEqual(geometry.viewport - 20);
        await expect(page.locator("select, details")).toHaveCount(0);
        await expect(page.locator(".avatar-status")).toContainText("默认头像");
        await page.screenshot({ path: `validation/cinematic-home-${theme}-${width}x${height}.png` });
      }
    }
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});

test("real imported-data mapping, explicit export checklist, IPC exclusions and exit details", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-final-ui-"));
  const { mkdir, writeFile, readFile } = await import("node:fs/promises");
  const root = join(data, "minecraft"),
    mapped = join(data, "mapped"),
    output = join(data, "selected.mrpack");
  for (const dir of ["versions/existing", "saves/World", "mods"])
    await mkdir(join(root, dir), { recursive: true });
  await writeFile(
    join(root, "versions/existing/existing.json"),
    JSON.stringify({
      id: "existing",
      mainClass: "Main",
      libraries: [],
      minecraftArguments: "",
    }),
  );
  await writeFile(join(root, "saves/World/level.dat"), "existing world");
  await writeFile(join(root, "mods/local.jar"), "existing mod");
  await mkdir(join(mapped, "config"), { recursive: true });
  await writeFile(join(mapped, "config/safe.txt"), "safe override");
  await writeFile(join(mapped, "config/service.json"), "private content");
  await writeFile(join(mapped, "config/token.json"), "secret");
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await app.evaluate(
      ({ dialog }, paths) => {
        let index = 0;
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [paths[index++]],
        });
      },
      [root, mapped],
    );
    await page.getByRole("button", { name: "游戏库", exact: true }).click();
    await page
      .getByRole("button", { name: "导入游戏目录", exact: true })
      .click();
    await expect(page.locator(".game-data-path")).toContainText(root);
    const [item] = await page.evaluate(() =>
      window.launcher.invoke("instances.list", undefined),
    );
    expect(
      await page.evaluate(
        (id) => window.launcher.invoke("mods.list", id),
        item.id,
      ),
    ).toMatchObject([{ fileName: "local.jar" }]);
    await page.getByRole("button", { name: "管理游戏", exact: true }).click();
    await page
      .getByRole("button", { name: "更改数据目录", exact: true })
      .click();
    await expect(page.locator(".game-data-path")).toContainText(mapped);
    expect(
      (
        await page.evaluate(
          (path) => window.launcher.invoke("instances.import", path),
          root,
        )
      )[0].gameDir,
    ).toBe(mapped);
    expect(await readFile(join(root, "saves/World/level.dat"), "utf8")).toBe(
      "existing world",
    );
    await app.evaluate(
      ({}, modulePath) => {
        const { LaunchService } = (process as any).mainModule.require(
          modulePath,
        );
        LaunchService.prototype.logs = () => [
          { time: Date.now(), type: "exit", code: 0, signal: null },
          { time: Date.now(), type: "exit", code: 7, signal: "SIGTERM" },
        ];
      },
      join(process.cwd(), "dist/main/services/launch.js"),
    );
    await page.getByRole("button", { name: "管理游戏", exact: true }).click();
    await page.getByRole("button", { name: "日志", exact: true }).click();
    await expect(page.getByRole("dialog", { name: item.name + " · 启动日志", exact: true })).toContainText(
      "游戏正常退出 · 退出码 0 · 信号 无",
    );
    await expect(page.getByRole("dialog", { name: item.name + " · 启动日志", exact: true })).toContainText(
      "游戏异常退出 · 退出码 7 · 信号 SIGTERM",
    );
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "整合包", exact: true }).click();
    const safe = page.getByRole("checkbox", {
      name: "config/safe.txt",
      exact: true,
    });
    const privateFile = page.getByRole("checkbox", {
      name: "config/service.json",
      exact: true,
    });
    await expect(safe).not.toBeChecked();
    await expect(privateFile).not.toBeChecked();
    await expect(
      page.getByRole("checkbox", { name: "config/token.json", exact: true }),
    ).toHaveCount(0);
    await safe.check();
    await app.evaluate(({ dialog }, path) => {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path });
    }, output);
    await page.getByRole("button", { name: "导出整合包", exact: true }).click();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() =>
              window.launcher.invoke("tasks.list", undefined),
            )
          ).at(-1)?.status,
      )
      .toBe("completed");
    const { readArchive } = await import("../src/main/services/archive");
    const zip = await readArchive(output);
    try {
      expect(zip.entries.map((entry) => entry.fileName)).toEqual([
        "modrinth.index.json",
        "overrides/config/safe.txt",
      ]);
    } finally {
      zip.close();
    }
    const rejected = await page.evaluate(
      async ({ id, output }) => {
        try {
          await window.launcher.invoke("packs.export", {
            instanceId: id,
            destination: output,
            options: { overridePaths: "config/safe.txt" as any },
          });
          return false;
        } catch {
          return true;
        }
      },
      { id: item.id, output },
    );
    expect(rejected).toBe(true);
    await page.screenshot({
      path: ".superpowers/sdd/2026-11-03-zhumeng-launcher/final-fix-export.png",
    });
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("real Electron empty library, keyboard opening skip, settings and identity persist", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-ui-"));
  const start = () =>
    electron.launch({
      args: ["."],
      env: { ...process.env, ZHUMENG_DATA_DIR: data },
    });
  let app = await start();
  try {
    let page = await app.firstWindow();
    await page.keyboard.press("Escape");
    await expect(
      page.getByRole("button", { name: "安装游戏", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "个性化", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "主题", exact: true })
      .getByRole("radio", { name: "浅色", exact: true })
      .click();
    await page.getByLabel("减少动态效果", { exact: true }).check();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("button", { name: "添加本地账号", exact: true })
      .click();
    await page.getByRole("dialog").getByLabel("本地玩家名").fill("Dreamer");
    await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByText("Dreamer", { exact: true }).first(),
    ).toBeVisible();
    await app.close();
    app = await start();
    page = await app.firstWindow();
    await page.keyboard.press("Escape");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await page.getByRole("button", { name: "个性化", exact: true }).click();
    await expect(
      page.getByLabel("减少动态效果", { exact: true }),
    ).toBeChecked();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await expect(
      page.getByText("Dreamer", { exact: true }).first(),
    ).toBeVisible();
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("real IPC imports an invalid game fixture and displays launch preflight error", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-import-"));
  const root = join(data, "minecraft");
  const { mkdir, writeFile } = await import("node:fs/promises");
  await mkdir(join(root, "versions", "broken"), { recursive: true });
  await writeFile(
    join(root, "versions", "broken", "broken.json"),
    JSON.stringify({ id: "broken", inheritsFrom: "missing" }),
  );
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await app.evaluate(({ dialog }, root) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [root],
      });
    }, root);
    await page.getByRole("button", { name: "游戏库", exact: true }).click();
    await page
      .getByRole("button", { name: "导入游戏目录", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "broken", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "设置", exact: true }).click();
    await page
      .getByRole("button", { name: "添加本地账号", exact: true })
      .click();
    await page.getByRole("dialog").getByLabel("本地玩家名").fill("Tester");
    await page.getByRole("dialog").getByRole("button", { name: "保存", exact: true }).click();
    await expect(
      page.getByText("Tester", { exact: true }).first(),
    ).toBeVisible();
    await page.getByRole("button", { name: "首页", exact: true }).click();
    await page.getByRole("button", { name: "启动游戏", exact: true }).click();
    await expect(page.locator("#toasts")).toContainText(
      /missing|找不到|ENOENT/,
    );
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("real pack inspection exposes missing CurseForge files and hashes supplied mapping", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-pack-ui-"));
  const file = join(data, "fixture.zip");
  const supplied = join(data, "example.jar");
  const invalid = join(data, "invalid.zip");
  const { writeFile } = await import("node:fs/promises");
  await writeFile(supplied, "fixture-mod");
  await writeFile(invalid, "not a ZIP archive");
  const { ZipFile } = await import("yazl");
  const { createWriteStream } = await import("node:fs");
  const zip = new ZipFile();
  zip.addBuffer(
    Buffer.from(
      JSON.stringify({
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: "Fixture Journey",
        version: "1",
        author: "Fixture",
        minecraft: { version: "1.20.1", modLoaders: [] },
        files: [{ projectID: 123, fileID: 456, required: true }],
        overrides: "overrides",
      }),
    ),
    "manifest.json",
  );
  await new Promise<void>((resolve, reject) => {
    zip.outputStream
      .pipe(createWriteStream(file))
      .on("close", resolve)
      .on("error", reject);
    zip.end();
  });
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await app.evaluate(
      ({ dialog }, paths) => {
        let call = 0;
        dialog.showOpenDialog = async () => ({
          canceled: false,
          filePaths: [paths[call++]],
        });
      },
      [file, supplied, invalid],
    );
    await page.getByRole("button", { name: "整合包", exact: true }).click();
    await page
      .getByRole("button", { name: "选择整合包文件", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Fixture Journey", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByText("项目 123 / 文件 456 · 尚未提供"),
    ).toBeVisible();
    await page.getByRole("button", { name: "选择并校验", exact: true }).click();
    await expect(page.getByText(/项目 123 \/ 文件 456 · 已校验/)).toBeVisible();
    await expect(
      page.getByLabel("临时 CurseForge API Key（不保存）"),
    ).toHaveValue("");
    await page
      .getByRole("button", { name: "选择整合包文件", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Fixture Journey", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "安装整合包", exact: true }),
    ).toHaveCount(0);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("real IPC installs a fixture version and filters Modrinth versions by compatibility", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-install-ui-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    const { createHash } = await import("node:crypto");
    const bytes = "fixture jar";
    const hash = createHash("sha1").update(bytes).digest("hex");
    const index = JSON.stringify({ objects: {} });
    const profile = JSON.stringify({
      id: "1.fixture",
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      minecraftArguments: "",
      time: "2024-01-01T00:00:00Z",
      releaseTime: "2024-01-01T00:00:00Z",
      assets: "fixture",
      assetIndex: {
        id: "fixture",
        url: "https://fixture.invalid/index",
        sha1: createHash("sha1").update(index).digest("hex"),
        size: Buffer.byteLength(index),
      },
      downloads: {
        client: {
          url: "https://fixture.invalid/client",
          sha1: hash,
          size: bytes.length,
        },
      },
      libraries: [],
    });
    await app.evaluate(
      ({}, bodies) => {
        (globalThis as any).__requests = [];
        globalThis.fetch = async (url: any) => {
          const target = String(url);
          (globalThis as any).__requests.push(target);
          const response = (bodies as Record<string, string>)[target];
          if (response === undefined)
            throw new Error("Unexpected fixture URL " + target);
          return new Response(response, { status: 200 });
        };
      },
      {
        "https://piston-meta.mojang.com/mc/game/version_manifest_v2.json":
          JSON.stringify({
            versions: [
              {
                id: "1.fixture",
                url: "https://fixture.invalid/version",
                type: "release",
              },
            ],
          }),
        "https://fixture.invalid/version": profile,
        "https://fixture.invalid/client": bytes,
        "https://fixture.invalid/index": index,
      },
    );
    await page.getByRole("button", { name: "安装游戏", exact: true }).click();
    await page.getByRole("button", { name: "正式版", exact: true }).click();
    await page.getByRole("button", { name: /选择 1.fixture/ }).click();
    await page.getByLabel("游戏名称").fill("Fixture World");
    await page.getByRole("button", { name: "开始安装", exact: true }).click();
    await expect(page.locator("#app").getByText("已完成", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "游戏库", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Fixture World", exact: true }),
    ).toBeVisible();
    await app.evaluate(() => {
      globalThis.fetch = async (url: any) => {
        const target = String(url);
        (globalThis as any).__requests.push(target);
        if (target.includes('/team/')) return new Response(JSON.stringify([{user:{username:'Fixture author'}}]));
        if (target.endsWith('/project/project-fixture')) return new Response(JSON.stringify({id:'project-fixture',slug:'project-fixture',title:'A <safe> Mod',project_type:'mod',description:'Fixture compatibility result',body:'',team:'fixture-team',categories:[],downloads:12,followers:0}));
        return new Response(
          JSON.stringify(
            target.includes("/version")
              ? [
                  {
                    id: "version-fixture",
                    project_id: "project-fixture",
                    name: "Compatible release",
                    version_number: "1",
                    date_published: "2024-01-01",
                    game_versions: ["1.fixture"],
                    loaders: ["fabric"],
                    files: [],
                    dependencies: [],
                  },
                ]
              : {
                  hits: [
                    {
                      project_id: "project-fixture",
                      title: "A <safe> Mod",
                      description: "Fixture compatibility result",
                      downloads: 12,
                    },
                  ],
                  offset: 0,
                  limit: 12,
                  total_hits: 1,
                },
          ),
        );
      };
    });
    await page.getByRole("button", { name: "模组", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "兼容加载器" })
      .getByRole("radio", { name: "Fabric", exact: true })
      .click();
    await page.getByLabel("搜索 Mod").fill("fixture");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "A <safe> Mod", exact: true }),
    ).toBeVisible();
    await page.locator('.content-project-row').click();
    await expect(
      page.locator('.content-file-version h4'),
    ).toHaveText('Compatible release');
    await page.getByRole('button',{name:'返回搜索结果',exact:true}).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    const requests = await app.evaluate(
      () => (globalThis as any).__requests as string[],
    );
    expect(
      requests.some((x) =>
        decodeURIComponent(x).includes("versions:1.fixture"),
      ),
    ).toBe(true);
    expect(
      requests.some((x) => decodeURIComponent(x).includes("categories:fabric")),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("wallpaper import uses managed protocol and developer link remains constrained", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-wall-ui-"));
  const { copyFile, readdir } = await import("node:fs/promises");
  const source = join(data, "source.png");
  await copyFile(
    join(process.cwd(), "public", "assets", "moonlake.png"),
    source,
  );
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await app.evaluate(({ dialog }, source) => {
      dialog.showOpenDialog = async () => ({
        canceled: false,
        filePaths: [source],
      });
    }, source);
    await page.getByRole("button", { name: "个性化", exact: true }).click();
    await page
      .getByRole("button", { name: "导入本地壁纸", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(() =>
          document.documentElement.style.getPropertyValue("--wallpaper"),
        ),
      )
      .toContain("zhumeng-wallpaper://local/");
    const wallpaper = await page.evaluate(() =>
      window.launcher
        .invoke("settings.read", undefined)
        .then((x) => x.wallpaper),
    );
    expect(await readdir(join(data, "wallpapers"))).toHaveLength(1);
    await rm(source);
    expect(
      await page.evaluate(async (url) => {
        const image = new Image();
        image.src = url;
        try {
          await image.decode();
          return image.naturalWidth > 0;
        } catch {
          return false;
        }
      }, wallpaper),
    ).toBe(true);
    await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
    await page
      .getByRole("radiogroup", { name: "主题", exact: true })
      .getByRole("radio", { name: "跟随系统", exact: true })
      .click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await expect(page.locator("html")).toHaveAttribute(
      "data-motion",
      "reduced",
    );
    await page.emulateMedia({ colorScheme: "light" });
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await app.evaluate(({ shell }) => {
      shell.openExternal = async (url) => {
        (globalThis as any).__opened = url;
      };
    });
    await page.getByRole("button", { name: "关于", exact: true }).click();
    await page
      .getByRole("button", { name: "GitHub · 杯艺宣 ↗", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    expect(await app.evaluate(() => (globalThis as any).__opened)).toBe(
      "https://github.com/beizilaoshi",
    );
    await expect(page.locator(".community-card")).toContainText("638500178");
    await page
      .getByRole("button", { name: "添加社区交流群 ↗", exact: true })
      .click();
    expect(await app.evaluate(() => (globalThis as any).__opened)).toBe(
      "https://qm.qq.com/q/C28ONm8EQa",
    );
    await page
      .getByRole("button", { name: "查看第三方软件许可", exact: true })
      .click();
    await expect(page.getByRole("dialog")).toContainText("MIT");
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("out-of-order loader responses cannot repopulate a superseded selection", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-loader-race-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await app.evaluate(() => {
      (globalThis as any).__loaderReplies = [];
      globalThis.fetch = async (url: any) => {
        const target = String(url);
        if (target.includes("version_manifest"))
          return new Response(
            JSON.stringify({
              versions: [
                { id: "1.20.1", url: "https://fixture.invalid/120" },
                { id: "1.21.1", url: "https://fixture.invalid/121" },
              ],
            }),
          );
        return new Promise<Response>((resolve) =>
          (globalThis as any).__loaderReplies.push((body: string) =>
            resolve(new Response(body)),
          ),
        );
      };
    });
    await page.getByRole("button", { name: "下载", exact: true }).click();
    await page.getByRole("button", { name: "远古版", exact: true }).click();
    await page.getByRole("button", { name: /选择 1.20.1/ }).click();
    const kind = page.getByRole("radiogroup", { name: "加载器", exact: true });
    const versions = page.getByRole("radiogroup", {
      name: "加载器版本",
      exact: true,
      includeHidden: true,
    });
    const install = page.getByRole("button", { name: "开始安装", exact: true });
    await kind.getByRole("radio", { name: "Forge", exact: true }).click();
    await expect(install).toBeDisabled();
    await kind.getByRole("radio", { name: "Fabric", exact: true }).click();
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as any).__loaderReplies.length),
      )
      .toBe(2);
    await app.evaluate(() =>
      (globalThis as any).__loaderReplies[1](
        JSON.stringify([{ loader: { version: "0.16.10", stable: true } }]),
      ),
    );
    await expect(versions).toHaveAttribute("data-value", "0.16.10");
    await expect(install).toBeEnabled();
    await app.evaluate(() =>
      (globalThis as any).__loaderReplies[0](
        "<metadata><versioning><versions><version>1.20.1-47.3.0</version></versions></versioning></metadata>",
      ),
    );
    await expect(versions.getByRole("radio")).toHaveCount(1);
    await expect(versions).toHaveAttribute("data-value", "0.16.10");
    await page.getByRole("button", { name: "返回版本列表", exact: true }).click();
    await page.getByRole("button", { name: /选择 1.21.1/ }).click();
    await expect(install).toBeDisabled();
    await expect
      .poll(() =>
        app.evaluate(() => (globalThis as any).__loaderReplies.length),
      )
      .toBe(3);
    await kind.getByRole("radio", { name: "原版", exact: true }).click();
    await expect(install).toBeEnabled();
    await app.evaluate(() =>
      (globalThis as any).__loaderReplies[2](
        JSON.stringify([{ loader: { version: "0.16.11", stable: true } }]),
      ),
    );
    await expect(versions.getByRole("radio")).toHaveCount(0);
    await expect(versions).toHaveAttribute("data-value", "");
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("terminal device-login states dismiss through Close and Escape", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-device-terminal-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await page.evaluate(() =>
      window.launcher.invoke("settings.patch", {
        microsoftClientId: "11111111-2222-3333-4444-555555555555",
      }),
    );
    await app.evaluate(
      ({ shell, clipboard }, modulePath) => {
        shell.openExternal = async () => {};
        clipboard.writeText = async () => {};
        const { MockAgent, setGlobalDispatcher } = (
          process as any
        ).mainModule.require(modulePath);
        const agent = new MockAgent();
        agent.disableNetConnect();
        const authority = agent.get("https://login.microsoftonline.com");
        authority
          .intercept({
            path: "/consumers/oauth2/v2.0/devicecode",
            method: "POST",
          })
          .reply(200, {
            user_code: "FIXTURE-CODE",
            device_code: "fixture-device",
            expires_in: 120,
            interval: 5,
          })
          .persist();
        authority
          .intercept({ path: "/consumers/oauth2/v2.0/token", method: "POST" })
          .reply(400, { error: "authorization_declined" })
          .persist();
        setGlobalDispatcher(agent);
      },
      join(process.cwd(), "node_modules", "undici", "index.js"),
    );
    await page.getByRole("button", { name: "设置", exact: true }).click();
    for (const action of ["close", "escape"]) {
      await page
        .getByRole("button", { name: "登录 Microsoft", exact: true })
        .click();
      const modal = page.getByRole("dialog");
      await expect(modal).toContainText("授权已拒绝", {
        timeout: 10000,
      });
      if (action === "close")
        await modal.getByRole("button", { name: "关闭", exact: true }).click();
      else await page.keyboard.press("Escape");
      await expect(modal).toHaveCount(0);
    }
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("desktop cards keep navigation visible and version search bounded at minimum size", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-cards-"));
  const app = await electron.launch({
    args: ["."],
    env: { ...process.env, ZHUMENG_DATA_DIR: data },
  });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0].setSize(960, 640),
    );
    for (const name of [
      "首页",
      "游戏库",
      "下载",
      "模组",
      "整合包",
      "个性化",
      "设置",
      "关于",
    ]) {
      const nav = page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true });
      await expect(nav).toBeInViewport();
      await expect(nav.locator(".nav-label")).toBeVisible();
    }
    await app.evaluate(() => {
      globalThis.fetch = async () =>
        new Response(
          JSON.stringify({
            versions: Array.from({ length: 921 }, (_, i) => ({
              id: `fixture-${i}`,
              type: i % 2 ? "snapshot" : "release",
              url: "https://fixture.invalid/version",
            })),
          }),
        );
    });
    await page.getByRole("button", { name: "下载", exact: true }).click();
    await expect(page.locator("select, details")).toHaveCount(0);
    const browser = page.locator(".version-browser");
    await expect(browser.locator(".version-group-toggle")).toHaveCount(4);
    await expect(browser.locator(".version-row")).toHaveCount(0);
    await browser.getByRole("button", { name: "正式版", exact: true }).click();
    await expect(browser.locator(".version-row")).toHaveCount(24);
    await browser.getByRole("button", { name: "显示更多", exact: true }).click();
    await expect(browser.locator(".version-row")).toHaveCount(48);
    await expect(browser.getByRole("button", {name:"显示更多",exact:true})).toBeFocused();
    await browser.getByRole("button", { name: "正式版", exact: true }).click();
    await expect(browser.locator(".version-row")).toHaveCount(0);
    await page.getByRole("searchbox", { name: "搜索 Minecraft 版本", exact: true }).fill("fixture-920");
    await expect(browser.locator(".version-row")).toHaveCount(1);
    await browser.getByRole("button", {name:"正式版",exact:true}).click();
    await expect(browser.locator(".version-row")).toHaveCount(0);
    await browser.getByRole("button", {name:"正式版",exact:true}).click();
    await page.getByRole("searchbox", { name: "搜索 Minecraft 版本", exact: true }).focus();
    await page.keyboard.press("ArrowLeft");
    expect(await page.getByRole("searchbox", { name: "搜索 Minecraft 版本", exact: true }).evaluate((n: HTMLInputElement)=>n.selectionStart)).toBe(10);
    await browser.getByRole("button", { name: /选择 fixture-920/ }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("heading", { name: "安装 fixture-920", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "开始安装", exact: true })).toBeEnabled();
    await expect(page.locator(".task-card")).toHaveCount(0);
    await page.getByRole("button", { name: "返回版本列表", exact: true }).click();
    await expect(page.getByRole("searchbox", { name: "搜索 Minecraft 版本", exact: true })).toHaveValue("fixture-920");
    await expect(browser.getByRole("button", { name: "选择 fixture-920", exact: true })).toBeFocused();
    await expect(browser.getByRole("button", { name: "正式版", exact: true })).toHaveAttribute("aria-expanded", "true");
    await page.getByRole("button", { name: "个性化", exact: true }).click();
    await expect(page.locator("select, details")).toHaveCount(0);
    await expect(page.getByText("游戏库视图", { exact: true })).toHaveCount(0);
    await expect(page.getByText("显示导航文字", { exact: true })).toHaveCount(
      0,
    );
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("visible choice cards persist appearance, selected game/account and runtime scope values", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-choice-ui-"));
  const { mkdir, writeFile } = await import("node:fs/promises");
  const root = join(data, "games");
  for (const id of ["Alpha", "Beta"]) {
    await mkdir(join(root, "versions", id), { recursive: true });
    await writeFile(
      join(root, "versions", id, id + ".json"),
      JSON.stringify({
        id,
        mainClass: "Main",
        minecraftArguments: "",
        libraries: [],
      }),
    );
  }
  const start = () =>
    electron.launch({
      args: ["."],
      env: { ...process.env, ZHUMENG_DATA_DIR: data },
    });
  let app = await start();
  try {
    let page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await page.keyboard.press("Escape");
    await page.evaluate(async (root) => {
      await window.launcher.invoke("instances.import", root);
      await window.launcher.invoke("accounts.addLocal", "PlayerOne");
      await window.launcher.invoke("accounts.addLocal", "PlayerTwo");
      await window.launcher.invoke("settings.patch", {
        libraryView: "list",
        navigationLabels: false,
        openingEnabled: false,
      });
    }, root);
    await page.reload();
    await page.waitForSelector(".home-intro");
    await page.getByRole("button", { name: "切换游戏", exact: true }).click();
    await page
      .locator(".home-game-card")
      .filter({ has: page.getByRole("heading", { name: "Beta", exact: true }) })
      .click();
    await expect(page.locator(".launch-panel h2")).toHaveText("Beta");
    await page.getByRole("button", { name: "切换账号", exact: true }).click();
    await page
      .getByRole("radiogroup", { name: "当前账号", exact: true })
      .getByRole("radio", { name: "PlayerTwo", exact: true })
      .click();
    await expect(page.locator(".home-aside h3")).toHaveText("PlayerTwo");
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "设置", exact: true })
      .click();
    const scope = page.getByRole("radiogroup", {
      name: "配置范围",
      exact: true,
    });
    await scope
      .getByRole("radio", { name: "新游戏默认值", exact: true })
      .click();
    await page.getByLabel("最大内存（MB）", { exact: true }).fill("6144");
    await page
      .getByRole("button", { name: "保存运行配置", exact: true })
      .click();
    await scope.getByRole("radio", { name: "当前实例", exact: true }).click();
    await expect(
      page.getByLabel("最大内存（MB）", { exact: true }),
    ).toHaveValue("2048");
    await page.getByLabel("最大内存（MB）", { exact: true }).fill("8192");
    await page
      .getByRole("button", { name: "保存运行配置", exact: true })
      .click();
    await expect
      .poll(() =>
        page.evaluate(async () => ({
          defaults: (await window.launcher.invoke("settings.read", undefined))
            .memoryMb,
          game: (
            await window.launcher.invoke("instances.list", undefined)
          ).find((x) => x.name === "Beta")?.memoryMb,
        })),
      )
      .toEqual({ defaults: 6144, game: 8192 });
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "个性化", exact: true })
      .click();
    for (const [group, name] of [
      ["主题", "浅色"],
      ["壁纸填充", "完整显示"],
      ["界面密度", "紧凑"],
      ["开场主题", "极简"],
    ]) {
      const radio = page
        .getByRole("radiogroup", { name: group, exact: true })
        .getByRole("radio", { name, exact: true });
      await radio.click();
      await expect(radio).toHaveAttribute("aria-checked", "true");
    }
    await expect
      .poll(() =>
        page.evaluate(() => window.launcher.invoke("settings.read", undefined)),
      )
      .toMatchObject({
        theme: "light",
        wallpaperFit: "contain",
        density: "compact",
        openingTheme: "minimal",
      });
    await app.close();
    app = await start();
    page = await app.firstWindow();
    await page.waitForSelector(".home-intro");
    await expect(page.locator(".launch-panel h2")).toHaveText("Beta");
    await expect(page.locator(".home-aside h3")).toHaveText("PlayerTwo");
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    await expect(page.locator("html")).toHaveAttribute(
      "data-density",
      "compact",
    );
    await page
      .getByRole("navigation")
      .getByRole("button", { name: "游戏库", exact: true })
      .click();
    await expect(page.locator(".library-grid > .game-card")).toHaveCount(2);
    await expect(
      page.getByRole("button", { name: "卡片 / 列表", exact: true }),
    ).toHaveCount(0);
    for (const name of [
      "首页",
      "游戏库",
      "下载",
      "模组",
      "整合包",
      "个性化",
      "设置",
      "关于",
    ]) {
      await page
        .getByRole("navigation")
        .getByRole("button", { name, exact: true })
        .click();
      await expect(page.locator("select,details")).toHaveCount(0);
      await expect(
        page
          .getByRole("navigation")
          .getByRole("button", { name, exact: true })
          .locator(".nav-label"),
      ).toBeVisible();
    }
  } finally {
    await app.close();
    await rm(data, { recursive: true, force: true });
  }
});

test("PCL version browser shows source latest, independent groups and explicit installation details", async () => {
  const data = await mkdtemp(join(tmpdir(), "zhumeng-version-browser-"));
  const app = await electron.launch({args:["."],env:{...process.env,ZHUMENG_DATA_DIR:data}});
  try {
    const page=await app.firstWindow(); await page.waitForSelector(".home-intro"); await page.keyboard.press("Escape");
    await page.evaluate(()=>window.launcher.invoke("settings.patch",{openingEnabled:false,reducedMotion:true}));
    await app.evaluate(()=>{
      globalThis.fetch=async (url:any)=> {
        if(String(url).includes("version_manifest")) return new Response(JSON.stringify({latest:{release:"26.3",snapshot:"26.4-snapshot-7"},versions:[
          {id:"26.3",type:"release",releaseTime:"2026-09-15T11:23:00Z"},
          {id:"26.2",type:"release",releaseTime:"2026-06-16T12:03:00Z"},
          {id:"1.9",type:"release",releaseTime:"2016-02-29T12:00:00Z"},
          {id:"26.4-snapshot-7",type:"snapshot",releaseTime:"2026-11-03T13:08:00Z"},
          {id:"a1.2.6",type:"old_alpha",releaseTime:"2010-12-03T12:00:00Z"},
          {id:"20w14infinite",type:"snapshot",releaseTime:"2020-04-01T12:00:00Z"},
        ].map(x=>({...x,url:"https://fixture.invalid/version"}))}));
        return new Response("[]");
      };
    });
    await page.getByRole("button",{name:"下载",exact:true}).click();
    const browser=page.locator(".version-browser");
    const overlay = await page.locator("body").evaluate(n => getComputedStyle(n, "::after").backgroundColor);
    expect(overlay).toBe("rgba(231, 237, 255, 0.5)");
    await expect(browser.locator(".version-latest .version-row")).toHaveCount(2);
    await expect(browser.locator(".version-group .version-row")).toHaveCount(0);
    await expect(browser.getByRole("button",{name:/选择 26.3/})).toContainText("2026");
    for(const [width,height] of [[1280,820],[960,640]]) {
      await app.evaluate(({BrowserWindow},[w,h])=>BrowserWindow.getAllWindows()[0].setSize(w,h),[width,height]);
      await page.locator("main").evaluate(n=>n.scrollTo({top:0}));
      await expect(page.locator("main")).toHaveCSS("opacity", "1");
      await page.screenshot({path:`validation/pcl-versions-collapsed-${width}.png`});
      await page.evaluate(()=>document.documentElement.dataset.theme="dark");
      await page.screenshot({path:`validation/pcl-versions-collapsed-dark-${width}.png`});
      await page.evaluate(()=>document.documentElement.dataset.theme="light");
      await browser.getByRole("button",{name:"正式版",exact:true}).click();
      await expect(browser.locator(".version-group .version-row").first()).toContainText("26.3");
      await browser.getByRole("button",{name:"远古版",exact:true}).click();
      await expect(browser.getByRole("button",{name:"正式版",exact:true})).toHaveAttribute("aria-expanded","true");
      await page.locator("main").evaluate(n=>n.scrollTo({top:0}));
      await page.screenshot({path:`validation/pcl-versions-expanded-${width}.png`});
      await page.evaluate(()=>document.documentElement.dataset.theme="dark");
      await page.screenshot({path:`validation/pcl-versions-expanded-dark-${width}.png`});
      await page.evaluate(()=>document.documentElement.dataset.theme="light");
      await browser.locator(".version-group").getByRole("button",{name:"选择 26.3",exact:true}).click();
      await expect(page.getByRole("heading",{name:"安装 26.3",exact:true})).toBeVisible();
      await expect(page.locator(".task-card")).toHaveCount(0);
      await page.screenshot({path:`validation/pcl-versions-install-${width}.png`});
      await page.evaluate(()=>document.documentElement.dataset.theme="dark");
      await page.screenshot({path:`validation/pcl-versions-install-dark-${width}.png`});
      await page.evaluate(()=>document.documentElement.dataset.theme="light");
      await page.getByRole("radiogroup",{name:"加载器",exact:true}).getByRole("radio",{name:"Fabric",exact:true}).click();
      await expect(page.getByText("此 Minecraft 版本暂无可用加载器。",{exact:true})).toBeVisible();
      await expect(page.getByRole("button",{name:"开始安装",exact:true})).toBeDisabled();
      await page.getByRole("radiogroup",{name:"加载器",exact:true}).getByRole("radio",{name:"原版",exact:true}).click();
      await page.getByRole("button",{name:"返回版本列表",exact:true}).click();
      await browser.getByRole("button",{name:"正式版",exact:true}).click();
      await browser.getByRole("button",{name:"远古版",exact:true}).click();
    }
    await page.getByRole("searchbox",{name:"搜索 Minecraft 版本",exact:true}).fill("20w14");
    await expect(browser.locator(".version-group .version-row")).toHaveCount(1);
    await expect(browser.getByRole("button",{name:"愚人节版",exact:true})).toHaveAttribute("aria-expanded","true");
    await browser.getByRole("button",{name:/选择 20w14infinite/}).click();
    await app.evaluate(()=>{ globalThis.fetch=async()=>{throw new Error("fixture offline");}; });
    await page.getByRole("radiogroup",{name:"加载器",exact:true}).getByRole("radio",{name:"Forge",exact:true}).click();
    await expect(page.getByText("加载器版本获取失败，可重试。",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"重试获取加载器",exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"重试获取加载器",exact:true})).toBeEnabled();
    await expect(page.getByRole("button",{name:"开始安装",exact:true})).toBeDisabled();
    await page.getByRole("button",{name:"首页",exact:true}).click();
    await page.getByRole("button",{name:"下载",exact:true}).click();
    await expect(page.getByText("无法获取版本列表，请稍后重试。",{exact:true})).toBeVisible();
    await expect(page.getByRole("button",{name:"开始安装",exact:true})).toBeHidden();
    await app.evaluate(()=>{ globalThis.fetch=async()=>new Response(JSON.stringify({versions:[]})); });
    await page.getByRole("button",{name:"首页",exact:true}).click();
    await page.getByRole("button",{name:"下载",exact:true}).click();
    await page.getByRole("button",{name:"正式版",exact:true}).click();
    await expect(page.getByText("此分类暂无版本",{exact:true})).toBeVisible();
    await page.keyboard.press("Space");
    await expect(page.getByRole("button",{name:"正式版",exact:true})).toHaveAttribute("aria-expanded","false");
  } finally {await app.close();await rm(data,{recursive:true,force:true});}
});

import './content-resources-ui.spec';

import './content-localization-ui.spec';
import './java-ui.spec';

import './curseforge-ui.spec';

import './launch-ui.spec';

import './brand-opening-ui.spec';
