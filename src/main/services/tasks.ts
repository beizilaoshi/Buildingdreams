import { randomUUID } from "node:crypto";
import type { TaskSnapshot } from "../../shared/types";

export interface TaskContext {
  /** Present for TaskService executions; optional for compatible standalone contexts. */
  readonly taskId?: string;
  signal: AbortSignal;
  report(progress: number, bytesPerSecond?: number): void;
}
export type TaskJob<T = unknown> = (context: TaskContext) => Promise<T>;
interface Entry {
  snapshot: TaskSnapshot;
  controller: AbortController;
  job: TaskJob;
  result: Promise<unknown>;
  retry?: () => string;
}
export class TaskService {
  private maintenanceOwner?: symbol;
  /** Short, main-only admission barrier for destructive maintenance. */
  exclusiveMaintenance(exceptTask?: string): () => void {
    if(this.maintenanceOwner || this.list().some(t=>t.id!==exceptTask && (t.status==='queued'||t.status==='running'))) throw Error('请等待活动任务或维护完成');
    const owner=Symbol();this.maintenanceOwner=owner;
    return ()=>{if(this.maintenanceOwner===owner)this.maintenanceOwner=undefined;};
  }
  private entries = new Map<string, Entry>();
  private listeners = new Set<(snapshot: TaskSnapshot) => void>();
  start<T>(label: string, job: TaskJob<T>, retry?: () => string, onSettled?: () => void): string {
    if(this.maintenanceOwner)throw Error('实例正在维护，请稍后开始任务');
    const id = randomUUID();
    const controller = new AbortController();
    const snapshot: TaskSnapshot = {
      id,
      label,
      status: "queued",
      progress: 0,
      bytesPerSecond: 0,
    };
    const entry: Entry = {
      snapshot,
      controller,
      job,
      retry,
      result: Promise.resolve(),
    };
    this.entries.set(id, entry);
    this.emit(entry);
    entry.result = Promise.resolve()
      .then(async () => {
        controller.signal.throwIfAborted();
        snapshot.status = "running";
        this.emit(entry);
        const result = await job({
          taskId: id,
          signal: controller.signal,
          report: (progress, rate = 0) => {
            snapshot.progress = Math.max(0, Math.min(1, progress));
            snapshot.bytesPerSecond = Math.max(0, rate);
            this.emit(entry);
          },
        });
        snapshot.status = "completed";
        snapshot.progress = 1;
        return result;
      })
      .catch((error) => {
        snapshot.status = controller.signal.aborted ? "cancelled" : "failed";
        snapshot.error = error instanceof Error ? error.message : String(error);
        throw error;
      })
      .finally(() => {
        onSettled?.();
        snapshot.bytesPerSecond = 0;
        this.emit(entry);
      });
    // IPC callers normally observe snapshots; retain the rejection for wait() without an unhandled rejection.
    void entry.result.catch(() => {});
    return id;
  }
  wait<T = unknown>(id: string): Promise<T> {
    return this.get(id).result as Promise<T>;
  }
  async cancel(id: string): Promise<void> {
    const entry = this.get(id);
    if (
      entry.snapshot.status === "queued" ||
      entry.snapshot.status === "running"
    )
      entry.controller.abort();
    await entry.result.catch(() => {});
  }
  retry(id: string): string {
    const entry = this.get(id);
    if (!["failed", "cancelled"].includes(entry.snapshot.status))
      throw new Error("只能重试失败或取消的任务");
    return entry.retry ? entry.retry() : this.start(entry.snapshot.label, entry.job);
  }
  list(): TaskSnapshot[] {
    return [...this.entries.values()].map((e) => ({ ...e.snapshot }));
  }
  onSnapshot(listener: (snapshot: TaskSnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private get(id: string): Entry {
    const entry = this.entries.get(id);
    if (!entry) throw new Error("任务不存在");
    return entry;
  }
  private emit(entry: Entry): void {
    for (const listener of this.listeners) {
      try {
        listener({ ...entry.snapshot });
      } catch {
        /* A detached UI must not fail a download. */
      }
    }
  }
}
