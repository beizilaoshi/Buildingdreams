import { choice } from './choice';
import type { Instance } from '../../shared/types';
import { api, state, e, button, field, input, refresh, notify, persistFavorite, go } from '../ui';
import { dialog } from './dialog';
import { launchSettingsCard } from './launch-settings';
import { exportLaunchButton } from './launch-controls';
import { openInstanceFileBrowser } from './instance-file-browser';

export function instanceWorkspace(item: Instance, changed: () => void): HTMLElement {
  const body=e('div','instance-workspace');
  let deletionGeneration=0;
  const name=input(item.name), description=document.createElement('textarea'), category=input(item.category ?? ''), displayType=choice([['auto','自动'],['normal','常规'],['mod','Mod'],['uncommon','不常用'],['fool','愚人节'],['hidden','隐藏']],item.displayType??'auto');
  displayType.setAttribute('aria-label','版本显示分类');
  description.value=item.description ?? '';description.rows=3;
  name.maxLength=120;description.maxLength=2000;category.maxLength=80;
  const fields=e('section','instance-workspace-card');
  fields.append(e('h3','','个性化'),field('游戏名称',name),field('游戏说明',description),field('游戏分类',category),field('版本显示分类',displayType),button('保存游戏信息',async()=>{
    const updated=await api('instances.metadata',{id:item.id,metadata:{name:name.value,description:description.value,category:category.value,displayType:displayType.value as Instance['displayType']}});
    state.instances=state.instances.map(x=>x.id===item.id?updated:x);await refresh();changed();notify('版本信息已保存');
  },'primary'));
  fields.append(button(state.favorites.has(item.id)?'★ 已收藏':'☆ 加入收藏',async()=>{await persistFavorite(item.id);await refresh();changed();},'quiet'));
  const cover=e('section','instance-workspace-card instance-cover-settings'),coverPreview=e('div','instance-cover-preview');
  cover.append(e('h3','','版本封面'),e('p','muted','游戏库卡片使用这里的封面图；卡片标题和说明可在上方编辑。支持 PNG，最大 8 MB、4096 × 4096 像素。'));
  const paintCover=(url:string|null)=>{coverPreview.replaceChildren();if(url){const image=document.createElement('img');image.src=url;image.alt='当前自定义版本封面预览';coverPreview.append(image);}else coverPreview.append(e('span','muted','当前使用筑梦默认封面'));};
  void api('instances.cover',item.id).then(paintCover).catch(()=>paintCover(null));
  const clearCover=button('恢复默认封面',async()=>{const updated=await api('instances.clearCover',item.id);item.cover=undefined;state.instances=state.instances.map(x=>x.id===item.id?updated:x);await refresh();changed();paintCover(null);clearCover.hidden=true;notify('已恢复默认封面');},'quiet');
  clearCover.hidden=!item.cover;
  cover.append(coverPreview,button('选择封面图片',async()=>{const updated=await api('instances.chooseCover',item.id);if(!updated)return;item.cover=updated.cover;clearCover.hidden=false;state.instances=state.instances.map(x=>x.id===item.id?updated:x);await refresh();changed();paintCover(await api('instances.cover',item.id));notify('版本封面已更新');},'primary'),clearCover);
  const folders=e('section','instance-workspace-card');folders.append(e('h3','','游戏文件'),button('打开存档管理页面',()=>{body.closest('dialog')?.close();state.instanceId=item.id;localStorage.setItem('instance',item.id);go('instanceSaves');},'primary'));
  const links=e('div','row');
  for(const [folder,label] of [['version','版本文件夹'],['root','游戏数据目录'],['saves','存档'],['mods','Mod 文件夹'],['resourcepacks','资源包'],['screenshots','截图']] as const)
    links.append(button(label,()=>openInstanceFileBrowser(item.id,folder),'quiet'));
  folders.append(links,button('选择自定义图标',async()=>{if(await api('instances.chooseIcon',item.id)){await refresh();changed();notify('游戏图标已更新');}},'quiet'));
  if(item.icon)folders.append(button('恢复自动图标',async()=>{await api('instances.clearIcon',item.id);await refresh();changed();notify('已恢复自动图标');},'quiet'));
  const settings=e('section','instance-workspace-card');settings.append(e('h3','','设置'),e('p','muted','设置仅作用于当前版本；窗口、内存、语言、服务器和启动选项可以覆盖全局值。'));
  const pathKey=(path:string)=>path.replace(/[\\/]+$/,'').toLowerCase();
  const sharedPath=pathKey(item.resourceDir), isolatedPath=pathKey(`${item.resourceDir}/versions/${item.versionId}`), currentPath=pathKey(item.gameDir);
  const customDirectory=item.gameDirMode==='custom'||(item.gameDirMode===undefined&&currentPath!==sharedPath&&currentPath!==isolatedPath);
  const isolationValue=customDirectory?'custom':item.gameDirMode==='shared'?'off':item.gameDirMode==='isolated'?'on':currentPath===isolatedPath?'on':'off';
  const isolation=choice([['on','开启'],['off','关闭'],...(customDirectory?[['custom',`自定义目录 · ${item.gameDir}`] as [string,string]]:[])],isolationValue);isolation.setAttribute('aria-label','版本隔离');
  settings.append(field('版本隔离',isolation),e('p','muted',customDirectory?'当前使用自定义游戏数据目录。切换隔离前请确认目标目录中是否已有存档、Mod 和配置；选择“自定义目录”可保持现状。':'切换只改变此版本使用的数据目录，不会搬动或覆盖已有存档、Mod 和配置文件；关闭后使用共享游戏目录。'));
  settings.append(button('应用版本隔离设置',()=>{if(isolation.value==='custom'){notify('已保留当前自定义数据目录');return;}const enabled=isolation.value==='on',target=enabled?`${item.resourceDir}/versions/${item.versionId}`:item.resourceDir;if(pathKey(target)===currentPath){notify(enabled?'当前已使用此版本的数据目录':'当前已使用共享游戏目录');return;}const confirmation=e('div');confirmation.append(e('p','',`游戏数据目录将从：${item.gameDir}`),e('p','',`切换到：${target}`),e('p','muted','切换只改变启动时使用的目录，不会复制、覆盖或删除存档、Mod 和配置文件；旧目录中的内容会保留，但不会自动出现在新目录中。'));const modal=dialog('确认版本隔离设置',confirmation);confirmation.append(button('确认切换',async()=>{const updated=await api('instances.isolation',{id:item.id,isolated:enabled});item.gameDir=updated.gameDir;item.gameDirMode=updated.gameDirMode;state.instances=state.instances.map(x=>x.id===item.id?updated:x);await refresh();changed();modal.close();notify(enabled?'已开启版本隔离':'已关闭版本隔离');},'primary'));},'quiet'));
  settings.append(launchSettingsCard(item.id),button('Java 与内存详细设置',()=>{body.closest('dialog')?.close();state.instanceId=item.id;localStorage.setItem('instance',item.id);go('settings');},'quiet'));
  const modifications=e('section','instance-workspace-card');modifications.append(e('h3','','修改版本'),e('p','muted',`Minecraft ${item.minecraft} · ${item.loader?`${item.loader.kind} ${item.loader.version}`:'原版'}`));
  const loaderKind=choice([['fabric','Fabric'],['quilt','Quilt'],['forge','Forge'],['neoforge','NeoForge']],item.loader?.kind??'fabric');
  const loaderVersion=choice([], '', true),loaderStatus=e('p','muted','查询与当前 Minecraft 兼容的加载器版本。');
  const queryLoaders=button('查询加载器版本',async()=>{loaderStatus.textContent='正在查询…';const rows=await api('loaders.versions',{kind:loaderKind.value as 'fabric'|'quilt'|'forge'|'neoforge',minecraft:item.minecraft});loaderVersion.setOptions(rows.map(row=>({value:row.version,label:row.version+(row.stable?'':' · 预览版')})));loaderStatus.textContent=rows.length?`找到 ${rows.length} 个兼容版本。`:'没有找到兼容版本。';},'quiet');
  loaderKind.onchange=()=>{loaderVersion.setOptions([]);loaderStatus.textContent='请重新查询此加载器的兼容版本。';};
  modifications.append(field('加载器',loaderKind),queryLoaders,field('加载器版本',loaderVersion),loaderStatus,button(item.loader?'替换加载器':'安装加载器',async()=>{if(!loaderVersion.value)throw Error('请先选择加载器版本');const confirm=e('div');confirm.append(e('p','',item.loader?`将为 ${item.name} 把 ${item.loader.kind} 替换为 ${loaderKind.value} ${loaderVersion.value}。当前资源目录会保留，安装完成并校验后才切换；Mod 与游戏数据目录不会迁移。`:`将为 ${item.name} 安装 ${loaderKind.value} ${loaderVersion.value}。`));const modal=dialog('确认修改版本',confirm);confirm.append(button('开始安装',async()=>{await api('loaders.install',{instanceId:item.id,kind:loaderKind.value as 'fabric'|'quilt'|'forge'|'neoforge',version:loaderVersion.value});modal.close();notify('加载器安装任务已创建，请查看任务面板');},'primary'));},'primary'));
  if(item.loader)modifications.append(button('切换到已安装的原版',()=>{const confirm=e('div');confirm.append(e('p','','将把此实例的启动配置切换到已安装的原版版本。加载器配置、Mod 和游戏文件会保留；此操作不会删除任何文件。'));const modal=dialog('切换到原版',confirm);confirm.append(button('切换',async()=>{const updated=await api('instances.useVanilla',item.id);state.instances=state.instances.map(x=>x.id===item.id?updated:x);item.versionId=updated.versionId;delete item.loader;await refresh();changed();modal.close();notify('已切换到原版，加载器文件仍保留');},'primary'));},'quiet'));
  const modManagement=e('section','instance-workspace-card');modManagement.append(e('h3','','Mod 管理'),e('p','muted','禁用会将文件重命名为 .jar.zhumeng，启用时恢复原始 .jar 文件名。'),button('打开 Mod 管理页面',()=>{body.closest('dialog')?.close();state.instanceId=item.id;localStorage.setItem('instance',item.id);go('instanceMods');},'primary'));
  const exportPack=e('section','instance-workspace-card');exportPack.append(e('h3','','导出'),e('p','muted','导出整合包时可以选择本地覆盖文件；存档、日志默认排除。'),button('整合包导出选项',()=>{const owner=body.closest('dialog');owner?.close();state.instanceId=item.id;localStorage.setItem('instance',item.id);go('packs');},'quiet'),exportLaunchButton(item.id));
  const repair=e('section','instance-workspace-card');
  repair.append(e('h3','','检查与修复'),e('p','muted',item.loader?'完整修复暂不支持加载器实例；导出的日志可用于手动排查。':'从官方来源校验并补全原版必需资源，进度显示在任务面板。'),button('修复游戏文件',async()=>{await api('instances.repair',item.id);notify('修复任务已创建，请查看任务面板');},'quiet'));
  const components=e('p','muted','读取游戏组件…');repair.append(components);
  void api('instances.components',item.id).then(result=>{components.textContent=`Minecraft ${result.minecraft} · ${result.components.join('、')||'原版'}`;}).catch(()=>{components.textContent='组件信息暂不可用';});
  const removal=e('section','instance-workspace-card');removal.append(e('h3','','移除与删除'),e('p','muted','移除只取消游戏库登记；删除会将拥有管理权限的实例文件移至回收站。'));
  removal.append(button('从游戏库移除',()=>{
    const confirm=e('div');confirm.append(e('p','','磁盘文件会保留，可以再次导入。'));
    const modal=dialog('从游戏库移除',confirm);
    confirm.append(button('确认移除',async()=>{await api('instances.unregister',item.id);await refresh();modal.close();changed();notify('已从游戏库移除，磁盘文件保留');},'primary'));
  },'quiet'),button('删除游戏文件',async()=>{
    const generation=++deletionGeneration;
    const owner=body.closest('dialog');
    const page=state.page;
    // The main process enforces ownership; imported/shared roots never become deletable through UI.
    const plan=await api('instances.deletePlan',item.id), content=e('div');
    if(generation!==deletionGeneration||!body.isConnected||!owner?.open||state.page!==page)return;
    content.append(e('p','','下列实例目录将移至回收站；请先关闭所有从其他启动器启动的相关游戏。'),e('pre','logs',plan.paths.join('\n')));
    const checked=document.createElement('input');checked.type='checkbox';
    content.append(field('我已关闭所有相关外部游戏',checked));
    const modal=dialog('确认删除游戏文件',content);
    const remove=button('移至回收站',async()=>{await api('instances.delete',{token:plan.token,externalGamesClosed:checked.checked});await refresh();modal.close();changed();notify('游戏文件已移至回收站');},'primary');
    remove.disabled=true;checked.onchange=()=>{remove.disabled=!checked.checked;};content.append(remove);
  },'quiet'));
  const authentication=e('section','instance-workspace-card'), authStatus=e('p','account-error');authStatus.setAttribute('role','alert');
  const authChoice=choice([['any','不限认证方式']],item.authentication?.kind==='external'?item.authentication.serverId:'any');authChoice.setAttribute('aria-label','实例认证方式');
  const authSave=button('保存实例认证策略',async()=>{authSave.disabled=true;authStatus.textContent='';try{const policy=authChoice.value==='any'?{kind:'any' as const}:{kind:'external' as const,serverId:authChoice.value};const updated=await api('instances.authentication',{id:item.id,authentication:policy});item.authentication=updated.authentication;await refresh();notify('实例认证策略已保存');}catch(error){authStatus.textContent=String(error).replace(/^Error:\s*/,'');}finally{authSave.disabled=false;}},'quiet');authSave.disabled=true;
  authentication.append(e('h3','','实例认证'),e('p','muted','可将此游戏限制为指定外置服务器账户。启动时会验证，其他账号不能绕过此设置。'),field('允许的认证服务器',authChoice),authSave,authStatus);
  void api('external.servers',undefined).then(servers=>{const auth=item.authentication;const options=[{value:'any',label:'不限认证方式'},...servers.map(s=>({value:s.id,label:s.name+' · '+s.url}))];if(auth?.kind==='external'&&!servers.some(s=>s.id===auth.serverId))options.push({value:auth.serverId,label:'已移除的认证服务器（请重新选择）'});authChoice.setOptions(options,item.authentication?.kind==='external'?item.authentication.serverId:'any');authSave.disabled=false;}).catch(error=>{authStatus.textContent=String(error).replace(/^Error:\s*/,'');});
  body.append(fields,cover,folders,settings,modifications,modManagement,exportPack,authentication,repair,removal);return body;
}

