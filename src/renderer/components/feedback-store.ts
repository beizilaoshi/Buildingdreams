import type { TaskSnapshot } from "../../shared/types";
export type NoticeKind = "success" | "info" | "warning" | "error";
export interface NoticeOptions { kind?: NoticeKind; title?: string }
export interface Notice { id: number; kind: NoticeKind; title: string; message: string; at: number }
/** UI text only: never echo structured server bodies or common credential fields. */
export function displayMessage(value: unknown): string {
  let text = value instanceof Error ? value.message : typeof value === "string" ? value : "操作未完成，请重试。";
  text = text.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, "");
  if (/<[!?/A-Za-z][^>]*>/.test(text) || /^\s*[\[{]/.test(text) || /\{\s*"|\[\s*["{]/.test(text)) return "服务返回了无法显示的响应，请重试。";
  text = text.replace(/(?:authorization\s*:\s*)?(?:Bearer|Basic)\s+\S+/gi, "[凭据已隐藏]")
    .replace(/((?:access[_-]?token|refresh[_-]?token|token|password|secret|api[_-]?key|x-api-key)["']?\s*[=:]\s*)(?:"[^"]*"|'[^']*'|[^\s,;&]+)/gi, "$1[已隐藏]")
    .replace(/https?:\/\/[^\s]+/gi, (url) => { try { const parsed = new URL(url); return `${parsed.origin}${parsed.pathname}`; } catch { return "[链接]"; } })
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  return text.length > 600 ? `${text.slice(0, 600)}…` : text;
}
const titles: Record<NoticeKind, string> = { success: "操作完成", info: "提示", warning: "请留意", error: "操作未完成" };
interface Expiry { remaining: number; started: number; reasons: Set<string>; timer?: ReturnType<typeof setTimeout> }
export class FeedbackStore {
  records: Notice[] = [];
  toasts: Notice[] = [];
  private nextId = 0;
  private expiries = new Map<number, Expiry>();
  private listeners = new Set<() => void>();
  subscribe(listener: () => void) { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; }
  private changed() { for (const listener of this.listeners) listener(); }
  notify(value: unknown, options: NoticeOptions = {}): number {
    const kind = options.kind ?? (value instanceof Error ? "error" : "info");
    const message = displayMessage(value), title = displayMessage(options.title ?? titles[kind]).slice(0, 80), at = Date.now();
    const duplicate = this.records.find(item => item.kind === kind && item.title === title && item.message === message && at - item.at < 2000);
    if (duplicate) return duplicate.id;
    const item = { id: ++this.nextId, kind, title, message, at };
    this.records = [item, ...this.records].slice(0, 30); this.toasts.unshift(item);
    while (this.toasts.length > 3) this.removeToast(this.toasts.at(-1)!.id);
    // Errors stay long enough to be read, then leave like everything else: nothing may pile up forever.
    const lifetime = kind === "error" ? 12000 : 6500;
    this.expiries.set(item.id, { remaining: lifetime, started: at, reasons: new Set() }); this.schedule(item.id);
    this.changed(); return item.id;
  }
  private schedule(id: number) {
    const expiry = this.expiries.get(id); if (!expiry || expiry.reasons.size) return;
    expiry.started = Date.now(); expiry.timer = setTimeout(() => this.dismiss(id), expiry.remaining);
  }
  private removeToast(id: number) {
    clearTimeout(this.expiries.get(id)?.timer); this.expiries.delete(id); this.toasts = this.toasts.filter(item => item.id !== id);
  }
  dismiss(id: number) { this.removeToast(id); this.changed(); }
  pause(id: number, reason: "hover" | "focus", paused: boolean) {
    const expiry = this.expiries.get(id); if (!expiry || expiry.reasons.has(reason) === paused) return;
    if (paused) {
      if (!expiry.reasons.size) { clearTimeout(expiry.timer); expiry.timer = undefined; expiry.remaining = Math.max(0, expiry.remaining - (Date.now() - expiry.started)); }
      expiry.reasons.add(reason);
    } else { expiry.reasons.delete(reason); if (!expiry.reasons.size) this.schedule(id); }
  }
  clear() { this.records = []; this.changed(); }
  dispose() { for (const expiry of this.expiries.values()) clearTimeout(expiry.timer); this.expiries.clear(); this.toasts = []; this.listeners.clear(); }
}
export class TaskTransitions {
  private seen = new Map<string, TaskSnapshot["status"]>();
  private terminal = new Set<string>();
  bootstrap(tasks: TaskSnapshot[]) { for (const task of tasks) { this.seen.set(task.id, task.status); if (!["queued", "running"].includes(task.status)) this.terminal.add(task.id); } }
  accept(task: TaskSnapshot): NoticeOptions | undefined {
    const before = this.seen.get(task.id); this.seen.set(task.id, task.status);
    if (before === task.status || task.status === "queued" || task.status === "running" || this.terminal.has(task.id)) return;
    this.terminal.add(task.id);
    return { kind: task.status === "completed" ? "success" : task.status === "failed" ? "error" : "warning", title: { completed: "任务已完成", failed: "任务失败", cancelled: "任务已取消" }[task.status] };
  }
}
