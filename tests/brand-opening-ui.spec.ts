import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('startup shows the logo splash separately, then opens the launcher window', async () => {
  const data = await mkdtemp(join(tmpdir(), 'zhumeng-opening-'));
  await writeFile(join(data, 'accounts.vault'), 'invalid encrypted vault');
  const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    // Observe the brief native startup state before waiting for the main page load.
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.isVisible()).sort())).toEqual([false, true]);
    const splash = app.windows().find(candidate => candidate.url().startsWith('data:text/html'));
    expect(splash).toBeTruthy();
    const centered = await app.evaluate(({ BrowserWindow, screen }) => {
      const splashWindow = BrowserWindow.getAllWindows().find(candidate => candidate.getBounds().width === 240);
      if (!splashWindow) return false;
      const bounds = splashWindow.getBounds();
      const display = screen.getPrimaryDisplay().bounds;
      return bounds.x === Math.round(display.x + (display.width - bounds.width) / 2)
        && bounds.y === Math.round(display.y + (display.height - bounds.height) / 2);
    });
    expect(centered).toBe(true);
    const splashDetails = await splash!.evaluate(() => ({
      background: getComputedStyle(document.body).backgroundColor,
      particles: document.querySelectorAll('.particle').length,
      logoLoaded: (document.querySelector('img') as HTMLImageElement).naturalWidth > 0,
      logoSize: document.querySelector('.mark')!.getBoundingClientRect().width,
    }));
    expect(splashDetails).toEqual({ background: 'rgba(0, 0, 0, 0)', particles: 10, logoLoaded: true, logoSize: 164 });
    await mkdir('validation/brand-opening', { recursive: true });
    await splash!.screenshot({ path: 'validation/brand-opening/transparent-particle-splash.png' });
    await expect.poll(() => app.windows().some(candidate => candidate.url().includes('/renderer/index.html'))).toBe(true);
    const page = app.windows().find(candidate => candidate.url().includes('/renderer/index.html'))!;
    await expect(page.locator('.opening')).toHaveCount(0);
    await page.waitForSelector('.home-intro');
    await expect(page.locator('#toasts').getByText('账户保险库无法读取')).toBeVisible();
    await expect.poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(window => window.isVisible()))).toEqual([true]);
    await expect(page.locator('#app')).toBeVisible();
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});

test('brand opening timed frames, preview reentry, speed, disabled and reduced motion', async () => {
  test.setTimeout(60000);
  const data = await mkdtemp(join(tmpdir(), 'zhumeng-opening-paths-'));
  const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.home-intro');
    const output = 'validation/brand-opening'; await mkdir(output, { recursive: true });
    await page.getByRole('navigation').getByRole('button', { name: '个性化', exact: true }).click();
    const preview = page.getByRole('button', { name: '预览开场', exact: true });
    for (const theme of ['dark', 'light'] as const) for (const [width, height] of [[1280, 800], [960, 640]]) {
      await page.evaluate(async theme => { await window.launcher.invoke('settings.patch', { theme, openingEnabled: true, reducedMotion: false, openingSpeed: 1, animationSpeed: 1 }); }, theme);
      await page.reload(); await page.waitForSelector('.home-intro');
      await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(size[0], size[1]), [width, height]);
      await page.getByRole('navigation').getByRole('button', { name: '个性化', exact: true }).click();
      const start = Date.now(); await preview.click();
      await page.waitForTimeout(550); await page.screenshot({ path: `${output}/${theme}-${width}-logo.png` });
      await page.waitForTimeout(Math.max(0, 1650 - (Date.now() - start)));
      const geometry = await page.locator('#app').evaluate(el => { const s = getComputedStyle(el); return { clip: s.clipPath, transform: s.transform, width: el.getBoundingClientRect().width }; });
      expect(geometry.clip).toMatch(/^inset\(/); expect(geometry.transform).toBe('none'); expect(geometry.width).toBe(width);
      await page.screenshot({ path: `${output}/${theme}-${width}-reveal.png` });
      await expect(page.locator('.opening')).toHaveCount(0);
      expect(Date.now() - start).toBeLessThan(4000);
      await page.screenshot({ path: `${output}/${theme}-${width}-complete.png` });
      await expect(preview).toBeFocused();
      await expect(page.locator('#app')).not.toHaveAttribute('inert', '');
    }
    // A preview supersedes another preview and returns focus to the original control.
    await preview.click();
    await preview.evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator('.opening')).toHaveCount(1);
    await page.keyboard.press('Escape'); await expect(preview).toBeFocused();
    await preview.click(); await page.waitForTimeout(1450);
    await page.mouse.click(480, 320); await expect(page.locator('.opening')).toHaveCount(0);
    expect(await page.locator('#wallpaper').evaluate(el => (el as HTMLElement).style.clipPath)).toBe('');
    // Existing clipping and inert ownership belong to the caller and must survive a preview.
    await preview.focus();
    await page.locator('#app').evaluate((el: HTMLElement) => { el.style.setProperty('clip-path', 'inset(0px 1px)', 'important'); el.inert = true; });
    await preview.evaluate((button: HTMLButtonElement) => button.click());
    await page.keyboard.press('Escape');
    expect(await page.locator('#app').evaluate((el: HTMLElement) => ({ inert: el.inert, clip: el.style.clipPath, priority: el.style.getPropertyPriority('clip-path') }))).toEqual({ inert: true, clip: 'inset(0px 1px)', priority: 'important' });
    await page.locator('#app').evaluate((el: HTMLElement) => { el.inert = false; el.style.removeProperty('clip-path'); });
    // The operating-system preference also cancels an already running reveal.
    await preview.click(); await page.waitForTimeout(1350); await page.emulateMedia({ reducedMotion: 'reduce' });
    await expect(page.locator('.opening')).toHaveCount(0);
    await preview.click(); await expect(page.locator('.opening')).toHaveCount(0);
    await page.emulateMedia({ reducedMotion: 'no-preference' });
    for (const patch of [{ openingEnabled: false, reducedMotion: false }, { openingEnabled: true, reducedMotion: true }]) {
      await page.evaluate(patch => window.launcher.invoke('settings.patch', patch), patch);
      await page.reload(); await page.waitForSelector('.home-intro');
      await expect(page.locator('.opening')).toHaveCount(0);
      expect(await page.locator('#app').evaluate(el => ({ inert: (el as HTMLElement).inert, clip: getComputedStyle(el).clipPath }))).toEqual({ inert: false, clip: 'none' });
    }
    await page.evaluate(() => window.launcher.invoke('settings.patch', { openingEnabled: true, reducedMotion: false, openingSpeed: 2, animationSpeed: 2, openingTheme: 'aurora' }));
    await page.reload(); await page.waitForSelector('.home-intro');
    await expect(page.locator('.opening')).toHaveCount(0, { timeout: 1500 });
    await expect(page.locator('.home-intro')).toBeVisible();
  } finally { await app.close(); await rm(data, { recursive: true, force: true }); }
});
