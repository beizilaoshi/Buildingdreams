import { api, state, e, field, input, button, go, notify } from '../ui';
import type { CommandMap, TaskSnapshot } from '../../shared/types';
import './install-target.css';
type Preview = CommandMap['install.preview']['result'];
const active = (task?: TaskSnapshot) => task?.status === 'queued' || task?.status === 'running';
// One process-wide listener, independent of transient download views.
const listeners = new Set<() => void>();
let draftRoot = '';
const known = new Map<string, TaskSnapshot>();
window.launcher.onTask(task => { known.set(task.id, task); for (const listener of listeners) listener(); });
export function installTarget(name: HTMLInputElement, changed: () => void) {
  const node = e('div', 'install-target');
  const root = input(draftRoot, '留空使用当前默认位置');
  const status = e('p', 'install-target-status muted'); status.setAttribute('role', 'status');
  const paths = e('div', 'install-target-paths');
  const actions = e('div', 'row');
  let preview: Preview | undefined, generation = 0, pending = true, submitting = false;
  let taskId: string | undefined, timer: ReturnType<typeof setTimeout> | undefined;
  let mounted = false, disposed = false;
  const update = () => { changed(); };
  const taskState = () => taskId ? known.get(taskId) ?? state.tasks.find(t => t.id === taskId) : undefined;
  const reconcile = async () => {
    const tasks = await api('tasks.list', undefined); tasks.forEach(t => known.set(t.id, t));
    if (taskState()?.status === 'completed') state.instances = await api('instances.list', undefined);
    update();
  };
  const library = button('前往游戏库', () => go('library'), 'quiet');
  const recover = button('导入此已完成安装', async () => {
    if (!preview?.recoverableDirectory) return;
    await api('instances.import', preview.recoverableDirectory);
    state.instances = await api('instances.list', undefined); await request(); notify('已导入游戏库');
  }, 'quiet');
  const choose = button('选择文件夹', async () => { const path = await api('dialog.choose', 'game'); if (path) { root.value = path; draftRoot = path; await request(); } }, 'quiet');
  const save = button('设为默认安装位置', async () => {
    if (!preview || pending) return;
    state.settings = await api('settings.patch', { gameDirectory: preview.installRoot }); notify('已保存默认安装位置');
  }, 'quiet');
  const request = async () => {
    if (timer) clearTimeout(timer);
    const current = ++generation; pending = true; preview = undefined; paths.replaceChildren(); update();
    status.textContent = '正在确认安装路径…'; recover.hidden = library.hidden = true;
    try {
      const result = await api('install.preview', { name: name.value, ...(root.value.trim() ? { root: root.value.trim() } : {}) });
      if (disposed || current !== generation) return;
      preview = result; taskId = result.activeTaskId;
      paths.append(e('p', '', `安装位置：${result.installRoot}`), e('p', '', `实例文件：${result.resourceDir}`), e('p', '', `独立游戏目录：${result.gameDir}`));
      status.textContent = result.recoverableDirectory ? '此位置有已完成但未登记的安装，请明确导入或更换名称/位置。' : result.existingDirectory ? '此名称的位置已经存在，请前往游戏库，或更换名称/安装位置。' : '版本隔离已开启 · 存档、Mods 与配置独立保存，不会移动旧数据。';
      library.hidden = !result.existingDirectory; recover.hidden = !result.recoverableDirectory;
      await reconcile();
    } catch (error) { if (current === generation) status.textContent = error instanceof Error ? error.message : String(error); }
    finally { if (current === generation) { pending = false; update(); } }
  };
  const schedule = () => { if (disposed) return; ++generation; pending = true; preview = undefined; update(); if (timer) clearTimeout(timer); timer = setTimeout(() => void request(), 220); };
  root.oninput = () => { draftRoot = root.value; schedule(); };
  actions.append(choose, save, library, recover);
  node.append(field('安装位置', root), actions, status, paths);
  const listener = () => {
    if (!node.isConnected) { if (mounted) { disposed = true; listeners.delete(listener); if (timer) clearTimeout(timer); observer.disconnect(); } return; }
    mounted = true;
    if (taskState()?.status === 'completed') void api('instances.list', undefined).then(items => { state.instances = items; });
    update();
    // Retry can create another ID; preview recovers it by the selected target.
    if (!submitting && !pending && !active(taskState())) void request();
  };
  listeners.add(listener);
  const observer = new MutationObserver(() => { if (node.isConnected) mounted = true; else if (mounted) listener(); });
  observer.observe(document.body, { childList: true, subtree: true });
  return {
    node, schedule, request,
    blocked: () => pending || submitting || !preview || Boolean(preview.existingDirectory) || active(taskState()),
    busy: () => submitting || active(taskState()),
    async submit(payload: Omit<CommandMap['install.vanilla']['payload'], 'root'>) {
      if (pending || submitting || !preview || preview.existingDirectory || active(taskState())) return;
      const captured = preview; submitting = true; update();
      try {
        const id = await api('install.vanilla', { ...payload, root: captured.installRoot }); taskId = id;
        await reconcile(); notify(active(taskState()) ? '已加入下载任务；相同位置的安装会合并为同一任务。' : taskState()?.status === 'completed' ? '安装完成，已加入游戏库' : '任务已结束，可在下载任务中重试');
      } finally { submitting = false; await request(); update(); }
    },
  };
}
