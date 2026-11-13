import { createRequire } from 'node:module';
import { readFile, writeFile, readdir, stat, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join, resolve, normalize } from 'node:path';
const require = createRequire(import.meta.url);
const asar = require('@electron/asar');
const { assertArtifacts } = require('./package-smoke-guards.cjs');
const packageDir = resolve(process.env.ZHUMENG_PACKAGE_DIR || 'release');
const root = join(packageDir, 'win-unpacked'), archive = join(root, 'resources/app.asar');
const files = asar.listPackage(archive).map(p => p.replaceAll('\\', '/').replace(/^\//, ''));
const has = path => { if (!files.includes(path)) throw new Error('Missing packaged file: ' + path); };
const extract = path => asar.extractFile(archive, normalize(path));
has('dist/renderer/data/pcl-moddata.zip');
if (createHash('sha256').update(extract('dist/renderer/data/pcl-moddata.zip')).digest('hex') !== '12cd763062f0cc361f38db5f370e2725257a2a8d59f301a1fd1c5b59b63fb644') throw new Error('Packaged PCL snapshot differs');
for (const file of ['PCL-LICENCE', 'pcl-content-data.txt'])
  if (!(await readFile(join(root, 'resources/notices/supplemental', file))).equals(await readFile(join('notices', file)))) throw new Error('PCL notice differs: ' + file);
const pkg = JSON.parse(extract('package.json').toString());
const current = JSON.parse(await readFile('package.json', 'utf8'));
if (pkg.version !== current.version) throw new Error('Packaged version does not match current workspace package');
if (pkg.name !== 'zhumeng-launcher' || pkg.author !== '杯艺宣') throw new Error('Incorrect package identity/author');
for (const path of ['dist/main/index.js', 'dist/main/preload.js', 'dist/renderer/index.html', 'dist/renderer/licenses.txt', 'dist/renderer/runtime-dependencies.json']) has(path);
for (const file of files) {
  if (/^(validation|tests|scripts|\.git|\.superpowers)\//.test(file) || /(?:^|\/)(?:accounts\.vault|settings\.json|instances\.json|\.env)(?:$|\.)/.test(file)) throw new Error('Private/development content packaged: ' + file);
  if (file.startsWith('dist/') && /\.(js|html|css|json|txt|svg)$/.test(file)) {
    const text = extract(file).toString();
    if (/E:[\\/]+(?:测试|筑梦启动器)|C:[\\/]+Users[\\/]+Administrator|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]+|gh[pousr]_[A-Za-z0-9]{30,}/i.test(text)) throw new Error('Absolute source path or token-like data: ' + file);
  }
}
async function art(dir = 'public/assets') {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, item.name);
    if (item.isDirectory()) await art(path);
    else {
      const packaged = path.replaceAll('\\', '/').replace(/^public\//, 'dist/renderer/');
      has(packaged);
      if (!extract(packaged).equals(await readFile(path))) throw new Error('Artwork differs: ' + packaged);
    }
  }
}
await art();
const inventory = JSON.parse(extract('dist/renderer/runtime-dependencies.json').toString());
for (const entry of inventory) {
  if (entry.name === 'electron' || entry.name.startsWith('@types/') || entry.name === 'undici-types') continue;
  has(entry.packagePath + '/package.json');
  const installed = JSON.parse(extract(entry.packagePath + '/package.json').toString());
  if (installed.version !== entry.version) throw new Error('Runtime dependency version mismatch: ' + entry.name);
}
for (const file of ['LICENSE.electron.txt', 'LICENSES.chromium.html', 'icudtl.dat', 'resources.pak', 'v8_context_snapshot.bin', '筑梦启动器.exe', 'resources/notices/THIRD-PARTY-NOTICES.md', 'resources/notices/licenses.txt', 'resources/notices/runtime-dependencies.json', 'resources/notices/supplemental/boolbase-LICENSE']) await stat(join(root, file));
if ((await stat(join(root, 'LICENSES.chromium.html'))).size < 1000000) throw new Error('Chromium notices incomplete');
if (!(await readFile(join(root, 'LICENSES.chromium.html'))).equals(await readFile('node_modules/electron/dist/LICENSES.chromium.html'))) throw new Error('Chromium notices differ from runtime');
if (!(await readFile(join(root, 'resources/notices/licenses.txt'))).equals(await readFile('public/licenses.txt'))) throw new Error('Runtime notices differ from generated licenses');
const workerDir = join(root, 'resources/pcl-bridge');
const workerFiles = (await readdir(workerDir)).sort();
if (JSON.stringify(workerFiles) !== JSON.stringify(['0Harmony.dll', 'PclBridge.exe'])) throw new Error('Unexpected native bridge resources');
for (const file of workerFiles) {
  if (!(await readFile(join(workerDir, file))).equals(await readFile(join('tools/pcl-bridge/bin/Release', file)))) throw new Error('Native bridge differs: ' + file);
}
for (const file of ['Lib.Harmony.LICENSE', 'PROVENANCE.md']) {
  if (!(await readFile(join(root, 'resources/notices/pcl-bridge', file))).equals(await readFile(join('tools/pcl-bridge/third-party', file)))) throw new Error('Native bridge notice differs: ' + file);
}
const artifacts = assertArtifacts(await readdir(packageDir), pkg);
const hashes = [];
for (const file of artifacts) {
  const bytes = await readFile(join(packageDir, file));
  if (bytes.length < 10000000 || bytes.toString('ascii', 0, 2) !== 'MZ') throw new Error('Invalid Windows artifact: ' + file);
  hashes.push({ file, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') });
}
await writeFile(join(packageDir, 'SHA256SUMS'), hashes.map(h => `${h.sha256}  ${h.file}`).join('\n') + '\n');
const report = { checkedAt: new Date().toISOString(), root, package: { name: pkg.name, version: pkg.version, author: pkg.author }, asarFiles: files.length, runtimeInventoryEntries: inventory.length, artifacts: hashes, checks: ['asar identity', 'runtime production dependency versions', 'all copied artwork bytes', 'private/development files absent', 'own compiled assets source-path/token scan', 'Electron runtime and full Chromium notices', 'portable and NSIS PE headers', 'SHA256SUMS'] };
await mkdir('validation/package', { recursive: true });
await writeFile('validation/package/package-report.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
