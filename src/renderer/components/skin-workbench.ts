import type { AccountSummary } from '../../shared/types';
import type { SkinSelection, SkinProfile } from '../../shared/skin';
import { api, e, button, field, refresh } from '../ui';
import { dialog } from './dialog';
import { drawSkinHead } from './avatar';
export function skinWorkbench(account: AccountSummary) {
    const body = e('div', 'skin-workbench'), status = e('p', 'muted', '正在获取皮肤…');
    status.setAttribute('role', 'status');
    const preview = document.createElement('img');
    preview.alt = '皮肤 PNG 纹理预览';
    preview.style.cssText = 'width:192px;image-rendering:pixelated;max-width:100%';
    const head = document.createElement('canvas');
    head.width = head.height = 8;
    head.style.cssText = 'width:80px;height:80px;image-rendering:pixelated';
    head.setAttribute('aria-label', '皮肤头像预览');
    const model = document.createElement('select');
    for (const [value, label] of [['classic', 'Classic · 宽手臂'], ['slim', 'Slim · 纤细手臂']]) {
        const o = new Option(label);
        o.value = value;
        model.append(o);
    }
    const modal = dialog('皮肤管理 · ' + account.name, body);
    let epoch = 0, busy = false, chosen: SkinSelection | undefined;
    const current = (generation: number) => modal.open && generation === epoch;
    const stop = () => { epoch++; window.removeEventListener('navigate', leave); };
    const leave = () => modal.close();
    window.addEventListener('navigate', leave);
    modal.addEventListener('close', stop, { once: true });
    const controls: HTMLButtonElement[] = [];
    const run = async (work: (generation: number) => Promise<void>) => { if (busy)
        return; busy = true; const generation = ++epoch; controls.forEach(b => b.disabled = true); try {
        await work(generation);
    }
    catch (err) {
        if (current(generation))
            status.textContent = String(err).replace(/^Error:\s*/, '');
    }
    finally {
        busy = false;
        if (current(generation)) {
            controls.forEach(b => b.disabled = false);
            apply.disabled = !chosen;
        }
    } };
    const show = async (png: string, generation: number) => { const image = new Image(); image.src = png; await image.decode(); if (!current(generation))
        return; preview.src = png; drawSkinHead(head, image); };
    const capes = e('div');
    const showProfile = (profile: SkinProfile) => { model.value = profile.model; capes.replaceChildren(e('p', 'muted', profile.capes.length ? '选择账号拥有的披风' : '此账号没有可用披风')); const select = document.createElement('select'); const none = new Option('不穿披风'); none.value = ''; select.append(none); for (const cape of profile.capes) {
        const o = new Option(cape.name);
        o.value = cape.id;
        o.selected = cape.active;
        select.append(o);
    } capes.append(field('披风', select), button('应用披风', () => run(async (g) => { const result = await api('accounts.skinCape', { id: account.id, capeId: select.value || null }); if (current(g)) {
        showProfile(result);
        status.textContent = '披风已更新';
    } }), 'quiet')); };
    const load = async (g: number, force = false) => { const result = await api(force ? 'accounts.skinRefresh' : 'accounts.appearance', account.id); if (!current(g))
        return; if (result.source !== 'default') {
        await show(result.png, g);
        if (result.source === 'custom')
            model.value = result.model;
        status.textContent = result.source === 'custom' ? '启动器自定义头像' : '正版皮肤';
    }
    else {
        preview.removeAttribute('src');
        head.getContext('2d')?.clearRect(0, 0, 8, 8);
        status.textContent = result.reason === 'unavailable' ? '皮肤暂不可用，请重试' : '当前使用默认头像';
    } if (account.kind === 'microsoft') {
        const profile = await api('accounts.skinProfile', account.id);
        if (current(g))
            showProfile(profile);
    } };
    const pick = button('选择 PNG', () => run(async (g) => { const result = await api('accounts.skinPick', undefined); if (!current(g) || !result)
        return; chosen = result; await show(result.png, g); status.textContent = '本地预览 · 尚未应用'; }), 'quiet');
    const apply = button(account.kind === 'local' ? '应用启动器头像' : '上传正版皮肤', () => run(async (g) => { if (!chosen)
        return; const value = { id: account.id, png: chosen.png, model: model.value as 'classic' | 'slim' }; if (account.kind === 'local')
        await api('accounts.skinLocal', value);
    else
        await api('accounts.skinUpload', value); if (!current(g))
        return; chosen = undefined; await refresh(); if (current(g)) {
        await load(g);
        status.textContent = account.kind === 'local' ? '启动器头像已保存' : '正版皮肤已上传';
    } }), 'primary');
    apply.disabled = true;
    const reload = button('刷新皮肤', () => run(async (g) => { chosen = undefined; await load(g, account.kind === 'microsoft'); }), 'quiet');
    const save = button('保存已应用皮肤 PNG', () => run(async (g) => { const saved = await api('accounts.skinSave', account.id); if (current(g))
        status.textContent = saved ? 'PNG 已保存' : '已取消保存'; }), 'quiet');
    controls.push(pick, apply, reload, save);
    body.append(e('p', 'muted', account.kind === 'local' ? '仅更改启动器头像和预览，不会改变游戏内皮肤。' : '上传将修改此 Microsoft 账号的 Java 版皮肤。'), head, preview, field('角色模型', model), status, pick, apply, reload, save, capes);
    if (account.kind === 'local') {
        const reset = button('恢复默认头像', () => run(async (g) => { await api('accounts.skinReset', account.id); chosen = undefined; await refresh(); if (current(g))
            await load(g); }), 'quiet');
        controls.push(reset);
        body.append(reset);
    }
    void run(g => load(g));
    return modal;
}
