import { javaSelectionMemory, launchMemory, renderWindowTitle, launcherLifecycleAction } from './launch-advanced';
import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { generateArguments } from "@xmcl/core";
import { buildLaunchOptions, powershellScript } from "./launch-options";
import { effectiveLaunchSettings, type LaunchSettings } from "../../shared/launch-settings";
import { waitForGameWindow, type WindowDetector } from "./launch-window";
import { preCommand, applyCosmetics } from "./launch-helpers";
import type { LaunchState } from "../../shared/types";
interface Owned {
    lease?: string;
    releasePromise?: Promise<void>;
    spawnAttempted?: boolean;
    leaseChild?: ChildProcess;
    controller: AbortController;
    helperController: AbortController;
    child?: ChildProcess;
    helpers: Set<ChildProcess>;
    /** Ends this attempt's lease exactly once; safe to call from any handler. */
    release?: () => Promise<void>;
    /** Lease id owned by this attempt (set right after beginLaunch). */
    attempt?: string;
    marker?: string;
    preferences?: LaunchSettings;
    promise?: Promise<{
        pid: number;
    }>;
}
import { mkdir, readFile, writeFile, lstat, mkdtemp, rename, rm, realpath } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { join, dirname, relative, sep, resolve, isAbsolute } from "node:path";
import { EventEmitter } from "node:events";
import { freemem, totalmem } from "node:os";
import { launch as xmclLaunch, Version, type LaunchOption, type ResolvedVersion } from "@xmcl/core";
import type { InstanceService } from "./instances";
import type { JavaService } from "./java";
import type { TaskService } from "./tasks";
import { contained, safeDestination, type DownloadSpec, type NetworkService } from "./network";
import type { LaunchEvent } from "../../shared/types";
import { verifyLaunchMarker, type LeaseProcessResult } from './lease-recovery';
export interface LaunchAccount {
    name: string;
    uuid: string;
    accessToken: string;
    /** Trusted main-only authentication provider; never accepted over renderer IPC. */
    extraJvmArgs?: string[];
    userType?: 'mojang' | 'legacy';
}
export type AccountProvider = (id: string, signal?: AbortSignal, policy?: import('../../shared/external-auth').ExternalAuthPolicy) => Promise<LaunchAccount>;
/** Only main-resolved official sources: never trust URLs from version metadata blindly. */
const OFFICIAL_DOWNLOAD = /^https:\/\/((piston|piston-data|piston-meta|launcher|launchermeta|resources)\.mojang\.com|resources\.download\.minecraft\.net|libraries\.minecraft\.net)\//i;
/**
 * XMCL maps a resolved version's `minecraftVersion` to `versions/<that>/<that>.jar`.
 * For a version-isolated profile (`versions/1.20.4-Fabric 0.18.4`) that clientVersion
 * is the parent vanilla id, whose directory usually does not exist, so the jar check
 * and classpath point at a file nobody ships. Pinning it to the profile id keeps the
 * launcher's own directory while leaving `clientVersion` untouched for Java planning.
 */
