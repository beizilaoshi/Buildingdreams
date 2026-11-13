import { createHash, randomUUID } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile, rename, rm, lstat } from "node:fs/promises";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import type { JavaRuntime } from "../../shared/types";
import { javaArchitecture, javaInRange, javaVersionParts, type JavaRequirement } from "../../shared/java-requirements";
import { readArchive, archivePath } from "./archive";
import { NetworkService, safeDestination } from "./network";
import type { TaskContext } from "./tasks";
const HOSTS = ["api.adoptium.net", "github.com", "release-assets.githubusercontent.com", "objects.githubusercontent.com"];
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
    asset: Asset;
    executable: string;
    files: {
        path: string;
        sha256: string;
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
        for (const folder of folders.slice(0, 128)) {
            if (!folder.isDirectory() || folder.isSymbolicLink() || !/^temurin-\d+-(jre|jdk)-[a-f0-9]{16}$/.test(folder.name))
                continue;
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
        if (data.schema !== 1 || !data.asset || !Array.isArray(data.files) || !data.files.length || data.files.length > 20000 || !/^bin\/java\.exe$/.test(data.executable) || !data.files.some(f => f.path === data.executable) || !folder.endsWith(data.asset.sha256.slice(0, 16)))
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
    install(requirement: JavaRequirement, context: TaskContext): Promise<JavaRuntime> {
        context.signal.throwIfAborted();
        // Different games/tasks share one family transfer, but never its subscriber's signal.
        const key = `${requirement.preferredMajor}:${requirement.maxJava8Update ?? ""}`;
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
                })).finally(() => {
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
    private async acquire(requirement: JavaRequirement, context: TaskContext): Promise<JavaRuntime> {
        context.signal.throwIfAborted();
        const existing = (await this.list()).find(j => j.major === requirement.preferredMajor && javaInRange(requirement, j));
        if (existing)
            return existing;
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
