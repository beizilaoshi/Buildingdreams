import type { ExternalAccountService } from './services/external-accounts';
import type { ExternalLoginInput } from '../shared/external-auth';
import { CommandRouter, noPayload } from './ipc';
function text(v: unknown, max = 2048): string { if (typeof v !== 'string' || !v || v.length > max || /[\0\r\n]/.test(v))
    throw Error('无效外置认证参数'); return v; }
function object(v: unknown, keys: string[]): Record<string, unknown> { if (!v || typeof v !== 'object' || Array.isArray(v) || Object.keys(v).some(k => !keys.includes(k)))
    throw Error('无效外置认证参数'); return v as Record<string, unknown>; }
export function registerExternalAuthCommands(router: CommandRouter, service: ExternalAccountService, openExternal: (url: string) => Promise<void>): void {
    router.register('external.servers', noPayload, () => service.servers());
    router.register('external.addServer', v => text(v), v => service.addServer(v));
    router.register('external.removeServer', v => text(v, 128), v => service.removeServer(v));
    router.register('external.login', v => { const o = object(v, ['serverId', 'username', 'password', 'attemptId']); const input: ExternalLoginInput = { serverId: text(o.serverId, 128), username: text(o.username, 256), password: text(o.password, 1024) }; if (o.attemptId !== undefined)
        input.attemptId = text(o.attemptId, 128); return input; }, v => service.login(v));
    router.register('external.selectProfile', v => { const o = object(v, ['attemptId', 'profileId']); return { attemptId: text(o.attemptId, 128), profileId: text(o.profileId, 128) }; }, v => service.selectProfile(v));
    router.register('external.cancel', v => text(v, 128), v => service.cancel(v));
    router.register('external.refresh', v => text(v, 128), v => service.refresh(v));
    router.register('external.validate', v => text(v, 128), v => service.validate(v));
    router.register('external.signout', v => { const o = object(v, ['id', 'password']); return { id: text(o.id, 128), password: text(o.password, 1024) }; }, v => service.signout(v));
    router.register('external.injectorStatus', noPayload, () => service.injectorStatus());
    router.register('external.prepareInjector', noPayload, () => service.prepareInjector());
    router.register('external.openRegistration', v => text(v, 128), async (id) => { const server = (await service.servers()).find(s => s.id === id); if (!server?.registerUrl)
        throw Error('此服务未提供注册链接'); await openExternal(server.registerUrl); });
}
