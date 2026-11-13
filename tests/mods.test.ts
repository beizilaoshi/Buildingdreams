import { afterEach, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import {
  mkdtemp,
  readFile,
  readdir,
  rm,
  writeFile,
  symlink,
  mkdir,
  rename,
} from "node:fs/promises";
vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { ModrinthService } from "../src/main/services/modrinth";
import { ModService } from "../src/main/services/mods";
import { NetworkService } from "../src/main/services/network";
import { InstanceService } from "../src/main/services/instances";
import { TaskService } from "../src/main/services/tasks";
import type { ContentVersion } from "../src/shared/content";
import { CommandRouter } from "../src/main/ipc";
import { registerModCommands } from "../src/main/mod-router";
const roots: string[] = [],
  servers: Server[] = [];
afterEach(async () => {
  for (const s of servers.splice(0)) {
    s.closeAllConnections();
    await new Promise<void>((r) => s.close(() => r()));
  }
  for (const p of roots.splice(0))
    await rm(p, { recursive: true, force: true });
});
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "mods-"));
  roots.push(root);
  const bytes = Buffer.from("fixture jar");
  const versions: Record<string, ContentVersion> = {};
  const requests: string[] = [];
  let base = "";
  let corrupt = false;
  let onDownload: (() => void) | undefined;
  let downloadGate: Promise<void> | undefined;
  const server = createServer(async (req, res) => {
    const url = new URL(req.url!, base);
    requests.push(req.url!);
    if (url.pathname === "/unavailable") {res.writeHead(503); return void res.end("unavailable");}
    if (url.pathname === "/jar") {
      onDownload?.();
      await downloadGate;
      return void res.end(corrupt ? Buffer.alloc(bytes.length) : bytes);
    }
    if (url.pathname === "/search")
      return void res.end(
        JSON.stringify({ hits: [], offset: 0, limit: 20, total_hits: 0 }),
      );
    if (url.pathname.startsWith("/version/"))
      return void res.end(
        JSON.stringify(versions[url.pathname.split("/").pop()!]),
      );
    const project = url.pathname.split("/")[2];
    res.end(
      JSON.stringify(
        Object.values(versions).filter((v) => v.project_id === project),
      ),
    );
  });
  servers.push(server);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
  const network = new NetworkService({ allowHttpLocalhost: true }),
    tasks = new TaskService(),
    instances = new InstanceService();
  await instances.register({
    id: "i",
    name: "i",
    versionId: "1.21",
    gameDir: root,
    resourceDir: root,
    minecraft: "1.21",
    loader: { kind: "fabric", version: "1" },
    memoryMb: 2048,
    javaArgs: [],
    status: "ready",
  });
  const api = new ModrinthService(network, base),
    mods = new ModService(instances, tasks, network, api);
  const version = (
    id: string,
    project = id,
    deps: ContentVersion["dependencies"] = [],
  ) =>
    (versions[id] = {
      id,
      project_id: project,
      name: id,
      version_number: id,
      date_published: id === "new" ? "2026-01-01" : "2025-01-01",
      game_versions: ["1.21"],
      loaders: ["fabric"],
      dependencies: deps,
      files: [
        {
          url: base + "/jar",
          filename: id + ".jar",
          size: bytes.length,
          primary: true,
          hashes: { sha1: createHash("sha1").update(bytes).digest("hex") },
        },
      ],
    });
  return {
    root,
    network,
    tasks,
    instances,
    api,
    mods,
    version,
    requests,
    bytes,
    gate: () => {
      let release!: () => void, started!: () => void;
      const downloading = new Promise<void>((r) => {
        started = r;
      });
      downloadGate = new Promise<void>((r) => {
        release = r;
      });
      onDownload = started;
      return { downloading, release };
    },
    corrupt: () => {
      corrupt = true;
    },
  };
}
it("sends Modrinth game/loader/type facets and version filters", async () => {
  const f = await fixture();
  f.version("a");
  await f.api.search("hello", {
    projectType: "modpack",
    minecraft: "1.21",
    loader: "fabric",
  });
  const q = new URL(f.requests[0], "http://a").searchParams;
  expect(JSON.parse(q.get("facets")!)).toEqual([
    ["project_type:modpack"],
    ["versions:1.21"],
    ["categories:fabric"],
  ]);
  await f.api.versions("a", { minecraft: "1.21", loader: "fabric" });
  expect(f.requests[1]).toContain("game_versions=%5B%221.21%22%5D");
});

