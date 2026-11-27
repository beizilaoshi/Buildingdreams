import type { ContentFilter, ContentProvider, SearchPage } from '../../shared/content';
import { resolveTag } from '../../shared/content-tags';
import type { ContentSource } from './content-provider';

class SearchInvalidated extends Error {
  constructor() { super("来源或项目总数已变化，请从第一页重新搜索，避免翻页重复或遗漏"); }
}

/** Stable round-robin ranks, followed by the longer source's remainder.
 * A global interval maps to one contiguous interval per source, including tails.
 * Provider rank is preserved; equal names on different platforms remain distinct.
 */
export async function aggregateSearch(
  sources: Record<ContentProvider, ContentSource>, query: string,
  filter: ContentFilter, signal?: AbortSignal,
): Promise<SearchPage> {
  const offset = filter.offset ?? 0, limit = filter.limit ?? 20;
  if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(limit) || limit < 1 || limit > 100)
    throw new Error('无效分页');
  const providers = ['modrinth', 'curseforge'] as const;
  const states: NonNullable<SearchPage['sources']> = providers.map(provider => ({provider,status:'available',total:0}));
  const notices = new Set<string>();
  const probedTotals: number[] = [];
  const read = async (index: number, start: number, count: number) => {
    const provider = providers[index];
    const page = await sources[provider].search(query, {...filter,provider,offset:start,limit:count}, signal);
    signal?.throwIfAborted();
    if (page.mappingNotice) notices.add(page.mappingNotice);
    return page;
  };
  const fail = (index: number, error: unknown) => {
    signal?.throwIfAborted();
    states[index] = {provider:providers[index], status:'failed', message:error instanceof Error ? error.message : '来源搜索失败'};
  };
  await Promise.all(providers.map(async (provider,index) => {
    if (filter.tag && !resolveTag(filter.projectType ?? 'mod', filter.tag, 'all')[provider]) {
      states[index] = {provider,status:'unsupported',message:'所选标签不支持此来源'};
      return;
    }
    try {
      const page = await read(index,0,1);
      probedTotals[index] = page.total_hits;
      states[index].total = Math.min(page.total_hits, provider === 'curseforge' ? 10000 : Number.MAX_SAFE_INTEGER);
      if (provider === 'curseforge' && page.total_hits > 10000) notices.add('CurseForge API 最多可浏览前 10000 个项目，请缩小筛选范围。');
    } catch(error) { fail(index,error); }
  }));
  signal?.throwIfAborted();
  for (;;) {
    if (!states.some(s=>s.status==='available'))
      throw new Error(states.map(s=>`${s.provider}: ${s.message}`).join('；'));
    const totals = states.map(s=>s.status==='available' ? s.total ?? 0 : 0);
    const total = totals[0]+totals[1], common = Math.min(...totals);
    const ranks: {source:number;rank:number}[] = [];
    for(let n=offset;n<Math.min(total,offset+limit);n++) {
      const source = n < common*2 ? n%2 : totals[0]>totals[1] ? 0 : 1;
      ranks.push({source,rank:n<common*2 ? Math.floor(n/2) : n-common});
    }
    const hits: SearchPage['hits'][] = [[],[]];
    let failed = false;
    await Promise.all(providers.map(async(provider,index)=>{
      const own = ranks.filter(r=>r.source===index);
      if(!own.length)return;
      try {
        // CF caps each request at 50 even when the combined page size is 100.
        for(let start=0;start<own.length;start+=50) {
          const page = await read(index,own[start].rank,Math.min(50,own.length-start));
          if (page.total_hits !== probedTotals[index] || page.hits.length !== Math.min(50,own.length-start))
            throw new SearchInvalidated();
          hits[index].push(...page.hits.map(h=>({...h,provider})));
        }
      } catch(error) {
        if (error instanceof SearchInvalidated) throw error;
        fail(index,error);failed=true;
      }
    }));
    signal?.throwIfAborted();
    if(failed)continue;
    const consumed=[0,0];
    return {hits:ranks.map(r=>hits[r.source][consumed[r.source]++]),offset,limit,total_hits:total,
      sources:states,mappingNotice:[...notices].join('；') || undefined};
  }
}
