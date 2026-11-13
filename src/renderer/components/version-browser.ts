const grass = new URL("../assets/pcl-blocks/Grass.png", import.meta.url).href;
const command = new URL(
  "../assets/pcl-blocks/CommandBlock.png",
  import.meta.url,
).href;
const cobble = new URL("../assets/pcl-blocks/CobbleStone.png", import.meta.url)
  .href;
const gold = new URL("../assets/pcl-blocks/GoldBlock.png", import.meta.url)
  .href;
import { e, button, input } from "../ui";
import {
  minecraftGroup,
  type MinecraftCatalog,
  type MinecraftGroup,
  type MinecraftVersion,
} from "../../shared/minecraft-versions";
const groups: [MinecraftGroup, string, string][] = [
  ["release", "正式版", grass],
  ["snapshot", "预览版", command],
  ["ancient", "远古版", cobble],
  ["fool", "愚人节版", gold],
];
export function versionBrowser(select: (version: MinecraftVersion) => void) {
  const node = e("section", "version-browser");
  const search = input("", "搜索 Minecraft 版本");
  search.type = "search";
  search.setAttribute("aria-label", "搜索 Minecraft 版本");
  const content = e("div");
  const status = e("p", "muted", "正在获取 Minecraft 版本列表…");
  let catalog: MinecraftCatalog = { latest: {}, versions: [] };
  let selectedId = "";
  const expanded = new Set<MinecraftGroup>();
  const searchExpanded = new Map<MinecraftGroup, boolean>();
  const limits = new Map<MinecraftGroup, number>();
  const row = (item: MinecraftVersion, prefix = "") => {
    const group = minecraftGroup(item);
    const meta = groups.find((x) => x[0] === group)!;
    const result = button(
      "",
      () => {
        selectedId = item.id;
        render();
        select(item);
      },
      "version-row",
    );
    if (item.id === selectedId) result.setAttribute("aria-current", "true");
    result.setAttribute(
      "aria-label",
      `选择 ${item.id}${prefix ? ` · ${prefix}` : ""}`,
    );
    const icon = document.createElement("img");
    icon.className = "version-icon";
    icon.src = meta[2];
    icon.alt = "";
    const copy = e("span", "version-copy");
    const date = item.releaseTime
      ? new Date(item.releaseTime).toLocaleString("zh-CN", {
          year: "numeric",
          month: "2-digit",
          day: "2-digit",
          hour: "2-digit",
          minute: "2-digit",
          hour12: false,
        })
      : "发布时间未知";
    copy.append(
      e("strong", "", item.id),
      e("span", "muted", `${prefix ? prefix + " · " : ""}${date}`),
    );
    result.append(icon, copy);
    return result;
  };
  const render = () => {
    content.replaceChildren();
    const query = search.value.trim().toLowerCase();
    if (!query) {
      const latest = e("section", "glass version-latest");
      latest.append(e("h3", "", "最新版本"));
      for (const kind of ["release", "snapshot"] as const) {
        const item = catalog.versions.find(
          (x) => x.id === catalog.latest[kind],
        );
        if (item)
          latest.append(
            row(item, kind === "release" ? "最新正式版" : "最新预览版"),
          );
      }
      if (latest.children.length === 1)
        latest.append(e("p", "muted", "清单未提供最新版本信息"));
      content.append(latest);
    }
    for (const [key, label] of groups) {
      const matches = catalog.versions.filter(
        (x) => minecraftGroup(x) === key && x.id.toLowerCase().includes(query),
      );
      const section = e("section", "glass version-group");
      const open = query
        ? (searchExpanded.get(key) ?? matches.length > 0)
        : expanded.has(key);
      const toggle = button(
        label,
        () => {
          if (query) searchExpanded.set(key, !open);
          else if (expanded.has(key)) expanded.delete(key);
          else expanded.add(key);
          render();
          const nextToggle = content.querySelector<HTMLButtonElement>(
            `[aria-controls="versions-${key}"]`,
          );
          nextToggle?.focus();
        },
        "version-group-toggle",
      );
      toggle.setAttribute("aria-expanded", String(open));
      toggle.setAttribute("aria-label", label);
      const rows = e("div", "version-group-rows");
      rows.id = `versions-${key}`;
      toggle.setAttribute("aria-controls", rows.id);
      rows.hidden = !open;
      section.append(toggle, rows);
      if (open) {
        const limit = limits.get(key) ?? 24;
        for (const item of matches.slice(0, limit)) rows.append(row(item));
        if (!matches.length) rows.append(e("p", "muted", "此分类暂无版本"));
        if (matches.length > limit)
          rows.append(
            button(
              "显示更多",
              () => {
                limits.set(key, limit + 24);
                render();
                const rows = content.querySelector(`#versions-${key}`);
                const more = rows?.querySelector<HTMLButtonElement>(
                  ".version-load-more",
                );
                const lastRow = rows?.querySelector<HTMLButtonElement>(
                  ".version-row:last-child",
                );
                (more ?? lastRow)?.focus();
              },
              "quiet version-load-more",
            ),
          );
      }
      content.append(section);
    }
    if (
      query &&
      !catalog.versions.some((x) => x.id.toLowerCase().includes(query))
    )
      content.append(e("p", "muted", "未找到匹配版本"));
  };
  search.oninput = () => {
    limits.clear();
    searchExpanded.clear();
    render();
  };
  node.append(search, status, content);
  return {
    node,
    focusSelection() {
      const selectedRow = Array.from(
        content.querySelectorAll<HTMLButtonElement>(
          '.version-row[aria-current="true"]',
        ),
      ).find((row) => row.getClientRects().length > 0);
      (selectedRow ?? search).focus();
    },
    setCatalog(value: MinecraftCatalog) {
      catalog = value;
      status.remove();
      render();
    },
    error() {
      status.textContent = "无法获取版本列表，请稍后重试。";
    },
  };
}
