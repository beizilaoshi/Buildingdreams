import { api, state, e, button, panel, field, notify } from '../ui';
import { choice } from './choice';
import type { UpdateStatus } from '../../shared/types';
export function updateCard() {
    const card = panel('启动器更新', '自动检查 GitHub 公开发布；下载后由你手动安装。');
    card.dataset.updateCard = 'true';
    const status = e('p', 'muted', '正在读取版本…');
    status.setAttribute('role', 'status');
    const automatic = document.createElement('input');
    automatic.type = 'checkbox';
    automatic.checked = state.settings.checkUpdatesOnStartup;
    automatic.onchange = () => { void api('settings.patch', { checkUpdatesOnStartup: automatic.checked }).then(s => { state.settings = s; }).catch(notify); };
    const channel = choice([['preview', '预览版与稳定版'], ['stable', '仅稳定版']], state.settings.updateChannel);
    channel.setAttribute('aria-label', '更新渠道');
    channel.onchange = () => { void api('settings.patch', { updateChannel: channel.value as 'preview' | 'stable' }).then(s => { state.settings = s; status.textContent = '更新渠道已保存，请检查更新。'; release.hidden = true; download.hidden = true; }).catch(notify); };
    const draw = (s: UpdateStatus) => { status.textContent = `当前版本 ${s.currentVersion} · ${s.channel === 'preview' ? '预览渠道' : '稳定渠道'} · ${s.state === 'available' ? `发现新版本 ${s.latest?.version}` : s.state === 'current' ? '已是此渠道最新版本' : s.state === 'error' ? s.error : s.state === 'checking' ? '正在检查…' : '尚未检查'}`; release.hidden = !s.latest; download.hidden = !s.latest?.downloadUrl; };
    const check = button('检查更新', async () => { check.disabled = true; status.textContent = '正在检查更新…'; try {
        draw(await api('updates.check', undefined));
    }
    finally {
        check.disabled = false;
    } });
    const release = button('查看发布说明 ↗', () => api('updates.open', 'release'), 'text-button');
    release.hidden = true;
    const download = button('下载新版本 ↗', () => api('updates.open', 'download'), 'primary');
    download.hidden = true;
    card.append(field('启动时自动检查更新', automatic), field('更新渠道', channel), status, check, release, download);
    void api('updates.status', undefined).then(draw).catch(() => { status.textContent = '暂时无法读取更新状态'; });
    const timer = setInterval(() => { if (!card.isConnected) {
        clearInterval(timer);
        return;
    } void api('updates.status', undefined).then(draw).catch(() => { }); }, 2000);
    return card;
}
