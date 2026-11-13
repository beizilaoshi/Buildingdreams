import { choice } from "../components/choice";
import {
  api,
  selected,
  e,
  button,
  heading,
  panel,
  field,
  input,
  notify,
} from "../ui";
import { contentSearch } from "../components/content-browser";
import type { PackInstallOptions, PackPreview } from "../../shared/packs";
export function packs() {
  const node = e("div");
  node.append(
    heading("整合包", "在线发现、导入与导出，让精心搭配的冒险触手可及。"),
  );
  const local = panel(
    "本地整合包",
    "支持 .mrpack 与 CurseForge ZIP；缺失文件可在安装前逐项补全。",
  );
  const preview = e("div");
  let selectionGeneration = 0;
  let inspectionGeneration = 0;
  const name = input();
  const key = input();
  key.type = "password";
  key.autocomplete = "off";
  const optional = input();
  optional.type = "checkbox";
  optional.checked = true;
  local.append(
    button(
      "选择整合包文件",
      async () => {
        const selection = ++selectionGeneration;
        const chosen = await api("dialog.choose", "pack");
        if (!chosen || selection !== selectionGeneration) return;
        const generation = ++inspectionGeneration;
        const current = () => generation === inspectionGeneration;
        const mappings: NonNullable<PackInstallOptions["suppliedFiles"]> = [];
        key.value = "";
        preview.replaceChildren(e("p", "muted", "正在检查整合包…"));
        let inspected: PackPreview;
        try {
          inspected = await api("packs.inspect", chosen);
        } catch (error) {
          if (!current()) return;
          preview.replaceChildren(
            e("p", "error", "无法读取此整合包，请重新选择文件。"),
          );
          throw error;
        }
        if (!current()) return;
        const file = chosen;
        const info = inspected;
        preview.replaceChildren(
          e("h3", "", info.name),
          e(
            "p",
            "muted",
            `${info.format} · Minecraft ${info.minecraft} · ${info.loader?.kind ?? "原版"} · ${info.files.length} 个文件`,
          ),
        );
        name.value = info.name;
        preview.append(
          field("安装后的游戏名称", name),
          field("包含可选文件", optional),
        );
        if (info.missingFiles.length) {
          preview.append(
            e("h3", "", "需要补充的文件"),
            e(
              "p",
              "muted",
              "选择你已下载的文件，SHA-1 将自动计算。ZIP 请选择文件类型。也可填写临时 CurseForge API Key 自动解析。",
            ),
          );
          for (const missing of info.missingFiles) {
            const row = e("div", "version-row");
            const status = e(
              "span",
              "",
              `项目 ${missing.projectID} / 文件 ${missing.fileID} · 尚未提供`,
            );
            const target = choice([
              ["mods", "Mod"],
              ["resourcepacks", "资源包"],
              ["shaderpacks", "光影包"],
            ]);
            let pending = false;
            const chooseSupplied = button(
              "选择并校验",
              async () => {
                if (!current() || pending) return;
                pending = true;
                chooseSupplied.disabled = true;
                try {
                  const path = await api("dialog.choose", "supplied");
                  if (!current() || !path) return;
                  const sha1 = await api("packs.hashSupplied", path);
                  if (!current()) return;
                  const existing = mappings.findIndex(
                    (x) =>
                      x.projectID === missing.projectID && x.fileID === missing.fileID,
                  );
                  const entry = {
                    ...missing,
                    path,
                    sha1,
                    target: target.value as "mods" | "resourcepacks" | "shaderpacks",
                  };
                  if (existing >= 0) mappings[existing] = entry;
                  else mappings.push(entry);
                  status.textContent = `项目 ${missing.projectID} / 文件 ${missing.fileID} · 已校验 ${sha1.slice(0, 10)}…`;
                  target.onchange = () => {
                    if (current()) entry.target = target.value as typeof entry.target;
                  };
                } catch (error) {
                  if (current()) throw error;
                } finally {
                  pending = false;
                  chooseSupplied.disabled = false;
                }
              },
              "quiet",
            );
            row.append(
              status,
              field("文件类型", target),
              chooseSupplied,
            );
            preview.append(row);
          }
          preview.append(field("临时 CurseForge API Key（不保存）", key));
        }
        let installing = false;
        const installButton = button(
          "安装整合包",
          async () => {
            if (!current() || installing) return;
            const payload = {
              file,
              name: name.value,
              options: {
                includeOptional: optional.checked,
                suppliedFiles: mappings.map((entry) => ({ ...entry })),
                ...(key.value ? { curseForgeKey: key.value } : {}),
              },
            };
            installing = true;
            installButton.disabled = true;
            try {
              await api("packs.install", payload);
              if (!current()) return;
              key.value = "";
              notify("整合包安装已加入任务");
            } catch (error) {
              if (current()) throw error;
            } finally {
              installing = false;
              installButton.disabled = false;
            }
          },
          "primary",
        );
        preview.append(installButton);
      },
      "primary",
    ),
    preview,
  );
  const exportPanel = panel(
    "导出当前实例",
    "勾选要分享的本地覆盖文件。默认不选择；已校验下载来源的文件保留为引用。已知敏感文件名、日志与存档强制排除，普通配置仍可能含隐私，请检查内容。",
  );
  const exportItem = selected();
  const exportFiles = e("div", "export-files");
  const checks = new Map<string, HTMLInputElement>();
  const exportButton = button(
    "导出整合包",
    async () => {
      if (!exportItem) throw new Error("请先选择实例");
      const destination = await api("dialog.choose", "export");
      if (destination) {
        await api("packs.export", {
          instanceId: exportItem.id,
          destination,
          options: {
            overridePaths: [...checks]
              .filter(([, check]) => check.checked)
              .map(([path]) => path),
          },
        });
        notify("导出已加入任务");
      }
    },
    "primary",
  );
  exportButton.disabled = true;
  let exportGeneration = 0;
  const loadExportFiles = async () => {
    if (!exportItem) return;
    const generation = ++exportGeneration;
    exportButton.disabled = true;
    checks.clear();
    exportFiles.replaceChildren(e("p", "muted", "正在检查导出文件…"));
    const inventory = await api("packs.previewExport", exportItem.id);
    if (generation !== exportGeneration) return;
    exportFiles.replaceChildren(e("h3", "", "本地覆盖文件（请明确勾选）"));
    if (!inventory.overrides.length)
      exportFiles.append(e("p", "muted", "没有可选择的本地覆盖文件。"));
    for (const file of inventory.overrides) {
      const label = e("label", "glass version-row export-file");
      const check = input();
      check.type = "checkbox";
      check.setAttribute("aria-label", file.path);
      checks.set(file.path, check);
      label.append(
        check,
        e("span", "", file.path),
        e("span", "muted", `${file.size.toLocaleString()} 字节`),
      );
      exportFiles.append(label);
    }
    exportFiles.append(
      e("h3", "", `已校验下载引用 · ${inventory.references.length} 个`),
    );
    for (const file of inventory.references)
      exportFiles.append(
        e(
          "p",
          "glass version-row",
          `${file.path} · ${file.fileSize.toLocaleString()} 字节 · 下载引用`,
        ),
      );
    exportButton.disabled = false;
  };
  exportPanel.append(
    e("p", "muted", exportItem?.name ?? "请先选择一个游戏实例"),
    button("刷新导出文件", loadExportFiles, "quiet"),
    button(
      "全选覆盖文件",
      () => {
        for (const check of checks.values()) check.checked = true;
      },
      "quiet",
    ),
    button(
      "清空选择",
      () => {
        for (const check of checks.values()) check.checked = false;
      },
      "quiet",
    ),
    exportFiles,
    exportButton,
  );
  void loadExportFiles().catch(notify);
  node.append(contentSearch("modpack"), local, exportPanel);
  return node;
}
