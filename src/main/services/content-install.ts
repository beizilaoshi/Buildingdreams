import { lstat, readdir, mkdir, mkdtemp, link, rm } from "node:fs/promises";
import { join, resolve, parse, relative, sep } from "node:path";
import type { ContentWorld, ResourceInstall } from "../../shared/content";
import type { InstanceService } from "./instances";
import type { ContentSource } from "./content-provider";
import type { NetworkService } from "./network";
import type { TaskService } from "./tasks";
const conflict = () =>
  new Error("目标文件已存在，请使用另存为选择其他位置，或先手动移除冲突文件");
function identifier(value: string): boolean {
  return (
    !!value &&
    value.length <= 255 &&
    !/[\\/:<>"|?*\x00-\x1f]/.test(value) &&
    !/[. ]$/.test(value) &&
    value !== "." &&
    value !== ".." &&
    !/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(value)
  );
}
// Check every ancestor, including ancestors of the configured gameDir.
async function realPath(path: string, directory = true): Promise<void> {
  const absolute = resolve(path),
    root = parse(absolute).root;
  let current = root;
  for (const component of relative(root, absolute).split(sep).filter(Boolean)) {
    current = join(current, component);
    try {
      const info = await lstat(current);
      if (
        info.isSymbolicLink() ||
        (current !== absolute && !info.isDirectory()) ||
        (current === absolute && directory && !info.isDirectory())
      )
        throw new Error("资源目标不能包含符号链接、目录联接或无效目录");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
}
async function absent(directory: string, filename: string) {
  let names: string[];
  try {
    names = await readdir(directory);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  if (names.some((name) => name.toLowerCase() === filename.toLowerCase()))
    throw conflict();
}
export class ContentInstallService {
  constructor(
    private instances: InstanceService,
    private modrinth: ContentSource,
    private network: NetworkService,
    private tasks: TaskService,
  ) {}
  async worlds(instanceId: string): Promise<ContentWorld[]> {
    const instance = await this.instances.get(instanceId),
      saves = join(instance.gameDir, "saves");
    await realPath(saves);
    const result: ContentWorld[] = [];
    let entries;
    try {
      entries = await readdir(saves, { withFileTypes: true });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    if (entries.length > 10000)
      throw new Error("存档目录过大，请整理后重试，或使用另存为");
    for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      if (
        !identifier(entry.name) ||
        !entry.isDirectory() ||
        entry.isSymbolicLink()
      )
        continue;
      try {
        await realPath(join(saves, entry.name));
        const level = await lstat(join(saves, entry.name, "level.dat"));
        if (level.isFile() && !level.isSymbolicLink())
          result.push({ id: entry.name, name: entry.name });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
      if (result.length === 200) break;
    }
    return result;
  }
  private async target(request: ResourceInstall) {
    const instance = await this.instances.get(request.instanceId);
    await realPath(instance.gameDir);
    try {
      if (!(await lstat(instance.gameDir)).isDirectory())
        throw new Error("实例目录无效");
    } catch {
      throw new Error("实例目录不存在或无效，请重新选择实例");
    }
    if (instance.status !== "ready") throw new Error("所选实例不可用");
    if (!["resourcepack", "shader", "datapack"].includes(request.kind))
      throw new Error("无效资源类型");
    if (!identifier(request.filename) || !/\.zip$/i.test(request.filename))
      throw new Error("只能安装所选 ZIP 资源文件");
    let directory: string;
    if (request.kind === "datapack") {
      if (
        !request.worldId ||
        !identifier(request.worldId) ||
        !(await this.worlds(instance.id)).some((w) => w.id === request.worldId)
      )
        throw new Error("请选择现有的真实存档；存档可能已经移动或删除");
      directory = join(instance.gameDir, "saves", request.worldId, "datapacks");
    } else {
      if (request.worldId !== undefined)
        throw new Error("此资源类型不能指定存档");
      directory = join(
        instance.gameDir,
        request.kind === "shader" ? "shaderpacks" : "resourcepacks",
      );
    }
    await realPath(directory);
    await absent(directory, request.filename);
    return { directory, instance };
  }
  async install(input: ResourceInstall): Promise<string> {
    const request = { ...input };
    const original = await this.target(request);
    const [project, version] = await Promise.all([
      this.modrinth.project(request.projectId),
      this.modrinth.version(request.versionId),
    ]);
    if (version.project_id !== project.id)
      throw new Error("项目与文件版本不匹配");
    if (
      request.kind === "datapack"
        ? !["mod", "datapack"].includes(project.projectType) ||
          !version.loaders.includes("datapack")
        : project.projectType !== request.kind
    )
      throw new Error("项目或版本与所选资源类型不匹配");
    if (!version.game_versions.includes(original.instance.minecraft))
      throw new Error("资源不兼容所选 Minecraft 版本，可使用另存为");
    const file = version.files.find((f) => f.filename === request.filename);
    if (
      !file ||
      !file.url ||
      file.unavailableReason ||
      file.size <= 0 ||
      (!file.hashes.sha1 && !file.hashes.sha256)
    )
      throw new Error("文件不存在、为空或缺少支持的校验哈希");
    this.network.validateUrl(file.url);
    return this.tasks.start(
      `安装所选文件 ${file.filename}`,
      async (context) => {
        const before = await this.target(request);
        if (
          before.directory !== original.directory ||
          before.instance.minecraft !== original.instance.minecraft
        )
          throw new Error("实例目标已改变，请重新打开详情");
        context.signal.throwIfAborted();
        await mkdir(before.directory, { recursive: true });
        await realPath(before.directory);
        const staging = await mkdtemp(
          join(before.directory, ".zhumeng-resource-"),
        );
        try {
          const staged = await this.network.download(
            staging,
            {
              url: file.url,
              path: file.filename,
              size: file.size,
              sha1: file.hashes.sha1,
              sha256: file.hashes.sha256,
            },
            context,
          );
          const final = await this.target(request);
          if (
            final.directory !== original.directory ||
            final.instance.minecraft !== original.instance.minecraft
          )
            throw new Error("实例目标已改变");
          context.signal.throwIfAborted();
          // Same-filesystem hard link atomically publishes verified bytes without replacing any file.
          try {
            await link(staged, join(final.directory, file.filename));
          } catch (error) {
            if ((error as NodeJS.ErrnoException).code === "EEXIST")
              throw conflict();
            throw error;
          }
        } finally {
          await rm(staging, { recursive: true, force: true });
        }
      },
    );
  }
}
