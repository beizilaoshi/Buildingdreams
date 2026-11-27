import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import type { ContentVersion } from '../../shared/content';
import { NetworkService } from './network';
import { validateVersion } from './content-validation';

export {identificationScope} from '../../shared/mod-identification';
export type {ModIdentificationItem,ModIdentificationResult,ModIdentificationSourceStatus} from '../../shared/mod-identification';

const CF_MURMUR_MULTIPLIER = 0x5bd1e995;
function cfWhitespace(byte:number):boolean { return byte===0x09 || byte===0x0a || byte===0x0d || byte===0x20; }

/** CurseForge's normalized MurmurHash2 variant, seed 1; raw jar bytes never leave this process. */
export async function curseForgeFingerprintFromFile(path:string, signal?:AbortSignal):Promise<number> {
  const before=await stat(path);
  if(!before.isFile() || !Number.isSafeInteger(before.size) || before.size>0xffffffff) throw new Error('Mod 文件大小不受支持');
  let normalizedLength=0;
  for await (const chunk of createReadStream(path,{signal})) {
    signal?.throwIfAborted();
    for(const byte of chunk as Buffer) if(!cfWhitespace(byte)) normalizedLength++;
  }
  if(normalizedLength>0xffffffff) throw new Error('Mod 标准化指纹长度超出范围');
  let hash=(1^normalizedLength)>>>0;
  const mix=(bytes:number[])=>{
    let k=(bytes[0]|bytes[1]<<8|bytes[2]<<16|bytes[3]<<24)>>>0;
    k=Math.imul(k,CF_MURMUR_MULTIPLIER)>>>0;
    k^=k>>>24;
    k=Math.imul(k,CF_MURMUR_MULTIPLIER)>>>0;
    hash=Math.imul(hash,CF_MURMUR_MULTIPLIER)>>>0;
    hash^=k;
  };
  const block:number[]=[];
  for await(const chunk of createReadStream(path,{signal})) {
    signal?.throwIfAborted();
    for(const byte of chunk as Buffer) {
      if(cfWhitespace(byte)) continue;
      block.push(byte);
      if(block.length===4) { mix(block); block.length=0; }
    }
  }
  const tailBytes=block.length;
  if(tailBytes>=3) hash^=block[2]<<16;
  if(tailBytes>=2) hash^=block[1]<<8;
  if(tailBytes>=1) { hash^=block[0]; hash=Math.imul(hash,CF_MURMUR_MULTIPLIER)>>>0; }
  hash^=hash>>>13;
  hash=Math.imul(hash,CF_MURMUR_MULTIPLIER)>>>0;
  hash^=hash>>>15;
  signal?.throwIfAborted();
  const after=await stat(path);
  if(before.size!==after.size || before.mtimeMs!==after.mtimeMs) throw new Error('Mod 文件在计算指纹时发生变化，请刷新后重试');
  return hash>>>0;
}

export interface CurseForgeFingerprintSource {
  identifyFingerprint(fingerprint:number, expectedSize:number, expectedSha1:string, signal?:AbortSignal):Promise<ContentVersion|null>;
  fingerprintLookupConfigured():Promise<boolean>;
}

/** Fingerprint lookup sends only the computed integer, never a path or jar bytes. */
export class CurseForgeFingerprintIdentifier {
  constructor(private source:CurseForgeFingerprintSource) {}
  configured():Promise<boolean> { return this.source.fingerprintLookupConfigured(); }
  async lookup(path:string, expectedSize:number, expectedSha1:string, signal?:AbortSignal):Promise<ContentVersion|null> {
    if(!Number.isSafeInteger(expectedSize)||expectedSize<0||!/^[a-f0-9]{40}$/i.test(expectedSha1)) throw new Error('无效 Mod 文件快照');
    signal?.throwIfAborted();
    const fingerprint=await curseForgeFingerprintFromFile(path,signal);
    signal?.throwIfAborted();
    return this.source.identifyFingerprint(fingerprint,expectedSize,expectedSha1.toLowerCase(),signal);
  }
}

/** User-triggered exact-file lookup. Bounded process-local cache, no credentials. */
export class HashModIdentifier {
  private cache = new Map<string,{until:number;version:ContentVersion|null}>();
  constructor(private network:NetworkService, private base='https://api.modrinth.com/v2') {}
  async lookup(sha1:string, signal?:AbortSignal):Promise<ContentVersion|null> {
    if (!/^[a-f0-9]{40}$/i.test(sha1)) throw new Error('无效 SHA-1');
    signal?.throwIfAborted();
    sha1=sha1.toLowerCase();
    const cached=this.cache.get(sha1);
    if(cached && cached.until>Date.now()) return structuredClone(cached.version);
    this.cache.delete(sha1);
    const deadline=AbortSignal.timeout(15000);
    const combined=signal?AbortSignal.any([signal,deadline]):deadline;
    let version:ContentVersion|null;
    try {
      version=validateVersion(await this.network.json(`${this.base}/version_file/${sha1}?algorithm=sha1`,combined));
      if (!version.files.some(file=>file.hashes.sha1===sha1 && /\.jar$/i.test(file.filename))) throw new Error('官方响应与本地 JAR 哈希不匹配');
      version={...version,provider:'modrinth'};
    } catch(error) {
      combined.throwIfAborted();
      if (!(error instanceof Error) || error.message!=='下载失败 HTTP 404') throw error;
      version=null;
    }
    combined.throwIfAborted();
    if(this.cache.size>=512) this.cache.delete(this.cache.keys().next().value!);
    this.cache.set(sha1,{until:Date.now()+(version?3600000:300000),version:structuredClone(version)});
    return version;
  }
}