for (const change of ["add", "edit", "remove"] as const) {
  it(`preserves an external ${change} during a gated Mod download and rejects publication`, async () => {
    const f = await fixture();
    f.version("old", "project");
    await f.tasks.wait(f.mods.install("i", "old"));
    const original = join(f.root, "mods", "external.jar");
    await writeFile(original, "original");
    const provenance = await readFile(
      join(f.root, "mods", ".zhumeng-mods.json"),
    );
    f.version("new", "project");
    const gate = f.gate();
    const pending = f.tasks.wait(f.mods.update("i", "new"));
    await gate.downloading;
    if (change === "add")
      await writeFile(join(f.root, "mods", "added.jar"), "added");
    if (change === "edit") await writeFile(original, "edited");
    if (change === "remove") await rm(original);
    gate.release();
    await expect(pending).rejects.toThrow(/外部|变化|冲突/);
    expect(await readFile(join(f.root, "mods", "old.jar"))).toEqual(f.bytes);
    expect(await readFile(join(f.root, "mods", ".zhumeng-mods.json"))).toEqual(
      provenance,
    );
    if (change === "add")
      expect(await readFile(join(f.root, "mods", "added.jar"), "utf8")).toBe(
        "added",
      );
    if (change === "edit")
      expect(await readFile(original, "utf8")).toBe("edited");
    if (change === "remove")
      await expect(readFile(original)).rejects.toMatchObject({
        code: "ENOENT",
      });
  });
}

it("rechecks the claimed old directory and restores external changes after the rename", async () => {
  const f = await fixture();
  f.version("old", "project");
  await f.tasks.wait(f.mods.install("i", "old"));
  const provenance = await readFile(join(f.root, "mods/.zhumeng-mods.json"));
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(rename).mockImplementation(async (from, to) => {
    await actual.rename(from, to);
    if (from === join(f.root, "mods"))
      await writeFile(join(String(to), "external.jar"), "external after claim");
  });
  try {
    f.version("new", "project");
    await expect(f.tasks.wait(f.mods.update("i", "new"))).rejects.toThrow(
      /外部变化/,
    );
    expect(await readFile(join(f.root, "mods/external.jar"), "utf8")).toBe(
      "external after claim",
    );
    expect(await readFile(join(f.root, "mods/old.jar"))).toEqual(f.bytes);
    expect(await readFile(join(f.root, "mods/.zhumeng-mods.json"))).toEqual(
      provenance,
    );
  } finally {
    vi.mocked(rename).mockImplementation(actual.rename);
  }
});

