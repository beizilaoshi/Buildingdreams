import { describe, it, expect } from 'vitest';
import { parseOptifine } from '../src/main/services/optifine';
import { parseLiteLoader } from '../src/main/services/liteloader';
import { validateComponentQuery } from '../src/shared/install-components';
describe('extra component boundary', () => {
    it('rejects traversal and extra IPC fields', () => { expect(() => validateComponentQuery({ kind: 'optifine', minecraft: '../x' })).toThrow(); expect(() => validateComponentQuery({ kind: 'forge', minecraft: '1.20.1' })).toThrow(); expect(() => validateComponentQuery({ kind: 'optifine', minecraft: '1.20.1', url: 'https://evil' })).toThrow(); });
    it('builds optifine urls from validated metadata only', () => { const rows = parseOptifine([{ mcversion: '1.20.1', type: 'HD_U', patch: 'I6', filename: 'OptiFine.jar' }], '1.20.1'); expect(rows[0].id).toBe('HD_U:I6'); expect(rows[0].url).toBe('https://bmclapi2.bangbang93.com/optifine/1.20.1/HD_U/I6'); expect(() => parseOptifine([{ mcversion: '1.20.1', type: '../x', patch: 'I6' }], '1.20.1')).toThrow(); });
    it('validates liteloader fixed tweak and digest', () => { expect(() => parseLiteLoader({ mcversion: '1.12.2', build: { version: '1.12.2-SNAPSHOT', tweakClass: 'evil', md5: 'a'.repeat(32) } }, '1.12.2')).toThrow(); });
});
import { afterEach, vi } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { Version } from '@xmcl/core';
import { InstallComponentService } from '../src/main/services/install-components';
import { TaskService } from '../src/main/services/tasks';
const temp: string[] = [];
afterEach(async () => { await Promise.all(temp.splice(0).map(x => rm(x, { recursive: true, force: true }))); });
async function fixture() { const root = await mkdtemp(join(tmpdir(), 'extra-components-')); temp.push(root); const sourceRoot = join(root, 'source'); await mkdir(join(sourceRoot, 'versions', '1.12.2'), { recursive: true }); await writeFile(join(sourceRoot, 'versions', '1.12.2', '1.12.2.json'), JSON.stringify({ id: '1.12.2', mainClass: 'net.minecraft.client.main.Main', minecraftArguments: '--username ${auth_player_name} --accessToken ${auth_access_token} --gameDir ${game_directory}', libraries: [], type: 'release', time: new Date().toISOString(), releaseTime: new Date().toISOString() })); await writeFile(join(sourceRoot, 'versions', '1.12.2', '1.12.2.jar'), Buffer.from('PK vanilla client')); const source = { id: 'vanilla', name: 'Vanilla', minecraft: '1.12.2', versionId: '1.12.2', resourceDir: sourceRoot, gameDir: join(sourceRoot, 'game'), memoryMb: 2048, javaArgs: [], status: 'ready' }; const bytes = Buffer.from('PK fixture jar'); const tasks = new TaskService(); const registerOwned = vi.fn(async (x) => x); const dependencies = vi.fn(async () => { }); const service: any = { root: join(root, 'managed'), tasks, instances: { get: async () => source, resolve: async () => ({ libraries: [] }), registerOwned }, network: { json: async () => ({ mcversion: '1.12.2', type: 'SNAPSHOT', build: { libraries: [{ name: 'net.minecraft:launchwrapper:1.12' }, { name: 'org.ow2.asm:asm-all:5.2' }], version: '1.12.2-SNAPSHOT', md5: createHash('md5').update(bytes).digest('hex'), tweakClass: 'com.mumfrey.liteloader.launch.LiteLoaderTweaker' } }), response: async () => new Response(bytes) }, validateProfile: vi.fn(), dependencies }; return { root, source, service, tasks, registerOwned, dependencies, components: new InstallComponentService(service, {} as any) }; }
it('publishes an owned independent LiteLoader instance only after dependencies', async () => { const f = await fixture(); const id = f.components.install({ kind: 'liteloader', minecraft: '1.12.2', version: '1.12.2-SNAPSHOT', instanceId: 'vanilla' }); const result: any = await f.tasks.wait(id); expect(result.id).not.toBe(f.source.id); expect(result.resourceDir).not.toBe(f.source.resourceDir); expect(result.gameDir).toBe(join(result.resourceDir, 'game')); expect(f.registerOwned).toHaveBeenCalledOnce(); const profile = JSON.parse(await readFile(join(result.resourceDir, 'versions', result.versionId, result.versionId + '.json'), 'utf8')); expect(profile.inheritsFrom).toBe('1.12.2'); expect(f.dependencies).toHaveBeenCalledOnce(); });
it('rolls back the new root and preserves source on dependency failure', async () => { const f = await fixture(); f.dependencies.mockRejectedValue(Error('dependency failed')); const id = f.components.install({ kind: 'liteloader', minecraft: '1.12.2', version: '1.12.2-SNAPSHOT', instanceId: 'vanilla' }); await expect(f.tasks.wait(id)).rejects.toThrow('dependency failed'); expect(f.registerOwned).not.toHaveBeenCalled(); expect(await readdir(f.service.root)).toEqual([]); expect(JSON.parse(await readFile(join(f.source.resourceDir, 'versions', '1.12.2', '1.12.2.json'), 'utf8')).id).toBe('1.12.2'); });
it('rejects tampered LiteLoader before publication', async () => { const f = await fixture(); f.service.network.response = async () => new Response(Buffer.from('PK tampered')); const id = f.components.save({ kind: 'liteloader', minecraft: '1.12.2', version: '1.12.2-SNAPSHOT' }); await expect(f.tasks.wait(id)).rejects.toThrow('MD5'); expect(await readdir(f.service.root)).toEqual([]); });
import { componentBaseJar } from '../src/main/services/install-components';
it('resolves renamed vanilla and explicit inherited jar paths',async()=>{const root=await mkdtemp(join(tmpdir(),'component-jar-'));temp.push(root);for(const id of ['Renamed','Base']){await mkdir(join(root,'versions',id),{recursive:true});await writeFile(join(root,'versions',id,id+'.json'),JSON.stringify({id}));}expect(await componentBaseJar(root,{inheritances:['Renamed']})).toBe(join(root,'versions','Renamed','Renamed.jar'));await writeFile(join(root,'versions','Renamed','Renamed.json'),JSON.stringify({id:'Renamed',jar:'Base'}));expect(await componentBaseJar(root,{inheritances:['Renamed','Base']})).toBe(join(root,'versions','Base','Base.jar'));await writeFile(join(root,'versions','Renamed','Renamed.json'),JSON.stringify({id:'Renamed',jar:'../escape'}));await expect(componentBaseJar(root,{inheritances:['Renamed']})).rejects.toThrow();});
import { EventEmitter } from 'node:events';
import { ZipFile } from 'yazl';
async function optifineFixture(f:Awaited<ReturnType<typeof fixture>>,failure=false){const zip=new ZipFile();zip.addBuffer(Buffer.from('placeholder'),'optifine/Patcher.class');zip.end();const chunks:Buffer[]=[];for await(const chunk of zip.outputStream)chunks.push(Buffer.from(chunk));const bytes=Buffer.concat(chunks);f.service.network.json=async()=>[{mcversion:'1.12.2',type:'HD_U',patch:'E3'}];f.service.network.response=async()=>new Response(bytes);const java={resolve:vi.fn(async()=>({path:'selected-java.exe'}))};const run=vi.fn((command:string,args:string[],options:unknown)=>{const child=new EventEmitter() as any;child.kill=()=>{setTimeout(()=>child.emit('close',1),0);return true;};setTimeout(async()=>{if(!failure)await writeFile(args.at(-1)!,Buffer.from('PK patched jar'));child.emit('close',failure?7:0);},0);return child;});return {java,run,components:new InstallComponentService(f.service,java as any,async()=>({autoDownloadJava:false}),run as any)};}
it('runs OptiFine patcher with selected Java and shell disabled',async()=>{const f=await fixture();const opt=await optifineFixture(f);const id=opt.components.install({kind:'optifine',minecraft:'1.12.2',version:'HD_U:E3',instanceId:'vanilla'});await f.tasks.wait(id);expect(opt.java.resolve).toHaveBeenCalledOnce();expect(opt.run).toHaveBeenCalledWith('selected-java.exe',expect.arrayContaining(['optifine.Patcher']),expect.objectContaining({shell:false,windowsHide:true,stdio:'ignore'}));expect(f.registerOwned).toHaveBeenCalledOnce();});
it('rolls back OptiFine patcher failure without publishing',async()=>{const f=await fixture();const opt=await optifineFixture(f,true);const id=opt.components.install({kind:'optifine',minecraft:'1.12.2',version:'HD_U:E3',instanceId:'vanilla'});await expect(f.tasks.wait(id)).rejects.toThrow('OptiFine修补失败');expect(f.registerOwned).not.toHaveBeenCalled();expect(await readdir(f.service.root)).toEqual([]);});


