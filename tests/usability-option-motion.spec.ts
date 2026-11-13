import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChoiceControl } from '../src/renderer/components/choice';

const evidence = '.superpowers/sdd/2026-11-11-option-motion';
let app: ElectronApplication, page: Page, data: string;
test.beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), 'zhumeng-option-motion-'));
  await mkdir(evidence, { recursive: true });
  app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  page = await app.firstWindow();
  await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
  await page.evaluate(() => window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: false, animationSpeed: 1 }));
  await page.reload(); await page.waitForSelector('.home-intro');
});
test.afterEach(async () => { await app?.close(); if (data) await rm(data, { recursive: true, force: true }); });

test('wallpaper selected outline interpolates, settles, and obeys reduced motion', async () => {
  await page.getByRole('button', { name: '个性化', exact: true }).click();
  const aurora = page.locator('.wallpaper-choice[data-wallpaper="builtin:aurora"]');
  await aurora.click();
  await expect(aurora).toHaveAttribute('aria-pressed', 'true');
  const running = await aurora.evaluate(x => x.getAnimations().map(a => ({
    property: (a as CSSTransition).transitionProperty, state: a.playState,
  })));
  expect(running.some(x => x.property === 'outline-color' && x.state === 'running')).toBe(true);
  await expect.poll(() => aurora.evaluate(x => x.getAnimations().length)).toBe(0);
  await expect(aurora).toHaveCSS('outline-width', '2px');
  await expect(aurora).toHaveCSS('outline-offset', '2px');
  await expect(aurora).toHaveCSS('outline-color', 'rgb(147, 168, 255)');
  await expect(page.locator('.wallpaper-choice[aria-pressed="true"]')).toHaveCount(1);
  await page.getByRole('checkbox', { name: '减少动态效果', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  const garden = page.locator('.wallpaper-choice[data-wallpaper="builtin:garden"]');
  await garden.click(); await expect(garden).toHaveAttribute('aria-pressed', 'true');
  expect(await garden.evaluate(x => x.getAnimations().length)).toBe(0);
  await expect(garden).toHaveCSS('outline-width', '2px');
  await expect(garden).toHaveCSS('outline-color', 'rgb(147, 168, 255)');
  await writeFile(`${evidence}/wallpaper-motion.json`, JSON.stringify(running, null, 2));
});

// Rebuilding tiles breaks both CSS interpolation and the focused radio's identity.
test('selection retains live radios, focus, transitions and immediate rapid-click events', async () => {
  await page.getByRole('button', { name: '个性化', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: '主题', exact: true });
  await group.getByRole('radio', { name: '深色', exact: true }).focus();
  const result = await group.evaluate(async (element: ChoiceControl) => {
    const cards = Array.from(element.querySelectorAll<HTMLButtonElement>('.choice-card'));
    let changes = 0;
    element.addEventListener('change', () => changes++);
    const initialAnimations = cards.flatMap(x => x.getAnimations()).length;
    cards[1].focus(); cards[1].click();
    await new Promise(requestAnimationFrame);
    const transitions = cards[1].getAnimations().map(a => ({ type: a.constructor.name, state: a.playState }));
    const preserved = cards.every(x => x.isConnected && element.contains(x));
    const focused = document.activeElement === cards[1];
    // Programmatic status/value updates must also retain the original elements.
    element.disabled = true; element.disabled = false; element.value = 'dark';
    for (const index of [2, 0, 1, 1]) cards[index].click();
    return { preserved, focused, initialAnimations, transitions, changes, value: element.value,
      checked: Array.from(element.querySelectorAll('[aria-checked="true"]')).map(x => (x as HTMLElement).dataset.value),
      transitionProperty: getComputedStyle(cards[1]).transitionProperty };
  });
  expect(result.preserved).toBe(true);
  expect(result.focused).toBe(true);
  expect(result.initialAnimations).toBe(0);
  expect(result.transitionProperty).toContain('border-color');
  expect(result.transitions.some(x => x.type === 'CSSTransition')).toBe(true);
  expect(result.changes).toBe(5);
  expect(result.value).toBe('light'); expect(result.checked).toEqual(['light']);
  await group.getByRole('radio', { name: '浅色', exact: true }).focus();
  await page.keyboard.press('ArrowRight');
  await expect(group.getByRole('radio', { name: '跟随系统', exact: true })).toBeFocused();
  await expect(group.getByRole('radio', { name: '跟随系统', exact: true })).toHaveAttribute('aria-checked', 'true');
  await page.screenshot({ path: `${evidence}/selection.png` });
  await page.getByRole('slider', { name: '界面动画速度', exact: true }).evaluate((slider: HTMLInputElement) => {
    slider.value = '2'; slider.dispatchEvent(new Event('input')); slider.dispatchEvent(new Event('change'));
  });
  await expect.poll(() => group.getByRole('radio').first().evaluate(x => getComputedStyle(x).transitionDuration.split(',')[0].trim())).toBe('0.13s');
  await page.getByRole('checkbox', { name: '减少动态效果', exact: true }).check();
  await expect(page.locator('html')).toHaveAttribute('data-motion', 'reduced');
  expect(await group.getByRole('radio').first().evaluate(x => getComputedStyle(x).transitionProperty)).toBe('none');
  await writeFile(`${evidence}/selection-motion.json`, JSON.stringify(result, null, 2));
});

// Only explicit category/list actions should animate incoming content, never search or refresh.
test('category motion is bounded, cancels for runtime/system reduction, and leaves search and initialization quiet', async () => {
  await page.getByRole('button', { name: '下载', exact: true }).click();
  const group = page.getByRole('radiogroup', { name: '加载器版本', exact: true, includeHidden: true });
  await group.evaluate((element: ChoiceControl) => {
    // Mount the real searchable component outside the install detail, which is
    // hidden until a remote Minecraft catalog version is selected.
    document.querySelector('.content')!.append(element);
    element.disabled = false;
    element.setOptions(Array.from({ length: 60 }, (_, i) => ({ value: String(i), label: `版本 ${i}`, category: i % 2 ? 'snapshot' : 'release' })));
  });
  await expect(group.getByRole('radio')).toHaveCount(24);
  expect(await group.locator('.choice-grid').evaluate(x => x.getAnimations({ subtree: true }).length)).toBe(0);
  await group.getByRole('button', { name: '正式版', exact: true }).click();
  const motion = await group.locator('.choice-grid').evaluate(x => x.getAnimations({ subtree: true }).map(a => ({ type: a.constructor.name, duration: a.effect?.getTiming().duration })));
  expect(motion.some(x => x.type === 'CSSAnimation' && Number(x.duration) > 0)).toBe(true);
  await expect(group.getByRole('radio').first()).toHaveText('版本 0');
  await expect(group.getByRole('radio').nth(1)).toHaveText('版本 2');
  await page.screenshot({ path: `${evidence}/category-mid-motion.png`, animations: 'allow' });
  await page.evaluate(() => document.documentElement.dataset.motion = 'reduced');
  expect(await group.locator('.choice-grid').evaluate(x => x.getAnimations({ subtree: true }).length)).toBe(0);
  await group.getByRole('button', { name: '快照', exact: true }).click();
  expect(await group.locator('.choice-grid').evaluate(x => x.getAnimations({ subtree: true }).length)).toBe(0);
  await page.evaluate(() => document.documentElement.dataset.motion = 'full');
  // Re-enabling motion must not replay an entrance abandoned while reduced.
  expect(await group.locator('.choice-grid').evaluate(x => x.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await group.getByRole('button', { name: '全部', exact: true }).click();
  expect(await group.locator('.choice-grid').evaluate(x => x.getAnimations({ subtree: true }).length)).toBe(0);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await group.getByRole('searchbox').fill('版本 5');
  await expect(group.getByRole('radio')).toHaveCount(11);
  expect(await group.locator('.choice-grid').evaluate(x => x.getAnimations({ subtree: true }).length)).toBe(0);
  await group.getByRole('searchbox').fill('');
  await group.getByRole('button', { name: '显示更多', exact: true }).click();
  await expect(group.getByRole('radio')).toHaveCount(48);
  await writeFile(`${evidence}/category-motion.json`, JSON.stringify(motion, null, 2));
});