it("rejects an external directory removal between checking and claiming without resurrecting deleted Mods", async () => {
  const f = await fixture();
  f.version("old", "project");
  await f.tasks.wait(f.mods.install("i", "old"));
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(rename).mockImplementation(async (from, to) => {
    if (from === join(f.root, "mods"))
      await actual.rm(from, { recursive: true });
    await actual.rename(from, to);
  });
  try {
    f.version("new", "project");
    await expect(f.tasks.wait(f.mods.update("i", "new"))).rejects.toThrow(
      /外部变化/,
    );
    await expect(readdir(join(f.root, "mods"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  } finally {
    vi.mocked(rename).mockImplementation(actual.rename);
  }
});

it("retains the changed backup and a concurrently recreated directory when conflict restoration is blocked", async () => {
  const f = await fixture();
  f.version("old", "project");
  await f.tasks.wait(f.mods.install("i", "old"));
  const provenance = await readFile(join(f.root, "mods/.zhumeng-mods.json"));
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  vi.mocked(rename).mockImplementation(async (from, to) => {
    await actual.rename(from, to);
    if (from === join(f.root, "mods")) {
      await writeFile(join(String(to), "external.jar"), "changed backup");
      await mkdir(from);
      await writeFile(
        join(String(from), "concurrent.jar"),
        "concurrent target",
      );
    }
  });
  try {
    f.version("new", "project");
    await expect(f.tasks.wait(f.mods.update("i", "new"))).rejects.toThrow(
      /保留在/,
    );
    expect(await readFile(join(f.root, "mods/concurrent.jar"), "utf8")).toBe(
      "concurrent target",
    );
    const [backup] = (await readdir(f.root)).filter((name) =>
      name.startsWith(".mods-backup-"),
    );
    expect(await readFile(join(f.root, backup, "external.jar"), "utf8")).toBe(
      "changed backup",
    );
    expect(await readFile(join(f.root, backup, ".zhumeng-mods.json"))).toEqual(
      provenance,
    );
  } finally {
    vi.mocked(rename).mockImplementation(actual.rename);
  }
});
it("installs diamond required dependencies only once and persists provenance", async () => {
  const f = await fixture();
  f.version("d");
  f.version("b", "b", [{ project_id: "d", dependency_type: "required" }]);
  f.version("c", "c", [{ version_id: "d", dependency_type: "required" }]);
  f.version("a", "a", [
    { project_id: "b", dependency_type: "required" },
    { project_id: "c", dependency_type: "required" },
  ]);
  await f.tasks.wait(f.mods.install("i", "a"));
  expect((await f.mods.list("i")).map((m) => m.versionId).sort()).toEqual([
    "a",
    "b",
    "c",
    "d",
  ]);
  expect(f.requests.filter((r) => r === "/jar")).toHaveLength(4);
});
it("rejects cycles, incompatible versions and traversal without touching existing mods", async () => {
  const f = await fixture();
  f.version("old");
  await f.tasks.wait(f.mods.install("i", "old"));
  f.version("a", "a", [{ project_id: "b", dependency_type: "required" }]);
  f.version("b", "b", [{ project_id: "a", dependency_type: "required" }]);
  await expect(f.tasks.wait(f.mods.install("i", "a"))).rejects.toThrow(
    "依赖环",
  );
  f.version("bad").loaders = ["forge"];
  await expect(f.tasks.wait(f.mods.install("i", "bad"))).rejects.toThrow(
    "不兼容",
  );
  f.version("escape").files[0].filename = "../escape.jar";
  await expect(f.tasks.wait(f.mods.install("i", "escape"))).rejects.toThrow(
    "文件名",
  );
  expect((await f.mods.list("i")).map((m) => m.fileName)).toEqual(["old.jar"]);
});
it("updates atomically, preserves disabled state, and never leaves old and new jars", async () => {
  const f = await fixture();
  f.version("old", "p");
  await f.tasks.wait(f.mods.install("i", "old"));
  await f.mods.toggle("i", "old.jar", false);
  f.version("new", "p");
  expect((await f.mods.checkUpdates("i"))[0].version.id).toBe("new");
  f.corrupt();
  await expect(f.tasks.wait(f.mods.update("i", "new"))).rejects.toThrow("校验");
  expect((await f.mods.list("i")).map((m) => m.fileName)).toEqual([
    "old.jar.disabled",
  ]);
  expect(await readdir(f.root)).toEqual(["mods"]);
});
it("successful update replaces original jar and keeps metadata", async () => {
  const f = await fixture();
  f.version("old", "p");
  await f.tasks.wait(f.mods.install("i", "old"));
  await f.mods.toggle("i", "old.jar", false);
  f.version("new", "p");
  await f.tasks.wait(f.mods.update("i", "new"));
  const mods = await f.mods.list("i");
  expect(mods).toHaveLength(1);
  expect(mods[0]).toMatchObject({
    fileName: "new.jar.disabled",
    versionId: "new",
    enabled: false,
  });
});
it("imports, toggles and removes only contained local jars", async () => {
  const f = await fixture();
  const local = join(f.root, "local.jar");
  await writeFile(local, f.bytes);
  await f.mods.importJar("i", local);
  await f.mods.toggle("i", "local.jar", false);
  expect(await readFile(local)).toEqual(f.bytes);
  await expect(f.mods.remove("i", "../local.jar")).rejects.toThrow();
  await f.mods.remove("i", "local.jar.disabled");
  expect(await f.mods.list("i")).toEqual([]);
  expect(await readFile(local)).toEqual(f.bytes);
});
it("rejects strict malformed IPC inputs and duplicate registrations", async () => {
  const f = await fixture(),
    router = new CommandRouter();
  registerModCommands(router, f);
  await expect(
    router.invoke("mods.toggle", {
      instanceId: "i",
      fileName: "x.jar",
      enabled: "yes",
    }),
  ).rejects.toThrow();
  await expect(
    router.invoke("content.search", {
      query: "x",
      filter: { loader: "anything" },
    }),
  ).rejects.toThrow();
  await expect(
    router.invoke("mods.install", {
      instanceId: "i",
      versionId: "a",
      extra: true,
    }),
  ).rejects.toThrow();
  expect(() => registerModCommands(router, f)).toThrow("重复");
});
it("serializes concurrent installs and local mutations per instance", async () => {
  const f = await fixture();
  f.version("a");
  f.version("b");
  await Promise.all([
    f.tasks.wait(f.mods.install("i", "a")),
    f.tasks.wait(f.mods.install("i", "b")),
  ]);
  await Promise.all([
    f.mods.toggle("i", "a.jar", false),
    f.mods.remove("i", "b.jar"),
  ]);
  expect((await f.mods.list("i")).map((m) => m.fileName)).toEqual([
    "a.jar.disabled",
  ]);
});
it("rejects conflicts declared by already installed mods and pinned dependency replacement", async () => {
  const f = await fixture();
  f.version("a", "a", [{ project_id: "b", dependency_type: "incompatible" }]);
  await f.tasks.wait(f.mods.install("i", "a"));
  f.version("b");
  await expect(f.tasks.wait(f.mods.install("i", "b"))).rejects.toThrow("冲突");
  expect(await f.mods.list("i")).toHaveLength(1);
});
it("rejects mods junctions before copying or writing", async () => {
  const f = await fixture();
  const outside = join(f.root, "outside");
  await mkdir(outside);
  await symlink(outside, join(f.root, "mods"), "junction");
  f.version("a");
  await expect(f.tasks.wait(f.mods.install("i", "a"))).rejects.toThrow(
    "符号链接",
  );
  expect(await readdir(outside)).toEqual([]);
});
it("rejects incompatible pinned dependency versions", async () => {
  const f = await fixture();
  f.version("d1", "d");
  f.version("d2", "d");
  f.version("a", "a", [
    { version_id: "d1", dependency_type: "required" },
    { version_id: "d2", dependency_type: "required" },
  ]);
  await expect(f.tasks.wait(f.mods.install("i", "a"))).rejects.toThrow(
    "版本冲突",
  );
  expect(await f.mods.list("i")).toEqual([]);
});
it("rejects Windows case aliases before downloads and preserves managed bytes and provenance", async () => {
  const f = await fixture();
  f.version("Example");
  await f.tasks.wait(f.mods.install("i", "Example"));
  const path = join(f.root, "mods", "Example.jar"),
    metadata = join(f.root, "mods", ".zhumeng-mods.json");
  const original = await readFile(path),
    sources = await readFile(metadata);
  f.version("example");
  const downloads = f.requests.filter((r) => r === "/jar").length;
  await expect(f.tasks.wait(f.mods.install("i", "example"))).rejects.toThrow(
    "文件名冲突",
  );
  expect(f.requests.filter((r) => r === "/jar")).toHaveLength(downloads);
  expect(await readFile(path)).toEqual(original);
  expect(await readFile(metadata)).toEqual(sources);
});
it("rejects case-only local imports without overwriting imported or managed files", async () => {
  const f = await fixture();
  f.version("Example");
  await f.tasks.wait(f.mods.install("i", "Example"));
  const original = await readFile(join(f.root, "mods", "Example.jar")),
    sources = await readFile(join(f.root, "mods", ".zhumeng-mods.json"));
  const incoming = join(f.root, "example.jar");
  await writeFile(incoming, "different local bytes");
  await expect(f.mods.importJar("i", incoming)).rejects.toThrow("已存在");
  expect(await readFile(join(f.root, "mods", "Example.jar"))).toEqual(original);
  expect(await readFile(join(f.root, "mods", ".zhumeng-mods.json"))).toEqual(
    sources,
  );
});
it("rejects an enabled root requiring a disabled dependency and preserves existing state", async () => {
  const f = await fixture();
  f.version("d");
  await f.tasks.wait(f.mods.install("i", "d"));
  await f.mods.toggle("i", "d.jar", false);
  const sources = await readFile(join(f.root, "mods", ".zhumeng-mods.json"));
  f.version("a", "a", [{ project_id: "d", dependency_type: "required" }]);
  await expect(f.tasks.wait(f.mods.install("i", "a"))).rejects.toThrow(
    "必需依赖已禁用",
  );
  expect((await f.mods.list("i")).map((m) => m.fileName)).toEqual([
    "d.jar.disabled",
  ]);
  expect(await readFile(join(f.root, "mods", ".zhumeng-mods.json"))).toEqual(
    sources,
  );
});
it("retains physical spelling and provenance on a same-project case-only update", async () => {
  const f = await fixture();
  f.version("old", "project").files[0].filename = "Example.jar";
  await f.tasks.wait(f.mods.install("i", "old"));
  f.version("new", "project").files[0].filename = "example.jar";
  await f.tasks.wait(f.mods.update("i", "new"));
  expect(await f.mods.list("i")).toMatchObject([
    { fileName: "Example.jar", versionId: "new", projectId: "project" },
  ]);
  expect(
    (await readdir(join(f.root, "mods"))).filter((n) => /\.jar$/i.test(n)),
  ).toEqual(["Example.jar"]);
});
it("protects an unmanaged imported case alias from downloads and subsequent imports", async () => {
  const f = await fixture();
  const initial = join(f.root, "Example.jar");
  await writeFile(initial, "original imported bytes");
  await f.mods.importJar("i", initial);
  const sources = await readFile(join(f.root, "mods", ".zhumeng-mods.json"));
  f.version("example");
  await expect(f.tasks.wait(f.mods.install("i", "example"))).rejects.toThrow(
    "文件名冲突",
  );
  expect(f.requests.filter((r) => r === "/jar")).toHaveLength(0);
  const incoming = join(f.root, "example.jar");
  await writeFile(incoming, "replacement");
  await expect(f.mods.importJar("i", incoming)).rejects.toThrow("已存在");
  expect((await readFile(join(f.root, "mods", "Example.jar"))).toString()).toBe(
    "original imported bytes",
  );
  expect(await readFile(join(f.root, "mods", ".zhumeng-mods.json"))).toEqual(
    sources,
  );
});

it("batch uses reviewed hashes, preserves stale bytes and reports independent results", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "mods"));
  await writeFile(join(f.root, "mods", "a.jar"), "alpha");
  await writeFile(join(f.root, "mods", "b.jar"), "beta");
  const items = (await f.mods.list("i")).map(({fileName, sha1}) => ({fileName, sha1}));
  await writeFile(join(f.root, "mods", "b.jar"), "external");
  const results = await f.mods.batch("i", "disable", items);
  expect(results.map(x => x.status)).toEqual(["completed", "failed"]);
  expect(await readFile(join(f.root, "mods", "a.jar.disabled"), "utf8")).toBe("alpha");
  expect(await readFile(join(f.root, "mods", "b.jar"), "utf8")).toBe("external");
  await expect(f.mods.batch("i", "remove", [items[0], {...items[0], fileName:"A.jar"}])).rejects.toThrow();
});
it("local metadata parses disabled jars and isolates malformed archives", async () => {
  const f = await fixture();
  await mkdir(join(f.root, "mods"));
  const {ZipFile} = await import("yazl");
  const zip = new ZipFile();
  zip.addBuffer(Buffer.from(JSON.stringify({schemaVersion:1,id:"fixture",name:"Actual Name",version:"2.3"})), "fabric.mod.json");
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>(resolve => {zip.outputStream.on("data", c => chunks.push(c)); zip.outputStream.on("end", () => resolve(Buffer.concat(chunks)));});
  zip.end();
  await writeFile(join(f.root,"mods","unrelated.jar.disabled"), await done);
  await writeFile(join(f.root,"mods","broken.jar"), "bad zip");
  const mods = await f.mods.list("i");
  expect(mods.find(x => x.fileName === "unrelated.jar.disabled")).toMatchObject({name:"Actual Name",version:"2.3",loader:"fabric",enabled:false});
  expect(mods.find(x => x.fileName === "broken.jar")?.parseWarning).toBeTruthy();
});
it("batch import preserves collisions and returns each file outcome", async () => {
  const f = await fixture();
  const a = join(f.root,"a.jar"), bad = join(f.root,"bad.txt");
  await writeFile(a,"first"); await writeFile(bad,"bad");
  expect((await f.mods.importMany("i", [a,bad,a])).map(x=>x.status)).toEqual(["completed","failed","failed"]);
  expect(await readFile(join(f.root,"mods","a.jar"),"utf8")).toBe("first");
});
it("256 projects permit repeated completed dependency edges", async () => {
  const f = await fixture();
  for(let n=0;n<256;n++) f.version("p"+n,"p"+n,n===0 ? Array.from({length:255},(_,i)=>({version_id:"p"+(i+1),dependency_type:"required" as const})).concat([{version_id:"p255",dependency_type:"required" as const}]) : []);
  await f.tasks.wait(f.mods.install("i","p0"));
  expect((await f.mods.list("i")).length).toBe(256);
},30000);

