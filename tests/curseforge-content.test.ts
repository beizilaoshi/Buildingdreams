import { it, expect, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { categoryLabel } from "../src/shared/content-tags";
import {
  parseContentId,
  ContentProviders,
} from "../src/main/services/content-provider";
import {
  CurseForgeContent,
  curseForgeClasses,
} from "../src/main/services/curseforge-content";
import { ProviderSecrets } from "../src/main/services/provider-secrets";
import type { ContentKind } from "../src/shared/content";
// Synthesized from official https://docs.curseforge.com/rest-api/ Mod/File/Pagination schemas; not a live capture.
export const cfProject = (kind: ContentKind = "mod") => ({
  id: 12,
  gameId: 432,
  classId: curseForgeClasses[kind],
  name: "Native Pack 原生整合包",
  slug: "cf-native",
  summary: "Real summary",
  authors: [{ name: "Author" }],
  logo: { url: "https://images.example/logo.png" },
  links: {
    websiteUrl: "https://www.curseforge.com/minecraft/mc-mods/cf-native",
  },
  categories: [{ id: 412 }],
  downloadCount: 123,
  thumbsUpCount: 9,
  allowModDistribution: true,
});
export const cfFile = () => ({
  id: 34,
  modId: 12,
  gameId: 432,
  isAvailable: true,
  fileName: "native.jar",
  displayName: "Exact release",
  releaseType: 1,
  hashes: [{ algo: 1, value: "a".repeat(40) }],
  fileDate: "2026-10-01T00:00:00Z",
  fileLength: 5,
  downloadCount: 10,
  downloadUrl: "https://cdn.example/native.jar",
  gameVersions: ["1.21.1", "Fabric"],
  dependencies: [
    { modId: 13, relationType: 3 },
    { modId: 14, relationType: 2 },
    { modId: 15, relationType: 5 },
    { modId: 16, relationType: 1 },
    { modId: 17, relationType: 6 },
    { modId: 18, relationType: 4 },
  ],
});
const protector = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => Buffer.from(Buffer.from(s).map((x) => x ^ 85)),
  decryptString: (b: Buffer) =>
    Buffer.from(Buffer.from(b).map((x) => x ^ 85)).toString(),
};
export async function cfHarness(respond?: (url: URL) => unknown) {
  const dir = await mkdtemp(join(tmpdir(), "cf-"));
  const vault = new ProviderSecrets(join(dir, "providers.vault"), protector);
  await vault.set("fixture-only-key", false);
  const calls: { url: URL; options: RequestInit }[] = [];
  const api = new CurseForgeContent(vault, (async (input, options) => {
    const url = new URL(String(input));
    calls.push({ url, options: options! });
    const data = respond
      ? respond(url)
      : { data: url.pathname.includes("/files/") ? cfFile() : cfProject() };
    return data instanceof Response ? data : new Response(JSON.stringify(data));
  }) as typeof fetch);
  return {
    api,
    vault,
    calls,
    dir,
    clean: () => rm(dir, { recursive: true, force: true }),
  };
}
it("keeps prototype names literal and rejects mixed/noncanonical provider IDs", () => {
  for (const s of ["constructor", "toString", "__proto__"])
    expect(categoryLabel(s)).toBe(s);
  expect(parseContentId("cf:12:34", "version")).toEqual({
    provider: "curseforge",
    project: 12,
    file: 34,
  });
  for (const s of ["cf:01", "cf:0", "cf:12:34", "mr:12", "cf:9007199254740992"])
    expect(() => parseContentId(s, "project")).toThrow();
  expect(parseContentId("abc", "project").provider).toBe("modrinth");
});
it.each(Object.keys(curseForgeClasses) as ContentKind[])(
  "normalizes %s official schema with exact IDs and metadata",
  async (kind) => {
    const h = await cfHarness((u) => ({
      data: u.pathname.includes("/files/") ? cfFile() : cfProject(kind),
    }));
    try {
      const p = await h.api.project("cf:12");
      expect(p).toMatchObject({
        id: "cf:12",
        projectType: kind,
        title: "Native Pack 原生整合包",
        authors: ["Author"],
        icon_url: "https://images.example/logo.png",
        description: "Real summary",
        provider: "curseforge",
      });
      const v = await h.api.version("cf:12:34");
      expect(v).toMatchObject({
        id: "cf:12:34",
        project_id: "cf:12",
        version_type: "release",
        date_published: "2026-10-01T00:00:00Z",
        game_versions: ["1.21.1"],
        loaders: kind === "datapack" ? ["fabric", "datapack"] : ["fabric"],
        files: [
          { filename: "native.jar", size: 5, hashes: { sha1: "a".repeat(40) } },
        ],
      });
      expect(v.dependencies.map((d) => d.dependency_type)).toEqual([
        "required",
        "optional",
        "incompatible",
        "embedded",
        "embedded",
      ]);
      for (const c of h.calls) {
        expect(c.url.origin).toBe("https://api.curseforge.com");
        expect(c.url.href).not.toContain("fixture-only-key");
        expect(c.options.headers).toMatchObject({
          "x-api-key": "fixture-only-key",
        });
        expect(c.options.redirect).toBe("error");
      }
    } finally {
      await h.clean();
    }
  },
);
it.each(Object.keys(curseForgeClasses) as ContentKind[])(
  "search %s preserves class and pagination",
  async (kind) => {
    const h = await cfHarness((u) => ({
      data: [cfProject(kind)],
      pagination: {
        index: Number(u.searchParams.get("index")),
        pageSize: Number(u.searchParams.get("pageSize")),
        resultCount: 1,
        totalCount: 1,
      },
    }));
    try {
      const page = await h.api.search("native", {
        projectType: kind,
        minecraft: "1.21.1",
        loader: "neoforge",
        limit: 40,
      });
      expect(page.hits[0]).toMatchObject({
        project_id: "cf:12",
        title: "Native Pack 原生整合包",
        author: "Author",
      });
      expect(h.calls[0].url.searchParams.get("classId")).toBe(
        String(curseForgeClasses[kind]),
      );
      expect(h.calls[0].url.searchParams.get("modLoaderType")).toBe(
        ["mod", "modpack"].includes(kind) ? "6" : null,
      );
    } finally {
      await h.clean();
    }
  },
);
it("uses CF tags, never silently drops unsupported tags or illegal loader-only filters", async () => {
  const h = await cfHarness((u) => ({
    data: [],
    pagination: { index: 0, pageSize: 20, resultCount: 0, totalCount: 0 },
  }));
  try {
    await h.api.search("", {
      projectType: "modpack",
      tag: "cf-4736",
      loader: "forge",
    });
    expect(h.calls[0].url.searchParams.get("categoryId")).toBe("4736");
    expect(h.calls[0].url.searchParams.has("modLoaderType")).toBe(false);
    await expect(
      h.api.search("", { projectType: "shader", tag: "mr-pbr" }),
    ).rejects.toThrow(/标签/);
    for (const filter of [{ limit: 51 }, { offset: 9990, limit: 20 }])
      await expect(h.api.search("", filter)).rejects.toThrow(/分页/);
  } finally {
    await h.clean();
  }
});
it.each([401, 403, 429, 500, 302])(
  "sanitizes HTTP %i without response body/key",
  async (status) => {
    const h = await cfHarness(
      () => new Response("fixture-only-key private raw body", { status }),
    );
    try {
      await expect(h.api.project("cf:12")).rejects.toThrow(/CurseForge/);
      try {
        await h.api.project("cf:12");
      } catch (e) {
        expect(String(e)).not.toMatch(/fixture-only-key|private raw/);
      }
    } finally {
      await h.clean();
    }
  },
);
it.each([
  "wrong-project",
  "wrong-file",
  "wrong-game",
  "wrong-class",
  "malformed",
  "oversize",
  "oversize-header",
  "network",
])("rejects %s response", async (mode) => {
  const h = await cfHarness((u) => {
    if (mode === "network") throw new Error("fixture-only-key");
    if (mode === "oversize")
      return new Response("x".repeat(4 * 1024 * 1024 + 1));
    if (mode === "oversize-header")
      return new Response("{}", { headers: { "content-length": "9999999" } });
    if (mode === "malformed") return new Response("{");
    if (u.pathname.includes("/files/"))
      return {
        data: {
          ...cfFile(),
          ...(mode === "wrong-file"
            ? { id: 99 }
            : mode === "wrong-project"
              ? { modId: 99 }
              : {}),
        },
      };
    return {
      data: {
        ...cfProject(),
        ...(mode === "wrong-game"
          ? { gameId: 999 }
          : mode === "wrong-class"
            ? { classId: 99 }
            : {}),
      },
    };
  });
  try {
    await expect(h.api.version("cf:12:34")).rejects.toThrow();
  } finally {
    await h.clean();
  }
});
it.each(["restricted", "null-url", "unavailable", "md5"])(
  "preserves blocked %s file metadata and honest reason",
  async (mode) => {
    const h = await cfHarness((u) => ({
      data: u.pathname.includes("/files/")
        ? {
            ...cfFile(),
            ...(mode === "null-url"
              ? { downloadUrl: null }
              : mode === "unavailable"
                ? { isAvailable: false }
                : mode === "md5"
                  ? { hashes: [{ algo: 2, value: "b".repeat(32) }] }
                  : {}),
          }
        : { ...cfProject(), allowModDistribution: mode !== "restricted" },
    }));
    try {
      const v = await h.api.version("cf:12:34");
      expect(v.files[0].filename).toBe("native.jar");
      expect(v.files[0].unavailableReason).toBeTruthy();
      expect(v.files[0].website).toMatch(/^https:\/\/www.curseforge.com\//);
    } finally {
      await h.clean();
    }
  },
);
it("paginates actual versions instead of claiming first page complete", async () => {
  const h = await cfHarness((u) => {
    if (!u.pathname.endsWith("/files")) return { data: cfProject() };
    const index = Number(u.searchParams.get("index"));
    const data = Array.from({ length: index ? 2 : 50 }, (_, i) => ({
      ...cfFile(),
      id: 100 + index + i,
    }));
    return {
      data,
      pagination: {
        index,
        pageSize: 50,
        resultCount: data.length,
        totalCount: 52,
      },
    };
  });
  try {
    expect(await h.api.versions("cf:12")).toHaveLength(52);
    expect(
      h.calls.filter((c) => c.url.pathname.endsWith("/files")),
    ).toHaveLength(2);
  } finally {
    await h.clean();
  }
});
it("does not publish stale searches after key changes", async () => {
  const h = await cfHarness();
  try {
    let release!: () => void;
    const wait = new Promise<void>((r) => (release = r));
    const api = new CurseForgeContent(h.vault, (async () => {
      await wait;
      return new Response(JSON.stringify({ data: cfProject() }));
    }) as typeof fetch);
    const result = api.project("cf:12");
    await new Promise((r) => setTimeout(r, 5));
    await h.vault.clear();
    release();
    await expect(result).rejects.toThrow(/凭据已更改/);
  } finally {
    await h.clean();
  }
});
it("registry preserves bare legacy IDs and never sends malformed cf IDs to MR", async () => {
  const mr = {
      project: vi.fn(),
      version: vi.fn(),
      versions: vi.fn(),
      search: vi.fn(),
    },
    cf = { ...mr, project: vi.fn(), version: vi.fn() };
  const registry = new ContentProviders(mr, cf);
  registry.project("legacy");
  registry.project("cf:12");
  expect(mr.project).toHaveBeenCalledWith("legacy", undefined);
  expect(cf.project).toHaveBeenCalledWith("cf:12", undefined);
  expect(() => registry.project("cf:01")).toThrow();
  expect(mr.project).toHaveBeenCalledTimes(1);
});
it("vault encrypts persistence, clears both modes and rejects malformed keys", async () => {
  const h = await cfHarness();
  try {
    expect(await h.vault.status()).toMatchObject({
      configured: true,
      session: true,
      persisted: false,
    });
    await h.vault.set("fixture-only-key", true);
    expect(
      (await readFile(join(h.dir, "providers.vault"))).toString(),
    ).not.toContain("fixture-only-key");
    const loaded = new ProviderSecrets(
      join(h.dir, "providers.vault"),
      protector,
    );
    expect(await loaded.status()).toMatchObject({
      configured: true,
      persisted: true,
    });
    expect(Object.keys(await loaded.status())).toEqual([
      "configured",
      "session",
      "persisted",
      "encryption",
    ]);
    await loaded.clear();
    expect(await loaded.status()).toMatchObject({
      configured: false,
      persisted: false,
    });
    for (const key of ["short", "abc\n12345", "1234567\u007f"])
      expect(() => h.vault.set(key, false)).toThrow();
  } finally {
    await h.clean();
  }
});
it("missing key is an explicit unavailable state and encryption failure leaves session unchanged", async () => {
  const h = await cfHarness();
  try {
    await h.vault.clear();
    await expect(h.api.search("")).rejects.toThrow(/设置/);
    const vault = new ProviderSecrets(join(h.dir, "unavailable"), {
      ...protector,
      isEncryptionAvailable: () => false,
    });
    await vault.set("session-fixture", false);
    await expect(vault.set("remember-fixture", true)).rejects.toThrow(
      /加密不可用/,
    );
    expect((await vault.capture()).key).toBe("session-fixture");
  } finally {
    await h.clean();
  }
});

it("keeps original CF and MR dictionary slugs independent", async () => {
  const { parsePclDictionary } =
    await import("../src/main/services/content-localization");
  const d = parsePclDictionary("1|cf-original@mr-other|中文");
  expect(d.lookup("cf-original", "mod", "curseforge")?.chineseName).toBe(
    "中文",
  );
  expect(d.lookup("mr-other", "mod", "curseforge")).toBeUndefined();
  expect(d.lookup("mr-other", "mod")?.chineseName).toBe("中文");
});
it("vault failed persistence rolls back key and flags", async () => {
  const h = await cfHarness();
  try {
    await h.vault.set("old-session-key", false);
    const fs = await import("node:fs/promises");
    await fs.mkdir(join(h.dir, "providers.vault"));
    await expect(h.vault.set("new-persist-key", true)).rejects.toThrow(
      /保存失败/,
    );
    expect((await h.vault.capture()).key).toBe("old-session-key");
    expect(await h.vault.status()).toMatchObject({
      session: true,
      persisted: false,
    });
  } finally {
    await h.clean();
  }
});
it("strict credential IPC rejects extra fields and never returns submitted key", async () => {
  const h = await cfHarness();
  try {
    const { CommandRouter } = await import("../src/main/ipc");
    const { registerModCommands } = await import("../src/main/mod-router");
    const router = new CommandRouter();
    registerModCommands(router, {} as any, h.vault);
    for (const payload of [
      {
        provider: "curseforge",
        key: "fixture-only-key",
        remember: false,
        extra: true,
      },
      { provider: "other", key: "fixture-only-key", remember: false },
      { provider: "curseforge", key: "fixture-only-key", remember: "yes" },
    ])
      await expect(
        router.invoke("content.setProviderKey", payload),
      ).rejects.toThrow();
    const result = await router.invoke("content.setProviderKey", {
      provider: "curseforge",
      key: "fixture-only-key",
      remember: false,
    });
    expect(JSON.stringify(result)).not.toContain("fixture-only-key");
    await expect(
      router.invoke("content.clearProviderKey", {
        provider: "curseforge",
        key: "fixture-only-key",
      }),
    ).rejects.toThrow();
  } finally {
    await h.clean();
  }
});
it("sanitizes response-stream errors instead of forwarding transport secrets", async () => {
  const h = await cfHarness(
    () =>
      new Response(
        new ReadableStream({
          start(controller) {
            controller.error(new Error("fixture-only-key transport body"));
          },
        }),
      ),
  );
  try {
    let message = "";
    try {
      await h.api.project("cf:12");
    } catch (e) {
      message = String(e);
    }
    expect(message).toContain("CurseForge");
    expect(message).not.toContain("fixture-only-key");
  } finally {
    await h.clean();
  }
});
