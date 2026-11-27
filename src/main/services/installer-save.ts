import { randomUUID } from 'node:crypto';
import { constants as fsConstants } from 'node:fs';
import { copyFile, lstat, mkdir, readFile, rename, rm } from 'node:fs/promises';
import { basename, dirname, isAbsolute } from 'node:path';
import { InstallService, versionSegment } from './install';
import { contained } from './network';
import type { InstallerSaveQuery } from '../../shared/install-components';
import type { TaskContext } from './tasks';
export class InstallerSaveService {
    constructor(private service: InstallService) {}
    async promotions(minecraft: string) {
        versionSegment(minecraft);
        const raw = await this.service.network.json<{ promos: Record<string, unknown> }>('https://files.minecraftforge.net/net/minecraftforge/forge/promotions_slim.json');
        if (!raw?.promos || typeof raw.promos !== 'object') throw Error('无效Forge推荐清单');
        const result: {recommended?: string; latest?: string; changelog: string} = { changelog: `https://files.minecraftforge.net/net/minecraftforge/forge/index_${encodeURIComponent(minecraft)}.html` };
        for (const key of ['recommended', 'latest'] as const) { const value = raw.promos[`${minecraft}-${key}`]; if (value !== undefined) result[key] = versionSegment(String(value)); }
        return result;
    }
    save(query: InstallerSaveQuery, destination?: string): string {
        if (destination !== undefined && (!isAbsolute(destination) || basename(destination).length < 5 || basename(destination).length > 240 || !/\.jar$/i.test(destination))) throw Error('请选择有效的 JAR 保存路径');
        return this.service.tasks.start(`保存 ${query.kind}${destination ? ` → ${destination}` : '（仅下载文件）'}`, async context => {
            const root = contained(this.service.root, `installer-download-${randomUUID()}`);
            try {
                await mkdir(root, {recursive:true});
                const artifact = await this.artifact(query, root, context);
                context.signal.throwIfAborted();
                if (destination) {
                    await mkdir(dirname(destination), {recursive:true});
                    try { const existing = await lstat(destination); if (existing.isSymbolicLink() || !existing.isFile()) throw Error('目标不是普通文件，已停止保存'); }
                    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
                    const temporary = `${destination}.${randomUUID()}.tmp`;
                    try { await copyFile(artifact, temporary, fsConstants.COPYFILE_EXCL); context.signal.throwIfAborted(); await rename(temporary, destination); }
                    finally { await rm(temporary,{force:true}).catch(()=>{}); }
                    return destination;
                }
                return artifact;
            } finally { await rm(root,{recursive:true,force:true}); }
        });
    }
    private async artifact(q: InstallerSaveQuery, root: string, context: TaskContext): Promise<string> {
        const network = this.service.network; let url: string; let sha1: string | undefined; let size: number | undefined;
        if (q.kind === 'server') {
            const meta = (await this.service.versions(context.signal)).find(x => x.id === q.minecraft);
            if (!meta) throw Error('Minecraft版本不存在');
            await network.download(root, {url:meta.url,sha1:meta.sha1,path:'metadata.json'}, context);
            const raw = JSON.parse(await readFile(contained(root,'metadata.json'),'utf8'));
            if (raw.id !== q.minecraft) throw Error('服务端元数据版本不匹配');
            const server = raw.downloads?.server;
            if (!server || !/^[a-f0-9]{40}$/i.test(server.sha1)) throw Error('此Minecraft版本没有带校验值的原版服务端');
            ({url,sha1,size} = server);
        } else if (q.kind === 'fabric' || q.kind === 'quilt') {
            const quilt = q.kind === 'quilt';
            const rows = await network.json<any[]>(quilt ? 'https://meta.quiltmc.org/v3/versions/installer' : 'https://meta.fabricmc.net/v2/versions/installer', context.signal);
            if (!Array.isArray(rows) || rows.length > 1000) throw Error('无效安装器清单');
            const row = rows.find(x => x.version === q.version); if (!row) throw Error('安装器版本不存在（版本栏应填写安装器版本）');
            const base = quilt ? 'https://maven.quiltmc.org/repository/release/org/quiltmc/quilt-installer/' : 'https://maven.fabricmc.net/net/fabricmc/fabric-installer/';
            const name = quilt ? 'quilt-installer' : 'fabric-installer';
            url = `${base}${q.version}/${name}-${q.version}.jar`;
            if (row.url !== url) throw Error('安装器地址与官方坐标不符');
            sha1 = quilt ? row.hashes?.sha1 : undefined;
        } else {
            const forge = q.kind === 'forge'; const project = forge || q.minecraft === '1.20.1' ? 'forge' : 'neoforge';
            const version = forge ? `${q.minecraft}-${q.version}` : q.version;
            const group = forge ? 'net/minecraftforge' : 'net/neoforged';
            url = `${forge ? 'https://maven.minecraftforge.net/' : 'https://maven.neoforged.net/releases/'}${group}/${project}/${version}/${project}-${version}-installer.jar`;
        }
        network.validateUrl(url);
        sha1 ??= (await (await network.response(url + '.sha1', context.signal)).text()).trim().split(/\s/)[0];
        if (!/^[a-f0-9]{40}$/i.test(sha1)) throw Error('文件缺少有效官方SHA1');
        const filename = q.kind === 'server' ? `minecraft-server-${q.minecraft}.jar` : `${q.kind}-installer-${q.version}.jar`;
        await network.download(root, {url,sha1,size,path:filename}, context);
        return contained(root, filename);
    }
}
