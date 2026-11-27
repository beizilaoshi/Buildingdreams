import { api, e, button, notify } from '../ui';
import { dialog } from './dialog';
import { choice } from './choice';

const size=(bytes:number)=>bytes<1024?`${bytes} B`:bytes<1024**2?`${(bytes/1024).toFixed(1)} KB`:bytes<1024**3?`${(bytes/1024**2).toFixed(1)} MB`:`${(bytes/1024**3).toFixed(2)} GB`;
export function worldBackupsView(id:string){
 const body=e('div','world-backups'),status=e('p','muted','正在读取存档…'),world=choice([], '', false, true),list=e('div','world-backup-list');world.setAttribute('aria-label','选择存档');
 const renderBackups=async()=>{
  const selected=world.value;if(!selected)return;list.replaceChildren(e('p','muted','正在读取备份…'));
  try{
   const backups=await api('worldBackups.list',{id,world:selected});list.replaceChildren();
   if(!backups.length){list.append(e('p','muted','此存档还没有备份。'));return;}
   for(const backup of backups){
    const card=e('article','world-backup-card');card.append(e('strong','',new Date(backup.createdAt).toLocaleString()),e('p','muted',`${backup.files.toLocaleString()} 个文件 · ${size(backup.bytes)}`));
    const actions=e('div','row');
    actions.append(button('恢复此备份',()=>{
     const confirmBody=e('div');confirmBody.append(e('p','',`将用此备份替换当前存档“${selected}”。`),e('p','muted','恢复前会自动备份当前进度；如果该世界已删除，将直接从备份还原。请先关闭从其他启动器启动的游戏。'));
     const confirm=dialog('确认恢复存档',confirmBody);
     confirmBody.append(button('确认恢复',async()=>{const saved=await api('worldBackups.restore',{id,world:selected,backupId:backup.id});confirm.close();notify(saved?`存档已恢复，恢复前进度已另存为 ${new Date(saved.createdAt).toLocaleString()} 的备份`:'存档已从备份恢复');await refresh();},'primary'));
    },'quiet'),button('删除备份',()=>{
     const confirmBody=e('div');confirmBody.append(e('p','',`确定删除 ${new Date(backup.createdAt).toLocaleString()} 的备份吗？`));
     const confirm=dialog('确认删除备份',confirmBody);
     confirmBody.append(button('确认删除',async()=>{await api('worldBackups.delete',{id,world:selected,backupId:backup.id});confirm.close();notify('备份已删除');await refresh();},'danger'));
    },'quiet'));
    card.append(actions);list.append(card);
   }
  }catch(error){list.replaceChildren(e('p','muted',String(error)));}
 };
 const refresh=async()=>{
  status.textContent='正在读取存档…';
  try{const [worlds,usage]=await Promise.all([api('worlds.list',id),api('worldBackups.usage',id)]);world.setOptions(worlds.map(value=>({value,label:value})),worlds.includes(world.value)?world.value:worlds[0]??'');list.replaceChildren();if(!worlds.length){status.textContent=`没有发现存档。启动游戏创建并保存世界后，可在此管理备份。当前占用 ${usage.backups} 份备份 · ${size(usage.bytes)}。`;return;}status.textContent=`找到 ${worlds.length} 个存档 · 共 ${usage.backups} 份备份，占用 ${size(usage.bytes)}。恢复时会自动先备份当前进度。`;await renderBackups();}
  catch(error){status.textContent=String(error);}
 };
 world.onchange=()=>void renderBackups();
 body.append(status,world,list,button('立即备份此存档',async()=>{if(!world.value)throw Error('请先选择存档');const backup=await api('worldBackups.create',{id,world:world.value});notify(`已创建备份：${size(backup.bytes)}`);await refresh();},'primary'),button('刷新存档列表',refresh,'quiet'));
 void refresh();return body;
}
