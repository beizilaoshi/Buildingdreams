import { basename, dirname, join } from "node:path";
import type { ContentSource } from "./content-provider";
import type { NetworkService } from "./network";
import type { TaskService } from "./tasks";
export class ContentSaveService {
  private directory: string | undefined;
  constructor(
    private modrinth: ContentSource,
    private network: NetworkService,
    private tasks: TaskService,
    private choose: (defaultPath: string) => Promise<string | null>,
  ) {}
  async save(
    projectId: string,
    versionId: string,
    filename: string,
  ): Promise<string | null> {
    const version = await this.modrinth.version(versionId);
    if (version.project_id !== projectId)
      throw new Error("项目与文件版本不匹配");
    const file = version.files.find((f) => f.filename === filename);
    if (
      !file ||
      !file.url ||
      file.unavailableReason ||
      (!file.hashes.sha1 && !file.hashes.sha256)
    )
      throw new Error("文件不存在或缺少可验证哈希");
    this.network.validateUrl(file.url);
    const destination = await this.choose(
      this.directory ? join(this.directory, file.filename) : file.filename,
    );
    if (!destination) return null;
    this.directory = dirname(destination);
    // Native SaveDialog confirms overwrite. NetworkService writes a unique partial and publishes only verified bytes.
    return this.tasks.start(`另存为 ${file.filename}`, (context) =>
      this.network.download(
        dirname(destination),
        {
          url: file.url,
          path: basename(destination),
          size: file.size,
          sha1: file.hashes.sha1,
          sha256: file.hashes.sha256,
        },
        context,
      ),
    );
  }
}
