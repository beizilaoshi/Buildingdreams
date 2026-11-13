import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, readdir, rm, lstat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { join, isAbsolute } from "node:path";
import { Version } from "@xmcl/core";
import * as xmcl from "@xmcl/installer";
import type { Task } from "@xmcl/task";
import { Agent, Dispatcher, interceptors } from "undici";
import type { Instance, LoaderKind, LoaderVersion } from "../../shared/types";
import { InstallService, secureLibraryUrl, versionSegment } from "./install";
import { JavaService } from "./java";
import { NetworkService, contained } from "./network";
import type { TaskContext } from "./tasks";
import {
  preflightInstaller,
  checkInstallerDestination,
} from "./installer-safety";

type InstallerApi = Pick<
  typeof xmcl,
  | "getLoaderArtifactListFor"
  | "getQuiltLoaderVersionsByMinecraft"
  | "installFabric"
  | "installQuiltVersion"
  | "installForgeTask"
  | "installNeoForgedTask"
>;
export interface LoaderAdapter {
  versions(
    kind: LoaderKind,
    minecraft: string,
    signal?: AbortSignal,
  ): Promise<LoaderVersion[]>;
  install(
    kind: LoaderKind,
    version: string,
    instance: Instance,
    root: string,
    context: TaskContext,
  ): Promise<string>;
}
/** Guard every XMCL request, including its historical HTTP fallbacks and redirects. */
class HttpsDispatcher extends Dispatcher {
  private agent = new Agent();
  private checked = this.agent.compose(
    (dispatch) => (options, handler) => {
      this.network.validateUrl(
        new URL(String(options.path), String(options.origin)).href,
      );
      const { maxRedirections: _legacy, ...clean } =
        options as Dispatcher.DispatchOptions & { maxRedirections?: number };
      return dispatch(clean, handler);
    },
    interceptors.redirect({ maxRedirections: 5 }),
  );
  constructor(private network: NetworkService) {
    super();
  }
  dispatch(
    options: Dispatcher.DispatchOptions,
    handler: Dispatcher.DispatchHandler,
  ): boolean {
    try {
      this.network.validateUrl(
        new URL(String(options.path), String(options.origin)).href,
      );
    } catch (error) {
      handler.onError?.(error as Error);
      return false;
    }
    return this.checked.dispatch(options, handler);
  }
  async shutdown(): Promise<void> {
    await this.agent.close();
  }
}
export class XmclLoaderAdapter implements LoaderAdapter {
  constructor(
    private network: NetworkService,
    private java: JavaService,
    private api: InstallerApi = xmcl,
    private javaDefaults: () => Promise<{javaPath?:string;autoDownloadJava?:boolean}> = async()=>({}),
  ) {}
  private fetcher(signal?: AbortSignal): typeof fetch {
    return ((url: string | URL | Request, init?: RequestInit) =>
      this.network.response(
        String(url),
        init?.signal ?? signal ?? undefined,
      )) as typeof fetch;
  }
  async versions(
    kind: LoaderKind,
    minecraft: string,
    signal?: AbortSignal,
  ): Promise<LoaderVersion[]> {
    versionSegment(minecraft);
    if (kind === "fabric")
      return (
        await this.api.getLoaderArtifactListFor(minecraft, {
          fetch: this.fetcher(signal),
          signal,
        })
      ).map((x) => ({ version: x.loader.version, stable: x.loader.stable }));
    if (kind === "quilt")
      return (
        await this.api.getQuiltLoaderVersionsByMinecraft({
          minecraftVersion: minecraft,
          fetch: this.fetcher(signal),
          signal,
        })
      ).map((x) => ({ version: x.loader.version, stable: x.loader.stable }));
    const project = minecraft === "1.20.1" ? "forge" : "neoforge";
    const url =
      kind === "forge"
        ? "https://maven.minecraftforge.net/net/minecraftforge/forge/maven-metadata.xml"
        : `https://maven.neoforged.net/releases/net/neoforged/${project}/maven-metadata.xml`;
    const xml = await (await this.network.response(url, signal)).text();
    if (xml.length > 8 * 1024 * 1024) throw new Error("加载器版本清单过大");
    const all = [...xml.matchAll(/<version>([^<]+)<\/version>/g)].map(
      (x) => x[1],
    );
    const versions = all
      .filter((value) => {
        if (kind === "forge" || project === "forge")
          return value.startsWith(minecraft + "-");
        const [major, minor, patch = "0"] = minecraft.split(".");
        const prefix =
          major === "1" ? `${minor}.${patch}.` : `${major}.${minor}.`;
        return value.startsWith(prefix);
      })
      .map((version) => ({
        version:
          kind === "forge" ? version.slice(minecraft.length + 1) : version,
        stable: !/alpha|beta|pre|rc/i.test(version),
      }));
    return versions.reverse();
  }
  async install(
    kind: LoaderKind,
    version: string,
    instance: Instance,
    root: string,
    context: TaskContext,
  ): Promise<string> {
    versionSegment(version);
    const common = {
      minecraftVersion: instance.minecraft,
      version,
      minecraft: root,
      fetch: this.fetcher(context.signal),
      signal: context.signal,
    };
    if (kind === "fabric") return this.api.installFabric(common);
    if (kind === "quilt") return this.api.installQuiltVersion(common);
    const resolved = await Version.parse(root, instance.versionId);
    const defaults = await this.javaDefaults();
    const runtime = await this.java.resolve({
      minecraft:instance.minecraft,metadataMajor:resolved.javaVersion?.majorVersion,loader:{kind,version},
      optifine:resolved.libraries.some(l=>/optifine/i.test(l.name)),liteLoader:resolved.libraries.some(l=>/liteloader/i.test(l.name)),
    },{manualPath:instance.javaPath ?? defaults.javaPath,memoryMb:instance.memoryMb,autoDownload:defaults.autoDownloadJava !== false,context,roots:[root]});
    const project = instance.minecraft === "1.20.1" ? "forge" : "neoforge";
    const fullVersion =
      kind === "forge" ? `${instance.minecraft}-${version}` : version;
    const installerPath =
      kind === "forge"
        ? `net/minecraftforge/forge/${fullVersion}/forge-${fullVersion}-installer.jar`
        : `net/neoforged/${project}/${version}/${project}-${version}-installer.jar`;
    const installerUrl =
      (kind === "forge"
        ? "https://maven.minecraftforge.net/"
        : "https://maven.neoforged.net/releases/") + installerPath;
    const sha1 = (
      await (
        await this.network.response(installerUrl + ".sha1", context.signal)
      ).text()
    )
      .trim()
      .split(/\s/)[0];
    if (!/^[a-f0-9]{40}$/i.test(sha1))
      throw new Error("加载器安装包缺少有效 SHA1");
    await this.network.download(
      root,
      { url: installerUrl, sha1, path: "libraries/" + installerPath },
      context,
    );
    await preflightInstaller(
      contained(root, "libraries/" + installerPath),
      root,
      instance.minecraft,
      this.network,
    );
    const dispatcher = new HttpsDispatcher(this.network);
    const children = new Set<ReturnType<typeof spawn>>();
    const options: xmcl.InstallForgeOptions = {
      java: runtime.path,
      dispatcher,
      inheritsFrom: instance.minecraft,
      libraryHost: (library) => secureLibraryUrl(library.download.url),
      // Set an HTTPS installer URL explicitly; XMCL's legacy fallback is rejected by the dispatcher.
      spawn: (command, args, opts) => {
        context.signal.throwIfAborted();
        const child = spawn(command, args ?? [], {
          ...opts,
          windowsHide: true,
          shell: false,
        });
        children.add(child);
        child.once("close", () => children.delete(child));
        return child;
      },
    };
    const task =
      kind === "forge"
        ? this.api.installForgeTask(
            {
              mcversion: instance.minecraft,
              version,
              installer: { path: installerUrl, sha1 },
            },
            root,
            options,
          )
        : this.api.installNeoForgedTask(project, version, root, options);
    try {
      return await runInstallerTask(task, root, context, children);
    } finally {
      await dispatcher.shutdown();
    }
  }
}
export async function runInstallerTask<T>(
  task: Task<T>,
  root: string,
  context: TaskContext,
  children = new Set<ReturnType<typeof spawn>>(),
): Promise<T> {
  context.signal.throwIfAborted();
  let cancelling: Promise<void> | undefined;
  const abort = () => {
    for (const child of children) child.kill();
    cancelling = task.cancel();
    void cancelling.catch(() => {});
  };
  context.signal.addEventListener("abort", abort, { once: true });
  let transferred = 0;
  const start = Date.now();
  try {
    const result = await task.startAndWait({
      onStart: (child) => {
        if (
          child instanceof xmcl.DownloadMultipleTask ||
          child instanceof xmcl.DownloadTask
        ) {
          const options = (
            child as unknown as {
              options: { destination: string } | { destination: string }[];
            }
          ).options;
          for (const option of Array.isArray(options) ? options : [options])
            checkInstallerDestination(root, option.destination);
        }
        if (
          child.to &&
          (isAbsolute(child.to) ||
            (/[\\/]/.test(child.to) && !child.to.includes(":")))
        )
          contained(root, child.to);
      },
      onUpdate: (_child, chunk) => {
        transferred += Math.max(0, chunk);
        context.report(
          task.total > 0 ? task.progress / task.total : 0,
          (transferred * 1000) / Math.max(1, Date.now() - start),
        );
      },
    });
    context.signal.throwIfAborted();
    return result;
  } finally {
    context.signal.removeEventListener("abort", abort);
    await cancelling;
    // Wait for killed processors to close before staging cleanup on Windows.
    await Promise.all(
      [...children].map(
        (child) =>
          new Promise<void>((resolve) => {
            if (child.exitCode !== null || child.signalCode !== null) resolve();
            else child.once("close", () => resolve());
          }),
      ),
    );
  }
}
async function copyResources(
  source: string,
  target: string,
  signal: AbortSignal,
): Promise<void> {
  async function check(path: string): Promise<void> {
    signal.throwIfAborted();
    if ((await lstat(path)).isSymbolicLink())
      throw new Error("实例资源不能包含符号链接");
    for (const entry of await readdir(path, { withFileTypes: true })) {
      if (entry.isSymbolicLink()) throw new Error("实例资源不能包含符号链接");
      if (entry.isDirectory()) await check(join(path, entry.name));
    }
  }
  await mkdir(target, { recursive: true });
  for (const folder of ["versions", "libraries", "assets"]) {
    try {
      await check(join(source, folder));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") continue;
      throw error;
    }
    await cp(join(source, folder), join(target, folder), {
      recursive: true,
      errorOnExist: true,
      force: false,
    });
    signal.throwIfAborted();
  }
}
export class LoaderService {
  constructor(
    private installService: InstallService,
    private adapter: LoaderAdapter,
  ) {}
  async installInto(
    root: string,
    instance: Instance,
    kind: LoaderKind,
    version: string,
    context: TaskContext,
  ): Promise<string> {
    versionSegment(version);
    if (
      !(
        await this.adapter.versions(kind, instance.minecraft, context.signal)
      ).some((x) => x.version === version)
    )
      throw new Error("加载器版本不支持此 Minecraft 版本");
    const id = versionSegment(
      await this.adapter.install(kind, version, instance, root, context),
    );
    const profile = JSON.parse(
      await readFile(contained(root, `versions/${id}/${id}.json`), "utf8"),
    );
    this.installService.validateProfile(profile, id);
    const local = new Set<string>();
    if (kind === "forge" || kind === "neoforge")
      for (const library of profile.libraries) {
        if (
          library.downloads?.artifact?.url === "" ||
          (!library.downloads &&
            /^(net\.minecraftforge|net\.neoforged):/.test(library.name))
        ) {
          const resolved = Version.resolveLibrary(library);
          if (resolved) local.add(resolved.download.path);
        }
      }
    const resolved = await Version.parse(root, id);
    if (resolved.minecraftVersion !== instance.minecraft)
      throw new Error("加载器继承了错误的 Minecraft 版本");
    await this.installService.dependencies(resolved, context, local);
    context.signal.throwIfAborted();
    return id;
  }
  versions(kind: LoaderKind, minecraft: string): Promise<LoaderVersion[]> {
    return this.adapter.versions(kind, versionSegment(minecraft));
  }
  install(instanceId: string, kind: LoaderKind, version: string): string {
    versionSegment(version);
    return this.installService.tasks.start(
      `安装 ${kind} ${version}`,
      async (context) => {
        const service = this.installService,
          instance = await service.instances.get(instanceId);
        if (instance.loader)
          throw new Error("此实例已有加载器，请创建独立实例安装其他加载器");
        if (
          !(
            await this.adapter.versions(
              kind,
              instance.minecraft,
              context.signal,
            )
          ).some((x) => x.version === version)
        )
          throw new Error("加载器版本不支持此 Minecraft 版本");
        const root = contained(service.root, randomUUID());
        try {
          await copyResources(instance.resourceDir, root, context.signal);
          const id = versionSegment(
            await this.adapter.install(kind, version, instance, root, context),
          );
          const profile = JSON.parse(
            await readFile(
              contained(root, `versions/${id}/${id}.json`),
              "utf8",
            ),
          );
          service.validateProfile(profile, id);
          // Verified installer archives and successful processors can supply local artifacts.
          // XMCL substitutes a default Maven URL for these, so preserve their original provenance.
          const local = new Set<string>();
          if (kind === "forge" || kind === "neoforge") {
            for (const library of profile.libraries) {
              if (
                library.downloads?.artifact?.url === "" ||
                (!library.downloads &&
                  /^(net\.minecraftforge|net\.neoforged):/.test(library.name))
              ) {
                const resolved = Version.resolveLibrary(library);
                if (resolved) local.add(resolved.download.path);
              }
            }
          }
          const resolved = await Version.parse(root, id);
          if (resolved.minecraftVersion !== instance.minecraft)
            throw new Error("加载器继承了错误的 Minecraft 版本");
          await service.dependencies(resolved, context, local);
          context.signal.throwIfAborted();
          return await service.instances.register(
            {
              ...instance,
              resourceDir: root,
              versionId: id,
              loader: { kind, version },
            },
            instance,
            context.signal,
          );
        } catch (error) {
          await rm(root, { recursive: true, force: true });
          throw error;
        }
      },
    );
  }
}
