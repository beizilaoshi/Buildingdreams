import {describe,it,expect} from 'vitest';
import {validateMusicPatch} from '../src/shared/music';
import {MusicService} from '../src/main/services/music';
import {mkdtemp,writeFile,mkdir,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
describe('music boundaries',()=>{
 it('rejects unknown keys, invalid volume and payloads',()=>{for(const value of [{volume:NaN},{volume:2},{autoPlay:1},{paths:['secret']},null])expect(()=>validateMusicPatch(value)).toThrow();});
 it('only exposes tokens and persists approved ordinary audio',async()=>{const dir=await mkdtemp(join(tmpdir(),'music-'));const file=join(dir,'track.wav');await writeFile(file,'RIFF');const service=new MusicService(join(dir,'music.json'));await service.add([file]);const snapshot=await service.read();expect(JSON.stringify(snapshot)).not.toContain(dir);expect(snapshot.tracks).toHaveLength(1);expect(await service.resolve(snapshot.tracks[0].id)).toBe(file);expect(await service.resolve('../secret')).toBeNull();const reload=new MusicService(join(dir,'music.json'));expect((await reload.read()).tracks).toHaveLength(1);await expect(service.add([join(dir,'music.json')])).rejects.toThrow();});
});

describe('music filesystem limits',()=>{
 it('rejects directory junctions and oversized audio without adding entries',async()=>{const dir=await mkdtemp(join(tmpdir(),'music-links-'));const outside=join(dir,'outside');await mkdir(outside);await writeFile(join(outside,'sound.mp3'),'test');const link=join(dir,'link');await symlink(outside,link,process.platform==='win32'?'junction':'dir');const service=new MusicService(join(dir,'music.json'));await expect(service.add([join(link,'sound.mp3')])).rejects.toThrow('链接');const {open}=await import('node:fs/promises');const big=join(dir,'big.wav');const file=await open(big,'w');try{await file.truncate(64*1024*1024+1);}finally{await file.close();}await expect(service.add([big])).rejects.toThrow('64 MiB');expect((await service.read()).tracks).toEqual([]);});
 it('revokes removed tokens and keeps persisted preferences',async()=>{const dir=await mkdtemp(join(tmpdir(),'music-revoke-'));const path=join(dir,'song.ogg');await writeFile(path,'audio');const service=new MusicService(join(dir,'music.json'));const snapshot=await service.add([path]);await service.patch({volume:0.73,random:true});await service.remove(snapshot.tracks[0].id);expect(await service.resolve(snapshot.tracks[0].id)).toBeNull();const restored=await new MusicService(join(dir,'music.json')).read();expect(restored.preferences.volume).toBe(0.73);expect(restored.preferences.random).toBe(true);expect(restored.tracks).toEqual([]);});
});

describe('music transactional reads',()=>{
 it('hides an uncommitted clear and retains existing tokens if persistence fails',async()=>{
  const {vi}=await import('vitest');const dir=await mkdtemp(join(tmpdir(),'music-rollback-'));const file=join(dir,'track.wav');await writeFile(file,'RIFF');const service=new MusicService(join(dir,'music.json'));const original=await service.add([file]);let entered!:()=>void,release!:()=>void;const saving=new Promise<void>(resolve=>{entered=resolve;});const gate=new Promise<void>(resolve=>{release=resolve;});vi.spyOn(service as any,'save').mockImplementation(async()=>{entered();await gate;throw Error('disk full');});
  const clear=service.clear();const rejected=expect(clear).rejects.toThrow('disk full');await saving;let readDone=false;const concurrentRead=service.read().then(snapshot=>{readDone=true;return snapshot;});const resolveDuringWrite=service.resolve(original.tracks[0].id);await new Promise<void>(resolve=>setImmediate(resolve));const wasPending=!readDone;release();await rejected;const snapshot=await concurrentRead;expect(wasPending).toBe(true);expect(snapshot).toEqual(original);expect(await resolveDuringWrite).toBe(file);expect(await service.resolve(original.tracks[0].id)).toBe(file);
 });
});
