import { Version } from "@xmcl/core";
import { describe, it, expect, vi } from "vitest";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fixture } from "./minecraft-fixture";
import { InstanceService } from "../src/main/services/instances";
describe("instances", () => {
  it("scans Chinese space path and resolves inheritance", async () => {
    const root = await fixture();
    await mkdir(join(root, "versions", "child"));
    await writeFile(
      join(root, "versions", "child", "child.json"),
      JSON.stringify({
        id: "child",
        inheritsFrom: "base",
        libraries: [],
        mainClass: "custom.Main",
      }),
    );
    const service = new InstanceService();
    const items = await service.importDirectory(root);
    expect(items).toHaveLength(2);
    expect(
      (await service.resolve(items.find((x) => x.versionId === "child")!.id))
        .mainClass,
    ).toBe("custom.Main");
  });
  it("reports missing parent", async () => {
    const root = await fixture();
    await writeFile(
      join(root, "versions", "base", "base.json"),
      JSON.stringify({ id: "base", inheritsFrom: "missing" }),
    );
    expect((await new InstanceService().importDirectory(root))[0].status).toBe(
      "invalid",
    );
  });
});

it("persists per-instance settings and maps imported shared game data", async () => {
  const root = await fixture();
  const registry = join(root, "registry.json");
  const service = new InstanceService(registry);
  const [item] = await service.importDirectory(root);
  await service.patch(item.id, {
    memoryMb: 4096,
    javaArgs: ["-Dhello=中文 空格"],
    javaPath: process.execPath,
  });
  const loaded = (await new InstanceService(registry).list())[0];
  expect(loaded.memoryMb).toBe(4096);
  expect(loaded.javaArgs).toEqual(["-Dhello=中文 空格"]);
  expect(loaded.gameDir).toBe(root);
  expect(loaded.resourceDir).toBe(root);
});

it("prefers populated per-version data, supports root/game and preserves explicit remapping on rescan", async () => {
  for (const layout of ["versions/base", "game", ""]) {
    const root = await fixture();
    const data = join(root, layout);
    for (const path of [
      "saves/World/level.dat",
      "config/user.txt",
      "mods/local.jar",
    ]) {
      const { dirname } = await import("node:path");
      await mkdir(dirname(join(data, path)), { recursive: true });
      await writeFile(join(data, path), "sentinel");
    }
    const service = new InstanceService(join(root, "registry.json"));
    const [item] = await service.importDirectory(root);
    expect(item.gameDir).toBe(data);
    const custom = join(root, "custom");
    await mkdir(custom);
    await (service as any).mapGameDirectory(item.id, custom);
    expect((await service.importDirectory(root))[0].gameDir).toBe(custom);
    expect(
      (await new InstanceService(join(root, "registry.json")).get(item.id))
        .gameDir,
    ).toBe(custom);
    expect(await readFile(join(data, "saves/World/level.dat"), "utf8")).toBe(
      "sentinel",
    );
    await expect(
      (service as any).mapGameDirectory(item.id, join(data, "mods/local.jar")),
    ).rejects.toThrow();
  }
});

it("honors existing PCL explicit isolation preferences before automatic layout inference", async () => {
  for (const [setting, isolated] of [
    ["VersionArgumentIndieV2:False", false],
    ["VersionArgumentIndieV2:True", true],
    ["VersionArgumentIndie:2", false],
    ["VersionArgumentIndie:1", true],
  ] as const) {
    const root = await fixture();
    const version = join(root, "versions/base");
    await mkdir(join(version, "PCL"));
    await mkdir(join(version, "mods"));
    await writeFile(join(version, "mods/a.jar"), "existing");
    await writeFile(join(version, "PCL/Setup.ini"), setting + "\r\n");
    expect((await new InstanceService().importDirectory(root))[0].gameDir).toBe(
      isolated ? version : root,
    );
    expect(await readFile(join(version, "PCL/Setup.ini"), "utf8")).toBe(
      setting + "\r\n",
    );
  }
});

