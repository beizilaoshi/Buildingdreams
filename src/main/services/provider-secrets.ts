import { readFile, writeFile, rename, mkdir, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { randomUUID } from "node:crypto";
import type { TokenProtector } from "./accounts";
export class ProviderSecrets {
  private key: string | undefined;
  private persisted = false;
  private loaded = false;
  private queue: Promise<unknown> = Promise.resolve();
  private revision = 0;
  constructor(
    private file: string,
    private protector: TokenProtector,
  ) {}
  private serialized<T>(job: () => Promise<T>): Promise<T> {
    const p = this.queue.then(job);
    this.queue = p.catch(() => {});
    return p;
  }
  private async load() {
    if (this.loaded) return;
    try {
      const bytes = await readFile(this.file);
      if (bytes.length > 16384) throw new Error();
      this.key = validateProviderKey(this.protector.decryptString(bytes));
      this.persisted = true;
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("来源凭据保险库无法读取，请清除后重新设置");
    }
    this.loaded = true;
  }
  async capture() {
    return this.serialized(async () => {
      await this.load();
      return { key: this.key, revision: this.revision };
    });
  }
  async assertCurrent(revision: number) {
    await this.queue;
    if (revision !== this.revision)
      throw new Error("来源凭据已更改，请重新搜索");
  }
  status() {
    return this.serialized(async () => {
      await this.load();
      return this.summary();
    });
  }
  private summary() {
    return {
      configured: !!this.key,
      session: !!this.key && !this.persisted,
      persisted: this.persisted,
      encryption: this.protector.isEncryptionAvailable(),
    };
  }
  set(key: string, remember: boolean) {
    key = validateProviderKey(key);
    return this.serialized(async () => {
      await this.load();
      if (remember && !this.protector.isEncryptionAvailable())
        throw new Error("系统凭据加密不可用，可仅在本次会话使用");
      if (remember) {
        const temporary = this.file + "." + randomUUID() + ".tmp";
        try {
          await mkdir(dirname(this.file), { recursive: true });
          await writeFile(temporary, this.protector.encryptString(key), {
            flag: "wx",
          });
          await rename(temporary, this.file);
        } catch {
          throw new Error("来源凭据保存失败");
        } finally {
          await rm(temporary, { force: true }).catch(() => {});
        }
      } else {
        try {
          await rm(this.file, { force: true });
        } catch {
          throw new Error("来源凭据清除失败");
        }
      }
      this.key = key;
      this.persisted = remember;
      this.revision++;
      return this.summary();
    });
  }
  clear() {
    return this.serialized(async () => {
      try {
        await rm(this.file, { force: true });
      } catch {
        throw new Error("来源凭据清除失败");
      }
      this.loaded = true;
      this.key = undefined;
      this.persisted = false;
      this.revision++;
      return this.summary();
    });
  }
}
export function validateProviderKey(key: unknown): string {
  if (
    typeof key !== "string" ||
    key.length < 8 ||
    key.length > 1024 ||
    /[\x00-\x20\x7f]/.test(key)
  )
    throw new Error("无效来源密钥");
  return key;
}
