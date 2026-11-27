import { DEFAULT_DOWNLOAD_POLICY, validateDownloadPolicy, type DownloadPolicy } from '../../shared/network-policy';

interface Waiter { start(): void; }
/** Shared by every NetworkService, including restricted service instances. */
export class DownloadScheduler {
  private policy: DownloadPolicy;
  private active = 0;
  private queue: Waiter[] = [];
  private bandwidthTail: Promise<void> = Promise.resolve();
  constructor(policy: DownloadPolicy = DEFAULT_DOWNLOAD_POLICY) { validateDownloadPolicy(policy); this.policy = { ...policy }; }
  configure(policy: DownloadPolicy): void { validateDownloadPolicy(policy); this.policy = { ...policy }; this.drain(); }
  private drain(): void { while (this.active < this.policy.downloadConcurrency && this.queue.length) this.queue.shift()!.start(); }
  acquire(signal: AbortSignal): Promise<() => void> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
      const abort = () => { this.queue = this.queue.filter(item => item !== waiter); reject(signal.reason); };
      const waiter: Waiter = { start: () => {
        signal.removeEventListener('abort', abort); this.active++;
        let released = false;
        resolve(() => { if (!released) { released = true; this.active--; this.drain(); } });
      } };
      signal.addEventListener('abort', abort, { once: true }); this.queue.push(waiter); this.drain();
    });
  }
  async consume(bytes: number, signal: AbortSignal): Promise<void> {
    signal.throwIfAborted();
    // Serial pacing makes the budget process-wide, rather than multiplying it per request.
    const previous = this.bandwidthTail;
    let release!: () => void;
    const turn = new Promise<void>(resolve => { release = resolve; });
    this.bandwidthTail = previous.then(() => turn);
    try {
      await abortable(previous, signal);
      let remaining = bytes;
      while (remaining > 0 && this.policy.downloadSpeedLimitKib > 0) {
        const rate = this.policy.downloadSpeedLimitKib * 1024;
        const duration = Math.min(50, remaining * 1000 / rate);
        const start = Date.now();
        await delay(duration, signal);
        remaining -= (Date.now() - start) * rate / 1000;
      }
      signal.throwIfAborted();
    } finally { release(); }
  }
}
function abortable<T>(promise: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}
function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const abort = () => { clearTimeout(timer); reject(signal.reason); };
    const timer = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, Math.max(1, ms));
    signal.addEventListener('abort', abort, { once: true });
  });
}
export const globalDownloadScheduler = new DownloadScheduler();
export function configureDownloadPolicy(policy: DownloadPolicy): void { globalDownloadScheduler.configure(policy); }
