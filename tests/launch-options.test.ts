import { expect, it } from 'vitest';
import { effectiveLaunchSettings, validateLaunchSettings } from '../src/shared/launch-settings';
import { buildLaunchOptions, powershellScript } from '../src/main/services/launch-options';
import { generateArguments } from '@xmcl/core';
import { fixture } from './minecraft-fixture';
import { InstanceService } from '../src/main/services/instances';
it('migrates legacy defaults and preserves explicit false/empty overrides', () => {
    expect(effectiveLaunchSettings(undefined, undefined)).toMatchObject({ fullscreen: false, gc: 'auto' });
    expect(effectiveLaunchSettings({ fullscreen: true, windowTitle: 'Global' }, { fullscreen: false, windowTitle: '' })).toMatchObject({ fullscreen: false, windowTitle: '' });
    for (const input of [{ width: 0 }, { fullscreen: 'true' }, { serverHost: 'host;evil' }, { serverPort: 65536 }, { unknown: true }, { gameArgs: ['--accessToken=x'] }, { gameArgs: ['--gameDir', 'x'] }])
        expect(() => validateLaunchSettings(input)).toThrow();
});
it('uses actual XMCL arguments for resolution, old/new server and GC prerequisites', async () => {
    const instances = new InstanceService();
    const [item] = await instances.importDirectory(await fixture());
    const version = await instances.resolve(item.id);
    const build = (minecraft: string, major: number, patch: object) => buildLaunchOptions({ ...item, minecraft }, { ...version, minecraftVersion: minecraft }, { path: 'java', major, version: String(major), arch: 'amd64' }, { name: 'Player', uuid: 'id', accessToken: 'token' }, effectiveLaunchSettings(patch as any));
    const old = build('1.19.4', 17, { width: 1100, height: 700, serverHost: 'localhost', serverPort: 25566, gc: 'g1', gameArgs: ['literal a & % !'] });
    expect(await generateArguments(old)).toEqual(expect.arrayContaining(['--server', 'localhost', '--port', '25566', '--width', '1100', '-XX:+UseG1GC', 'literal a & % !']));
    expect(build('1.20.1', 17, { serverHost: 'localhost' }).quickPlayMultiplayer).toBe('localhost:25565');
    expect(() => build('1.8.9', 8, { gc: 'zgc' })).toThrow('Java');
    expect(build('1.21', 21, { gc: 'zgc' }).extraJVMArgs).toContain('-XX:+UseZGC');
    expect(() => buildLaunchOptions({ ...item, javaArgs: ['-Xmx9G'] }, version, { path: 'java', major: 17, version: '17', arch: 'amd64' }, { name: 'n', uuid: 'u', accessToken: 't' }, effectiveLaunchSettings())).toThrow();
});
it('exports a literal argv array without actual account credentials', () => {
    const script = powershellScript('C:/path with 空格/java.exe', ['--username', '__ZH_NAME__', '--uuid', '__ZH_UUID__', '--accessToken', '__ZH_TOKEN__', "a'b & % !"], 'C:/game', false);
    expect(script).toContain("'a''b & % !'");
    expect(script).toContain('[System.Diagnostics.Process]::Start');
    expect(script).not.toContain('$env:ZHUMENG_ACCESS_TOKEN');
});
it('PowerShell export preserves actual owned process argv including empty, quotes, slashes and shell metacharacters', async () => {
    const { mkdtemp, writeFile, readFile, stat } = await import('node:fs/promises');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { execFile } = await import('node:child_process');
    const { promisify } = await import('node:util');
    const root = await mkdtemp(join(tmpdir(), 'launch script 空格 ')), probe = join(root, 'owned probe.cjs'), result = join(root, 'argv.json'), file = join(root, 'launch.ps1');
    await writeFile(probe, "require('node:fs').writeFileSync(process.argv[2], JSON.stringify(process.argv.slice(3)))");
    const args = ['', 'a b', '中文', "quote'", 'double"quote', 'end\\', 'slash\\"quote', '& echo evil > injected.txt', '%PATH%', '!bang!', '$(Write-Output injected)'];
    await writeFile(file, '\ufeff' + powershellScript(process.execPath, [probe, result, ...args], root, false));
    await promisify(execFile)('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', file], { windowsHide: true, timeout: 10000 });
    expect(JSON.parse(await readFile(result, 'utf8'))).toEqual(args);
    await expect(stat(join(root, 'injected.txt'))).rejects.toThrow();
});

it('explicit environment export quotes runtime identity values without embedding them',async()=>{
 const {mkdtemp,writeFile,readFile}=await import('node:fs/promises');const {tmpdir}=await import('node:os');const {join}=await import('node:path');const {execFile}=await import('node:child_process');const {promisify}=await import('node:util');
 const root=await mkdtemp(join(tmpdir(),'launch-env-')),probe=join(root,'probe.cjs'),result=join(root,'argv.json'),file=join(root,'launch.ps1');
 await writeFile(probe,"require('node:fs').writeFileSync(process.argv[2],JSON.stringify(process.argv.slice(3)))");
 const secret='actual-test-token with "quotes" & % !',name='Player 空格';const script=powershellScript(process.execPath,[probe,result,'__ZH_NAME__','token:__ZH_TOKEN__:__ZH_UUID__'],root,true);
 expect(script).not.toContain(secret);expect(script).not.toContain(name);await writeFile(file,'\ufeff'+script);
 await promisify(execFile)('powershell.exe',['-NoProfile','-NonInteractive','-ExecutionPolicy','Bypass','-File',file],{windowsHide:true,timeout:10000,env:{...process.env,ZHUMENG_ACCESS_TOKEN:secret,ZHUMENG_PLAYER_NAME:name,ZHUMENG_UUID:'id'}});
 expect(JSON.parse(await readFile(result,'utf8'))).toEqual([name,'token:'+secret+':id']);
});

it('rejects malformed nested settings at IPC validation rather than treating null as inheritance',async()=>{
 const {validateSettingsPatch}=await import('../src/shared/settings');
 for(const launch of [null,undefined,[],{width:1},{unknown:true}])expect(()=>validateSettingsPatch({launch})).toThrow();
});
