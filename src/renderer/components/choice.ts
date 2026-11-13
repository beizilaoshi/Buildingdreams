import { button, e, input } from "../ui";
import "./choice-motion.css";
export type ChoiceOption = { value: string; label: string; category?: string };
export type ChoiceControl = HTMLDivElement & {
  value: string;
  disabled: boolean;
  setOptions(options: ChoiceOption[], value?: string): void;
};
/** Always-visible choices; only the rendered page is bounded, never the searchable data. */
export function choice(
  options: [string, string][],
  value = "",
  searchable = false,
  allowUnselected = false,
): ChoiceControl {
  const node = e("div", "choice-control") as ChoiceControl;
  node.setAttribute("role", "radiogroup");
  let all: ChoiceOption[] = [],
    current = "",
    disabled = false,
    limit = 24,
    category = "";
  const tools = e("div", "choice-tools"),
    grid = e("div", "choice-grid"),
    status = e("p", "muted choice-status");
  const search = input("", "搜索版本");
  search.type = "search";
  const filters = e("div", "row choice-filters");
  const more = button(
    "显示更多",
    () => {
      limit += 24;
      render(true);
    },
    "quiet choice-more",
  );
  if (searchable) {
    tools.append(search, filters);
    node.append(tools);
    search.oninput = () => {
      limit = 24;
      render();
    };
  }
  node.append(status, grid, more);
  const render = (animateContent = false) => {
    const focused = grid.contains(document.activeElement)
      ? (document.activeElement as HTMLElement).dataset.value
      : undefined;
    const query = search.value.toLowerCase().trim();
    const matches = all.filter(
      (x) =>
        (!category || x.category === category) &&
        (!query || x.label.toLowerCase().includes(query)),
    );
    const visible = matches.slice(0, searchable ? limit : all.length);
    const cards = Array.from(grid.children) as HTMLButtonElement[];
    // Selection/status updates keep the live radios, focus and CSS transition
    // history. Only a changed visible list needs new content.
    const sameContent =
      cards.length === visible.length &&
      visible.every(
        (option, index) =>
          cards[index].dataset.value === option.value &&
          cards[index].textContent === option.label,
      );
    if (!sameContent) {
      grid.replaceChildren();
      for (const option of visible) {
        const tile = button(
          option.label,
          () => {
            current = option.value;
            render();
            node.dispatchEvent(new Event("change", { bubbles: true }));
          },
          "choice-card",
        );
        tile.setAttribute("role", "radio");
        tile.dataset.value = option.value;
        if (
          animateContent &&
          document.documentElement.dataset.motion !== "reduced" &&
          !matchMedia("(prefers-reduced-motion: reduce)").matches
        ) {
          tile.classList.add("choice-content-enter");
          // Retiring the class also prevents a cancelled entrance from replaying
          // if reduced motion is subsequently turned off.
          const finish = () => {
            tile.classList.remove("choice-content-enter");
            tile.removeEventListener("animationend", finish);
            tile.removeEventListener("animationcancel", finish);
          };
          tile.addEventListener("animationend", finish);
          tile.addEventListener("animationcancel", finish);
        }
        grid.append(tile);
      }
    }
    for (const tile of Array.from(grid.children) as HTMLButtonElement[]) {
      tile.setAttribute("aria-checked", String(current === tile.dataset.value));
      tile.disabled = disabled;
    }
    if (focused !== undefined)
      Array.from(grid.querySelectorAll<HTMLButtonElement>("button"))
        .find((x) => x.dataset.value === focused)
        ?.focus({ preventScroll: true });
    status.textContent = !all.length
      ? "暂无可选项"
      : searchable
        ? `已选择：${all.find((x) => x.value === current)?.label ?? "未选择"} · ${matches.length} 个匹配项`
        : "";
    status.hidden = Boolean(all.length && !searchable);
    more.hidden = !searchable || matches.length <= limit;
    node.dataset.value = current;
    node.setAttribute("aria-disabled", String(disabled));
  };
  // Native radio-like arrow navigation across currently visible cards.
  node.onkeydown = (event) => {
    if (
      disabled ||
      !(event.target instanceof HTMLButtonElement) ||
      !grid.contains(event.target)
    )
      return;
    if (
      !["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp"].includes(event.key)
    )
      return;
    const cards = Array.from(
      grid.querySelectorAll<HTMLButtonElement>("button:not(:disabled)"),
    );
    if (!cards.length) return;
    event.preventDefault();
    const index = cards.indexOf(document.activeElement as HTMLButtonElement);
    const next =
      cards[
        (index +
          (event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 1) +
          cards.length) %
          cards.length
      ];
    next.focus();
    next.click();
  };
  Object.defineProperties(node, {
    value: {
      get: () => current,
      set: (value: string) => {
        current = value;
        render();
      },
    },
    disabled: {
      get: () => disabled,
      set: (value: boolean) => {
        disabled = value;
        render();
      },
    },
  });
  node.setOptions = (options, value) => {
    all = options;
    current = value ?? options[0]?.value ?? "";
    limit = 24;
    category = "";
    search.value = "";
    filters.replaceChildren();
    if (searchable && options.some((x) => x.category))
      for (const [id, label] of [
        ["", "全部"],
        ["release", "正式版"],
        ["snapshot", "快照"],
      ]) {
        const chip = button(
          label,
          () => {
            const changed = category !== id;
            category = id;
            limit = 24;
            for (const child of Array.from(filters.children))
              child.setAttribute(
                "aria-pressed",
                String((child as HTMLElement).dataset.category === id),
              );
            render(changed);
          },
          "quiet filter-chip",
        );
        chip.dataset.category = id;
        chip.setAttribute("aria-pressed", String(id === ""));
        filters.append(chip);
      }
    render();
  };
  const observe = new MutationObserver(() => {
    const label = node.getAttribute("aria-label");
    if (label) search.setAttribute("aria-label", "搜索 " + label);
  });
  observe.observe(node, { attributes: true, attributeFilter: ["aria-label"] });
  node.setOptions(
    options.map(([value, label]) => ({ value, label })),
    allowUnselected ? value : value || options[0]?.[0] || "",
  );
  return node;
}
