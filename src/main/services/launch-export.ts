import { open, rename, rm } from 'node:fs/promises';
import { extname } from 'node:path';
import { randomUUID } from 'node:crypto';
export async function publishLaunchScript(path: string, script: string): Promise<string> {
    if (extname(path).toLowerCase() !== '.ps1')
        throw Error('启动脚本必须保存为 .ps1');
    const temporary = path + '.' + randomUUID() + '.tmp';
    try {
        const file = await open(temporary, 'wx', 0o600);
        try {
            await file.writeFile('\ufeff' + script, 'utf8');
            await file.sync();
        }
        finally {
            await file.close();
        }
        await rename(temporary, path);
        return path;
    }
    finally {
        await rm(temporary, { force: true });
    }
}
