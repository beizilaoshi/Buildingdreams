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
  else if(item.kind==="error") { const action=text("button","查看排查建议","text-button") as HTMLButtonElement;action.type="button";action.onclick=()=>showFailureDetails(item);copy.append(action); }
  return [icon, copy];
}
function showFailureDetails(item:Notice){
 const message=item.message;
 const advice=/OutOfMemoryError|heap space|内存不足/i.test(message)?'检查已分配内存是否低于系统可用内存，关闭占用较高的软件后重试。':/UnsupportedClassVersion|Java|JVM|java\.exe/i.test(message)?'确认 Java 版本符合当前 Minecraft 与加载器要求；优先使用实例的自动 Java 配置。':/ECONN|timeout|network|网络|DNS|连接/i.test(message)?'检查网络连接和 DNS；资源下载失败时可在设置中切换下载源后重试。':/EACCES|EPERM|Permission denied|拒绝访问/i.test(message)?'检查目标文件夹权限和剩余空间，并确认文件没有被游戏或安全软件占用。':/mod|模组|Mixin|Loader/i.test(message)?'核对模组、Minecraft 与加载器版本；排查最近新增或更新的模组。':'打开任务面板查看失败步骤；确认网络、磁盘空间和目标目录可用后重试。若是游戏启动问题，可到游戏库打开“崩溃诊断”分析日志。';
 const modal=document.createElement('dialog');modal.className='glass dialog';modal.setAttribute('aria-label','错误排查建议');
 const header=document.createElement('div');header.className='row between';header.append(text('h2','错误排查建议'));const close=document.createElement('button');close.type='button';close.className='quiet';close.textContent='关闭';close.onclick=()=>modal.close();header.append(close);
 const body=document.createElement('div');body.className='stack';body.append(text('p',item.title),text('p',message,'error'),text('h3','建议'),text('p',advice,'muted'));
 const help=document.createElement('button');help.type='button';help.className='quiet';help.textContent='打开帮助与支持';help.onclick=()=>{modal.close();window.dispatchEvent(new CustomEvent('navigate',{detail:'about'}));};body.append(help);
 modal.append(header,body);document.body.append(modal);modal.addEventListener('close',()=>modal.remove(),{once:true});modal.showModal();
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
