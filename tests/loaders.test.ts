import { afterEach, describe, expect, it, vi } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  readdir,
  rm,
  cp,
} from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { createServer, type Server } from "node:http";
import { createRequire } from "node:module";
import type { Readable } from "node:stream";
import { task, type Task } from "@xmcl/task";
import * as xmcl from "@xmcl/installer";
import {
  LoaderService,
  XmclLoaderAdapter,
  runInstallerTask,
} from "../src/main/services/loaders";
import { InstallService } from "../src/main/services/install";
import { InstanceService } from "../src/main/services/instances";
import { JavaService } from "../src/main/services/java";
import { NetworkService } from "../src/main/services/network";
import { TaskService } from "../src/main/services/tasks";
import { CommandRouter } from "../src/main/ipc";
import { registerGameCommands } from "../src/main/game-router";
import type { LoaderKind } from "../src/shared/types";

const roots: string[] = [];
const servers: Server[] = [];
async function zipBytes(files: Record<string, unknown>): Promise<Buffer> {
  const { ZipFile } = createRequire(import.meta.url)("yazl") as {
    ZipFile: new () => {
      addBuffer(buffer: Buffer, path: string): void;
      end(): void;
      outputStream: Readable;
    };
  };
  const zip = new ZipFile();
  for (const [path, value] of Object.entries(files))
    zip.addBuffer(Buffer.from(JSON.stringify(value)), path);
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  return Buffer.concat(chunks);
}
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (server) =>
        new Promise<void>((resolve) => {
          server.closeAllConnections();
          server.close(() => resolve());
        }),
    ),
  );
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function archiveFixture(
  attack?: "batch" | "version" | "processor" | "archive",
) {
  const f = await fixture();
  const { ZipFile } = createRequire(import.meta.url)("yazl") as {
    ZipFile: new () => {
      addBuffer(buffer: Buffer, path: string): void;
      end(): void;
      outputStream: Readable;
    };
  };
  let base = "";
  const payload = Buffer.from("library fixture");
  const payloadSha = createHash("sha1").update(payload).digest("hex");
  let archive: Buffer;
  const server = createServer((req, res) => {
    const body = req.url?.endsWith(".sha1")
      ? Buffer.from(createHash("sha1").update(archive).digest("hex"))
      : req.url?.includes("installer.jar")
        ? archive
        : payload;
    res.setHeader("content-length", body.length);
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  servers.push(server);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const library = {
    name: "fixture:batch:1",
    downloads: {
      artifact: {
        url: base + "/library",
        path:
          attack === "batch"
            ? "../../escaped.jar"
            : "fixture/batch/1/batch-1.jar",
        sha1: payloadSha,
        size: payload.length,
      },
    },
  };
  const profile = {
    spec: 1,
    profile: "NeoForge",
    version: "neoforge-21.1.10",
    minecraft: "1.21.1",
    path: "net.neoforged:neoforge:21.1.10",
    json: "/version.json",
    libraries: [library],
    processors:
      attack === "processor"
        ? [
            {
              jar: "fixture:processor:1",
              classpath: [],
              args: ["--output", "{ROOT}/../../processor-escape.jar"],
            },
          ]
        : [],
  };
  const version = {
    id: attack === "version" ? "../../escaped" : profile.version,
    inheritsFrom: "1.21.1",
    mainClass: "FixtureMain",
    libraries: [],
  };
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify(profile)), "install_profile.json");
  zip.addBuffer(Buffer.from(JSON.stringify(version)), "version.json");
  zip.addBuffer(Buffer.from("safe"), "data/safe.txt");
  zip.end();
  const chunks: Buffer[] = [];
  for await (const chunk of zip.outputStream) chunks.push(chunk);
  archive = Buffer.concat(chunks);
  if (attack === "archive")
    archive = Buffer.from(
      archive.toString("latin1").replaceAll("data/safe.txt", "../a/safe.txt"),
      "latin1",
    );
  const network = new NetworkService({
    allowHttpLocalhost: true,
    fetch: (async (url: string | URL | Request, init?: RequestInit) => {
      const value = String(url);
      if (value.endsWith("maven-metadata.xml"))
        return new Response("<metadata><version>21.1.10</version></metadata>");
      if (value.includes("maven.neoforged.net/releases/"))
        return fetch(base + "/" + value.split("/").at(-1), init);
      return fetch(url, init);
    }) as typeof fetch,
  });
  const java = new JavaService();
  vi.spyOn(java, "detect").mockResolvedValue([
    { path: process.execPath, version: "21", major: 21, arch: "amd64" },
  ]);
  const install = new InstallService(f.instances, f.tasks, network, f.store);
  return {
    ...f,
    loaders: new LoaderService(install, new XmclLoaderAdapter(network, java)),
  };
}
async function fixture(failProcessor = false) {
  const root = await mkdtemp(join(tmpdir(), "zhumeng-loader-"));
  roots.push(root);
  const source = join(root, "original"),
    store = join(root, "installed");
  await mkdir(join(source, "versions/1.21.1"), { recursive: true });
  await writeFile(
    join(source, "versions/1.21.1/1.21.1.json"),
    JSON.stringify({
      id: "1.21.1",
      type: "release",
      mainClass: "Main",
      minecraftArguments: "",
      libraries: [],
      javaVersion: { component: "java-runtime-delta", majorVersion: 21 },
    }),
  );
  const bytes = Buffer.from("verified artifact"),
    sha1 = createHash("sha1").update(bytes).digest("hex");
  const installerBytes = await zipBytes({
    "install_profile.json": {
      version: "fixture-forge-1",
      minecraft: "1.21.1",
      libraries: [],
      processors: [],
    },
    "version.json": {
      id: "fixture-forge-1",
      inheritsFrom: "1.21.1",
      libraries: [],
    },
  });
  const installerSha = createHash("sha1").update(installerBytes).digest("hex");
  const fetched: string[] = [];
  const network = new NetworkService({
    fetch: vi.fn(async (input) => {
      const url = String(input);
      fetched.push(url);
      if (url.endsWith("installer.jar.sha1")) return new Response(installerSha);
      if (url.endsWith("installer.jar"))
        return new Response(Uint8Array.from(installerBytes));
      if (url.endsWith(".sha1")) return new Response(sha1);
      if (url.endsWith(".jar")) return new Response(bytes);
      if (url.includes("maven-metadata.xml"))
        return new Response(
          "<metadata><version>1.20.1-47.1.1</version><version>1.21.1-52.0.1</version><version>21.1.10</version><version>21.0.1</version></metadata>",
        );
      if (url.includes("profile/json"))
        return Response.json({
          inheritsFrom: "1.21.1",
          mainClass: "LoaderMain",
          libraries: [
            { name: "fixture:loader:1", url: "https://fixture.test/" },
          ],
          arguments: { game: [], jvm: [] },
        });
      return Response.json([{ loader: { version: "1.0", stable: true } }]);
    }) as typeof fetch,
  });
  const java = new JavaService();
  vi.spyOn(java, "detect").mockResolvedValue([
    { path: "detected-java", version: "21", major: 21, arch: "amd64" },
  ]);
  const forge = vi.fn((...args: Parameters<typeof xmcl.installForgeTask>) =>
    task("fixtureForgeProcessor", async () => {
      if (failProcessor) throw new Error("Forge processor exited with code 1");
      const [, , options] = args;
      const id = options?.versionId ?? "fixture-forge-1";
      await mkdir(join(String(args[1]), "versions", id), { recursive: true });
      await writeFile(
        join(String(args[1]), "versions", id, id + ".json"),
        JSON.stringify({
          id,
          inheritsFrom: "1.21.1",
          mainClass: "ForgeMain",
          libraries: [
            { name: "fixture:loader:1", url: "https://fixture.test/" },
          ],
        }),
      );
      return id;
    }),
  );
  const neo = vi.fn(
    (
      project: "forge" | "neoforge",
      version: string,
      path: Parameters<typeof xmcl.installNeoForgedTask>[2],
      opts: xmcl.InstallForgeOptions,
    ) => forge({ mcversion: "1.21.1", version }, path, opts),
  );
  const api = { ...xmcl, installForgeTask: forge, installNeoForgedTask: neo };
  const instances = new InstanceService(),
    tasks = new TaskService();
  await instances.register({
    id: "original",
    name: "original",
    versionId: "1.21.1",
    minecraft: "1.21.1",
    resourceDir: source,
    gameDir: join(source, "game"),
    memoryMb: 2048,
    javaArgs: [],
    status: "ready",
  });
  const installer = new InstallService(instances, tasks, network, store);
  const adapter = new XmclLoaderAdapter(network, java, api);
  const loaders = new LoaderService(installer, adapter);
  return {
    root,
    source,
    store,
    fetched,
    forge,
    neo,
    adapter,
    loaders,
    instances,
    tasks,
    java,
    network,
  };
}

