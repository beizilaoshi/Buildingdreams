import { minecraftGroup, type MinecraftVersion } from "../../shared/minecraft-versions";
import type { Instance } from "../../shared/types";
import { api, button, e, go, state } from "../ui";

/**
 * An explicit, read-only release check for the user's installed game versions.
 * It deliberately routes newer releases to the installer as a separate instance;
 * it never suggests that an existing vanilla/loader instance can be overwritten.
 */
export function gameVersionNotice() {
  const card = e("section", "glass panel game-version-notice");
  card.append(
    e("h2", "", "Minecraft 正式版动态"),
    e("p", "muted", "手动检查已安装版本与最新正式版。检查只读取版本清单，不会改动现有游戏。"),
  );

  const status = e("p", "muted", "尚未检查。" );
  status.setAttribute("role", "status");
  const rows = e("div", "game-version-notice-rows");
  const check = button("检查正式版更新", () => void checkVersions(), "quiet");
  const install = button("前往安装新版本", () => go("download"), "primary");
  install.hidden = true;
  card.append(check, status, rows, install);

  let generation = 0;
  async function checkVersions() {
    const current = ++generation;
    check.disabled = true;
    check.textContent = "正在检查…";
    status.textContent = "正在读取 Minecraft 官方版本清单…";
    rows.replaceChildren();
    install.hidden = true;
    try {
      const catalog = await api("install.catalog", undefined);
      if (current !== generation || !card.isConnected) return;
      const latestId = catalog.latest.release;
      const latest = latestId ? catalog.versions.find(version => version.id === latestId) : undefined;
      if (!latest || minecraftGroup(latest) !== "release") {
        status.textContent = "版本清单没有提供可用的最新正式版信息。";
        return;
      }

      const installed = state.instances.slice();
      const releaseRows = installed.map(instance => ({ instance, version: catalog.versions.find(version => version.id === instance.minecraft) }));
      const releases = releaseRows.filter(item => item.version && minecraftGroup(item.version) === "release");
      const newer = releases.filter(item => item.version!.id !== latest.id && isOlder(item.version!, latest));
      status.textContent = releases.length
        ? `最新正式版 ${latest.id} · 已识别 ${releases.length} 个正式版实例${newer.length ? ` · ${newer.length} 个可另行安装新版本` : ""}`
        : `最新正式版 ${latest.id} · 暂未识别到已安装的正式版实例。`;

      if (!installed.length) {
        rows.append(e("p", "muted", "游戏库为空，安装后可在这里对照正式版。"));
        return;
      }
      for (const { instance, version } of releaseRows) {
        const row = e("div", "row game-version-notice-row");
        row.style.justifyContent = "space-between";
        row.style.alignItems = "center";
        row.style.padding = "8px 0";
        row.style.borderBottom = "1px solid color-mix(in srgb, currentColor 10%, transparent)";
        const copy = e("div");
        copy.append(
          e("strong", "", instance.name),
          e("p", "muted", `${instance.minecraft} · ${instance.loader ? `${loaderName(instance)} 实例` : "原版实例"}`),
        );
        row.append(copy);
        if (!version) {
          row.append(e("span", "badge", "版本清单无记录"));
        } else if (minecraftGroup(version) !== "release") {
          row.append(e("span", "badge", "非正式版"));
        } else if (version.id === latest.id) {
          row.append(e("span", "badge", "已是最新正式版"));
        } else if (isOlder(version, latest)) {
          row.append(e("span", "badge", `可另装 ${latest.id}`));
        } else {
          row.append(e("span", "badge", "比最新正式版更新或时间未知"));
        }
        rows.append(row);
      }
      // Route to the normal version installer; the user chooses a separate target
      // instance and loader there. No in-place upgrade is attempted.
      install.hidden = newer.length === 0;
    } catch (error) {
      if (current === generation && card.isConnected) {
        status.textContent = error instanceof Error ? `检查失败：${error.message}` : "读取版本清单失败，请稍后重试。";
      }
    } finally {
      if (current === generation) {
        check.disabled = false;
        check.textContent = "重新检查";
      }
    }
  }

  return card;
}

function isOlder(installed: MinecraftVersion, latest: MinecraftVersion): boolean {
  const installedAt = Date.parse(installed.releaseTime ?? "");
  const latestAt = Date.parse(latest.releaseTime ?? "");
  // A missing/invalid publication time is insufficient evidence to recommend an update.
  return Number.isFinite(installedAt) && Number.isFinite(latestAt) && installedAt < latestAt;
}

function loaderName(instance: Instance): string {
  switch (instance.loader?.kind) {
    case "fabric": return "Fabric";
    case "quilt": return "Quilt";
    case "forge": return "Forge";
    case "neoforge": return "NeoForge";
    default: return "加载器";
  }
}
