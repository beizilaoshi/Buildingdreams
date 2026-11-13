import { it, expect, vi } from 'vitest';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { LaunchService } from '../src/main/services/launch';
import { InstanceService } from '../src/main/services/instances';
import { JavaService } from '../src/main/services/java';
import { fixture } from './minecraft-fixture';
async function setup() { const root = await fixture(); await writeFile(join(root, 'versions/base/base.jar'), 'fixture bytes never executed'); const instances = new InstanceService(); const [item] = await instances.importDirectory(root); const java = new JavaService(); vi.spyOn(java, 'detect').mockResolvedValue([{ path: process.execPath, major: 17, version: '17', arch: 'amd64' }]); return { instances, item, java }; }
it('owns one running child, stops it, ignores stale close, and permits restart', async () => {
    const { instances, item, java } = await setup();
    const children: ReturnType<typeof spawn>[] = [];
    const service = new LaunchService(instances, java, async () => ({ name: 'n', uuid: 'u', accessToken: 'secret' }), async () => { const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']); children.push(child); return child; });
    try {
        const first = service.launch(item.id, 'a');
        expect(service.isBusy(item.id)).toBe(true);
        const a = await first;
        expect(await service.launch(item.id, 'b')).toEqual(a);
        expect(children).toHaveLength(1);
        expect(service.status(item.id).phase).toBe('running');
        await service.stop(item.id);
        await vi.waitFor(() => expect(service.isBusy(item.id)).toBe(false));
        await service.launch(item.id, 'a');
        children[0].emit('close', 0, null);
        expect(service.status(item.id).phase).toBe('running');
        expect(await service.stop('foreign-id')).toMatchObject({ phase: 'idle' });
    }
    finally {
        await service.stop(item.id);
        for (const child of children)
            child.kill();
    }
});
it('cancels preparation before account retrieval and reports only safe failure', async () => {
    const { instances, item, java } = await setup();
    let release!: () => void;
    vi.spyOn(java, 'resolve').mockImplementation(async () => { await new Promise<void>(r => release = r); return { path: process.execPath, major: 17, version: '17', arch: 'amd64' }; });
    const account = vi.fn(), runner = vi.fn();
    const service = new LaunchService(instances, java, account, runner);
    const pending = service.launch(item.id, 'a');
    const rejected = expect(pending).rejects.toThrow();
    await vi.waitFor(() => expect(release).toBeDefined());
    await service.cancel(item.id);
    release();
    await rejected;
    expect(account).not.toHaveBeenCalled();
    expect(runner).not.toHaveBeenCalled();
    expect(service.status(item.id).phase).toBe('cancelled');
});
it('restores launcher on spawn failure and preserves already running game at dispose', async () => {
    const { instances, item, java } = await setup();
    await instances.patchLaunch(item.id, { launcherAction: 'hide', restoreLauncher: true });
    const failed = new LaunchService(instances, java, async () => ({ name: 'name', uuid: 'uuid-value', accessToken: 'secret-value' }), async () => spawn('missing-zhumeng-test-executable', []));
    const actions: string[] = [];
    failed.windowAction = a => actions.push(a);
    await expect(failed.launch(item.id, 'a')).rejects.toThrow();
    expect(failed.isBusy(item.id)).toBe(false);
    expect(actions).toContain('restore');
    let child!: ReturnType<typeof spawn>;
    const service = new LaunchService(instances, java, async () => ({ name: 'name', uuid: 'uuid-value', accessToken: 'secret-value' }), async () => child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)']));
    try {
        // A failed spawn finished its lease; a fresh launch must be able to start again.
        await service.launch(item.id, 'a');
        expect(service.status(item.id).phase).toBe('running');
        service.dispose();
        expect(child.exitCode).toBeNull();
        expect(child.killed).toBe(false);
        expect(service.isBusy(item.id)).toBe(true);
    }
    finally {
        child?.kill();
    }
});
it('redacts split credentials and bounds a complete huge line before exposing logs', async () => {
    const { instances, item, java } = await setup();
    const secret = 'split-secret-token-123';
    const service = new LaunchService(instances, java, async () => ({ name: 'name', uuid: 'uuid-value', accessToken: secret }), async () => spawn(process.execPath, ['-e', `process.stdout.write('split-secret-');setTimeout(()=>{process.stdout.write('token-123\\n');process.stdout.write('x'.repeat(100000)+'\\n');},20)`]));
    const ended = new Promise<void>(resolve => service.events.on('event', e => { if (e.type === 'exit')
        resolve(); }));
    await service.launch(item.id, 'a');
    await ended;
    const logs = service.logs(item.id);
    expect(JSON.stringify(logs)).not.toContain(secret);
    expect(logs.some(e => e.text === '[Oversized log line omitted]')).toBe(true);
    expect(logs.every(e => (e.text?.length ?? 0) <= 65536)).toBe(true);
});

it('retains ownership when cancellation precedes a paused runner returning its live child',async()=>{
 const {instances,item,java}=await setup();let release!:()=>void;let child!:ReturnType<typeof spawn>;let originalKill!:typeof child.kill;let count=0;
 const service=new LaunchService(instances,java,async()=>({name:'Name',uuid:'uuid-value',accessToken:'secret-value'}),async()=>{count++;child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);originalKill=child.kill.bind(child);vi.spyOn(child,'kill').mockReturnValue(false);await new Promise<void>(r=>release=r);return child;});
 const pending=service.launch(item.id,'a');const rejected=expect(pending).rejects.toThrow();
 try{await vi.waitFor(()=>expect(release).toBeDefined());await service.cancel(item.id);release();await rejected;expect(service.isBusy(item.id)).toBe(true);expect(service.status(item.id).phase).toBe('stopping');process.kill(child.pid!,0);await expect(service.launch(item.id,'b')).rejects.toThrow();expect(count).toBe(1);originalKill();await vi.waitFor(()=>expect(service.isBusy(item.id)).toBe(false));expect(service.status(item.id).phase).toBe('cancelled');}
 finally{release?.();originalKill?.();}
});
it('a failed kill error from a live child cannot release ownership or permit another spawn',async()=>{
 const {instances,item,java}=await setup();let child!:ReturnType<typeof spawn>;let count=0;const service=new LaunchService(instances,java,async()=>({name:'Name',uuid:'uuid-value',accessToken:'secret-value'}),async()=>{count++;return child=spawn(process.execPath,['-e','setInterval(()=>{},1000)']);});
 await service.launch(item.id,'a');const originalKill=child.kill.bind(child);vi.spyOn(child,'kill').mockImplementation(()=>{child.emit('error',Object.assign(new Error('kill EPERM'),{code:'EPERM'}));return false;});
 try{await service.stop(item.id);expect(service.isBusy(item.id)).toBe(true);expect(service.status(item.id).phase).toBe('stopping');process.kill(child.pid!,0);await service.launch(item.id,'b');expect(count).toBe(1);originalKill();await vi.waitFor(()=>expect(service.isBusy(item.id)).toBe(false));}
 finally{originalKill();}
});
