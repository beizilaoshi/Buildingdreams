import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('launch settings inherit, owned lifecycle updates preserve focus, and native script export stays secret-free', async () => {
    const data = await mkdtemp(join(tmpdir(), 'zhumeng-launch-ui-'));
    const game = join(data, 'game');
    await mkdir(join(game, 'versions/base'), { recursive: true });
    await writeFile(join(game, 'versions/base/base.json'), JSON.stringify({ id: 'base', mainClass: 'FixtureMain', minecraftArguments: '--username ${auth_player_name} --accessToken ${auth_access_token}', libraries: [], javaVersion: { majorVersion: 17 } }));
    await writeFile(join(game, 'versions/base/base.jar'), 'fixture never executed');
    const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
    try {
        await app.evaluate((_electron, cwd) => {
            const req = (process as any).mainModule.require.bind((process as any).mainModule), path = req('node:path');
            const Java = req(path.join(cwd, 'dist/main/services/java.js')).JavaService;
            Java.prototype.detect = async () => [{ path: process.execPath, major: 17, version: '17', arch: 'amd64' }];
            const Launch = req(path.join(cwd, 'dist/main/services/launch.js')).LaunchService, original = Launch.prototype.start;
            Launch.prototype.start = function (...args: any[]) { this.runner = async (options: any) => { (globalThis as any).launchOptions = options; return req('node:child_process').spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true }); }; return original.apply(this, args); };
        }, process.cwd());
        const page = await app.firstWindow();
        await page.waitForSelector('.home-intro');
        await page.keyboard.press('Escape');
        await page.evaluate(async (root) => { await window.launcher.invoke('instances.import', root); await window.launcher.invoke('accounts.addLocal', 'LifecyclePlayer'); await window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: true }); }, game);
        await page.reload();
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await page.getByRole('radiogroup',{name:'启动选项范围',exact:true}).getByRole('radio',{name:'全局启动选项',exact:true}).click();
        await page.getByLabel('窗口宽度', { exact: true }).fill('1152');
        await page.getByRole('button', { name: '保存启动选项', exact: true }).click();
        await page.getByRole('radiogroup',{name:'启动选项范围',exact:true}).getByRole('radio',{name:'当前游戏',exact:true}).click();
        await expect(page.getByLabel('窗口宽度', { exact: true })).toBeDisabled();
        await expect(page.getByLabel('窗口宽度', { exact: true })).toHaveValue('1152');
        await page.getByLabel('窗口宽度 单独设置', { exact: true }).check();
        await page.getByLabel('窗口宽度', { exact: true }).fill('1000');
        await page.getByRole('button', { name: '保存启动选项', exact: true }).click();
        for (const theme of ['light', 'dark'] as const)
            for (const width of [960, 1280]) {
                await page.evaluate(async (theme) => { await window.launcher.invoke('settings.patch', { theme }); }, theme);
                await page.reload();
                await page.getByRole('button', { name: '设置', exact: true }).click();
                await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, width === 960 ? 640 : 820), width);
                await page.getByRole('heading', { name: '启动选项', exact: true }).evaluate(node=>node.scrollIntoView({block:'start'}));
                await page.waitForTimeout(150);
                await page.screenshot({ path: `validation/pcl-launch-settings-${theme}-${width}.png` });
                if(width===960){
                    expect(await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].getSize())).toEqual([960,640]);
                    await page.getByRole('radiogroup',{name:'启动选项范围',exact:true}).getByRole('radio',{name:'全局启动选项',exact:true}).click();
                    const command=page.getByLabel('本地启动前命令',{exact:true});await command.focus();await expect(command).toBeFocused();await expect(command).toBeInViewport();
                    await page.waitForTimeout(150);await page.screenshot({path:`validation/pcl-launch-fix1-${theme}-960x640-command.png`});
                    const behavior=page.getByRole('radio',{name:'保持窗口',exact:true});await behavior.focus();await expect(behavior).toBeFocused();await expect(behavior).toBeInViewport();
                    const priority=page.getByRole('radio',{name:'正常',exact:true});await priority.focus();await expect(priority).toBeFocused();await expect(priority).toBeInViewport();
                    const save=page.getByRole('button',{name:'保存启动选项',exact:true});await save.focus();await expect(save).toBeFocused();await expect(save).toBeInViewport();
                    await page.waitForTimeout(150);await page.screenshot({path:`validation/pcl-launch-fix1-${theme}-960x640-save.png`});
                }
            }
        await page.getByRole('button', { name: '首页', exact: true }).click();
        await page.getByRole('button', { name: '启动游戏', exact: true }).click();
        await expect(page.locator('.launch-controls')).toContainText('游戏运行中');
        expect(await app.evaluate(() => ((globalThis as any).launchOptions.resolution.width))).toBe(1000);
        await page.getByRole('button', { name: '停止游戏', exact: true }).click();
        await expect(page.locator('.launch-controls')).toContainText('启动已取消');
        const file = join(data, 'export script.ps1');
        await writeFile(file, 'existing sentinel');
        await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: true, filePath: path })) as any; }, file);
        await page.getByRole('button', { name: '游戏库', exact: true }).click();
        await page.getByRole('button', { name: '管理游戏', exact: true }).click();
        await page.getByRole('button', { name: '导出启动脚本', exact: true }).click();
        await page.getByRole('button', { name: '选择保存位置', exact: true }).click();
        expect(await readFile(file, 'utf8')).toBe('existing sentinel');
        await app.evaluate(({ dialog }, path) => { dialog.showSaveDialog = (async () => ({ canceled: false, filePath: path })) as any; }, file);
        await page.getByRole('button', { name: '选择保存位置', exact: true }).click();
        await expect(page.getByRole('dialog', { name: '导出启动脚本', exact: true })).toBeHidden();
        await page.keyboard.press('Escape');
        const script = await readFile(file, 'utf8');
        expect(script).not.toContain('LifecyclePlayer');
        expect(script).toContain('REDACTED_TOKEN');
        await page.getByRole('button', { name: '设置', exact: true }).click();
        const title = page.getByLabel('游戏窗口标题（Windows）', { exact: true });
        await page.getByLabel('游戏窗口标题（Windows） 单独设置', { exact: true }).check();
        await title.fill('focused');
        await title.focus();
        await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].webContents.send('launcher:launch', { instanceId: 'irrelevant', phase: 'running', time: Date.now() }));
        await expect(title).toBeFocused();
    }
    finally {
        await app.close();
        await rm(data, { recursive: true, force: true });
    }
});
