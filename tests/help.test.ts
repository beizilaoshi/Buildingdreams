import {it,expect} from 'vitest';
import {HELP_ARTICLES,searchHelp} from '../src/shared/help';
it('searches article content/tags and intersects category without losing original source',()=>{
 expect(searchHelp('JVM')[0].id).toBe('java');expect(searchHelp('Java','账号')).toEqual([]);
 expect(searchHelp('受限 文件').some(a=>a.id==='mods')).toBe(true);
 expect(searchHelp('unlikely-no-match')).toEqual([]);expect(searchHelp('')).toHaveLength(HELP_ARTICLES.length);
 expect(new Set(HELP_ARTICLES.map(a=>a.id)).size).toBe(HELP_ARTICLES.length);
});
