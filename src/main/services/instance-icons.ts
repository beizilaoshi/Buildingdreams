import { PNG } from 'pngjs';
import { readFile, mkdir, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { safeDestination } from './network';
export async function copyInstanceIcon(root:string,source:string):Promise<string> {
  const info=await lstat(source);if(!info.isFile()||info.size>2*1024*1024)throw Error('图标需为 2 MB 以内的 PNG');
  const bytes=await readFile(source);
  if(bytes.length<24||!bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))throw Error('仅支持 PNG 图标');
  const width=bytes.readUInt32BE(16),height=bytes.readUInt32BE(20);
  if(width<1||height<1||width>1024||height>1024)throw Error('PNG 尺寸须在 1–1024 像素以内');
  const original=PNG.sync.read(bytes),image=new PNG({width:128,height:128});
  for(let y=0;y<128;y++)for(let x=0;x<128;x++) {
    const sourceOffset=(Math.floor(y*height/128)*width+Math.floor(x*width/128))*4;
    original.data.copy(image.data,(y*128+x)*4,sourceOffset,sourceOffset+4);
  }
  const normalized=PNG.sync.write(image),name=createHash('sha256').update(normalized).digest('hex')+'.png';
  await mkdir(root,{recursive:true});await writeFile(await safeDestination(root,name),normalized);return name;
}
export async function instanceIcon(root:string,name:string):Promise<string> {
  if(!/^[a-f0-9]{64}\.png$/.test(name))throw Error('无效托管图标');
  const bytes=await readFile(await safeDestination(root,name));
  if(bytes.length>256*1024||createHash('sha256').update(bytes).digest('hex')+'.png'!==name)throw Error('托管图标校验失败');
  return 'data:image/png;base64,'+bytes.toString('base64');
}
