const { test } = require('node:test');
const assert = require('node:assert/strict');
const { requirePredicates, assertArtifacts, ownedEndpoint } = require('./package-smoke-guards.cjs');
const alive = () => ({ pid: 123, exitCode: null, signalCode: null });
const data = 'C:\\isolated-test', nonce = 'this-run';
const record = '54321\n/devtools/browser/unique-run\n';
const args = [`--user-data-dir=${data}`, `--zhumeng-smoke-nonce=${nonce}`, '--remote-debugging-port=0'];
test('false GPU usability or Node isolation fails the acceptance gate', () => {
  for (const key of ['rendererUsable', 'nodeIsolated', 'actualRendererLoaded', 'bridgeAvailable']) {
    assert.throws(() => requirePredicates({ [key]: false }), new RegExp(key));
  }
  assert.deepEqual(requirePredicates({ rendererUsable: true, nodeIsolated: true }), { rendererUsable: true, nodeIsolated: true });
});
test('stale/duplicate/wrong-architecture artifact pairs are rejected', () => {
  assert.throws(() => assertArtifacts(['Buildingdreams-0.0.1-x64-portable.exe', 'Buildingdreams-0.0.2-x64-portable.exe'], { version: '0.1.0' }));
  assert.throws(() => assertArtifacts(['Buildingdreams-0.1.0-arm64-portable.exe', 'Buildingdreams-0.1.0-x64-nsis.exe'], { version: '0.1.0' }));
  assert.equal(assertArtifacts(['Buildingdreams-0.1.0-x64-portable.exe', 'Buildingdreams-0.1.0-x64-nsis.exe'], { version: '0.1.0' }).length, 2);
});
test('early child exit fails before any endpoint access', async () => {
  let accessed = false;
  await assert.rejects(ownedEndpoint({ child: { pid: 1, exitCode: 1 }, data, nonce, read: async () => { accessed = true; return record; } }), /exited/);
  assert.equal(accessed, false);
});
test('foreign nonce/data and endpoint collisions fail read-only ownership checks', async () => {
  for (const foreign of [args.filter(a => !a.startsWith('--zhumeng-smoke-nonce=')), args.filter(a => !a.startsWith('--user-data-dir='))]) {
    await assert.rejects(ownedEndpoint({ child: alive(), data, nonce, read: async () => record, commandLine: async () => foreign }), /does not belong/);
  }
  await assert.rejects(ownedEndpoint({ child: alive(), data, nonce, read: async () => '19383\nhttp://foreign\n', commandLine: async () => { throw new Error('Must not query malformed endpoint'); } }), /Invalid isolated/);
});
test('child exit during handshake and absent endpoint cannot pass', async () => {
  const child = alive();
  await assert.rejects(ownedEndpoint({ child, data, nonce, read: async () => record, commandLine: async () => { child.exitCode = 1; return args; } }), /exited/);
  await assert.rejects(ownedEndpoint({ child: alive(), data, nonce, attempts: 1, read: async () => { throw Object.assign(new Error('missing'), { code: 'ENOENT' }); }, pause: async () => {} }), /did not create/);
});
test('owned dynamic endpoint passes only with exact nonce and directory', async () => {
  const identity = await ownedEndpoint({ child: alive(), data, nonce, read: async () => record, commandLine: async () => args });
  assert.equal(identity.endpoint, 'ws://127.0.0.1:54321/devtools/browser/unique-run');
  assert.equal(identity.verifiedCommandLine, true);
});
test('collision with a real foreign Electron endpoint is rejected without closing its window/process', { timeout: 30000 }, async () => {
  const { _electron } = require('@playwright/test');
  const { mkdtemp, readFile, writeFile } = require('node:fs/promises');
  const { resolve, join } = require('node:path');
  const foreignData = await mkdtemp(resolve('validation/package/foreign-fixture-'));
  const isolatedData = await mkdtemp(resolve('validation/package/collision-fixture-'));
  const app = await _electron.launch({ executablePath: resolve('release/win-unpacked/筑梦启动器.exe'), args: ['--enable-automation', `--user-data-dir=${foreignData}`, '--zhumeng-smoke-nonce=foreign-fixture'], env: { ...process.env, ZHUMENG_DATA_DIR: foreignData } });
  try {
    const page = await app.firstWindow();
    await page.waitForSelector('.home-intro');
    const foreignPid = app.process().pid;
    const record = await readFile(join(foreignData, 'DevToolsActivePort'), 'utf8');
    // Deliberately collide by pointing a different isolated test run at this live fixture.
    await writeFile(join(isolatedData, 'DevToolsActivePort'), record);
    await assert.rejects(ownedEndpoint({ child: { pid: process.pid, exitCode: null, signalCode: null }, data: isolatedData, nonce: 'expected-other-run' }), /nonce does not belong/);
    assert.equal(page.isClosed(), false);
    assert.equal(app.process().exitCode, null);
    assert.equal(app.process().pid, foreignPid);
    assert.equal(await page.locator('.home-intro').isVisible(), true);
  } finally { await app.close(); } // Only this test's explicitly created foreign fixture.
});