it('resolves LiteLoader ASM dependency using Forge Maven through real XMCL parsing', async () => {
    const f = await fixture();
    const task = f.components.install({ kind: 'liteloader', minecraft: '1.12.2', version: '1.12.2-SNAPSHOT', instanceId: 'vanilla' });
    const result: any = await f.tasks.wait(task);
    const resolved = await Version.parse(result.resourceDir, result.versionId);
    expect(resolved.libraries.find(x => x.name === 'org.ow2.asm:asm-all:5.2')?.download.url).toBe('https://maven.minecraftforge.net/org/ow2/asm/asm-all/5.2/asm-all-5.2.jar');
});
it.each(['liteloader', 'optifine'] as const)('publishes %s with its own pinned client jar and preserves source bytes', async kind => {
    const f = await fixture();
    const components = kind === 'optifine' ? (await optifineFixture(f)).components : f.components;
    const sourceJar = join(f.source.resourceDir, 'versions', '1.12.2', '1.12.2.jar');
    const before = await readFile(sourceJar);
    const task = components.install({ kind, minecraft: '1.12.2', version: kind === 'optifine' ? 'HD_U:E3' : '1.12.2-SNAPSHOT', instanceId: 'vanilla' });
    const result: any = await f.tasks.wait(task);
    expect(await readFile(join(result.resourceDir, 'versions', result.versionId, result.versionId + '.jar'))).toEqual(before);
    expect(await readFile(sourceJar)).toEqual(before);
});
it('copies the inherited explicit client jar for a renamed source profile', async () => {
    const f = await fixture();
    f.source.versionId = 'Renamed';
    const directory = join(f.source.resourceDir, 'versions', 'Renamed');
    await mkdir(directory, { recursive: true });
    await writeFile(join(directory, 'Renamed.json'), JSON.stringify({ id: 'Renamed', inheritsFrom: '1.12.2', jar: '1.12.2', libraries: [] }));
    const task = f.components.install({ kind: 'liteloader', minecraft: '1.12.2', version: '1.12.2-SNAPSHOT', instanceId: 'vanilla' });
    const result: any = await f.tasks.wait(task);
    expect(await readFile(join(result.resourceDir, 'versions', result.versionId, result.versionId + '.jar'), 'utf8')).toBe('PK vanilla client');
    expect(await readdir(directory)).toEqual(['Renamed.json']);
    const resolved = await Version.parse(result.resourceDir, result.versionId);
    expect(resolved.arguments.game).toEqual(['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', '--gameDir', '${game_directory}', '--tweakClass', 'com.mumfrey.liteloader.launch.LiteLoaderTweaker']);
});
it('preserves inherited modern game argument rules and placeholders', async () => {
    const f = await fixture();
    const basePath = join(f.source.resourceDir, 'versions', '1.12.2', '1.12.2.json');
    const base = JSON.parse(await readFile(basePath, 'utf8'));
    delete base.minecraftArguments;
    const game = ['--username', '${auth_player_name}', '--accessToken', '${auth_access_token}', '--gameDir', '${game_directory}', { rules: [{ action: 'allow', features: { is_demo_user: true } }], value: '--demo' }];
    base.arguments = { game, jvm: ['-Dexample=${version_name}'] };
    await writeFile(basePath, JSON.stringify(base));
    const task = f.components.install({ kind: 'liteloader', minecraft: '1.12.2', version: '1.12.2-SNAPSHOT', instanceId: 'vanilla' });
    const result: any = await f.tasks.wait(task);
    const resolved = await Version.parse(result.resourceDir, result.versionId);
    expect(resolved.arguments.game).toEqual([...game, '--tweakClass', 'com.mumfrey.liteloader.launch.LiteLoaderTweaker']);
    expect(resolved.arguments.jvm).toEqual(base.arguments.jvm);
});
it('combines LiteLoader with a legacy Forge profile and preserves both tweak arguments', async () => {
 const f=await fixture(); (f.source as any).loader={kind:'forge',version:'14.23.5.2860'};f.source.versionId='Forge';
 await mkdir(join(f.source.resourceDir,'versions','Forge'),{recursive:true});await writeFile(join(f.source.resourceDir,'versions','Forge','Forge.json'),JSON.stringify({id:'Forge',inheritsFrom:'1.12.2',mainClass:'net.minecraft.launchwrapper.Launch',arguments:{game:['--tweakClass','net.minecraftforge.fml.common.launcher.FMLTweaker'],jvm:[]},libraries:[]}));
 f.service.instances.resolve=()=>Version.parse(f.source.resourceDir,'Forge');
 const result:any=await f.tasks.wait(f.components.install({kind:'liteloader',minecraft:'1.12.2',version:'1.12.2-SNAPSHOT',instanceId:'vanilla'}));
 expect(result.loader).toEqual((f.source as any).loader);expect((await Version.parse(result.resourceDir,result.versionId)).arguments.game).toEqual(expect.arrayContaining(['net.minecraftforge.fml.common.launcher.FMLTweaker','com.mumfrey.liteloader.launch.LiteLoaderTweaker']));
});
it('rejects OptiFine Forge combination unless publisher metadata names the exact Forge build', async()=>{
 const f=await fixture();(f.source as any).loader={kind:'forge',version:'14.23.5.2860'};const opt=await optifineFixture(f);await expect(f.tasks.wait(opt.components.install({kind:'optifine',minecraft:'1.12.2',version:'HD_U:E3',instanceId:'vanilla'}))).rejects.toThrow('精确版本');expect(opt.run).not.toHaveBeenCalled();expect(f.registerOwned).not.toHaveBeenCalled();
});
