import { it, expect } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  symlink,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ContentInstallService } from "../src/main/services/content-install";
import { InstanceService } from "../src/main/services/instances";
import { ModrinthService } from "../src/main/services/modrinth";
import { NetworkService } from "../src/main/services/network";
import { TaskService } from "../src/main/services/tasks";
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "resources-")),
    instances = new InstanceService(),
    tasks = new TaskService();
  await instances.register({
    id: "i",
    name: "Fixture",
    gameDir: root,
    resourceDir: root,
    versionId: "1.21",
    minecraft: "1.21",
    status: "ready",
    memoryMb: 1024,
    javaArgs: [],
  });
  const bytes = Buffer.from("PK verified ZIP fixture");
  let markDownloadStarted!: () => void;
  const downloadStarted = new Promise<void>((resolve) => {
    markDownloadStarted = resolve;
  });
  let kind = "resourcepack",
    corrupt = false,
    loaders = ["minecraft"],
    mc = ["1.21"],
    projectId = "p",
    release: (() => void) | undefined,
    slow = false;
  const network = new NetworkService({
    fetch: (async (url: any) => {
      const path = new URL(String(url)).pathname;
      if (path.includes("/project/"))
        return new Response(
          JSON.stringify({
            id: "p",
            slug: "p",
            project_type: kind,
            title: "Fixture",
            description: "",
            body: "",
            team: "t",
            categories: [],
            downloads: 0,
            followers: 0,
          }),
        );
      if (path.includes("/members")) return new Response("[]");
      if (path.includes("/version/"))
        return new Response(
          JSON.stringify({
            id: "v",
            project_id: projectId,
            name: "v",
            version_number: "v",
            date_published: "2026-01-01",
            game_versions: mc,
            loaders,
            dependencies: [],
            files: ["primary.jar", "data.zip"].map((filename, i) => ({
              filename,
              primary: i === 0,
              size: bytes.length,
              url: "https://cdn.modrinth.com/" + filename,
              hashes: {
                sha256: createHash("sha256").update(bytes).digest("hex"),
              },
            })),
          }),
        );
      if (slow)
        await new Promise<void>((resolve) => {
          release = resolve;
          markDownloadStarted();
        });
      return new Response(corrupt ? Buffer.alloc(bytes.length) : bytes);
    }) as typeof fetch,
  });
  const service = new ContentInstallService(
    instances,
    new ModrinthService(network),
    network,
    tasks,
  );
  return {
    root,
    tasks,
    service,
    bytes,
    set: (v: any) => {
      kind = v.kind ?? kind;
      corrupt = v.corrupt ?? corrupt;
      loaders = v.loaders ?? loaders;
      mc = v.mc ?? mc;
      projectId = v.projectId ?? projectId;
      slow = v.slow ?? slow;
    },
    release: () => release?.(),
    waitForDownload: () => downloadStarted,
    clean: () => rm(root, { recursive: true, force: true }),
  };
}
const request = {
  instanceId: "i",
  kind: "resourcepack" as const,
  projectId: "p",
  versionId: "v",
  filename: "data.zip",
};
it.each(["resourcepack", "shader", "datapack"] as const)(
  "installs exact verified ZIP into real %s target",
  async (kind) => {
    const f = await fixture();
    try {
      await mkdir(join(f.root, "saves", "World"), { recursive: true });
      await writeFile(join(f.root, "saves", "World", "level.dat"), "world");
      await mkdir(join(f.root, "saves", "Empty"), { recursive: true });
      f.set({
        kind: kind === "datapack" ? "mod" : kind,
        loaders: kind === "datapack" ? ["datapack", "fabric"] : ["minecraft"],
      });
      expect(await f.service.worlds("i")).toEqual([
        { id: "World", name: "World" },
      ]);
      const task = await f.service.install({
        ...request,
        kind,
        ...(kind === "datapack" ? { worldId: "World" } : {}),
      });
      await f.tasks.wait(task);
      const folder =
        kind === "datapack"
          ? "saves/World/datapacks"
          : kind === "shader"
            ? "shaderpacks"
            : "resourcepacks";
      expect(await readFile(join(f.root, folder, "data.zip"))).toEqual(f.bytes);
      expect(
        await readFile(join(f.root, "saves/World/level.dat"), "utf8"),
      ).toBe("world");
      expect((await readdir(join(f.root, folder))).sort()).toEqual([
        "data.zip",
      ]);
    } finally {
      await f.clean();
    }
  },
);
it("rejects wrong project, kind, Minecraft, primary JAR and world misuse", async () => {
  const f = await fixture();
  try {
    await expect(
      f.service.install({ ...request, filename: "primary.jar" }),
    ).rejects.toThrow();
    await expect(
      f.service.install({ ...request, worldId: "World" }),
    ).rejects.toThrow();
    f.set({ projectId: "other" });
    await expect(f.service.install(request)).rejects.toThrow();
    f.set({ projectId: "p", mc: ["1.20"] });
    await expect(f.service.install(request)).rejects.toThrow();
    await mkdir(join(f.root, "saves", "World"), { recursive: true });
    await writeFile(join(f.root, "saves", "World", "level.dat"), "world");
    f.set({ mc: ["1.21"], kind: "mod", loaders: ["fabric"] });
    await expect(
      f.service.install({ ...request, kind: "datapack", worldId: "World" }),
    ).rejects.toThrow("项目或版本与所选资源类型不匹配");
    for (const worldId of [
      "../escape",
      "CON",
      "World:stream",
      "world.",
      "WORLD",
    ])
      await expect(
        f.service.install({ ...request, kind: "datapack", worldId }),
      ).rejects.toThrow();
  } finally {
    await f.clean();
  }
});
it("never replaces a conflicting file; corrupt staged bytes clean up", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "resourcepacks"));
    await writeFile(join(f.root, "resourcepacks/data.zip"), "old");
    await expect(f.service.install(request)).rejects.toThrow(/另存为/);
    expect(await readFile(join(f.root, "resourcepacks/data.zip"), "utf8")).toBe(
      "old",
    );
    await rm(join(f.root, "resourcepacks/data.zip"));
    f.set({ corrupt: true });
    const task = await f.service.install(request);
    await expect(f.tasks.wait(task)).rejects.toThrow(/SHA256/);
    expect(await readdir(join(f.root, "resourcepacks"))).toEqual([]);
  } finally {
    await f.clean();
  }
});
it("concurrent installs publish once and cancellation removes owned staging", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled([
      f.service.install(request),
      f.service.install(request),
    ]);
    await Promise.all(
      results
        .filter((r) => r.status === "fulfilled")
        .map(async (r) => {
          await f.tasks
            .wait((r as PromiseFulfilledResult<string>).value)
            .catch(() => {});
        }),
    );
    expect(await readFile(join(f.root, "resourcepacks/data.zip"))).toEqual(
      f.bytes,
    );
    expect(await readdir(join(f.root, "resourcepacks"))).toEqual(["data.zip"]);
    await rm(join(f.root, "resourcepacks/data.zip"));
    f.set({ slow: true });
    const id = await f.service.install(request);
    await f.waitForDownload();
    const cancel = f.tasks.cancel(id);
    f.release();
    await cancel;
    expect(await readdir(join(f.root, "resourcepacks"))).toEqual([]);
  } finally {
    await f.clean();
  }
});
it("rejects junctions and changed worlds before publication", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "outside"));
    await symlink(
      join(f.root, "outside"),
      join(f.root, "resourcepacks"),
      "junction",
    );
    await expect(f.service.install(request)).rejects.toThrow();
    await rm(join(f.root, "resourcepacks"));
    await mkdir(join(f.root, "saves/World"), { recursive: true });
    await writeFile(join(f.root, "saves/World/level.dat"), "world");
    f.set({ kind: "mod", loaders: ["datapack"], slow: true });
    const id = await f.service.install({
      ...request,
      kind: "datapack",
      worldId: "World",
    });
    await f.waitForDownload();
    await rm(join(f.root, "saves/World/level.dat"));
    f.release();
    await expect(f.tasks.wait(id)).rejects.toThrow();
    expect(await readdir(join(f.root, "saves/World/datapacks"))).toEqual([]);
  } finally {
    await f.clean();
  }
});
import { CommandRouter } from "../src/main/ipc";
import { registerModCommands } from "../src/main/mod-router";
it("resource IPC rejects renderer paths, extra fields and invalid world/kind payloads", async () => {
  const router = new CommandRouter();
  registerModCommands(router, {
    instances: {
      get: async () => {
        throw new Error("fixture instance");
      },
    } as any,
    tasks: {} as any,
    network: new NetworkService(),
  });
  for (const payload of [
    { ...request, path: "escape" },
    { ...request, kind: "mod" },
    { ...request, worldId: 2 },
  ])
    await expect(
      router.invoke("content.installResource", payload),
    ).rejects.toThrow(/无效/);
  await expect(
    router.invoke("content.worlds", { instanceId: "i", path: "escape" }),
  ).rejects.toThrow(/无效/);
});
it("does not recreate a deleted instance game directory", async () => {
  const f = await fixture();
  try {
    await rm(f.root, { recursive: true, force: true });
    await expect(f.service.install(request)).rejects.toThrow(/实例目录/);
  } finally {
    await f.clean();
  }
});
it("world identifiers use exact real folder spelling and require a non-link level.dat", async () => {
  const f = await fixture();
  try {
    await mkdir(join(f.root, "saves/World"), { recursive: true });
    await writeFile(join(f.root, "saves/World/level.dat"), "world");
    f.set({ kind: "mod", loaders: ["datapack"] });
    for (const worldId of [
      "world",
      "WORLD",
      "../World",
      "World:stream",
      "CON",
      "World.",
    ])
      await expect(
        f.service.install({ ...request, kind: "datapack", worldId }),
      ).rejects.toThrow();
    await rm(join(f.root, "saves/World/level.dat"));
    await symlink(
      join(f.root, "saves/World"),
      join(f.root, "saves/World/level.dat"),
      "junction",
    );
    expect(await f.service.worlds("i")).toEqual([]);
  } finally {
    await f.clean();
  }
});
it("publication conflict arriving during download preserves newly created user bytes", async () => {
  const f = await fixture();
  try {
    f.set({ slow: true });
    const id = await f.service.install(request);
    await f.waitForDownload();
    await writeFile(join(f.root, "resourcepacks/data.zip"), "user file");
    f.release();
    await expect(f.tasks.wait(id)).rejects.toThrow(/另存为/);
    expect(await readFile(join(f.root, "resourcepacks/data.zip"), "utf8")).toBe(
      "user file",
    );
    expect(await readdir(join(f.root, "resourcepacks"))).toEqual(["data.zip"]);
  } finally {
    await f.clean();
  }
});
