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
    preferences?: LaunchSettings;
    promise?: Promise<{
        pid: number;
    }>;
}
import { mkdir, access, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, dirname, relative, sep } from "node:path";
import { EventEmitter } from "node:events";
import { totalmem } from "node:os";
import { launch as xmclLaunch, Version, type LaunchOption, type ResolvedVersion } from "@xmcl/core";
import { installResolvedLibraries } from "@xmcl/installer";
import type { InstanceService } from "./instances";
import type { JavaService } from "./java";
import type { TaskService } from "./tasks";
import { contained, safeDestination, type DownloadSpec, type NetworkService } from "./network";
import type { LaunchEvent } from "../../shared/types";
export interface LaunchAccount {
    name: string;
    uuid: string;
    accessToken: string;
}
export type AccountProvider = (id: string, signal?: AbortSignal) => Promise<LaunchAccount>;
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
    const check = async (file: string) => {
        signal.throwIfAborted();
        try {
            await access(file);
        }
        catch {
            missing.push(file);
        }
    };
    if (!(version as ResolvedVersion & {
        jar?: string;
    }).jar && version.downloads?.client && version.id)
        await check(join(root, "versions", version.id, version.id + ".jar"));
    for (const library of version.libraries)
        if (library.download)
            await check(join(root, "libraries", library.download.path));
    if (version.assetIndex) {
        const index = join(root, "assets", "indexes", version.assets + ".json");
        try {
            await access(index);
        }
        catch {
            signal.throwIfAborted();
            missing.push(index);
            // Without the index there is no object list to verify: do not fail every asset by name.
            return missing;
        }
        for (const hash of (await assetHashes(root, version, signal)).keys())
            await check(join(root, "assets", "objects", hash.slice(0, 2), hash));
    }
    return missing;
}
/** Download specs for the missing asset objects (the index itself is fetched before this runs). */
async function objectSpecs(root: string, version: ResolvedVersion, missing: string[]): Promise<DownloadSpec[]> {
    const objects = await assetHashes(root, version);
    return [...objects.keys()]
        .filter(hash => missing.includes(join(root, "assets", "objects", hash.slice(0, 2), hash)))
        .map(hash => ({
            url: `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`,
            sha1: hash,
            path: `assets/objects/${hash.slice(0, 2)}/${hash}`,
        }));
}
async function assetHashes(root: string, version: ResolvedVersion, signal?: AbortSignal): Promise<Map<string, string>> {
    signal?.throwIfAborted();
    const indexPath = join(root, "assets", "indexes", version.assets + ".json");
    let index: { objects?: Record<string, { hash: string }> };
    try {
        index = JSON.parse(await readFile(indexPath, "utf8"));
    }
    catch {
        return new Map();
    }
    const hashes = new Map<string, string>();
    for (const object of Object.values(index.objects ?? {})) {
        if (!object || !/^[a-f0-9]{40}$/.test(object.hash))
            throw new Error("Invalid asset hash");
        hashes.set(object.hash, object.hash);
    }
    return hashes;
}
export class LaunchService {
    readonly events = new EventEmitter();
    private history: LaunchEvent[] = [];
    private owned = new Map<string, Owned>();
    private states = new Map<string, LaunchState>();
    windowAction: (action: 'hide' | 'minimize' | 'restore') => void = () => { };
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
        const lease = entry.lease;
        if (!lease)
            return;
        entry.lease = undefined;
        await this.instances.endLaunch(instanceId, lease).catch(() => { });
    }
    private finish(instanceId: string, entry: Owned, patch: Partial<LaunchState>) {        if (this.owned.get(instanceId) !== entry)
            return;
        this.state(instanceId, entry, patch);
        this.owned.delete(instanceId);
        entry.helperController.abort();
        for (const helper of entry.helpers)
            helper.kill();
        if (entry.preferences?.restoreLauncher && entry.preferences.launcherAction !== 'keep')
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
    constructor(private instances: InstanceService, private java: JavaService, private accounts: AccountProvider, private runner: typeof xmclLaunch = xmclLaunch, private memory = totalmem, private defaultJava: () => Promise<string> = async () => "", private autoDownload: () => Promise<boolean> = async () => true, private preferences: () => Promise<Partial<LaunchSettings>> = async () => ({}), private tasks?: TaskService, private network?: NetworkService) { }
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
        const java = await this.java.resolve({ minecraft: version.minecraftVersion, metadataMajor: version.javaVersion?.majorVersion, loader: item.loader, optifine: version.libraries.some(l => /optifine/i.test(l.name)), liteLoader: version.libraries.some(l => /liteloader/i.test(l.name)) }, { manualPath: item.javaPath ?? await this.defaultJava(), memoryMb: item.memoryMb, autoDownload: false, roots: [item.resourceDir, item.gameDir] });
        const options = buildLaunchOptions(item, version, java, { name: '__ZH_NAME__', uuid: '__ZH_UUID__', accessToken: '__ZH_TOKEN__' }, effectiveLaunchSettings(await this.preferences(), item.launch));
        return powershellScript(java.path, (await generateArguments(options)).slice(1), item.gameDir, environment);
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
        const addSpec = (spec: DownloadSpec) => {
            if (specs.length >= REPAIR_LIMIT || !OFFICIAL_DOWNLOAD.test(spec.url))
                return;
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
        const beforeLibraries = specs.length;
        for (const library of libraries) {
            if (!library.download.url)
                continue;
            addSpec({ url: library.download.url, sha1: library.download.sha1, size: library.download.size, path: `libraries/${library.download.path}` });
        }
        await this.fetchAll(root, specs, signal);
        signal.throwIfAborted();
        if (libraries.length && specs.length - beforeLibraries < libraries.length) {
            // Some libraries only ship as maven coordinates (Forge/NeoForge); let the installer resolve those.
            await installResolvedLibraries(libraries, runtime, {
                libraryHost: library => library.download.url ? [library.download.url] : [],
                mavenHost: ["https://libraries.minecraft.net/", "https://files.minecraftforge.net/maven/"],
            }).catch(() => { });
        }
        const refreshed = await Version.parse(root, item.versionId);
        await this.fetchAll(root, await objectSpecs(root, refreshed, await missingFiles(item, refreshed, signal)), signal);
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
        entry.lease = await this.instances.beginLaunch(instanceId);
        entry.release = () => this.releaseLease(instanceId, entry);
        const signal = entry.controller.signal;
        const own = (child: ChildProcess) => { entry.helpers.add(child); child.once('close', () => entry.helpers.delete(child)); };
        const item = await this.instances.get(instanceId);
        if (!Number.isInteger(item.memoryMb) ||
            item.memoryMb < 512 ||
            item.memoryMb > Math.floor(this.memory() / 1048576))
            throw new Error("实例内存超过可用物理内存或小于 512 MB");
        if (item.javaArgs.some((argument) => /^-Xm[sx]/i.test(argument)))
            throw new Error("Set memory through the instance memory setting.");
        signal.throwIfAborted();
        const version = pinVersionJar(await this.instances.resolve(instanceId));
        signal.throwIfAborted();
        const javaPath = item.javaPath ?? (await this.defaultJava());
        const java = await this.java.resolve({
            minecraft: version.minecraftVersion,
            metadataMajor: version.javaVersion?.majorVersion,
            loader: item.loader,
            optifine: version.libraries.some(l => /optifine/i.test(l.name)),
            liteLoader: version.libraries.some(l => /liteloader/i.test(l.name)),
        }, { manualPath: javaPath, memoryMb: item.memoryMb, autoDownload: await this.autoDownload(), roots: [item.resourceDir, item.gameDir], ownerScope: randomUUID(), context: { signal, report: () => { } } });
        signal.throwIfAborted();
        entry.preferences = effectiveLaunchSettings(await this.preferences(), item.launch);
        signal.throwIfAborted();
        await mkdir(item.gameDir, { recursive: true });
        await preCommand(entry.preferences, item.gameDir, signal, own, message => this.emit({ instanceId, type: "log", text: message, time: Date.now() }));
        signal.throwIfAborted();
        const account = await this.accounts(accountId, entry.controller.signal);
        signal.throwIfAborted();
        if (!account.accessToken || !account.name || !account.uuid)
            throw new Error("账号不可用");
        const secrets = [account.accessToken, account.uuid];
        const redact = (value: string) => {
            for (const secret of secrets)
                value = value.split(secret).join("[已脱敏]");
            return value.replace(/(--accessToken[=\s]+)\S+/gi, "$1[已脱敏]");
        };
        const options = buildLaunchOptions(item, version, java, account, entry.preferences);
        const trackLease = (child: ChildProcess) => {
            if(entry.leaseChild === child)return;
            entry.leaseChild=child;
            child.once('close',()=>{void entry.release?.();});
        };
        // A spawn that failed before any code ran (ENOENT, corrupt jar) never emits "close";
        // release the lease as soon as that error lands so the next launch is not blocked.
        const failedSpawn = (child: ChildProcess) => {
            void entry.release?.();
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
                Object.assign(options, buildLaunchOptions(item, repaired, java, account, entry.preferences));
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
            if (!alreadyReady && entry.preferences!.launcherAction !== 'keep') this.windowAction(entry.preferences!.launcherAction);
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
