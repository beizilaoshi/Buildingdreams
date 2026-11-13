import type {LocalMod,ModUpdate,ModBatchAction,ModBatchItem,ModBatchResult} from "../../shared/content";
import {api,selected,e,button,input,field,notify} from "../ui";
import {choice} from "./choice";
import {dialog} from "./dialog";
export function localMods() {
 const node=e("div","local-mods"),instance=selected();
 if(!instance){node.append(e("p","muted","请先在游戏库中选择实例。"));return node;}
 const id=instance.id;
 let mods:LocalMod[]=[], updates:ModUpdate[]=[], generation=0, busy=false;
 const selection=new Map<string,ModBatchItem>();
 const search=input("","搜索名称或文件名");search.type="search";
 const status=choice([["all","全部"],["enabled","已启用"],["disabled","已禁用"],["update","可更新"]],"all");status.setAttribute("aria-label","Mod 状态");
 const tools=e("div","local-mod-tools"), rows=e("div","local-mod-list"),summary=e("p","local-selection-summary muted"),report=e("div","local-operation-report"), checks=e("div","local-check-report");
 report.setAttribute("role","status");checks.setAttribute("role","status");
 const current=()=>node.isConnected && selected()?.id===id;
 const visible=()=>mods.filter(m=>(!search.value.trim() || `${m.name??""} ${m.fileName}`.toLowerCase().includes(search.value.trim().toLowerCase())) && (status.value==="all" || status.value==="enabled" && m.enabled || status.value==="disabled" && !m.enabled || status.value==="update" && updates.some(u=>u.fileName===m.fileName)));
 const render=()=>{
  rows.replaceChildren();const shown=visible();
  summary.textContent=`已选择 ${selection.size} 项 · 隐藏 ${[...selection.keys()].filter(name=>!shown.some(m=>m.fileName===name)).length} 项`;
  for(const mod of shown){
   const row=e("label","local-mod-card"),check=document.createElement("input");check.type="checkbox";check.checked=selection.has(mod.fileName);check.disabled=busy;check.setAttribute("aria-label",`选择 ${mod.fileName}`);
   check.onchange=()=>{if(check.checked)selection.set(mod.fileName,{fileName:mod.fileName,sha1:mod.sha1});else selection.delete(mod.fileName);render();};
   const detail=e("div","local-mod-detail");detail.append(e("strong","",mod.name??mod.fileName));
   if(mod.name)detail.append(e("span","muted",mod.fileName));
   const badges=e("div","row");
   for(const label of [mod.enabled?"已启用":"已禁用",mod.version,mod.loader,mod.provider??(mod.projectId?.startsWith("cf:")?"curseforge":mod.projectId?"modrinth":undefined),updates.some(u=>u.fileName===mod.fileName)?"可更新":undefined].filter(Boolean)) badges.append(e("span","badge",label));
   detail.append(badges);if(mod.parseWarning)detail.append(e("span","muted",mod.parseWarning));row.append(check,detail);rows.append(row);
  }
  if(!shown.length)rows.append(e("p","muted",mods.length?"没有匹配的 Mod。":"还没有安装 Mod。"));
  for(const b of Array.from(tools.querySelectorAll("button"))) (b as HTMLButtonElement).disabled=busy;
 };
 const showResults=(results:ModBatchResult[])=>{
  report.replaceChildren(e("h3","","逐项操作结果"));
  for(const r of results)report.append(e("p","",`${r.fileName}：${r.status==="completed"?"已完成":r.status==="failed"?"失败":"已跳过"}${r.error?` · ${r.error}`:""}`));
 };
 const load=async()=>{
  const request=++generation;const next=await api("mods.list",id);
  if(!current()||request!==generation)return;
  mods=next;
  // Never silently update a reviewed snapshot: stale selected entries stay stale until cleared.
  render();
 };
 const run=async(action:ModBatchAction,items:ModBatchItem[])=>{
  if(!current()||busy)return;busy=true;render();
  try{
   let results:ModBatchResult[];
   if(action==="update"){
    const taskId=await api("mods.batchUpdate",{instanceId:id,items});
    while(true){
     const tasks=await api("tasks.list",undefined),task=tasks.find(t=>t.id===taskId);
     if(task && ["completed","failed","cancelled"].includes(task.status)){
      results=(await api("mods.batchResult",taskId))??items.map(i=>({fileName:i.fileName,status:"skipped" as const,error:task.error??"任务未执行"}));break;
     }
     await new Promise(resolve=>setTimeout(resolve,180));
    }
   }else results=await api("mods.batch",{instanceId:id,action,items});
   if(!current())return;
   showResults(results);for(const r of results)if(r.status==="completed")selection.delete(r.fileName);
   updates=[];await load();
  }finally{busy=false;if(current())render();}
 };
 const confirm=(action:ModBatchAction)=>{
  if(!selection.size)throw new Error("请先选择 Mod");
  if(selection.size>200)throw new Error("最多选择 200 个 Mod");
  const verb={enable:"启用",disable:"禁用",remove:"移除",update:"更新"}[action];
  const items=[...selection.values()].map(item=>({...item,...(action==="update"?{versionId:updates.find(u=>u.fileName===item.fileName)?.version.id}: {})}));
  if(action==="update" && items.some(i=>!i.versionId))throw new Error("所选项中有不可更新文件，请先检查更新并选择可更新项");
  const body=e("div");body.append(e("p","",`将在 ${instance.name} 中${verb}以下 ${items.length} 个文件：`));
  const names=e("ul","local-confirm-files");for(const item of items)names.append(e("li","",item.fileName));body.append(names);
  const modal=dialog(`批量${verb} Mod`,body);
  body.append(button(`确认${verb}`,async()=>{modal.close();await run(action,items);},action==="remove"?"danger":"primary"));
 };
 tools.append(button("导入本地 Mod",async()=>{
  const picked=await api("dialog.chooseMods",undefined);if(!picked||!current())return;
  const body=e("div");body.append(e("p","",`导入到 ${instance.name}：`));for(const name of picked.names)body.append(e("p","",name));
  const modal=dialog("导入本地 Mod",body);
  body.append(button("确认导入",async()=>{
   modal.close();if(!current()||busy)return;busy=true;render();
   try{const result=await api("mods.importMany",{instanceId:id,selectionId:picked.selectionId});if(current()){showResults(result);await load();}}finally{busy=false;if(current())render();}
  },"primary"));
 },"quiet"),button("检查更新",async()=>{
  const request=++generation;const result=await api("mods.checkUpdatesDetailed",id);if(!current()||request!==generation)return;
  updates=result.updates;checks.replaceChildren(e("p","muted",`找到 ${updates.length} 项更新 · ${result.errors.length} 项检查失败`));
  for(const error of result.errors)checks.append(e("p","",`${error.fileName}：${error.error}`));render();
 },"quiet"),button("刷新列表",load,"quiet"),button("选择可见项",()=>{for(const m of visible())if(!selection.has(m.fileName))selection.set(m.fileName,{fileName:m.fileName,sha1:m.sha1});render();},"quiet"),button("清除选择",()=>{selection.clear();render();},"quiet"));
 for(const [action,title] of [["enable","批量启用"],["disable","批量禁用"],["remove","批量移除"],["update","批量更新"]] as const)tools.append(button(title,()=>confirm(action),action==="remove"?"danger":"quiet"));
 search.oninput=render;status.onchange=render;
 node.append(field("搜索本地 Mod",search),status,tools,summary,checks,report,rows);
 node.addEventListener("mods-refresh",()=>{void load().catch(notify);});
 void load().catch(notify);return node;
}
