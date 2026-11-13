import { it, expect } from "vitest";
import { parsePack } from "../src/main/services/packs";
it("parses client environment and dependencies", () => {
  const p = parsePack(
    {
      formatVersion: 1,
      game: "minecraft",
      name: "Demo",
      versionId: "1",
      dependencies: { minecraft: "1.20.1", "fabric-loader": "0.15.0" },
      files: [],
    },
    "modrinth",
  );
  expect(p.minecraft).toBe("1.20.1");
  expect(p.loader?.kind).toBe("fabric");
});
it("CurseForge lists exact required file identities", () => {
  const p = parsePack(
    {
      manifestType: "minecraftModpack",
      manifestVersion: 1,
      name: "CF",
      minecraft: { version: "1.20.1", modLoaders: [] },
      files: [{ projectID: 12, fileID: 34, required: true }],
    },
    "curseforge",
  );
  expect(p.missingFiles).toEqual([{ projectID: 12, fileID: 34 }]);
});
it("rejects malformed packs", () =>
  expect(() => parsePack({}, "modrinth")).toThrow());
import {
  mkdtemp,
  readFile,
  writeFile,
  mkdir,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { ZipFile } from "yazl";
import { PackService } from "../src/main/services/packs";
import { readArchive } from "../src/main/services/archive";
import { InstallService } from "../src/main/services/install";
import { InstanceService } from "../src/main/services/instances";
import { TaskService } from "../src/main/services/tasks";
import { NetworkService } from "../src/main/services/network";
import { vi } from "vitest";
import { ModService } from "../src/main/services/mods";
import { ModrinthService } from "../src/main/services/modrinth";
import { CommandRouter } from "../src/main/ipc";
import { registerPackCommands } from "../src/main/pack-router";
import { createHash } from "node:crypto";
async function fixture(path: string, entries: Record<string, string>) {
  const z = new ZipFile();
  for (const [name, data] of Object.entries(entries))
    z.addBuffer(Buffer.from(data), name);
  z.end();
  await pipeline(z.outputStream, createWriteStream(path));
}
it("online selected pack version creates a named new instance, rejects duplicate/invalid names and rolls back bad hashes", async () => {
  const root = await mkdtemp(join(tmpdir(), "online-pack-"));
  try {
    const archive = join(root, "original.mrpack");
    await fixture(archive, {
      "modrinth.index.json": JSON.stringify({
        formatVersion: 1,
        game: "minecraft",
        name: "Upstream pack",
        versionId: "1",
        dependencies: { minecraft: "1.21.1" },
        files: [],
      }),
      "overrides/config/test.txt": "actual override",
    });
    const bytes = await readFile(archive);
    let corrupt = false;
    const requests: string[] = [];
    const network = new NetworkService({
      fetch: (async (url: any) => {
        requests.push(String(url));
        if (String(url).includes("/version/"))
          return new Response(
            JSON.stringify({
              id: "chosen",
              project_id: "pack",
              name: "Chosen release",
              version_number: "v",
              date_published: "2026-10-01",
              game_versions: ["1.21.1"],
              loaders: ["fabric"],
              dependencies: [],
              files: [
                {
                  url: "https://cdn.modrinth.com/chosen.mrpack",
                  filename: "chosen.mrpack",
                  size: bytes.length,
                  primary: true,
                  hashes: {
                    sha1: createHash("sha1").update(bytes).digest("hex"),
                  },
                },
              ],
            }),
          );
        return new Response(corrupt ? Buffer.alloc(bytes.length) : bytes);
      }) as typeof fetch,
    });
    const instances = new InstanceService(),
      tasks = new TaskService(),
      install = new InstallService(
        instances,
        tasks,
        network,
        join(root, "instances"),
      );
    vi.spyOn(install, "installInto").mockResolvedValue({} as any);
    const packs = new PackService(
      install,
      {} as any,
      new ModrinthService(network),
    );
    expect(() => packs.installModrinth("chosen", "../escape")).toThrow("名称");
    const item = await tasks.wait<any>(
      packs.installModrinth("chosen", "My Pack"),
    );
    expect(item.name).toBe("My Pack");
    expect(await readFile(join(item.gameDir, "config/test.txt"), "utf8")).toBe(
      "actual override",
    );
    expect(requests.filter((x) => x.includes("/version/"))).toEqual([
      "https://api.modrinth.com/v2/version/chosen",
    ]);
    const before = requests.length;
    await expect(
      tasks.wait(packs.installModrinth("chosen", "my pack")),
    ).rejects.toThrow("已存在");
    expect(requests.length).toBe(before);
    corrupt = true;
    await expect(
      tasks.wait(packs.installModrinth("chosen", "Bad Hash")),
    ).rejects.toThrow("SHA1");
    expect(await instances.list()).toHaveLength(1);
    expect(await readdir(join(root, "instances"))).toEqual([item.id]);
    corrupt = false;
    const concurrent = await Promise.allSettled([
      tasks.wait(packs.installModrinth("chosen", "Concurrent")),
      tasks.wait(packs.installModrinth("chosen", "concurrent")),
    ]);
    expect(concurrent.map((x) => x.status).sort()).toEqual([
      "fulfilled",
      "rejected",
    ]);
    expect(await instances.list()).toHaveLength(2);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("installs actual archive overrides atomically, exports allowed files and rolls back failure", async () => {
  const root = await mkdtemp(join(tmpdir(), "packs-"));
  try {
    const file = join(root, "test.mrpack");
    await fixture(file, {
      "modrinth.index.json": JSON.stringify({
        formatVersion: 1,
        game: "minecraft",
        name: "Demo",
        versionId: "1",
        dependencies: { minecraft: "1.20.1", "fabric-loader": "0.15.0" },
        files: [],
      }),
      "overrides/config/a.txt": "base",
      "client-overrides/config/a.txt": "client",
      "server-overrides/config/server.txt": "server",
    });
    const instances = new InstanceService(undefined, async () => ({
        memoryMb: 4096,
        javaArgs: [],
        javaPath: "C:/Custom Java/java.exe",
      })),
      tasks = new TaskService(),
      install = new InstallService(
        instances,
        tasks,
        new NetworkService(),
        join(root, "instances"),
      );
    const base = vi
      .spyOn(install, "installInto")
      .mockImplementation(async () => ({}) as any);
    const loader = {
      installInto: vi.fn(async (_root, item) => {
        if (item.javaPath !== "C:/Custom Java/java.exe")
          throw new Error("missing default Java before pack loader");
        expect(await instances.list()).toEqual([]);
        return "fabric-profile";
      }),
    } as any;
    const packs = new PackService(install, loader);
    const item = await tasks.wait<any>(packs.install(file, "Demo"));
    expect(base).toHaveBeenCalledOnce();
    expect(loader.installInto).toHaveBeenCalledOnce();
    expect(await readFile(join(item.gameDir, "config/a.txt"), "utf8")).toBe(
      "client",
    );
    expect(await readdir(join(item.gameDir, "config"))).toEqual(["a.txt"]);
    await mkdir(join(item.gameDir, "saves"));
    await writeFile(join(item.gameDir, "saves/world"), "secret");
    await writeFile(join(item.gameDir, "accounts.json"), "secret");
    await writeFile(join(item.gameDir, "config/token.json"), "secret");
    const output = join(root, "export.mrpack");
    await tasks.wait(
      packs.export(item.id, output, { overridePaths: ["config/a.txt"] }),
    );
    const archive = await readArchive(output);
    try {
      expect(archive.entries.map((e) => e.fileName)).toEqual([
        "modrinth.index.json",
        "overrides/config/a.txt",
      ]);
    } finally {
      archive.close();
    }
    base.mockRejectedValueOnce(new Error("failure"));
    await expect(tasks.wait(packs.install(file, "Broken"))).rejects.toThrow(
      "failure",
    );
    expect(await instances.list()).toHaveLength(1);
    expect(await readdir(install.root)).toEqual([item.id]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("exports only explicitly selected overrides, enforces hard exclusions and previews path and size", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-selection-"));
  try {
    const instances = new InstanceService(),
      tasks = new TaskService();
    await instances.register({
      id: "i",
      name: "i",
      resourceDir: root,
      gameDir: join(root, "game"),
      minecraft: "1.21",
      versionId: "1.21",
      status: "ready",
      memoryMb: 2048,
      javaArgs: [],
    });
    const packs = new PackService(
      new InstallService(instances, tasks, new NetworkService(), root),
      {} as any,
    );
    for (const path of [
      "config/safe.txt",
      "config/service.json",
      "mods/local.jar",
      "config/token.json",
      "saves/world/level.dat",
      "logs/latest.log",
      "accounts.json",
    ]) {
      const { dirname } = await import("node:path");
      await mkdir(dirname(join(root, "game", path)), { recursive: true });
      await writeFile(join(root, "game", path), "private");
    }
    const preview = await (packs as any).previewExport("i");
    expect(preview.overrides).toEqual([
      { path: "config/safe.txt", size: 7 },
      { path: "config/service.json", size: 7 },
      { path: "mods/local.jar", size: 7 },
    ]);
    const out = join(root, "out.mrpack");
    await tasks.wait(packs.export("i", out));
    let zip = await readArchive(out);
    expect(zip.entries.map((e) => e.fileName)).toEqual(["modrinth.index.json"]);
    zip.close();
    await tasks.wait(
      packs.export("i", out, {
        overridePaths: [
          "config/safe.txt",
          "config/token.json",
          "saves/world/level.dat",
          "accounts.json",
          "logs/latest.log",
        ],
      }),
    );
    zip = await readArchive(out);
    expect(zip.entries.map((e) => e.fileName)).toEqual([
      "modrinth.index.json",
      "overrides/config/safe.txt",
    ]);
    zip.close();
    await expect(
      tasks.wait(packs.export("i", out, { overridePaths: ["../escape"] })),
    ).rejects.toThrow();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

it("keeps hash-verified managed Mods as download references and makes edited files explicit overrides", async () => {
  const root = await mkdtemp(join(tmpdir(), "export-managed-"));
  try {
    const { createHash } = await import("node:crypto");
    const hash = createHash("sha1").update("mod bytes").digest("hex");
    const version = {
      id: "v",
      project_id: "p",
      name: "mod",
      version_number: "1",
      date_published: "2026-01-01",
      game_versions: ["1.21"],
      loaders: ["fabric"],
      dependencies: [],
      files: [
        {
          url: "https://example.org/a.jar",
          filename: "a.jar",
          size: 9,
          primary: true,
          hashes: { sha1: hash },
        },
      ],
    };
    const network = new NetworkService({
      fetch: (async (url) =>
        new Response(
          String(url).endsWith(".jar") ? "mod bytes" : JSON.stringify(version),
        )) as typeof fetch,
    });
    const instances = new InstanceService(),
      tasks = new TaskService();
    await instances.register({
      id: "i",
      name: "i",
      resourceDir: root,
      gameDir: join(root, "game"),
      minecraft: "1.21",
      versionId: "1.21",
      loader: { kind: "fabric", version: "1" },
      status: "ready",
      memoryMb: 2048,
      javaArgs: [],
    });
    const modrinth = new ModrinthService(network);
    await tasks.wait(
      new ModService(instances, tasks, network, modrinth).install("i", "v"),
    );
    const install = new InstallService(instances, tasks, network, root);
    const router = new CommandRouter();
    const { packs } = registerPackCommands(
      router,
      { install, loaders: {} as any },
      modrinth,
    );
    const preview = (await router.invoke("packs.previewExport", "i")) as any;
    expect(preview.overrides).toEqual([]);
    expect(preview.references).toEqual([
      {
        path: "mods/a.jar",
        downloads: ["https://example.org/a.jar"],
        hashes: { sha1: hash },
        fileSize: 9,
      },
    ]);
    const provenancePath = join(root, "game/mods/.zhumeng-mods.json");
    const legacy = JSON.parse(await readFile(provenancePath, "utf8"));
    delete legacy["a.jar"].downloads;
    delete legacy["a.jar"].fileSize;
    await writeFile(provenancePath, JSON.stringify(legacy));
    expect((await packs.previewExport("i")).references).toEqual(
      preview.references,
    );
    const output = join(root, "managed.mrpack");
    await tasks.wait(
      (await router.invoke("packs.export", {
        instanceId: "i",
        destination: output,
      })) as string,
    );
    const archive = await readArchive(output);
    try {
      expect(
        JSON.parse((await archive.read("modrinth.index.json")).toString())
          .files,
      ).toEqual(preview.references);
    } finally {
      archive.close();
    }
    for (const options of [
      { overridePaths: "mods/a.jar" },
      { overridePaths: [1] },
      { allFiles: true },
    ]) {
      await expect(
        router.invoke("packs.export", {
          instanceId: "i",
          destination: output,
          options,
        }),
      ).rejects.toThrow();
    }
    await writeFile(join(root, "game/mods/a.jar"), "edited bytes");
    expect(await packs.previewExport("i")).toEqual({
      references: [],
      overrides: [{ path: "mods/a.jar", size: 12 }],
    });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("does not register CurseForge missing files and exposes exact IDs", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-"));
  try {
    const file = join(root, "cf.zip");
    await fixture(file, {
      "manifest.json": JSON.stringify({
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: "CF",
        minecraft: { version: "1.20.1", modLoaders: [] },
        files: [{ projectID: 12, fileID: 34 }],
      }),
    });
    const instances = new InstanceService(),
      tasks = new TaskService();
    const packs = new PackService(
      new InstallService(
        instances,
        tasks,
        new NetworkService(),
        join(root, "instances"),
      ),
      {} as any,
      undefined,
      async () => undefined,
    );
    await expect(tasks.wait(packs.install(file, "CF"))).rejects.toThrow(
      '[{"projectID":12,"fileID":34}]',
    );
    expect(await instances.list()).toEqual([]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("skips unsupported/optional clients, verifies file hashes and supports retry after cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "pack-download-"));
  try {
    const network = new NetworkService({
        fetch: vi.fn(async () => new Response("mod-bytes")) as any,
      }),
      instances = new InstanceService(),
      tasks = new TaskService(),
      install = new InstallService(
        instances,
        tasks,
        network,
        join(root, "instances"),
      );
    vi.spyOn(install, "installInto").mockImplementation(async (_r, _v, c) => {
      c.signal.throwIfAborted();
      return {} as any;
    });
    const packs = new PackService(install, {} as any),
      file = join(root, "test.mrpack");
    const hash = (await import("node:crypto"))
      .createHash("sha1")
      .update("mod-bytes")
      .digest("hex");
    const spec = (path: string, client: string) => ({
      path,
      downloads: ["https://example.org/mod.jar"],
      hashes: { sha1: hash },
      fileSize: 9,
      env: { client },
    });
    await fixture(file, {
      "modrinth.index.json": JSON.stringify({
        formatVersion: 1,
        game: "minecraft",
        name: "Demo",
        versionId: "1",
        dependencies: { minecraft: "1.20.1" },
        files: [
          spec("mods/yes.jar", "required"),
          spec("mods/server.jar", "unsupported"),
          spec("mods/optional.jar", "optional"),
        ],
      }),
    });
    const cancelled = packs.install(file, "Cancelled");
    await tasks.cancel(cancelled);
    expect(tasks.list().find((t) => t.id === cancelled)?.status).toBe(
      "cancelled",
    );
    expect(await instances.list()).toEqual([]);
    const item = await tasks.wait<any>(tasks.retry(cancelled));
    expect(await readdir(join(item.gameDir, "mods"))).toEqual(["yes.jar"]);
    expect(await readFile(join(item.gameDir, "mods/yes.jar"), "utf8")).toBe(
      "mod-bytes",
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("rejects supplied case collisions before installing base and requires explicit ZIP target", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-safe-"));
  try {
    const file = join(root, "cf.zip");
    await fixture(file, {
      "manifest.json": JSON.stringify({
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: "CF",
        minecraft: { version: "1.20.1", modLoaders: [] },
        files: [
          { projectID: 1, fileID: 1 },
          { projectID: 2, fileID: 2 },
        ],
      }),
    });
    await mkdir(join(root, "one"));
    await mkdir(join(root, "two"));
    const a = join(root, "one/a.jar"),
      b = join(root, "two/A.jar");
    await writeFile(a, "first");
    await writeFile(b, "second");
    const instances = new InstanceService(),
      tasks = new TaskService(),
      install = new InstallService(
        instances,
        tasks,
        new NetworkService(),
        join(root, "instances"),
      ),
      base = vi.spyOn(install, "installInto").mockResolvedValue({} as any),
      packs = new PackService(
        install,
        {} as any,
        undefined,
        async () => undefined,
      );
    const suppliedFiles = await Promise.all(
      [a, b].map(async (path, i) => ({
        projectID: i + 1,
        fileID: i + 1,
        path,
        sha1: await packs.hashSupplied(path),
      })),
    );
    await expect(
      tasks.wait(packs.install(file, "CF", { suppliedFiles })),
    ).rejects.toThrow(/碰撞/);
    expect(base).not.toHaveBeenCalled();
    expect(await instances.list()).toEqual([]);
    expect(await readFile(a, "utf8")).toBe("first");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
it("routes official CurseForge resourcepack metadata and rejects unsupported classes", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-api-"));
  try {
    const file = join(root, "cf.zip");
    await fixture(file, {
      "manifest.json": JSON.stringify({
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: "CF",
        minecraft: { version: "1.20.1", modLoaders: [] },
        files: [{ projectID: 1, fileID: 2 }],
      }),
    });
    const hash = (await import("node:crypto"))
      .createHash("sha1")
      .update("pack")
      .digest("hex");
    let classId = 12;
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async (url: string) =>
          new Response(
            JSON.stringify({
              data: url.endsWith("/files/2")
                ? {
                    id: 2,
                    modId: 1,
                    gameId:432,isAvailable:true,displayName:"Textures",releaseType:1,fileDate:"2026-10-01T00:00:00Z",downloadCount:0,gameVersions:["1.20.1"],dependencies:[],
                    fileName: "textures.zip",
                    fileLength: 4,
                    downloadUrl: "https://example.org/pack",
                    hashes: [{ algo: 1, value: hash }],
                  }
                : { id: 1, gameId:432,classId,name:"Textures",slug:"textures",summary:"Texture fixture",authors:[],categories:[],downloadCount:0,links:{websiteUrl:"https://www.curseforge.com/minecraft/texture-packs/textures"} },
            }),
          ),
      ),
    );
    const instances = new InstanceService(),
      tasks = new TaskService(),
      install = new InstallService(
        instances,
        tasks,
        new NetworkService({
          fetch: vi.fn(async () => new Response("pack")) as any,
        }),
        join(root, "instances"),
      );
    vi.spyOn(install, "installInto").mockResolvedValue({} as any);
    const packs = new PackService(
      install,
      {} as any,
      undefined,
      async () => "fixture-only-key",
    );
    const item = await tasks.wait<any>(packs.install(file, "CF"));
    expect(
      await readFile(join(item.gameDir, "resourcepacks/textures.zip"), "utf8"),
    ).toBe("pack");
    classId = 999;
    await expect(tasks.wait(packs.install(file, "Bad"))).rejects.toThrow(
      /类型|格式/,
    );
    expect(await instances.list()).toHaveLength(1);
  } finally {
    vi.unstubAllGlobals();
    await rm(root, { recursive: true, force: true });
  }
});
it("completes supplied resourcepack mapping and rejects ambiguous ZIP, nonregular and oversized sources", async () => {
  const root = await mkdtemp(join(tmpdir(), "cf-local-"));
  try {
    const file = join(root, "cf.zip");
    await fixture(file, {
      "manifest.json": JSON.stringify({
        manifestType: "minecraftModpack",
        manifestVersion: 1,
        name: "CF",
        minecraft: { version: "1.20.1", modLoaders: [] },
        files: [{ projectID: 1, fileID: 2 }],
      }),
    });
    const source = join(root, "texture.zip");
    await writeFile(source, "texture");
    const instances = new InstanceService(),
      tasks = new TaskService(),
      install = new InstallService(
        instances,
        tasks,
        new NetworkService(),
        join(root, "instances"),
      );
    vi.spyOn(install, "installInto").mockResolvedValue({} as any);
    const packs = new PackService(
        install,
        {} as any,
        undefined,
        async () => undefined,
      ),
      sha = await packs.hashSupplied(source);
    const supplied = { projectID: 1, fileID: 2, path: source, sha1: sha };
    await expect(
      tasks.wait(
        packs.install(file, "Ambiguous", { suppliedFiles: [supplied] }),
      ),
    ).rejects.toThrow(/类型/);
    const item = await tasks.wait<any>(
      packs.install(file, "Ready", {
        suppliedFiles: [{ ...supplied, target: "resourcepacks" }],
      }),
    );
    expect(
      await readFile(join(item.gameDir, "resourcepacks/texture.zip"), "utf8"),
    ).toBe("texture");
    await expect(
      tasks.wait(
        packs.install(file, "Directory", {
          suppliedFiles: [{ ...supplied, path: root, target: "mods" }],
        }),
      ),
    ).rejects.toThrow(/补齐文件/);
    const fs = await import("node:fs/promises");
    const oversized = join(root, "large.jar");
    const handle = await fs.open(oversized, "w");
    await handle.truncate(2 * 1024 * 1024 * 1024 + 1);
    await handle.close();
    await expect(
      tasks.wait(
        packs.install(file, "Large", {
          suppliedFiles: [{ ...supplied, path: oversized }],
        }),
      ),
    ).rejects.toThrow(/补齐文件/);
    await expect(
      tasks.wait(
        packs.install(file, "HashBad", {
          suppliedFiles: [
            { ...supplied, target: "resourcepacks", sha1: "0".repeat(40) },
          ],
        }),
      ),
    ).rejects.toThrow(/SHA1/);
    expect(await instances.list()).toHaveLength(1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
