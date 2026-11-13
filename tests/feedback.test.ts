import { afterEach, describe, expect, it, vi } from "vitest";
import { FeedbackStore, TaskTransitions, displayMessage } from "../src/renderer/components/feedback-store";
import type { TaskSnapshot } from "../src/shared/types";

const task = (status: TaskSnapshot["status"], id = "one"): TaskSnapshot => ({ id, status, label: "Fixture task", progress: 0.2, bytesPerSecond: 128 });
afterEach(() => vi.useRealTimers());
describe("session feedback lifecycle", () => {
  it("bounds newest-first history and visible toasts independently; errors expire like other toasts", () => {
    vi.useFakeTimers(); const store = new FeedbackStore();
    for (let i = 0; i < 35; i++) store.notify(`item ${i}`, { kind: "error" });
    expect(store.records).toHaveLength(30); expect(store.records[0].message).toBe("item 34");
    expect(store.toasts).toHaveLength(3);
    vi.advanceTimersByTime(12000); expect(store.toasts).toHaveLength(0); expect(store.records).toHaveLength(30);
    store.notify("kept", { kind: "warning" });
    store.dismiss(store.toasts[0].id); expect(store.toasts).toHaveLength(0); expect(store.records).toHaveLength(30);
    store.clear(); expect(store.records).toHaveLength(0); expect(store.toasts).toHaveLength(0);
    store.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("expires at 6500ms of unpaused time, resumes only after hover AND focus clear", () => {
    vi.useFakeTimers(); const store = new FeedbackStore(); const id = store.notify("saved", { kind: "success" });
    vi.advanceTimersByTime(1000); store.pause(id, "hover", true); store.pause(id, "focus", true);
    vi.advanceTimersByTime(9000); store.pause(id, "focus", false); vi.advanceTimersByTime(9000);
    expect(store.toasts).toHaveLength(1); store.pause(id, "hover", false);
    vi.advanceTimersByTime(5499); expect(store.toasts).toHaveLength(1); vi.advanceTimersByTime(1); expect(store.toasts).toHaveLength(0);
    expect(store.records).toHaveLength(1); expect(vi.getTimerCount()).toBe(0);
  });
  it("cleans timers on dismissal, capacity eviction and dispose; errors default from Error, strings are info", () => {
    vi.useFakeTimers(); const store = new FeedbackStore();
    const id = store.notify("ok"); store.notify("two"); store.notify("three"); store.notify("four");
    expect(vi.getTimerCount()).toBe(3); store.dismiss(id); expect(vi.getTimerCount()).toBe(3);
    store.notify(new Error("Failed")); expect(store.records[0].kind).toBe("error"); expect(vi.getTimerCount()).toBe(3);
    expect(store.records.at(-1)?.kind).toBe("info"); store.dispose(); expect(vi.getTimerCount()).toBe(0);
  });
  it("deduplicates repeated immediate messages but allows later feedback", () => {
    vi.useFakeTimers(); const store = new FeedbackStore(); store.notify("saved"); store.notify("saved");
    expect(store.records).toHaveLength(1); vi.advanceTimersByTime(2001); store.notify("saved"); expect(store.records).toHaveLength(2); store.dispose();
  });
  it("bounds and redacts display text and never exposes raw HTML/JSON responses", () => {
    expect(displayMessage(new Error("token=secret password=hunter2 Authorization: Bearer abc"))).not.toMatch(/secret|hunter2|abc/);
    expect(displayMessage(new Error('<html>secret server response</html>'))).not.toContain("secret");
    expect(displayMessage(new Error('{"access_token":"secret"}'))).not.toContain("secret");
    expect(displayMessage(new Error('HTTP 500: {"message":"backend-private"}'))).not.toContain("backend-private");
    expect(displayMessage(new Error('<Error>backend-private</Error>'))).not.toContain("backend-private");
    expect(displayMessage("x".repeat(4000)).length).toBeLessThanOrEqual(601);
  });
});
describe("actual task transition semantics", () => {
  it("seeds historical terminal snapshots silently and ignores duplicate/progress snapshots", () => {
    const transitions = new TaskTransitions(); transitions.bootstrap([task("completed"), task("failed", "old"), task("running", "active")]);
    expect(transitions.accept(task("completed"))).toBeUndefined(); expect(transitions.accept(task("running", "active"))).toBeUndefined();
    expect(transitions.accept(task("completed", "active"))?.kind).toBe("success"); expect(transitions.accept(task("completed", "active"))).toBeUndefined();
    transitions.accept(task("running", "active")); expect(transitions.accept(task("completed", "active"))).toBeUndefined();
    expect(transitions.accept(task("queued", "new"))).toBeUndefined(); expect(transitions.accept(task("failed", "new"))?.kind).toBe("error");
    expect(transitions.accept(task("cancelled", "cancel"))?.kind).toBe("warning");
  });
  it("redacts quoted credentials and URL userinfo, fragments and query before display", () => {
    expect(displayMessage('request failed: "password": "private-value"')).not.toContain("private-value");
    expect(displayMessage("https://user:secret@example.com/file?key=secret#secret")).toBe("https://example.com/file");
  });
});
