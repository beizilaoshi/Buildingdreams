import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

for (const outcome of ['failed', 'cancelled'] as const) {
  test(`remounted launch controls immediately retry after ${outcome} without releasing another instance`, async () => {
    const data = await mkdtemp(join(tmpdir(), 'zhumeng-remounted-launch-'));
    const game = join(data, 'game');
    for (const id of ['Alpha', 'Beta']) {
      await mkdir(join(game, 'versions', id), { recursive: true });
      await writeFile(join(game, 'versions', id, id + '.json'), JSON.stringify({ id, mainClass: 'NeverExecuted', libraries: [], minecraftArguments: '' }));
    }
    const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
    try {
      const page = await app.firstWindow();
      await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
      await page.evaluate(async root => {
        await window.launcher.invoke('instances.import', root);
        await window.launcher.invoke('accounts.addLocal', 'RemountPlayer');
        await window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: true });
      }, game);
      await app.evaluate((_electron, cwd) => {
        const req = (process as any).mainModule.require.bind((process as any).mainModule);
        const Launch = req(req('node:path').join(cwd, 'dist/main/services/launch.js')).LaunchService;
        const f: any = (globalThis as any).remountLaunch = { calls: [], attempts: new Map() };
        f.emit = (service: any, id: string, phase: string) => {
          const value = { instanceId: id, phase, time: Date.now(), error: phase === 'failed' ? 'remount fixture failure' : undefined };
          service.states.set(id, value); service.events.emit('state', value); return value;
        };
        Launch.prototype.launch = async function(id: string, accountId: string) {
          f.calls.push({ id, accountId }); f.emit(this, id, 'preparing');
          return new Promise((_resolve, reject) => {
            f.attempts.set(id, { service: this, reject });
          });
        };
        f.finish = (id: string, phase: string) => {
          const attempt = f.attempts.get(id);
          const value = f.emit(attempt.service, id, phase);
          attempt.phase = phase; return value;
        };
        f.release = (id: string) => { const attempt = f.attempts.get(id); f.attempts.delete(id); attempt.reject(new Error(attempt.phase)); };
        Launch.prototype.cancel = async function(id: string) { return f.finish(id, 'cancelled'); };
        Launch.prototype.stop = async function(id: string) { return f.finish(id, 'cancelled'); };
      }, process.cwd());
      await page.reload();
      await expect(page.locator('.launch-panel h2')).toHaveText('Alpha');
      await page.getByRole('button', { name: '启动游戏', exact: true }).click();
      await expect(page.getByRole('button', { name: '正在启动…', exact: true })).toBeDisabled();
      // Programmatic remount retains regression coverage while the modal blocks user navigation.
      await page.getByRole('button', { name: '游戏库', exact: true }).evaluate((node: HTMLButtonElement) => node.click());
      const alpha = page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Alpha', exact: true }) });
      const beta = page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Beta', exact: true }) });
      const alphaId = await alpha.locator('.launch-controls').getAttribute('data-instance');
      const betaId = await beta.locator('.launch-controls').getAttribute('data-instance');
      await expect(alpha.getByRole('button', { name: '正在启动…', exact: true })).toBeDisabled();
      // A separate backend attempt verifies instance isolation; users cannot launch behind the modal.
      await page.evaluate(id => { void window.launcher.invoke('launch.start', { instanceId: id!, accountId: 'fixture' }).catch(() => {}); }, betaId);
      await expect(beta.getByRole('button', { name: '正在启动…', exact: true })).toBeDisabled();
      if (outcome === 'cancelled') await page.locator('.launch-snake').getByRole('button', { name: '取消启动', exact: true }).click();
      else await app.evaluate((_electron, id) => (globalThis as any).remountLaunch.finish(id, 'failed'), alphaId);
      await expect(alpha.locator('[role="status"]')).toContainText(outcome === 'failed' ? '启动失败' : '启动已取消');
      await expect(alpha.getByRole('button', { name: '正在准备启动…', exact: true })).toBeDisabled();
      await app.evaluate((_electron, id) => (globalThis as any).remountLaunch.release(id), alphaId);
      // No navigation/reload between terminal event and retry: the replacement control must repaint itself.
      await expect(alpha.getByRole('button', { name: '启动游戏', exact: true })).toBeEnabled();
      await expect(beta.getByRole('button', { name: '正在启动…', exact: true })).toBeDisabled();
      await beta.getByRole('button', { name: '正在启动…', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
      expect(await app.evaluate(() => (globalThis as any).remountLaunch.calls.length)).toBe(2);
      await alpha.getByRole('button', { name: '启动游戏', exact: true }).click();
      await expect(alpha.getByRole('button', { name: '正在启动…', exact: true })).toBeDisabled();
      expect(await app.evaluate(() => (globalThis as any).remountLaunch.calls.map((call: any) => call.id))).toEqual([alphaId, betaId, alphaId]);
      await expect(page.getByText('游戏进程已启动', { exact: true })).toHaveCount(0);
      await app.evaluate((_electron, ids) => { for (const id of ids) { const f = (globalThis as any).remountLaunch; f.finish(id, 'cancelled'); f.release(id); } }, [alphaId, betaId]);
    } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
  });
}

