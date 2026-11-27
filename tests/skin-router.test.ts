import { expect, test } from 'vitest';
import { CommandRouter } from '../src/main/ipc';
import { registerSkinCommands } from '../src/main/skin-router';
test('skin commands reject renderer paths, extra fields and invalid models before account calls', async () => {
    const router = new CommandRouter();
    registerSkinCommands(router, {} as any, () => null);
    for (const payload of [{ id: 'a', png: 'file:///secret', model: 'classic' }, { id: 'a', png: 'x', model: 'wide' }, { id: 'a', png: 'x', model: 'slim', path: 'secret' }])
        await expect(router.invoke('accounts.skinLocal', payload)).rejects.toThrow();
    await expect(router.invoke('accounts.skinPick', 'C:/secret')).rejects.toThrow();
});
