import { test, expect, _electron as electron, type ElectronApplication, type Page } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { CommandMap } from '../src/shared/types';
import type { SearchPage, ContentProject, ContentVersion } from '../src/shared/content';
import type { PackPreview } from '../src/shared/packs';

const evidence = '.superpowers/sdd/2026-11-11-usability';
let app: ElectronApplication, page: Page, data: string;
test.beforeEach(async () => {
  data = await mkdtemp(join(tmpdir(), 'zhumeng-content-usability-'));
  await mkdir(evidence, { recursive: true });
  app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  page = await app.firstWindow();
  await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
  await page.evaluate(() => window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: true }));
  await app.evaluate((_electron, cwd) => {
    const req = (process as any).mainModule.require.bind((process as any).mainModule);
    const Router = req(req('node:path').join(cwd, 'dist/main/ipc.js')).CommandRouter;
    const original = Router.prototype.invoke;
    const f: any = (globalThis as any).contentUsability = { calls: [], holds: [], pending: {}, choices: [], loaderFailures: 0, searchFailures: 0 };
    f.release = (key: string) => { const resolve = f.pending[key]; delete f.pending[key]; f.holds = f.holds.filter((x: string) => x !== key); resolve(); };
    const wait = async (key: string) => { if (f.holds.includes(key)) await new Promise<void>(resolve => { f.pending[key] = resolve; }); };
    Router.prototype.invoke = async function<K extends keyof CommandMap>(command: K, payload: CommandMap[K]['payload']) {
      f.calls.push({ command, payload: structuredClone(payload) });
      if (command === 'content.search') {
        const p = payload as CommandMap['content.search']['payload'];
        await wait(`search:${p.filter?.provider}:${p.query}`);
        if (f.searchFailures > 0) { f.searchFailures--; throw new Error('fixture search unavailable'); }
        const result: SearchPage = { hits: [{ provider: p.filter?.provider ?? 'modrinth', project_id: 'fixture-project', title: `${p.query || 'Default'} @ ${p.filter?.offset ?? 0}`, description: 'Controlled content result', downloads: 10, author: 'Fixture', categories: [] }], offset: p.filter?.offset ?? 0, limit: 40, total_hits: 120 };
        return result;
      }
      if (command === 'content.project') {
        const result: ContentProject = { id: 'fixture-project', slug: 'fixture-project', projectType: 'mod', title: 'Fixture project', description: 'Fixture', body: '', authors: ['Fixture'], categories: [], downloads: 10, followers: 0, website: 'https://modrinth.com/mod/fixture-project' };
        return result;
      }
      if (command === 'content.versions') {
        const versions: ContentVersion[] = ['1.20.1', '1.21.1'].map((mc, i) => ({ id: `v${i}`, project_id: 'fixture-project', name: mc, version_number: mc, date_published: '2026-11-01T00:00:00Z', game_versions: [mc], loaders: [i ? 'forge' : 'fabric'], files: [{ url: 'https://cdn.modrinth.com/fixture.jar', filename: `${mc}.jar`, primary: true, size: 10, hashes: { sha1: 'a'.repeat(40) } }], dependencies: [] }));
        return versions;
      }
      if (command === 'dialog.choose') {
        const choice = f.choices.shift(); if (!choice) return null;
        await wait(`choose:${choice}`); return choice;
      }
      if (command === 'packs.inspect') {
        await wait(`inspect:${payload}`);
        const result: PackPreview = { name: String(payload), format: 'curseforge', minecraft: '1.20.1', files: [], missingFiles: [{ projectID: payload === 'A.zip' ? 1 : 2, fileID: 11 }], overrides: '' };
        return result;
      }
      if (command === 'packs.hashSupplied') { await wait(`hash:${payload}`); return 'a'.repeat(40); }
      if (command === 'packs.install') { await wait('install'); return 'fixture-task'; }
      if (command === 'install.catalog') return { latest: { release: '1.20.1', snapshot: '1.20.1' }, versions: ['1.20.1', '1.21.1'].map(id => ({ id, type: 'release', url: 'https://fixture.invalid/version', time: '2026-11-01T00:00:00Z', releaseTime: '2026-11-01T00:00:00Z' })) };
      if (command === 'loaders.versions') {
        const p = payload as CommandMap['loaders.versions']['payload'];
        await wait(`loader:${p.kind}:${p.minecraft}`);
        if (f.loaderFailures > 0) { f.loaderFailures--; throw new Error('fixture loader unavailable'); }
        return [{ version: p.kind === 'forge' ? '47.0.1' : '0.16.10', stable: true }];
      }
      if (command === 'install.preview') return { installRoot: 'C:\\Fixture', resourceDir: 'C:\\Fixture\\instance', gameDir: 'C:\\Fixture\\instance\\game' };
      if (command === 'install.vanilla') return 'fixture-install-task';
      return original.call(this, command, payload);
    };
    globalThis.fetch = async (url: any) => { throw new Error(`Unexpected fixture network: ${url}`); };
  }, process.cwd());
  await page.reload(); await page.waitForSelector('.home-intro');
});
test.afterEach(async () => { await app?.close(); if (data) await rm(data, { recursive: true, force: true }); });

