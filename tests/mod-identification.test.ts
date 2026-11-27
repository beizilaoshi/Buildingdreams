import { expect, it } from 'vitest';
import { HashModIdentifier } from '../src/main/services/mod-identification';
import { NetworkService } from '../src/main/services/network';
import { modFile } from '../src/main/services/mods';
const hash = 'a'.repeat(40);
const version = {id:'version1',project_id:'project1',name:'x',version_number:'1',date_published:'2026-01-01',game_versions:['1.21'],loaders:['fabric'],dependencies:[],files:[{filename:'x.jar',url:'https://cdn.modrinth.com/x.jar',size:3,hashes:{sha1:hash}}]};
it('looks up the exact sha1, validates the returned binding and caches a defensive copy', async () => {
  const urls:string[]=[];
  const service = new HashModIdentifier(new NetworkService({fetch:async input => {urls.push(String(input));return Response.json(version);}}));
  const found = await service.lookup(hash);
  expect(found?.project_id).toBe('project1');
  found!.project_id='mutated';
  expect((await service.lookup(hash))?.project_id).toBe('project1');
  expect(urls).toEqual([`https://api.modrinth.com/v2/version_file/${hash}?algorithm=sha1`]);
});
it('rejects a provider version whose files do not contain the queried hash', async () => {
  const service = new HashModIdentifier(new NetworkService({fetch:async()=>Response.json(version)}));
  await expect(service.lookup('b'.repeat(40))).rejects.toThrow('哈希');
});
it('only caches a genuine missing result, not network errors, and respects cancellation', async () => {
  let calls=0;
  const service = new HashModIdentifier(new NetworkService({fetch:async()=>{calls++;return new Response('',{status:calls===1?503:404});}}));
  await expect(service.lookup(hash)).rejects.toThrow('503');
  expect(await service.lookup(hash)).toBeNull(); expect(await service.lookup(hash)).toBeNull();
  expect(calls).toBe(2);
  await expect(service.lookup(hash,AbortSignal.abort())).rejects.toThrow();
});
it('accepts a single jar.old suffix and rejects stacked disabled suffixes',()=>{
  expect(modFile('example.jar.old')).toBe('example.jar.old');
  expect(()=>modFile('example.jar.old.disabled')).toThrow();
});
