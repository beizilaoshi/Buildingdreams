import {it,expect} from 'vitest';
import {ContentProviders, type ContentSource} from '../src/main/services/content-provider';
const source=(provider:'modrinth'|'curseforge', total:number, error?:string):ContentSource=>({
 async search(q,f={},signal){signal?.throwIfAborted();if(error)throw Error(error);const offset=f.offset??0,limit=f.limit??20;return {offset,limit,total_hits:total,hits:Array.from({length:Math.max(0,Math.min(limit,total-offset))},(_,i)=>({provider,project_id:provider==='modrinth'?`mr${offset+i}`:`cf:${offset+i+1}`,title:'Same name',description:'',downloads:1}))}},
 project(){throw Error('unused')},version(){throw Error('unused')},versions(){throw Error('unused')}
});
it.each([[101,3],[3,101],[0,7],[41,41],[1,0]])('exhausts unequal totals %i/%i without gaps or duplicate IDs',async(a,b)=>{
 const api=new ContentProviders(source('modrinth',a),source('curseforge',b));const ids:string[]=[];
 for(let offset=0;offset<a+b;offset+=7){const p=await api.search('中文',{provider:'all',offset,limit:7});expect(p.total_hits).toBe(a+b);ids.push(...p.hits.map(h=>h.project_id));}
 expect(ids).toHaveLength(a+b);expect(new Set(ids).size).toBe(a+b);
 expect(ids).toContain(a?'mr0':'cf:1');
});
it('interleaves providers and preserves namesake projects with actual IDs',async()=>{const api=new ContentProviders(source('modrinth',2),source('curseforge',2));expect((await api.search('',{provider:'all'})).hits.map(h=>h.project_id)).toEqual(['mr0','cf:1','mr1','cf:2'])});
it('reports source failure while retaining the other entire source',async()=>{const api=new ContentProviders(source('modrinth',9),source('curseforge',0,'密钥未配置'));const p=await api.search('',{provider:'all',offset:7,limit:7});expect(p.hits.map(h=>h.project_id)).toEqual(['mr7','mr8']);expect(p.sources).toMatchObject([{provider:'modrinth',status:'available'},{provider:'curseforge',status:'failed',message:'密钥未配置'}])});
it('throws when both fail',async()=>{const api=new ContentProviders(source('modrinth',0,'MR failed'),source('curseforge',0,'CF failed'));await expect(api.search('',{provider:'all'})).rejects.toThrow(/MR failed.*CF failed/)});
it('does not downgrade cancellation into partial success',async()=>{const controller=new AbortController();const slow=source('modrinth',1);slow.search=async()=>{controller.abort();return {hits:[],offset:0,limit:1,total_hits:0}};await expect(new ContentProviders(slow,source('curseforge',2)).search('',{provider:'all'},controller.signal)).rejects.toThrow()});
it('skips unsupported tag on a source rather than broadening its filter',async()=>{const api=new ContentProviders(source('modrinth',9),source('curseforge',2));const p=await api.search('',{provider:'all',projectType:'mod',tag:'cf-407'});expect(p.total_hits).toBe(2);expect(p.sources?.[0].status).toBe('unsupported')});
it('refuses continuation when a source disappears or recovers instead of shifting ranks across pages',async()=>{
 let unavailable=false;const cf=source('curseforge',6),search=cf.search.bind(cf);cf.search=async(...args)=>{if(unavailable)throw Error('temporary outage');return search(...args)};
 const api=new ContentProviders(source('modrinth',12),cf);
 await api.search('',{provider:'all',offset:0,limit:7});unavailable=true;
 await expect(api.search('',{provider:'all',offset:7,limit:7})).rejects.toThrow(/来源或项目总数已变化/);
 const first=await api.search('',{provider:'all',offset:0,limit:7});expect(first.total_hits).toBe(12);
 unavailable=false;await expect(api.search('',{provider:'all',offset:7,limit:7})).rejects.toThrow(/来源或项目总数已变化/);
});
it.each(['modrinth','curseforge'] as const)('invalidates search when %s total changes after probe even with a full requested slice',async(provider)=>{
 const changed=source(provider,3),search=changed.search.bind(changed);let reads=0;
 changed.search=async(...args)=>{const page=await search(...args);if(++reads>1)page.total_hits=2;return page};
 const stable=source(provider==='modrinth'?'curseforge':'modrinth',20);
 const api=new ContentProviders(provider==='modrinth'?changed:stable,provider==='curseforge'?changed:stable);
 await expect(api.search('',{provider:'all',offset:0,limit:4})).rejects.toThrow(/来源或项目总数已变化.*第一页/);
});
