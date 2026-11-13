import { launchControls, exportLaunchButton } from "../components/launch-controls";
import {
  api,
  state,
  selected,
  e,
  button,
  heading,
  input,
  persistFavorite,
  go,
  refresh,
  notify,
} from "../ui";
import { dialog } from "../components/dialog";
export function library() {
  const node = e("div");
  node.append(heading("游戏库", "把每一次出发，都留在这里。"));
  const tools = e("div", "toolbar");
  const search = input("", "搜索游戏或版本");
  search.setAttribute("aria-label", "搜索游戏");
  const grid = e("div", "library-grid");
  const render = () => {
    grid.replaceChildren();
    for (const item of state.instances
      .filter((x) =>
        (x.name + x.minecraft)
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
      const actions = e("div", "row");
      const updateSelection = () => {
        for (const select of Array.from(grid.querySelectorAll<HTMLButtonElement>('[data-select-instance]'))) {
          const active = select.dataset.selectInstance === selected()?.id;
          select.textContent = active ? '已选择' : '选择';
          select.setAttribute('aria-pressed', String(active));
        }
      };
      actions.append(launchControls(item.id, 'primary', updateSelection));
      actions.append(
        button(
          selected()?.id === item.id ? "已选择" : "选择",
          () => {
            state.instanceId = item.id;
            localStorage.setItem("instance", item.id);
            render();
          },
          "quiet",
        ),
        button(
          state.favorites.has(item.id) ? "★" : "☆",
          () => {
            persistFavorite(item.id);
            render();
          },
          "icon-button",
        ),
        button("目录", () => api("app.openInstance", item.id), "quiet"),
      );
      actions.append(button('管理游戏', () => {
        const management = e('div');
        management.append(exportLaunchButton(item.id),
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
      const select = actions.querySelector<HTMLButtonElement>(':scope > button')!;
      select.dataset.selectInstance = item.id;
      select.setAttribute('aria-pressed', String(selected()?.id === item.id));
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
  tools.append(
    search,
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
