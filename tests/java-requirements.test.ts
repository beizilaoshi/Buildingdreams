import { describe, expect, it } from "vitest";
import * as rules from "../src/shared/java-requirements";
import type { JavaRuntime } from "../src/shared/types";
const runtime = (version: string, arch = "amd64"): JavaRuntime => ({ path: version + arch, version, major: Number(version.startsWith("1.") ? version.split(".")[1] : version.split(/[.+_-]/)[0]), arch });
describe("PCL requirement intersection and family ranking", () => {
    it.each([["1.12.2", 8], ["1.17", 16], ["1.18", 17], ["1.20.4", 17], ["1.20.5", 21], ["26.1", 25]])("selects %s recommended family rather than highest installed", (minecraft, expected) => {
        const requirement = rules.javaRequirement({ minecraft, metadataMajor: minecraft === "26.1" ? 25 : undefined });
        expect(rules.selectJava(requirement, [runtime("21.0.6+7"), runtime("1.8.0_302-b08"), runtime("16.0.2+7"), runtime("17.0.14+7"), runtime("25.0.1+8")], 4096, "x64")?.major).toBe(expected);
    });
    it.each([
        ["1.5.2", undefined, 8], ["1.6.1", "9.0.0", 7], ["1.7.2", "10.0.0", 7], ["1.12.2", "14.23.5", 8], ["1.14.4", "28.0.0", 10], ["1.15.2", "31.0.0", 15], ["1.16.5", "36.2.25", 8], ["1.16.5", "36.2.26", 23], ["1.17.1", "37.0.79", 16], ["1.19.4", "45.0.65", 19], ["1.20.1", "47.4.8", 21],
    ])("bounds %s Forge %s", (minecraft, forge, max) => {
        const r = rules.javaRequirement({ minecraft, loader: forge ? { kind: "forge", version: forge } : undefined });
        expect(r.maxMajor).toBe(max);
        expect(rules.selectJava(r, [runtime(String(max + 1))], 1024, "x64")).toBeUndefined();
    });
    it("checks Java 8 update cap and accurately ranks build/patch", () => {
        const r = rules.javaRequirement({ minecraft: "1.16.5", loader: { kind: "forge", version: "36.2.25" } });
        expect(rules.selectJava(r, [runtime("1.8.0_321-b01"), runtime("1.8.0_320-b09"), runtime("1.8.0_320-b10")], 1024, "x64")?.version).toBe("1.8.0_320-b10");
    });
    it("orders NeoForge beta and release at the cap boundary", () => {
        for (const version of ["20.2.61-beta", "20.2.62-beta"])
            expect(rules.javaRequirement({ minecraft: "1.20.2", loader: { kind: "neoforge", version } }).maxMajor).toBe(21);
        expect(rules.javaRequirement({ minecraft: "1.20.2", loader: { kind: "neoforge", version: "20.2.62" } }).maxMajor).toBeUndefined();
    });
    it("rejects metadata/loader conflicts and describes unknown metadata honestly", () => {
        expect(() => rules.javaRequirement({ minecraft: "1.17.1", metadataMajor: 17, loader: { kind: "forge", version: "37.0.1" } })).toThrow("冲突");
        expect(rules.javaRequirement({ minecraft: "CustomVersion" }).reason).toContain("未知");
    });
    it("rejects wrong architecture and 32-bit high heap, preserving compatible manual choice", () => {
        const r = rules.javaRequirement({ minecraft: "1.18" });
        expect(rules.selectJava(r, [runtime("17", "aarch64"), runtime("17", "unknown"), runtime("17", "x86")], 4096, "x64")).toBeUndefined();
        expect(rules.selectJava(r, [runtime("17", "x86"), runtime("17", "amd64")], 1024, "x64")?.arch).toBe("amd64");
        expect(rules.selectJava(r, [runtime("17")], 1024, "ia32")).toBeUndefined();
        expect(rules.selectJava(r, [runtime("17"), runtime("21")], 1024, "x64", runtime("21"))?.major).toBe(21);
        expect(() => rules.selectJava(r, [runtime("17")], 1024, "x64", runtime("8"))).toThrow("Java 17");
    });
});
it("explicit family acquisition excludes game-compatible higher families", () => {
    const only21 = [runtime("21.0.10+8")];
    expect(rules.selectJava(rules.javaRequirement({ minecraft: "1.18" }), only21, 1024, "x64")?.major).toBe(21);
    expect(rules.selectJava(rules.javaRequirement({ minecraft: "手动下载运行环境", metadataMajor: 17, exactMajor: 17 }), only21, 1024, "x64")).toBeUndefined();
});
