import { it, expect, vi } from "vitest";
import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import { JavaService } from "../src/main/services/java";
import { LaunchService } from "../src/main/services/launch";
import { InstanceService } from "../src/main/services/instances";
import { fixture } from "./minecraft-fixture";
import { mkdir, readFile } from "node:fs/promises";
import { ModService } from "../src/main/services/mods";
import { TaskService } from "../src/main/services/tasks";
import { launch as xmclLaunch, type LaunchOption } from "@xmcl/core";
it("rejects a non-Java executable", async () => {
  await expect(new JavaService().inspect(process.execPath)).rejects.toThrow();
});
async function setup() {
  const root = await fixture();
  await writeFile(
    join(root, "versions", "base", "base.jar"),
    "fake fixture jar",
  );
  const instances = new InstanceService();
  const [instance] = await instances.importDirectory(root);
  await instances.patch(instance.id, {
    memoryMb: 1024,
    javaArgs: ["-Dtest=a & echo injected"],
    javaPath: process.execPath,
  });
  const java = new JavaService();
  vi.spyOn(java,"inspect").mockResolvedValue({path:process.execPath,version:"17.0.1",major:17,arch:"amd64"});
  return { root, instances, instance, java };
}
it("rejects Java and memory before launch runner", async () => {
  const { instances, instance, java } = await setup();
  const runner = vi.fn();
  const service = new LaunchService(
    instances,
    java,
    async () => ({ name: "Name", uuid: "uuid", accessToken: "secret" }),
    runner,
  );
  vi.spyOn(java, "inspect").mockResolvedValue({
    path: process.execPath,
    major: 8,
    version: "1.8",
    arch: "amd64",
  });
  await expect(service.launch(instance.id, "a")).rejects.toThrow("Java 17");
  expect(runner).not.toHaveBeenCalled();
  await instances.patch(instance.id, {
    memoryMb: 1048576,
    javaArgs: [],
    javaPath: process.execPath,
  });
  await expect(service.launch(instance.id, "a")).rejects.toThrow("内存");
  expect(runner).not.toHaveBeenCalled();
});
it("runs an actual child without shell and observes redacted logs and exit", async () => {
  const { root, instances, instance, java } = await setup();
  const script = join(root, "假 Java.cjs");
  await writeFile(
    script,
    "console.log(JSON.stringify(process.argv.slice(2)));console.log('very-secret-token');console.error('private-uuid');process.exitCode=7",
  );
  let captured: readonly string[] = [];
  const runner = (options: LaunchOption) =>
    xmclLaunch({
      ...options,
      spawn: (command, args, options) => {
        expect(options?.shell).toBe(false);
        expect(command).toBe(process.execPath);
        captured = args ?? [];
        return spawn(process.execPath, [script, ...captured], options ?? {});
      },
    });
  const service = new LaunchService(
    instances,
    java,
    async () => ({
      name: "中文 玩家",
      uuid: "private-uuid",
      accessToken: "very-secret-token",
    }),
    runner,
  );
  const ended = new Promise<void>((resolve) =>
    service.events.on("event", (e) => {
      if (e.type === "exit") resolve();
    }),
  );
  expect((await service.launch(instance.id, "a")).pid).toBeGreaterThan(0);
  await ended;
  expect(captured).toContain("-Dtest=a & echo injected");
  expect(captured).toContain("中文 玩家");
  expect(captured).toContain(instance.gameDir);
  const logs = service.logs(instance.id);
  expect(JSON.stringify(logs)).not.toContain("very-secret-token");
  expect(JSON.stringify(logs)).not.toContain("private-uuid");
  expect(logs.at(-1)?.code).toBe(7);
});
it("launches a modpack whose vanilla jar is absent (the loader supplies the client)", async () => {
  const { instances, instance, java } = await setup();
  const { unlink } = await import("node:fs/promises");
  await unlink(join(instance.resourceDir, "versions", "base", "base.jar"));
  const spawned = vi.fn();
  const service = new LaunchService(
    instances,
    java,
    async () => ({ name: "Name", uuid: "uuid", accessToken: "secret" }),
    (options) =>
      xmclLaunch({
        ...options,
        spawn: (command, args, opts) => {
          spawned(command, args, opts);
          return spawn(process.execPath, ["-e", "setTimeout(()=>{},150)"]);
        },
      }) as never,
  );
  await expect(service.launch(instance.id, "a")).resolves.toMatchObject({ pid: expect.any(Number) });
  expect(spawned).toHaveBeenCalled();
});

