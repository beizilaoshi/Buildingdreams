import {HELP_ARTICLES,searchHelp} from '../../shared/help';
import {e,button,input,api,notify} from '../ui';
import {dialog} from './dialog';
export function showHelp():void{
 const body=e('div','stack'),search=input('','搜索帮助，例如 Java、崩溃、整合包');search.setAttribute('aria-label','搜索帮助');
 const categories=document.createElement('select');categories.setAttribute('aria-label','帮助分类');
 for(const name of ['全部',...new Set(HELP_ARTICLES.map(a=>a.category))]){const option=document.createElement('option');option.value=name;option.textContent=name;categories.append(option);}
 const controls=e('div','row wrap');controls.append(search,categories);
 const results=e('div','stack'),detail=e('div','stack');
 const render=()=>{detail.replaceChildren();results.hidden=false;results.replaceChildren();const found=searchHelp(search.value,categories.value);if(!found.length)results.append(e('p','muted','没有匹配的帮助，请尝试更短的关键词。'));
  for(const article of found){const card=e('section','glass card');card.append(button(article.title,()=>{results.hidden=true;detail.replaceChildren(button('返回帮助列表',()=>{detail.replaceChildren();results.hidden=false;},'quiet'),e('h3','',article.title),...article.paragraphs.map(p=>e('p','',p)));},'quiet'),e('p','muted',article.category+' · '+article.tags.join(' / ')));results.append(card);}
 };
 search.oninput=render;categories.onchange=render;body.append(controls,results,detail);
 const support=e('div','row wrap');support.append(button('复制运行环境',async()=>{await api('app.copySupportInfo',undefined);notify('运行环境已复制，不包含账号与本地路径');},'quiet'),button('提交问题 ↗',()=>api('app.openFeedback',undefined),'quiet'));body.append(support);render();dialog('帮助与支持',body);
}
