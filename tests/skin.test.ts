import { expect, test } from 'vitest';
import { PNG } from 'pngjs';
import { normalizeSkin, skinData } from '../src/main/services/skin';
const png = () => PNG.sync.write(new PNG({ width: 64, height: 64 }));
test('skin normalization accepts bounded 64 square and legacy textures only', () => {
    expect(PNG.sync.read(normalizeSkin(png())).width).toBe(64);
    for (const data of [Buffer.alloc(65537), Buffer.from('bad'), PNG.sync.write(new PNG({ width: 128, height: 128 }))])
        expect(() => normalizeSkin(data)).toThrow();
});
test('renderer skin data rejects URLs, noncanonical base64 and oversized content', () => {
    expect(skinData('data:image/png;base64,' + png().toString('base64'))).toBeInstanceOf(Buffer);
    for (const value of ['file:///secret', 'https://evil.invalid', 'data:image/png;base64,!!!!', 'data:image/png;base64,' + 'a'.repeat(90000)])
        expect(() => skinData(value)).toThrow();
});
