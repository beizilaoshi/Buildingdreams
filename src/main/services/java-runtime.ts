import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, rename, rm, lstat, copyFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { JavaRuntime } from "../../shared/types";
import { javaArchitecture, javaInRange, javaVersionParts, type JavaRequirement } from "../../shared/java-requirements";
import { readArchive, archivePath } from "./archive";
import { NetworkService, safeDestination } from "./network";
import type { TaskContext } from "./tasks";
const HOSTS = ["api.adoptium.net", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com", "piston-meta.mojang.com", "launchermeta.mojang.com", "piston-data.mojang.com", "launcher.mojang.com"];
const MOJANG_RUNTIME_INDEX = "https://launchermeta.mojang.com/v1/products/java-runtime/2ec0cc96c44e5a76b9c8b7c39df7210883d12871/all.json";
interface Acquisition {
    controller: AbortController;
    consumers: Set<{
        context: TaskContext;
    }>;
    result: Promise<JavaRuntime>;
}
const MAX_ZIP = 512 * 1024 * 1024;
interface Asset {
    major: number;
    image: "jre" | "jdk";
    version: string;
    url: string;
    name: string;
    sha256: string;
    size: number;
}
interface Inventory {
    schema: 1;
    asset: Asset | { source: "mojang"; component: string; manifestSha1: string; version: string; major: number };
    executable: string;
    files: {
        path: string;
        sha256: string;
        sha1?: string;
        size?: number;
    }[];
}
async function hashFile(path: string): Promise<string> {
    const hash = createHash("sha256");
    for await (const chunk of createReadStream(path))
        hash.update(chunk);
    return hash.digest("hex");
}
/** Official catalogue + owned portable ZIP installs only. No PATH, registry or installers. */
export class JavaRuntimeService {
    private network: NetworkService;
    private pending = new Map<string, Acquisition>();
    constructor(readonly root: string, network: NetworkService, private inspect: (path: string) => Promise<JavaRuntime>) {
        this.network = network.restricted(HOSTS);
    }
    async catalogue(requirement: JavaRequirement, signal: AbortSignal): Promise<Asset> {
        const major = requirement.preferredMajor;
        if (major < 8 || major > 99)
            throw new Error(`官方自动下载暂不提供 Java ${major}，请手动选择兼容的运行环境`);
        const timeout = AbortSignal.any([signal, AbortSignal.timeout(30000)]);
        // Minecraft/Forge 1.12-era combinations require Java 8 builds no newer
        // than 8u320. The latest endpoint cannot satisfy these legacy caps, so
        // query the official GA catalogue and select the newest compatible ZIP.
        if (major === 8 && requirement.maxJava8Update !== undefined)
            return this.legacyJava8Catalogue(requirement, timeout);
        for (const image of ["jre", "jdk"] as const) {
            const data: unknown = await this.network.json(`https://api.adoptium.net/v3/assets/latest/${major}/hotspot?architecture=x64&image_type=${image}&os=windows&vendor=eclipse`, timeout);
            if (!Array.isArray(data) || data.length > 100)
                throw new Error("无效官方 Java 清单");
            if (!data.length)
                continue;
            // A non-empty but invalid official response must never silently pick another payload.
            const row = data[0];
            const b = row?.binary, p = b?.package, v = row?.version;
            if (row?.vendor !== "eclipse" || b?.os !== "windows" || b?.architecture !== "x64" || b?.image_type !== image || b?.jvm_impl !== "hotspot" || v?.major !== major || typeof v.openjdk_version !== "string" || v.openjdk_version.length > 128 || javaVersionParts(v.openjdk_version)[0] !== major || !p || typeof p.name !== "string" || !/^OpenJDK\d+U-(jre|jdk)_x64_windows_hotspot_[A-Za-z0-9_.+-]+\.zip$/.test(p.name) || !p.name.startsWith(`OpenJDK${major}U-${image}_`) || typeof p.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(p.checksum) || !Number.isSafeInteger(p.size) || p.size < 1 || p.size > MAX_ZIP || typeof p.link !== "string")
                throw new Error("官方 Java 元数据与请求不匹配");
            const url = this.network.validateUrl(p.link);
            if (url.hostname !== "github.com" || !url.pathname.startsWith(`/adoptium/temurin${major}-binaries/releases/download/`) || !url.pathname.endsWith(".zip") || url.search || url.hash || url.port || decodeURIComponent(url.pathname.split("/").at(-1) ?? "") !== p.name)
                throw new Error("无效官方 Java 下载地址");
            const asset: Asset = { major, image, version: v.openjdk_version, url: url.href, name: p.name, sha256: p.checksum.toLowerCase(), size: p.size };
            if (!javaInRange(requirement, { path: "", major, version: asset.version, arch: "amd64" }))
                throw new Error(`官方当前 Java ${asset.version} 不满足此版本限制，请手动选择兼容的 Java${requirement.maxJava8Update ? ` 8u${requirement.maxJava8Update} 或更早版本` : ""}`);
            return asset;
        }
        throw new Error(`官方暂未提供 Java ${major} Windows x64 ZIP，请手动选择兼容的 Java`);
    }
    private async legacyJava8Catalogue(requirement: JavaRequirement, signal: AbortSignal): Promise<Asset> {
        const candidates: Asset[] = [];
        const maxUpdate = requirement.maxJava8Update;
        if (!Number.isSafeInteger(maxUpdate) || maxUpdate! < 0 || maxUpdate! >= Number.MAX_SAFE_INTEGER)
            throw new Error("无效 Java 8 更新版本限制");
        for (const image of ["jre", "jdk"] as const) {
            const range = encodeURIComponent("[8,9)");
            const seenReleases = new Set<string>();
            const releases: any[] = [];
            let complete = false;
            // The live API uses pages of 20 even when asked for more. Walk the
            // next page even after a short page: the final page can be partial,
            // and the next out-of-range page is reported as HTTP 404 (verified
            // against the official endpoint). Never accept a page cap as complete.
            for (let page = 0; page < 8; page++) {
                const url = `https://api.adoptium.net/v3/assets/version/${range}?architecture=x64&image_type=${image}&jvm_impl=hotspot&os=windows&vendor=eclipse&release_type=ga&page=${page}&page_size=20`;
                let data: unknown;
                try {
                    data = await this.network.json(url, signal);
                }
                catch (error) {
                    if (page > 0 && error instanceof Error && /HTTP 404\b/.test(error.message)) {
                        complete = true;
                        break;
                    }
                    throw error;
                }
                if (!Array.isArray(data) || data.length > 20)
                    throw new Error("无效官方 Java 8 历史版本清单");
                if (!data.length) {
                    complete = true;
                    break;
                }
                for (const row of data) {
                    if (typeof row?.release_name !== "string" || !row.release_name)
                        throw new Error("官方 Java 8 历史版本缺少发行标识");
                    if (seenReleases.has(row.release_name))
                        continue;
                    seenReleases.add(row.release_name);
                    releases.push(row);
                }
            }
            if (!complete)
                throw new Error("官方 Java 8 历史版本目录分页超过安全上限，暂时无法筛选");
            for (const row of releases) {
                if (row?.release_type !== "ga" || row?.vendor !== "eclipse" || row?.version_data?.major !== 8)
                    continue;
                const version = row.version_data.openjdk_version;
                // Temurin 8 uses the legacy version form 1.8.0_<update>-b<build>.
                // Check the string and the parsed tuple independently so an API
                // row with a malformed or ambiguous version can never be chosen.
                const versionMatch = typeof version === "string" && /^1\.8\.0_(\d+)-b(\d+)$/.exec(version);
                if (!versionMatch)
                    continue;
                const update = Number(versionMatch[1]), build = Number(versionMatch[2]);
                if (!Number.isSafeInteger(update) || !Number.isSafeInteger(build) || update > maxUpdate!)
                    continue;
                const parsed = javaVersionParts(version);
                if (parsed[0] !== 8 || parsed[2] !== update || parsed[3] !== build)
                    continue;
                if (!Array.isArray(row.binaries) || row.binaries.length > 32)
                    throw new Error("无效官方 Java 8 历史版本映像清单");
                const binary = row.binaries.find((item: any) => item?.os === "windows" && item?.architecture === "x64" && item?.image_type === image && item?.jvm_impl === "hotspot");
                if (!binary)
                    continue;
                const p = binary.package;
                const expectedName = `OpenJDK8U-${image}_x64_windows_hotspot_8u${update}b${String(build).padStart(2, "0")}.zip`;
                if (typeof p?.name !== "string" || p.name !== expectedName || typeof p.checksum !== "string" || !/^[a-f0-9]{64}$/i.test(p.checksum) || !Number.isSafeInteger(p.size) || p.size < 1 || p.size > MAX_ZIP || typeof p.link !== "string")
                    throw new Error("官方 Java 8 历史版本包信息无效");
                const assetUrl = this.network.validateUrl(p.link);
                const baseTag = `jdk8u${update}-b${String(build).padStart(2, "0")}`;
                // Adoptium occasionally publishes a GA reroll as e.g. b08.1
                // while retaining the exact Java build and package filename.
                const releaseTag = typeof row.release_name === "string" && new RegExp(`^${baseTag}(?:\\.\\d{1,3})?$`).test(row.release_name) ? row.release_name : "";
                const expectedPath = `/adoptium/temurin8-binaries/releases/download/${releaseTag}/${expectedName}`;
                let assetName = "";
                try { assetName = decodeURIComponent(assetUrl.pathname.split("/").at(-1) ?? ""); }
                catch { throw new Error("无效官方 Java 下载文件名"); }
                if (!releaseTag || assetUrl.hostname !== "github.com" || assetUrl.pathname !== expectedPath || assetUrl.search || assetUrl.hash || assetUrl.port || assetName !== expectedName)
                    throw new Error("无效官方 Java 下载地址");
                candidates.push({ major: 8, image, version, url: assetUrl.href, name: p.name, sha256: p.checksum.toLowerCase(), size: p.size });
            }
        }
        candidates.sort((a, b) => {
            const x = javaVersionParts(a.version), y = javaVersionParts(b.version);
            return y[2] - x[2] || y[3] - x[3] || (a.image === b.image ? 0 : a.image === "jre" ? -1 : 1);
        });
        const asset = candidates[0];
        if (!asset || !javaInRange(requirement, { path: "", major: 8, version: asset.version, arch: "amd64" }))
            throw new Error(`官方未找到满足 Java 8u${requirement.maxJava8Update} 限制的 Windows x64 GA ZIP，请手动选择兼容的 Java`);
        return asset;
    }
    async list(): Promise<JavaRuntime[]> {
        let folders;
        try {
            folders = await readdir(this.root, { withFileTypes: true });
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code === "ENOENT")
                return [];
            throw error;
        }
        const runtimes: JavaRuntime[] = [];
        // Ignore unrelated and temporary entries before applying the bounded
        // scan, so accumulated staging/cache directories cannot hide runtimes.
        const ownedFolders = folders
            .filter(folder => folder.isDirectory() && !folder.isSymbolicLink() && /^(?:temurin-\d+-(?:jre|jdk)-[a-f0-9]{16}|mojang-[a-z0-9-]+-[a-f0-9]{16}-[a-f0-9-]{36})$/.test(folder.name))
            .sort((a, b) => a.name.localeCompare(b.name))
            .slice(0, 128);
        for (const folder of ownedFolders) {
            try {
                runtimes.push(await this.inventory(folder.name));
            }
            catch { /* incomplete/changed/unowned runtimes never selected */ }
        }
        return runtimes;
    }
    private async inventory(folder: string): Promise<JavaRuntime> {
        const root = await safeDestination(this.root, folder);
        const file = await safeDestination(root, "zhumeng-runtime.json");
        if ((await lstat(file)).size > 8 * 1024 * 1024)
            throw new Error("Java 库存过大");
        const data = JSON.parse(await readFile(file, "utf8")) as Inventory;
        const isMojang = (data.asset as any)?.source === "mojang";
        const identity = isMojang ? (data.asset as any).manifestSha1 : (data.asset as Asset | undefined)?.sha256;
        const identityMatches = isMojang
            ? typeof (data.asset as any).component === "string"
                && /^[a-z0-9-]{1,80}$/.test((data.asset as any).component)
                && typeof identity === "string"
                && /^[a-f0-9]{40}$/.test(identity)
                && new RegExp(`^mojang-${(data.asset as any).component}-${identity.slice(0, 16)}-[a-f0-9-]{36}$`).test(folder)
            : typeof identity === "string"
                && /^[a-f0-9]{64}$/.test(identity)
                && folder.endsWith(identity.slice(0, 16));
        if (data.schema !== 1 || !data.asset || !Array.isArray(data.files) || !data.files.length || data.files.length > 20000 || !/^bin\/java\.exe$/.test(data.executable) || !data.files.some(f => f.path === data.executable) || !identityMatches)
            throw new Error("无效受管 Java 库存");
        for (const f of data.files) {
            archivePath(f.path);
            if (!/^[a-f0-9]{64}$/.test(f.sha256) || await hashFile(await safeDestination(root, f.path)) !== f.sha256)
                throw new Error("受管 Java 文件已修改");
        }
        const runtime = await this.inspect(await safeDestination(root, data.executable));
        if (runtime.major !== data.asset.major || javaArchitecture(runtime.arch) !== "x64")
            throw new Error("受管 Java 版本不匹配");
        return runtime;
    }
    install(requirement: JavaRequirement, context: TaskContext, component?: string): Promise<JavaRuntime> {
        context.signal.throwIfAborted();
        // Different games/tasks share one family transfer, but never its subscriber's signal.
        const key = `${requirement.preferredMajor}:${requirement.maxJava8Update ?? ""}:${component ?? ""}`;
        let transfer = this.pending.get(key);
        if (!transfer || transfer.controller.signal.aborted) {
            const controller = new AbortController();
            const consumers: Acquisition["consumers"] = new Set();
            const created: Acquisition = {
                controller, consumers,
                result: Promise.resolve().then(() => this.acquire(requirement, {
                    signal: controller.signal,
                    report: (progress, rate) => {
                        for (const consumer of consumers)
                            consumer.context.report(progress, rate);
                    },
                }, component)).finally(() => {
                    if (this.pending.get(key) === created)
                        this.pending.delete(key);
                }),
            };
            // The last subscriber can cancel before acquire starts; retain no unhandled rejection.
            void created.result.catch(() => { });
            transfer = created;
            this.pending.set(key, transfer);
        }
        const acquisition = transfer;
        const consumer = { context };
        acquisition.consumers.add(consumer);
        return new Promise<JavaRuntime>((resolve, reject) => {
            let settled = false;
            const detach = () => {
                context.signal.removeEventListener("abort", abort);
                acquisition.consumers.delete(consumer);
            };
            const abort = () => {
                if (settled)
                    return;
                settled = true;
                detach();
                reject(context.signal.reason ?? new DOMException("Java 配置已取消", "AbortError"));
                if (!acquisition.consumers.size)
                    acquisition.controller.abort();
            };
            context.signal.addEventListener("abort", abort, { once: true });
            acquisition.result.then(runtime => {
                if (settled)
                    return;
                settled = true;
                detach();
                resolve(runtime);
            }, error => {
                if (settled)
                    return;
                settled = true;
                detach();
                reject(error);
            });
            if (context.signal.aborted)
                abort();
        });
    }
    private async installMojang(component: string, requirement: JavaRequirement, context: TaskContext): Promise<JavaRuntime> {
        if (!/^[a-z0-9-]{1,80}$/.test(component)) throw new Error("无效 Mojang Java runtime component");
        type RuntimeTarget = { manifest: { url: string; sha1: string; size: number }; version: { name: string; released: string } };
        type RuntimeFile = { type: "file"; executable?: boolean; downloads: { raw: { url: string; sha1: string; size: number } } } | { type: "directory" } | { type: "link"; target: string };
        const index: any = await this.network.json(MOJANG_RUNTIME_INDEX, context.signal);
        const targets = index?.["windows-x64"]?.[component];
        if (!Array.isArray(targets) || !targets.length) throw new Error("MOJANG_COMPONENT_UNAVAILABLE: no Windows runtime component");
        if (targets.length > 1000) throw new Error("Mojang runtime target list exceeds limit");
        const target = targets[0] as RuntimeTarget;
        const ref = target?.manifest;
        if (!ref || typeof ref.url !== "string" || !/^[a-f0-9]{40}$/i.test(ref.sha1) || !Number.isSafeInteger(ref.size) || ref.size < 1 || ref.size > 32 * 1024 * 1024 || typeof target.version?.name !== "string" || target.version.name.length > 128)
            throw new Error("Invalid Mojang runtime component metadata");
        const manifestUrl = this.network.validateUrl(ref.url);
        if (!["piston-meta.mojang.com", "launchermeta.mojang.com"].includes(manifestUrl.hostname) || manifestUrl.search || manifestUrl.hash || manifestUrl.port)
            throw new Error("Untrusted Mojang runtime manifest URL");
        await mkdir(this.root, { recursive: true });
        const manifestStage = await safeDestination(this.root, `.manifest-${randomUUID()}.json`);
        const stageName = `.mojang-stage-${randomUUID()}`;
        const stage = await safeDestination(this.root, stageName);
        const manifestSha1 = ref.sha1.toLowerCase();
        // Immutable generation directory: concurrent launchers and interrupted
        // installs can never replace/delete the last published runtime.
        const folder = `mojang-${component}-${manifestSha1.slice(0, 16)}-${randomUUID()}`;
        const destination = await safeDestination(this.root, folder);
        try {
            await this.network.download(this.root, { url: manifestUrl.href, path: relative(this.root, manifestStage), sha1: ref.sha1, size: ref.size }, context);
            const manifest: any = JSON.parse(await readFile(manifestStage, "utf8"));
            if (!manifest.files || typeof manifest.files !== "object" || Array.isArray(manifest.files)) throw new Error("Mojang runtime manifest identity mismatch");
            const entries = Object.entries(manifest.files) as [string, RuntimeFile][];
            if (!entries.length || entries.length > 20000) throw new Error("Mojang runtime file count exceeds limit");
            let total = 0;
            const names = new Set<string>();
            const entryTypes = new Map<string, string>();
            const files: { path: string; spec: { url: string; sha1: string; size: number } }[] = [];
            const dirs: string[] = [];
            for (const [name, entry] of entries) {
                archivePath(name);
                const key = name.toLowerCase();
                if (names.has(key)) throw new Error("Mojang runtime paths collide");
                names.add(key);
                entryTypes.set(key, String(entry?.type));
                if (entry?.type === "directory") { dirs.push(name); continue; }
                if (entry?.type === "link") {
                    // Windows x64 runtime links are not needed by supported profiles. Reject them
                    // rather than inheriting the upstream installer’s unsafe best-effort link path.
                    throw new Error("Mojang runtime includes a link entry; safe Windows repair is unavailable");
                }
                const raw = (entry as any)?.downloads?.raw;
                if (entry?.type !== "file" || !raw || typeof raw.url !== "string" || !/^[a-f0-9]{40}$/i.test(raw.sha1) || !Number.isSafeInteger(raw.size) || raw.size < 0 || raw.size > 512 * 1024 * 1024)
                    throw new Error("Invalid Mojang runtime file entry");
                total += raw.size;
                if (total > 2 * 1024 * 1024 * 1024) throw new Error("Mojang Java runtime exceeds size limit");
                const url = this.network.validateUrl(raw.url);
                if (!["piston-data.mojang.com", "launcher.mojang.com", "launchermeta.mojang.com"].includes(url.hostname) || url.search || url.hash || url.port)
                    throw new Error("Untrusted Mojang runtime file URL");
                files.push({ path: name, spec: { url: url.href, sha1: raw.sha1.toLowerCase(), size: raw.size } });
            }
            if (!files.some(file => file.path === "bin/java.exe")) throw new Error("Mojang runtime lacks bin/java.exe");
            for (const file of files) {
                const parents = file.path.split("/"); parents.pop();
                while (parents.length) {
                    const parent = parents.join("/").toLowerCase();
                    if (entryTypes.has(parent) && entryTypes.get(parent) !== "directory") throw new Error("Mojang runtime file is a parent of another entry");
                    parents.pop();
                }
            }
            // Reject files which are parents of another entry and case-insensitive collisions.
            // A normal file nested under a directory entry is expected. The
            // ancestor check above rejects only the unsafe inverse: a file
            // entry serving as the parent of another manifest path.
            await mkdir(stage);
            let prior: Inventory | undefined;
            let priorRoot: string | undefined;
            const priorPrefix = `mojang-${component}-${manifestSha1.slice(0, 16)}-`;
            for (const candidate of (await readdir(this.root, { withFileTypes: true })).filter(entry => entry.isDirectory() && !entry.isSymbolicLink() && entry.name.startsWith(priorPrefix)).slice(0, 128)) {
                try {
                    const existing = await safeDestination(this.root, candidate.name);
                    const rawInventory = JSON.parse(await readFile(await safeDestination(existing, "zhumeng-runtime.json"), "utf8")) as Inventory;
                    if (!rawInventory.asset || !("source" in rawInventory.asset) || rawInventory.asset.source !== "mojang" || rawInventory.asset.component !== component || rawInventory.asset.manifestSha1 !== manifestSha1 || !Array.isArray(rawInventory.files) || rawInventory.files.length > 20000) continue;
                    prior = rawInventory; priorRoot = existing; break;
                } catch { /* Unowned or malformed sibling is preserved and never used as a repair source. */ }
            }
            for (const dir of dirs) await mkdir(await safeDestination(stage, dir), { recursive: true });
            const previous = new Map((prior?.files ?? []).map(file => [file.path, file]));
            const inventoryFiles: Inventory["files"] = [];
            let completed = 0;
            for (const file of files) {
                context.signal.throwIfAborted();
                const targetPath = await safeDestination(stage, file.path);
                await mkdir(dirname(targetPath), { recursive: true });
                let copied = false;
                if (prior) {
                    const old = previous.get(file.path);
                    if (old?.sha1 === file.spec.sha1 && old.size === file.spec.size) {
                        try {
                            const oldPath = await safeDestination(priorRoot!, file.path), info = await lstat(oldPath);
                            if (info.isFile() && !info.isSymbolicLink() && info.size === file.spec.size) {
                                const h = createHash("sha1"); for await (const chunk of createReadStream(oldPath, { signal: context.signal })) h.update(chunk);
                                if (h.digest("hex") === file.spec.sha1) { await copyFile(oldPath, targetPath); copied = true; }
                            }
                        } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
                    }
                }
                if (!copied) await this.network.download(stage, { ...file.spec, path: relative(stage, targetPath) }, { ...context, report: (p, rate) => context.report((completed + p) / files.length, rate) });
                const sha256 = await hashFile(targetPath);
                inventoryFiles.push({ path: file.path, sha1: file.spec.sha1, size: file.spec.size, sha256 });
                context.report(++completed / files.length * 0.9);
            }
            const runtime = await this.inspect(await safeDestination(stage, "bin/java.exe"));
            if (runtime.major !== requirement.preferredMajor || !javaInRange(requirement, runtime) || javaArchitecture(runtime.arch) !== "x64") throw new Error("Mojang Java runtime version/architecture does not satisfy the requested version");
            const ownedAsset = { source: "mojang" as const, component, manifestSha1: ref.sha1.toLowerCase(), version: target.version.name, major: runtime.major };
            await writeFile(await safeDestination(stage, "zhumeng-runtime.json"), JSON.stringify({ schema: 1, asset: ownedAsset, executable: "bin/java.exe", files: inventoryFiles } satisfies Inventory), { flag: "wx" });
            context.signal.throwIfAborted();
            try { await lstat(destination); throw new Error("Java runtime generation name collision; existing directory preserved"); }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
            await rename(stage, destination);
            context.report(1);
            return { ...runtime, path: join(destination, "bin/java.exe") };
        } finally {
            await rm(manifestStage, { force: true });
            await rm(stage, { recursive: true, force: true });
        }
    }
    private async acquire(requirement: JavaRequirement, context: TaskContext, component?: string): Promise<JavaRuntime> {
        context.signal.throwIfAborted();
        const existing = (await this.list()).find(j => j.major === requirement.preferredMajor && javaInRange(requirement, j));
        if (existing)
            return existing;
        if (component && process.platform === "win32" && process.arch === "x64") {
            try { return await this.installMojang(component, requirement, context); }
            catch (error) {
                // Metadata components are authoritative when available. If Mojang has no
                // Windows x64 component (legacy Java 8 profiles), retain the Temurin path.
                if (!(error instanceof Error) || !error.message.startsWith("MOJANG_COMPONENT_UNAVAILABLE:")) throw error;
            }
        }
        const asset = await this.catalogue(requirement, context.signal);
        await mkdir(this.root, { recursive: true });
        const folder = `temurin-${asset.major}-${asset.image}-${asset.sha256.slice(0, 16)}`;
        const destination = await safeDestination(this.root, folder);
        try {
            await lstat(destination);
            throw new Error("受管 Java 目标已存在且未通过校验，请手动检查，原目录已保留");
        }
        catch (error) {
            if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                throw error;
        }
        const stage = await safeDestination(this.root, ".stage-" + randomUUID());
        await mkdir(stage);
        try {
            const boundedContext = { ...context, signal: AbortSignal.any([context.signal, AbortSignal.timeout(10 * 60 * 1000)]) };
            const zipFile = await this.network.download(stage, { url: asset.url, path: "runtime.zip", sha256: asset.sha256, size: asset.size }, boundedContext);
            const zip = await readArchive(zipFile);
            const extracted = await safeDestination(stage, "runtime");
            let files: Inventory["files"];
            try {
                const executables = zip.entries.filter(e => /^[^/]+\/bin\/java\.exe$/.test(e.fileName));
                if (executables.length !== 1)
                    throw new Error("官方 Java ZIP 必须包含唯一 bin/java.exe");
                const prefix = executables[0].fileName.split("/")[0] + "/";
                const hasCompiler = zip.entries.some(e => e.fileName === prefix + "bin/javac.exe");
                if (hasCompiler !== (asset.image === "jdk"))
                    throw new Error("Java ZIP 映像类型与官方元数据不符");
                if (zip.entries.some(e => !e.fileName.startsWith(prefix)))
                    throw new Error("Java ZIP 包含额外根目录");
                await mkdir(extracted);
                await zip.extract(extracted, prefix, boundedContext.signal);
                files = [];
                for (const entry of zip.entries.filter(e => !e.fileName.endsWith("/"))) {
                    context.signal.throwIfAborted();
                    const path = entry.fileName.slice(prefix.length);
                    files.push({ path, sha256: await hashFile(await safeDestination(extracted, path)) });
                }
            }
            finally {
                zip.close();
            }
            context.signal.throwIfAborted();
            const runtime = await this.inspect(join(extracted, "bin", "java.exe"));
            if (runtime.major !== asset.major || javaArchitecture(runtime.arch) !== "x64" || !javaInRange(requirement, runtime) || javaVersionParts(runtime.version).join(".") !== javaVersionParts(asset.version).join("."))
                throw new Error("下载 Java 的实际版本或架构与官方元数据不符");
            const inventory: Inventory = { schema: 1, asset, executable: "bin/java.exe", files };
            await writeFile(join(extracted, "zhumeng-runtime.json"), JSON.stringify(inventory), { flag: "wx" });
            await safeDestination(this.root, folder);
            context.signal.throwIfAborted();
            // Windows scanners may briefly retain java.exe after the verified -version probe.
            // Retry only lock errors, rechecking cancellation/ownership before each atomic publication.
            for (let attempt = 0;; attempt++) {
                await safeDestination(this.root, folder);
                try {
                    await lstat(destination);
                    throw new Error("Java 目标在发布前已存在，原目录已保留");
                }
                catch (error) {
                    if ((error as NodeJS.ErrnoException).code !== "ENOENT")
                        throw error;
                }
                context.signal.throwIfAborted();
                try {
                    await rename(extracted, destination);
                    break;
                }
                catch (error) {
                    if (!["EPERM", "EBUSY", "EACCES"].includes((error as NodeJS.ErrnoException).code ?? "") || attempt >= 9)
                        throw error;
                    await delay(150, undefined, { signal: context.signal });
                }
            }
            return { ...runtime, path: join(destination, "bin", "java.exe") };
        }
        finally {
            await rm(stage, { recursive: true, force: true });
        }
    }
}