it("applies platform library rules and reports required libraries it cannot locate", async () => {
  const { root, instances, instance, java } = await setup();
  const file = join(root, "versions", "base", "base.json");
  const { readFile } = await import("node:fs/promises");
  const metadata = JSON.parse(await readFile(file, "utf8"));
  metadata.libraries = [
    { name: "test:ignored:1", rules: [{ action: "disallow" }] },
    { name: "test:required:1" },
  ];
  await writeFile(file, JSON.stringify(metadata));
  const version = await instances.resolve(instance.id);
  expect(version.libraries.map((l) => l.name)).toEqual(["test:required:1"]);
  const runner = vi.fn();
  const service = new LaunchService(
    instances,
    java,
    async () => ({ name: "N", uuid: "u", accessToken: "t" }),
    runner,
  );
  // The library declares no download URL, so nothing can be repaired: the failure must name it.
  const failure = await service.launch(instance.id, "a").catch((error: Error) => error);
  expect(String(failure)).toContain("required-1.jar");
  expect(service.status(instance.id).error).toContain("启动失败");
  expect(runner).not.toHaveBeenCalled();
});
it("validates game IPC payloads at runtime", async () => {
  const { CommandRouter } = await import("../src/main/ipc");
  const { registerGameCommands } = await import("../src/main/game-router");
  const router = new CommandRouter();
  registerGameCommands(router, "unused");
  for (const [command, payload] of [
    ["instances.list", {}],
    ["instances.import", 2],
    ["instances.patch", { id: "i", memoryMb: NaN, javaArgs: [] }],
    ["java.detect", {}],
    ["java.inspect", ""],
    ["launch.start", { instanceId: "i", accountId: "a", shell: true }],
    ["launch.logs", {}],
  ] as const)
    await expect(router.invoke(command, payload)).rejects.toThrow();
});

it.each(["", "versions/base", "game"])(
  "launches imported %s data and lists original Mods without moving user files",
  async (layout) => {
    const { java } = await setup();
    const root = await fixture(),
      gameDir = join(root, layout);
    for (const path of ["saves/World", "config", "mods"])
      await mkdir(join(gameDir, path), { recursive: true });
    await writeFile(join(gameDir, "saves/World/level.dat"), "save sentinel");
    await writeFile(join(gameDir, "config/user.txt"), "config sentinel");
    await writeFile(join(gameDir, "mods/local.jar"), "mod sentinel");
    await writeFile(join(root, "versions/base/base.jar"), "client");
    const instances = new InstanceService();
    const [instance] = await instances.importDirectory(root);
    await instances.patch(instance.id, {
      memoryMb: 1024,
      javaArgs: [],
      javaPath: process.execPath,
    });
    const mods = new ModService(
      instances,
      new TaskService(),
      {} as any,
      {} as any,
    );
    expect((await mods.list(instance.id)).map((m) => m.fileName)).toEqual([
      "local.jar",
    ]);
    let launchedPath = "";
    const service = new LaunchService(
      instances,
      java,
      async () => ({ name: "N", uuid: "u", accessToken: "t" }),
      async (options) => {
        launchedPath = String(options.gamePath);
        return spawn(process.execPath, ["-e", "process.exit(0)"], {
          windowsHide: true,
        });
      },
    );
    const exited = new Promise<void>((r) =>
      service.events.on("event", (event) => {
        if (event.type === "exit") r();
      }),
    );
    await service.launch(instance.id, "account");
    await exited;
    expect(launchedPath).toBe(gameDir);
    expect(await readFile(join(gameDir, "saves/World/level.dat"), "utf8")).toBe(
      "save sentinel",
    );
    expect(await readFile(join(gameDir, "config/user.txt"), "utf8")).toBe(
      "config sentinel",
    );
  },
);