it.each<LoaderKind>(["forge", "neoforge"])(
  "uses custom global Java with no detected runtime during new %s and pack preparation",
  async (kind) => {
    const f = await fixture();
    vi.mocked(f.java.detect).mockResolvedValue([]);
    const custom = "C:/Custom Runtime/java.exe";
    vi.spyOn(f.java, "inspect").mockImplementation(async (path) => {
      if (path !== custom) throw new Error("unexpected executable");
      return { path, version: "21", major: 21, arch: "amd64" };
    });
    const instances = new InstanceService(undefined, async () => ({
      javaPath: custom,
      memoryMb: 4096,
      javaArgs: [],
    }));
    const install = new InstallService(instances, f.tasks, f.network, f.store);
    vi.spyOn(install, "installInto").mockImplementation(async (root) => {
      await cp(join(f.source, "versions"), join(root, "versions"), {
        recursive: true,
      });
      return {} as any;
    });
    const loaders = new LoaderService(install, f.adapter);
    const version = kind === "forge" ? "52.0.1" : "21.1.10";
    const combined = await f.tasks.wait<any>(
      install.installVanilla("combined", "1.21.1", async (item, context) => {
        expect(await instances.list()).toEqual([]);
        item.versionId = await loaders.installInto(
          item.resourceDir,
          item,
          kind,
          version,
          context,
        );
        item.loader = { kind, version };
      }),
    );
    expect(combined.javaPath).toBe(custom);
    const promoted = await (await import("@xmcl/core")).Version.parse(combined.resourceDir, combined.versionId);
    expect(promoted.minecraftDirectory).toBe(combined.resourceDir);
    expect(promoted.id).toBe(combined.versionId);
    const pack = join(f.root, "custom-java.mrpack");
    await writeFile(
      pack,
      await zipBytes({
        "modrinth.index.json": {
          formatVersion: 1,
          game: "minecraft",
          name: "pack",
          versionId: "1",
          dependencies: { minecraft: "1.21.1", [kind]: version },
          files: [],
        },
      }),
    );
    const { PackService } = await import("../src/main/services/packs");
    const imported = await f.tasks.wait<any>(
      new PackService(install, loaders).install(pack, "pack"),
    );
    expect(imported.javaPath).toBe(custom);
    expect(f.forge.mock.calls.every((args) => args[2]?.java === custom)).toBe(
      true,
    );
    expect(f.java.detect).not.toHaveBeenCalled();
    expect(await instances.list()).toHaveLength(2);
  },
);
describe("loader adapters", () => {
  it("checks the actual DownloadMultipleTask destination array before running a batch", async () => {
    const f = await fixture();
    const library = (await import("@xmcl/core")).Version.resolveLibrary({
      name: "fixture:batch:1",
      downloads: {
        artifact: {
          path: "../../escaped.jar",
          sha1: "0".repeat(40),
          size: 1,
          url: "https://invalid.test/library",
        },
      },
    })!;
    const batch = xmcl.installResolvedLibrariesTask([library], f.source);
    const id = f.tasks.start("unsafe batch", (context) =>
      runInstallerTask(batch, f.source, context),
    );
    await expect(f.tasks.wait(id)).rejects.toThrow(/目录/);
    expect(await readdir(f.root)).toEqual(["original"]);
  });
  it("runs a real NeoForge archive through unpack and install-profile reread", async () => {
    const f = await archiveFixture();
    const result = await f.tasks.wait<
      Awaited<ReturnType<InstanceService["get"]>>
    >(f.loaders.install("original", "neoforge", "21.1.10"));
    expect(result.versionId).toBe("neoforge-21.1.10");
    expect(
      await readFile(
        join(result.resourceDir, "libraries/fixture/batch/1/batch-1.jar"),
        "utf8",
      ),
    ).toBe("library fixture");
  });
  it.each(["batch", "version", "processor", "archive"] as const)(
    "rejects %s paths in a real installer before unpack/download writes",
    async (attack) => {
      const f = await archiveFixture(attack);
      await expect(
        f.tasks.wait(f.loaders.install("original", "neoforge", "21.1.10")),
      ).rejects.toThrow(/路径|版本|目录|path/);
      expect(await readdir(f.store)).toEqual([]);
      expect((await f.instances.get("original")).resourceDir).toBe(f.source);
    },
  );
  it.each<LoaderKind>(["fabric", "quilt", "forge", "neoforge"])(
    "installs %s and verifies dependencies before switching the instance",
    async (kind) => {
      const f = await fixture();
      const version = (await f.loaders.versions(kind, "1.21.1"))[0].version;
      const item = await f.tasks.wait<
        Awaited<ReturnType<InstanceService["get"]>>
      >(f.loaders.install("original", kind, version));
      expect(item.loader).toEqual({ kind, version });
      expect(item.resourceDir).not.toBe(f.source);
      expect(item.gameDir).toBe(join(f.source, "game"));
      expect(
        await readFile(
          join(item.resourceDir, "libraries/fixture/loader/1/loader-1.jar"),
          "utf8",
        ),
      ).toBe("verified artifact");
      expect((await f.instances.get("original")).versionId).toBe(
        item.versionId,
      );
      expect(await readdir(join(f.source, "versions"))).toEqual(["1.21.1"]);
      if (kind === "forge") {
        expect(f.neo).not.toHaveBeenCalled();
        expect(f.forge.mock.calls[0][0].version).toBe("52.0.1");
        expect(f.forge.mock.calls[0][2]?.java).toBe("detected-java");
        expect(f.forge.mock.calls[0][0].installer?.path).toMatch(/^https:/);
      } else if (kind === "neoforge")
        expect(f.neo.mock.calls[0].slice(0, 2)).toEqual([
          "neoforge",
          "21.1.10",
        ]);
      else {
        expect(f.forge).not.toHaveBeenCalled();
        expect(
          f.fetched.some(
            (url) =>
              url.includes(
                kind === "fabric"
                  ? "meta.fabricmc.net/v2/"
                  : "meta.quiltmc.org/v3/",
              ) && url.endsWith("profile/json"),
          ),
        ).toBe(true);
      }
    },
  );
  it("keeps the original instance and cleans staging after a Forge processor fails", async () => {
    const f = await fixture(true);
    const before = await f.instances.get("original");
    const id = f.loaders.install("original", "forge", "52.0.1");
    await expect(f.tasks.wait(id)).rejects.toThrow(/processor/);
    expect(await f.instances.get("original")).toEqual(before);
    expect(f.tasks.list()[0].status).toBe("failed");
    expect(await readdir(f.store)).toEqual([]);
  });
  it("forwards cancellation to the installer task and terminates active processors", async () => {
    const tasks = new TaskService();
    const child = spawn(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      windowsHide: true,
    });
    await new Promise<void>((r, reject) => {
      child.once("spawn", r);
      child.once("error", reject);
    });
    let reject!: (e: Error) => void, started!: () => void;
    const start = new Promise<void>((r) => {
      started = r;
    });
    const cancel = vi.fn(async () => reject(new Error("cancelled")));
    const fake = {
      startAndWait: () => {
        started();
        return new Promise<string>((_r, j) => {
          reject = j;
        });
      },
      cancel,
    } as unknown as Task<string>;
    const id = tasks.start("processor", (context) =>
      runInstallerTask(fake, tmpdir(), context, new Set([child])),
    );
    await start;
    await tasks.cancel(id);
    expect(cancel).toHaveBeenCalledOnce();
    expect(child.exitCode !== null || child.signalCode !== null).toBe(true);
    expect(tasks.list()[0].status).toBe("cancelled");
  });
  it("uses strict IPC validators and exposes the shared task service", async () => {
    const f = await fixture(),
      router = new CommandRouter();
    const services = registerGameCommands(
      router,
      join(f.root, "registry.json"),
    );
    await expect(
      router.invoke("loaders.install", {
        kind: "bad",
        instanceId: "id",
        version: "1",
      }),
    ).rejects.toThrow(/加载器/);
    await expect(
      router.invoke("install.vanilla", { name: "test", version: "../escape" }),
    ).rejects.toThrow(/版本/);
    await expect(router.invoke("tasks.cancel", {})).rejects.toThrow();
    const id = services.tasks.start("composition", async () => ({
      instanceId: "result",
    }));
    expect(await services.tasks.wait(id)).toEqual({ instanceId: "result" });
    expect(await router.invoke("tasks.list", undefined)).toEqual(
      services.tasks.list(),
    );
  });
});
