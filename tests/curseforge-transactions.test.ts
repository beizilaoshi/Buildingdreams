import { it, expect, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { ZipFile } from "yazl";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import {
  CurseForgeContent,
  curseForgeClasses,
} from "../src/main/services/curseforge-content";
import { ProviderSecrets } from "../src/main/services/provider-secrets";
import { ContentProviders } from "../src/main/services/content-provider";
import { ModrinthService } from "../src/main/services/modrinth";
import { NetworkService } from "../src/main/services/network";
import { ModService } from "../src/main/services/mods";
import { ContentInstallService } from "../src/main/services/content-install";
import { ContentSaveService } from "../src/main/services/content-save";
import { TaskService } from "../src/main/services/tasks";
import { InstanceService } from "../src/main/services/instances";
import { InstallService } from "../src/main/services/install";
import { PackService } from "../src/main/services/packs";
import type { ContentKind } from "../src/shared/content";
async function fixture(kind: ContentKind = "mod") {
  const root = await mkdtemp(join(tmpdir(), "cf-transaction-"));
  const tasks = new TaskService(),
    instances = new InstanceService();
  await instances.register({
    id: "i",
    name: "i",
    gameDir: root,
    resourceDir: root,
    versionId: "1.21.1",
    minecraft: "1.21.1",
    loader: { kind: "fabric", version: "1" },
    status: "ready",
    memoryMb: 1024,
    javaArgs: [],
  });
  const vault = new ProviderSecrets(join(root, "vault"), {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.alloc(0),
    decryptString: () => "",
  });
  await vault.set("fixture-only-key", false);
  const bytes = new Map<number, Buffer>([
    [12, Buffer.from("root verified")],
    [13, Buffer.from("dependency verified")],
  ]);
  let blocked = false,
    corrupt = false,
    cycle = false;
  const calls: string[] = [];
  const network = new NetworkService({
    fetch: (async (u, init) => {
      expect((init?.headers as any)?.["x-api-key"]).toBeUndefined();
      const id = Number(new URL(String(u)).pathname.slice(1));
      return new Response(
        new Uint8Array(corrupt ? Buffer.from("corrupt") : bytes.get(id)!),
      );
    }) as typeof fetch,
  });
  const cf = new CurseForgeContent(vault, (async (input, options) => {
    const u = new URL(String(input));
    calls.push(u.href);
    expect(options?.headers).toMatchObject({ "x-api-key": "fixture-only-key" });
    const parts = u.pathname.split("/"),
      id = Number(parts[3]);
    const projectKind = id === 13 ? "mod" : kind;
    const data =
      parts[4] === "files"
        ? {
            id: id === 12 ? 34 : 35,
            modId: id,
            gameId: 432,
            isAvailable: !(blocked && (kind !== "modpack" || id === 13)),
            fileName:
              id === 12
                ? kind === "mod"
                  ? "root.jar"
                  : kind === "modpack"
                    ? "pack.zip"
                    : "data.zip"
                : "dep.jar",
            displayName: "Exact",
            releaseType: 1,
            fileDate: "2026-01-01T00:00:00Z",
            fileLength: bytes.get(id)!.length,
            downloadCount: 0,
            downloadUrl: "https://cdn.example/" + id,
            gameVersions: ["1.21.1", "Fabric"],
            hashes: [
              {
                algo: 1,
                value: createHash("sha1").update(bytes.get(id)!).digest("hex"),
              },
            ],
            dependencies:
              kind === "mod" && id === 12
                ? [{ modId: 13, relationType: 3 }]
                : cycle
                  ? [{ modId: 12, relationType: 3 }]
                  : [],
          }
        : {
            id,
            gameId: 432,
            classId: curseForgeClasses[projectKind],
            name: "Fixture",
            slug: "fixture",
            summary: "Summary",
            authors: [],
            categories: [],
            downloadCount: 0,
            links: {
              websiteUrl:
                "https://www.curseforge.com/minecraft/mc-mods/fixture",
            },
          };
    return new Response(
      JSON.stringify(
        parts[4] === "files" && !parts[5]
          ? {
              data: [data],
              pagination: {
                index: 0,
                pageSize: 50,
                resultCount: 1,
                totalCount: 1,
              },
            }
          : { data },
      ),
    );
  }) as typeof fetch);
  const source = new ContentProviders(new ModrinthService(network), cf);
  return {
    root,
    tasks,
    instances,
    bytes,
    network,
    cf,
    source,
    calls,
    set: (v: { blocked?: boolean; corrupt?: boolean; cycle?: boolean }) => {
      blocked = v.blocked ?? blocked;
      corrupt = v.corrupt ?? corrupt;
      cycle = v.cycle ?? cycle;
    },
    clean: () => rm(root, { recursive: true, force: true }),
  };
}
it("installs CF exact root and required dependency bytes with qualified persisted ownership", async () => {
  const f = await fixture();
  try {
    const mods = new ModService(f.instances, f.tasks, f.network, f.source);
    await f.tasks.wait(mods.install("i", "cf:12:34"));
    expect(await readFile(join(f.root, "mods/root.jar"))).toEqual(
      f.bytes.get(12),
    );
    expect(await readFile(join(f.root, "mods/dep.jar"))).toEqual(
      f.bytes.get(13),
    );
    expect((await mods.list("i")).map((m) => m.projectId).sort()).toEqual([
      "cf:12",
      "cf:13",
    ]);
    expect(await mods.checkUpdates("i")).toEqual([]);
  } finally {
    await f.clean();
  }
});
it.each(["blocked", "corrupt", "cycle", "cancel"])(
  "failed CF %s leaves old mods bytes untouched",
  async (mode) => {
    const f = await fixture();
    try {
      await mkdir(join(f.root, "mods"));
      await writeFile(join(f.root, "mods/old.jar"), "old");
      if (mode !== "cancel") f.set({ [mode]: true });
      const mods = new ModService(f.instances, f.tasks, f.network, f.source);
      const id = mods.install("i", "cf:12:34");
      if (mode === "cancel") await f.tasks.cancel(id);
      await expect(f.tasks.wait(id)).rejects.toThrow();
      expect(await readdir(join(f.root, "mods"))).toEqual(["old.jar"]);
      expect(await readFile(join(f.root, "mods/old.jar"), "utf8")).toBe("old");
    } finally {
      await f.clean();
    }
  },
);
it.each(["resourcepack", "shader", "datapack"] as const)(
  "installs exact CF %s through shared exclusive resource transaction",
  async (kind) => {
    const f = await fixture(kind);
    try {
      await mkdir(join(f.root, "saves/world"), { recursive: true });
      await writeFile(join(f.root, "saves/world/level.dat"), "real");
      const resources = new ContentInstallService(
        f.instances,
        f.source,
        f.network,
        f.tasks,
      );
      const request = {
        instanceId: "i",
        kind,
        projectId: "cf:12",
        versionId: "cf:12:34",
        filename: "data.zip",
        ...(kind === "datapack" ? { worldId: "world" } : {}),
      };
      await f.tasks.wait(await resources.install(request));
      const target =
        kind === "resourcepack"
          ? "resourcepacks"
          : kind === "shader"
            ? "shaderpacks"
            : "saves/world/datapacks";
      expect(await readFile(join(f.root, target, "data.zip"))).toEqual(
        f.bytes.get(12),
      );
      await expect(resources.install(request)).rejects.toThrow(/存在/);
      expect(await readdir(f.root)).not.toContain("mods");
    } finally {
      await f.clean();
    }
  },
);
it("blocked CF SaveAs never opens a dialog or downloads", async () => {
  const f = await fixture();
  try {
    f.set({ blocked: true });
    const choose = vi.fn();
    const save = new ContentSaveService(f.source, f.network, f.tasks, choose);
    await expect(save.save("cf:12", "cf:12:34", "root.jar")).rejects.toThrow();
    expect(choose).not.toHaveBeenCalled();
  } finally {
    await f.clean();
  }
});
it.each([false, true])(
  "online CF pack resolves selected ZIP and guarded manifest bytes (blocked ref=%s)",
  async (blocked) => {
    const f = await fixture("modpack");
    try {
      const zip = new ZipFile();
      zip.addBuffer(
        Buffer.from(
          JSON.stringify({
            manifestType: "minecraftModpack",
            manifestVersion: 1,
            name: "CF 原生",
            minecraft: { version: "1.21.1", modLoaders: [{id:"fabric-fixture",primary:true}] },
            files: [{ projectID: 13, fileID: 35 }],
          }),
        ),
        "manifest.json",
      );
      zip.addBuffer(
        Buffer.from("settings bytes"),
        "overrides/config/example.txt",
      );
      zip.end();
      const path = join(f.root, "fixture.zip");
      await pipeline(zip.outputStream, createWriteStream(path));
      f.bytes.set(12, await readFile(path));
      const install = new InstallService(
        f.instances,
        f.tasks,
        f.network,
        join(f.root, "installations"),
      );
      vi.spyOn(install, "installInto").mockImplementation(async (root) => {
        await mkdir(join(root, "base"), { recursive: true });
        return {} as any;
      });
      const packs = new PackService(
        install,
        {installInto:async(root:string)=>{await writeFile(join(root,"loader.txt"),"loader bytes");return "fabric-fixture";}} as any,
        f.source,
        async () => undefined,
        f.cf,
      );
      if (blocked) {
        f.set({ blocked: true });
        await expect(
          f.tasks.wait(
            packs.installOnline("cf:12", "cf:12:34", "pack.zip", "Bad"),
          ),
        ).rejects.toThrow();
        expect(await f.instances.list()).toHaveLength(1);
      } else {
        const item = await f.tasks.wait<any>(
          packs.installOnline("cf:12", "cf:12:34", "pack.zip", "CF 原生"),
        );
        expect(await readFile(join(item.gameDir, "mods/dep.jar"))).toEqual(
          f.bytes.get(13),
        );
        expect(
          await readFile(join(item.gameDir, "config/example.txt"), "utf8"),
        ).toBe("settings bytes");
        expect(item.loader.kind).toBe("fabric");
        expect(await readFile(join(item.resourceDir,"loader.txt"),"utf8")).toBe("loader bytes");
        expect(await f.instances.list()).toHaveLength(2);
      }
    } finally {
      await f.clean();
    }
  },
);
