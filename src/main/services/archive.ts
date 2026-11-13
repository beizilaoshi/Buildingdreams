import { open, readAllEntries, openEntryReadStream } from "@xmcl/unzip";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { createWriteStream } from "node:fs";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { safeDestination } from "./network";
export interface ArchiveEntry {
  path: string;
  size: number;
  symlink?: boolean;
}
export const ARCHIVE_LIMIT = 2 * 1024 * 1024 * 1024;
export function archivePath(path: string): string {
  if (
    typeof path !== "string" ||
    !path ||
    path.length > 1024 ||
    /[\\:\x00-\x1f]/.test(path) ||
    path.startsWith("/")
  )
    throw new Error("不安全 ZIP 路径");
  const parts = path.replace(/\/$/, "").split("/");
  if (
    parts.some(
      (p) =>
        !p ||
        p === "." ||
        p === ".." ||
        /[. ]$/.test(p) ||
        /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(p),
    )
  )
    throw new Error("不安全 ZIP 路径");
  return path;
}
export function validateArchive(entries: ArchiveEntry[]): void {
  if (entries.length > 20000) throw new Error("ZIP 文件数量过多");
  const seen = new Map<string, boolean>();
  let total = 0;
  for (const e of entries) {
    archivePath(e.path);
    if (e.symlink || !Number.isSafeInteger(e.size) || e.size < 0)
      throw new Error("ZIP 包含链接或无效大小");
    total += e.size;
    if (total > ARCHIVE_LIMIT) throw new Error("ZIP 解压大小超限");
    const key = e.path.replace(/\/$/, "").toLowerCase();
    if (seen.has(key)) throw new Error("ZIP 路径大小写碰撞");
    seen.set(key, e.path.endsWith("/"));
  }
  for (const [key] of seen) {
    const parts = key.split("/");
    parts.pop();
    while (parts.length) {
      if (seen.get(parts.join("/")) === false)
        throw new Error("ZIP 文件目录冲突");
      parts.pop();
    }
  }
}
export async function readArchive(file: string) {
  const zip = await open(file, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: true,
  });
  try {
    const entries = await readAllEntries(zip);
    validateArchive(
      entries.map((e) => ({
        path: e.fileName,
        size: e.uncompressedSize,
        symlink: ((e.externalFileAttributes >>> 16) & 0xf000) === 0xa000,
      })),
    );
    async function read(
      path: string,
      limit = 16 * 1024 * 1024,
      signal?: AbortSignal,
    ): Promise<Buffer> {
      const entry = entries.find((e) => e.fileName === path);
      if (!entry || entry.uncompressedSize > limit)
        throw new Error("ZIP 清单不存在或过大");
      const stream = await openEntryReadStream(zip, entry);
      const chunks: Buffer[] = [];
      let size = 0;
      const abort = () => stream.destroy(new Error("取消 ZIP 读取"));
      signal?.addEventListener("abort", abort, { once: true });
      try {
        signal?.throwIfAborted();
        for await (const chunk of stream) {
          size += chunk.length;
          if (size > limit || size > entry.uncompressedSize)
            throw new Error("ZIP 大小校验失败");
          chunks.push(chunk);
        }
        if (size !== entry.uncompressedSize)
          throw new Error("ZIP 大小校验失败");
        return Buffer.concat(chunks);
      } finally {
        signal?.removeEventListener("abort", abort);
        stream.destroy();
      }
    }
    return {
      entries,
      read,
      close: () => zip.close(),
      async extract(root: string, prefix: string, signal: AbortSignal) {
        for (const e of entries) {
          signal.throwIfAborted();
          if (!e.fileName.startsWith(prefix) || e.fileName.endsWith("/"))
            continue;
          const path = e.fileName.slice(prefix.length);
          archivePath(path);
          const target = await safeDestination(root, path);
          await mkdir(dirname(target), { recursive: true });
          const stream = await openEntryReadStream(zip, e);
          let size = 0;
          const bounded = new Transform({
            transform(chunk, _encoding, done) {
              size += chunk.length;
              done(
                size > e.uncompressedSize
                  ? new Error("ZIP 大小校验失败")
                  : null,
                chunk,
              );
            },
          });
          await pipeline(
            stream,
            bounded,
            createWriteStream(target, { flags: "w" }),
            { signal },
          );
          if (size !== e.uncompressedSize) throw new Error("ZIP 大小校验失败");
        }
      },
    };
  } catch (e) {
    zip.close();
    throw e;
  }
}
