import { InstallerSaveService } from './installer-save';
import { randomUUID, createHash } from 'node:crypto';
import { cp, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { Version } from '@xmcl/core';
import { generateOptifineVersion } from '@xmcl/installer';
import { open, readAllEntries, readEntry } from '@xmcl/unzip';
import type { ComponentQuery, ComponentSelection, ComponentVersion } from '../../shared/install-components';
import { componentSegment } from '../../shared/install-components';
import { parseOptifine } from './optifine';
import { parseLiteLoader } from './liteloader';
import { InstallService, versionSegment } from './install';
import { JavaService } from './java';
import { contained, safeDestination } from './network';
import type { TaskContext } from './tasks';
import { globalDownloadScheduler } from './download-scheduler';
const BASE = 'https://bmclapi2.bangbang93.com';
export async function componentBaseJar(root: string, version: Pick<import('@xmcl/core').ResolvedVersion, 'inheritances'>): Promise<string> {
    let jar = version.inheritances.at(-1);
    for (const id of version.inheritances) {
        const raw = JSON.parse(await readFile(contained(root, `versions/${versionSegment(id)}/${versionSegment(id)}.json`), 'utf8'));
        if (raw.jar !== undefined) { jar = versionSegment(raw.jar); break; }
    }
    if (!jar) throw Error('找不到原版游戏 JAR');
    return contained(root, `versions/${versionSegment(jar)}/${versionSegment(jar)}.jar`);
}
async function copyTree(source: string, target: string, signal: AbortSignal): Promise<void> { signal.throwIfAborted(); const st = await lstat(source); if (st.isSymbolicLink())
    throw Error('组件安装资源不能包含链接'); if (st.isDirectory())
    for (const e of await readdir(source)) {
        await copyTree(join(source, e), join(target, e), signal);
    }
else if (!st.isFile())
    throw Error('无效实例资源'); if (st.isDirectory())
    await mkdir(target, { recursive: true });
else {
    await mkdir(join(target, '..'), { recursive: true });
    await cp(source, target, { force: false, errorOnExist: true });
} }
export class InstallComponentService {
    constructor(private installService: InstallService, private java: JavaService, private defaults: () => Promise<{
        javaPath?: string;
        autoDownloadJava?: boolean;
    }> = async () => ({}), private spawnJava: typeof spawn = spawn) { }
    saveInstaller(query: import('../../shared/install-components').InstallerSaveQuery, destination?: string): string { return new InstallerSaveService(this.installService).save(query,destination); }
    forgePromotions(minecraft: string) { return new InstallerSaveService(this.installService).promotions(minecraft); }
    async versions(query: ComponentQuery, signal?: AbortSignal): Promise<ComponentVersion[]> { const minecraft = componentSegment(query.minecraft); if (query.kind === 'optifine')
        return parseOptifine(await this.installService.network.json(`${BASE}/optifine/${encodeURIComponent(minecraft)}`, signal), minecraft); if (query.kind !== 'liteloader')
        throw Error('不支持的组件'); return parseLiteLoader(await this.installService.network.json(`${BASE}/liteloader/list?mcversion=${encodeURIComponent(minecraft)}`, signal), minecraft); }
    private async selected(query: ComponentSelection, signal: AbortSignal) { const row = (await this.versions(query, signal)).find(x => x.id === query.version); if (!row)
        throw Error('组件版本不支持此 Minecraft'); return row; }
    private async artifact(root: string, row: ComponentVersion, context: TaskContext): Promise<string> {
        const release = await globalDownloadScheduler.acquire(context.signal);
        try { return await this.artifactDownload(root, row, context); } finally { release(); }
    }
    private async artifactDownload(root: string, row: ComponentVersion, context: TaskContext): Promise<string> { const path = await safeDestination(root, `installers/${row.filename}`); await mkdir(join(root, 'installers'), { recursive: true }); const response = await this.installService.network.response(row.url, context.signal); const reader = response.body?.getReader(); if (!reader)
        throw Error('安装器响应为空'); const chunks: Buffer[] = []; let bytes = 0; try {
        for (;;) {
            context.signal.throwIfAborted();
            const part = await reader.read();
            if (part.done)
                break;
            bytes += part.value.length;
            if (bytes > 64 * 1024 * 1024)
                throw Error('安装器超过64MB限制');
            await globalDownloadScheduler.consume(part.value.length, context.signal);
            chunks.push(Buffer.from(part.value));
            context.report(Math.min(.8, bytes / (Number(response.headers.get('content-length')) || 64 * 1024 * 1024)));
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    } const data = Buffer.concat(chunks); if (data[0] !== 80 || data[1] !== 75)
        throw Error('安装器不是有效JAR'); if (row.md5 && createHash('md5').update(data).digest('hex') !== row.md5)
        throw Error('LiteLoader MD5校验失败'); context.signal.throwIfAborted(); await writeFile(path, data, { flag: 'wx' }); await writeFile(`${path}.provenance.json`, JSON.stringify({ source: row.url, sha256: createHash('sha256').update(data).digest('hex'), publisherDigest: row.md5 ?? null, notice: row.md5 ? '历史MD5仅用于传输校验' : '来源未发布校验值；SHA256为本地下载记录', downloadedAt: new Date().toISOString() }, null, 2), { flag: 'wx' }); context.signal.throwIfAborted(); return path; }
    save(query: ComponentSelection): string { const root = contained(this.installService.root, `component-download-${randomUUID()}`); return this.installService.tasks.start(`保存 ${query.kind} 安装器 → ${root}`, async (context) => { try {
        const row = await this.selected(query, context.signal);
        return await this.artifact(root, row, context);
    }
    catch (e) {
        await rm(root, { recursive: true, force: true });
        throw e;
    } }); }
    install(query: ComponentSelection & {
        instanceId: string;
    }): string { return this.installService.tasks.start(`安装 ${query.kind}（新建独立实例）`, async (context) => { const service = this.installService; const source = await service.instances.get(query.instanceId); if (source.minecraft !== query.minecraft)
        throw Error('组件与实例Minecraft版本不匹配'); if (source.loader && (source.loader.kind !== 'forge' || !/^1\.(7\.10|8(?:\.[0-9]+)?|9(?:\.[0-9]+)?|10(?:\.[0-9]+)?|11(?:\.[0-9]+)?|12(?:\.[0-9]+)?)$/.test(source.minecraft)))
        throw Error('组合安装目前仅支持 Minecraft 1.7.10–1.12.2 的 Forge 实例'); const resolved = await service.instances.resolve(source.id); if (resolved.libraries.some(x => /optifine|liteloader/i.test(x.name)))
        throw Error('请从原版实例安装组件'); const row = await this.selected(query, context.signal); if (source.loader && row.kind === 'optifine' && (!row.forge || row.forge !== source.loader.version)) throw Error('此 OptiFine 未声明支持所选 Forge 精确版本，请选择匹配版本'); if (source.loader && resolved.mainClass !== 'net.minecraft.launchwrapper.Launch') throw Error('组合安装需要 Forge LaunchWrapper 启动配置'); const root = contained(service.root, randomUUID()); try {
        await mkdir(root, { recursive: true });
        for (const folder of ['versions', 'libraries', 'assets']) {
            try {
                await copyTree(join(source.resourceDir, folder), join(root, folder), context.signal);
            }
            catch (e) {
                if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
                    throw e;
            }
        }
        await mkdir(join(root, 'game'), { recursive: true });
        const artifact = await this.artifact(root, row, context);
        const id = versionSegment(`${source.minecraft}-${row.kind}-${randomUUID()}`);
        const profile = row.kind === 'optifine' ? await this.optifine(root, artifact, row, id, source, context) : await this.lite(root, artifact, row, id, source.versionId);
        service.validateProfile(profile, id);
        await mkdir(contained(root, `versions/${id}`), { recursive: true });
        const clientJar = await componentBaseJar(root, await Version.parse(root, source.versionId));
        context.signal.throwIfAborted();
        await cp(clientJar, contained(root, `versions/${id}/${id}.jar`), { force: false, errorOnExist: true });
        await writeFile(contained(root, `versions/${id}/${id}.json`), JSON.stringify(profile, null, 2));
        const version = await Version.parse(root, id);
        if (version.minecraftVersion !== source.minecraft)
            throw Error('组件继承错误版本');
        const local = new Set<string>(source.loader ? resolved.libraries.filter(x => /^(net\.minecraftforge|net\.minecraft):/.test(x.name) && !x.download.sha1).map(x => x.download.path) : []);
        for (const l of version.libraries)
            if (/^(optifine|com.mumfrey):/.test(l.name))
                local.add(l.download.path);
        await service.dependencies(version, context, local);
        context.signal.throwIfAborted();
        return await service.instances.registerOwned({ ...source, id: randomUUID(), name: `${source.name.slice(0, 60)} ${row.kind} ${row.id.replace(':', '_')}`.slice(0, 120), versionId: id, resourceDir: root, gameDir: join(root, 'game'), loader: source.loader }, context.signal);
    }
    catch (e) {
        await rm(root, { recursive: true, force: true });
        throw e;
    } }); }
    private async lite(root: string, artifact: string, row: ComponentVersion, id: string, parent: string) { const library = `com/mumfrey/liteloader/${row.id}/liteloader-${row.id}.jar`; await mkdir(contained(root, `libraries/com/mumfrey/liteloader/${row.id}`), { recursive: true }); await cp(artifact, contained(root, 'libraries/' + library)); return { id, inheritsFrom: parent, mainClass: 'net.minecraft.launchwrapper.Launch', arguments: { game: ['--tweakClass', 'com.mumfrey.liteloader.launch.LiteLoaderTweaker'], jvm: [] }, libraries: [{ name: `com.mumfrey:liteloader:${row.id}`, downloads: { artifact: { url: row.url, path: library } } }, ...(row.libraries ?? ['net.minecraft:launchwrapper:1.12', 'org.ow2.asm:asm-all:5.2']).map(name => ({ name, ...(name.startsWith('org.ow2.asm:') ? { url: 'https://maven.minecraftforge.net/' } : {}) }))] }; }
    private async optifine(root: string, artifact: string, row: ComponentVersion, id: string, source: import('../../shared/types').Instance, context: TaskContext) { const zip = await open(artifact); try {
        const entries = await readAllEntries(zip);
        if (entries.length > 30000 || entries.reduce((n, e) => n + e.uncompressedSize, 0) > 512 * 1024 * 1024)
            throw Error('OptiFine安装器解压大小超限');
        const text = entries.find(x => x.fileName === 'launchwrapper-of.txt');
        if (text && text.uncompressedSize > 128)
            throw Error('无效OptiFine启动器版本');
        const wrapper = text ? componentSegment((await readEntry(zip, text)).toString().trim()) : undefined;
        const [edition, patch] = row.id.split(':');
        const profile = generateOptifineVersion(`${edition}_${patch}`, row.minecraft, wrapper, { versionId: id, inheritsFrom: source.versionId, useForgeTweaker: source.loader?.kind === 'forge' });
        if (wrapper) {
            const entry = entries.find(x => x.fileName === `launchwrapper-of-${wrapper}.jar`);
            if (!entry || entry.uncompressedSize > 16 * 1024 * 1024)
                throw Error('缺少OptiFine启动器');
            const path = contained(root, `libraries/optifine/launchwrapper-of/${wrapper}/launchwrapper-of-${wrapper}.jar`);
            await mkdir(join(path, '..'), { recursive: true });
            await writeFile(path, await readEntry(zip, entry));
        }
        const path = contained(root, `libraries/optifine/Optifine/${row.minecraft}_${edition}_${patch}/Optifine-${row.minecraft}_${edition}_${patch}.jar`);
        await mkdir(join(path, '..'), { recursive: true });
        const defaults = await this.defaults();
        const runtime = await this.java.resolve({ minecraft: row.minecraft, optifine: true }, { manualPath: source.javaPath ?? defaults.javaPath, memoryMb: source.memoryMb, autoDownload: defaults.autoDownloadJava !== false, context, roots: [root], ownerScope: root });
        const baseJar = await componentBaseJar(root, await Version.parse(root, source.versionId));
        await new Promise<void>((resolve, reject) => { context.signal.throwIfAborted(); const child = this.spawnJava(runtime.path, ['-cp', artifact, 'optifine.Patcher', baseJar, artifact, path], { cwd: root, shell: false, windowsHide: true, stdio: 'ignore' }); const abort = () => child.kill(); context.signal.addEventListener('abort', abort, { once: true }); child.once('error', reject); child.once('close', code => { context.signal.removeEventListener('abort', abort); if (context.signal.aborted)
            reject(context.signal.reason);
        else if (code !== 0)
            reject(Error(`OptiFine修补失败 (${code})`));
        else
            resolve(); }); });
        const info = await lstat(path);
        if (!info.isFile() || info.size < 1 || info.size > 128 * 1024 * 1024)
            throw Error('OptiFine修补输出无效');
        return profile;
    }
    finally {
        zip.close();
    } }
}
