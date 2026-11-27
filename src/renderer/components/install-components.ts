import { api, e, panel, input, button, field, notify, state } from '../ui';
import { choice } from './choice';
import type { InstallComponentKind, ComponentVersion } from '../../shared/install-components';
export function installComponentsCard() {
    const node = panel('OptiFine / LiteLoader', '可单独查询和保存安装器，或基于游戏库中的原版创建独立实例。支持1.7.10–1.12.2 Forge组合；OptiFine须声明匹配的Forge精确版本。');
    const minecraft = input('1.20.1', 'Minecraft 版本');
    const kind = choice([['optifine', 'OptiFine'], ['liteloader', 'LiteLoader']]);
    const version = choice([], '', true);
    const instances = choice([], '', true);
    const status = e('p', 'muted', 'OptiFine 为作者专有软件；下载源 BMCLAPI 镜像。OptiFine 未提供发布者摘要，会保留来源和本地 SHA256 记录。安装会运行所选安装器中的 Java 修补代码。LiteLoader 使用镜像发布的历史 MD5 校验。');
    let rows: ComponentVersion[] = [];
    let busy = false;
    let generation = 0;
    let loaded = '';
    const currentKey = () => `${kind.value}:${minecraft.value.trim()}`;
    const update = () => { save.disabled = busy || !version.value || loaded !== currentKey(); install.disabled = save.disabled || !instances.value; query.disabled = busy; };
    const reset = () => { generation++; rows = []; loaded = ''; version.setOptions([]); update(); };
    minecraft.oninput = reset;
    kind.onchange = reset;
    const query = button('查询组件版本', async () => { const token = ++generation; busy = true; update(); try {
        const key = currentKey();
        const result = await api('components.versions', { kind: kind.value as InstallComponentKind, minecraft: minecraft.value.trim() });
        if (token !== generation)
            return;
        rows = result;
        loaded = key;
        version.setOptions(rows.map(x => ({ value: x.id, label: `${x.id}${x.stable ? '' : ' · 预览/快照'}${x.forge ? ' · ' + x.forge : ''}` })));
        status.textContent = result.length ? '选择版本后可保存安装器或创建独立实例。' : '该游戏版本未找到此组件。';
    }
    catch (err) {
        if (token === generation) {
            loaded = '';
            notify(err);
        }
    }
    finally {
        busy = false;
        update();
    } });
    const selection = () => ({ kind: kind.value as InstallComponentKind, minecraft: minecraft.value.trim(), version: version.value });
    const save = button('保存安装器', async () => { busy = true; update(); try {
        await api('components.save', selection());
        status.textContent = '保存任务已加入；任务标题包含保存目录。';
    }
    finally {
        busy = false;
        update();
    } });
    const install = button('安装为独立实例', async () => { busy = true; update(); try {
        await api('components.install', { ...selection(), instanceId: instances.value });
        status.textContent = '组件安装任务已加入；成功后新实例出现在游戏库，游戏目录从空目录开始。';
    }
    finally {
        busy = false;
        update();
    } }, 'primary');
    version.onchange = update;
    instances.onchange = update;
    const refreshInstances = () => { instances.setOptions(state.instances.filter(x => (!x.loader || x.loader.kind === 'forge') && x.status === 'ready').map(x => ({ value: x.id, label: `${x.name} · ${x.minecraft}` }))); update(); };
    const refresh = button('刷新可用实例', async () => { state.instances = await api('instances.list', undefined); refreshInstances(); });
    node.append(field('组件', kind), field('Minecraft 版本', minecraft), query, field('组件版本', version), field('用于创建独立实例的原版 / Forge', instances), refresh, status, save, install);
    refreshInstances();
    return node;
}
