import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
test('actual Electron automatic and manual updates use main service without opening browser', async () => {
    const root = await mkdtemp(join(tmpdir(), 'zhumeng-updates-'));
    const data = join(root, 'data');
    await writeFile(join(root, 'package.json'), JSON.stringify({ name: 'update-fixture', version: '0.0.1-preview.1', main: 'fixture.cjs' }));
    await writeFile(join(root, 'fixture.cjs'), `const {app,shell}=require('electron'); global.opened=[];shell.openExternal=async url=>{global.opened.push(url)};const {UpdateService}=require(${JSON.stringify(resolve('dist/main/services/updates.js'))});global.updateCalls=0;UpdateService.prototype.load=async function(){global.updateCalls++;return [{tag_name:'v0.0.1-preview.2',draft:false,prerelease:true,html_url:'https://github.com/beizilaoshi/Buildingdreams/releases/tag/v0.0.1-preview.2',assets:[{browser_download_url:'https://github.com/beizilaoshi/Buildingdreams/releases/download/v0.0.1-preview.2/Buildingdreams-0.0.1-preview.2-x64-portable.exe'}]}]};require(${JSON.stringify(resolve('dist/main/index.js'))});`);
    const app = await electron.launch({ args: [root], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
    try {
        const page = await app.firstWindow();
        await page.waitForSelector('.home-intro');
        await page.keyboard.press('Escape');
        await expect.poll(() => app.evaluate(() => (globalThis as any).updateCalls)).toBe(1);
        await expect(page.locator('.nav-footer')).toContainText('0.0.1-preview.1');
        await page.getByRole('button', { name: '关于', exact: true }).click();
        const card = page.locator('[data-update-card]');
        await expect(card).toContainText('发现新版本 0.0.1-preview.2');
        await card.getByRole('button', { name: '检查更新', exact: true }).click();
        await expect.poll(() => app.evaluate(() => (globalThis as any).updateCalls)).toBe(2);
        await card.getByRole('button', { name: '下载新版本 ↗', exact: true }).click();
        expect(await app.evaluate(() => (globalThis as any).opened)).toEqual(['https://github.com/beizilaoshi/Buildingdreams/releases/download/v0.0.1-preview.2/Buildingdreams-0.0.1-preview.2-x64-portable.exe']);
        await page.getByRole('button', { name: '设置', exact: true }).click();
        await expect(page.locator('[data-update-card]')).toContainText('0.0.1-preview.1');
        const settingsCard = page.locator('[data-update-card]');
        await settingsCard.getByRole('radio', { name: '仅稳定版', exact: true }).click();
        await settingsCard.getByRole('button', { name: '检查更新', exact: true }).click();
        await expect(settingsCard).toContainText('已是此渠道最新版本');
        await expect(settingsCard.getByRole('button', { name: '下载新版本 ↗', exact: true })).toBeHidden();
        await settingsCard.getByRole('checkbox').uncheck();
        expect(await page.evaluate(() => window.launcher.invoke('settings.read', undefined))).toMatchObject({ checkUpdatesOnStartup: false, updateChannel: 'stable' });
    }
    finally {
        await app.close();
        await rm(root, { recursive: true, force: true });
    }
});
