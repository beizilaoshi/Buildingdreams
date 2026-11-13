// Standard native image resizes only; the ImageGen source PNG is never edited.
// Reproduce: electron scripts/make-icon.cjs
const { app, nativeImage } = require('electron');
const { mkdirSync, writeFileSync } = require('node:fs');
const { resolve } = require('node:path');
app.whenReady().then(() => {
  const source = nativeImage.createFromPath(resolve(__dirname, '../public/assets/logos/zhumeng-generated.png'));
  if (source.isEmpty()) throw new Error('Generated brand PNG is missing or invalid');
  const sizes = [16, 24, 32, 48, 64, 128, 256];
  const pngs = sizes.map(size => source.resize({ width: size, height: size, quality: 'best' }).toPNG());
  const header = Buffer.alloc(6 + 16 * sizes.length);
  header.writeUInt16LE(1, 2); header.writeUInt16LE(sizes.length, 4);
  let offset = header.length;
  sizes.forEach((size, index) => {
    const at = 6 + index * 16; header[at] = header[at + 1] = size % 256;
    header.writeUInt16LE(1, at + 4); header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(pngs[index].length, at + 8); header.writeUInt32LE(offset, at + 12);
    offset += pngs[index].length;
  });
  mkdirSync(resolve(__dirname, '../build'), { recursive: true });
  writeFileSync(resolve(__dirname, '../build/icon.ico'), Buffer.concat([header, ...pngs]));
  app.quit();
}).catch(error => { console.error(error); app.exit(1); });
