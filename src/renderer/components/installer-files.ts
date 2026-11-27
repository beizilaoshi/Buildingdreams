import { api, e, panel, input, button, field, state } from '../ui';
import { choice } from './choice';
import type { InstallerSaveKind } from '../../shared/install-components';
export function installerFilesCard() {
    const node = panel('安装器与原版服务端', '只保存经过官方SHA1校验的文件，不运行安装器或服务端。Fabric / Quilt版本栏填写安装器版本，其他加载器填写加载器版本。');
    const kind = choice([['server','原版服务端'],['forge','Forge安装器'],['neoforge','NeoForge安装器'],['fabric','Fabric安装器'],['quilt','Quilt安装器']]);
    const minecraft = input('1.20.1'), version = input('');
    const status = e('p','muted','选择保存位置后，任务会将校验通过的文件写入该位置。旧版本没有服务端文件时明确失败。');
    const save = button('选择位置并保存文件', async () => { save.disabled = true; try { const result=await api('installers.save',{kind:kind.value as InstallerSaveKind,minecraft:minecraft.value.trim(),version:version.value.trim() || minecraft.value.trim()}); status.textContent=result?`保存任务已加入：${result.path}（任务 ${result.taskId}）`:'已取消保存'; } finally { save.disabled=false; } });
    const promotion = button('查询Forge推荐 / 最新', async () => { const result = await api('forge.promotions',{minecraft:minecraft.value.trim()}); status.textContent=`Forge 推荐：${result.recommended ?? '未发布'}；最新：${result.latest ?? '未发布'}`; if(result.recommended) version.value=result.recommended; });
    const log = button('Forge官方版本与更新日志', () => api('homeContent.openExternal',`https://files.minecraftforge.net/net/minecraftforge/forge/index_${encodeURIComponent(minecraft.value.trim())}.html`));
    node.append(field('文件类型',kind),field('Minecraft版本',minecraft),field('安装器 / 加载器版本',version),promotion,log,status,save); return node;
}
export function fabricExtrasCard() {
    const node = panel('Fabric选配组件','对所选Fabric实例安装Fabric API，使用现有Mod依赖解析、校验和事务。OptiFabric使用作者官方发布页；需自行匹配Minecraft、OptiFine与Fabric版本后，通过游戏库的本地Mod导入安装。');
    const instance=choice([], '', true), versions=choice([], '', true); let loaded='';
    const status=e('p','muted','OptiFabric没有本启动器可用的公开版本API，不会伪造可安装版本。OptiFine需另行取得，不能用普通OptiFine独立实例代替Fabric兼容组件。');
    const reset=()=>{loaded='';versions.setOptions([]);install.disabled=true;};
    const refresh=()=>{instance.setOptions(state.instances.filter(x=>x.loader?.kind==='fabric' && x.status==='ready').map(x=>({value:x.id,label:`${x.name} · ${x.minecraft}`})));reset();};
    const query=button('查询Fabric API',async()=>{reset(); const target=state.instances.find(x=>x.id===instance.value);if(!target)throw Error('请选择Fabric实例');const id=target.id; const rows=await api('content.versions',{projectId:'P7dR8mSH',filter:{minecraft:target.minecraft,loader:'fabric',projectType:'mod'}});if(instance.value!==id)return;loaded=id;versions.setOptions(rows.map(x=>({value:x.id,label:x.name})));install.disabled=!versions.value;status.textContent=rows.length?'选择实际版本后安装到所选实例。':'此Minecraft版本没有匹配的Fabric API。';});
    const install=button('安装所选Fabric API',async()=>{if(loaded!==instance.value || !versions.value)throw Error('请重新查询组件');await api('mods.install',{instanceId:instance.value,versionId:versions.value});status.textContent='Mod安装任务已加入；完成后可在游戏库Mod管理中查看。';});
    versions.onchange=()=>{install.disabled=loaded!==instance.value || !versions.value;};instance.onchange=reset;
    node.append(field('Fabric实例',instance),button('刷新Fabric实例',async()=>{state.instances=await api('instances.list',undefined);refresh();}),query,field('Fabric API版本',versions),install,button('打开OptiFabric作者发布页',()=>api('homeContent.openExternal','https://github.com/Chocohead/OptiFabric/releases')),status);refresh();return node;
}
