import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const packageJson = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const args = new Map(process.argv.slice(2).map((arg) => {
  const [key, ...value] = arg.replace(/^--/, '').split('=');
  return [key, value.join('=')];
}));
const resolveInsideRoot = (value) => {
  const resolved = path.resolve(root, value);
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Path must stay inside the project: ${value}`);
  }
  return resolved;
};
const payload = resolveInsideRoot(args.get('payload') ?? 'release/win-unpacked');
const output = resolveInsideRoot(args.get('out') ?? 'release');
const candidates = [
  process.env.ISCC_PATH,
  'E:/测试/output/installer-tools/InnoSetup/ISCC.exe',
  `${process.env['ProgramFiles(x86)'] ?? 'C:/Program Files (x86)'}/Inno Setup 6/ISCC.exe`,
  `${process.env.ProgramFiles ?? 'C:/Program Files'}/Inno Setup 6/ISCC.exe`,
].filter(Boolean);
let compiler;
for (const candidate of candidates) {
  try { await access(candidate); compiler = candidate; break; } catch {}
}
if (!compiler) throw new Error(`Inno Setup compiler not found. Set ISCC_PATH. Checked: ${candidates.join(', ')}`);
try { await access(path.join(payload, '筑梦启动器.exe')); }
catch { throw new Error(`Packaged app payload not found at ${payload}; build the app first.`); }
await mkdir(output, { recursive: true });

const numericVersion = packageJson.version.split('-')[0].split('.').slice(0, 3).join('.') + '.0';
const iss = path.join(root, 'build/installer/zhumeng.iss');
const defines = [
  `/DAppVersion=${packageJson.version}`,
  `/DAppVersionInfo=${numericVersion}`,
  `/DPayloadRoot=${payload.replaceAll('\\', '/')}`,
  `/DOutputDir=${output.replaceAll('\\', '/')}`,
];
await new Promise((resolve, reject) => {
  const child = spawn(compiler, [...defines, iss], { cwd: path.dirname(iss), stdio: 'inherit', windowsHide: true });
  child.once('error', reject);
  child.once('exit', (code) => code === 0 ? resolve() : reject(new Error(`Inno Setup exited with code ${code}`)));
});

const installer = path.join(output, `Buildingdreams-${packageJson.version}-x64-nsis.exe`);
const hash = createHash('sha256');
for await (const chunk of createReadStream(installer)) hash.update(chunk);
await writeFile(`${installer}.sha256`, `${hash.digest('hex')}  ${path.basename(installer)}\n`, 'utf8');
console.log(`Created ${installer}`);
