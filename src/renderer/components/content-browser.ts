import { contentTags, type ContentTag } from "../../shared/content-tags";
import { dialog } from "./dialog";
import { choice } from "./choice";
import { api, selected, e, button, input, field, panel, notify } from "../ui";
import type {
  ContentFilter,
  ContentKind,
  SearchPage,
} from "../../shared/content";
import { projectRow, type ProjectIdentity } from "./content-project-row";
import { projectDetail } from "./content-project-detail";
interface SearchFilters {
  query: string;
  mc: string;
  loader: string;
  tag?: string;
}
interface SearchRequest {
  filters: SearchFilters;
  page: number;
}
interface SearchState {
  provider: "modrinth" | "curseforge";
  draft: SearchFilters;
  request?: SearchRequest;
  response?: SearchPage;
  generation: number;
}
const sameFilters = (a: SearchFilters, b?: SearchFilters) =>
  Boolean(
    b && a.query === b.query && a.mc === b.mc &&
    a.loader === b.loader && a.tag === b.tag,
  );
const memories = new Map<string, SearchState>();
const activeProviders = new Map<ContentKind, SearchState["provider"]>();
export function contentSearch(type: ContentKind) {
  const label = {
    mod: "Mod",
    modpack: "整合包",
    resourcepack: "资源包",
    shader: "光影",
    datapack: "数据包",
  }[type];
  const usesLoader = type === "mod" || type === "modpack";
  const activeProvider = activeProviders.get(type) ?? "modrinth";
  let memory = memories.get(`${type}:${activeProvider}`);
  if (!memory) {
    memory = {
      provider: activeProvider,
      draft: {
        query: "",
        mc: selected()?.minecraft ?? "",
        loader: usesLoader ? (selected()?.loader?.kind ?? "") : "",
      },
      generation: 0,
    };
    memories.set(`${type}:${activeProvider}`, memory);
  }
  let saved = memory;
  ++saved.generation;
  const host = e("div", "content-browser");
  const searchPanel = panel(
    type === "modpack"
      ? "在线整合包"
      : type === "mod"
        ? "发现 Mod"
        : `发现${label}`,
    "点击项目查看介绍、前置资源与版本文件",
  );
  const query = input(saved.draft.query, "搜索项目");
  query.setAttribute(
    "aria-label",
    type === "mod" ? "搜索 Mod" : `搜索${label}`,
  );
  const mc = input(saved.draft.mc, "例如 1.21.1");
  const loader = choice(
    [
      ["", "所有加载器"],
      ["fabric", "Fabric"],
      ["quilt", "Quilt"],
      ["forge", "Forge"],
      ["neoforge", "NeoForge"],
    ],
    saved.draft.loader,
  );
  const toolbar = e("div", "content-search-toolbar");
  const results = e("div", "content-search-results");
  const context = e("p", "muted content-search-context");
  context.setAttribute("role", "status");
  const draftFilters = (): SearchFilters => ({
    ...saved.draft,
    mc: saved.draft.mc.trim(),
  });
  const renderContext = () => {
    const filters = saved.request?.filters;
    if (!filters) {
      context.textContent = "";
      return;
    }
    const tag = contentTags[type].find((t) => t.id === filters.tag)?.label;
    const conditions = [
      filters.query || "全部项目",
      filters.mc || "所有版本",
      ...(usesLoader ? [filters.loader || "所有加载器"] : []),
      ...(tag ? [tag] : []),
    ];
    context.textContent = `结果条件：${conditions.join(" · ")}${
      sameFilters(draftFilters(), filters)
        ? ""
        : "。筛选已修改，尚未搜索；搜索或翻页将应用新条件。"
    }`;
  };
  const stack: {
    node: HTMLElement;
    scroll: number;
    focus: HTMLElement | null;
  }[] = [];
  const show = (node: HTMLElement, scroll = 0) => {
    host.replaceChildren(node);
    const scroller = host.closest(".content");
    if (scroller) scroller.scrollTop = scroll;
  };
  const open = (hit: ProjectIdentity, filters: SearchFilters) => {
    if (stack.length >= 8) {
      notify("前置浏览已达 8 层，请先返回上一级");
      return;
    }
    const current = host.firstElementChild as HTMLElement;
    stack.push({
      node: current,
      scroll: host.closest(".content")?.scrollTop ?? 0,
      focus:
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null,
    });
    const target = selected(); // Capture immutable target at detail entry, never read selection after awaits.
    const detail = projectDetail(
      hit,
      type,
      {
        minecraft: filters.mc || target?.minecraft || "",
        loader: usesLoader ? filters.loader || target?.loader?.kind || "" : "",
        instance: target
          ? {
              id: target.id,
              name: target.name,
              minecraft: target.minecraft,
              loader: target.loader?.kind,
            }
          : undefined,
      },
      (dependency) => open(dependency, filters),
      () => {
        const previous = stack.pop()!;
        show(previous.node, previous.scroll);
        (previous.focus?.isConnected ? previous.focus : query).focus({
          preventScroll: true,
        });
      },
      stack.length > 1,
    );
    show(detail);
    detail
      .querySelector<HTMLButtonElement>(".content-back")
      ?.focus({ preventScroll: true });
  };
  const render = () => {
    results.replaceChildren();
    const response = saved.response;
    const request = saved.request;
    renderContext();
    if (!response || !request) return;
    results.append(
      e(
        "p",
        "muted content-result-count",
        `${response.total_hits.toLocaleString()} 个项目 · 第 ${request.page + 1} 页`,
      ),
    );
    if (response.mappingNotice)
      results.append(e("p", "muted", response.mappingNotice));
    for (const hit of response.hits)
      results.append(projectRow(hit, () => open(hit, request.filters)));
    if (!response.hits.length)
      results.append(
        e(
          "p",
          "muted",
          "没有找到匹配项目，试试英文名称、其他关键词或兼容条件。",
        ),
      );
    const pages = e("div", "row content-pagination");
    const previous = button(
      "上一页",
      () => search(request.page - 1),
      "quiet",
    );
    previous.disabled = request.page === 0;
    const next = button("下一页", () => search(request.page + 1), "quiet");
    next.disabled =
      response.offset + response.hits.length >= response.total_hits;
    pages.append(previous, next);
    results.append(pages);
  };
  const search = async (page?: number, revalidate = false) => {
    // Revalidation/retry belongs to the committed request, never an unsubmitted draft.
    const filters = revalidate && saved.request
      ? { ...saved.request.filters }
      : draftFilters();
    const request: SearchRequest = {
      filters,
      page: sameFilters(filters, saved.request?.filters)
        ? Math.max(0, page ?? saved.request?.page ?? 0)
        : 0,
    };
    saved.request = request;
    const searchState = saved;
    const generation = ++saved.generation;
    saved.response = undefined;
    const filter: ContentFilter = {
      provider: saved.provider,
      projectType: type,
      ...(filters.tag ? { tag: filters.tag } : {}),
      ...(filters.mc ? { minecraft: filters.mc } : {}),
      ...(usesLoader && filters.loader
        ? { loader: filters.loader as ContentFilter["loader"] }
        : {}),
      offset: request.page * 40,
      limit: 40,
    };
    results.replaceChildren(e("p", "muted", "正在搜索…"));
    renderContext();
    try {
      const response = await api("content.search", {
        query: filters.query,
        filter,
      });
      if (saved !== searchState || generation !== saved.generation) return;
      saved.response = response;
      render();
    } catch (error) {
      if (saved !== searchState || generation !== saved.generation) return;
      results.replaceChildren(
        e(
          "p",
          "error",
          `搜索失败：${error instanceof Error ? error.message : String(error)}`,
        ),
        button("重试搜索", () => search(request.page, true), "quiet"),
        ...(saved.provider === "curseforge"
          ? [
              e(
                "p",
                "muted",
                "请在左侧「设置」→「内容来源」配置或更新 CurseForge 密钥。",
              ),
            ]
          : []),
      );
    }
  };
  const tagsHost = e("div", "content-tag-filter");
  const selectTag = (tag?: ContentTag) => {
    saved.draft.tag = tag?.id;
    renderTags();
    void search();
  };
  const tagButton = (tag: ContentTag) => {
    const tile = button(
      tag.label +
        (tag[saved.provider]
          ? ""
          : saved.provider === "modrinth"
            ? " · 仅 CurseForge"
            : " · 仅 Modrinth"),
      () => selectTag(tag),
      "quiet filter-chip",
    );
    tile.disabled = !tag[saved.provider];
    tile.setAttribute("aria-pressed", String(saved.draft.tag === tag.id));
    if (!tag[saved.provider]) tile.title = "此标签不支持当前来源";
    return tile;
  };
  const renderTags = () => {
    tagsHost.replaceChildren();
    const tags = contentTags[type];
    const summary = e("div", "row content-tag-summary");
    summary.append(
      e(
        "span",
        "muted",
        `标签：${tags.find((t) => t.id === saved.draft.tag)?.label ?? "全部"}`,
      ),
    );
    if (saved.draft.tag)
      summary.append(button("清除标签", () => selectTag(), "quiet"));
    const priorities = [
      "optimization",
      "technology",
      "magic",
      "lightweight",
      "adventure",
      "utility",
    ];
    const common = [
      ...tags.filter((t) => priorities.includes(t.modrinth ?? "")),
      ...tags.filter((t) => t.modrinth && !priorities.includes(t.modrinth)),
    ].slice(0, 6);
    const visible = tags.filter(
      (t) =>
        common.includes(t) ||
        t.id === saved.draft.tag ||
        (query.value.trim() && t.label.includes(query.value.trim())),
    );
    const cards = e("div", "row content-tag-cards");
    cards.append(
      ...visible.map(tagButton),
      button(
        "更多标签",
        () => {
          const body = e("div", "content-more-tags");
          const find = input("", "搜索标签");
          find.setAttribute("aria-label", "搜索标签");
          const grid = e("div", "choice-grid");
          let limit = 24;
          const more = button(
            "显示更多标签",
            () => {
              limit += 24;
              draw();
            },
            "quiet",
          );
          const draw = () => {
            const matches = tags.filter(
              (t) =>
                t.label.includes(find.value.trim()) ||
                t.modrinth?.includes(find.value.trim()),
            );
            grid.replaceChildren(
              ...matches.slice(0, limit).map((t) => {
                const tile = tagButton(t);
                if (t[saved.provider])
                  tile.onclick = () => {
                    modal.close();
                    selectTag(t);
                  };
                return tile;
              }),
            );
            more.hidden = matches.length <= limit;
          };
          find.oninput = () => {
            limit = 24;
            draw();
          };
          body.append(
            find,
            e("p", "muted", "按 PCL 原始分类；不支持当前来源的标签不可用。"),
            grid,
            more,
          );
          const modal = dialog("更多标签", body);
          draw();
        },
        "quiet",
      ),
    );
    tagsHost.append(summary, cards);
  };
  renderTags();
  query.oninput = () => {
    saved.draft.query = query.value;
    renderTags();
    renderContext();
  };
  mc.oninput = () => {
    saved.draft.mc = mc.value;
    renderContext();
  };
  loader.onchange = () => {
    saved.draft.loader = loader.value;
    renderContext();
  };
  query.onkeydown = (event) => {
    if (event.key === "Enter") void search();
  };
  const provider = choice(
    [
      ["modrinth", "Modrinth"],
      ["curseforge", "CurseForge"],
    ],
    saved.provider,
  );
  provider.setAttribute("aria-label", "内容来源");
  provider.onchange = () => {
    ++saved.generation;
    const value = provider.value as SearchState["provider"];
    activeProviders.set(type, value);
    let next = memories.get(`${type}:${value}`);
    if (!next) {
      next = {
        provider: value,
        draft: {
          query: "",
          mc: selected()?.minecraft ?? "",
          loader: usesLoader ? (selected()?.loader?.kind ?? "") : "",
        },
        generation: 0,
      };
      memories.set(`${type}:${value}`, next);
    }
    saved = next;
    query.value = saved.draft.query;
    mc.value = saved.draft.mc;
    loader.value = saved.draft.loader;
    renderTags();
    if (saved.response && saved.provider === "modrinth") render();
    else void search(undefined, true);
  };
  toolbar.append(
    field(type === "mod" ? "搜索 Mod" : `搜索${label}`, query),
    field("兼容版本", mc),
    button("搜索", () => search(), "primary"),
  );
  searchPanel.append(
    toolbar,
    field("内容来源", provider),
    ...(usesLoader ? [field("兼容加载器", loader)] : []),
    tagsHost,
    context,
    results,
  );
  show(searchPanel);
  if (saved.response && saved.provider === "modrinth") render();
  else void search(undefined, true);
  return host;
}
