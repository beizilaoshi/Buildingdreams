import { UpdateService } from './services/updates';
import { noPayload, type CommandRouter } from './ipc';
export function registerUpdateCommands(router: CommandRouter, service: UpdateService, open: (url: string) => Promise<void>) {
    router.register('updates.status', noPayload, () => service.read());
    router.register('updates.check', noPayload, () => service.check());
    router.register('updates.open', value => { if (value !== 'release' && value !== 'download')
        throw Error('无效更新链接'); return value; }, async (kind) => { const status = await service.read(); if (status.state !== 'available')
        throw Error('请先检查当前渠道更新'); await open(service.target(kind)); });
}
