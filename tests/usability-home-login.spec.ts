import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('home modes retain matching identities across reload without remounting launch area', async () => {
  const data = await mkdtemp(join(tmpdir(), 'zhumeng-home-login-'));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
    await page.evaluate(() => window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: true }));
    await page.reload();
    await expect(page.getByRole('radio', { name: '离线游戏', exact: true })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('button', { name: '添加本地账号', exact: true }).click();
    await page.getByRole('dialog').getByLabel('本地玩家名').fill('HomeSteve');
    await page.getByRole('dialog').getByLabel('本地玩家名').press('Enter');
    await expect(page.locator('.player-summary')).toContainText('HomeSteve');
    await page.locator('.launch-panel').evaluate(node => (node as HTMLElement).dataset.retained = 'yes');
    await page.getByRole('radio', { name: '微软正版', exact: true }).click();
    await expect(page.locator('.player-summary')).not.toContainText('HomeSteve');
    await expect(page.locator('.launch-panel')).toHaveAttribute('data-retained', 'yes');
    await page.reload();
    await expect(page.getByRole('radio', { name: '微软正版', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.player-summary')).not.toContainText('HomeSteve');
    await page.getByRole('button', { name: '登录 Microsoft', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '登录 Microsoft', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await page.getByRole('radio', { name: '离线游戏', exact: true }).click();
    await expect(page.locator('.player-summary')).toContainText('HomeSteve');
    for (const [width, height] of [[960, 640], [1280, 820]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `.superpowers/sdd/2026-11-11-home-login/home-${width}.png` });
    }
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});


test('matching launch IDs, same-kind removal, expired login and empty home start', async () => {
  const data = await mkdtemp(join(tmpdir(), 'zhumeng-home-mixed-'));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
    await page.evaluate(() => window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: true }));
    await app.evaluate((_e, cwd) => {
      const req = (process as any).mainModule.require.bind((process as any).mainModule);
      const Router = req(req('node:path').join(cwd, 'dist/main/ipc.js')).CommandRouter;
      const original = Router.prototype.invoke;
      const f: any = (globalThis as any).homeFixture = { calls: [], accounts: [
        { id: 'local-one', kind: 'local', name: 'LocalOne', status: 'ready', uuid: '1' },
        { id: 'local-two', kind: 'local', name: 'LocalTwo', status: 'ready', uuid: '2' },
        { id: 'ms-one', kind: 'microsoft', name: 'OfficialOne', status: 'expired', uuid: '3' },
      ] };
      Router.prototype.invoke = async function(command: string, payload: any) {
        f.calls.push({ command, payload });
        if (command === 'accounts.list') return f.accounts;
        if (command === 'accounts.remove') { f.accounts = f.accounts.filter((x: any) => x.id !== payload); return; }
        if (command === 'accounts.appearance') return { accountId: payload, source: 'default', reason: 'unavailable' };
        if (command === 'instances.list') return [{ id: 'world', name: 'Home World', minecraft: '1.21', memoryMb: 2048, javaArgs: [], status: 'ready' }];
        if (command === 'launch.status') return { instanceId: payload, phase: 'idle', time: Date.now() };
        if (command === 'launch.start') return;
        if (command === 'accounts.beginMicrosoftLogin') return { loginId: 'home-session', userCode: 'HOME-CODE', verificationUri: 'https://www.microsoft.com/link', expiresAt: Date.now()+900000, interval: 100 };
        if (['accounts.cancelMicrosoftLogin', 'accounts.copyUserCode', 'app.openVerification'].includes(command)) return;
        return original.call(this, command, payload);
      };
    }, process.cwd());
    await page.reload();
    await expect(page.locator('.player-summary')).toContainText('LocalOne');
    await page.getByRole('button', { name: '启动游戏', exact: true }).click();
    await page.getByRole('radio', { name: '微软正版', exact: true }).click();
    await expect(page.locator('.player-summary')).toContainText('需要重新登录');
    await page.getByRole('button', { name: '重新登录', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('HOME-CODE'); await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '启动游戏', exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).homeFixture.calls.filter((c: any) => c.command === 'launch.start').map((c: any) => c.payload.accountId))).toEqual(['local-one', 'ms-one']);
    await page.getByRole('button', { name: '账号设置 →', exact: true }).click();
    const localRow = page.locator('.version-row').filter({ has: page.getByText('LocalTwo', { exact: true }) });
    await localRow.getByRole('button', { name: '选择', exact: true }).click();
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.getByRole('radio', { name: '离线游戏', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('.player-summary')).toContainText('LocalTwo');
    await page.reload(); await expect(page.locator('.player-summary')).toContainText('LocalTwo');
    await page.getByRole('button', { name: '账号设置 →', exact: true }).click();
    await page.locator('.version-row').filter({ has: page.getByText('LocalTwo', { exact: true }) }).getByRole('button', { name: '移除', exact: true }).click();
    await page.locator('.version-row').filter({ has: page.getByText('LocalOne', { exact: true }) }).getByRole('button', { name: '移除', exact: true }).click();
    await page.getByRole('button', { name: '首页', exact: true }).click();
    await expect(page.locator('.player-summary')).not.toContainText('OfficialOne');
    await page.getByRole('button', { name: '启动游戏', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '添加本地账号', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    expect(await app.evaluate(() => (globalThis as any).homeFixture.calls.filter((c: any) => c.command === 'launch.start').length)).toBe(2);
    while (await page.getByRole('button', { name: '关闭这条提示', exact: true }).count()) await page.getByRole('button', { name: '关闭这条提示', exact: true }).first().click();
    for (const [width, height] of [[960, 640], [1280, 820]]) {
      await page.setViewportSize({ width, height });
      await page.screenshot({ path: `.superpowers/sdd/2026-11-11-home-login/empty-game-${width}.png` });
    }
    await page.getByRole('radio', { name: '微软正版', exact: true }).click();
    await expect(page.locator('.player-summary')).toContainText('OfficialOne');
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});