it("auto-selects 64-bit Java after a 32-bit candidate when heap requires it", async () => {
  const { instances, instance } = await setup();
  await instances.patch(instance.id, {
    memoryMb: 2048,
    javaArgs: [],
    javaPath: undefined,
  });
  const java = new JavaService();
  vi.spyOn(java,"detect").mockResolvedValue([
    {path:"java-x86",major:17,version:"17",arch:"x86"},
    {path:process.execPath,major:17,version:"17",arch:"amd64"},
  ]);
  let selected = "";
  const runner = async (options: LaunchOption) => {
    selected = options.javaPath;
    return spawn(process.execPath, ["-e", "process.exit(0)"], { shell: false });
  };
  const service = new LaunchService(
    instances,
    java,
    async () => ({ name: "N", uuid: "uuid", accessToken: "secret" }),
    runner,
    () => 8 * 1024 * 1048576,
  );
  await expect(service.launch(instance.id, "a")).resolves.toHaveProperty("pid");
  expect(selected).toBe(process.execPath);
});
it("uses global Java only when an instance has no explicit executable", async () => {
  const { instances, instance, java } = await setup();
  await instances.patch(instance.id, {
    memoryMb: 1024,
    javaArgs: [],
    javaPath: undefined,
  });
  const inspect = vi.spyOn(java, "inspect").mockResolvedValue({
    path: "global-java",
    major: 8,
    version: "8",
    arch: "amd64",
  });
  const service = new LaunchService(
    instances,
    java,
    async () => ({ name: "Name", uuid: "uuid", accessToken: "secret" }),
    vi.fn(),
    undefined,
    async () => "global-java",
  );
  await expect(service.launch(instance.id, "a")).rejects.toThrow("Java 17");
  expect(inspect).toHaveBeenLastCalledWith("global-java");
  await instances.patch(instance.id, {
    memoryMb: 1024,
    javaArgs: [],
    javaPath: "instance-java",
  });
  await expect(service.launch(instance.id, "a")).rejects.toThrow("Java 17");
  expect(inspect).toHaveBeenLastCalledWith("instance-java");
});

it("automatic launch uses family rules and concurrent clicks cannot spawn duplicate games", async () => {
  const { instances, instance } = await setup();
  await instances.patch(instance.id,{memoryMb:1024,javaArgs:[],javaPath:""});
  const java = new JavaService();
  vi.spyOn(java,"detect").mockResolvedValue([{path:"java21",version:"21.0.1",major:21,arch:"amd64"},{path:"java17",version:"17.0.10",major:17,arch:"amd64"}]);
  const paths: string[] = [];
  const service = new LaunchService(instances,java,async()=>({name:"N",uuid:"u",accessToken:"t"}),async options=>{paths.push(options.javaPath);return spawn(process.execPath,["-e","process.exit(0)"]);},undefined,async()=>"stale-global-java");
  const [a,b] = await Promise.all([service.launch(instance.id,"a"),service.launch(instance.id,"a")]);
  expect(a.pid).toBe(b.pid);expect(paths).toEqual(["java17"]);
});
it("processor resolution applies Forge upper bounds before any installer network or spawn",async()=>{
  const { XmclLoaderAdapter } = await import("../src/main/services/loaders");
  const { NetworkService } = await import("../src/main/services/network");
  const { root,instances,instance } = await setup();
  const java = new JavaService();
  vi.spyOn(java,"inspect").mockResolvedValue({path:"manual21",version:"21",major:21,arch:"amd64"});
  const adapter = new XmclLoaderAdapter(new NetworkService(),java);
  await expect(adapter.install("forge","37.0.79",{...instance,minecraft:"1.17.1",javaPath:"manual21"},root,{signal:new AbortController().signal,report:()=>{}})).rejects.toThrow("冲突");
});

it("Java IPC validates discriminated contexts and resolves instance requirements in main",async()=>{
  const { CommandRouter } = await import("../src/main/ipc");const { registerGameCommands } = await import("../src/main/game-router");
  const root = await fixture(); const router = new CommandRouter();const services = registerGameCommands(router,join(root,"instances.json"));
  vi.spyOn(services.java,"detect").mockResolvedValue([{path:"java17",version:"17",major:17,arch:"amd64"}]);
  const [instance] = await services.instances.importDirectory(root);
  expect(await router.invoke("java.plan",{instanceId:instance.id})).toMatchObject({selected:{path:"java17"},requirement:{preferredMajor:17}});
  for(const payload of [{},{instanceId:instance.id,minecraft:"1.8"},{family:7},{family:21,url:"https://evil.example"},{minecraft:"1.20.1",metadataMajor:8},{instanceId:instance.id,minimum:8}]) await expect(router.invoke("java.plan",payload)).rejects.toThrow();
  await router.invoke("instances.patch",{id:instance.id,memoryMb:1024,javaArgs:[],javaPath:""});
  expect((await services.instances.get(instance.id)).javaPath).toBe("");
});

