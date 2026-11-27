import { createHash, randomUUID } from "node:crypto";
import { mkdir, open, rename, rm, lstat, stat } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import { createReadStream } from "node:fs";
import type { TaskContext } from "./tasks";
import { discardResume, forgetResume, getResume, loadResumeStore, lockDownload, resumeEligible, retainResume } from "./resume-store";
import { globalDownloadScheduler } from './download-scheduler';
import { downloadCandidates } from './download-source';

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
class ResumeRejected extends Error {}
function retryableDownloadError(error: unknown): boolean {
  return error instanceof Error && /超时|TimeoutError|fetch failed|terminated/i.test(error.message + error.name);
}
function fallbackDownloadError(error: unknown): boolean {
  return error instanceof Error && (error instanceof SyntaxError || /下载失败 HTTP|下载超时|TimeoutError|fetch failed|terminated|响应不匹配|校验失败|清单过大|空下载响应|下载重定向(?:过多|缺少地址)/i.test(error.message + error.name));
}
const responseSources = new WeakMap<Response, string>();
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
    let abort!: () => void;
    const cancelled = new Promise<never>((_, reject) => { abort = () => { reject(signal!.reason); void reader.cancel().catch(() => {}); }; signal?.addEventListener('abort', abort, { once: true }); });
    try { return await Promise.race([reader.read(), timeout, cancelled]); } finally { if (timer) clearTimeout(timer); signal?.removeEventListener('abort', abort); signal?.throwIfAborted(); }
  }
  async response(url: string, signal?: AbortSignal, rangeHeaders?: Record<string, string>): Promise<Response> {
    signal?.throwIfAborted();
    for (let redirects = 0; redirects <= 5; redirects++) {
      signal?.throwIfAborted();
      this.validateUrl(url);
      const deadline = new AbortController();
      const timer = setTimeout(() => deadline.abort(new Error("下载超时")), this.options.idleTimeoutMs ?? 30000);
      let response: Response;
      try {
        response = await (this.options.fetch ?? fetch)(url, {
          signal: signal ? AbortSignal.any([signal, deadline.signal]) : deadline.signal,
          redirect: "manual",
          headers: { "User-Agent": "ZhumengLauncher/0.1.0 (github.com/beizilaoshi)", "Accept-Encoding": "identity", ...rangeHeaders },
        });
      } finally { clearTimeout(timer); }
      if ([301, 302, 303, 307, 308].includes(response.status)) {
        const location = response.headers.get("location");
        await response.body?.cancel();
        if (!location) throw new Error("下载重定向缺少地址");
        if (rangeHeaders) throw new ResumeRejected("续传来源重定向");
        url = new URL(location, url).href;
        continue;
      }
      if (!response.ok && !(rangeHeaders && response.status === 416)) {
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
      const wrapped = new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers });
      responseSources.set(wrapped, url);
      return wrapped;
    }
    throw new Error("下载重定向过多");
  }
  async json<T>(url: string, signal?: AbortSignal): Promise<T> {
    this.validateUrl(url);
    const candidates = downloadCandidates(url, !!this.options.allowedHosts);
    for (let source = 0; source < candidates.length; source++) {
      let attempt = 0;
      for (;;) {
        try { return await this.jsonOnce<T>(candidates[source], signal); }
        catch (error) {
          signal?.throwIfAborted();
          if (attempt++ < (this.options.retries ?? 2) && retryableDownloadError(error)) continue;
          if (source === candidates.length - 1 || !fallbackDownloadError(error)) throw error;
          break;
        }
      }
    }
    throw Error('下载源不可用');
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
    await loadResumeStore();
    this.validateUrl(spec.url);
    const target = await safeDestination(root, spec.path);
    await mkdir(dirname(target), { recursive: true });
    await safeDestination(root, spec.path);
    const unlock = await lockDownload(target, context.signal);
    let release: (() => void) | undefined;
    try {
    release = await globalDownloadScheduler.acquire(context.signal);
    try {
    const candidates = downloadCandidates(spec.url, !!this.options.allowedHosts);
    for (let source = 0; source < candidates.length; source++) {
      let attempt = 0;
      for (;;) {
        try { return await this.downloadOnce(root, { ...spec, url: candidates[source] }, context); }
        catch (error) {
          context.signal.throwIfAborted();
          if (attempt++ < (this.options.retries ?? 2) && retryableDownloadError(error)) continue;
          if (source === candidates.length - 1 || !fallbackDownloadError(error)) throw error;
          break;
        }
      }
    }
    throw Error('下载源不可用');
    } finally { release?.(); }
    } finally { await unlock(); }
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
        const hash1 = createHash("sha1"), hash256 = createHash("sha256");
        let size = 0;
        for await (const chunk of createReadStream(target, {
          signal: context.signal,
        })) {
          hash1.update(chunk); hash256.update(chunk);
          size += chunk.length;
        }
        if (
          (!spec.sha1 || hash1.digest("hex") === spec.sha1.toLowerCase()) &&
          (!spec.sha256 || hash256.digest("hex") === spec.sha256.toLowerCase()) &&
          (spec.size === undefined || size === spec.size)
        ) {
          await discardResume(target);
          return target;
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    await mkdir(dirname(target), { recursive: true });
    const identity = JSON.stringify([new URL(spec.url).href, spec.sha1?.toLowerCase(), spec.sha256?.toLowerCase(), spec.size]);
    const rootStat = await stat(resolve(root));
    const rootIdentity = `${rootStat.dev}:${rootStat.ino}`;
    let saved = await getResume(target, root, rootIdentity);
    if (saved && (saved.identity !== identity || Date.now() - saved.updated > 30 * 60 * 1000)) { await discardResume(target); saved = undefined; }
    const eligible = !!(spec.sha1 || spec.sha256) && resumeEligible(spec.size);
    let restarted = false;
    for (;;) {
      const partial = saved?.partial ?? target + "." + randomUUID() + ".partial";
      await safeDestination(root, relative(root, partial));
      let file;
      try { file = await open(partial, saved ? "r+" : "wx"); }
      catch (error) {
        if (saved && (error as NodeJS.ErrnoException).code === 'ENOENT') { await forgetResume(target); saved = undefined; continue; }
        throw error;
      }
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      let bytes = saved?.bytes ?? 0;
      let validator = saved?.validator;
      let validatorHeader = saved?.validatorHeader;
      let keep = false;
      let published = false;
      try {
        const stat = await file.stat();
        if (!stat.isFile() || stat.nlink !== 1 || stat.size !== bytes) throw new ResumeRejected("续传临时文件变化");
        const sha1 = createHash("sha1"), sha256 = createHash("sha256");
        // Rehash every retained byte; the prefix is never trusted from metadata.
        if (bytes) {
          for await (const chunk of file.createReadStream({ start: 0, end: bytes - 1, autoClose: false })) { context.signal.throwIfAborted(); sha1.update(chunk); sha256.update(chunk); }
        }
        context.signal.throwIfAborted();
        const response = await this.response(spec.url, context.signal, saved ? { Range: `bytes=${bytes}-`, 'If-Range': saved.validator } : undefined);
        reader = response.body?.getReader();
        if (saved) {
          const contentRange = response.headers.get('content-range');
          const match = /^bytes (\d+)-(\d+)\/(\d+)$/.exec(contentRange ?? '');
          const complete = response.status === 416 && contentRange === `bytes */${spec.size}` && bytes === spec.size;
          if (!complete && (response.status !== 206 || !match || Number(match[1]) !== bytes || Number(match[2]) !== spec.size! - 1 || Number(match[3]) !== spec.size || response.headers.get(saved.validatorHeader) !== saved.validator)) throw new ResumeRejected("续传响应不匹配");
          if (complete) { await reader?.cancel(); reader = undefined; }
        } else {
          if (response.status !== 200) throw new Error("完整下载响应不匹配");
          const etag = response.headers.get('etag'), modified = response.headers.get('last-modified');
          if (etag && /^"[^"\r\n]+"$/.test(etag)) { validator = etag; validatorHeader = 'etag'; }
          else if (modified && Number.isFinite(Date.parse(modified))) { validator = modified; validatorHeader = 'last-modified'; }
          // A redirected source needs a separate identity; conservatively restart it in full.
          if (responseSources.get(response) !== new URL(spec.url).href) validator = undefined;
        }
        if (response.headers.get('content-encoding') && response.headers.get('content-encoding') !== 'identity') throw new ResumeRejected("续传不支持编码响应");
        const start = Date.now(), initialBytes = bytes;
        if (!reader && response.status !== 416) throw new Error("空下载响应");
        while (reader) {
          context.signal.throwIfAborted();
          const { done, value } = await this.read(reader, context.signal);
          if (done) break;
          await globalDownloadScheduler.consume(value.length, context.signal);
          if (spec.size !== undefined && bytes + value.length > spec.size) throw new ResumeRejected("下载大小超限");
          sha1.update(value); sha256.update(value);
          await file.write(value, 0, value.length, bytes);
          bytes += value.length;
          context.report(spec.size ? bytes / spec.size : 0, ((bytes - initialBytes) * 1000) / Math.max(1, Date.now() - start));
        }
        if (spec.size !== undefined && bytes !== spec.size) throw new Error("下载大小校验失败");
        if (spec.sha1 && sha1.digest("hex") !== spec.sha1.toLowerCase()) throw new ResumeRejected("SHA1 校验失败");
        if (spec.sha256 && sha256.digest("hex") !== spec.sha256.toLowerCase()) throw new ResumeRejected("SHA256 校验失败");
        context.signal.throwIfAborted();
        await file.close();
        await safeDestination(root, spec.path);
        context.signal.throwIfAborted();
        await rename(partial, target);
        published = true;
        // The verified rename is the commit point. Manifest cleanup is best-effort
        // and must never turn a completed download into a reported failure.
        await forgetResume(target).catch(() => {});
        return target;
      } catch (error) {
        if (published) return target;
        if (error instanceof ResumeRejected && saved && !restarted) {
          restarted = true;
          // Retry one full request after a changed server or rejected Range.
        } else {
          keep = eligible && !!validator && !!validatorHeader && bytes > 0 && !(error instanceof ResumeRejected);
          if (keep) {
            await file.close();
            await retainResume(target, { identity, partial, bytes, validator: validator!, validatorHeader: validatorHeader!, updated: Date.now(), root: resolve(root), rootIdentity });
          }
          throw error;
        }
      } finally {
        await reader?.cancel().catch(() => {});
        await file.close().catch(() => {});
        if (!keep && !published) { await rm(partial, { force: true }); await forgetResume(target).catch(() => {}); }
      }
      saved = undefined;
    }
  }
}
