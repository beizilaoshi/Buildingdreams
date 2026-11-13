const { _electron: electron, chromium } = require('@playwright/test');
const { mkdir, readFile, writeFile, readdir, mkdtemp } = require('node:fs/promises');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');
const { randomUUID } = require('node:crypto');
const { requirePredicates, expectedArtifacts, ownedEndpoint } = require('./package-smoke-guards.cjs');
const assert = require('node:assert/strict');
(async () => {
  const evidence = resolve('validation/package');
  await mkdir(evidence, { recursive: true });
  const data = await mkdtemp(join(evidence, 'user-data-'));
  const live = JSON.parse(await readFile('validation/live/instances.json', 'utf8'));
  await writeFile(join(data, 'instances.json'), JSON.stringify(live));
  const executablePath = resolve('release/win-unpacked/筑梦启动器.exe');
  const app = await electron.launch({ executablePath, env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.home-intro');
    await page.keyboard.press('Escape');
    const crypto = await app.evaluate(({ safeStorage }) => {
      const sample = 'local DPAPI validation string';
      const encrypted = safeStorage.encryptString(sample);
      return { available: safeStorage.isEncryptionAvailable(), roundtrip: safeStorage.decryptString(encrypted) === sample, plaintextAbsent: !encrypted.includes(Buffer.from(sample)), backend: safeStorage.getSelectedStorageBackend?.() ?? 'Windows DPAPI' };
    });
    assert(crypto.available && crypto.roundtrip && crypto.plaintextAbsent);
    const identity = await page.evaluate(() => window.launcher.invoke('accounts.addLocal', 'PackageTest'));
    await page.evaluate(async id => {
      localStorage.setItem('account', id);
      await window.launcher.invoke('settings.patch', { reducedMotion: true, openingEnabled: false, theme: 'dark' });
    }, identity.id);
    await page.reload();
    await page.waitForSelector('.home-intro');
    await page.screenshot({ path: join(evidence, 'home-installed.png') });
    for (const [id, label] of [['library','游戏库'], ['download','下载'], ['mods','模组'], ['packs','整合包'], ['personalize','个性化'], ['settings','设置'], ['about','关于']]) {
      await page.getByRole('button', { name: label, exact: true }).click();
      await page.waitForTimeout(400);
      await page.screenshot({ path: join(evidence, `${id}.png`) });
    }
    await page.getByRole('button', { name: '查看第三方软件许可' }).click();
    await page.waitForSelector('.licenses');
    const license = await page.locator('.licenses').innerText();
    assert(license.includes('@xmcl/task') && license.includes('boolbase') && license.includes('Chromium'));
    await page.screenshot({ path: join(evidence, 'licenses.png') });
    const vault = await readFile(join(data, 'accounts.vault'));
    assert(!vault.includes(Buffer.from('PackageTest')));
    await writeFile(join(evidence, 'desktop-report.json'), JSON.stringify({ executablePath, data, importedActualInstances: live.length, crypto, localIdentity: { kind: identity.kind, encryptedVaultPlaintextAbsent: true }, licenseViewer: true, screenshots: 9 }, null, 2));
  } finally { await app.close(); }
  // Restart the shipped executable to verify persisted DPAPI identity under the same Windows user.
  const restart = await electron.launch({ executablePath, args: ['--disable-gpu'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
  try {
    const p = await restart.firstWindow(); await p.waitForSelector('.home-intro');
    const accounts = await p.evaluate(() => window.launcher.invoke('accounts.list', undefined));
    assert(accounts.some(a => a.name === 'PackageTest'));
    await p.screenshot({ path: join(evidence, 'home-gpu-disabled.png') });
    const gpu = requirePredicates({ restartedWithDisabledGpu: true, persistedLocalIdentityReadable: true, rendererUsable: await p.getByRole('button', { name: '启动游戏', exact: true }).isVisible() });
    await writeFile(join(evidence, 'gpu-disabled-report.json'), JSON.stringify(gpu, null, 2));
  }
  finally { await restart.close(); }
  console.log('BUILT_DESKTOP_PASS: DPAPI, encrypted local identity restart, 9 screenshots, runtime licenses');
  const pkg = JSON.parse(await readFile('package.json', 'utf8'));
  const portable = expectedArtifacts(pkg)[0];
  assert((await readdir('release')).includes(portable), 'Build current portable artifact with npm run dist before this test');
  const portableData = await mkdtemp(join(evidence, 'portable-data-'));
  const nonce = randomUUID();
  const child = spawn(resolve('release', portable), ['--remote-debugging-port=0', '--enable-automation', `--user-data-dir=${portableData}`, `--zhumeng-smoke-nonce=${nonce}`], { windowsHide: true, shell: false, env: { ...process.env, ZHUMENG_DATA_DIR: portableData }, stdio: 'ignore' });
  let browser;
  try {
    const ownership = await ownedEndpoint({ child, data: portableData, nonce });
    browser = await chromium.connectOverCDP(ownership.endpoint);
    const page = browser.contexts()[0].pages()[0];
    await page.waitForSelector('.home-intro');
    await page.keyboard.press('Escape');
    const predicates = requirePredicates({ actualRendererLoaded: await page.locator('.home-intro').isVisible(), bridgeAvailable: await page.evaluate(() => typeof window.launcher?.invoke === 'function'), nodeIsolated: await page.evaluate(() => typeof require === 'undefined' && typeof process === 'undefined') });
    await page.screenshot({ path: join(evidence, 'portable-home.png') });
    await writeFile(join(evidence, 'portable-report.json'), JSON.stringify({ artifact: portable, bootstrapPid: child.pid, ownership, ...predicates, installedSystemwide: false }, null, 2));
    await page.evaluate(() => window.launcher.invoke('window.action', 'close')).catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
    console.log('PORTABLE_BOOTSTRAP_PASS', portable);
  } finally {
    if (browser) await browser.close().catch(() => {});
    if (child.exitCode === null) child.kill();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
