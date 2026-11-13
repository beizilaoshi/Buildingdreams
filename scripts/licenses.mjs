import { readFile, writeFile, mkdir, readdir } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { dirname, join, relative, resolve } from 'node:path';
const require = createRequire(import.meta.url);
const root = resolve('.');
const app = JSON.parse(await readFile('package.json', 'utf8'));
const inventory = [], visited = new Set();
let text = '筑梦启动器 · 第三方软件许可\n完整 Chromium 通知随发行版保留在 LICENSES.chromium.html。\n';
async function locate(name, from) {
  try { return require.resolve(name + '/package.json', { paths: [from] }); }
  catch {
    let dir = dirname(require.resolve(name, { paths: [from] }));
    while (dir !== dirname(dir)) {
      try { const p = join(dir, 'package.json'); if (JSON.parse(await readFile(p, 'utf8')).name === name) return p; } catch {}
      dir = dirname(dir);
    }
    throw new Error('Cannot locate license for ' + name);
  }
}
async function visit(name, from) {
  const file = await locate(name, from), dir = dirname(file);
  if (visited.has(file)) return;
  visited.add(file);
  const pkg = JSON.parse(await readFile(file, 'utf8'));
  const licenses = (await readdir(dir)).filter(f => /^(licen[cs]e|copying|notice)(\.|$|-)/i.test(f));
  const supplement = name === 'boolbase' ? 'notices/boolbase-LICENSE' : undefined;
  if (!licenses.length && !supplement) throw new Error('License missing: ' + name);
  inventory.push({ name: pkg.name, version: pkg.version, license: pkg.license, repository: pkg.repository, packagePath: relative(root, dir).replaceAll('\\', '/'), licenseFiles: licenses });
  text += `\n===== ${pkg.name}@${pkg.version} (${pkg.license ?? 'see below'}) =====\n`;
  for (const license of licenses) text += `\n--- ${license} ---\n${await readFile(join(dir, license), 'utf8')}\n`;
  if (supplement) text += `\n--- upstream LICENSE (not included in npm tarball) ---\n${await readFile(supplement, 'utf8')}\n`;
  // Electron's npm downloader is a build tool; its runtime and Chromium notices ship separately.
  if (name !== 'electron') for (const dep of Object.keys(pkg.dependencies || {}).sort()) await visit(dep, dir);
}
for (const name of Object.keys(app.dependencies).sort()) await visit(name, root);
await visit('electron', root);
inventory.sort((a, b) => a.name.localeCompare(b.name));
await mkdir('public', { recursive: true });
text += '\n===== PCL source references and Minecraft block artwork =====\n' + await readFile('notices/pcl-version-assets.txt', 'utf8');
text += '\n===== PCL / MC百科 content data =====\n' + await readFile('notices/pcl-content-data.txt', 'utf8') + '\n===== Original PCL LICENCE =====\n' + await readFile('notices/PCL-LICENCE', 'utf8');
text += '\n===== Java runtime rules and portable distributions =====\n' + await readFile('notices/java-runtime.txt', 'utf8');
await writeFile('public/licenses.txt', text);
await writeFile('public/runtime-dependencies.json', JSON.stringify(inventory, null, 2) + '\n');
console.log(`License inventory: ${inventory.length} runtime packages + bundled Chromium notices`);
