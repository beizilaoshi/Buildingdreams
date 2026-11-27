import { PNG } from 'pngjs';
import { createHash } from 'node:crypto';
import { lstat, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { safeDestination } from './network';

const pattern = /^[a-f0-9]{64}\.png$/;
export async function copyInstanceCover(root: string, source: string): Promise<string> {
  const info = await lstat(source);
  if (!info.isFile() || info.size > 8 * 1024 * 1024) throw Error('封面图片需为 8 MB 以内的 PNG');
  const bytes = await readFile(source);
  if (bytes.length < 24 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw Error('仅支持 PNG 封面图片');
  const width = bytes.readUInt32BE(16), height = bytes.readUInt32BE(20);
  if (width < 1 || height < 1 || width > 4096 || height > 4096 || width * height > 16_000_000) throw Error('封面尺寸不能超过 4096 × 4096 像素');
  PNG.sync.read(bytes);
  const name = createHash('sha256').update(bytes).digest('hex') + '.png';
  await mkdir(root, { recursive: true });
  await writeFile(await safeDestination(root, name), bytes);
  return name;
}

export async function instanceCover(root: string, name: string): Promise<string> {
  if (!pattern.test(name)) throw Error('无效封面图片');
  const bytes = await readFile(await safeDestination(root, name));
  if (bytes.length > 8 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') + '.png' !== name) throw Error('封面图片校验失败');
  PNG.sync.read(bytes);
  return 'data:image/png;base64,' + bytes.toString('base64');
}