test('truthful launch lifecycle, captured library target, account focus and explicit management', async () => {
  const data = await mkdtemp(join(tmpdir(), 'zhumeng-usability-'));
  const game = join(data, 'game');
  for (const id of ['Alpha', 'Beta']) {
    await mkdir(join(game, 'versions', id), { recursive: true });
    await writeFile(join(game, 'versions', id, id + '.json'), JSON.stringify({ id, mainClass: 'NeverExecuted', libraries: [], minecraftArguments: '' }));
  }
  const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    const dismissToasts = async () => {
      while (await page.getByRole('button', { name: '关闭这条提示', exact: true }).count()) await page.getByRole('button', { name: '关闭这条提示', exact: true }).first().click();
    };
    await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
    await page.evaluate(async root => { await window.launcher.invoke('instances.import', root); await window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: true }); }, game);
    await page.reload();
    await page.getByRole('button', { name: '游戏库', exact: true }).click();
    const missingAccountBeta = page.locator('.game-card').filter({ has: page.getByRole('heading', { name: 'Beta', exact: true }) });
    const intendedId = await missingAccountBeta.locator('.launch-controls').getAttribute('data-instance');
    await missingAccountBeta.getByRole('button', { name: '启动游戏', exact: true }).click();
    expect(await page.evaluate(() => localStorage.getItem('instance'))).toBe(intendedId);
    await expect(page.locator('[aria-label="账号与身份"]')).toBeFocused();
    await expect(page.getByRole('heading', { name: '账号与身份', exact: true })).toBeInViewport();
    await page.screenshot({ path: 'validation/usability-account-focus.png' });
    const identity = await page.evaluate(() => window.launcher.invoke('accounts.addLocal', 'CapturedPlayer'));
    await app.evaluate((_electron, cwd) => {
      const req = (process as any).mainModule.require.bind((process as any).mainModule);
      const Launch = req(req('node:path').join(cwd, 'dist/main/services/launch.js')).LaunchService;
      const f: any = (globalThis as any).usability = { calls: [], cancels: 0, stops: 0, mode: 'hold', deferred: null, stale: null };
      const originalStatus = Launch.prototype.status;
      Launch.prototype.status = function(id: string) {
        const value = originalStatus.call(this, id);
        if (f.delayStatus) { f.delayStatus = false; return new Promise(resolve => { f.stale = () => resolve(value); }); }
        return value;
      };
      f.emit = (id: string, phase: string, error?: string) => {
        const value = { instanceId: id, phase, time: Date.now(), error, pid: phase === 'running' ? 12345 : undefined };
        f.service.states.set(id, value); f.service.events.emit('state', value); return value;
      };
      Launch.prototype.launch = async function(instanceId: string, accountId: string) {
        f.service = this; f.calls.push({ instanceId, accountId });
        await new Promise<void>(resolve => { f.pending = resolve; });
        f.emit(instanceId, 'preparing');
        await new Promise<void>((resolve, reject) => { f.deferred = { resolve, reject }; });
        if (f.mode === 'fail') { f.emit(instanceId, 'failed', 'fixture failure'); throw new Error('fixture failure'); }
        if (f.mode === 'cancel') { f.emit(instanceId, 'cancelled'); throw new Error('fixture cancellation'); }
        f.emit(instanceId, 'running'); return { pid: 12345 };
      };
      Launch.prototype.cancel = async function(id: string) { f.cancels++; f.mode = 'cancel'; const value = f.emit(id, 'stopping'); f.finishStop = () => f.deferred.resolve(); return value; };
      Launch.prototype.stop = async function(id: string) {
        if (this.status(id).phase === 'preparing') { f.cancels++; f.mode = 'cancel'; const value = f.emit(id, 'stopping'); f.finishStop = () => f.deferred.resolve(); return value; }
        f.stops++; const value = f.emit(id, 'stopping'); f.finishStop = () => f.emit(id, 'cancelled'); return value;
      };
    }, process.cwd());
    await page.reload();
    await expect(page.locator('.launch-panel h2')).toHaveText('Beta');
    await page.getByRole('button', { name: '切换游戏', exact: true }).click();
    await page.locator('.home-game-card').filter({ has: page.getByRole('heading', { name: 'Alpha', exact: true }) }).click();
    const home = page.locator('.launch-panel');
    const first = home.getByRole('button', { name: '启动游戏', exact: true });
    await expect(first).toBeEnabled();
    await first.click();
    await expect(home.getByRole('button', { name: '正在准备启动…', exact: true })).toBeDisabled();
    expect(await app.evaluate(() => (globalThis as any).usability.calls.length)).toBe(1);
    await app.evaluate(() => (globalThis as any).usability.pending());
    await expect(home.getByRole('button', { name: '正在启动…', exact: true })).toBeDisabled();
    await home.getByRole('button', { name: '正在启动…', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
    expect(await app.evaluate(() => { const f = (globalThis as any).usability; return [f.calls.length, f.cancels, f.stops]; })).toEqual([1, 0, 0]);
    await page.locator('.launch-snake').getByRole('button', { name: '取消启动', exact: true }).click();
    expect(await app.evaluate(() => (globalThis as any).usability.cancels)).toBe(1);
    await expect(home.getByRole('button', { name: '正在停止…', exact: true })).toBeDisabled();
    await app.evaluate(() => (globalThis as any).usability.finishStop());
    await expect(home.locator('.launch-controls')).toContainText('启动已取消');
    await expect(page.getByText('游戏进程已启动', { exact: true })).toHaveCount(0);
    await home.getByRole('button', { name: '启动游戏', exact: true }).click();
    await app.evaluate(() => { const f = (globalThis as any).usability; f.mode = 'fail'; f.pending(); });
    await expect(home.getByRole('button', { name: '取消启动', exact: true })).toBeVisible();
    await app.evaluate(() => (globalThis as any).usability.deferred.resolve());
    await expect(home.locator('.launch-controls')).toContainText('fixture failure');
    await home.getByRole('button', { name: '启动游戏', exact: true }).click();
    await app.evaluate(() => { const f = (globalThis as any).usability; f.mode = 'run'; f.pending(); });
    await expect(home.getByRole('button', { name: '取消启动', exact: true })).toBeVisible();
    await app.evaluate(() => (globalThis as any).usability.deferred.resolve());
    await expect(home.getByRole('button', { name: '停止游戏', exact: true })).toBeVisible();
    await expect(home.getByRole('button', { name: '游戏运行中', exact: true })).toBeDisabled();
    await home.getByRole('button', { name: '游戏运行中', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
    expect(await app.evaluate(() => (globalThis as any).usability.stops)).toBe(0);
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(960, 640));
    await expect(home).toBeInViewport({ ratio: 1 });
    await expect(home.getByRole('button', { name: '停止游戏', exact: true })).toBeInViewport();
    await dismissToasts();
    await page.screenshot({ path: 'validation/usability-home-running-960.png' });
    await app.evaluate(() => { (globalThis as any).usability.delayStatus = true; });
    await page.getByRole('button', { name: '游戏库', exact: true }).click();
    await expect.poll(() => app.evaluate(() => typeof (globalThis as any).usability.stale)).toBe('function');
    await app.evaluate(() => { const f = (globalThis as any).usability; f.emit(f.calls[0].instanceId, 'stopping'); f.stale(); });
    await expect(page.locator('.launch-controls').getByRole('button', { name: '正在停止…', exact: true })).toBeDisabled();
    await app.evaluate(() => { const f = (globalThis as any).usability; f.emit(f.calls[0].instanceId, 'cancelled'); });
    const cards = page.locator('.game-card');
    const beta = cards.filter({ has: page.getByRole('heading', { name: 'Beta', exact: true }) });
    await beta.getByRole('button', { name: '启动游戏', exact: true }).click();
    const calls = await app.evaluate(() => (globalThis as any).usability.calls);
    const betaId = await beta.locator('.launch-controls').getAttribute('data-instance');
    expect(calls[0].instanceId).not.toBe(betaId);
    expect(calls.at(-1)).toEqual({ instanceId: betaId, accountId: identity.id });
    expect(await page.evaluate(() => localStorage.getItem('instance'))).toBe(betaId);
    await expect(beta.getByRole('button', { name: '已选择', exact: true })).toHaveAttribute('aria-pressed', 'true');
    await app.evaluate(() => { const f = (globalThis as any).usability; f.pending(); });
    await expect(beta.getByRole('button', { name: '取消启动', exact: true })).toBeVisible();
    await app.evaluate(() => (globalThis as any).usability.deferred.resolve());
    await beta.getByRole('button', { name: '停止游戏', exact: true }).click();
    await expect(beta.getByRole('button', { name: '正在停止…', exact: true })).toBeDisabled();
    await app.evaluate(() => (globalThis as any).usability.finishStop());
    await expect(beta.locator('.launch-controls')).toContainText('启动已取消');
    await dismissToasts();
    await expect(page.getByRole('button', { name: '导出启动脚本', exact: true })).toHaveCount(0);
    await beta.getByRole('button', { name: '管理游戏', exact: true }).click();
    await expect(page.getByRole('dialog')).toContainText('更改数据目录');
    await page.getByRole('button', { name: '导出启动脚本', exact: true }).click();
    await expect(page.getByRole('dialog', { name: '导出启动脚本', exact: true })).toContainText('默认移除身份与令牌');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toContainText('管理游戏');
    for (const width of [960, 1280]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, w === 960 ? 640 : 820), width);
      await page.screenshot({ path: `validation/usability-manage-${width}.png` });
    }
    await page.keyboard.press('Escape');
    await page.getByRole('textbox', { name: '搜索游戏', exact: true }).fill('missing-world');
    await expect(page.getByRole('heading', { name: '没有匹配的游戏', exact: true })).toBeVisible();
    await expect(page.getByText('没有找到“missing-world”。试试其他名称或版本。', { exact: true })).toBeVisible();
    await page.getByRole('button', { name: '清空搜索', exact: true }).click();
    await expect(cards).toHaveCount(2);
    for (const width of [960, 1280]) {
      await app.evaluate(({ BrowserWindow }, w) => BrowserWindow.getAllWindows()[0].setSize(w, w === 960 ? 640 : 820), width);
      await expect(beta.getByRole('button', { name: '管理游戏', exact: true })).toBeInViewport({ ratio: 1 });
      await dismissToasts();
      await page.screenshot({ path: `validation/usability-library-${width}.png` });
      await page.getByRole('button', { name: '首页', exact: true }).click();
      await expect(home).toBeInViewport({ ratio: 1 });
      await page.screenshot({ path: `validation/usability-home-${width}.png` });
      await page.getByRole('button', { name: '账号设置 →', exact: true }).click();
      await expect(page.locator('[aria-label="账号与身份"]')).toBeFocused();
      await page.screenshot({ path: `validation/usability-account-${width}.png` });
      await page.getByRole('button', { name: '游戏库', exact: true }).click();
    }
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});
