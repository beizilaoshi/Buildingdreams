import { expect, test } from 'vitest';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { InstanceService } from '../src/main/services/instances';
import { validateExternalAuthPolicy } from '../src/shared/external-auth';
test('auth policy validator rejects extra credentials and missing server identity', () => { expect(validateExternalAuthPolicy({ kind: 'any' })).toEqual({ kind: 'any' }); expect(validateExternalAuthPolicy({ kind: 'external', serverId: 'server-1' })).toEqual({ kind: 'external', serverId: 'server-1' }); for (const value of [{ kind: 'external' }, { kind: 'external', serverId: 's', accessToken: 'secret' }, { kind: 'any', serverId: 's' }, { kind: 'nide', serverId: 's' }, null])
    expect(() => validateExternalAuthPolicy(value)).toThrow(); });
test('instance auth policy persists and cannot change under a live launch lease', async () => { const dir = await mkdtemp(join(tmpdir(), 'instance-auth-')); try {
    const service = new InstanceService(join(dir, 'registry.json'));
    const item = await service.register({ id: 'i', name: 'I', versionId: 'base', resourceDir: dir, gameDir: dir, minecraft: '1.21', status: 'ready', memoryMb: 2048, javaArgs: [] });
    await service.setAuthentication(item.id, { kind: 'external', serverId: 'server-1' });
    expect((await new InstanceService(join(dir, 'registry.json')).get(item.id)).authentication).toEqual({ kind: 'external', serverId: 'server-1' });
    const lease = await service.beginLaunch(item.id);
    await expect(service.setAuthentication(item.id, { kind: 'any' })).rejects.toThrow('启动租约');
    await service.endLaunch(item.id, lease);
    expect((await service.setAuthentication(item.id, { kind: 'any' })).authentication).toEqual({ kind: 'any' });
}
finally {
    await rm(dir, { recursive: true, force: true });
} });
