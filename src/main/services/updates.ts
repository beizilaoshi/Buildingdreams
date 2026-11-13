import type { UpdateChannel, UpdateStatus } from '../../shared/types';
export const RELEASES_API = 'https://api.github.com/repos/beizilaoshi/Buildingdreams/releases?per_page=100';
const prefix = '/beizilaoshi/Buildingdreams/releases/';
function version(value: string): {
    core: number[];
    pre: string[];
} | undefined {
    const match = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/.exec(value);
    if (!match)
        return;
    const core = match.slice(1, 4).map(Number), pre = match[4]?.split('.') ?? [];
    if (core.some(n => !Number.isSafeInteger(n)) || pre.some(p => /^\d+$/.test(p) && p.length > 1 && p[0] === '0'))
        return;
    return { core, pre };
}
export function compareVersions(a: string, b: string): number | null {
    const x = version(a), y = version(b);
    if (!x || !y)
        return null;
    for (let i = 0; i < 3; i++)
        if (x.core[i] !== y.core[i])
            return x.core[i] > y.core[i] ? 1 : -1;
    if (!x.pre.length || !y.pre.length)
        return x.pre.length === y.pre.length ? 0 : !x.pre.length ? 1 : -1;
    for (let i = 0; i < Math.max(x.pre.length, y.pre.length); i++) {
        const p = x.pre[i], q = y.pre[i];
        if (p === q)
            continue;
        if (p === undefined)
            return -1;
        if (q === undefined)
            return 1;
        const pn = /^\d+$/.test(p), qn = /^\d+$/.test(q);
        if (pn && qn)
            return p.length !== q.length ? p.length > q.length ? 1 : -1 : p > q ? 1 : -1;
        if (pn !== qn)
            return pn ? -1 : 1;
        return p > q ? 1 : -1;
    }
    return 0;
}
export function safeReleaseUrl(value: unknown, kind: 'release' | 'download'): string | undefined {
    if (typeof value !== 'string' || value.length > 2048)
        return;
    try {
        const u = new URL(value);
        if (u.protocol !== 'https:' || u.host !== 'github.com' || u.username || u.password || u.search || u.hash || /%|\\/.test(value))
            return;
        const suffix = u.pathname.slice(prefix.length);
        if (!u.pathname.startsWith(prefix))
            return;
        if (!(kind === 'release' ? /^tag\/[A-Za-z0-9.+_-]+$/ : /^download\/[A-Za-z0-9.+_-]+\/Buildingdreams-[A-Za-z0-9.+_-]+-x64-(?:portable|nsis)\.exe$/).test(suffix))
            return;
        return u.href;
    }
    catch {
        return;
    }
}
export class UpdateService {
    private status: UpdateStatus;
    private flight?: Promise<UpdateStatus>;
    constructor(private currentVersion: string, private channel: () => Promise<UpdateChannel>, private fetcher: typeof fetch = fetch, private deadline = 10000) { this.status = { currentVersion, channel: 'preview', state: 'idle' }; }
    async read(): Promise<UpdateStatus> { const channel = await this.channel(); return structuredClone(channel === this.status.channel ? this.status : { currentVersion: this.currentVersion, channel, state: 'idle' }); }
    check(): Promise<UpdateStatus> { if (this.flight)
        return this.flight; this.flight = this.run().finally(() => { this.flight = undefined; }); return this.flight; }
    private async run(): Promise<UpdateStatus> {
        const channel = await this.channel();
        this.status = { currentVersion: this.currentVersion, channel, state: 'checking' };
        const controller = new AbortController();
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
            const releases = await Promise.race([this.load(controller.signal), new Promise<never>((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(Error('更新检查超时')); }, this.deadline); })]);
            let latest: UpdateStatus['latest'];
            for (const raw of releases) {
                if (!raw || typeof raw !== 'object')
                    continue;
                const r = raw as Record<string, unknown>;
                if (r.draft !== false || typeof r.tag_name !== 'string' || typeof r.prerelease !== 'boolean')
                    continue;
                const v = r.tag_name.replace(/^v/, '');
                if (!version(v) || (channel === 'stable' && (r.prerelease || version(v)!.pre.length)) || compareVersions(v, this.currentVersion) !== 1)
                    continue;
                const releaseUrl = safeReleaseUrl(r.html_url, 'release');
                if (!releaseUrl || !releaseUrl.endsWith('/' + r.tag_name))
                    continue;
                if (latest && compareVersions(v, latest.version) !== 1)
                    continue;
                const urls = Array.isArray(r.assets) ? r.assets.map(a => safeReleaseUrl(a?.browser_download_url, 'download')).filter((u): u is string => !!u && u.includes('/download/' + r.tag_name + '/')) : [];
                latest = { version: v, releaseUrl, downloadUrl: urls.find(u => u.endsWith('-portable.exe')) ?? urls[0] };
            }
            this.status = { currentVersion: this.currentVersion, channel, state: latest ? 'available' : 'current', latest, checkedAt: Date.now() };
        }
        catch {
            this.status = { currentVersion: this.currentVersion, channel, state: 'error', checkedAt: Date.now(), error: '无法检查更新，请稍后重试（网络或 GitHub 服务暂不可用）' };
        }
        finally {
            if (timer)
                clearTimeout(timer);
            controller.abort();
        }
        return this.read();
    }
    private async load(signal: AbortSignal): Promise<unknown[]> { const response = await this.fetcher(RELEASES_API, { signal, redirect: 'error', credentials: 'omit', headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' } }); if (!response.ok)
        throw Error('更新服务不可用'); if (Number(response.headers.get('content-length')) > 1048576)
        throw Error('响应过大'); const reader = response.body?.getReader(); if (!reader)
        throw Error('空响应'); let size = 0; const chunks: Uint8Array[] = []; try {
        while (true) {
            const { value, done } = await reader.read();
            if (done)
                break;
            size += value.byteLength;
            if (size > 1048576)
                throw Error('响应过大');
            chunks.push(value);
        }
    }
    finally {
        await reader.cancel().catch(() => { });
    } const result = JSON.parse(Buffer.concat(chunks).toString('utf8')); if (!Array.isArray(result))
        throw Error('无效更新响应'); return result; }
    target(kind: 'release' | 'download'): string { const url = kind === 'release' ? this.status.latest?.releaseUrl : this.status.latest?.downloadUrl; const safe = safeReleaseUrl(url, kind); if (!safe)
        throw Error('没有可用的更新链接'); return safe; }
}
