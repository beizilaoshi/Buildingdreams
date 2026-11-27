import { createHash, randomUUID } from 'node:crypto';
import { mkdir, readFile, rename, writeFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { TokenProtector } from './accounts';
import type { AccountSummary } from '../../shared/types';
import { validateExternalAuthPolicy, type ExternalAuthPolicy } from '../../shared/external-auth';
import type { ExternalServer, ExternalLoginInput, ExternalLoginResult, InjectorStatus } from '../../shared/external-auth';
interface Profile {
    id: string;
    name: string;
}
interface Credential {
    accessToken: string;
    clientToken: string;
    selectedProfile?: Profile;
    availableProfiles: Profile[];
}
interface Stored {
    id: string;
    serverId: string;
    username: string;
    credential: Credential;
    profile: Profile;
    status: 'ready' | 'expired';
}
interface Vault {
    servers: ExternalServer[];
    accounts: Stored[];
}
interface Pending {
    serverId: string;
    username: string;
    credential?: Credential;
    choices: Map<string, Profile>;
    controller: AbortController;
    expires: number;
    phase: 'active' | 'committing';
}
const releaseApi = 'https://api.github.com/repos/yushijinhun/authlib-injector/releases/latest';
function value(v: unknown, max = 8192): string { if (typeof v !== 'string' || !v || v.length > max || /[\0\r\n]/.test(v))
    throw Error('无效外置认证参数'); return v; }
export function externalUrl(raw: string): string { const u = new URL(/^https?:\/\//i.test(raw) ? raw : 'https://' + raw); if (u.protocol !== 'https:' || u.username || u.password || u.hash || u.search || /[\s\0]/.test(u.href))
    throw Error('外置认证地址必须为不含凭据的 HTTPS URL'); return u.href.endsWith('/') ? u.href : u.href + '/'; }
function profile(v: any): Profile { if (!v || !/^[a-f0-9]{32}$/i.test(v.id) || typeof v.name !== 'string' || !v.name || v.name.length > 64 || /[\0\r\n]/.test(v.name))
    throw Error('外置认证角色响应无效'); return { id: v.id.toLowerCase(), name: v.name }; }
function credential(v: any): Credential { return { accessToken: value(v?.accessToken), clientToken: value(v?.clientToken), ...(v.selectedProfile ? { selectedProfile: profile(v.selectedProfile) } : {}), availableProfiles: Array.isArray(v.availableProfiles) ? v.availableProfiles.slice(0, 256).map(profile) : [] }; }
function record(input: unknown, allowed: readonly string[]): Record<string, unknown> {
    if (!input || typeof input !== 'object' || Array.isArray(input) || Object.keys(input).some(key => !allowed.includes(key))) throw Error('无效外置账户记录');
    return input as Record<string, unknown>;
}
function storedProfile(input: unknown): Profile {
    const raw = record(input, ['id', 'name']);
    return profile(raw);
}
function publicServer(server: ExternalServer): ExternalServer {
    return { id: server.id, url: server.url, name: server.name,
        ...(server.homepage ? { homepage: server.homepage } : {}),
        ...(server.registerUrl ? { registerUrl: server.registerUrl } : {}) };
}
function validateVault(input: unknown): Vault {
    const raw = record(input, ['servers', 'accounts']);
    if (!Array.isArray(raw.servers) || !Array.isArray(raw.accounts) || raw.servers.length > 1024 || raw.accounts.length > 4096) throw Error('无效外置账户列表');
    const servers: ExternalServer[] = raw.servers.map(item => {
        const x = record(item, ['id', 'url', 'name', 'homepage', 'registerUrl']);
        const id = value(x.id, 128), url = value(x.url, 2048), name = value(x.name, 128);
        if (!/^[A-Za-z0-9_-]+$/.test(id) || externalUrl(url) !== url) throw Error('无效外置认证服务');
        const server: ExternalServer = { id, url, name };
        for (const key of ['homepage', 'registerUrl'] as const) {
            if (x[key] !== undefined) { const link = value(x[key], 2048); if (externalUrl(link) !== link) throw Error('无效外置认证链接'); server[key] = link; }
        }
        return server;
    });
    if (new Set(servers.map(s => s.id)).size !== servers.length || new Set(servers.map(s => s.url)).size !== servers.length) throw Error('重复外置认证服务');
    const accounts: Stored[] = raw.accounts.map(item => {
        const x = record(item, ['id', 'serverId', 'username', 'credential', 'profile', 'status']);
        const id = value(x.id, 128), serverId = value(x.serverId, 128), username = value(x.username, 256);
        if (!/^external:[a-f0-9-]{36}$/.test(id) || !servers.some(s => s.id === serverId) || !['ready', 'expired'].includes(String(x.status))) throw Error('无效外置账户所有权');
        const player = storedProfile(x.profile), c = record(x.credential, ['accessToken', 'clientToken', 'selectedProfile', 'availableProfiles']);
        if (!Array.isArray(c.availableProfiles) || c.availableProfiles.length > 256) throw Error('无效外置账户角色');
        const selected = storedProfile(c.selectedProfile), available = c.availableProfiles.map(storedProfile);
        if (selected.id !== player.id || selected.name !== player.name || new Set(available.map(p => p.id)).size !== available.length) throw Error('外置账户角色不匹配');
        return { id, serverId, username, profile: player, status: x.status as Stored['status'], credential: { accessToken: value(c.accessToken), clientToken: value(c.clientToken), selectedProfile: selected, availableProfiles: available } };
    });
    if (new Set(accounts.map(a => a.id)).size !== accounts.length || new Set(accounts.map(a => JSON.stringify([a.serverId, a.username, a.profile.id]))).size !== accounts.length) throw Error('重复外置账户');
    return { servers, accounts };
}
export class ExternalAccountService {
    private preparing?: Promise<InjectorStatus>;
    private resolvedUrls = new WeakMap<Response, string>();
    private queue: Promise<unknown> = Promise.resolve();
    private data?: Vault;
    private attempts = new Map<string, Pending>();
    constructor(private file: string, private agentDirectory: string, private protector: TokenProtector, private fetcher: typeof fetch = fetch, private now = Date.now) { }
    private serial<T>(work: () => Promise<T>): Promise<T> { const p = this.queue.then(work); this.queue = p.catch(() => { }); return p; }
    private async load(): Promise<Vault> { if (this.data)
        return this.data; if (!this.protector.isEncryptionAvailable())
        throw Error('系统凭据加密不可用'); try {
        this.data = validateVault(JSON.parse(this.protector.decryptString(await readFile(this.file))));
    }
    catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT')
            throw Error('外置账户保险库无法读取');
        this.data = { servers: [], accounts: [] };
    } return this.data!; }
    private async save(d: Vault, beforeReplace?: () => void) { d = validateVault(d); if (!this.protector.isEncryptionAvailable())
        throw Error('系统凭据加密不可用'); await mkdir(dirname(this.file), { recursive: true }); const t = this.file + '.' + randomUUID() + '.tmp'; try {
        await writeFile(t, this.protector.encryptString(JSON.stringify(d)), { mode: 0o600 });
        beforeReplace?.();
        await rename(t, this.file);
        this.data = d;
    }
    finally {
        await rm(t, { force: true });
    } }
    private summary(a: Stored, d: Vault): AccountSummary { return { id: a.id, name: a.profile.name, uuid: a.profile.id, kind: 'external', status: a.status, providerName: d.servers.find(s => s.id === a.serverId)?.name }; }
    private async response(url: string, init: RequestInit = {}, signal?: AbortSignal): Promise<Response> {
        signal?.throwIfAborted();
        try {
            for (let hop = 0; hop < 6; hop++) {
                const r = await this.fetcher(url, { ...init, redirect: 'manual', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(30000)]) : AbortSignal.timeout(30000) });
                signal?.throwIfAborted();
                if ([301, 302, 303, 307, 308].includes(r.status)) {
                    if (init.method && init.method !== 'GET')
                        throw Error('外置认证凭据请求不允许重定向');
                    const location = r.headers.get('location');
                    if (!location)
                        throw Error('外置认证重定向无效');
                    url = externalUrl(new URL(location, url).href);
                    continue;
                }
                if (!r.ok)
                    throw Error('外置认证请求失败（' + r.status + '）');
                this.resolvedUrls.set(r, url);
                return r;
            }
            throw Error('外置认证重定向次数过多');
        }
        catch (e) {
            signal?.throwIfAborted();
            if (e instanceof Error && e.message.startsWith('外置认证'))
                throw e;
            throw Error('无法连接外置认证服务');
        }
    }
    private async bytes(response: Response, limit: number, signal?: AbortSignal): Promise<Buffer> { const reader = response.body?.getReader(); if (!reader)
        throw Error('外置认证响应为空'); const chunks: Uint8Array[] = []; let size = 0; try {
        while (true) {
            signal?.throwIfAborted();
            const result = await reader.read();
            if (result.done)
                break;
            size += result.value.length;
            if (size > limit)
                throw Error('外置认证响应过大');
            chunks.push(result.value);
        }
        signal?.throwIfAborted();
        return Buffer.concat(chunks, size);
    }
    catch (e) {
        await reader.cancel().catch(() => { });
        throw e;
    }
    finally {
        reader.releaseLock();
    } }
    private async json(r: Response): Promise<any> { const raw = (await this.bytes(r, 1024 * 1024)).toString('utf8'); try {
        return JSON.parse(raw);
    }
    catch {
        throw Error('外置认证响应不是有效 JSON');
    } }
    private async request(s: ExternalServer, path: string, body: unknown, signal?: AbortSignal) { return this.response(s.url + path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }, signal); }
    servers() { return this.serial(async () => (await this.load()).servers.map(publicServer)); }
    list() { return this.serial(async () => { const d = await this.load(); return d.accounts.map(a => this.summary(a, d)); }); }
    owns(id: string) { return id.startsWith('external:'); }
    async addServer(raw: string): Promise<ExternalServer> { value(raw, 2048); let url = externalUrl(raw); let response = await this.response(url); url = externalUrl(this.resolvedUrls.get(response) ?? url); const ali = response.headers.get('X-Authlib-Injector-API-Location'); if (ali) {
        const resolved = externalUrl(new URL(ali, url).href);
        if (resolved !== url) {
            url = resolved;
            response = await this.response(url);
            url = externalUrl(this.resolvedUrls.get(response) ?? url);
        }
    } const metadata = await this.json(response); if (!metadata || typeof metadata !== 'object' || typeof metadata.signaturePublickey !== 'string' || !Array.isArray(metadata.skinDomains))
        throw Error('此地址未提供有效 Yggdrasil 元信息'); const safeLink = (x: unknown) => { try {
        return typeof x === 'string' ? externalUrl(x) : undefined;
    }
    catch {
        return undefined;
    } }; return this.serial(async () => { const d = await this.load(); const existing = d.servers.find(s => s.url === url); if (existing)
        return publicServer(existing); const server: ExternalServer = { id: randomUUID(), url, name: typeof metadata.meta?.serverName === 'string' ? metadata.meta.serverName.slice(0, 128) : new URL(url).host, homepage: safeLink(metadata.meta?.links?.homepage), registerUrl: safeLink(metadata.meta?.links?.register) }; await this.save({ ...d, servers: [...d.servers, server] }); return publicServer(server); }); }
    removeServer(id: string) { return this.serial(async () => { const d = await this.load(); if (d.accounts.some(a => a.serverId === id))
        throw Error('请先移除此服务的账户'); for (const [attemptId, pending] of this.attempts) { if (pending.serverId === id && pending.phase === 'active') { pending.controller.abort(); this.attempts.delete(attemptId); } } await this.save({ ...d, servers: d.servers.filter(s => s.id !== id) }); }); }
    private async server(id: string) { return this.serial(async () => { const s = (await this.load()).servers.find(s => s.id === id); if (!s)
        throw Error('外置认证服务不存在'); return { ...s }; }); }
    private sweep() { for (const [id, p] of this.attempts)
        if (p.expires <= this.now() && p.phase === 'active') {
            p.controller.abort();
            this.attempts.delete(id);
        } }
    async login(input: ExternalLoginInput): Promise<ExternalLoginResult> { this.sweep(); value(input.username, 256); value(input.password, 1024); const id = input.attemptId ?? randomUUID(); value(id, 128); if (this.attempts.has(id))
        throw Error('登录请求已存在'); const pending: Pending = { serverId: input.serverId, username: input.username, choices: new Map(), controller: new AbortController(), expires: this.now() + 300000, phase: 'active' }; this.attempts.set(id, pending); try {
        const s = await this.server(input.serverId);
        this.assertAttempt(id, pending);
        const c = credential(await this.json(await this.request(s, 'authserver/authenticate', { username: input.username, password: input.password, clientToken: randomUUID().replaceAll('-', ''), requestUser: true, agent: { name: 'Minecraft', version: 1 } }, pending.controller.signal)));
        this.assertAttempt(id, pending);
        pending.credential = c;
        if (c.selectedProfile) {
            const account = await this.commit(id, pending, c, c.selectedProfile);
            return { status: 'completed', account };
        }
        if (!c.availableProfiles.length)
            throw Error('此账户尚未创建游戏角色');
        for (const p of c.availableProfiles)
            pending.choices.set(randomUUID(), p);
        return { status: 'select', attemptId: id, profiles: [...pending.choices].map(([id, p]) => ({ id, name: p.name })) };
    }
    catch (e) {
        this.attempts.delete(id);
        throw e;
    } }
    private assertAttempt(id: string, p: Pending) { p.controller.signal.throwIfAborted(); if (this.attempts.get(id) !== p || (p.phase === 'active' && p.expires <= this.now()))
        throw Error('登录已取消或过期'); }
    async selectProfile(input: {
        attemptId: string;
        profileId: string;
    }): Promise<AccountSummary> { this.sweep(); const p = this.attempts.get(input.attemptId); if (!p?.credential)
        throw Error('登录已取消或过期'); const selected = p.choices.get(input.profileId); if (!selected)
        throw Error('所选角色不属于此次登录'); const s = await this.server(p.serverId); const c = credential(await this.json(await this.request(s, 'authserver/refresh', { accessToken: p.credential.accessToken, clientToken: p.credential.clientToken, selectedProfile: selected, requestUser: true }, p.controller.signal))); if (c.selectedProfile?.id !== selected.id)
        throw Error('服务器返回了其他角色'); return this.commit(input.attemptId, p, c, c.selectedProfile); }
    private async commit(id: string, p: Pending, c: Credential, selected: Profile) {
        // This synchronous phase change is the cancellation/commit linearization point.
        // Once claimed, cancel() cannot delete the attempt while the serialized atomic
        // vault replacement is in flight. If persistence fails, the attempt is reusable.
        this.assertAttempt(id, p);
        if (p.phase !== 'active') throw Error('登录请求正在保存');
        p.phase = 'committing';
        try {
            return await this.serial(async () => {
                this.assertAttempt(id, p);
                const d = await this.load();
                if (!d.servers.some(s => s.id === p.serverId)) throw Error('外置认证服务已移除');
                const previous = d.accounts.find(a => a.serverId === p.serverId && a.username === p.username && a.profile.id === selected.id);
                const a: Stored = { id: previous?.id ?? 'external:' + randomUUID(), serverId: p.serverId, username: p.username, credential: c, profile: selected, status: 'ready' };
                await this.save({ ...d, accounts: [...d.accounts.filter(x => x.id !== a.id), a] });
                this.attempts.delete(id);
                return this.summary(a, this.data!);
            });
        }
        catch (error) {
            if (this.attempts.get(id) === p && !p.controller.signal.aborted) p.phase = 'active';
            throw error;
        }
    }
    async cancel(id: string) { const p = this.attempts.get(id); if (p?.phase === 'committing') return; p?.controller.abort(); this.attempts.delete(id); }
    private snapshot(id: string) { return this.serial(async () => { const d = await this.load(); const a = d.accounts.find(a => a.id === id), s = d.servers.find(s => s.id === a?.serverId); if (!a || !s)
        throw Error('外置账户不存在'); return { a: structuredClone(a), s: { ...s } }; }); }
    private sameCredential(left: Credential, right: Credential) { return left.accessToken === right.accessToken && left.clientToken === right.clientToken; }
    private async setStatusIfCurrent(id: string, snapshot: Stored, status: Stored['status'], signal?: AbortSignal) { return this.serial(async () => {
        signal?.throwIfAborted();
        const d = await this.load();
        const current = d.accounts.find(x => x.id === id);
        if (!current || !this.sameCredential(current.credential, snapshot.credential) || current.status === status) return;
        const updated = { ...current, status };
        await this.save({ ...d, accounts: d.accounts.map(x => x.id === id ? updated : x) }, () => signal?.throwIfAborted());
    }); }
    private isAuthorizationRejection(error: unknown) { return error instanceof Error && /外置认证请求失败（40[13]）/.test(error.message); }
    async validate(id: string, signal?: AbortSignal): Promise<boolean> { const { a, s } = await this.snapshot(id); try {
        await this.request(s, 'authserver/validate', { accessToken: a.credential.accessToken, clientToken: a.credential.clientToken }, signal);
        await this.setStatusIfCurrent(id, a, 'ready', signal);
        return true;
    }
    catch (e) {
        if (this.isAuthorizationRejection(e)) {
            await this.setStatusIfCurrent(id, a, 'expired', signal);
            return false;
        }
        throw e;
    } }
    async refresh(id: string, signal?: AbortSignal): Promise<AccountSummary> {
        const { a, s } = await this.snapshot(id);
        let c: Credential;
        try {
            c = credential(await this.json(await this.request(s, 'authserver/refresh', { accessToken: a.credential.accessToken, clientToken: a.credential.clientToken, requestUser: true }, signal)));
        }
        catch (error) {
            if (this.isAuthorizationRejection(error)) await this.setStatusIfCurrent(id, a, 'expired', signal);
            throw error;
        }
        if (c.selectedProfile?.id !== a.profile.id) throw Error('账户角色已改变，请重新登录');
        return this.serial(async () => {
            signal?.throwIfAborted();
            const d = await this.load();
            const current = d.accounts.find(x => x.id === id);
            if (!current || !this.sameCredential(current.credential, a.credential)) throw Error('账户已更改');
            const updated = { ...current, credential: c, profile: c.selectedProfile!, status: 'ready' as const };
            await this.save({ ...d, accounts: d.accounts.map(x => x.id === id ? updated : x) });
            return this.summary(updated, this.data!);
        });
    }
    // The password is used once for protocol signout, never retained in the vault.
    async signout(input: {
        id: string;
        password: string;
    }): Promise<void> { value(input.password, 1024); const { a, s } = await this.snapshot(input.id); await this.request(s, 'authserver/signout', { username: a.username, password: input.password }); await this.serial(async () => { const d = await this.load(); await this.save({ ...d, accounts: d.accounts.filter(x => x.serverId !== a.serverId || x.username !== a.username) }); }); }
    remove(id: string) { return this.serial(async () => { const d = await this.load(); await this.save({ ...d, accounts: d.accounts.filter(a => a.id !== id) }); }); }
    async appearance(id: string) { await this.snapshot(id); return { accountId: id, source: 'default' as const, reason: 'unavailable' as const }; }
    private async verified() { const m = JSON.parse(await readFile(join(this.agentDirectory, 'verified.json'), 'utf8')); if (typeof m.version !== 'string' || !/^[a-f0-9]{64}$/.test(m.sha256))
        throw Error(); const path = join(this.agentDirectory, 'authlib-injector-' + m.sha256 + '.jar'); const bytes = await readFile(path); if (bytes.length > 32 * 1024 * 1024 || createHash('sha256').update(bytes).digest('hex') !== m.sha256)
        throw Error(); return { status: { ready: true, version: m.version, sha256: m.sha256 } as InjectorStatus, path }; }
    async injectorStatus(): Promise<InjectorStatus> { try {
        return (await this.verified()).status;
    }
    catch {
        return { ready: false };
    } }
    prepareInjector(signal?: AbortSignal): Promise<InjectorStatus> { if (this.preparing)
        return this.preparing; const work = this.downloadInjector(signal); this.preparing = work; void work.finally(() => { if (this.preparing === work)
        this.preparing = undefined; }).catch(() => { }); return work; }
    private async downloadInjector(signal?: AbortSignal): Promise<InjectorStatus> {
        const r = await this.response(releaseApi, { headers: { 'accept': 'application/vnd.github+json' } }, signal);
        const release = await this.json(r);
        const asset = release.assets?.find((a: any) => /^authlib-injector-[\d.]+\.jar$/.test(a.name));
        if (!asset || typeof release.tag_name !== 'string' || !/^v?[0-9][0-9.]{0,40}$/.test(release.tag_name) || !/^sha256:[a-f0-9]{64}$/.test(asset.digest) || !String(asset.browser_download_url).startsWith('https://github.com/yushijinhun/authlib-injector/releases/download/'))
            throw Error('官方发布缺少可信 SHA-256 校验信息');
        let url = asset.browser_download_url;
        let response: Response | undefined;
        for (let hop = 0; hop < 6; hop++) {
            signal?.throwIfAborted();
            const u = new URL(url);
            if (u.protocol !== 'https:' || u.username || u.password || !['github.com', 'release-assets.githubusercontent.com', 'objects.githubusercontent.com'].includes(u.hostname))
                throw Error('官方注入组件重定向不受信任');
            const next = await this.fetcher(url, { redirect: 'manual', credentials: 'omit', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(120000)]) : AbortSignal.timeout(120000) });
            if ([301, 302, 303, 307, 308].includes(next.status)) {
                const location = next.headers.get('location');
                if (!location)
                    throw Error('官方注入组件下载重定向无效');
                url = new URL(location, url).href;
                continue;
            }
            response = next;
            break;
        }
        if (!response?.ok)
            throw Error('官方注入组件下载失败');
        const bytes = await this.bytes(response, 32 * 1024 * 1024, signal);
        if (bytes.length < 4 || bytes.readUInt32LE(0) !== 0x04034b50)
            throw Error('官方注入组件格式无效');
        const sha256 = createHash('sha256').update(bytes).digest('hex');
        if ('sha256:' + sha256 !== asset.digest)
            throw Error('官方注入组件 SHA-256 校验失败');
        signal?.throwIfAborted();
        await mkdir(this.agentDirectory, { recursive: true });
        const temporary = join(this.agentDirectory, randomUUID() + '.tmp'), manifest = join(this.agentDirectory, randomUUID() + '.json.tmp');
        try {
            await writeFile(temporary, bytes);
            signal?.throwIfAborted();
            await rename(temporary, join(this.agentDirectory, 'authlib-injector-' + sha256 + '.jar'));
            await writeFile(manifest, JSON.stringify({ version: release.tag_name, sha256 }));
            signal?.throwIfAborted();
            await rename(manifest, join(this.agentDirectory, 'verified.json'));
        }
        finally {
            await Promise.all([rm(temporary, { force: true }), rm(manifest, { force: true })]);
        }
        return this.injectorStatus();
    }
    async assertPolicy(id: string, policy?: ExternalAuthPolicy): Promise<void> { if (!policy)
        return; const valid = validateExternalAuthPolicy(policy); if (valid.kind === 'any')
        return; if (!this.owns(id))
        throw Error('此实例必须使用指定外置认证服务器的账户'); const { a } = await this.snapshot(id); if (a.serverId !== valid.serverId)
        throw Error('此实例必须使用指定外置认证服务器的账户'); await this.server(valid.serverId); }
    async getLaunchIdentity(id: string, signal?: AbortSignal): Promise<{
        name: string;
        uuid: string;
        accessToken: string;
        extraJvmArgs: string[];
        userType: 'mojang';
    }> {
        let agent: {
            path: string;
        };
        try {
            agent = await this.verified();
        }
        catch {
            throw Error('请在外置账户管理中先准备并校验 authlib-injector');
        }
        if (!await this.validate(id, signal))
            await this.refresh(id, signal);
        const { a, s } = await this.snapshot(id);
        signal?.throwIfAborted();
        const metadata = await this.json(await this.response(s.url, {}, signal));
        const extraJvmArgs = ['-javaagent:' + agent.path + '=' + s.url], raw = JSON.stringify(metadata);
        if (Buffer.byteLength(raw) <= 4096)
            extraJvmArgs.push('-Dauthlibinjector.yggdrasil.prefetched=' + Buffer.from(raw).toString('base64'));
        return { name: a.profile.name, uuid: a.profile.id, accessToken: a.credential.accessToken, userType: 'mojang', extraJvmArgs };
    }
}
