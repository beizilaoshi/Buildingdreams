import { afterEach, expect, it, vi } from "vitest";
import { mkdtemp, readFile, readdir, rm, writeFile, rename } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
import { getEventListeners } from "node:events";
import { JavaRuntimeService } from "../src/main/services/java-runtime";
import { JavaService } from "../src/main/services/java";
import { NetworkService } from "../src/main/services/network";
import { TaskService } from "../src/main/services/tasks";
import { javaRequirement } from "../src/shared/java-requirements";
vi.mock("node:fs/promises", async (importOriginal) => { const actual = await importOriginal<typeof import("node:fs/promises")>(); return { ...actual, rename: vi.fn(actual.rename) }; });
const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(p => rm(p, { recursive: true, force: true }))); });
const checksum = (b: Buffer) => createHash("sha256").update(b).digest("hex");
async function fixture(options: {
    badHash?: boolean;
    wrongJava?: boolean;
    unsafe?: boolean;
    noJre?: boolean;
    badMetadata?: string;
    redirect?: boolean;
    wrongImage?: boolean;
    beforeInspect?: () => void;
    downloadGate?: (signal: AbortSignal) => Promise<void>;
} = {}) {
    const root = await mkdtemp(join(tmpdir(), "zhumeng-java-"));
    roots.push(root);
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from("fixture Java 17 bytes, NEVER executed"), "jdk-17-jre/bin/java.exe");
    zip.addBuffer(Buffer.from("license preserved"), "jdk-17-jre/legal/LICENSE");
    if (options.noJre && !options.wrongImage)
        zip.addBuffer(Buffer.from("fixture compiler, NEVER executed"), "jdk-17-jre/bin/javac.exe");
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream)
        chunks.push(Buffer.from(chunk));
    let bytes = Buffer.concat(chunks);
    if (options.unsafe)
        bytes = Buffer.from(bytes.toString("latin1").replaceAll("legal/LICENSE", "../xx/LICENSE"), "latin1");
    let archives = 0, queries: string[] = [];
    const network = new NetworkService({ fetch: (async (url, init) => {
            const u = String(url);
            if (u.includes("assets/latest")) {
                queries.push(u);
                if (options.noJre && u.includes("image_type=jre"))
                    return Response.json([]);
                const image = u.includes("image_type=jdk") ? "jdk" : "jre";
                const data = { vendor: "eclipse", version: { major: 17, openjdk_version: "17.0.15+6" }, binary: { architecture: "x64", os: "windows", image_type: image, jvm_impl: "hotspot", package: { name: `OpenJDK17U-${image}_x64_windows_hotspot_17.0.15_6.zip`, link: `https://github.com/adoptium/temurin17-binaries/releases/download/jdk-17.0.15%2B6/OpenJDK17U-${image}_x64_windows_hotspot_17.0.15_6.zip`, checksum: options.badHash ? "a".repeat(64) : checksum(bytes), size: bytes.length } } };
                if (options.badMetadata === "major")
                    data.version.major = 21;
                if (options.badMetadata === "url")
                    data.binary.package.link = "https://evil.example/runtime.zip";
                if (options.badMetadata === "vendor")
                    data.vendor = "unknown";
                if (options.badMetadata === "filename")
                    data.binary.package.link = data.binary.package.link.replace("OpenJDK17U", "AnotherRuntime");
                if (options.badMetadata === "arch")
                    data.binary.architecture = "aarch64";
                return Response.json([data]);
            }
            if (options.redirect)
                return new Response(null, { status: 302, headers: { location: "https://evil.example/payload.zip" } });
            init?.signal?.throwIfAborted();
            archives++;
            await options.downloadGate?.(init!.signal!);
            return new Response(bytes);
        }) as typeof fetch });
    const inspect = vi.fn(async (path: string) => { options.beforeInspect?.(); return { path, version: options.wrongJava ? "21.0.1+2" : "17.0.15+6", major: options.wrongJava ? 21 : 17, arch: "amd64" }; });
    const service = new JavaRuntimeService(root, network, inspect);
    return { root, service, inspect, queries, archives: () => archives, bytes };
}
const r = javaRequirement({ minecraft: "1.18" });
const context = (controller = new AbortController()) => ({ signal: controller.signal, report: () => { } });
it("verifies official ZIP, inspects only extracted bytes, preserves licenses and reuses inventory after restart", async () => {
    const f = await fixture();
    const result = await f.service.install(r, context());
    expect(result.major).toBe(17);
    expect(await readFile(join(result.path, "../../legal/LICENSE"), "utf8")).toBe("license preserved");
    expect(f.archives()).toBe(1);
    const again = new JavaRuntimeService(f.root, new NetworkService(), f.inspect);
    expect((await again.list())[0].path).toBe(result.path);
    expect((await f.service.install(r, context())).path).toBe(result.path);
    expect(f.archives()).toBe(1);
    await writeFile(result.path, "modified");
    expect(await again.list()).toEqual([]);
});
it.each(["badHash", "unsafe", "wrongJava", "redirect"] as const)("never publishes or executes unverified %s", async (key) => {
    const f = await fixture({ [key]: true });
    await expect(f.service.install(r, context())).rejects.toThrow();
    expect(await f.service.list()).toEqual([]);
    expect(await readdir(f.root)).toEqual([]);
    if (key !== "wrongJava")
        expect(f.inspect).not.toHaveBeenCalled();
});
it.each(["major", "vendor", "url", "arch", "filename"])("rejects official metadata mismatching %s", async (badMetadata) => {
    const f = await fixture({ badMetadata });
    await expect(f.service.install(r, context())).rejects.toThrow();
    expect(f.archives()).toBe(0);
});
it("uses JDK archive fallback only when JRE list is empty", async () => {
    const f = await fixture({ noJre: true });
    await f.service.install(r, context());
    expect(f.queries.some(q => q.includes("image_type=jdk"))).toBe(true);
});
it("deduplicates concurrent downloads and does not overwrite an owned or unowned existing target", async () => {
    const f = await fixture();
    const [a, b] = await Promise.all([f.service.install(r, context()), f.service.install(r, context())]);
    expect(a.path).toBe(b.path);
    expect(f.archives()).toBe(1);
    await writeFile(a.path, "tampered");
    await expect(f.service.install(r, context())).rejects.toThrow();
    expect(await readFile(a.path, "utf8")).toBe("tampered");
});
it("final cancellation after inspection prevents publication and retains an older runtime", async () => {
    const abort = new AbortController();
    const f = await fixture({ beforeInspect: () => abort.abort() });
    await writeFile(join(f.root, "old-runtime-sentinel"), "old");
    await expect(f.service.install(r, context(abort))).rejects.toThrow();
    await vi.waitFor(async () => expect(await readdir(f.root)).toEqual(["old-runtime-sentinel"]));
});
it("refuses unsupported Java 7 and unavailable 8u320 instead of acquiring incompatible Java", async () => {
    const f = await fixture();
    await expect(f.service.install(javaRequirement({ minecraft: "1.6.1", loader: { kind: "forge", version: "9" } }), context())).rejects.toThrow("手动");
    await expect(f.service.install(javaRequirement({ minecraft: "1.16.5", loader: { kind: "forge", version: "36.2.25" } }), context())).rejects.toThrow();
    expect(f.archives()).toBe(0);
});
it("production resolver uses managed runtime and task cancellation blocks auto-acquire, disabled mode explains prerequisite", async () => {
    const f = await fixture();
    const tasks = new TaskService();
    const java = new JavaService(f.service, tasks);
    vi.spyOn(java, "detect").mockResolvedValue([]);
    await expect(java.resolve({ minecraft: "1.18" }, { memoryMb: 4096, autoDownload: false })).rejects.toThrow("Java 17");
    const runtime = await java.resolve({ minecraft: "1.18" }, { memoryMb: 4096, autoDownload: true });
    expect(runtime.major).toBe(17);
    expect(tasks.list().at(-1)?.status).toBe("completed");
});
it("retains actual Java runtime patch and build instead of the shortened -version header", async () => {
    const { parseJavaOutput } = await import("../src/main/services/java");
    expect(parseJavaOutput("java.exe", '    java.runtime.version = 17.0.21+9\n    os.arch = amd64\nopenjdk version "17.0.21" 2026-10-20\nOpenJDK Runtime Environment Temurin-17.0.21+9 (build 17.0.21+9)')).toMatchObject({ version: "17.0.21+9", major: 17, arch: "amd64" });
});
it("retries transient Windows publication locks without redownloading or executing twice", async () => {
    const f = await fixture();
    const actual = await vi.importActual<typeof import("node:fs/promises")>("node:fs/promises");
    let locked = true;
    vi.mocked(rename).mockImplementation(async (a, b) => {
        if (locked && String(a).endsWith("runtime")) {
            locked = false;
            throw Object.assign(new Error("locked"), { code: "EPERM" });
        }
        return actual.rename(a, b);
    });
    const result = await f.service.install(r, context());
    expect(result.major).toBe(17);
    expect(f.archives()).toBe(1);
    expect(f.inspect).toHaveBeenCalledTimes(1);
});
it("a target appearing during final inspection is retained and owned staging is removed", async () => {
    const f = await fixture();
    f.inspect.mockImplementationOnce(async (path) => {
        const { mkdir } = await import("node:fs/promises");
        const target = join(f.root, "temurin-17-jre-" + checksum(f.bytes).slice(0, 16));
        await mkdir(target);
        await writeFile(join(target, "user-sentinel"), "retain");
        return { path, version: "17.0.15+6", major: 17, arch: "amd64" };
    });
    await expect(f.service.install(r, context())).rejects.toThrow("已存在");
    const folders = await readdir(f.root);
    expect(folders).toHaveLength(1);
    expect(await readFile(join(f.root, folders[0], "user-sentinel"), "utf8")).toBe("retain");
});
it("JDK fallback rejects a JRE-shaped image before inspecting any executable", async () => {
    const f = await fixture({ noJre: true, wrongImage: true });
    await expect(f.service.install(r, context())).rejects.toThrow("映像");
    expect(f.inspect).not.toHaveBeenCalled();
    expect(await readdir(f.root)).toEqual([]);
});
function transferGate() {
    let release = () => { };
    let aborted = false;
    const wait = (signal: AbortSignal) => new Promise<void>((resolve, reject) => {
        const abort = () => { aborted = true; signal.removeEventListener("abort", abort); reject(signal.reason); };
        release = () => { signal.removeEventListener("abort", abort); resolve(); };
        signal.addEventListener("abort", abort, { once: true });
        if (signal.aborted)
            abort();
    });
    return { wait, release: () => release(), aborted: () => aborted };
}
it.each(["owner", "follower"] as const)("cancels only the %s subscriber while one verified transfer serves the other", async (cancelled) => {
    const gate = transferGate(), f = await fixture({ downloadGate: gate.wait });
    const a = new AbortController(), b = new AbortController();
    const one = f.service.install(r, context(a)), two = f.service.install(javaRequirement({ minecraft: "1.20.4" }), context(b));
    let aCancelled = false, bCancelled = false;
    const outcomeA = one.catch(e => { aCancelled = true; return e; }), outcomeB = two.catch(e => { bCancelled = true; return e; });
    try {
        await vi.waitFor(() => expect(f.archives()).toBe(1));
        (cancelled === "owner" ? a : b).abort();
        await vi.waitFor(() => expect(cancelled === "owner" ? aCancelled : bCancelled).toBe(true), { timeout: 250 });
        expect(gate.aborted()).toBe(false);
        expect(cancelled === "owner" ? bCancelled : aCancelled).toBe(false);
    }
    finally {
        gate.release();
        await Promise.all([outcomeA, outcomeB]);
    }
    const runtime = await (cancelled === "owner" ? two : one);
    expect(runtime.major).toBe(17);
    expect(await readFile(runtime.path, "utf8")).toBe("fixture Java 17 bytes, NEVER executed");
    expect(f.archives()).toBe(1);
    expect(f.inspect).toHaveBeenCalledTimes(1);
    expect(getEventListeners(a.signal, "abort")).toHaveLength(0);
    expect(getEventListeners(b.signal, "abort")).toHaveLength(0);
});
it("all subscribers cancelling aborts the shared transfer and removes only owned staging", async () => {
    const gate = transferGate(), f = await fixture({ downloadGate: gate.wait });
    const a = new AbortController(), b = new AbortController();
    await writeFile(join(f.root, "old-sentinel"), "retain");
    const one = f.service.install(r, context(a)).catch(e => e), two = f.service.install(r, context(b)).catch(e => e);
    try {
        await vi.waitFor(() => expect(f.archives()).toBe(1));
        a.abort();
        b.abort();
        await Promise.all([one, two]);
        await vi.waitFor(() => expect(gate.aborted()).toBe(true), { timeout: 250 });
        await vi.waitFor(async () => expect(await readdir(f.root)).toEqual(["old-sentinel"]));
        expect(f.inspect).not.toHaveBeenCalled();
        expect(f.archives()).toBe(1);
        expect(getEventListeners(a.signal, "abort")).toHaveLength(0);
        expect(getEventListeners(b.signal, "abort")).toHaveLength(0);
    }
    finally {
        gate.release();
        await Promise.all([one, two]);
    }
});
