import { localMods } from "../components/local-mods";
import type { ContentKind } from "../../shared/content";
import { choice } from "../components/choice";
import { contentSearch } from "../components/content-browser";
import { e, heading, panel, instancePicker } from "../ui";
export function mods() {
  const node = e("div", "mods-view");
  node.append(
    heading("模组", "寻找契合版本的模组，也照顾已经安装的每一份创意。"),
  );
  const current = panel("当前实例");
  current.append(instancePicker());
  const local = localMods();
  node.addEventListener("mods-refresh", () => local.dispatchEvent(new Event("mods-refresh")));
  current.append(local);
  const categories = choice(
    [
      ["mod", "Mod"],
      ["resourcepack", "资源包"],
      ["shader", "光影"],
      ["datapack", "数据包"],
    ],
    "mod",
  );
  categories.setAttribute("aria-label", "资源类型");
  const browser = e("div");
  const showCategory = () => {
    browser.replaceChildren(contentSearch(categories.value as ContentKind));
    current.hidden = categories.value !== "mod";
  };
  categories.onchange = showCategory;
  showCategory();
  node.append(categories, browser, current);
  return node;
}