export function pinVersionJar<T extends { id: string; minecraftVersion: string }>(version: T): T {
    if (version.minecraftVersion === version.id)
        return version;
    Object.defineProperty(version, 'minecraftVersion', { value: version.id, enumerable: true, configurable: true, writable: true });
    return version;
}
const REPAIR_LIMIT = 3000;
/** Resolve a metadata Maven coordinate when a profile omits its download block. */
function mavenLibraryPath(coordinate: string): string | undefined {
    const parts = coordinate.split(':');
    if (parts.length < 3 || parts.length > 4) return;
    const [group, artifact, version, classifier] = parts;
    if (!/^[A-Za-z0-9_-]+(?:\.[A-Za-z0-9_-]+)*$/.test(group)
        || !/^[A-Za-z0-9_.+-]+$/.test(artifact) || artifact === '.' || artifact === '..'
        || !/^[A-Za-z0-9_.+-]+$/.test(version) || version === '.' || version === '..'
        || classifier !== undefined && (!/^[A-Za-z0-9_.+-]+$/.test(classifier) || classifier === '.' || classifier === '..')) return;
    return `${group.replaceAll('.', '/')}/${artifact}/${version}/${artifact}-${version}${classifier ? `-${classifier}` : ''}.jar`;
}
/** Internal build: the game window states it plainly and points testers at the community group. */
const BETA_WINDOW_TITLE = "（内部测试版，可能有 BUG — 欢迎加入 QQ 群 638500178 反馈）";
/** The concrete cause is what users act on; keep it short and free of paths they cannot use. */
function failure(error: unknown): string {
    const raw = (error instanceof Error ? error.message : String(error ?? "")).split(/[\r\n]+/)[0].trim();
    const cause = raw.length > 240 ? raw.slice(0, 240) + "…" : raw;
    return cause ? `启动失败：${cause}` : "启动失败，请检查启动日志与运行环境";
}
/** Files the game cannot start without; a missing vanilla jar is tolerated because loaders/modpacks ship their own. */
export async function missingFiles(item: {
    resourceDir: string;
}, version: ResolvedVersion, signal: AbortSignal): Promise<string[]> {
    const root = item.resourceDir, missing: string[] = [];
    const trustedIntegrity = (url: string | undefined, sha1: string | undefined, size?: number) =>
        OFFICIAL_DOWNLOAD.test(url ?? '') && /^[a-f0-9]{40}$/i.test(sha1 ?? '')
            ? { sha1, ...(Number.isSafeInteger(size) && Number(size) >= 0 ? { size: Number(size) } : {}) }
            : undefined;
    const check = async (file: string, expected?: { sha1?: string; size?: number }) => {
        signal.throwIfAborted();
        let info;
        try {
            info = await lstat(file);
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
            missing.push(file);
            return;
        }
        // Never turn a symlink or special file into an automatic repair target.
        if (info.isSymbolicLink() || !info.isFile())
            throw new Error(`游戏文件不是普通文件，拒绝自动修复：${file}`);
        // Failed Maven fallbacks may leave a zero-byte placeholder. It is never
        // a runnable client, library or asset, even when upstream omitted SHA-1.
        if (info.size === 0) {
            missing.push(file);
            return;
        }
        if (!expected?.sha1 || !/^[a-f0-9]{40}$/i.test(expected.sha1)) return;
        if (expected.size !== undefined && info.size !== expected.size) {
            missing.push(file);
            return;
        }
        const hash = createHash('sha1');
        for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
        if (hash.digest('hex') !== expected.sha1.toLowerCase()) missing.push(file);
    };
    const profile = version as ResolvedVersion & {
        jar?: string;
    };
    if (!profile.jar && version.downloads?.client && version.id) {
        const client = version.downloads.client;
        const integrity = trustedIntegrity(client.url, client.sha1, client.size);
        await check(join(root, "versions", version.id, version.id + ".jar"), integrity);
    }
    for (const library of version.libraries) {
        if (!library.download) {
            const path = mavenLibraryPath(library.name);
            if (!path) throw new Error(`无法解析必要依赖路径：${library.name}`);
            await check(join(root, 'libraries', path));
            continue;
        }
        const download = library.download;
        const integrity = trustedIntegrity(download.url, download.sha1, download.size);
        await check(join(root, "libraries", download.path), integrity);
    }
    if (version.assetIndex) {
        const index = join(root, "assets", "indexes", version.assets + ".json");
        const metadata = (version as ResolvedVersion & { assetIndex?: { url?: string; sha1?: string; size?: number } }).assetIndex;
        const integrity = metadata ? trustedIntegrity(metadata.url, metadata.sha1, metadata.size) : undefined;
        const before = missing.length;
        await check(index, integrity);
        if (missing.length !== before) {
            // Without a verified index there is no trusted object list to verify.
            return missing;
        }
        if (!integrity) return missing;
        const raw = JSON.parse(await readFile(index, 'utf8')) as { objects?: Record<string, { hash: string; size?: number }> };
        for (const object of Object.values(raw.objects ?? {})) {
            if (!object || !/^[a-f0-9]{40}$/i.test(object.hash)) throw new Error('Invalid asset hash');
            await check(join(root, "assets", "objects", object.hash.slice(0, 2), object.hash), { sha1: object.hash, size: object.size });
        }
    }
    return missing;
}
/** Download specs for the missing asset objects (the index itself is fetched before this runs). */
async function objectSpecs(root: string, version: ResolvedVersion, missing: string[]): Promise<DownloadSpec[]> {
    const objects = await assetHashes(root, version);
    return [...objects.entries()]
        .filter(([hash]) => missing.includes(join(root, "assets", "objects", hash.slice(0, 2), hash)))
        .map(([hash, size]) => ({
            url: `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
            sha1: hash,
            size,
            path: `assets/objects/${hash.slice(0, 2)}/${hash}`,
        }));
}
async function assetHashes(root: string, version: ResolvedVersion, signal?: AbortSignal): Promise<Map<string, number | undefined>> {
    signal?.throwIfAborted();
    const indexPath = join(root, "assets", "indexes", version.assets + ".json");
    let index: { objects?: Record<string, { hash: string; size?: number }> };
    try {
        index = JSON.parse(await readFile(indexPath, "utf8"));
    }
    catch {
        return new Map();
    }
    const hashes = new Map<string, number | undefined>();
    for (const object of Object.values(index.objects ?? {})) {
        if (!object || !/^[a-f0-9]{40}$/.test(object.hash))
            throw new Error("Invalid asset hash");
        const size = Number.isSafeInteger(object.size) && Number(object.size) >= 0 ? Number(object.size) : undefined;
        const previous = hashes.get(object.hash);
        if (previous !== undefined && size !== undefined && previous !== size)
            throw new Error(`Asset index has conflicting sizes for ${object.hash}`);
        hashes.set(object.hash, size ?? previous);
    }
    return hashes;
}
async function matchesRepairSpec(file: string, spec: DownloadSpec, signal: AbortSignal): Promise<boolean> {
    let info;
    try { info = await lstat(file); }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return false; throw error; }
    if (info.isSymbolicLink() || !info.isFile()) throw new Error(`修复目标不是普通文件：${file}`);
    if (spec.size !== undefined && info.size !== spec.size) return false;
    if (!spec.sha1 || !/^[a-f0-9]{40}$/i.test(spec.sha1)) return false;
    const hash = createHash('sha1');
    for await (const chunk of createReadStream(file, { signal })) hash.update(chunk);
    return hash.digest('hex') === spec.sha1.toLowerCase();
}
type DirectoryIdentity = { path: string; dev: string; ino: string; birthtimeMs: string };
function sameFilesystemPath(left: string, right: string): boolean {
    const a = resolve(left), b = resolve(right);
    return process.platform === 'win32' ? a.toLocaleLowerCase() === b.toLocaleLowerCase() : a === b;
}
function directoryIdentity(path: string, info: Awaited<ReturnType<typeof lstat>>): DirectoryIdentity {
    if (info.isSymbolicLink() || !info.isDirectory())
        throw new Error(`修复目录不是普通目录：${path}`);
    return { path, dev: String(info.dev), ino: String(info.ino), birthtimeMs: String(info.birthtimeMs) };
}
function sameDirectoryIdentity(expected: DirectoryIdentity, actual: DirectoryIdentity): boolean {
    return sameFilesystemPath(expected.path, actual.path)
        && expected.dev === actual.dev
        && expected.ino === actual.ino
        && expected.birthtimeMs === actual.birthtimeMs;
}
async function assertDirectory(path: string, expected?: DirectoryIdentity): Promise<DirectoryIdentity> {
    const actual = directoryIdentity(path, await lstat(path));
    if (expected && !sameDirectoryIdentity(expected, actual))
        throw new Error(`修复期间目录身份发生变化，已停止：${path}`);
    return actual;
}
async function validateRepairRoot(path: string): Promise<{ path: string; identity: DirectoryIdentity }> {
    const resolved = resolve(path);
    const info = await lstat(resolved);
    const identity = directoryIdentity(resolved, info);
    const canonical = await realpath(resolved);
    // Also reject paths that traverse a symlink/junction in an ancestor. Case-only
    // differences are expected on Windows; aliases and reparse points are not.
    if (!sameFilesystemPath(resolved, canonical))
        throw new Error('游戏目录路径包含符号链接或目录别名，拒绝自动修复');
    return { path: canonical, identity: { ...identity, path: canonical } };
}
async function assertRepairRoot(root: string, expected: DirectoryIdentity): Promise<void> {
    const actual = directoryIdentity(root, await lstat(root));
    if (!sameDirectoryIdentity(expected, actual) || !sameFilesystemPath(root, await realpath(root)))
        throw new Error('游戏目录在修复期间发生变化，已停止');
}
async function captureDirectoryChain(root: string, relativeDirectory: string): Promise<DirectoryIdentity[]> {
    const resolvedRoot = resolve(root);
    const target = resolve(resolvedRoot, relativeDirectory || '.');
    const rel = relative(resolvedRoot, target);
    if (rel === '..' || rel.startsWith(`..${sep}`) || isAbsolute(rel))
        throw new Error('修复目录超出允许范围');
    const paths = [resolvedRoot];
    let current = resolvedRoot;
    for (const component of rel.split(/[\\/]/).filter(part => part && part !== '.')) {
        current = join(current, component);
        paths.push(current);
    }
    const identities: DirectoryIdentity[] = [];
    for (const path of paths) identities.push(await assertDirectory(path));
    return identities;
}
async function assertDirectoryChain(identities: DirectoryIdentity[]): Promise<void> {
    for (const identity of identities) await assertDirectory(identity.path, identity);
}
export class LaunchService {
    readonly events = new EventEmitter();
    private history: LaunchEvent[] = [];
    private owned = new Map<string, Owned>();
    private states = new Map<string, LaunchState>();
    windowAction: (action: 'hide' | 'minimize' | 'restore' | 'exit') => void = () => { };
    status(instanceId: string): LaunchState { return { ...(this.states.get(instanceId) ?? { instanceId, phase: 'idle', time: 0 }) }; }
    isBusy(instanceId: string): boolean { return this.owned.has(instanceId); }
    private state(instanceId: string, entry: Owned, patch: Partial<LaunchState>) {
        if (this.owned.get(instanceId) !== entry)
            return;
        const state = { ...this.status(instanceId), ...patch, time: Date.now() };
        this.states.set(instanceId, state);
        this.events.emit('state', { ...state });
    }
    /** Ending a lease more than once is harmless: only the owning attempt id is removed. */
    private async releaseLease(instanceId: string, entry: Owned): Promise<void> {
        if (entry.releasePromise) return entry.releasePromise;
        const lease = entry.lease;
        if (!lease) return;
        entry.lease = undefined;
        entry.releasePromise = this.instances.endLaunch(instanceId, lease);
        await entry.releasePromise;
    }
    /** Reconcile durable leases after restart; inconclusive inspection always fails closed. */
    async recoverPreviousLeases(verify: (marker: string) => Promise<LeaseProcessResult> = verifyLaunchMarker): Promise<Array<{ id: string; name: string; attempt: string; reason: string }>> {
        const unresolved: Array<{ id: string; name: string; attempt: string; reason: string }> = [];
        for (const { id, name, lease } of await this.instances.unresolvedLeases()) {
            // Recovery is intended for prior-session records. Never let a stale scan
            // race a launch owned by this process and release its protection.
            if (this.isBusy(id)) {
                unresolved.push({ id, name, attempt: lease.attempt, reason: '此实例正由当前启动器启动或运行' });
                continue;
            }
            if (lease.phase === 'legacy' || !lease.marker) {
                unresolved.push({ id, name, attempt: lease.attempt, reason: '旧版启动记录没有进程标记，无法确认游戏是否仍在运行' });
                continue;
            }
            let result: LeaseProcessResult;
            try { result = await verify(lease.marker); }
            catch { result = { status: 'ambiguous', reason: '进程检查异常' }; }
            if (result.status === 'dead') await this.instances.endLaunch(id, lease.attempt);
            else if (result.status === 'running') await this.instances.updateRecoveredLease(id, lease.attempt, result.pid);
            else unresolved.push({ id, name, attempt: lease.attempt, reason: result.reason });
        }
        return unresolved;
    }
    private finish(instanceId: string, entry: Owned, patch: Partial<LaunchState>) {        if (this.owned.get(instanceId) !== entry)
            return;
        const exit = launcherLifecycleAction(entry.preferences?.launcherAction ?? 'keep', 'end', true, this.status(instanceId).gameReady === true) === 'exit' && patch.phase === 'exited' && !entry.controller.signal.aborted;
        this.state(instanceId, entry, patch);
        this.owned.delete(instanceId);
        entry.helperController.abort();
        for (const helper of entry.helpers)
            helper.kill();
        if (exit) { void this.releaseLease(instanceId, entry).then(() => this.windowAction('exit'), () => this.windowAction('restore')); }
        else if (entry.preferences?.restoreLauncher && entry.preferences.launcherAction !== 'keep')
            this.windowAction('restore');
    }
    async cancel(instanceId: string): Promise<LaunchState> {
        const entry = this.owned.get(instanceId);
        if (entry && !entry.child) {
            entry.controller.abort();
            for (const helper of entry.helpers)
                helper.kill();
            this.state(instanceId, entry, { phase: 'stopping' });
        }
        return this.status(instanceId);
    }
    async stop(instanceId: string): Promise<LaunchState> {
        const entry = this.owned.get(instanceId);
        if (!entry)
            return this.status(instanceId);
        entry.controller.abort();
        for (const helper of entry.helpers)
            helper.kill();
        this.state(instanceId, entry, { phase: 'stopping' });
        if (entry.child && entry.child.exitCode === null && entry.child.signalCode === null)
            entry.child.kill();
        return this.status(instanceId);
    }
    dispose(): void {
        for (const [id, entry] of this.owned) {
            entry.helperController.abort();
            for (const helper of entry.helpers)
                helper.kill();
            if (!entry.child)
                void this.cancel(id);
        }
        this.windowAction = () => { };
    }
    windowDetector: WindowDetector = waitForGameWindow;
    constructor(private instances: InstanceService, private java: JavaService, private accounts: AccountProvider, private runner: typeof xmclLaunch = xmclLaunch, private memory = totalmem, private defaultJava: () => Promise<string> = async () => "", private autoDownload: () => Promise<boolean> = async () => true, private preferences: () => Promise<Partial<LaunchSettings>> = async () => ({}), private tasks?: TaskService, private network?: NetworkService, private defaultMemory: () => Promise<number> = async () => 4096) { }
    logs(instanceId: string): LaunchEvent[] {
        return this.history
            .filter((x) => x.instanceId === instanceId)
            .map((x) => ({ ...x }));
    }
    private emit(event: LaunchEvent) {
        this.history.push(event);
        if (this.history.length > 1000)
            this.history.shift();
        this.events.emit("event", event);
    }
    async launch(instanceId: string, accountId: string): Promise<{
        pid: number;
    }> {
        const active = this.owned.get(instanceId);
        if (active)
            return active.promise!;
        const entry: Owned = { controller: new AbortController(), helperController: new AbortController(), helpers: new Set() };
        entry.release = () => this.releaseLease(instanceId, entry);
        this.owned.set(instanceId, entry);
        this.states.set(instanceId, { instanceId, phase: 'preparing', time: Date.now() });
        this.events.emit('state', this.status(instanceId));
        entry.promise = this.start(instanceId, accountId, entry).catch(async error => {
            // child is assigned right before the spawn wait, so compare PIDs: an ENOENT
            // child never got one even though the ChildProcess object exists.
            if (!entry.child?.pid)
                await entry.release?.();
            // A child that did reach the OS owns its lease until 'close'; a rejected start
            // is not proof that it exited. Xmcl also emits 'close' early on ENOENT, where
            // our handler must stay the only one that decides about finishing.
            if (!entry.child?.pid)
                this.finish(instanceId, entry, { phase: entry.controller.signal.aborted ? 'cancelled' : 'failed', error: entry.controller.signal.aborted ? undefined : failure(error) });
            else if (entry.controller.signal.aborted)
                this.state(instanceId, entry, { phase: 'stopping', pid: entry.child.pid });
            // Keep the original rejection: callers and tests reason about the real cause,
            // while LaunchState.error carries the user-facing text.
            throw error;
        });
        return entry.promise;
    }
    async exportScript(instanceId: string, environment: boolean): Promise<string> {
        const item = await this.instances.get(instanceId), version = await this.instances.resolve(instanceId);
        const preferences = effectiveLaunchSettings(await this.preferences(), item.launch);
        const globalMb = await this.defaultMemory();
        if (preferences.memoryMode === 'global') item.memoryMb = globalMb;
        item.memoryMb = launchMemory(item.memoryMb, preferences, { totalMb: this.memory()/1048576, freeMb: freemem()/1048576, arch: 'amd64', minecraft: item.minecraft, modded: !!item.loader }, globalMb);
        const java = await this.java.resolve({ minecraft: version.minecraftVersion, metadataMajor: version.javaVersion?.majorVersion, runtimeComponent: version.javaVersion?.component, customRange: item.javaMinMajor === undefined && item.javaMaxMajor === undefined ? undefined : { minMajor: item.javaMinMajor, maxMajor: item.javaMaxMajor }, loader: item.loader, optifine: version.libraries.some(l => /optifine/i.test(l.name)), liteLoader: version.libraries.some(l => /liteloader/i.test(l.name)) }, { manualPath: item.javaMode === "instance" ? undefined : item.javaPath ?? await this.defaultJava(), memoryMb: javaSelectionMemory(item.memoryMb, preferences), autoDownload: false, roots: item.javaMode === "instance" ? [join(item.resourceDir, "versions", item.versionId)] : [item.resourceDir, item.gameDir], instanceOnly: item.javaMode === "instance" });
        item.memoryMb = launchMemory(item.memoryMb, preferences, { totalMb: this.memory()/1048576, freeMb: freemem()/1048576, arch: java.arch, minecraft: item.minecraft, modded: !!item.loader }, globalMb);
        const options = buildLaunchOptions(item, version, java, { name: '__ZH_NAME__', uuid: '__ZH_UUID__', accessToken: '__ZH_TOKEN__' }, preferences);
        return powershellScript(java.path, (await generateArguments(options)).slice(1), item.gameDir, environment);
    }
    /** Downloads and validates an entire trusted repair set before publishing any target file. */
    private async downloadAndPublish(root: string, specs: DownloadSpec[], signal: AbortSignal): Promise<void> {
        if (!specs.length) return;
        const unique = new Map<string, DownloadSpec>();
        for (const spec of specs) {
            const previous = unique.get(spec.path);
            if (previous && (previous.sha1?.toLowerCase() !== spec.sha1?.toLowerCase() || previous.size !== spec.size))
                throw new Error(`官方修复目标冲突：${spec.path}`);
            unique.set(spec.path, previous ?? spec);
        }
        specs = [...unique.values()];
        if (specs.length > REPAIR_LIMIT)
            throw new Error(`本次需要修复 ${specs.length} 个文件，超过单次上限 ${REPAIR_LIMIT} 个；请减少损坏文件后重试`);
        // Resolve and validate the instance before any staging write. Use the canonical
        // non-link root so the stage is a direct child of the directory we inspected.
        const validatedRoot = await validateRepairRoot(root);
        const rootIdentity = validatedRoot.identity;
        root = validatedRoot.path;
        await assertRepairRoot(root, rootIdentity);
        const stage = await mkdtemp(join(root, '.zhumeng-launch-repair-'));
        let cleanupStageIdentity: DirectoryIdentity | undefined;
        let preserveStage = false;
        try {
            await assertRepairRoot(root, rootIdentity);
            const stageIdentity = await assertDirectory(stage);
            cleanupStageIdentity = stageIdentity;
            if (dirname(stage) !== root)
                throw new Error('修复暂存目录不在已验证的游戏目录中');
            for (const spec of specs) {
                if (!OFFICIAL_DOWNLOAD.test(spec.url) || !spec.sha1 || !/^[a-f0-9]{40}$/i.test(spec.sha1))
                    throw new Error(`缺少可信官方校验信息，拒绝自动修复：${spec.path}`);
                contained(root, spec.path);
            }
            await this.fetchAll(stage, specs, signal);
            const installed: {
                path: string; target: string; backup: string; hadOld: boolean; published: boolean;
                targetParents: DirectoryIdentity[]; backupParents: DirectoryIdentity[]; sourceParents: DirectoryIdentity[];
            }[] = [];
            try {
                for (const spec of specs) {
                    signal.throwIfAborted();
                    await assertRepairRoot(root, rootIdentity);
                    await assertDirectory(stage, stageIdentity);
                    const source = await safeDestination(stage, spec.path);
                    if (!await matchesRepairSpec(source, spec, signal)) throw new Error(`暂存文件校验失败：${spec.path}`);
                    const target = await safeDestination(root, spec.path);
                    const backup = await safeDestination(stage, `.rollback/${spec.path}`);
                    await mkdir(dirname(target), { recursive: true });
                    await mkdir(dirname(backup), { recursive: true });
                    const targetParents = await captureDirectoryChain(root, dirname(spec.path));
                    const backupParents = await captureDirectoryChain(stage, join('.rollback', dirname(spec.path) === '.' ? '' : dirname(spec.path)));
                    const sourceParents = await captureDirectoryChain(stage, dirname(spec.path));
                    let hadOld = false;
                    try {
                        const previous = await lstat(target);
                        if (previous.isSymbolicLink() || !previous.isFile()) throw new Error(`修复目标不是普通文件：${spec.path}`);
                        hadOld = true;
                    }
                    catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error; }
                    const record = { path: spec.path, target, backup, hadOld, published: false, targetParents, backupParents, sourceParents };
                    installed.push(record);
                    await assertRepairRoot(root, rootIdentity);
                    await assertDirectory(stage, stageIdentity);
                    await assertDirectoryChain(targetParents);
                    await assertDirectoryChain(backupParents);
                    if (hadOld) {
                        await rename(target, backup);
                        await assertRepairRoot(root, rootIdentity);
                        await assertDirectory(stage, stageIdentity);
                        await assertDirectoryChain(targetParents);
                        await assertDirectoryChain(backupParents);
                    }
                    await assertDirectoryChain(sourceParents);
                    await assertDirectoryChain(targetParents);
                    await rename(source, target);
                    // Record the completed rename before checking the parent chains.
                    // If an identity changed during the syscall, rollback still knows
                    // that this new target may need removal.
                    record.published = true;
                    await assertRepairRoot(root, rootIdentity);
                    await assertDirectory(stage, stageIdentity);
                    await assertDirectoryChain(sourceParents);
                    await assertDirectoryChain(targetParents);
                }
                for (const spec of specs) {
                    signal.throwIfAborted();
                    await assertRepairRoot(root, rootIdentity);
                    if (!await matchesRepairSpec(await safeDestination(root, spec.path), spec, signal))
                        throw new Error(`修复后校验失败：${spec.path}`);
                }
            } catch (error) {
                let rollbackFailed = false;
                for (const record of installed.reverse()) {
                    try {
                        await assertRepairRoot(root, rootIdentity);
                        await assertDirectory(stage, stageIdentity);
                        await assertDirectoryChain(record.targetParents);
                        await assertDirectoryChain(record.backupParents);
                        const target = await safeDestination(root, record.path);
                        if (record.published) await rm(target);
                        if (record.hadOld) {
                            const backup = await safeDestination(stage, `.rollback/${record.path}`);
                            await assertDirectoryChain(record.targetParents);
                            await assertDirectoryChain(record.backupParents);
                            await rename(backup, target);
                            await assertRepairRoot(root, rootIdentity);
                            await assertDirectory(stage, stageIdentity);
                            await assertDirectoryChain(record.targetParents);
                            await assertDirectoryChain(record.backupParents);
                        }
                    } catch { rollbackFailed = true; }
                }
                if (rollbackFailed) {
                    preserveStage = true;
                    throw new Error(`修复回滚失败，原文件备份已保留：${stage}`);
                }
                throw error;
            }
        } finally {
            if (!preserveStage && cleanupStageIdentity) {
                // Never recursively delete a path that a concurrent process replaced.
                try {
                    await assertRepairRoot(root, rootIdentity);
                    await assertDirectory(stage, cleanupStageIdentity);
                    await rm(stage, { recursive: true, force: true });
                } catch { /* preserve unexpected replacements for manual inspection */ }
            }
        }
    }
    /**
     * Completes a launch the way other launchers do: download only what is missing,
     * then re-read the profile so the returned jar/libraries/asset index are exactly
     * what XMCL launches with.
     */
    private async repair(item: {
        resourceDir: string;
        versionId: string;
    }, version: ResolvedVersion, missing: string[], signal: AbortSignal): Promise<ResolvedVersion> {
        const root = item.resourceDir, runtime = version.minecraftDirectory;
        const profile = version as ResolvedVersion & {
            id?: string;
            downloads?: {
                client?: {
                    url: string;
                    sha1?: string;
                    size?: number;
                };
            };
            assetIndex?: {
                id?: string;
                url?: string;
                sha1?: string;
                size?: number;
            };
        };
        const isMissing = (file: string) => missing.includes(file);
        const specs: DownloadSpec[] = [];
        const fallbackLibraries: typeof version.libraries = [];
        const addSpec = (spec: DownloadSpec) => {
            if (!OFFICIAL_DOWNLOAD.test(spec.url) || !spec.sha1 || !/^[a-f0-9]{40}$/i.test(spec.sha1))
                throw new Error(`缺少可信官方校验信息，拒绝自动修复：${spec.path}`);
            if (spec.size !== undefined && (!Number.isSafeInteger(spec.size) || spec.size < 0))
                throw new Error(`官方文件大小无效，拒绝自动修复：${spec.path}`);
            contained(root, spec.path);
            specs.push(spec);
        };
        // Never let a profile from another launcher pick a destination outside its own version folder.
        if (runtime !== root && !dirname(runtime).toLowerCase().startsWith(join(root, "versions").toLowerCase() + sep))
            throw new Error("版本目录不在游戏目录内，无法自动补齐");
        const folder = relative(root, runtime).split(sep).join("/");
        const client = profile.downloads?.client;
        if (profile.id && client?.url && client.sha1) {
            // e.g. loader profiles resolve to `versions/1.20.4-Fabric 0.18.4` while the client jar is `versions/1.20.4/1.20.4.jar`.
            const declared = join(runtime, profile.id + ".jar"), resolved = join(root, "versions", profile.id, profile.id + ".jar");
            const missingJar = isMissing(declared) || (runtime === root && isMissing(resolved));
            if (missingJar && OFFICIAL_DOWNLOAD.test(client.url))
                addSpec({ url: client.url, sha1: client.sha1, size: client.size, path: folder ? `${folder}/${profile.id}.jar` : `versions/${profile.id}/${profile.id}.jar` });
        }
        const index = profile.assetIndex;
        if (version.assets && index?.url && index.sha1 && isMissing(join(root, "assets", "indexes", version.assets + ".json"))) {
            addSpec({ url: index.url, sha1: index.sha1, size: index.size, path: `assets/indexes/${version.assets}.json` });
        }
        const libraries = version.libraries.filter(library => library.download && isMissing(join(root, "libraries", library.download.path)));
        for (const library of libraries) {
            if (!library.download.url || !/^[a-f0-9]{40}$/i.test(library.download.sha1 ?? '') || !OFFICIAL_DOWNLOAD.test(library.download.url)) {
                // This path was absent (untrusted existing files are not hash-marked missing),
                // so the legacy Maven resolver can only fill the hole, never replace custom content.
                fallbackLibraries.push(library);
                continue;
            }
            addSpec({ url: library.download.url, sha1: library.download.sha1, size: library.download.size, path: `libraries/${library.download.path}` });
        }
        if (specs.length > REPAIR_LIMIT)
            throw new Error(`本次需要修复 ${specs.length} 个文件，超过单次上限 ${REPAIR_LIMIT} 个；请减少损坏文件后重试`);
        await this.downloadAndPublish(root, specs, signal);
        signal.throwIfAborted();
        if (fallbackLibraries.length)
            throw new Error(`必要依赖缺少可信下载校验信息，无法安全自动补齐：${fallbackLibraries.slice(0, 5).map(library => library.download?.path ?? library.name).join("、")}${fallbackLibraries.length > 5 ? " 等" : ""}`);
        const refreshed = await Version.parse(root, item.versionId);
        await this.downloadAndPublish(root, await objectSpecs(root, refreshed, await missingFiles(item, refreshed, signal)), signal);
        signal.throwIfAborted();
        return Version.parse(root, item.versionId);
    }
    /** Downloads with at most 8 workers; reports one task when a TaskService is attached. */
    private async fetchAll(root: string, specs: DownloadSpec[], signal: AbortSignal): Promise<void> {
        if (!specs.length)
            return;
        signal.throwIfAborted();
        const files = [...specs];
        const total = files.length;
        const workers = async (context: {
            signal: AbortSignal;
            report(progress: number): void;
        }) => {
            let done = 0;
            const errors: unknown[] = [];
            await Promise.all(Array.from({ length: Math.min(8, total) }, async () => {
                for (let spec = files.shift(); spec && !context.signal.aborted; spec = files.shift()) {
                    try {
                        await this.download(root, spec, context.signal);
                    }
                    catch (error) {
                        if (context.signal.aborted)
                            throw error;
                        // One unreachable mirror must not hide every other missing file.
                        errors.push(error);
                    }
                    context.report(Math.min(1, ++done / total));
                }
            }));
            context.signal.throwIfAborted();
            if (errors.length)
                throw errors[0];
        };
        if (!this.tasks) {
            await workers({ signal, report: () => { } });
            return;
        }
        await this.tasks.wait(this.tasks.start(`补齐游戏文件（${total} 个）`, context => workers(context)));
    }
    private async download(root: string, spec: DownloadSpec, signal: AbortSignal): Promise<void> {
        if (!this.network) {
            // No transfer service attached: a direct, hash-verified, https-only fetch.
            if (!OFFICIAL_DOWNLOAD.test(spec.url) || spec.sha1 === undefined)
                throw new Error(`无法下载非官方来源的文件：${spec.path}`);
            const response = await fetch(spec.url, { signal, redirect: "error" });
            if (!response.ok)
                throw new Error(`下载失败（HTTP ${response.status}）：${spec.path}`);
            const bytes = Buffer.from(await response.arrayBuffer());
            if (createHash("sha1").update(bytes).digest("hex") !== spec.sha1)
                throw new Error(`文件校验失败：${spec.path}`);
            const target = await safeDestination(root, spec.path);
            await mkdir(dirname(target), { recursive: true });
            await writeFile(target, bytes);
            return;
        }
        await this.network.download(root, spec, { taskId: "launch:repair", signal, report: () => { } });
    }
    private async start(instanceId: string, accountId: string, entry: Owned): Promise<{
        pid: number;
    }> {
        entry.marker = randomUUID();
        entry.lease = await this.instances.beginLaunch(instanceId, entry.marker);
        entry.release = () => this.releaseLease(instanceId, entry);
        const signal = entry.controller.signal;
        const own = (child: ChildProcess) => { entry.helpers.add(child); child.once('close', () => entry.helpers.delete(child)); };
        const item = await this.instances.get(instanceId);
        entry.preferences = effectiveLaunchSettings(await this.preferences(), item.launch);
        if (entry.preferences.memoryMode === 'global') item.memoryMb = await this.defaultMemory();
        item.memoryMb = launchMemory(item.memoryMb, entry.preferences, { totalMb: this.memory()/1048576, freeMb: freemem()/1048576, arch: 'amd64', minecraft: item.minecraft, modded: !!item.loader }, item.memoryMb);
        if (item.javaArgs.some((argument) => /^-Xm[sx]/i.test(argument)))
            throw new Error("Set memory through the instance memory setting.");
        signal.throwIfAborted();
        const version = pinVersionJar(await this.instances.resolve(instanceId));
        signal.throwIfAborted();
        // Enforce the instance authentication policy before Java downloads or pre-launch commands.
        const account = await this.accounts(accountId, signal, item.authentication);
        signal.throwIfAborted();
        if (!account.accessToken || !account.name || !account.uuid)throw new Error('账号不可用');
        const javaPath = item.javaPath ?? (await this.defaultJava());
        const java = await this.java.resolve({
            minecraft: version.minecraftVersion,
            metadataMajor: version.javaVersion?.majorVersion,
            runtimeComponent: version.javaVersion?.component,
            customRange: item.javaMinMajor === undefined && item.javaMaxMajor === undefined ? undefined : { minMajor: item.javaMinMajor, maxMajor: item.javaMaxMajor },
            loader: item.loader,
            optifine: version.libraries.some(l => /optifine/i.test(l.name)),
            liteLoader: version.libraries.some(l => /liteloader/i.test(l.name)),
        }, { manualPath: item.javaMode === "instance" ? undefined : javaPath, memoryMb: javaSelectionMemory(item.memoryMb, entry.preferences), autoDownload: await this.autoDownload(), roots: item.javaMode === "instance" ? [join(item.resourceDir, "versions", item.versionId)] : [item.resourceDir, item.gameDir], instanceOnly: item.javaMode === "instance", ownerScope: randomUUID(), context: { signal, report: () => { } } });
        signal.throwIfAborted();
        item.memoryMb = launchMemory(item.memoryMb, entry.preferences!, { totalMb: this.memory()/1048576, freeMb: freemem()/1048576, arch: java.arch, minecraft: item.minecraft, modded: !!item.loader }, item.memoryMb);
        entry.preferences!.windowTitle = renderWindowTitle(entry.preferences!.windowTitle, {player: account.name, version: item.minecraft, instance: item.name});
        signal.throwIfAborted();
        await mkdir(item.gameDir, { recursive: true });
        await preCommand(entry.preferences, item.gameDir, signal, own, message => this.emit({ instanceId, type: "log", text: message, time: Date.now() }));
        signal.throwIfAborted();
        const secrets = [account.accessToken, account.uuid, ...(account.extraJvmArgs??[])];
        const redact = (value: string) => {
            for (const secret of secrets)
                value = value.split(secret).join("[已脱敏]");
            return value.replace(/(--accessToken[=\s]+)\S+/gi, "$1[已脱敏]");
        };
        const addLeaseMarker = (options: LaunchOption) => {
            // This value is generated by the main process and is persisted before spawn.
            options.extraJVMArgs = [...(options.extraJVMArgs ?? []), `-Dzhumeng.launchMarker=${entry.marker}`];
            return options;
        };
        const options = addLeaseMarker(buildLaunchOptions(item, version, java, account, entry.preferences));
        const trackLease = (child: ChildProcess) => {
            if(entry.leaseChild === child)return;
            entry.leaseChild=child;
            child.once('close',()=>{void entry.release?.().catch(() => { });});
        };
        // A spawn that failed before any code ran (ENOENT, corrupt jar) never emits "close";
        // release the lease as soon as that error lands so the next launch is not blocked.
        const failedSpawn = (child: ChildProcess) => {
            void entry.release?.().catch(() => { });
        };
        const releaseLease = async () => {
            if (!entry.lease)
                return;
            const lease = entry.lease;
            entry.lease = undefined;
            await this.instances.endLaunch(instanceId, lease).catch(() => { });
        };
        const document = version as ResolvedVersion & {
            jar?: string;
        };
        const missing = await missingFiles(item, version, signal);
        if (missing.length) {
            // Version-isolated directories (e.g. versions/1.20.4-Fabric 0.18.4) and another
            // launcher's half-finished download must not turn into a dead-end launch.
            signal.throwIfAborted();
            await mkdir(item.gameDir, { recursive: true });
            const repaired = (await this.repair(item, version, missing, signal)) as typeof document;
            const left = await missingFiles(item, repaired, signal);
            if (left.length)
                throw new Error(`游戏文件仍不完整：${left.slice(0, 3).map(file => relative(repaired.minecraftDirectory, file).split(sep).join("/")).join("、")}${left.length > 3 ? ` 等 ${left.length} 个文件` : ""}`);
            // A different jar/libraries/asset set means the launch options must be rebuilt too.
            if (repaired.id !== document.id || repaired.jar !== document.jar || repaired.libraries.length !== document.libraries.length || repaired.assets !== document.assets)
                Object.assign(options, addLeaseMarker(buildLaunchOptions(item, repaired, java, account, entry.preferences)));
        }
        options.spawn = (command, args, opts) => { signal.throwIfAborted(); entry.spawnAttempted=true; const child=spawn(command, args ?? [], { ...opts, shell: false, windowsHide: true }); trackLease(child); child.once('error',()=>failedSpawn(child)); return child; };
        await mkdir(item.gameDir, { recursive: true });
        signal.throwIfAborted();
        let child: ChildProcess;
        try {
            child = await this.runner(options);
            entry.child = child;
            trackLease(child);
            child.once('close', (code, signal) => this.finish(instanceId, entry, { phase: entry.controller.signal.aborted ? 'cancelled' : 'exited', code, signal }));
            child.on('error', () => {
                // Missing PID means OS spawn failed. Kill errors on an existing
                // process do not imply exit, even if kill() returned false.
                if (!child.pid)
                    this.finish(instanceId, entry, { phase: 'failed', error: '游戏进程无法启动' });
                else if (entry.controller.signal.aborted)
                    this.state(instanceId, entry, { phase: 'stopping', pid: child.pid });
            });
        }
        catch (error) {
            // A rejected spawn (ENOENT, unreadable jar) must free this attempt immediately:
            // 'close' never fires for a child that never started.
            await entry.release?.();
            throw new Error(redact(error instanceof Error ? error.message : JSON.stringify(error)));
        }
        const held = () => this.owned.get(instanceId) === entry && entry.child === child && child.exitCode === null && child.signalCode === null;
        const windowController = new AbortController();
        let graphicsReady = false;
        const complete = (readinessSource: 'window' | 'graphics-log') => {
            if (!held() || signal.aborted || this.status(instanceId).phase !== 'running') return;
            const alreadyReady = this.status(instanceId).gameReady;
            this.state(instanceId, entry, { gameReady: true, readinessSource, ...(readinessSource === 'window' ? { windowReady: true } : {}) });
            if (readinessSource === 'graphics-log') windowController.abort();
            const action = launcherLifecycleAction(entry.preferences!.launcherAction, 'ready', held(), true);
            if (!alreadyReady && action) this.windowAction(action);
        };
        // PCL ModWatcher.GameLog final graphics stage; early LWJGL/OpenAL logs are insufficient.
        // Reference: https://github.com/Hex-Dragon/PCL2/blob/main/Plain%20Craft%20Launcher%202/Modules/Minecraft/ModWatcher.vb
        const observeGraphics = (line: string) => {
            if (!held() || signal.aborted || line.includes('[CHAT]')) return;
            if ((line.includes('Created') && line.includes('textures') && line.includes('-atlas')) || line.includes('Found animation info')) {
                graphicsReady = true;
                complete('graphics-log');
            }
        };
        for (const [stream, source] of [
            [child.stdout, "stdout"],
            [child.stderr, "stderr"],
        ] as const) {
            if (!stream)
                continue;
            let buffer = "";
            let omitted = false;
            stream.setEncoding("utf8");
            stream.on("data", (chunk: string) => {
                buffer += chunk;
                let pos;
                while ((pos = buffer.indexOf("\n")) >= 0) {
                    if (!omitted && pos <= 65536) observeGraphics(buffer.slice(0, pos));
                    this.emit({
                        instanceId,
                        type: "log",
                        source,
                        text: omitted || pos > 65536
                            ? "[Oversized log line omitted]"
                            : redact(buffer.slice(0, pos)),
                        time: Date.now(),
                    });
                    buffer = buffer.slice(pos + 1);
                    omitted = false;
                }
                if (buffer.length > 65536) {
                    // Never emit a partial credential when a long line spans data chunks.
                    buffer = "";
                    omitted = true;
                }
            });
            stream.on("end", () => {
                if (!omitted) observeGraphics(buffer);
                if (buffer || omitted)
                    this.emit({
                        instanceId,
                        type: "log",
                        source,
                        text: omitted ? "[Oversized log line omitted]" : redact(buffer),
                        time: Date.now(),
                    });
            });
        }
        child.on("error", (error) => this.emit({
            instanceId,
            type: "error",
            text: redact(error.message),
            time: Date.now(),
        }));
        child.on("close", (code, signal) => this.emit({ instanceId, type: "exit", code, signal, time: Date.now() }));
        if (signal.aborted) {
            this.state(instanceId, entry, { phase: 'stopping', pid: child.pid });
            child.kill();
            throw Error('启动已取消');
        }
        // Wait for the OS spawn result before reporting a PID; XMCL returns before spawn fires.
        await new Promise<void>((resolve, reject) => {
            child.once("spawn", resolve);
            child.once("error", (error) => reject(new Error(redact(error.message))));
            if (child.pid)
                resolve();
        });
        signal.throwIfAborted();
        await this.instances.markLaunchSpawned(instanceId, entry.lease!, child.pid!);
        if (this.owned.get(instanceId) === entry) {
            this.state(instanceId, entry, { phase: 'running', pid: child.pid });
            if (graphicsReady) complete('graphics-log');
            const windowSignal = AbortSignal.any([signal, entry.helperController.signal, windowController.signal]);
            void this.windowDetector(child, windowSignal, own, held).then(ready => {
                if (!held() || windowSignal.aborted) return;
                if (ready) complete('window');
                if (!ready && held() && !windowSignal.aborted)
                    this.emit({ instanceId, type: 'log', text: '窗口检测未完成，继续等待游戏材质加载完成。', time: Date.now() });
            }).catch(() => {
                if (held() && !windowSignal.aborted) this.emit({ instanceId, type: 'log', text: '窗口检测辅助程序失败，继续等待游戏材质加载完成。', time: Date.now() });
            });
            void applyCosmetics(child, entry.preferences, AbortSignal.any([signal, entry.helperController.signal]), own, () => this.owned.get(instanceId) === entry && entry.child === child && child.exitCode === null && child.signalCode === null).catch(() => {
                if (this.owned.get(instanceId) === entry && !signal.aborted)
                    this.emit({ instanceId, type: 'log', text: '窗口标题或优先级未应用：窗口尚未就绪、权限不足或当前平台不支持。游戏仍在运行。', time: Date.now() });
            });
            // Internal build notice in the game window title; it cannot block the launch and does not override a user title.
            if (!entry.preferences.windowTitle)
                void applyCosmetics(child, { ...entry.preferences, windowTitle: BETA_WINDOW_TITLE }, AbortSignal.any([signal, entry.helperController.signal]), own, () => this.owned.get(instanceId) === entry && entry.child === child && child.exitCode === null && child.signalCode === null).catch(() => { });
        }
        return { pid: child.pid! };
    }
}
