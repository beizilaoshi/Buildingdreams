import type { BrowserWindow } from 'electron';
import { open, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { noPayload, type CommandRouter } from './ipc';
import type { AccountService } from './services/accounts';
import { skinData, skinUri } from './services/skin';
import type { SkinSelection } from '../shared/skin';
function id(value: unknown): string { if (typeof value !== 'string' || !value || value.length > 128 || value.includes('\0'))
    throw Error('无效账号'); return value; }
function object(value: unknown, keys: string[]): Record<string, unknown> { if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== keys.sort().join(','))
    throw Error('无效皮肤参数'); return value as Record<string, unknown>; }
function selection(value: unknown): SkinSelection & {
    id: string;
} { const v = object(value, ['id', 'png', 'model']); if (v.model !== 'classic' && v.model !== 'slim')
    throw Error('无效模型'); return { id: id(v.id), model: v.model, png: skinUri(skinData(v.png)) }; }
export function registerSkinCommands(router: CommandRouter, accounts: AccountService, getWindow: () => BrowserWindow | null): void {
    router.register('accounts.skinRefresh', id, value => accounts.refreshSkin(value));
    router.register('accounts.skinProfile', id, value => accounts.skinProfile(value));
    router.register('accounts.skinLocal', selection, value => accounts.setLocalSkin(value));
    router.register('accounts.skinReset', id, value => accounts.resetLocalSkin(value));
    router.register('accounts.skinUpload', selection, value => accounts.uploadSkin(value));
    router.register('accounts.skinCape', value => { const v = object(value, ['id', 'capeId']); if (v.capeId !== null && (typeof v.capeId !== 'string' || !/^[a-f0-9-]{32,36}$/i.test(v.capeId)))
        throw Error('无效披风'); return { id: id(v.id), capeId: v.capeId as string | null }; }, value => accounts.changeCape(value));
    router.register('accounts.skinPick', noPayload, async () => {
        const { dialog } = await import('electron');
        const window = getWindow();
        const options = { title: '选择 Minecraft 皮肤 PNG', properties: ['openFile'] as [
                'openFile'
            ], filters: [{ name: '皮肤 PNG', extensions: ['png'] }] };
        const result = await (window ? dialog.showOpenDialog(window, options) : dialog.showOpenDialog(options));
        if (result.canceled || !result.filePaths[0])
            return null;
        const handle = await open(result.filePaths[0], 'r');
        try {
            const info = await handle.stat();
            if (!info.isFile() || info.size > 32768)
                throw Error('皮肤文件过大或不是普通文件');
            const buffer = Buffer.alloc(32769);
            const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
            return { png: skinUri(buffer.subarray(0, bytesRead)), model: 'classic' as const };
        }
        finally {
            await handle.close();
        }
    });
    router.register('accounts.skinSave', id, async (value) => {
        const appearance = await accounts.appearance(value);
        if (appearance.source === 'default')
            throw Error('没有可保存的皮肤');
        const png = skinData(appearance.png);
        const { dialog } = await import('electron');
        const window = getWindow();
        const options = { title: '保存皮肤 PNG', defaultPath: 'skin.png', filters: [{ name: '皮肤 PNG', extensions: ['png'] }] };
        const result = await (window ? dialog.showSaveDialog(window, options) : dialog.showSaveDialog(options));
        if (result.canceled || !result.filePath)
            return false;
        const temporary = result.filePath + '.' + randomUUID() + '.tmp';
        const handle = await open(temporary, 'wx', 0o600);
        try {
            try {
                await handle.writeFile(png);
                await handle.sync();
            }
            finally {
                await handle.close();
            }
            await rename(temporary, result.filePath);
        }
        finally {
            await rm(temporary, { force: true });
        }
        return true;
    });
}
