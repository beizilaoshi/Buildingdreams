import { it, expect } from 'vitest';
import { spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { preCommand, applyCosmetics } from '../src/main/services/launch-helpers';
import { effectiveLaunchSettings } from '../src/shared/launch-settings';
it('never runs disabled precommands, bounds waiting and cancels only its owned helper', async () => {
    const root = await mkdtemp(join(tmpdir(), 'launch-pre-'));
    const owned: ChildProcess[] = [];
    const own = (c: ChildProcess) => owned.push(c);
    const controller = new AbortController();
    await preCommand(effectiveLaunchSettings({ preCommand: 'echo unsafe > forbidden.txt' }), root, controller.signal, own);
    expect(owned).toHaveLength(0);
    await expect(stat(join(root, 'forbidden.txt'))).rejects.toThrow();
    await preCommand(effectiveLaunchSettings({ preCommandEnabled: true, preCommand: 'echo enabled > allowed.txt' }), root, controller.signal, own);
    expect((await stat(join(root, 'allowed.txt'))).isFile()).toBe(true);
    await expect(preCommand(effectiveLaunchSettings({ preCommandEnabled: true, preCommand: 'ping -n 10 127.0.0.1 > nul', preCommandTimeout: 1 }), root, controller.signal, own)).rejects.toThrow('超时');
});
it('cosmetics require the currently held child identity', async () => {
    const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']);
    const helpers: ChildProcess[] = [];
    try {
        await applyCosmetics(child, effectiveLaunchSettings({ priority: 'belowNormal', windowTitle: "'; Remove-Item x; '" }), new AbortController().signal, c => helpers.push(c), () => false);
        expect(helpers).toHaveLength(0);
        await applyCosmetics(child, effectiveLaunchSettings({ priority: 'belowNormal' }), new AbortController().signal, c => helpers.push(c), () => true);
        expect(helpers).toHaveLength(2);
    }
    finally {
        child.kill();
        for (const helper of helpers)
            helper.kill();
    }
});
