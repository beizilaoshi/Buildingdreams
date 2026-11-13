import type { Settings } from "../../shared/types";
import { api, state, e, button, heading, panel, field, input, notify } from "../ui";
import { choice } from "./choice";

/** Filtering only changes visibility; mounted form controls keep unsaved values. */
export function settingsWorkbench() {
  const node = e("div", "settings-workbench");
  node.append(heading("设置", "常用选项、运行环境与账号，按分类直接查找。"));
  const search = input("", "搜索设置、Java、账号或工具…");
  search.type = "search";
  search.setAttribute("aria-label", "搜索设置");
  const nav = e("nav", "settings-category-nav");
  nav.setAttribute("aria-label", "设置分类");
  const empty = e("p", "settings-search-empty muted", "没有匹配的设置，请换个关键词。");
  empty.setAttribute("role", "status"); empty.hidden = true;
  const cards = e("div", "settings-card-list");
  node.append(search, nav, empty, cards);
  const entries: { category: string; label: string; card: HTMLElement }[] = [];
  const categories = new Map<string, HTMLButtonElement>();
  const filter = () => {
    const words = search.value.trim().toLocaleLowerCase().split(/\s+/).filter(Boolean);
    for (const entry of entries) {
      const text = `${entry.label} ${entry.card.textContent}`.toLocaleLowerCase();
      entry.card.hidden = !words.every(word => text.includes(word));
    }
    for (const [category, link] of categories) link.hidden = !entries.some(entry => entry.category === category && !entry.card.hidden);
    empty.hidden = entries.some(entry => !entry.card.hidden);
  };
  search.oninput = filter;
  search.onkeydown = event => { if (event.key === "Escape") { search.value = ""; filter(); } };
  return {
    node,
    add(category: string, label: string, card: HTMLElement) {
      card.classList.add("settings-card");
      card.dataset.settingsCategory = category;
      card.id = `settings-${category}-${entries.length}`;
      entries.push({ category, label, card }); cards.append(card);
      if (!categories.has(category)) {
        const link = button(label, () => {
          const target = entries.find(entry => entry.category === category && !entry.card.hidden)?.card;
          target?.scrollIntoView({ block: "start", behavior: "instant" });
          const title = target?.querySelector("h2"); if (title) { title.tabIndex = -1; title.focus({ preventScroll: true }); }
        }, "quiet");
        categories.set(category, link); nav.append(link);
      }
    },
    finish: filter,
  };
}

export function generalSettingsCard() {
  const card = panel("常用设置", "修改后自动保存。启动页与最大化将在下次打开启动器时生效。");
  const grid = e("div", "form-grid");
  const status = e("p", "muted"); status.setAttribute("role", "status");
  // Each operation starts after the last response, so rapid edits cannot restore stale settings.
  let pending = Promise.resolve();
  const save = (patch: Partial<Settings>) => {
    status.textContent = "正在保存…";
    pending = pending.then(async () => {
      state.settings = await api("settings.patch", patch);
      status.textContent = "已自动保存";
    }).catch(error => { status.textContent = "保存失败，请重试"; notify(error); });
  };
  const startup = choice([["home", "首页"], ["library", "游戏库"], ["download", "下载"]], state.settings.startupPage);
  startup.onchange = () => save({ startupPage: startup.value as Settings["startupPage"] });
  grid.append(field("启动时打开", startup));
  for (const [key, label] of [
    ["startMaximized", "启动时最大化窗口"],
    ["notifyTaskCompletion", "任务完成通知"],
    ["notifyTaskFailure", "任务失败通知"],
  ] as const) {
    const control = input(); control.type = "checkbox"; control.checked = state.settings[key];
    control.onchange = () => save({ [key]: control.checked });
    grid.append(field(label, control));
  }
  card.append(grid, e("p", "muted", "关闭任务通知后，任务进度与失败原因仍可在顶部任务列表查看；手动操作错误会继续提示。"), status);
  return card;
}
