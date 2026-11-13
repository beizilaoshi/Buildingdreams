// @ts-nocheck
// Intentionally CommonJS-compatible TypeScript: run with Node 22+ after npm run build.
// All game data and evidence are isolated below validation/live; never uses the user's game.
const { mkdir, readFile, writeFile, cp, access } = require('node:fs/promises');
const { createWriteStream, openSync, closeSync, unlinkSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { pipeline } = require('node:stream/promises');
const { randomUUID, createHash } = require('node:crypto');
const { ZipFile } = require('yazl');
const { InstanceService } = require('../dist/main/services/instances');
const { TaskService } = require('../dist/main/services/tasks');
const { NetworkService } = require('../dist/main/services/network');
const { InstallService } = require('../dist/main/services/install');
const { LoaderService, XmclLoaderAdapter } = require('../dist/main/services/loaders');
const { JavaService } = require('../dist/main/services/java');
const { ModrinthService } = require('../dist/main/services/modrinth');
const { ModService } = require('../dist/main/services/mods');
const { PackService } = require('../dist/main/services/packs');
const { LaunchService } = require('../dist/main/services/launch');

(async () => {
  const root = resolve('validation/live');
  await mkdir(root, { recursive: true });
  // Prevent simultaneous launches/installations against the same validation registry/game log.
  const lock = join(root, '.smoke.lock');
  const lockFd = openSync(lock, 'wx');
  process.once('exit', () => { closeSync(lockFd); unlinkSync(lock); });
  const instances = new InstanceService(join(root, 'instances.json'));
  const tasks = new TaskService(), network = new NetworkService(), java = new JavaService();
  const install = new InstallService(instances, tasks, network, join(root, 'installations'));
  const loaders = new LoaderService(install, new XmclLoaderAdapter(network, java));
  const modrinth = new ModrinthService(network), mods = new ModService(instances, tasks, network, modrinth);
  const packs = new PackService(install, loaders, modrinth);
  const results = [];
  let cumulative = [];
  try { cumulative = JSON.parse(await readFile(join(root, 'cumulative-results.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const selected = new Set((process.env.SMOKE_STAGES || 'metadata,vanilla,fabric,quilt,forge,neoforge,mods,pack,launch').split(','));
  async function step(name, job) {
    if (!selected.has(name)) return;
    const started = new Date().toISOString(); console.log('START', name, started);
    try { const detail = await job(); results.push({ name, started, finished: new Date().toISOString(), status: 'passed', detail }); console.log('PASS', name, JSON.stringify(detail)); }
    catch (error) { results.push({ name, started, finished: new Date().toISOString(), status: 'failed', error: error.stack || String(error) }); console.error('FAIL', name, error); }
    await writeFile(join(root, `results-${Date.now()}.json`), JSON.stringify(results, null, 2));
    await writeFile(join(root, 'latest-results.json'), JSON.stringify(results, null, 2));
    cumulative = [...cumulative.filter(r => r.name !== name), results.at(-1)];
    await writeFile(join(root, 'cumulative-results.json'), JSON.stringify(cumulative, null, 2));
  }
  async function existing(name) { return (await instances.list()).find(x => x.name === name); }
  await step('metadata', async () => {
    const versions = await install.versions();
    const runtimes = await java.detect();
    const lists = {};
    for (const kind of ['fabric', 'quilt', 'forge', 'neoforge']) lists[kind] = (await loaders.versions(kind, '1.21.1')).slice(0, 3);
    return { versions: versions.length, java: runtimes, loaders: lists };
  });
  await step('vanilla', async () => {
    const item = await existing('Live Vanilla 1.21.1') || await tasks.wait(install.installVanilla('Live Vanilla 1.21.1', '1.21.1'));
    return { id: item.id, resourceDir: item.resourceDir, versionId: item.versionId };
  });
  for (const kind of ['fabric', 'quilt', 'forge', 'neoforge']) await step(kind, async () => {
    const name = `Live ${kind} 1.21.1`;
    let item = await existing(name);
    if (item?.loader) return { id: item.id, versionId: item.versionId, cached: true };
    const base = await existing('Live Vanilla 1.21.1');
    if (!base) throw new Error('Run vanilla stage first');
    if (!item) {
      const id = randomUUID(), resourceDir = join(install.root, id);
      for (const folder of ['versions', 'libraries', 'assets']) await cp(join(base.resourceDir, folder), join(resourceDir, folder), { recursive: true });
      item = await instances.register({ ...base, id, name, resourceDir, gameDir: join(resourceDir, 'game') });
    }
    const versions = await loaders.versions(kind, item.minecraft);
    const version = versions.find(v => v.stable)?.version || versions[0]?.version;
    if (!version) throw new Error('No compatible loader');
    const installed = await tasks.wait(loaders.install(item.id, kind, version));
    return { id: installed.id, versionId: installed.versionId, loader: installed.loader };
  });
  await step('mods', async () => {
    const item = await existing('Live fabric 1.21.1');
    if (!item?.loader) throw new Error('Fabric fixture missing');
    const search = await modrinth.search('fabric api', { minecraft: '1.21.1', loader: 'fabric', limit: 5 });
    const versions = await modrinth.versions('fabric-api', { minecraft: '1.21.1', loader: 'fabric' });
    const version = versions[0];
    await tasks.wait(mods.install(item.id, version.id));
    const sodium = (await modrinth.versions('sodium', { minecraft: '1.21.1', loader: 'fabric' }))[0];
    await tasks.wait(mods.install(item.id, sodium.id));
    // A real required-project dependency walk, beyond self-contained API/Sodium files.
    const modmenu = (await modrinth.versions('modmenu', { minecraft: '1.21.1', loader: 'fabric' }))[0];
    await tasks.wait(mods.install(item.id, modmenu.id));
    const installed = await mods.list(item.id);
    const files = [version, sodium].map(v => { const f = v.files.find(f => f.primary) || v.files[0]; return { path: 'mods/' + f.filename, hashes: f.hashes, fileSize: f.size, downloads: [f.url], env: { client: 'required', server: 'optional' } }; });
    await writeFile(join(root, 'pack-files.json'), JSON.stringify(files, null, 2));
    return { search: search.hits.map(h => h.slug), versions: [version.id, sodium.id, modmenu.id], requiredDependencies: modmenu.dependencies.filter(d => d.dependency_type === 'required'), installed };
  });
  await step('pack', async () => {
    const fabric = await existing('Live fabric 1.21.1');
    const files = JSON.parse(await readFile(join(root, 'pack-files.json'), 'utf8'));
    const source = join(root, 'live-small.mrpack');
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(JSON.stringify({ formatVersion: 1, game: 'minecraft', name: 'Live upstream validation', versionId: '1.0.0', dependencies: { minecraft: '1.21.1', 'fabric-loader': fabric.loader.version }, files })), 'modrinth.index.json');
    zip.addBuffer(Buffer.from('verified real upstream files\n'), 'overrides/config/validation.txt');
    const writing = pipeline(zip.outputStream, createWriteStream(source)); zip.end(); await writing;
    const item = await existing('Live imported pack') || await tasks.wait(packs.install(source, 'Live imported pack'));
    const exported = join(root, 'live-roundtrip.mrpack');
    await tasks.wait(packs.export(item.id, exported, { overridePaths: ['config/validation.txt'] }));
    const preview = await packs.inspect(exported);
    for (const file of files) {
      const bytes = await readFile(join(item.gameDir, file.path));
      if (createHash('sha1').update(bytes).digest('hex') !== file.hashes.sha1) throw new Error('Imported file hash mismatch');
    }
    const round = await existing('Live roundtrip pack') || await tasks.wait(packs.install(exported, 'Live roundtrip pack'));
    if ((await readFile(join(round.gameDir, 'config/validation.txt'), 'utf8')) !== 'verified real upstream files\n') throw new Error('Override lost');
    return { source, exported, files: preview.files.length, loader: preview.loader, imported: item.id, roundtrip: round.id };
  });
  await step('launch', async () => {
    const item = await existing('Live Vanilla 1.21.1');
    const launch = new LaunchService(instances, java, async () => ({ name: 'Validation', uuid: '00000000000040008000000000000001', accessToken: 'local-validation' }));
    const { pid } = await launch.launch(item.id, 'validation');
    console.log('GAME_TEST_PID', pid);
    let initialized = false, exit;
    for (let i = 0; i < 45; i++) {
      await new Promise(r => setTimeout(r, 1000));
      const logs = launch.logs(item.id);
      initialized ||= logs.some(e => /OpenAL initialized|Created:.*texture|Sound engine started/.test(e.text || ''));
      exit = logs.find(e => e.type === 'exit');
      if (initialized || exit) break;
    }
    // Only this exact PID, returned by the real LaunchService in this stage.
    if (!exit) { try { process.kill(pid); } catch {} }
    await new Promise(r => setTimeout(r, 1000));
    let stillRunning = false;
    try { process.kill(pid, 0); stillRunning = true; } catch {}
    const logs = launch.logs(item.id);
    await writeFile(join(root, 'game-launch.json'), JSON.stringify({ pid, initialized, exit, stillRunning, logs }, null, 2));
    if (stillRunning) throw new Error('Known test game PID did not stop: ' + pid);
    if (!initialized) throw new Error(`Game spawned PID ${pid} but no initialization marker; inspect game-launch.json`);
    return { pid, initialized, logLines: logs.length, stoppedKnownTestPid: !exit };
  });
  if (results.some(r => r.status === 'failed')) process.exitCode = 1;
// XMCL/HTTP background handles may outlive completed work. All tasks, evidence writes and
// the one known game PID are settled above; this standalone CLI has no further work.
})().then(() => process.exit(process.exitCode || 0)).catch(error => { console.error(error); process.exit(1); });
