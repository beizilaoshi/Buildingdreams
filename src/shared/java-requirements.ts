import type { JavaRuntime, LoaderKind } from "./types";
export interface JavaRequirement {
    minMajor: number;
    maxMajor?: number;
    maxJava8Update?: number;
    preferredMajor: number;
    reason: string;
}
export interface JavaRequirementInput {
    minecraft: string;
    metadataMajor?: number;
    /** Internal main-resolved explicit download family, never a renderer-supplied minimum. */
    exactMajor?: number;
    loader?: {
        kind: LoaderKind;
        version: string;
    };
    optifine?: boolean;
    liteLoader?: boolean;
}
// Source: PCL 2.12.7.3 ModLaunch.McLaunchJava; independently implemented intersection.
const compare = (a: string, b: string): number => {
    const parts = (v: string) => v.split(/[.\-+]/).map(x => /^\d+$/.test(x) ? Number(x) : x);
    const x = parts(a), y = parts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        if (x[i] === y[i])
            continue;
        if (x[i] === undefined)
            return typeof y[i] === "string" ? 1 : -1;
        if (y[i] === undefined)
            return typeof x[i] === "string" ? -1 : 1;
        if (typeof x[i] === "number" && typeof y[i] === "number")
            return Number(x[i]) - Number(y[i]);
        return String(x[i]).localeCompare(String(y[i]), "en");
    }
    return 0;
};
export function javaRequirement(input: JavaRequirementInput): JavaRequirement {
    const match = /^1\.(\d+)(?:\.(\d+))?$/.exec(input.minecraft);
    const minor = match ? Number(match[1]) : undefined;
    const patch = match ? Number(match[2] ?? 0) : 0;
    const modern = minor !== undefined && (minor > 20 || minor === 20 && patch >= 5);
    let minMajor = modern ? 21 : minor !== undefined && minor >= 18 ? 17 : minor === 17 ? 16 : minor !== undefined && minor >= 12 ? 8 : 0;
    let preferredMajor = minMajor || 8;
    let maxMajor: number | undefined = minor !== undefined && (minor < 5 || minor === 5 && patch <= 2) ? 8 : undefined;
    let maxJava8Update: number | undefined;
    const reasons = [minor === undefined ? "自定义/快照版本：未知版本规则，以实际元数据为准" : `Minecraft ${input.minecraft} 推荐 Java ${preferredMajor}`];
    if (input.metadataMajor !== undefined) {
        if (!Number.isInteger(input.metadataMajor) || input.metadataMajor < 1 || input.metadataMajor > 99)
            throw new Error("无效 Java 元数据");
        minMajor = Math.max(minMajor, input.metadataMajor);
        preferredMajor = Math.max(preferredMajor, minMajor);
        reasons.push(`实际版本元数据最低 Java ${input.metadataMajor}`);
    }
    const cap = (major: number) => { maxMajor = Math.min(maxMajor ?? Infinity, major); };
    const loader = input.loader;
    if (loader?.kind === "forge") {
        const v = loader.version;
        if (minor !== undefined && (minor === 6 && patch >= 1 || minor === 7 && patch <= 2)) {
            minMajor = Math.max(minMajor, 7);
            cap(7);
        }
        else if (minor === undefined || minor <= 12)
            cap(8);
        else if (minor <= 14) {
            minMajor = Math.max(minMajor, 8);
            cap(10);
        }
        else if (minor === 15) {
            minMajor = Math.max(minMajor, 8);
            cap(15);
        }
        else if (compare(v, "34.0.0") >= 0 && compare(v, "36.2.25") <= 0) {
            cap(8);
            maxJava8Update = 320;
        }
        else if (compare(v, "36.2.26") >= 0 && compare(v, "37.0.0") < 0)
            cap(23);
        else if (compare(v, "37.0.0") >= 0 && compare(v, "37.0.79") <= 0)
            cap(16);
        else if (minor === 18 && input.optifine)
            cap(18);
        else if (compare(v, "45.0.21") >= 0 && compare(v, "45.0.65") <= 0)
            cap(19);
        else if (compare(v, "45.0.66") >= 0 && compare(v, "47.4.8") <= 0)
            cap(21);
        reasons.push(`Forge ${v} 兼容范围`);
    }
    if (loader?.kind === "neoforge" && (input.minecraft === "1.20.1" || !loader.version.includes("25w14craftmine") && compare(loader.version, "20.2.62-beta") <= 0)) {
        cap(21);
        reasons.push("早期 NeoForge 最高 Java 21");
    }
    if (input.optifine && minor !== undefined) {
        if (minor < 7 || minor === 12)
            cap(8);
        else if (minor >= 8 && minor < 12) {
            minMajor = Math.max(minMajor, 8);
            cap(8);
        }
    }
    if (input.liteLoader && minor !== undefined)
        cap(8);
    if (input.exactMajor !== undefined) {
        if (!Number.isInteger(input.exactMajor) || input.exactMajor < 1 || input.exactMajor > 99)
            throw new Error("无效 Java 下载系列");
        minMajor = Math.max(minMajor, input.exactMajor);
        cap(input.exactMajor);
        preferredMajor = input.exactMajor;
        reasons.push(`明确下载 Java ${input.exactMajor} 系列`);
    }
    if (minMajor > (maxMajor ?? Infinity))
        throw new Error(`Java 要求冲突：元数据/游戏最低 Java ${minMajor}，加载器最高 Java ${maxMajor}`);
    preferredMajor = Math.max(minMajor, Math.min(preferredMajor, maxMajor ?? Infinity));
    return { minMajor, maxMajor, maxJava8Update, preferredMajor, reason: reasons.join("；") };
}
export function javaVersionParts(version: string): number[] {
    const legacy = /^1\.(\d+)\.\d+(?:_(\d+))?(?:[-+]b?(\d+))?/.exec(version);
    if (legacy)
        return [Number(legacy[1]), 0, Number(legacy[2] ?? 0), Number(legacy[3] ?? 0)];
    const [base, build] = version.split("+");
    const parts = base.split(/[.\-]/).slice(0, 3).map(x => Number(x) || 0);
    return [parts[0] ?? 0, parts[1] ?? 0, parts[2] ?? 0, Number(build?.split("-")[0]) || 0];
}
export function javaArchitecture(arch: string): "x64" | "ia32" | "arm64" | "unknown" {
    if (/^(amd64|x86_64|x64)$/i.test(arch))
        return "x64";
    if (/^(x86|i[3-6]86|ia32)$/i.test(arch))
        return "ia32";
    if (/^(aarch64|arm64)$/i.test(arch))
        return "arm64";
    return "unknown";
}
export function javaInRange(r: JavaRequirement, j: JavaRuntime): boolean {
    return j.major >= r.minMajor && j.major <= (r.maxMajor ?? Infinity) && !(j.major === 8 && r.maxJava8Update !== undefined && javaVersionParts(j.version)[2] > r.maxJava8Update);
}
export function selectJava(r: JavaRequirement, candidates: JavaRuntime[], memoryMb: number, hostArch: string, manual?: JavaRuntime): JavaRuntime | undefined {
    const architecture = (j: JavaRuntime) => {
        const a = javaArchitecture(j.arch);
        return a !== "unknown" && (a === hostArch || hostArch === "x64" && a === "ia32") && !(a === "ia32" && memoryMb > 1400);
    };
    if (manual) {
        if (!javaInRange(r, manual))
            throw new Error(`手动 Java 不兼容：需要 Java ${r.minMajor || r.preferredMajor}${r.maxMajor ? `–${r.maxMajor}` : "+"}${r.maxJava8Update ? `（8u${r.maxJava8Update} 以下）` : ""}，已选择 ${manual.version}`);
        if (!architecture(manual))
            throw new Error("手动 Java 架构不兼容，或 32 位 Java 不支持此内存设置");
        return manual;
    }
    return candidates.filter(j => javaInRange(r, j) && architecture(j)).sort((a, b) => {
        const family = (j: JavaRuntime) => j.major === r.preferredMajor ? 0 : 1;
        const arch = (j: JavaRuntime) => javaArchitecture(j.arch) === hostArch ? 0 : 1;
        const priority = arch(a) - arch(b) || family(a) - family(b) || Math.abs(a.major - r.preferredMajor) - Math.abs(b.major - r.preferredMajor);
        if (priority)
            return priority;
        const x = javaVersionParts(a.version), y = javaVersionParts(b.version);
        for (let i = 0; i < 4; i++)
            if (x[i] !== y[i])
                return y[i] - x[i];
        return a.path.toLowerCase().localeCompare(b.path.toLowerCase(), "en");
    })[0];
}
