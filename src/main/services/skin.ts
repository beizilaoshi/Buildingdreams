import { PNG } from 'pngjs';
import { validateSkinContainer } from './appearance';
export function normalizeSkin(data: Buffer): Buffer {
    try {
        if (data.length > 32768)
            throw Error();
        validateSkinContainer(data);
        const png = PNG.sync.write(PNG.sync.read(data, { checkCRC: true }));
        if (png.length > 32768)
            throw Error();
        return png;
    }
    catch {
        throw Error('皮肤须为有效的 64×32 或 64×64 PNG（最多 32 KiB）');
    }
}
export function skinData(value: unknown): Buffer {
    if (typeof value !== 'string' || value.length > 44000 || !/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/.test(value))
        throw Error('无效皮肤 PNG');
    const encoded = value.slice(22), data = Buffer.from(encoded, 'base64');
    if (data.toString('base64') !== encoded)
        throw Error('无效皮肤 PNG');
    return normalizeSkin(data);
}
export function skinUri(data: Buffer): string { return 'data:image/png;base64,' + normalizeSkin(data).toString('base64'); }
