import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
test("Java auto mode uses production managed acquisition, persists manual mode, disables download and cancels launch", async () => {
    const data = await mkdtemp(join(tmpdir(), "zhumeng-java-ui-"));
    const game = join(data, "minecraft"), manual = join(data, "manual-java.exe");
    await mkdir(join(game, "versions/base"), { recursive: true });
    await writeFile(join(game, "versions/base/base.json"), JSON.stringify({ id: "base", mainClass: "FixtureMain", minecraftArguments: "", libraries: [], javaVersion: { majorVersion: 17 } }));
    await writeFile(join(game, "versions/base/base.jar"), "fixture game jar");
    await writeFile(manual, "fixture-major-17");
    const zips: {
        major: number;
        base64: string;
        sha256: string;
        size: number;
    }[] = [];
    for (const major of [17, 21]) {
        const zip = new ZipFile();
        zip.addBuffer(Buffer.from(`fixture-major-${major}`), `jdk-${major}/bin/java.exe`);
        zip.addBuffer(Buffer.from("fixture license"), `jdk-${major}/legal/LICENSE`);
        zip.end();
        const chunks: Buffer[] = [];
        for await (const chunk of zip.outputStream)
            chunks.push(Buffer.from(chunk));
        const bytes = Buffer.concat(chunks);
        zips.push({ major, base64: bytes.toString("base64"), sha256: createHash("sha256").update(bytes).digest("hex"), size: bytes.length });
    }
    const app = await electron.launch({ args: ["."], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
    try {
        await app.evaluate(async (_electron, fixtures) => {
            const require = (process as any).mainModule.require.bind((process as any).mainModule);
            const path = require("node:path"), fs = require("node:fs/promises");
            const { JavaService } = require(path.join(fixtures.cwd, "dist/main/services/java.js"));
            JavaService.prototype.detect = async function () { return this.managedList(); };
            JavaService.prototype.inspect = async function (file: string) { const body = await fs.readFile(file, "utf8"); const major = Number(/^fixture-major-(17|21)$/.exec(body)?.[1]); if (!major)
                throw Error("Only fixture bytes can be inspected in this test; never executing fixture files"); return { path: file, version: `${major}.0.1+1`, major, arch: "amd64" }; };
            const original = globalThis.fetch;
            globalThis.fetch = async (input: any, init: any) => {
                const url = String(input);
                const major = Number(/(?:latest\/|temurin)(17|21)/.exec(url)?.[1]);
                if (!major)
                    return original(input, init);
                const fixture = fixtures.zips.find(x => x.major === major)!;
                if (url.includes("api.adoptium.net"))
                    return Response.json([{ vendor: "eclipse", version: { major, openjdk_version: `${major}.0.1+1` }, binary: { architecture: "x64", os: "windows", image_type: "jre", jvm_impl: "hotspot", package: { name: `OpenJDK${major}U-jre_x64_windows_hotspot_${major}.0.1_1.zip`, link: `https://github.com/adoptium/temurin${major}-binaries/releases/download/test/OpenJDK${major}U-jre_x64_windows_hotspot_${major}.0.1_1.zip`, checksum: fixture.sha256, size: fixture.size } } }]);
                if (major === 21)
                    return new Response(new ReadableStream({ start(controller) { init.signal.addEventListener("abort", () => controller.error(Error("fixture download cancelled")), { once: true }); } }));
                return new Response(Buffer.from(fixture.base64, "base64"));
            };
            (globalThis as any).javaFixtureOnly = true;
        }, { cwd: process.cwd(), zips });
        const page = await app.firstWindow();
        await page.waitForSelector(".home-intro");
        await page.keyboard.press("Escape");
        await page.evaluate(async (root) => { await window.launcher.invoke("instances.import", root); await window.launcher.invoke("accounts.addLocal", "JavaTest"); await window.launcher.invoke("settings.patch", { openingEnabled: false, reducedMotion: true, memoryMb: 1024 }); }, game);
        await page.reload();
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await expect(page.getByRole("radio", { name: "自动选择", exact: true })).toBeVisible();
        await expect(page.locator(".java-plan-status")).toContainText("未找到兼容 Java 17");
        await page.getByRole("button", { name: "自动配置（缺少时下载）", exact: true }).click();
        await expect(page.locator(".java-plan-status")).toContainText("17.0.1+1");
        await page.screenshot({ path: "validation/pcl-java-auto-selected.png", fullPage: true });
        expect(await page.evaluate(() => window.launcher.invoke("java.managed", undefined))).toHaveLength(1);
        await page.getByRole("radio", { name: "手动指定", exact: true }).click();
        await page.getByLabel("Java 可执行文件", { exact: true }).fill(manual);
        await page.getByRole("button", { name: "保存运行配置", exact: true }).click();
        await page.reload();
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await expect(page.getByRole("radio", { name: "手动指定", exact: true })).toHaveAttribute("aria-checked", "true");
        await page.getByRole("radio",{name:"新游戏默认值",exact:true}).click();
        await page.getByRole("radio",{name:"手动指定",exact:true}).click();
        await page.getByLabel("Java 可执行文件",{exact:true}).fill(manual);
        await page.getByRole("button",{name:"保存运行配置",exact:true}).click();
        await expect(page.locator(".java-plan-status")).toContainText("新游戏手动默认值");
        await expect(page.locator(".java-plan-status")).toContainText(manual);
        await page.getByRole("radio",{name:"当前实例",exact:true}).click();
        await page.getByRole("radio", { name: "自动选择", exact: true }).click();
        await page.getByRole("button", { name: "保存运行配置", exact: true }).click();
        await page.getByLabel("缺少兼容 Java 时自动下载", { exact: true }).uncheck();
        await page.evaluate(async () => { const item = (await window.launcher.invoke("instances.list", undefined))[0]; await window.launcher.invoke("instances.patch", { id: item.id, memoryMb: 1024, javaArgs: [], javaPath: "" }); });
        await app.evaluate(async (_e, root) => { const require = (process as any).mainModule.require.bind((process as any).mainModule); const fs = require("node:fs/promises"), path = require("node:path"); const file = path.join(root, "versions/base/base.json"); const v = JSON.parse(await fs.readFile(file, "utf8")); v.javaVersion.majorVersion = 21; await fs.writeFile(file, JSON.stringify(v)); }, game);
        await page.reload();
        await page.getByRole("button", { name: "设置", exact: true }).click();
        await expect(page.locator(".java-plan-status")).toContainText("自动下载已关闭");
        await page.getByLabel("缺少兼容 Java 时自动下载", { exact: true }).check();
        await page.getByRole("button", { name: "首页", exact: true }).click();
        await page.getByRole("button", { name: "启动游戏", exact: true }).click();
        await expect(page.locator(".java-task-summary")).toContainText("Java 21");
        await app.evaluate(({ BrowserWindow })=>BrowserWindow.getAllWindows()[0].setSize(960,640));
        await expect(page.locator(".launch-panel")).toBeInViewport({ratio:1});
        await expect(page.locator(".home-aside")).toBeInViewport({ratio:1});
        await expect(page.locator(".java-task-summary")).toBeInViewport({ratio:1});
        await page.screenshot({path:"validation/pcl-java-launch-downloading-960.png"});
        await page.getByRole("button", { name: "取消 Java 配置", exact: true }).click();
        await expect.poll(() => page.evaluate(async () => (await window.launcher.invoke("tasks.list", undefined)).filter(t => t.label.includes("Java 21")).at(-1)?.status)).toBe("cancelled");
        expect(await page.evaluate(() => window.launcher.invoke("java.managed", undefined))).toHaveLength(1);
        await expect(page.locator(".java-task-summary")).toContainText("Java 配置已取消");
        await page.screenshot({ path: "validation/pcl-java-launch-cancelled.png", fullPage: true });
    }
    finally {
        await app.close();
        await rm(data, { recursive: true, force: true });
    }
});
