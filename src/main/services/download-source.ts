export type DownloadSource = 'auto' | 'official' | 'bmclapi';

let preference: DownloadSource = 'auto';
export function configureDownloadSource(value: DownloadSource): void {
  if (!['auto', 'official', 'bmclapi'].includes(value)) throw Error('无效下载源');
  preference = value;
}

const mirror = 'https://bmclapi2.bangbang93.com';
// BMCLAPI documents these path translations. Never rewrite account, auth or
// arbitrary third-party URLs, even when the user prefers a mirror.
export function bmclapiUrl(input: string): string | undefined {
  if (/(?:^|\/)\.\.?\//.test(input)) return undefined;
  let url: URL;
  try { url = new URL(input); } catch { return undefined; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return undefined;
  const host = url.hostname.toLowerCase(), path = url.pathname;
  if ((host === 'launchermeta.mojang.com' || host === 'launcher.mojang.com' || host === 'piston-meta.mojang.com' || host === 'piston-data.mojang.com') && /^\/(?:mc\/game\/|v1\/(?:packages|objects|products)\/)[a-zA-Z0-9/_.,-]+$/.test(path)) return mirror + path;
  if (host === 'resources.download.minecraft.net' && /^\/[a-f0-9]{2}\/[a-f0-9]{40}$/.test(path)) return mirror + '/assets' + path;
  if (host === 'libraries.minecraft.net' && /^\/[a-zA-Z0-9_./+-]+$/.test(path) && !path.includes('..')) return mirror + '/maven' + path;
  if (host === 'maven.minecraftforge.net' && /^\/[a-zA-Z0-9_./+-]+$/.test(path) && !path.includes('..')) return mirror + '/maven' + path;
  if (host === 'maven.fabricmc.net' && /^\/[a-zA-Z0-9_./+-]+$/.test(path) && !path.includes('..')) return mirror + '/maven' + path;
  if (host === 'maven.neoforged.net' && path.startsWith('/releases/') && /^\/releases\/[a-zA-Z0-9_./+-]+$/.test(path) && !path.includes('..')) return mirror + '/maven' + path.slice('/releases'.length);
  if (host === 'maven.quiltmc.org' && path.startsWith('/repository/release/') && /^\/repository\/release\/[a-zA-Z0-9_./+-]+$/.test(path) && !path.includes('..')) return mirror + '/maven' + path.slice('/repository/release'.length);
  if (host === 'meta.fabricmc.net' && /^\/v\d+\/[a-zA-Z0-9/_.,-]+$/.test(path)) return mirror + '/fabric-meta' + path;
  if (host === 'meta.quiltmc.org' && /^\/v\d+\/[a-zA-Z0-9/_.,-]+$/.test(path)) return mirror + '/quilt-meta' + path;
  return undefined;
}

export function downloadCandidates(input: string, restricted = false): string[] {
  if (restricted || preference === 'official') return [input];
  const alternative = bmclapiUrl(input);
  if (!alternative) return [input];
  return preference === 'bmclapi' ? [alternative, input] : [input, alternative];
}
