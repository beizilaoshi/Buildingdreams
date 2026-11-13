import { FeedbackStore, type Notice, type NoticeOptions } from "./feedback-store";
export const feedback = new FeedbackStore();
export const notify = (message: unknown, options?: NoticeOptions) => feedback.notify(message, options);
const icons = { success: "✓", info: "i", warning: "!", error: "!" };
function text(tag: string, value: string, className = "") {
  const node = document.createElement(tag); node.className = className; node.textContent = value; return node;
}
export function noticeContents(item: Notice, history = false) {
  const icon = text("span", icons[item.kind], "feedback-severity"); icon.setAttribute("aria-hidden", "true");
  const copy = text("div", "", "notice-copy"); copy.append(text("strong", item.title), text("p", item.message));
  if (history) { const time = text("time", new Date(item.at).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })); time.setAttribute("datetime", new Date(item.at).toISOString()); copy.append(time); }
  return [icon, copy];
}
export function installToasts() {
  const host = document.querySelector<HTMLElement>("#toasts")!;
  host.removeAttribute("role"); host.removeAttribute("aria-live");
  const status = text("div", "", "sr-only"), alert = text("div", "", "sr-only");
  status.setAttribute("role", "status"); alert.setAttribute("role", "alert"); document.body.append(status, alert);
  const cards = new Map<number, HTMLElement>(); let announced = 0;
  const render = () => {
    for (const [id, card] of cards) if (!feedback.toasts.some(item => item.id === id)) { card.remove(); cards.delete(id); }
    for (const item of feedback.toasts.slice().reverse()) {
      if (cards.has(item.id)) continue;
      const card = text("article", "", "notice-toast"); card.dataset.kind = item.kind; card.dataset.noticeId = String(item.id); card.append(...noticeContents(item));
      const dismiss = text("button", "×", "notice-dismiss") as HTMLButtonElement; dismiss.type = "button"; dismiss.setAttribute("aria-label", "关闭这条提示");
      dismiss.onclick = () => { const focused = card.contains(document.activeElement); feedback.dismiss(item.id); if (focused) document.querySelector<HTMLButtonElement>("#notice-toggle")?.focus(); };
      card.append(dismiss);
      card.onmouseenter = () => feedback.pause(item.id, "hover", true); card.onmouseleave = () => feedback.pause(item.id, "hover", false);
      card.addEventListener("focusin", () => feedback.pause(item.id, "focus", true));
      card.addEventListener("focusout", event => { if (!card.contains(event.relatedTarget as Node | null)) feedback.pause(item.id, "focus", false); });
      cards.set(item.id, card); host.prepend(card);
    }
    const item = feedback.records[0];
    if (item && item.id > announced) { announced = item.id; const live = item.kind === "error" ? alert : status; live.textContent = `${item.title}。${item.message}`; }
  };
  const unsubscribe = feedback.subscribe(render); render();
  return () => { unsubscribe(); feedback.dispose(); host.replaceChildren(); status.remove(); alert.remove(); };
}
