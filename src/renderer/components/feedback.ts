import { state, e, button } from "../ui";
import { feedback, installToasts, noticeContents } from "./toast";
import { taskCards, updateTaskCards } from "./task-list";

/** Global chrome stays mounted across navigation; only task rows and record lists change. */
export function installFeedback(titlebar: HTMLElement, windowControls: HTMLElement) {
  const disposeToasts = installToasts();
  const controls = e("div", "feedback-controls"); controls.setAttribute("aria-label", "任务与通知");
  let open: "task" | "notice" | undefined;
  const panels = new Map<string, HTMLElement>(), triggers = new Map<string, HTMLButtonElement>();
  const close = (restore = true) => {
    if (!open) return; const previous = open; open = undefined;
    panels.get(previous)!.hidden = true; triggers.get(previous)!.setAttribute("aria-expanded", "false");
    if (restore) triggers.get(previous)!.focus();
  };
  for (const [kind, label, symbol] of [["task", "任务", "☷"], ["notice", "通知", ""]] as const) {
    const trigger = button("", () => {
      if (open === kind) return close(); close(false); open = kind;
      panels.get(kind)!.hidden = false; trigger.setAttribute("aria-expanded", "true"); panels.get(kind)!.querySelector<HTMLButtonElement>(".feedback-close")!.focus();
    }, "feedback-toggle");
    trigger.id = `${kind}-toggle`; trigger.setAttribute("aria-label", label); trigger.setAttribute("aria-expanded", "false"); trigger.setAttribute("aria-controls", `${kind}-panel`);
    const icon = e("span", "feedback-icon", symbol); icon.setAttribute("aria-hidden", "true");
    if (kind === "notice") {
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("viewBox", "0 0 24 24"); svg.setAttribute("fill", "none"); svg.setAttribute("stroke", "currentColor"); svg.setAttribute("stroke-width", "1.6");
      const path = document.createElementNS(svg.namespaceURI, "path"); path.setAttribute("d", "M5 17h14l-2-3V9a5 5 0 0 0-10 0v5zM10 20h4M12 2v2"); svg.append(path); icon.append(svg);
    }
    trigger.append(icon, e("span", "feedback-label", label)); const count = e("span", "feedback-count"); count.id = `${kind}-count`; trigger.append(count);
    if (kind === "task") { const summary = e("span", "feedback-summary", "空闲"); summary.id = "task-summary"; trigger.append(summary); }
    triggers.set(kind, trigger); controls.append(trigger);
    const panel = e("aside", "glass feedback-panel"); panel.id = `${kind}-panel`; panel.hidden = true; panel.setAttribute("aria-label", `${label}${kind === "task" ? "列表" : "记录"}`);
    const header = e("header", "feedback-header"), copy = e("div");
    copy.append(e("h2", "", label), e("p", "muted", kind === "task" ? "安装与配置 · 实时任务" : "本次启动的操作反馈 · 最近 30 条"));
    const dismiss = button("×", () => close(), "quiet feedback-close"); dismiss.setAttribute("aria-label", `关闭${label}`); header.append(copy, dismiss); panel.append(header);
    if (kind === "task") panel.append(taskCards());
    else { const list = e("div", "notice-list"); list.id = "notice-list"; panel.append(list); const footer = e("footer"); footer.append(button("清除通知记录", () => feedback.clear(), "quiet")); panel.append(footer); }
    panels.set(kind, panel); document.body.append(panel);
  }
  titlebar.insertBefore(controls, windowControls);
  const renderRecords = () => {
    const count = document.querySelector("#notice-count")!; count.textContent = feedback.records.length ? String(feedback.records.length) : "";
    triggers.get("notice")!.setAttribute("aria-label", `通知，${feedback.records.length} 条记录`);
    const list = document.querySelector("#notice-list")!;
    // Notification history has no action controls; preserve scroll position while new records arrive.
    const scroll = list.scrollTop; list.replaceChildren();
    for (const item of feedback.records) { const row = e("article", "notice-item"); row.dataset.kind = item.kind; row.append(...noticeContents(item, true)); list.append(row); }
    if (!feedback.records.length) list.append(e("p", "muted feedback-empty", "暂时没有新通知。操作结果可以在这里回看。"));
    list.scrollTop = scroll;
  };
  const update = () => {
    const active = state.tasks.filter(task => task.status === "running" || task.status === "queued");
    document.querySelector("#task-count")!.textContent = active.length ? String(active.length) : "";
    document.querySelector("#task-summary")!.textContent = active.some(task => task.status === "running") ? "运行中" : active.length ? "等待中" : "空闲";
    triggers.get("task")!.setAttribute("aria-label", `任务，${active.length} 项进行中`); updateTaskCards();
  };
  const keydown = (event: KeyboardEvent) => { if (event.key === "Escape" && open) { event.preventDefault(); close(); } };
  const outside = (event: MouseEvent) => { if (open && !panels.get(open)!.contains(event.target as Node) && !controls.contains(event.target as Node)) close(); };
  window.addEventListener("keydown", keydown); document.addEventListener("click", outside);
  const unsubscribe = feedback.subscribe(renderRecords); renderRecords(); update();
  return { update, dispose() { unsubscribe(); disposeToasts(); window.removeEventListener("keydown", keydown); document.removeEventListener("click", outside); for (const panel of panels.values()) panel.remove(); controls.remove(); } };
}