async function control(change: { holds?: string[]; choices?: string[]; loaderFailures?: number; searchFailures?: number }) {
  await app.evaluate((_electron, value) => Object.assign((globalThis as any).contentUsability, value), change);
}
async function release(key: string) {
  await expect.poll(() => app.evaluate((_electron, key) => typeof (globalThis as any).contentUsability.pending[key], key)).toBe('function');
  await app.evaluate((_electron, key) => (globalThis as any).contentUsability.release(key), key);
}
async function calls<K extends keyof CommandMap>(command: K): Promise<CommandMap[K]['payload'][]> {
  return app.evaluate((_electron, command) => (globalThis as any).contentUsability.calls.filter((x: any) => x.command === command).map((x: any) => x.payload), command);
}
async function radio(group: string, name: string) { await page.getByRole('radiogroup', { name: group, exact: true }).getByRole('radio', { name, exact: true }).click(); }
async function search(query: string, mc?: string) {
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill(query);
  if (mc !== undefined) await page.getByRole('textbox', { name: '兼容版本', exact: true }).fill(mc);
  await page.getByRole('button', { name: '搜索', exact: true }).click();
  await expect(page.locator('.content-project-row h3')).toHaveText(`${query} @ 0`);
}
async function screenshots(name: string, locator?: ReturnType<Page['locator']>) {
  for (const width of [960, 1280]) {
    await app.evaluate(({ BrowserWindow }, width) => BrowserWindow.getAllWindows()[0].setSize(width, width === 960 ? 640 : 820), width);
    if (locator) await locator.scrollIntoViewIfNeeded();
    await page.screenshot({ path: `${evidence}/task-2-${name}-${width}.png` });
  }
}

test('draft filters never relabel committed results or their detail context; dirty pagination starts at zero', async () => {
  await page.getByRole('button', { name: '模组', exact: true }).click();
  await radio('兼容加载器', 'Fabric'); await search('A', '1.20.1');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.content-project-row h3')).toHaveText('A @ 40');
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill('B');
  await page.getByRole('textbox', { name: '兼容版本', exact: true }).fill('1.21.1'); await radio('兼容加载器', 'Forge');
  await page.locator('.content-project-row').click();
  await expect(page.getByRole('radiogroup', { name: 'Minecraft 版本筛选' }).getByRole('radio', { name: '1.20.1', exact: true })).toHaveAttribute('aria-checked', 'true');
  await expect(page.locator('.content-group-toggle')).toContainText('fabric 1.20.1');
  await page.getByRole('button', { name: '返回搜索结果', exact: true }).click();
  await radio('资源类型', '资源包'); await radio('资源类型', 'Mod');
  await expect(page.getByRole('textbox', { name: '搜索 Mod', exact: true })).toHaveValue('B');
  await expect(page.locator('.content-search-context')).toContainText('尚未搜索');
  await expect(page.locator('.content-project-row h3')).toHaveText('A @ 40');
  await screenshots('pending-search', page.locator('.content-search-context'));
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.content-project-row h3')).toHaveText('B @ 0');
  expect((await calls('content.search')).at(-1)).toMatchObject({ query: 'B', filter: { offset: 0, minecraft: '1.21.1', loader: 'forge' } });
});