it("batch updates wait for dependency bytes, retain partial failures and expose truthful results", async () => {
  const f = await fixture();
  f.version("old","good"); f.version("other","bad");
  await f.tasks.wait(f.mods.install("i","old")); await f.tasks.wait(f.mods.install("i","other"));
  f.version("new","good",[{version_id:"dep",dependency_type:"required"}]); f.version("dep");
  const bad = f.version("badnew","bad"); bad.files[0].url = bad.files[0].url.replace("/jar","/unavailable");
  const items = (await f.mods.list("i")).map(m=>({fileName:m.fileName,sha1:m.sha1,versionId:m.projectId === "good" ? "new":"badnew"}));
  const task = f.mods.startBatchUpdate("i", items);
  await expect(f.tasks.wait(task)).rejects.toThrow("部分");
  expect(f.mods.batchResult(task)?.map(x=>x.status)).toEqual(["completed","failed"]);
  expect(await readFile(join(f.root,"mods","new.jar"))).toEqual(f.bytes);
  expect(await readFile(join(f.root,"mods","dep.jar"))).toEqual(f.bytes);
  expect(await readFile(join(f.root,"mods","other.jar"))).toEqual(f.bytes);
  expect(f.tasks.list().find(x=>x.id===task)?.status).toBe("failed");
});
it("cancelled batch preserves old bytes and marks remaining items skipped", async () => {
  const f = await fixture();
  f.version("old","a"); f.version("other","b");
  await f.tasks.wait(f.mods.install("i","old")); await f.tasks.wait(f.mods.install("i","other"));
  f.version("new","a"); f.version("newb","b");
  const items = (await f.mods.list("i")).map(m=>({fileName:m.fileName,sha1:m.sha1,versionId:m.projectId==="a"?"new":"newb"}));
  const gate = f.gate(); const task = f.mods.startBatchUpdate("i",items);
  await gate.downloading; const cancelling = f.tasks.cancel(task); gate.release(); await cancelling;
  expect(f.mods.batchResult(task)?.map(x=>x.status)).toEqual(["skipped","skipped"]);
  expect(await readFile(join(f.root,"mods","old.jar"))).toEqual(f.bytes);
  expect(await readFile(join(f.root,"mods","other.jar"))).toEqual(f.bytes);
  expect(f.tasks.list().find(x=>x.id===task)?.status).toBe("cancelled");
});
it("detailed update checks retain per-file provider failures", async () => {
  const f = await fixture(); f.version("old","a"); f.version("other","b");
  await f.tasks.wait(f.mods.install("i","old")); await f.tasks.wait(f.mods.install("i","other"));
  f.version("new","a"); const original = f.api.versions.bind(f.api);
  f.api.versions = async (id,...rest) => {if(id==="b") throw new Error("provider unavailable"); return original(id,...rest);};
  const result = await f.mods.checkUpdatesDetailed("i");
  expect(result.updates.map(x=>x.fileName)).toEqual(["old.jar"]);
  expect(result.errors).toEqual([{fileName:"other.jar",error:"provider unavailable"}]);
});
it("strict batch IPC rejects unknown fields, aliases, excessive selections and arbitrary import paths", async () => {
 const f=await fixture(),router=new CommandRouter(); registerModCommands(router,f);
 await expect(router.invoke("mods.batch",{instanceId:"i",action:"remove",items:[{fileName:"a.jar",sha1:"a".repeat(40)}],extra:true})).rejects.toThrow("字段");
 await expect(router.invoke("mods.batch",{instanceId:"i",action:"remove",items:[{fileName:"a.jar",sha1:"a".repeat(40)},{fileName:"A.jar",sha1:"a".repeat(40)}]})).rejects.toThrow("重复");
 await expect(router.invoke("mods.batch",{instanceId:"i",action:"remove",items:Array.from({length:201},(_,i)=>({fileName:i+".jar",sha1:"a".repeat(40)}))})).rejects.toThrow("200");
 await expect(router.invoke("mods.importMany",{instanceId:"i",paths:["C:/arbitrary.jar"]})).rejects.toThrow("字段");
 await expect(router.invoke("mods.importMany",{instanceId:"i",selectionId:"invented"})).rejects.toThrow("选择");
});
it("metadata supports conservative quilt and Forge literals and warns on unsupported or oversized metadata",async()=>{
 const f=await fixture();await mkdir(join(f.root,"mods"));const {ZipFile}=await import("yazl");
 const cases=[
  ["quilt.jar","quilt.mod.json",JSON.stringify({quilt_loader:{version:"1.1",metadata:{name:"Quilt Name"}}})],
  ["forge.jar","META-INF/mods.toml",'modLoader="javafml"\n[[mods]]\nmodId="a"\ndisplayName="Forge Name"\nversion="3.0"'],
  ["neo.jar","META-INF/neoforge.mods.toml",'[[mods]]\ndisplayName=\'Neo Name\'\nversion=\'4.0\''],
  ["unsupported.jar","META-INF/mods.toml",'[[mods]]\ndisplayName="""multiline\nname"""\nversion="${file.jarVersion}"'],
  ["large.jar","fabric.mod.json","x".repeat(128*1024+1)],
 ];
 for(const [name,path,text] of cases){const zip=new ZipFile(),chunks:Buffer[]=[];zip.addBuffer(Buffer.from(text),path);const done=new Promise<Buffer>(r=>{zip.outputStream.on("data",c=>chunks.push(c));zip.outputStream.on("end",()=>r(Buffer.concat(chunks)));});zip.end();await writeFile(join(f.root,"mods",name),await done);}
 const list=await f.mods.list("i");
 expect(list.find(m=>m.fileName==="quilt.jar")).toMatchObject({name:"Quilt Name",version:"1.1",loader:"quilt"});
 expect(list.find(m=>m.fileName==="forge.jar")).toMatchObject({name:"Forge Name",version:"3.0",loader:"forge"});
 expect(list.find(m=>m.fileName==="neo.jar")).toMatchObject({name:"Neo Name",version:"4.0",loader:"neoforge"});
 expect(list.find(m=>m.fileName==="unsupported.jar")?.parseWarning).toBeTruthy();
 expect(list.find(m=>m.fileName==="large.jar")?.parseWarning).toBeTruthy();
});
it("batch enable/remove precise reviewed files and reject disabled or case import collisions",async()=>{
 const f=await fixture();await mkdir(join(f.root,"mods"));
 await writeFile(join(f.root,"mods","A.jar.disabled"),"keep-a");await writeFile(join(f.root,"mods","other.jar"),"keep-other");
 await writeFile(join(f.root,"a.jar"),"new-a");
 expect((await f.mods.importMany("i",[join(f.root,"a.jar")]))[0].status).toBe("failed");
 let item=(await f.mods.list("i")).find(x=>x.fileName==="A.jar.disabled")!;
 expect((await f.mods.batch("i","enable",[{fileName:item.fileName,sha1:item.sha1}]))[0].status).toBe("completed");
 expect(await readFile(join(f.root,"mods","A.jar"),"utf8")).toBe("keep-a");
 item=(await f.mods.list("i")).find(x=>x.fileName==="A.jar")!;
 expect((await f.mods.batch("i","remove",[{fileName:item.fileName,sha1:item.sha1}]))[0].status).toBe("completed");
 expect(await readdir(join(f.root,"mods"))).toEqual([".zhumeng-mods.json","other.jar"]);
 expect(await readFile(join(f.root,"mods","other.jar"),"utf8")).toBe("keep-other");
});
it("external write during a batch update is preserved without publishing staged downloads",async()=>{
 const f=await fixture();f.version("old","a");await f.tasks.wait(f.mods.install("i","old"));f.version("new","a");
 const old=(await f.mods.list("i"))[0],gate=f.gate(),task=f.mods.startBatchUpdate("i",[{fileName:old.fileName,sha1:old.sha1,versionId:"new"}]);
 await gate.downloading;await writeFile(join(f.root,"mods","old.jar"),"external user bytes");gate.release();
 await expect(f.tasks.wait(task)).rejects.toThrow("部分");expect(f.mods.batchResult(task)?.[0].status).toBe("failed");
 expect(await readFile(join(f.root,"mods","old.jar"),"utf8")).toBe("external user bytes");await expect(readFile(join(f.root,"mods","new.jar"))).rejects.toThrow();
});
it("a real 257th dependency is rejected before any files publish",async()=>{
 const f=await fixture();for(let n=0;n<257;n++)f.version("p"+n,"p"+n,n===0?Array.from({length:256},(_,i)=>({version_id:"p"+(i+1),dependency_type:"required" as const})):[]);
 await expect(f.tasks.wait(f.mods.install("i","p0"))).rejects.toThrow("256");expect(await f.mods.list("i")).toEqual([]);
});
it("local source manifest cannot override actual filename or inject unvalidated metadata",async()=>{
 const f=await fixture();await mkdir(join(f.root,"mods"));await writeFile(join(f.root,"mods","real.jar"),"actual");const sha1=createHash("sha1").update("actual").digest("hex");
 await writeFile(join(f.root,"mods",".zhumeng-mods.json"),JSON.stringify({"real.jar":{sha1,projectId:"p",versionId:"v",fileName:"fake.jar",enabled:false,name:"Injected",loader:"fabric"}}));
 const [mod]=await f.mods.list("i");expect(mod.fileName).toBe("real.jar");expect(mod.enabled).toBe(true);expect(mod.name).toBeUndefined();expect(mod.loader).toBeUndefined();expect(mod.provider).toBe("modrinth");
});
it("TOML rejects fields embedded in multiline descriptions and mismatched delimiters",async()=>{
 const f=await fixture();await mkdir(join(f.root,"mods"));const {ZipFile}=await import("yazl");
 const examples=[['unclosed.jar','[[mods]]\ndescription="unclosed\ndisplayName="Not a field"'],['embedded.jar','[[mods]]\ndescription="""\ndisplayName="Not actual name"\n"""'],['mismatch.jar','[[mods]]\ndisplayName="Forged\'']];
 for(const [name,text] of examples){const zip=new ZipFile(),chunks:Buffer[]=[];zip.addBuffer(Buffer.from(text),'META-INF/mods.toml');const done=new Promise<Buffer>(r=>{zip.outputStream.on('data',c=>chunks.push(c));zip.outputStream.on('end',()=>r(Buffer.concat(chunks)));});zip.end();await writeFile(join(f.root,'mods',name),await done);}
 const list=await f.mods.list('i');for(const mod of list){expect(mod.name).toBeUndefined();expect(mod.parseWarning).toBeTruthy();}
});
it("global retry retains immutable reports, retries only unfinished items and preserves reviewed external bytes",async()=>{
 const f=await fixture();f.version('old','a');f.version('other','b');await f.tasks.wait(f.mods.install('i','old'));await f.tasks.wait(f.mods.install('i','other'));
 f.version('new','a');const b=f.version('newb','b'),url=b.files[0].url;b.files[0].url=url.replace('/jar','/unavailable');
 const items=(await f.mods.list('i')).map(m=>({fileName:m.fileName,sha1:m.sha1,versionId:m.projectId==='a'?'new':'newb'}));
 const first=f.mods.startBatchUpdate('i',items);await expect(f.tasks.wait(first)).rejects.toThrow();const firstResults=structuredClone(f.mods.batchResult(first));
 expect(firstResults?.map(r=>r.status)).toEqual(['completed','failed']);
 b.files[0].url=url;await writeFile(join(f.root,'mods','other.jar'),'external user bytes');
 const external=f.tasks.retry(first);await expect(f.tasks.wait(external)).rejects.toThrow();expect(f.mods.batchResult(first)).toEqual(firstResults);
 expect(f.mods.batchResult(external)).toEqual([{fileName:'old.jar',status:'skipped',reason:'previously-completed'},{fileName:'other.jar',status:'failed',error:'Mod 已发生变化，请刷新后重新选择'}]);
 expect(await readFile(join(f.root,'mods','other.jar'),'utf8')).toBe('external user bytes');
 await writeFile(join(f.root,'mods','other.jar'),f.bytes);const retry=f.tasks.retry(external);await f.tasks.wait(retry);
 expect(retry).not.toBe(first);expect(f.mods.batchResult(first)).toEqual(firstResults);expect(f.mods.batchResult(retry)?.map(r=>[r.status,r.reason])).toEqual([['skipped','previously-completed'],['completed',undefined]]);
 expect(f.tasks.list().find(t=>t.id===retry)?.status).toBe('completed');expect(await readFile(join(f.root,'mods','new.jar'))).toEqual(f.bytes);expect(await readFile(join(f.root,'mods','newb.jar'))).toEqual(f.bytes);
});
it("cancelled batch retry publishes pending items under its new ID and keeps cancelled results",async()=>{
 const f=await fixture();f.version('old','a');await f.tasks.wait(f.mods.install('i','old'));f.version('new','a');const mod=(await f.mods.list('i'))[0];
 const gate=f.gate(),first=f.mods.startBatchUpdate('i',[{fileName:mod.fileName,sha1:mod.sha1,versionId:'new'}]);await gate.downloading;const cancelling=f.tasks.cancel(first);gate.release();await cancelling;
 const before=structuredClone(f.mods.batchResult(first));const retry=f.tasks.retry(first);await f.tasks.wait(retry);
 expect(f.mods.batchResult(first)).toEqual(before);expect(f.mods.batchResult(retry)).toEqual([{fileName:'old.jar',status:'completed'}]);expect(await readFile(join(f.root,'mods','new.jar'))).toEqual(f.bytes);expect(f.tasks.list().find(t=>t.id===retry)?.status).toBe('completed');
});
it("TaskService provides each real retry its own execution identity",async()=>{
 const tasks=new TaskService(),ids:(string|undefined)[]=[];let attempts=0;
 const first=tasks.start('identity',async context=>{ids.push(context.taskId);if(!attempts++)throw new Error('first fails');return 'actual result';});await expect(tasks.wait(first)).rejects.toThrow();const retry=tasks.retry(first);expect(await tasks.wait(retry)).toBe('actual result');expect(ids).toEqual([first,retry]);
});
