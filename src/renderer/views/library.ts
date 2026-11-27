import { launchControls } from "../components/launch-controls";
import {
  api,
  state,
  selected,
  e,
  button,
  heading,
  input,
  field,
  persistFavorite,
  go,
  refresh,
  notify,
} from "../ui";
import { dialog } from "../components/dialog";
import { instanceWorkspace, directoryWorkspace } from '../components/instance-workspace';
import '../components/instance-workspace.css';
import { showDiagnostics } from '../components/diagnostics';
import { gameVersionNotice } from '../components/game-version-notice';
import { openInstanceFileBrowser } from '../components/instance-file-browser';
export function library() {
  const node = e("div");
  node.append(heading("游戏库", "把每一次出发，都留在这里。"));
  node.append(gameVersionNotice());
  const tools = e("div", "toolbar");
  const search = input("", "搜索游戏或版本");
  search.setAttribute("aria-label", "搜索游戏");
  const showHidden=input();showHidden.type='checkbox';showHidden.checked=localStorage.getItem('library-show-hidden')==='true';showHidden.setAttribute('aria-label','显示隐藏版本');
  const grid = e("div", "library-grid");
  const render = () => {
    grid.replaceChildren();
    for (const item of state.instances
      .filter((x) =>
        (showHidden.checked || x.displayType !== 'hidden') &&
        (x.name + x.minecraft + (x.description ?? '') + (x.category ?? ''))
          .toLowerCase()
          .includes(search.value.toLowerCase()),
      )
      .sort(
        (a, b) =>
          Number(state.favorites.has(b.id)) - Number(state.favorites.has(a.id)),
      )) {
      const card = e("article", "glass game-card");
      const art = e("div", "game-art");
      art.append(
        e("span", "version-watermark", item.minecraft),
        e("span", "badge", item.loader?.kind ?? "VANILLA"),
      );
      if(item.icon) void api('instances.icon',item.id).then(url=>{if(url){const image=document.createElement('img');image.className='instance-library-icon';image.src=url;image.alt=item.name+' 的游戏图标';art.append(image);}}).catch(()=>{});
      if(item.cover) void api('instances.cover',item.id).then(url=>{if(url&&art.isConnected){art.classList.add('has-cover');const image=document.createElement('img');image.className='instance-cover-image';image.src=url;image.alt=item.name+' 的自定义封面';art.prepend(image);}}).catch(()=>{});
      card.append(
        art,
        e("h2", "", item.name),
        e(
          "p",
          "muted",
          `${item.minecraft} · ${item.status === "ready" ? "就绪" : "需要修复"}`,
        ),
        e("p", "muted game-data-path", `游戏数据目录：${item.gameDir}`),
      );
      if(item.description)card.append(e('p','muted instance-description',item.description));
      if(item.category)card.append(e('span','badge',item.category));
      const displayLabel:Record<string,string>={normal:'常规',mod:'Mod',uncommon:'不常用',fool:'愚人节',hidden:'隐藏'};
      if(item.displayType && item.displayType!=='auto')card.append(e('span','badge',displayLabel[item.displayType]));
      const actions = e("div", "game-card-actions");
      const updateSelection = () => {
        for (const select of Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-select-instance]'))) {
          const active = select.dataset.selectInstance === selected()?.id;
          select.textContent = active ? '首页当前游戏' : '设为首页游戏';
          select.setAttribute('aria-pressed', String(active));
          select.classList.toggle('current-game-label', active);
          select.classList.toggle('quiet', !active);
        }
      };
      actions.append(launchControls(item.id, 'primary game-card-launch', updateSelection));
      const secondary = e("div", "game-card-secondary");
      const isCurrent = selected()?.id === item.id;
      const select = button(
        isCurrent ? "⌂ 首页当前游戏" : "设为首页游戏",
        () => {
          state.instanceId = item.id;
          localStorage.setItem("instance", item.id);
          render();
        },
        isCurrent ? "current-game-label" : "quiet",
      );
      select.dataset.selectInstance = item.id;
      select.setAttribute('aria-pressed', String(isCurrent));
      secondary.append(select);
      const favorite = button(
          state.favorites.has(item.id) ? "★" : "☆",
          async () => {
            await persistFavorite(item.id);
            render();
          },
          "icon-button",
        );
      favorite.title = state.favorites.has(item.id) ? "取消收藏" : "加入收藏";
      favorite.setAttribute("aria-label", favorite.title);
      secondary.append(favorite);
      secondary.append(button("目录", () => openInstanceFileBrowser(item.id, "root"), "quiet"));
      actions.append(button('管理游戏', () => {
        state.instanceId=item.id;localStorage.setItem('instance',item.id);
        const management = e('div');
        management.append(instanceWorkspace(item,()=>render()),button('崩溃诊断',()=>showDiagnostics(item.id),'quiet'));
        management.append(
        button(
          "更改数据目录",
          async () => {
            const gameDir = await api("dialog.choose", "game");
            if (!gameDir) return;
            await api("instances.mapGameDirectory", { id: item.id, gameDir });
            await refresh();
            managementDialog.close();
            render();
            notify("已更新数据目录映射，原文件保留在原处");
          },
          "quiet",
        ),
        button(
          "日志",
          async () => {
            const logs = await api("launch.logs", item.id);
            const pre = e(
              "pre",
              "logs",
              logs
                .map(
                  (x) =>
                    `${new Date(x.time).toLocaleTimeString()} ${x.type === "exit" ? `${x.code === 0 && !x.signal ? "游戏正常退出" : "游戏异常退出"} · 退出码 ${x.code ?? "无"} · 信号 ${x.signal ?? "无"}` : (x.text ?? x.type)}`,
                )
                .join("\n") || "尚无启动日志。",
            );
            dialog(item.name + " · 启动日志", pre);
          },
          "quiet",
        ),
      );
        const managementDialog = dialog(item.name + ' · 管理游戏', management);
      }, 'quiet'));
      const manage = actions.lastElementChild!;
      secondary.append(manage);
      actions.append(secondary);
      card.append(actions);
      grid.append(card);
    }
    if (state.instances.length && !grid.childElementCount) {
      const empty = e('section', 'glass empty');
      empty.append(e('h2', '', '没有匹配的游戏'), e('p', 'muted', `没有找到“${search.value}”。试试其他名称或版本。`), button('清空搜索', () => { search.value = ''; render(); search.focus(); }, 'quiet'));
      grid.append(empty);
    }
    if (!state.instances.length) {
      const empty = e("section", "glass empty");
      empty.append(
        e("div", "empty-mark", "◇"),
        e("h2", "", "世界还未启程"),
        e("p", "muted", "从一个全新的 Minecraft 版本开始。"),
        button("安装游戏", () => go("download"), "primary"),
      );
      grid.append(empty);
    }
  };
  search.oninput = render;
  showHidden.onchange=()=>{localStorage.setItem('library-show-hidden',String(showHidden.checked));render();};
  tools.append(
    search,
    field('显示隐藏版本',showHidden),
    button('管理目录',()=>directoryWorkspace(render),'quiet'),
    button(
      "导入游戏目录",
      async () => {
        const path = await api("dialog.choose", "game");
        if (path) {
          await api("instances.import", path);
          await refresh();
          render();
          notify("游戏目录已导入");
        }
      },
      "quiet",
    ),
  );
  node.append(tools, grid);
  render();
  return node;
}
