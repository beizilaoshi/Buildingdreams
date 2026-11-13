import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, lstat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createReadStream } from "node:fs";
import type { TaskContext } from "./tasks";

export function contained(root: string, path: string): string {
  const target = resolve(root, path),
    rel = relative(resolve(root), target);
  if (!rel || rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel))
    throw new Error("下载路径超出实例目录");
  return target;
}
export async function safeDestination(
  root: string,
  path: string,
): Promise<string> {
  const destination = contained(root, path);
  // Reject symlinks/junctions in every existing component, including the destination.
  let current = resolve(root);
  for (const component of ["", ...relative(current, destination).split(sep)]) {
    current = resolve(current, component);
    try {
      if ((await lstat(current)).isSymbolicLink())
        throw new Error("下载路径不能包含符号链接");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }
  return destination;
}
export interface DownloadSpec {
  url: string;
  path: string;
  sha1?: string;
  sha256?: string;
  size?: number;
}
export class NetworkService {
  constructor(
    private options: {
      allowHttpLocalhost?: boolean;
      fetch?: typeof fetch;
      allowedHosts?: readonly string[];
      idleTimeoutMs?: number;
      retries?: number;
    } = {},
  ) {}
  restricted(allowedHosts: readonly string[]): NetworkService {
    return new NetworkService({ ...this.options, allowHttpLocalhost: false, allowedHosts });
  }
  validateUrl(input: string): URL {
    const url = new URL(input);
    const fixture =
      this.options.allowHttpLocalhost &&
      url.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
    if ((url.protocol !== "https:" && !fixture) || url.username || url.password)
      throw new Error("仅允许 HTTPS 下载源");
    if (this.options.allowedHosts && !this.options.allowedHosts.includes(url.hostname.toLowerCase()))
      throw new Error("下载来源不在官方允许列表");
    return url;
  }
  private async read(reader: ReadableStreamDefaultReader<Uint8Array>, signal?: AbortSignal) {
    signal?.throwIfAborted();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => { reject(new Error("下载超时")); void reader.cancel().catch(() => {}); }, this.options.idleTimeoutMs ?? 30000); });
    try { return await Promise.race([reader.read(), timeout]); } finally { if (timer) clearTimeout(timer); signal?.throwIfAborted(); }
  }
  async response(url: string, signal?: AbortSignal): Promise<Response> {
    for (let redirects = 0; redirects <= 5; redirects++) {
      this.validateUrl(url);
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error("下载超时")), this.options.idleTimeoutMs ?? 30000);
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(url, {
          signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal,
          redirect: "manual",
          headers: { "User-Agent": "ZhumengLauncher/0.1.0 (github.com/beizilaoshi)" },
        });
      } finally { clearTimeout(timer); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("下载重定向缺少地址");
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok) {
        await response.body?.cancel();
        throw new Error(`下载失败 HTTP ${response.status}`);
      }
      if (!response.body) return response;
      const reader = response.body.getReader();
      const body = new ReadableStream<Uint8Array>({
        pull: async controller => {
          try { const next = await this.read(reader, signal); if (next.done) controller.close(); else controller.enqueue(next.value); }
          catch (error) { controller.error(error); }
        },
        cancel: reason => reader.cancel(reason),
      });
      return new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
    }
    throw new Error("下载重定向过多");
  }
  async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    let attempt = 0;
    for (;;) {
      try { return await this.jsonOnce<T>(url, signal); }
      catch (error) {
        signal?.throwIfAborted();
        if (attempt++ >= (this.options.retries ?? 2) || !(error instanceof Error) || !/超时|TimeoutError|fetch failed/i.test(error.message + error.name)) throw error;
      }
    }
  }
  private async jsonOnce<T>(url: string, signal?: AbortSignal): Promise<T> {
    const response = await this.response(url, signal);
    const reader = response.body?.getReader();
    if (!reader) throw new Error("空下载响应");
    const parts: Uint8Array[] = [];
    let length = 0;
    try {
      while (true) {
        const { value, done } = await this.read(reader, signal);
        if (done) break;
        length += value.length;
        if (length > 32 * 1024 * 1024) throw new Error("清单过大");
        parts.push(value);
      }
      return JSON.parse(Buffer.concat(parts).toString("utf8")) as T;
    } finally {
      await reader.cancel().catch(() => {});
    }
  }
  async download(root: string, spec: DownloadSpec, context: TaskContext): Promise<string> {
    let attempt = 0;
    for (;;) {
      try { return await this.downloadOnce(root, spec, context); }
      catch (error) {
        context.signal.throwIfAborted();
        if (attempt++ >= (this.options.retries ?? 2) || !(error instanceof Error) || !/超时|TimeoutError|fetch failed/i.test(error.message + error.name)) throw error;
      }
    }
  }
  private async downloadOnce(
    root: string,
    spec: DownloadSpec,
    context: TaskContext,
  ): Promise<string> {
    if (spec.sha1 !== undefined && !/^[a-f0-9]{40}$/i.test(spec.sha1))
      throw new Error("无效 SHA1");
    if (spec.sha256 !== undefined && !/^[a-f0-9]{64}$/i.test(spec.sha256))
      throw new Error("无效 SHA256");
    const target = await safeDestination(root, spec.path);
    if (spec.sha1 || spec.sha256) {
      try {
        const hash = createHash(spec.sha256 ? "sha256" : "sha1");
        let size = 0;
        for await (const chunk of createReadStream(target, {
          signal: context.signal,
        })) {
          hash.update(chunk);
          size += chunk.length;
        }
        if (
          hash.digest("hex") === (spec.sha256 ?? spec.sha1)!.toLowerCase() &&
          (spec.size === undefined || size === spec.size)
        )
          return target;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir(dirname(target), { recursive: true });
    const partial = target + "." + randomUUID() + ".partial";
    const file = await open(partial, "wx");
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    try {
      context.signal.throwIfAborted();
      const response = await this.response(spec.url, context.signal);
      reader = response.body?.getReader();
      if (!reader) throw new Error("空下载响应");
      const sha1 = createHash("sha1"),
        sha256 = createHash("sha256");
      const total = spec.size ?? Number(response.headers.get("content-length"));
      let bytes = 0;
      const start = Date.now();
      while (true) {
        context.signal.throwIfAborted();
        const { done, value } = await this.read(reader, context.signal);
        if (done) break;
        sha1.update(value);
        sha256.update(value);
        await file.writeFile(value);
        bytes += value.length;
        if (spec.size !== undefined && bytes > spec.size) throw new Error("下载大小超限");
        context.report(
          total > 0 ? bytes / total : 0,
          (bytes * 1000) / Math.max(1, Date.now() - start),
        );
      }
      if (spec.size !== undefined && bytes !== spec.size)
        throw new Error("下载大小校验失败");
      if (spec.sha1 && sha1.digest("hex") !== spec.sha1.toLowerCase())
        throw new Error("SHA1 校验失败");
      if (spec.sha256 && sha256.digest("hex") !== spec.sha256.toLowerCase())
        throw new Error("SHA256 校验失败");
      context.signal.throwIfAborted();
      await file.close();
      await safeDestination(root, spec.path);
      context.signal.throwIfAborted();
      await rename(partial, target);
      return target;
    } finally {
      await reader?.cancel().catch(() => {});
      await file.close().catch(() => {});
      await rm(partial, { force: true });
    }
  }
}
