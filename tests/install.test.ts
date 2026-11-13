import { afterEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server, type ServerResponse } from "node:http";
import { mkdtemp, readdir, readFile, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { NetworkService } from "../src/main/services/network";
import { TaskService } from "../src/main/services/tasks";
import { InstallService } from "../src/main/services/install";
import { InstanceService } from "../src/main/services/instances";

const roots: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  await Promise.all(
    servers.splice(0).map(
      (s) =>
        new Promise<void>((r) => {
          s.closeAllConnections();
          s.close(() => r());
        }),
    ),
  );
  await Promise.all(
    roots.splice(0).map((p) => rm(p, { recursive: true, force: true })),
  );
});
async function fixture(corrupt = false, corruptLogging = false, hold?: (path: string, response: ServerResponse, bytes: Buffer) => boolean) {
  const root = await mkdtemp(join(tmpdir(), "zhumeng-install-"));
  roots.push(root);
  const bytes = Buffer.from("fixture jar");
  const hash = createHash("sha1").update(bytes).digest("hex");
  let base = "";
  const server = createServer((req, res) => {
    if (hold?.(req.url ?? "", res, bytes)) return;
    if (req.url === "/slow") {
      res.writeHead(200);
      res.write("first");
      const interval = setInterval(() => res.write("more"), 20);
      res.on("close", () => clearInterval(interval));
      return;
    }
    if (
      req.url === "/jar" ||
      req.url === "/library" ||
      req.url === "/asset" ||
      req.url === "/logging"
    ) {
      res.end(bytes);
      return;
    }
    const index = JSON.stringify({
      objects: { sound: { hash, size: bytes.length } },
    });
    if (req.url === "/index") {
      res.end(index);
      return;
    }
    const version = {
      id: "1.fixture",
      type: "release",
      mainClass: "net.minecraft.client.main.Main",
      minecraftArguments: "",
      time: "2024-01-01T00:00:00Z",
      releaseTime: "2024-01-01T00:00:00Z",
      assets: "fixture",
      logging: {
        client: {
          argument: "-Dlog4j.configurationFile=${path}",
          file: {
            id: "client.xml",
            url: base + "/logging",
            sha1: corruptLogging ? "0".repeat(40) : hash,
            size: bytes.length,
          },
          type: "log4j2-xml",
        },
      },
      assetIndex: {
        id: "fixture",
        url: base + "/index",
        sha1: createHash("sha1").update(index).digest("hex"),
        size: Buffer.byteLength(index),
      },
      downloads: {
        client: {
          url: base + "/jar",
          sha1: corrupt ? "0".repeat(40) : hash,
          size: bytes.length,
        },
      },
      libraries: [
        {
          name: "test:library:1",
          downloads: {
            artifact: {
              path: "test/library/1/library-1.jar",
              url: base + "/library",
              sha1: hash,
              size: bytes.length,
            },
          },
        },
      ],
    };
    if (req.url === "/version") {
      res.end(JSON.stringify(version));
      return;
    }
    res.end(
      JSON.stringify({
        versions: [{ id: "1.fixture", url: base + "/version" }],
      }),
    );
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  servers.push(server);
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const network = new NetworkService({ allowHttpLocalhost: true });
  const tasks = new TaskService(),
    instances = new InstanceService();
  const install = new InstallService(instances, tasks, network, root, {
    manifestUrl: base + "/manifest",
    assetUrl: () => base + "/asset",
  });
  return { root, base, network, tasks, instances, install };
}
describe("installation and downloads", () => {
  it("rejects corrupt logging configuration before registration", async () => {
    const f = await fixture(false, true);
    await expect(
      f.tasks.wait(f.install.installVanilla("logging", "1.fixture")),
    ).rejects.toThrow(/SHA1/);
    expect(await f.instances.list()).toEqual([]);
    expect(await readdir(f.root)).toEqual([expect.stringMatching(/^\.zhumeng-install-[a-f0-9]{64}$/)]);
  });
  it("downloads vanilla metadata, libraries and assets before registration", async () => {
    const f = await fixture();
    const id = f.install.installVanilla("测试", "1.fixture");
    const item =
      await f.tasks.wait<Awaited<ReturnType<InstanceService["get"]>>>(id);
    expect(await f.instances.list()).toHaveLength(1);
    expect(
      await readFile(
        join(item.resourceDir, "libraries/test/library/1/library-1.jar"),
        "utf8",
      ),
    ).toBe("fixture jar");
    expect(
      await readdir(join(item.resourceDir, "assets/objects")),
    ).toHaveLength(1);
    expect(f.tasks.list()[0].status).toBe("completed");
    expect(
      await readFile(
        join(item.resourceDir, "assets/log_configs/client.xml"),
        "utf8",
      ),
    ).toBe("fixture jar");
  });
  it("rejects a corrupt hash without registering or leaving staging files", async () => {
    const f = await fixture(true);
    await expect(
      f.tasks.wait(f.install.installVanilla("坏版本", "1.fixture")),
    ).rejects.toThrow(/SHA1/);
    expect(await f.instances.list()).toEqual([]);
    expect(await readdir(f.root)).toEqual([expect.stringMatching(/^\.zhumeng-install-[a-f0-9]{64}$/)]);
  });
  it("cancels a live stream, cleans partials and retries with a new task", async () => {
    const f = await fixture();
    let calls = 0;
    const id = f.tasks.start("stream", async (context) => {
      calls++;
      return f.network.download(
        f.root,
        { url: f.base + (calls === 1 ? "/slow" : "/jar"), path: "file.jar" },
        context,
      );
    });
    await new Promise<void>((resolve) => {
      const off = f.tasks.onSnapshot((s) => {
        if (s.id === id && s.bytesPerSecond > 0) {
          off();
          resolve();
        }
      });
    });
    await f.tasks.cancel(id);
    expect(f.tasks.list()[0].status).toBe("cancelled");
    expect(await readdir(f.root)).toEqual([]);
    const retry = f.tasks.retry(id);
    await f.tasks.wait(retry);
    expect(retry).not.toBe(id);
    expect(f.tasks.list()[1].status).toBe("completed");
  });
  it("rejects insecure production URLs and paths outside its root", async () => {
    const f = await fixture();
    expect(() => new NetworkService().validateUrl(f.base)).toThrow(/HTTPS/);
    await expect(
      f.tasks.wait(
        f.tasks.start("escape", (c) =>
          f.network.download(f.root, { url: f.base, path: "../escape" }, c),
        ),
      ),
    ).rejects.toThrow(/目录/);
  });
  it("refuses duplicate names without replacing the completed instance", async () => {
    const f = await fixture();
    await f.tasks.wait(f.install.installVanilla("existing", "1.fixture"));
    const before = await f.instances.list();
    await expect(
      f.tasks.wait(f.install.installVanilla("existing", "1.fixture")),
    ).rejects.toThrow(/存在/);
    expect(await f.instances.list()).toEqual(before);
  });
  it("validates every redirect and rejects HTTPS downgrades", async () => {
    const network = new NetworkService({
      fetch: async () =>
        new Response(null, {
          status: 302,
          headers: { location: "http://untrusted.test/file" },
        }),
    });
    await expect(network.response("https://trusted.test/file")).rejects.toThrow(
      /HTTPS/,
    );
  });
});
it("prepares a selected loader before publication and rolls back failed preparation", async () => {
  const f = await fixture();
  let seen = "";
  const id = f.install.installVanilla(
    "Loader world",
    "1.fixture",
    async (item) => {
      seen = item.minecraft;
      expect(await f.instances.list()).toEqual([]);
      throw new Error("loader rejected");
    },
  );
  await expect(f.tasks.wait(id)).rejects.toThrow("loader rejected");
  expect(seen).toBe("1.fixture");
  expect(await f.instances.list()).toEqual([]);
  expect(await readdir(f.root)).toEqual([expect.stringMatching(/^\.zhumeng-install-[a-f0-9]{64}$/)]);
});

it("resolves manual global Java before combined loader preparation without early registration", async () => {
  const f = await fixture();
  const instances = new InstanceService(undefined, async () => ({
    memoryMb: 4096,
    javaArgs: ["-Ddefault=yes"],
    javaPath: "C:/Custom Java/java.exe",
  }));
  const install = new InstallService(instances, f.tasks, f.network, f.root);
  vi.spyOn(install, "installInto").mockResolvedValue({} as any);
  for (const kind of ["forge", "neoforge"]) {
    const item = await f.tasks.wait<any>(
      install.installVanilla(kind, "1.fixture", async (item) => {
        if (item.javaPath !== "C:/Custom Java/java.exe")
          throw new Error("missing manual Java before processors");
        expect((await instances.list()).some((x) => x.id === item.id)).toBe(
          false,
        );
      }),
    );
    expect(item.javaPath).toBe("C:/Custom Java/java.exe");
    expect(item.memoryMb).toBe(4096);
  }
});

describe("Minecraft catalogue metadata", () => {
  const make = (manifest: unknown) => {
    const network = new NetworkService();
    vi.spyOn(network, "json").mockResolvedValue(manifest);
    return new InstallService(
      new InstanceService(),
      new TaskService(),
      network,
      "unused",
    );
  };
  const entry = (id: string, releaseTime?: string) => ({
    id,
    type: "release",
    url: "https://piston-meta.mojang.com/version",
    releaseTime,
  });
  it("returns actual latest IDs, source dates and source-time ordering while keeping versions compatible", async () => {
    const install = make({
      latest: { release: "1.21", snapshot: "25w01a" },
      versions: [
        entry("1.9", "2016-01-01T00:00:00Z"),
        entry("1.21", "2024-01-01T00:00:00Z"),
        { ...entry("25w01a", "2025-01-01T00:00:00Z"), type: "snapshot" },
      ],
    });
    const catalog = await install.catalog();
    expect(catalog.latest).toEqual({ release: "1.21", snapshot: "25w01a" });
    expect(catalog.versions.map((x) => x.id)).toEqual([
      "25w01a",
      "1.21",
      "1.9",
    ]);
    expect(catalog.versions[1].releaseTime).toBe("2024-01-01T00:00:00Z");
    expect(await install.versions()).toEqual(catalog.versions);
    expect(
      (await make({ versions: [entry("legacy")] }).catalog()).versions[0]
        .releaseTime,
    ).toBeUndefined();
  });
  it.each([
    { versions: [entry("bad", "yesterday")] },
    { versions: [entry("duplicate"), entry("duplicate")] },
    { latest: { release: "missing" }, versions: [entry("valid")] },
    { versions: [{ ...entry("valid"), type: "fabricated" }] },
    { versions: [{ ...entry("valid"), url: "file:///secret" }] },
    { versions: [{ ...entry("../escape") }] },
    { versions: [null] },
  ])(
    "rejects malformed metadata before it reaches the renderer: %j",
    async (manifest) => {
      await expect(make(manifest).catalog()).rejects.toThrow();
    },
  );
});

describe("installation admission recovery", () => {
  it("coalesces concurrent identical requests and publishes a named isolated root", async () => {
    const f = await fixture();
    const first = f.install.installVanilla("coalesced", "1.fixture");
    const second = f.install.installVanilla("coalesced", "1.fixture");
    expect(second).toBe(first);
    const item = await f.tasks.wait<Awaited<ReturnType<InstanceService["get"]>>>(first);
    expect(item.resourceDir).toBe(join(f.root, "coalesced"));
    expect(item.gameDir).toBe(join(f.root, "coalesced", "game"));
  });
});

it("bounds stalled response bodies and preserves cancellation", async () => {
  const root = await mkdtemp(join(tmpdir(), "zhumeng-stall-")); roots.push(root);
  const server = createServer((_req, res) => { res.writeHead(200); res.write("partial"); });
  await new Promise<void>(r => server.listen(0, "127.0.0.1", r)); servers.push(server);
  const url = `http://127.0.0.1:${(server.address() as {port:number}).port}/stall`;
  const network = new NetworkService({allowHttpLocalhost:true, idleTimeoutMs:50, retries:1});
  await expect(network.download(root, {url, path:"stall"}, {signal:new AbortController().signal,report(){}})).rejects.toThrow(/超时/);
  expect(await readdir(root)).toEqual([]);
}, 3000);

it("captures the root, releases queued cancellation, and rejects conflicting targets", async () => {
  const f = await fixture();
  const other = join(f.root, "other");
  const first = f.install.installVanilla("captured", "1.fixture");
  expect(f.install.preview("captured").activeTaskId).toBe(first);
  expect(() => f.install.installVanilla("captured", "1.fixture", undefined, {loaderFingerprint:"fabric:1"})).toThrow(/其他配置/);
  f.install.root = other;
  await f.tasks.cancel(first);
  expect(f.install.preview("captured", f.root).activeTaskId).toBeUndefined();
  const retry = f.tasks.retry(first);
  const item = await f.tasks.wait<Awaited<ReturnType<InstanceService["get"]>>>(retry);
  expect(item.resourceDir).toBe(join(f.root, "captured"));
});

it("keeps verified cache for retry and never adopts an existing target", async () => {
  const f = await fixture();
  let attempts = 0;
  const task = f.install.installVanilla("retry", "1.fixture", async () => { if (++attempts === 1) throw Error("fixture failure"); });
  await expect(f.tasks.wait(task)).rejects.toThrow("fixture failure");
  const cache = (await readdir(f.root)).find(x => x.startsWith(".zhumeng-install-"))!;
  expect(await readFile(join(f.root, cache, "work/versions/1.fixture/1.fixture.jar"), "utf8")).toBe("fixture jar");
  const retry = f.tasks.retry(task);
  const item = await f.tasks.wait<Awaited<ReturnType<InstanceService["get"]>>>(retry);
  expect(item.resourceDir).toBe(join(f.root, "retry"));
  await mkdir(join(f.root, "existing"));
  const conflict = f.install.installVanilla("existing", "1.fixture");
  await expect(f.tasks.wait(conflict)).rejects.toThrow(/已存在/);
  expect(await readFile(join(item.resourceDir, "versions/1.fixture/1.fixture.jar"), "utf8")).toBe("fixture jar");
});

it("reports monotonic progress below completion until publication", async () => {
  const f = await fixture(); const snapshots: {status:string;progress:number}[] = [];
  f.tasks.onSnapshot(s => snapshots.push(s));
  await f.tasks.wait(f.install.installVanilla("progress", "1.fixture"));
  for (let i = 1; i < snapshots.length; i++) expect(snapshots[i].progress).toBeGreaterThanOrEqual(snapshots[i-1].progress);
  expect(snapshots.filter(s => s.status !== "completed").every(s => s.progress < 1)).toBe(true);
});


it("preserves a target created during preparation", async () => {
  const f = await fixture();
  const final = join(f.root, "raced");
  const task = f.install.installVanilla("raced", "1.fixture", async () => {
    await mkdir(final); await import("node:fs/promises").then(fs => fs.writeFile(join(final, "user.txt"), "keep"));
  });
  await expect(f.tasks.wait(task)).rejects.toThrow(/已存在/);
  expect(await readFile(join(final, "user.txt"), "utf8")).toBe("keep");
  expect(await f.instances.list()).toEqual([]);
});

it("rolls back an owned receipt when registration fails and permits retry", async () => {
  const f = await fixture();
  const service = f.instances as InstanceService & { registerOwned?: (item: any, signal?: AbortSignal) => Promise<any> };
  let fail = true;
  if (service.registerOwned) {
    const original = service.registerOwned.bind(service);
    service.registerOwned = async (item, signal) => {
      if (!fail) return original(item, signal);
      fail = false;
      await import("node:fs/promises").then(fs => fs.writeFile(join(item.resourceDir, ".zhumeng-owner.json"), JSON.stringify({schema:1, instanceId:item.id, root:item.resourceDir})));
      throw Error("registry failure");
    };
  } else {
    const original = service.register.bind(service);
    service.register = async (item, expected, signal) => {
      if (!fail) return original(item, expected, signal);
      fail = false; throw Error("registry failure");
    };
  }
  const task = f.install.installVanilla("rollback", "1.fixture");
  await expect(f.tasks.wait(task)).rejects.toThrow("registry failure");
  await expect(readFile(join(f.root, "rollback", ".zhumeng-owner.json"))).rejects.toThrow();
  const retry = f.tasks.retry(task);
  const item = await f.tasks.wait<Awaited<ReturnType<InstanceService["get"]>>>(retry);
  expect(item.resourceDir).toBe(join(f.root, "rollback"));
});

it("identifies an unregistered marked final for explicit import and preserves unknown folders", async () => {
  const f = await fixture();
  const fs = await import("node:fs/promises");
  const folder = join(f.root, "recover"); await fs.mkdir(folder);
  expect(await f.install.previewForUi("recover")).toMatchObject({existingDirectory:folder});
  expect((await f.install.previewForUi("recover")).recoverableDirectory).toBeUndefined();
  const fingerprint = JSON.stringify({name:"recover",version:"1.fixture",loader:"vanilla",root:f.root});
  await fs.writeFile(join(folder, ".zhumeng-install-cache.json"), JSON.stringify({schema:1,fingerprint}));
  expect((await f.install.previewForUi("recover")).recoverableDirectory).toBe(folder);
  expect(JSON.parse(await fs.readFile(join(folder, ".zhumeng-install-cache.json"), "utf8")).fingerprint).toBe(fingerprint);
});


it("advances dependency progress after the asset index completes", async () => {
  const pending = new Map<string, { response: ServerResponse; bytes: Buffer }>();
  let bothStarted!: () => void;
  const started = new Promise<void>(resolve => { bothStarted = resolve; });
  const f = await fixture(false, false, (path, response, bytes) => {
    if (path !== "/library" && path !== "/asset") return false;
    pending.set(path, {response, bytes});
    if (pending.size === 2) bothStarted();
    return true;
  });
  const progress: number[] = [];
  f.tasks.onSnapshot(snapshot => progress.push(snapshot.progress));
  const task = f.install.installVanilla("phase-progress", "1.fixture");
  try {
    await started;
    const afterIndex = progress.at(-1)!;
    expect(afterIndex).toBeLessThan(0.8);
    const library = pending.get("/library")!;
    library.response.end(library.bytes);
    await vi.waitFor(() => expect(progress.at(-1)!).toBeGreaterThan(afterIndex));
    expect(progress.at(-1)!).toBeLessThan(0.8);
  } finally {
    for (const {response, bytes} of pending.values()) if (!response.writableEnded) response.end(bytes);
    await f.tasks.wait(task);
  }
});
