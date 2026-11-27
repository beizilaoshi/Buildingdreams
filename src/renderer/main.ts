import "./styles.css";
import { api, state, refresh, e, button, go, notify } from "./ui";
import { applySettings, installGlass } from "./components/glass";
import { playOpening, revealStartupWindow } from "./components/opening";
import { home } from "./views/home";
import { library } from "./views/library";
import { download } from "./views/download";
import { installFeedback } from "./components/feedback";
import { TaskTransitions, displayMessage } from "./components/feedback-store";
import type { LauncherNotice, TaskSnapshot } from "../shared/types";
import { mods } from "./views/mods";
import { packs } from "./views/packs";
import { personalize } from "./views/personalize";
import { settings } from "./views/settings";
import { about } from "./views/about";
import { instanceMods, instanceSaves } from "./views/instance-managers";
import { getMusicController } from './components/music';
import { showDiagnostics } from './components/diagnostics';
import "./redesign.css";
const views: Record<string, () => HTMLElement> = {
  home,
  library,
  download,
  mods,
  packs,
  personalize,
  settings,
  about,
  instanceMods,
  instanceSaves,
};
const navGroups = [
  ["启动", [["home", "⌂", "首页"], ["library", "▦", "游戏库"], ["download", "↓", "下载"]]],
  ["内容", [["mods", "◇", "模组"], ["packs", "▧", "整合包"]]],
  ["偏好", [["personalize", "✧", "个性化"], ["settings", "⚙", "设置"], ["about", "ⓘ", "关于"]]],
] as const;
const app = document.querySelector("#app")!;
const title = e("header", "titlebar");
const titleImage = document.createElement('img');
titleImage.className = 'window-title-image';
titleImage.alt = '';
titleImage.hidden = true;
title.append(titleImage);
title.append(e("span", "window-brand", "筑梦 · ZHUMENG"));
const controls = e("div", "window-controls");
for (const [action, label] of [
  ["minimize", "最小化"],
  ["maximize", "最大化"],
  ["close", "关闭窗口"],
] as const) {
  const control = button(
    action === "minimize" ? "−" : action === "maximize" ? "□" : "×",
    () => api("window.action", action),
    "window-control",
  );
  control.setAttribute("aria-label", label);
  controls.append(control);
}
title.append(controls);
app.append(title);
const feedbackUi = installFeedback(title, controls);
const shell = e("div", "app-shell");
const nav = e("nav", "glass navigation");
nav.setAttribute("aria-label", "主导航");
const logo = document.createElement("img");
logo.src = "./assets/logos/zhumeng-mengmiao.png";
logo.alt = "筑梦";
logo.className = "nav-logo";
nav.append(logo);
for (const [groupLabel, entries] of navGroups) {
  const group = e("section", "nav-group");
  group.setAttribute("aria-label", groupLabel);
  group.append(e("span", "nav-group-label", groupLabel));
  for (const [id, icon, label] of entries) {
    const item = button("", () => go(id), "nav-item");
    item.dataset.page = id;
    item.setAttribute("aria-label", label);
    item.title = label;
    item.append(e("span", "nav-icon", icon), e("span", "nav-label", label));
    group.append(item);
  }
  nav.append(group);
}
const versionFooter = e('span', 'nav-footer', '筑梦');
nav.append(versionFooter);
const updateFooter = () => api('updates.status', undefined).then(s => { versionFooter.textContent = `筑梦 / ${s.currentVersion}${s.state === 'available' ? ' · 有更新' : ''}`; }).catch(() => {});
void updateFooter();
setInterval(() => void updateFooter(), 5000);
const indicator = e("div", "nav-indicator");
nav.append(indicator);
let revealNavigation=false;
function updateNavigation(){
 if(!state.settings)return;
 for(const item of Array.from(nav.querySelectorAll<HTMLElement>('[data-page]'))){item.hidden=!revealNavigation&&state.settings.navigationHidden.includes(item.dataset.page as any);item.style.display=item.hidden?'none':'';}
 for(const group of Array.from(nav.querySelectorAll<HTMLElement>('.nav-group')))group.hidden=!Array.from(group.querySelectorAll<HTMLElement>('[data-page]')).some(item=>!item.hidden);
 const brand=title.querySelector('.window-brand');if(brand)brand.textContent=state.settings.titleText||'筑梦 · ZHUMENG';
 const image=state.settings.titleImage;
 titleImage.hidden=!image;
 if(image){titleImage.src=image;titleImage.style.height=`${state.settings.titleImageHeight}px`;}else titleImage.removeAttribute('src');
 logo.title=state.settings.navigationHidden.length?'按 F12 临时显示全部导航':'筑梦启动器';
 const active=nav.querySelector<HTMLElement>('.nav-item.active');indicator.hidden=!active||active.hidden;if(active&&!active.hidden)indicator.style.top=`${active.offsetTop+(active.offsetHeight-23)/2}px`;
}
window.addEventListener('launcher-settings',updateNavigation);
window.addEventListener('keydown',event=>{if(event.key==='F12'){event.preventDefault();revealNavigation=!revealNavigation;updateNavigation();}});
const main = e("main", "content");
shell.append(nav, main);
app.append(shell);
function render(page: string) {
  if (!views[page]) return;
  state.page = page;
  const navigationPage = page === 'instanceMods' || page === 'instanceSaves' ? 'library' : page;
  for (const item of Array.from(
    nav.querySelectorAll<HTMLElement>("[data-page]"),
  )) {
    item.classList.toggle("active", item.dataset.page === navigationPage);
    item.setAttribute(
      "aria-current",
      item.dataset.page === navigationPage ? "page" : "false",
    );
    if (item.dataset.page === navigationPage)
      indicator.style.top = `${item.offsetTop + (item.offsetHeight - 23) / 2}px`;
  }
  main.replaceChildren(views[page]());
  main.scrollTop = 0;
  main.classList.remove("enter");
  updateNavigation();
  requestAnimationFrame(() => main.classList.add("enter"));
}
window.addEventListener("navigate", (event) =>
  render((event as CustomEvent<string>).detail),
);
async function init() {
  try {
    const launchPhases=new Map<string,string>();
    const diagnosedLaunches=new Set<string>();
    window.launcher.onLaunch(snapshot=>{
      if(snapshot.phase==='preparing')diagnosedLaunches.delete(snapshot.instanceId);
      const previous=launchPhases.get(snapshot.instanceId);launchPhases.set(snapshot.instanceId,snapshot.phase);
      if(previous!==snapshot.phase&&snapshot.phase==='exited'){
        notify(snapshot.code===0?'游戏正常退出':'游戏异常退出，正在检查日志…',{kind:snapshot.code===0?'success':'warning'});
        if(snapshot.code!==0&&!diagnosedLaunches.has(snapshot.instanceId)){
          diagnosedLaunches.add(snapshot.instanceId);
          // Give Minecraft a moment to flush crash-reports/latest.log before the automatic scan.
          setTimeout(()=>{void showDiagnostics(snapshot.instanceId,'游戏异常排查',true).catch(notify);},1200);
        }
      }
      if(previous!==snapshot.phase&&snapshot.phase==='failed'&&!diagnosedLaunches.has(snapshot.instanceId)){
        diagnosedLaunches.add(snapshot.instanceId);
        notify('游戏启动失败，正在分析启动日志…',{kind:'error'});
        setTimeout(()=>{void showDiagnostics(snapshot.instanceId,'启动失败排查',true).catch(notify);},800);
      }
      if(previous!==snapshot.phase&&snapshot.phase==='cancelled')notify('所选游戏启动或运行已停止',{kind:'info'});
      for(const node of Array.from(main.querySelectorAll<HTMLElement>('.launch-controls')))if(node.dataset.instance===snapshot.instanceId)node.dispatchEvent(new CustomEvent('launch-state',{detail:snapshot}));
    });
    const transitions = new TaskTransitions();
    let bootstrapping = true;
    const buffered: TaskSnapshot[] = [];
    let javaRefreshPending = false;
    let progressTimer: ReturnType<typeof setTimeout> | undefined;
    const handleTask = (task: TaskSnapshot) => {
      if (bootstrapping) { buffered.push(task); return; }
      const index = state.tasks.findIndex((x) => x.id === task.id);
      if (index < 0) state.tasks.push(task); else state.tasks[index] = task;
      const terminal = transitions.accept(task);
      if (terminal) {
        javaRefreshPending = true;
        if ((task.status !== "completed" || state.settings.notifyTaskCompletion) &&
            (task.status !== "failed" || state.settings.notifyTaskFailure))
        notify(task.status === "failed" ? `${displayMessage(task.label)}：${displayMessage(task.error ?? "任务未完成，请重试。")}` : task.label, terminal);
      }
      if (!progressTimer) progressTimer = setTimeout(() => {
        progressTimer = undefined; feedbackUi.update();
        main.querySelector(".java-task-summary")?.dispatchEvent(new Event("java-task"));
        if (javaRefreshPending) { javaRefreshPending = false; main.querySelector(".java-plan-status")?.dispatchEvent(new Event("java-refresh")); }
      }, 100);
      if (terminal && task.status === "completed") void refresh(false).then(() => {
        if (state.page === "mods") main.querySelector(".mods-view")?.dispatchEvent(new Event("mods-refresh"));
        if (["home", "library"].includes(state.page) && !main.contains(document.activeElement)) render(state.page);
      }).catch(notify);
    };
    const unsubscribe = window.launcher.onTask(handleTask);
    window.addEventListener("beforeunload", () => { unsubscribe(); clearTimeout(progressTimer); feedbackUi.dispose(); }, { once: true });
    const notices: LauncherNotice[] = [];
    let noticeReady = false;
    const noticeCard = (notice: LauncherNotice) => {
      // The store caps toasts at three and the opening animation hides them, so a startup notice keeps its own card.
      const card = document.createElement("article");
      card.className = "notice-toast notice-welcome"; card.dataset.kind = "info";
      const icon = document.createElement("span");
      icon.className = "feedback-severity"; icon.textContent = "i"; icon.setAttribute("aria-hidden", "true");
      const copy = document.createElement("div"); copy.className = "notice-copy";
      const title = document.createElement("strong"); title.textContent = notice.title;
      const body = document.createElement("p"); body.textContent = notice.message;
      const actions = document.createElement("div"); actions.className = "notice-actions";
      const join = document.createElement("button");
      join.type = "button"; join.className = "text-button"; join.textContent = "加入交流群 ↗";
      join.onclick = () => { void api("app.openCommunity", undefined).catch(notify); };
      const copyGroup = document.createElement("button");
      copyGroup.type = "button"; copyGroup.className = "text-button"; copyGroup.textContent = `复制群号 ${notice.group}`;
      copyGroup.onclick = () => { void api("app.copyCommunityGroup", undefined).then(() => notify(`群号 ${notice.group} 已复制`, { kind: "success" })).catch(notify); };
      actions.append(join, copyGroup);
      const dismiss = document.createElement("button");
      dismiss.type = "button"; dismiss.className = "notice-dismiss"; dismiss.textContent = "×"; dismiss.setAttribute("aria-label", "关闭这条提示");
      dismiss.onclick = () => card.remove();
      copy.append(title, body, actions);
      card.append(icon, copy, dismiss);
      const host = document.querySelector("#toasts");
      if (host) host.prepend(card);
      return card;
    };
    const showNotice = (notice: LauncherNotice) => {
      if (!noticeReady) { notices.push(notice); return; }
      noticeCard(notice);
    };
    const noticeSubscription = window.launcher.onNotice(showNotice);
    window.addEventListener("beforeunload", () => noticeSubscription(), { once: true });
    state.settings = await api("settings.read", undefined);
    applySettings(state.settings);
    await refresh();
    void getMusicController().initialize().catch(notify);
    transitions.bootstrap(state.tasks);
    bootstrapping = false;
    const historicalTerminal = new Set(state.tasks.filter(task => ["completed", "failed", "cancelled"].includes(task.status)).map(task => task.id));
    for (const task of buffered) if (!historicalTerminal.has(task.id)) handleTask(task);
    buffered.length = 0;
    feedbackUi.update();
    render(state.settings.startupPage);
    installGlass();
    await revealStartupWindow(state.settings);
    noticeReady = true;
    for (const notice of notices.splice(0)) noticeCard(notice);
    for (const query of [
      "(prefers-color-scheme: dark)",
      "(prefers-reduced-motion: reduce)",
    ])
      matchMedia(query).addEventListener("change", () =>
        applySettings(state.settings),
      );
  } catch (error) {
    document.documentElement.classList.remove("booting");
    main.replaceChildren(
      e("h1", "", "初始化遇到问题"),
      e("p", "error", String(error)),
      button("重新加载", () => location.reload(), "primary"),
    );
  }
}
void init();