export async function directoryWorkspace(changed: () => void):Promise<void> {
  const content=e('div','instance-workspace'), modal=dialog('管理游戏目录',content);
  const render=async()=>{
    const directories=await api('directories.list',undefined);if(!modal.isConnected)return;
    content.replaceChildren(e('p','muted','目录映射不会移动文件。移除映射会移除该目录中的游戏登记，原文件保留。'));
    if(!directories.length)content.append(e('p','','尚未导入游戏目录。'));
    for(const directory of directories){
      const card=e('section','instance-workspace-card'),name=input(directory.name);
      card.append(e('p','game-data-path',directory.path),field('目录显示名称',name));
      card.append(button('保存目录名称',async()=>{await api('directories.rename',{id:directory.id,name:name.value});notify('目录名称已保存');},'quiet'),button('重新扫描目录',async()=>{await api('directories.scan',directory.id);await refresh();changed();notify('目录扫描完成');},'quiet'),button('移除目录映射',()=>{
        const confirmation=e('div');confirmation.append(e('p','','此目录中的游戏将从游戏库移除，磁盘文件保留。'),e('p','game-data-path',directory.path));
        const confirm=dialog('移除目录映射',confirmation);
        confirmation.append(button('确认移除映射',async()=>{await api('directories.remove',directory.id);await refresh();confirm.close();changed();await render();notify('目录映射已移除，文件保留');},'primary'));
      },'quiet'));content.append(card);
    }
    content.append(button('导入游戏目录',async()=>{const path=await api('dialog.choose','game');if(!path)return;await api('instances.import',path);await refresh();changed();await render();notify('游戏目录已导入');},'primary'));
  };
  try{await render();}catch(error){modal.close();throw error;}
}
