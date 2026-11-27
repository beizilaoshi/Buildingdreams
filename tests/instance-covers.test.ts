import { afterEach, expect, it } from 'vitest';
import { PNG } from 'pngjs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { copyInstanceCover, instanceCover } from '../src/main/services/instance-covers';

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true }))); });

it('stores a validated PNG cover by content hash and serves it as image data', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhumeng-cover-')); roots.push(root);
  const source = join(root, 'cover.png'), managed = join(root, 'managed');
  const png = PNG.sync.write(new PNG({ width: 3, height: 2 }));
  await writeFile(source, png);
  const name = await copyInstanceCover(managed, source);
  expect(name).toMatch(/^[a-f0-9]{64}\.png$/);
  expect(await instanceCover(managed, name)).toBe(`data:image/png;base64,${png.toString('base64')}`);
  await expect(instanceCover(managed, '../cover.png')).rejects.toThrow('无效封面图片');
});

it('rejects non-PNG content and oversized PNG dimensions before saving', async () => {
  const root = await mkdtemp(join(tmpdir(), 'zhumeng-cover-invalid-')); roots.push(root);
  const source = join(root, 'bad.png');
  await writeFile(source, Buffer.from('not an image'));
  await expect(copyInstanceCover(join(root, 'managed'), source)).rejects.toThrow('仅支持 PNG 封面图片');
  const huge = Buffer.alloc(24);
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(huge);
  huge.writeUInt32BE(5000, 16); huge.writeUInt32BE(5000, 20);
  await writeFile(source, huge);
  await expect(copyInstanceCover(join(root, 'managed'), source)).rejects.toThrow('封面尺寸不能超过');
});
