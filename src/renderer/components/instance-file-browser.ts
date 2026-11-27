import type { InstanceFolder, InstanceFolderListing } from "../../shared/types";
import { api, e, button, notify, state, go } from "../ui";
import { dialog } from "./dialog";

const labels: Record<InstanceFolder, string> = {
  root: "游戏数据目录", version: "版本文件夹", mods: "Mod 文件夹",
  saves: "存档", resourcepacks: "资源包", screenshots: "截图",
};
const formatSize = (bytes: number) => bytes < 1024 ? `${bytes} B` : bytes < 1024 ** 2 ? `${(bytes / 1024).toFixed(1)} KB` : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function openInstanceFileBrowser(instanceId: string, folder: InstanceFolder) {
  const content = e("div", "instance-file-browser"), list = e("div", "instance-file-list");
  const modal = dialog(`${labels[folder]} · 内置管理`, content);
  let relativePath = "", offset = 0, generation = 0;
  const render = async (append = false) => {
    const current = ++generation;
    const segments = relativePath.split(/[\\/]/).filter(Boolean);
    if (!append) {
      content.replaceChildren();
      const toolbar = e("div", "row instance-file-toolbar");
      toolbar.append(button("根目录", () => { relativePath = ""; offset = 0; void render(); }, "quiet"));
      if (segments.length) toolbar.append(button("上一级", () => { segments.pop(); relativePath = segments.join("/"); offset = 0; void render(); }, "quiet"));
      toolbar.append(button("刷新", () => { offset = 0; void render(); }, "quiet"));
      content.append(toolbar, e("p", "muted instance-file-path", `${labels[folder]}${relativePath ? ` / ${relativePath}` : ""}`));
      list.replaceChildren();
      content.append(list);
    } else {
      list.querySelector("[data-more]")?.remove();
      list.querySelector("[data-mod-manager]")?.remove();
    }
    const loading = e("p", "muted", append ? "正在加载更多…" : "正在读取目录…");
    loading.dataset.loading = "true";
    list.append(loading);
    let result: InstanceFolderListing;
    try { result = await api("instances.browseFolder", { id: instanceId, folder, relativePath, offset }); }
    catch (error) { if (current === generation && modal.open) { loading.remove();list.append(e("p", "error", String(error))); } return; }
    if (current !== generation || !modal.open) return;
    loading.remove();
    if (!append && !result.entries.length) list.append(e("p", "muted instance-file-empty", "此目录为空。"));
    for (const entry of result.entries) {
      const row = e("div", "instance-file-row");
      if (entry.kind === "directory") row.append(button(`📁 ${entry.name}`, () => { relativePath = [...segments, entry.name].join("/"); offset = 0; void render(); }, "quiet instance-file-name"));
      else row.append(e("span", "instance-file-name", `📄 ${entry.name}`));
      row.append(e("span", "muted", entry.kind === "directory" ? "文件夹" : formatSize(entry.size)));
      list.append(row);
    }
    if (result.nextOffset !== undefined) {const more=button("加载更多文件", () => { offset = result.nextOffset!; void render(true); }, "quiet");more.dataset.more="true";list.append(more);}
    if (folder === "mods"&&!list.querySelector("[data-mod-manager]")) {const manage=button("打开内置 Mod 管理", () => { modal.close(); state.instanceId = instanceId; localStorage.setItem("instance", instanceId); go("mods"); }, "primary");manage.dataset.modManager="true";list.append(manage);}
  };
  void render().catch(notify);
  return modal;
}