test('late search and abandoned provider responses cannot replace a newer result or its cache', async () => {
  await control({ holds: ['search:modrinth:A', 'search:modrinth:B', 'search:curseforge:Old'] });
  await page.getByRole('button', { name: '模组', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill('A'); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill('B'); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await release('search:modrinth:A');
  await expect(page.locator('.content-search-results')).toHaveText('正在搜索…');
  await expect(page.locator('.content-project-row')).toHaveCount(0);
  await release('search:modrinth:B');
  await expect(page.locator('.content-project-row h3')).toHaveText('B @ 0');
  await radio('内容来源', 'CurseForge');
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill('Old'); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await radio('内容来源', 'Modrinth'); await release('search:curseforge:Old');
  await expect(page.locator('.content-project-row h3')).toHaveText('B @ 0');
  await radio('资源类型', '资源包'); await radio('资源类型', 'Mod');
  await expect(page.locator('.content-project-row h3')).toHaveText('B @ 0');
});

test('draft changed while search is pending remains visibly unsubmitted after category restoration', async () => {
  await control({ holds: ['search:modrinth:A'] });
  await page.getByRole('button', { name: '模组', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill('A'); await page.getByRole('button', { name: '搜索', exact: true }).click();
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill('B'); await release('search:modrinth:A');
  await expect(page.locator('.content-project-row h3')).toHaveText('A @ 0');
  await radio('资源类型', '资源包'); await radio('资源类型', 'Mod');
  await expect(page.locator('.content-search-context')).toContainText('尚未搜索');
  await expect(page.locator('.content-search-context')).toContainText('A');
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).press('Enter');
  await expect(page.locator('.content-project-row h3')).toHaveText('B @ 0');
});

test('CurseForge category and provider revalidation retains page three until filters actually change', async () => {
  await page.getByRole('button', { name: '模组', exact: true }).click(); await radio('内容来源', 'CurseForge'); await search('CF', '1.20.1');
  for (const offset of [40, 80]) { await page.getByRole('button', { name: '下一页', exact: true }).click(); await expect(page.locator('.content-project-row h3')).toHaveText(`CF @ ${offset}`); }
  await radio('资源类型', '资源包'); await radio('资源类型', 'Mod');
  await expect(page.locator('.content-project-row h3')).toHaveText('CF @ 80');
  expect((await calls('content.search')).at(-1)).toMatchObject({ query: 'CF', filter: { provider: 'curseforge', offset: 80 } });
  await radio('内容来源', 'Modrinth'); await radio('内容来源', 'CurseForge');
  await expect(page.locator('.content-project-row h3')).toHaveText('CF @ 80');
  await page.getByRole('textbox', { name: '兼容版本', exact: true }).fill('1.21.1');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  expect((await calls('content.search')).at(-1)).toMatchObject({ query: 'CF', filter: { offset: 0, minecraft: '1.21.1' } });
});

test('search retry preserves the failed page and committed filters while keeping a new draft unsubmitted', async () => {
  await page.getByRole('button', { name: '模组', exact: true }).click(); await search('A', '1.20.1');
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.locator('.content-project-row h3')).toHaveText('A @ 40');
  await control({ searchFailures: 1 });
  await page.getByRole('button', { name: '下一页', exact: true }).click();
  await expect(page.getByRole('button', { name: '重试搜索', exact: true })).toBeVisible();
  await page.getByRole('textbox', { name: '搜索 Mod', exact: true }).fill('B');
  await page.getByRole('button', { name: '重试搜索', exact: true }).click();
  await expect(page.locator('.content-project-row h3')).toHaveText('A @ 80');
  expect((await calls('content.search')).at(-1)).toMatchObject({ query: 'A', filter: { offset: 80, minecraft: '1.20.1' } });
  await expect(page.getByRole('textbox', { name: '搜索 Mod', exact: true })).toHaveValue('B');
  await expect(page.locator('.content-search-context')).toContainText('尚未搜索');
});

for (const stage of ['choose', 'hash'] as const) {
  test(`switching pack while supplemental ${stage} is pending cannot contaminate the new install`, async () => {
    await control({ choices: ['A.zip', 'A.jar', 'B.zip', 'B.jar'], holds: [`${stage}:A.jar`] });
    await page.getByRole('button', { name: '整合包', exact: true }).click();
    await page.getByRole('button', { name: '选择整合包文件', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'A.zip', exact: true })).toBeVisible();
    await page.getByRole('button', { name: '选择并校验', exact: true }).click();
    await expect.poll(() => app.evaluate((_electron, key) => typeof (globalThis as any).contentUsability.pending[key], `${stage}:A.jar`)).toBe('function');
    await page.getByRole('button', { name: '选择整合包文件', exact: true }).click();
    await expect(page.getByRole('heading', { name: 'B.zip', exact: true })).toBeVisible();
    await release(`${stage}:A.jar`);
    await page.getByRole('button', { name: '选择并校验', exact: true }).click();
    await expect(page.getByText(/项目 2 \/ 文件 11 · 已校验/)).toBeVisible();
    await screenshots(`pack-${stage}`, page.getByRole('button', { name: '安装整合包', exact: true }));
    await page.getByRole('button', { name: '安装整合包', exact: true }).click();
    expect((await calls('packs.install')).at(-1)).toEqual({ file: 'B.zip', name: 'B.zip', options: { includeOptional: true, suppliedFiles: [{ projectID: 2, fileID: 11, path: 'B.jar', sha1: 'a'.repeat(40), target: 'mods' }] } });
    expect((await calls('dialog.choose')).filter(x => x === 'supplied')).toHaveLength(2);
    if (stage === 'choose') expect(await calls('packs.hashSupplied')).toEqual(['B.jar']);
  });
}

for (const stage of ['choose', 'hash'] as const) {
test(`pending supplemental ${stage} controls submit only one selection`, async () => {
  await control({ choices: ['A.zip', 'A.jar'], holds: [`${stage}:A.jar`] });
  await page.getByRole('button', { name: '整合包', exact: true }).click();
  await page.getByRole('button', { name: '选择整合包文件', exact: true }).click();
  const choose = page.getByRole('button', { name: '选择并校验', exact: true });
  await choose.evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect(choose).toBeDisabled();
  expect((await calls('dialog.choose')).filter(x => x === 'supplied')).toHaveLength(1);
  await release(`${stage}:A.jar`);
  await expect(choose).toBeEnabled();
});
}

for (const stage of ['choose', 'inspect'] as const) {
test(`out-of-order pack ${stage} keeps newest choice and pending install uses its captured options`, async () => {
  await control({ choices: ['A.zip', 'B.zip', 'B.jar', 'A.zip'], holds: [`${stage}:A.zip`, 'install'] });
  await page.getByRole('button', { name: '整合包', exact: true }).click();
  await page.getByRole('button', { name: '选择整合包文件', exact: true }).click();
  await page.getByRole('button', { name: '选择整合包文件', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'B.zip', exact: true })).toBeVisible();
  await release(`${stage}:A.zip`);
  await expect(page.getByRole('heading', { name: 'B.zip', exact: true })).toBeVisible();
  await page.getByRole('button', { name: '选择并校验', exact: true }).click();
  await expect(page.getByText(/项目 2 \/ 文件 11 · 已校验/)).toBeVisible();
  await page.getByRole('button', { name: '安装整合包', exact: true }).evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect.poll(() => calls('packs.install').then(x => x.length)).toBe(1);
  await radio('文件类型', '资源包');
  await page.getByLabel('安装后的游戏名称', { exact: true }).fill('edited after submit');
  await page.getByLabel('包含可选文件', { exact: true }).uncheck();
  await page.getByRole('button', { name: '选择整合包文件', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'A.zip', exact: true })).toBeVisible();
  await release('install');
  expect((await calls('packs.install'))[0]).toMatchObject({ file: 'B.zip', name: 'B.zip', options: { includeOptional: true, suppliedFiles: [{ projectID: 2, target: 'mods' }] } });
  await expect(page.getByText('整合包安装已加入任务', { exact: true })).toHaveCount(0);
});
}