it("removes the loader label when metadata becomes vanilla", async () => {
  const root = await fixture();
  const file = join(root, "versions", "base", "base.json");
  const metadata = JSON.parse(await readFile(file, "utf8"));
  metadata.libraries = [{ name: "net.fabricmc:fabric-loader:0.16.0" }];
  await writeFile(file, JSON.stringify(metadata));
  const service = new InstanceService();
  expect((await service.importDirectory(root))[0].loader?.kind).toBe("fabric");
  metadata.libraries = [];
  await writeFile(file, JSON.stringify(metadata));
  expect((await service.importDirectory(root))[0].loader).toBeUndefined();
});
it("shares one initial registry load across concurrent imports", async () => {
  const first = await fixture(),
    second = await fixture(),
    registry = join(first, "registry.json");
  await writeFile(registry, "[]");
  const actualRead =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  let startLoad!: () => void,
    releaseFirst!: () => void,
    releaseSecond!: () => void,
    parsed!: () => void,
    resumeParse!: () => void;
  const loaded = new Promise<void>((resolve) => {
    startLoad = resolve;
  });
  const firstRead = new Promise<void>((resolve) => {
    releaseFirst = resolve;
  });
  const secondRead = new Promise<void>((resolve) => {
    releaseSecond = resolve;
  });
  const parsing = new Promise<void>((resolve) => {
    parsed = resolve;
  });
  const parseGate = new Promise<void>((resolve) => {
    resumeParse = resolve;
  });
  let reads = 0;
  vi.mocked(readFile).mockImplementation((async (
    path: unknown,
    ...options: unknown[]
  ) => {
    if (path === registry) {
      reads++;
      startLoad();
      await (reads === 1 ? firstRead : secondRead);
      return "[]";
    }
    return (actualRead.readFile as Function)(path, ...options);
  }) as typeof readFile);
  const originalParse = Version.parse;
  let parses = 0;
  const parseSpy = vi
    .spyOn(Version, "parse")
    .mockImplementation(async (...args) => {
      if (++parses === 1) {
        parsed();
        await parseGate;
      }
      return originalParse(...args);
    });
  try {
    const service = new InstanceService(registry);
    const imports = Promise.all([
      service.importDirectory(first),
      service.importDirectory(second),
    ]);
    await loaded;
    await new Promise((resolve) => setTimeout(resolve, 10));
    releaseFirst();
    await parsing;
    releaseSecond();
    await new Promise((resolve) => setTimeout(resolve, 10));
    resumeParse();
    await imports;
    expect(await service.list()).toHaveLength(2);
    expect(
      JSON.parse(await actualRead.readFile(registry, "utf8")).instances,
    ).toHaveLength(2);
    expect(reads).toBe(1);
  } finally {
    releaseFirst();
    releaseSecond();
    resumeParse();
    parseSpy.mockRestore();
    vi.mocked(readFile).mockImplementation(actualRead.readFile);
  }
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, readFile: vi.fn(actual.readFile) };
});
it("applies global defaults only to newly registered games and preserves replacement settings", async () => {
  const root = await fixture();
  const service = new (InstanceService as any)(undefined, async () => ({
    memoryMb: 6144,
    javaArgs: ["-Dglobal=yes"],
    javaPath: "C:/Java/java.exe",
  })) as InstanceService;
  const item = {
    id: "new",
    name: "New world",
    versionId: "base",
    resourceDir: root,
    gameDir: join(root, "game"),
    minecraft: "base",
    status: "ready" as const,
    memoryMb: 2048,
    javaArgs: [],
  };
  const created = await service.register(item);
  expect(created.memoryMb).toBe(6144);
  expect(created.javaArgs).toEqual(["-Dglobal=yes"]);
  const custom = await service.patch("new", {
    memoryMb: 1024,
    javaArgs: ["-Dcustom=yes"],
    javaPath: "C:/Other/java.exe",
  });
  const replaced = await service.register(
    { ...custom, versionId: "loader" },
    custom,
  );
  expect(replaced.memoryMb).toBe(1024);
  expect(replaced.javaArgs).toEqual(["-Dcustom=yes"]);
  expect(replaced.javaPath).toBe("C:/Other/java.exe");
});

it("explicit automatic Java survives new-instance global manual defaults",async()=>{
  const root=await fixture();const service=new InstanceService(undefined,async()=>({javaPath:"stale-global",javaArgs:[],memoryMb:1024}));
  const created=await service.applyNewDefaults({id:"auto",name:"Auto",minecraft:"base",versionId:"base",resourceDir:root,gameDir:root,status:"ready",memoryMb:1024,javaArgs:[],javaPath:""});
  expect(created.javaPath).toBe("");
});
