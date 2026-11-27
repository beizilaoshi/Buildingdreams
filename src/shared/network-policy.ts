export interface DownloadPolicy {
  downloadConcurrency: number;
  /** Aggregate KiB/s for all file downloads; zero means unlimited. */
  downloadSpeedLimitKib: number;
}
export const DEFAULT_DOWNLOAD_POLICY: Readonly<DownloadPolicy> = Object.freeze({ downloadConcurrency: 6, downloadSpeedLimitKib: 0 });
export function validateDownloadPolicy(policy: DownloadPolicy): void {
  if (!Number.isInteger(policy.downloadConcurrency) || policy.downloadConcurrency < 1 || policy.downloadConcurrency > 64)
    throw Error('下载并发数必须为 1 到 64 的整数');
  if (!Number.isInteger(policy.downloadSpeedLimitKib) || policy.downloadSpeedLimitKib < 0 || policy.downloadSpeedLimitKib > 1048576)
    throw Error('下载限速必须为 0 到 1048576 的整数');
}