it("cancelling a launch's real Java configuration task prevents the launch runner",async()=>{
  const {JavaRuntimeService}=await import("../src/main/services/java-runtime");const {NetworkService}=await import("../src/main/services/network");
  const {root,instances,instance}=await setup();await instances.patch(instance.id,{memoryMb:1024,javaArgs:[],javaPath:""});
  const tasks=new TaskService();const managed=new JavaRuntimeService(join(root,"java"),new NetworkService({fetch:(async(_url,init)=>new Promise((_resolve,reject)=>{init?.signal?.addEventListener("abort",()=>reject(new Error("cancelled official request")),{once:true});})) as typeof fetch}),async()=>{throw Error("not reached");});
  const java=new JavaService(managed,tasks);vi.spyOn(java,"detect").mockResolvedValue([]);const runner=vi.fn();
  const service=new LaunchService(instances,java,async()=>({name:"N",uuid:"u",accessToken:"t"}),runner);
  const launched=service.launch(instance.id,"a");const failed=expect(launched).rejects.toThrow();
  await vi.waitFor(()=>expect(tasks.list()[0]?.status).toBe("running"));
  await tasks.cancel(tasks.list()[0].id);await failed;expect(runner).not.toHaveBeenCalled();expect(tasks.list()[0].status).toBe("cancelled");
});

async function managedRouterFixture(gated = false) {
    const { CommandRouter } = await import("../src/main/ipc"), { registerGameCommands } = await import("../src/main/game-router");
    const { ZipFile } = await import("yazl"), { createHash } = await import("node:crypto");
    const root = await fixture(), binary = "fixture Java 17 bytes, NEVER executed";
    for (const id of ["1.18", "1.20.4"]) {
        await mkdir(join(root, "versions", id), { recursive: true });
        await writeFile(join(root, "versions", id, id + ".json"), JSON.stringify({ id, mainClass: "FixtureMain", libraries: [], minecraftArguments: "", javaVersion: { majorVersion: 17 } }));
    }
    const zip = new ZipFile();
    zip.addBuffer(Buffer.from(binary), "jdk-17/bin/java.exe");
    zip.addBuffer(Buffer.from("fixture license"), "jdk-17/legal/LICENSE");
    zip.end();
    const chunks: Buffer[] = [];
    for await (const chunk of zip.outputStream)
        chunks.push(Buffer.from(chunk));
    const bytes = Buffer.concat(chunks);
    let count = 0, release = () => { };
    const inspect = vi.spyOn(JavaService.prototype, "inspect").mockImplementation(async (path) => { expect(await readFile(path, "utf8")).toBe(binary); return { path, version: "17.0.15+6", major: 17, arch: "amd64" }; });
    const fetcher = vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
        const url = String(input);
        if (url.includes("api.adoptium.net/v3/assets/latest/17/"))
            return Response.json([{ vendor: "eclipse", version: { major: 17, openjdk_version: "17.0.15+6" }, binary: { architecture: "x64", os: "windows", image_type: "jre", jvm_impl: "hotspot", package: { name: "OpenJDK17U-jre_x64_windows_hotspot_17.0.15_6.zip", link: "https://github.com/adoptium/temurin17-binaries/releases/download/test/OpenJDK17U-jre_x64_windows_hotspot_17.0.15_6.zip", checksum: createHash("sha256").update(bytes).digest("hex"), size: bytes.length } } }]);
        if (!url.startsWith("https://github.com/adoptium/temurin17-binaries/"))
            throw Error("Unexpected fixture URL " + url);
        count++;
        if (gated)
            await new Promise<void>((resolve, reject) => { const signal = init!.signal!; const abort = () => { signal.removeEventListener("abort", abort); reject(signal.reason); }; release = () => { signal.removeEventListener("abort", abort); resolve(); }; signal.addEventListener("abort", abort, { once: true }); if (signal.aborted)
                abort(); });
        return new Response(bytes);
    });
    const router = new CommandRouter(), services = registerGameCommands(router, join(root, "instances.json"));
    const instances = await services.instances.importDirectory(root);
    return { root, router, services, instances, count: () => count, release: () => release(), restore: () => { inspect.mockRestore(); fetcher.mockRestore(); } };
}
it("explicit family router plan/ensure downloads verified17 when only21 satisfies game fallback", async () => {
    const f = await managedRouterFixture();
    vi.spyOn(f.services.java, "detect").mockResolvedValue([{ path: "installed21", major: 21, version: "21.0.10+8", arch: "amd64" }]);
    try {
        const game = f.instances.find(i => i.minecraft === "1.18")!;
        expect(await f.router.invoke("java.plan", { instanceId: game.id })).toMatchObject({ selected: { major: 21 } });
        const plan = await f.router.invoke("java.plan", { family: 17 }) as {
            selected?: unknown;
        };
        expect(plan.selected).toBeUndefined();
        const id = await f.router.invoke("java.ensure", { family: 17 }) as string;
        const actual = await f.services.tasks.wait<import("../src/shared/types").JavaRuntime>(id);
        expect(actual.major).toBe(17);
        expect(await readFile(actual.path, "utf8")).toBe("fixture Java 17 bytes, NEVER executed");
        expect(f.count()).toBe(1);
        expect(await f.router.invoke("java.managed", undefined)).toEqual([actual]);
    }
    finally {
        f.release();
        f.restore();
    }
});
it("router parent cancellation detaches a follower task while another game completes one verified17 transfer", async () => {
    const f = await managedRouterFixture(true);
    vi.spyOn(f.services.java, "detect").mockResolvedValue([]);
    const makeParent = (minecraft: string) => f.services.tasks.start("parent " + minecraft, context => f.services.java.resolve({ minecraft, metadataMajor: 17 }, { memoryMb: 1024, autoDownload: true, context }));
    const first = makeParent("1.18"), second = makeParent("1.20.4");
    let cancelled = false;
    const firstResult = f.services.tasks.wait(first), secondResult = f.services.tasks.wait(second).catch(e => e);
    try {
        await vi.waitFor(() => expect(f.count()).toBe(1));
        const children = f.services.tasks.list().filter(t => t.label.startsWith("自动配置 Java"));
        expect(children).toHaveLength(2);
        const cancelling = f.router.invoke("tasks.cancel", second).then(() => { cancelled = true; });
        await vi.waitFor(() => expect(cancelled).toBe(true), { timeout: 250 });
        await cancelling;
        expect(f.services.tasks.list().find(t => t.id === second)?.status).toBe("cancelled");
        expect(f.services.tasks.list().filter(t => t.label.startsWith("自动配置 Java") && t.status === "cancelled")).toHaveLength(1);
        expect(f.services.tasks.list().find(t => t.id === first)?.status).toBe("running");
        f.release();
        const actual = await firstResult as import("../src/shared/types").JavaRuntime;
        expect(actual.major).toBe(17);
        expect(await readFile(actual.path, "utf8")).toBe("fixture Java 17 bytes, NEVER executed");
        expect(f.count()).toBe(1);
    }
    finally {
        f.release();
        await Promise.allSettled([firstResult, secondResult]);
        f.restore();
    }
});

