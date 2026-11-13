import { api, account, state, e, button, notify, openAccounts } from '../ui';
import type { LaunchState } from '../../shared/types';
import { dialog } from './dialog';
import './launch-controls.css';
import { beginLaunchSnake, launchSnakeBusy } from './launch-snake';
const labels: Record<LaunchState['phase'], string> = { idle: '未由当前启动器启动', preparing: '正在准备启动', running: '游戏运行中', stopping: '正在停止', exited: '游戏已退出', failed: '启动失败', cancelled: '启动已取消' };
// Shared across mounted home/cards so rerenders cannot issue a second request.
const pending = new Set<string>();
function setPending(instanceId: string, value: boolean) {
    if (value) pending.add(instanceId);
    else pending.delete(instanceId);
    // Find only currently mounted controls; detached views retain no global subscription.
    for (const node of Array.from(document.querySelectorAll<HTMLElement>('.launch-controls'))) {
        if (node.dataset.instance === instanceId) node.dispatchEvent(new Event('launch-pending'));
    }
}
export function launchControls(instanceId: string, primaryClass = 'primary', onSelect?: () => void, onMissingAccount: () => unknown = openAccounts): HTMLElement {
    const node = e('div', 'launch-controls');
    node.dataset.instance = instanceId;
    let phase: LaunchState['phase'] = 'idle';
    let revision = 0;
    let ready = false;
    let stopPending = false;
    const status = e('p', 'muted');
    status.setAttribute('role', 'status');
    const paint = () => {
        const busy = ['preparing', 'running', 'stopping'].includes(phase);
        action.textContent = phase === 'preparing' ? '正在启动…' : phase === 'running' ? '游戏运行中' : phase === 'stopping' ? '正在停止…' : !ready ? '正在读取状态…' : pending.has(instanceId) ? '正在准备启动…' : '启动游戏';
        action.disabled = !ready || busy || pending.has(instanceId);
        stop.hidden = !busy;
        stop.disabled = stopPending || phase === 'stopping';
        stop.textContent = phase === 'preparing' ? '取消启动' : '停止游戏';
    };
    const update = (value: LaunchState) => {
        phase = value.phase; ready = true;
        status.textContent = labels[value.phase] + (value.pid ? ` · PID ${value.pid}` : '') + (value.error ? ' · ' + value.error : '');
        paint();
    };
    const action = button('正在读取状态…', async () => {
        if (action.disabled || launchSnakeBusy()) return;
        state.instanceId = instanceId; localStorage.setItem('instance', instanceId); onSelect?.();
        const identity = account();
        if (!identity) { notify('请先添加或登录账号'); onMissingAccount(); return; }
        const accountId = identity.id;
        setPending(instanceId, true); revision++; paint();
        const transition = beginLaunchSnake(instanceId);
        try {
            await api('launch.start', { instanceId, accountId });
        } catch (error) {
            await transition.reject();
            // Cancellation is reported by the lifecycle stream, not as a failed launch toast.
            if (phase !== 'cancelled' && phase !== 'stopping') notify(error);
        } finally {
            setPending(instanceId, false);
            const version = ++revision;
            try { const value = await api('launch.status', instanceId); if (revision === version) update(value); }
            catch (error) { notify(error); }
            paint();
        }
    }, primaryClass);
    const stop = button('停止游戏', async () => {
        if (stop.disabled || !['preparing', 'running'].includes(phase)) return;
        const command = phase === 'preparing' ? 'launch.cancel' : 'launch.stop';
        const previous = phase;
        stopPending = true; phase = 'stopping'; paint();
        const version = ++revision;
        try { const value = await api(command, instanceId); if (revision === version) update(value); }
        catch (error) { if (revision === version) phase = previous; throw error; }
        finally { stopPending = false; paint(); }
    }, 'quiet');
    node.addEventListener('launch-state', event => { revision++; update((event as CustomEvent<LaunchState>).detail); });
    node.addEventListener('launch-pending', paint);
    const version = revision;
    void api('launch.status', instanceId).then(value => { if (revision === version) update(value); }).catch(error => { ready = true; paint(); notify(error); });
    node.append(action, stop, status); paint();
    return node;
}
export function exportLaunchButton(instanceId: string): HTMLButtonElement {
    return button('导出启动脚本', () => {
        const body = e('div');
        body.append(e('p', '', '导出 Java 参数，不启动游戏、不下载 Java、不执行启动前命令。需要已安装的游戏、原生库和 Java。默认移除身份与令牌。'));
        const env = document.createElement('input');
        env.type = 'checkbox';
        env.setAttribute('aria-label', '运行时从环境变量读取身份');
        const label = e('label');
        label.append(env, document.createTextNode('运行时从 ZHUMENG_PLAYER_NAME / ZHUMENG_UUID / ZHUMENG_ACCESS_TOKEN 环境变量读取身份（脚本不会保存凭据）'));
        body.append(label);
        const modal = dialog('导出启动脚本', body);
        body.append(button('选择保存位置', async () => { const path = await api('launch.export', { instanceId, environment: env.checked }); if (path) {
            modal.close();
            notify('启动脚本已保存');
        } }, 'primary'));
    }, 'quiet');
}
