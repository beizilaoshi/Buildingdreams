import type { Instance } from './types';
import { validateLaunchSettings } from './launch-settings';
export type InstanceMetadata = Pick<Instance,'name'|'description'|'category'|'favorite'>;
export function bounded(value: unknown, max: number, empty = false): string {
  if(typeof value !== 'string' || (!empty && !value.trim()) || value.length > max || /[\0]/.test(value)) throw Error('无效实例字段');
  return value;
}
export function validateMetadata(value: unknown): Partial<InstanceMetadata> {
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw Error('无效实例信息');
  const data = value as Record<string,unknown>, result: Partial<InstanceMetadata> = {};
  for(const key of Object.keys(data)) {
    if(key === 'favorite') { if(typeof data[key] !== 'boolean') throw Error('无效收藏'); result.favorite = data[key]; }
    else if(key === 'name' || key === 'description' || key === 'category') result[key] = bounded(data[key],key === 'description' ? 2000 : key === 'name' ? 120 : 80,key !== 'name');
    else throw Error('未知实例信息字段');
  }
  return result;
}
export function validateInstance(value: unknown): Instance {
  if(!value || typeof value !== 'object' || Array.isArray(value)) throw Error('无效实例记录');
  const x = value as Record<string,unknown>;
  const allowed = ['id','name','versionId','resourceDir','gameDir','minecraft','status','error','memoryMb','javaArgs','javaPath','loader','launch','description','category','favorite','icon'];
  if(Object.keys(x).some(k=>!allowed.includes(k))) throw Error('未知实例记录字段');
  for(const key of ['id','versionId','minecraft']) bounded(x[key],200);
  if(/[\\/:\x00-\x1f]/.test(String(x.versionId)) || ['.','..'].includes(String(x.versionId))) throw Error('无效版本路径');
  for(const key of ['resourceDir','gameDir']) bounded(x[key],4096);
  bounded(x.name,120);
  if(!['ready','invalid'].includes(String(x.status))) throw Error('无效实例状态');
  if(!Number.isInteger(x.memoryMb) || Number(x.memoryMb)<512 || Number(x.memoryMb)>1048576) throw Error('无效内存');
  if(!Array.isArray(x.javaArgs) || x.javaArgs.length>128) throw Error('无效 Java 参数');
  x.javaArgs.forEach(v=>bounded(v,4096,true));
  if(x.javaPath !== undefined) bounded(x.javaPath,4096,true);
  if(x.error !== undefined) bounded(x.error,16384,true);
  for(const key of ['description','category','favorite']) if(x[key] !== undefined) validateMetadata({[key]:x[key]});
  if(x.icon !== undefined && (typeof x.icon !== 'string' || !/^[a-f0-9]{64}\.png$/.test(x.icon))) throw Error('无效托管图标');
  if(x.loader !== undefined) {
    const l = x.loader as Record<string,unknown>;
    if(!l || typeof l !== 'object' || Array.isArray(l) || Object.keys(l).some(k=>!['kind','version'].includes(k)) || !['fabric','quilt','forge','neoforge'].includes(String(l.kind))) throw Error('无效加载器');
    bounded(l.version,200);
  }
  if(x.launch !== undefined) validateLaunchSettings(x.launch);
  return structuredClone(x) as unknown as Instance;
}