it("same Minecraft and settings launch owners cancel independently over one verified archive",async()=>{
 const f=await managedRouterFixture(true);vi.spyOn(f.services.java,"detect").mockResolvedValue([]);
 const make=(ownerScope:string)=>f.services.tasks.start(ownerScope,context=>f.services.java.resolve({minecraft:"1.20.4",metadataMajor:17},{ownerScope,memoryMb:1024,autoDownload:true,context}));
 const a=make("game-a"),b=make("game-b");const first=f.services.tasks.wait(a).catch(e=>e),second=f.services.tasks.wait<import("../src/shared/types").JavaRuntime>(b);
 try {await vi.waitFor(()=>expect(f.count()).toBe(1));expect(f.services.tasks.list().filter(t=>t.label.startsWith("自动配置 Java"))).toHaveLength(2);await f.services.tasks.cancel(a);expect(f.services.tasks.list().find(t=>t.id===b)?.status).toBe("running");f.release();expect((await second).major).toBe(17);expect(f.count()).toBe(1);}
 finally {f.release();await Promise.allSettled([first,second]);f.restore();}
});

it("two actual launch preparations with identical Java contexts isolate selected cancellation",async()=>{
 const f=await managedRouterFixture(true);vi.spyOn(f.services.java,"detect").mockResolvedValue([]);
 const original=f.instances.find(i=>i.minecraft==='1.20.4')!;await f.services.instances.patch(original.id,{memoryMb:1024,javaArgs:[],javaPath:''});
 const a=await f.services.instances.get(original.id);const b=await f.services.instances.register({...a,id:'second-owned-game',name:'second-owned-game'});
 await writeFile(join(a.resourceDir,'versions','1.20.4','1.20.4.jar'),'fixture not executed');
 let spawned=0;const launch=new LaunchService(f.services.instances,f.services.java,async()=>({name:'Test',uuid:'fixture-id',accessToken:'fixture-token'}),async()=>{spawned++;return spawn(process.execPath,['-e','setInterval(()=>{},1000)']);});
 const first=launch.launch(a.id,'local');const rejected=expect(first).rejects.toThrow();const second=launch.launch(b.id,'local');
 try{await vi.waitFor(()=>expect(f.count()).toBe(1));await launch.cancel(a.id);await rejected;expect(launch.isBusy(b.id)).toBe(true);f.release();expect((await second).pid).toBeGreaterThan(0);expect(spawned).toBe(1);expect(f.count()).toBe(1);}
 finally{f.release();await Promise.allSettled([first,second]);await launch.stop(b.id);f.restore();}
});