test('loader failure retries the same selection once, and a stale retry cannot override another loader', async () => {
  await control({ loaderFailures: 1 });
  await page.getByRole('button', { name: '下载', exact: true }).click();
  await page.getByRole('button', { name: '选择 1.20.1 · 最新正式版', exact: true }).click();
  await page.getByLabel('游戏名称', { exact: true }).fill('Keep this name'); await radio('加载器', 'Fabric');
  const retry = page.getByRole('button', { name: '重试获取加载器', exact: true });
  await expect(retry).toBeVisible(); await screenshots('loader-retry', retry);
  await control({ holds: ['loader:fabric:1.20.1'] });
  await retry.evaluate((node: HTMLButtonElement) => { node.click(); node.click(); });
  await expect(retry).toBeDisabled();
  expect(await calls('loaders.versions')).toEqual([{ kind: 'fabric', minecraft: '1.20.1' }, { kind: 'fabric', minecraft: '1.20.1' }]);
  await release('loader:fabric:1.20.1');
  await expect(page.getByRole('radio', { name: '0.16.10 · 稳定', exact: true })).toBeEnabled();
  await expect(retry).toBeHidden();
  await expect(page.getByLabel('游戏名称', { exact: true })).toHaveValue('Keep this name');
  await control({ loaderFailures: 1 }); await radio('加载器', 'Forge'); await expect(retry).toBeVisible();
  await control({ holds: ['loader:forge:1.20.1'] }); await retry.click();
  await radio('加载器', 'Fabric'); await release('loader:forge:1.20.1');
  await expect(page.getByRole('radio', { name: '0.16.10 · 稳定', exact: true })).toBeEnabled();
  await expect(page.getByRole('radio', { name: '47.0.1 · 稳定', exact: true })).toHaveCount(0);
  await page.getByRole('button', { name: '开始安装', exact: true }).click();
  expect((await calls('install.vanilla')).at(-1)).toEqual({ name: 'Keep this name', root: 'C:\\Fixture', version: '1.20.1', loader: { kind: 'fabric', version: '0.16.10' } });
});
