import { api, state, e, button, notify } from "../ui";
import { displayMessage } from "./feedback-store";
import type { TaskSnapshot } from "../../shared/types";
const labels: Record<TaskSnapshot["status"], string> = { queued: "等待中", running: "运行中", completed: "已完成", failed: "失败", cancelled: "已取消" };
const pending = new Set<string>();
interface Row { node: HTMLElement; title: HTMLElement; status: HTMLElement; progress: HTMLProgressElement; details: HTMLElement; error: HTMLElement; action: HTMLButtonElement }
const rows = new WeakMap<HTMLElement, Map<string, Row>>();

export function taskCards() {
  const list = e("div", "task-list"); rows.set(list, new Map()); updateList(list); return list;
}
export function updateTaskCards() { document.querySelectorAll<HTMLElement>(".task-list").forEach(updateList); }
function updateList(list: HTMLElement) {
  const cache = rows.get(list); if (!cache) return;
  list.querySelector(".task-empty")?.remove();
  for (const [id, row] of cache) if (!state.tasks.some(task => task.id === id)) { row.node.remove(); cache.delete(id); }
  for (const task of state.tasks.slice().reverse()) {
    let row = cache.get(task.id);
    if (!row) {
      const node = e("article", "glass task-card"); node.dataset.taskId = task.id;
      const top = e("div", "task-top"), title = e("strong"), status = e("span", "badge"); top.append(title, status);
      const progress = document.createElement("progress"); progress.max = 1;
      const details = e("p", "muted task-details"), error = e("p", "error task-error");
      const action = button("", async () => {
        if (pending.has(task.id)) return;
        const current = state.tasks.find(item => item.id === task.id); if (!current) return;
        const command = current.status === "queued" || current.status === "running" ? "tasks.cancel" : "tasks.retry";
        pending.add(task.id); updateTaskCards();
        try { await api(command, task.id); }
        catch (cause) { notify(cause instanceof Error ? cause : new Error("任务操作未完成，请重试。")); }
        finally { pending.delete(task.id); updateTaskCards(); }
      }, "quiet task-action");
      node.append(top, progress, details, error, action); row = { node, title, status, progress, details, error, action }; cache.set(task.id, row);
    }
    row.title.textContent = displayMessage(task.label); row.status.textContent = labels[task.status]; row.node.dataset.status = task.status;
    const progress = Number.isFinite(task.progress) ? Math.max(0, Math.min(1, task.progress)) : 0;
    row.progress.value = progress; row.progress.setAttribute("aria-label", `${displayMessage(task.label)}进度`);
    const rate = Number.isFinite(task.bytesPerSecond) ? Math.max(0, task.bytesPerSecond) : 0;
    row.details.textContent = `${Math.round(progress * 100)}%${task.status === "running" && rate > 0 ? ` · ${(rate / 1048576).toFixed(2)} MB/s` : ""}`;
    row.error.textContent = task.status === "failed" && task.error ? displayMessage(task.error) : ""; row.error.hidden = !row.error.textContent;
    const busy = pending.has(task.id); row.action.hidden = task.status === "completed";
    row.action.disabled = busy; row.action.textContent = busy ? "处理中…" : task.status === "queued" || task.status === "running" ? "取消任务" : "重试";
    // Insert only when the position changed; ordinary progress never detaches the focused row.
    const index = state.tasks.length - 1 - state.tasks.indexOf(task);
    if (list.children[index] !== row.node) list.insertBefore(row.node, list.children[index] ?? null);
  }
  if (!state.tasks.length) list.append(e("p", "muted task-empty", "暂无任务。安装、配置等操作的进度会显示在这里。"));
}
