import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, realpath } from "node:fs/promises";
import { join, delimiter, basename, dirname } from "node:path";
import type { JavaRuntime, JavaPlan } from "../../shared/types";
import { javaRequirement, selectJava, type JavaRequirementInput } from "../../shared/java-requirements";
import type { JavaRuntimeService } from "./java-runtime";
import type { TaskContext, TaskService } from "./tasks";
const exec = promisify(execFile);
export function parseJavaOutput(path: string, output: string): JavaRuntime {
    const version = output.match(/java.runtime.version\s*=\s*(\S+)/)?.[1] ?? output.match(/(?:java|openjdk) version "([^"]+)"/)?.[1];
    if (!version)
        throw new Error("无法识别 Java 版本");
    const major = Number(version.startsWith("1.") ? version.split(".")[1] : version.split(/[.\-+]/)[0]);
    if (!Number.isInteger(major) || major < 1)
        throw new Error("无效 Java 版本");
    return { path, version, major, arch: output.match(/os.arch\s*=\s*(\S+)/)?.[1] ?? "unknown" };
}
export interface JavaResolveOptions {
    /** Main-only caller ownership, never accepted from renderer. */
    ownerScope?: string;
    memoryMb: number;
    manualPath?: string;
    autoDownload?: boolean;
    context?: TaskContext;
    roots?: string[];
}
/** Shared boundary used by launch, processors and the Java configuration panel. */
export class JavaService {
    private configuring = new Map<string, string>();
    constructor(private managed?: JavaRuntimeService, private tasks?: TaskService) { }
    async inspect(executable: string): Promise<JavaRuntime> {
        // javaw intentionally has no console output; probe the console binary from the SAME installation.
        const candidate = /^javaw\.exe$/i.test(basename(executable)) ? join(dirname(executable), "java.exe") : executable;
        const path = await realpath(candidate);
        const { stdout, stderr } = await exec(path, ["-XshowSettings:properties", "-version"], { timeout: 10000, maxBuffer: 131072, windowsHide: true, shell: false });
        const output = stdout + "\n" + stderr;
        return parseJavaOutput(path, output);
    }
    async detect(roots: string[] = []): Promise<JavaRuntime[]> {
        const executable = process.platform === "win32" ? "java.exe" : "java";
        const candidates = new Set<string>((process.env.PATH ?? "").split(delimiter).filter(Boolean).slice(0, 128).map(p => join(p, executable)));
        if (process.env.JAVA_HOME)
            candidates.add(join(process.env.JAVA_HOME, "bin", executable));
        const bases = process.platform === "win32" ? ["Java", "Eclipse Adoptium", "Microsoft", "Zulu", "BellSoft", "Amazon Corretto", "Semeru"].flatMap(vendor => [process.env.ProgramFiles ?? "C:\\Program Files", process.env["ProgramFiles(x86)"] ?? "C:\\Program Files (x86)"].map(base => join(base, vendor))) : [];
        for (const base of bases) {
            try {
                for (const entry of (await readdir(base, { withFileTypes: true })).slice(0, 64))
                    if (entry.isDirectory() && !entry.isSymbolicLink())
                        candidates.add(join(base, entry.name, "bin", executable));
            }
            catch { /* optional vendor */ }
        }
        // Bounded known locations only; no recursive drive crawl or official-launcher runtime scan.
        for (const root of roots.slice(0, 4))
            for (const folder of ["java", "jre", "jdk", "runtime/java", "runtime/jre"])
                candidates.add(join(root, folder, "bin", executable));
        const managed = await this.managed?.list() ?? [];
        const results: JavaRuntime[] = [...managed];
        const paths = [...candidates].slice(0, 256);
        let next = 0;
        await Promise.all(Array.from({ length: 4 }, async () => {
            while (next < paths.length) {
                const path = paths[next++];
                try {
                    results.push(await this.inspect(path));
                }
                catch { /* one broken executable must not hide good runtimes */ }
            }
        }));
        return [...new Map(results.map(j => [j.path.toLowerCase(), j])).values()];
    }
    async plan(input: JavaRequirementInput, options: JavaResolveOptions): Promise<JavaPlan> {
        const requirement = javaRequirement(input);
        const detected = options.manualPath ? [] : await this.detect(options.roots);
        let selected: JavaRuntime | undefined, error: string | undefined;
        try {
            const manual = options.manualPath ? await this.inspect(options.manualPath) : undefined;
            selected = selectJava(requirement, detected, options.memoryMb, process.arch, manual);
        }
        catch (e) {
            error = `手动 Java 不可用：${e instanceof Error ? e.message : String(e)}；请选择有效路径或切换自动选择`;
        }
        return { requirement, detected, selected, mode: options.manualPath ? "manual" : "auto", autoDownload: options.autoDownload !== false, reason: error ?? (selected ? `${options.manualPath ? "使用手动指定" : "自动选择兼容运行环境"} Java ${selected.version} · ${selected.arch}` : `未找到兼容 Java ${requirement.preferredMajor}${options.autoDownload === false ? "；自动下载已关闭" : "；自动配置将在任务中下载并校验官方运行环境"}`), error };
    }
    ensure(input: JavaRequirementInput, options?: JavaResolveOptions): string {
        if (!this.managed || !this.tasks)
            throw new Error("Java 自动下载服务尚未连接");
        const requirement = javaRequirement(input);
        const key = JSON.stringify([requirement, options?.manualPath, options?.memoryMb, options?.autoDownload, options?.ownerScope]);
        const active = this.configuring.get(key);
        if (active)
            return active;
        const id = this.tasks.start(`自动配置 Java ${requirement.preferredMajor}（Eclipse Temurin）`, async (context) => {
            try {
                if (options) {
                    const plan = await this.plan(input, options);
                    context.signal.throwIfAborted();
                    if (plan.error)
                        throw new Error(plan.error);
                    if (plan.selected)
                        return plan.selected;
                    if (options.autoDownload === false)
                        throw new Error(`需要 Java ${requirement.preferredMajor}；自动下载已关闭`);
                }
                if (process.platform !== "win32" || process.arch !== "x64")
                    throw new Error("自动下载目前支持 Windows x64，请手动指定 Java");
                return await this.managed!.install(requirement, context);
            }
            finally {
                this.configuring.delete(key);
            }
        });
        this.configuring.set(key, id);
        return id;
    }
    async resolve(input: JavaRequirementInput, options: JavaResolveOptions): Promise<JavaRuntime> {
        options.context?.signal.throwIfAborted();
        const plan = await this.plan(input, options);
        options.context?.signal.throwIfAborted();
        if (plan.error)
            throw new Error(plan.error);
        if (plan.selected)
            return plan.selected;
        if (options.autoDownload === false || !this.managed || !this.tasks)
            throw new Error(`需要 Java ${plan.requirement.preferredMajor}；${plan.reason}`);
        if (process.platform !== "win32" || process.arch !== "x64")
            throw new Error("自动下载目前支持 Windows x64；请手动选择当前系统兼容的 Java");
        const id = this.ensure(input, options.ownerScope ? { ...options, context: undefined } : undefined);
        const abort = () => { void this.tasks!.cancel(id); };
        options.context?.signal.addEventListener("abort", abort, { once: true });
        try {
            const runtime = await this.tasks.wait<JavaRuntime>(id);
            options.context?.signal.throwIfAborted();
            return runtime;
        }
        finally {
            options.context?.signal.removeEventListener("abort", abort);
        }
    }
    async managedList(): Promise<JavaRuntime[]> { return this.managed?.list() ?? []; }
}
