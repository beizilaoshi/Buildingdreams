import { installTarget } from "../components/install-target";
import { versionBrowser } from "../components/version-browser";
import { choice } from "../components/choice";
import {
  api,
  state,
  e,
  button,
  heading,
  panel,
  field,
  input,
  notify,
} from "../ui";
import type { LoaderKind } from "../../shared/types";
export { taskCards } from "../components/task-list";
import { taskCards } from "../components/task-list";
let draft: {version: string; name: string; custom: boolean; loader: string; loaderVersion: string} | undefined;
let activeView: symbol;
export function download() {
  const owner = activeView = Symbol();
  let constructing = true;
  const restored = draft;
  const node = e("div");
  node.append(heading("下载与安装", "选择游戏与加载器版本，查看安装任务。"));
  const form = panel("安装 Minecraft", "所有文件经过校验后才会加入游戏库。");
  form.classList.add("version-install-detail");
  const name = input("", "游戏名称");
  let customName = draft?.custom ?? false;
  name.value = draft?.name ?? "";
  const target = installTarget(name, () => updateInstallState());
  const ownsDraft = () => activeView === owner && (constructing || node.isConnected);
  const autoName = () => {
    if (!ownsDraft()) return;
    if (!customName) { name.value = `Minecraft ${version.value}${loader.value ? ` ${loader.value} ${loaderVersion.value}` : ""}`.trim(); target.schedule(); }
  };
  name.oninput = () => { customName = true; target.schedule(); };
  const version = { value: draft?.version ?? "" };
  const detailTitle = form.querySelector("h2")!;
  const loader = choice([
    ["", "原版"],
    ["fabric", "Fabric"],
    ["quilt", "Quilt"],
    ["forge", "Forge"],
    ["neoforge", "NeoForge"],
  ]);
  const loaderVersion = choice([], "", true);
  const loaderVersionField = field("加载器版本", loaderVersion);
  const loaderStatus = e("p", "muted");
  loaderStatus.setAttribute("role", "status");
  let loading = false;
  let loadersPending = false;
  let loaderFailed = false;
  let loaderGeneration = 0;
  const updateInstallState = () => {
    if (!ownsDraft()) return;
    draft = {version: version.value, name: name.value, custom: customName, loader: loader.value, loaderVersion: loaderVersion.value};
    installButton.disabled =
      loading || target.blocked() ||
      !version.value ||
      loadersPending ||
      Boolean(loader.value && !loaderVersion.value);
    installButton.textContent = target.busy() ? "安装任务进行中…" : "开始安装";
    loaderRetry.hidden = !loaderFailed;
    loaderRetry.disabled = loadersPending;
  };
  const reloadLoaders = async (retrying = false) => {
    const generation = ++loaderGeneration;
    const requestedKind = loader.value;
    const requestedMinecraft = version.value;
    if (!retrying) loaderFailed = false;
    loaderVersion.setOptions([]);
    loadersPending = Boolean(requestedKind && requestedMinecraft);
    loaderVersion.disabled = true;
    loaderVersionField.hidden = !requestedKind;
    updateInstallState();
    loaderStatus.textContent = loadersPending
      ? "正在获取加载器版本…"
      : "原版安装无需加载器。";
    autoName();
    target.schedule();
    if (!loadersPending) return;
    const current = () =>
      ownsDraft() && node.isConnected && generation === loaderGeneration &&
      loader.value === requestedKind &&
      version.value === requestedMinecraft;
    try {
      const versions = await api("loaders.versions", {
        kind: requestedKind as LoaderKind,
        minecraft: requestedMinecraft,
      });
      if (!current()) return;
      loaderFailed = false;
      loaderVersion.setOptions(
        versions.map((x) => ({
          value: x.version,
          label: `${x.version}${x.stable ? " · 稳定" : ""}`,
        })),
        restored?.version === requestedMinecraft && restored.loader === requestedKind && versions.some(x => x.version === restored.loaderVersion) ? restored.loaderVersion : undefined,
      );
      loaderVersion.disabled = !versions.length;
      autoName();
      loaderStatus.textContent = versions.length
        ? "请选择需要安装的加载器版本。"
        : "此 Minecraft 版本暂无可用加载器。";
    } catch (error) {
      if (current()) {
        loaderFailed = true;
        loaderStatus.textContent = "加载器版本获取失败，可重试。";
        notify(error);
      }
    } finally {
      if (current()) {
        loadersPending = false;
        updateInstallState();
      }
    }
  };
  const loaderRetry = button("重试获取加载器", () => {
    if (loadersPending || !loaderFailed) return;
    return reloadLoaders(true);
  }, "quiet");
  loaderRetry.hidden = true;

  if (draft?.loader) loader.value = draft.loader;
  loader.onchange = () => void reloadLoaders().catch(notify);
  loaderVersion.onchange = () => { autoName(); updateInstallState(); };
  const grid = e("div", "form-grid");
  grid.append(
    field("游戏名称", name),

    field("加载器", loader),
    loaderVersionField,
  );
  const installButton = button(
    "开始安装",
    async () => {
      if (loading || loadersPending) return;
      if (!version.value) throw new Error("请先选择 Minecraft 版本");
      if (loader.value && !loaderVersion.value)
        throw new Error("请选择加载器版本");
      loading = true;
      updateInstallState();
      try {
        await target.submit({
          name: name.value,
          version: version.value,
          ...(loader.value
            ? {
                loader: {
                  kind: loader.value as LoaderKind,
                  version: loaderVersion.value,
                },
              }
            : {}),
        });
      } finally {
        loading = false;
        updateInstallState();
      }
    },
    "primary",
  );
  form.append(grid, button("恢复自动名称", () => { customName = false; autoName(); }, "quiet"), target.node, loaderStatus, loaderRetry, e("p","muted","Java 按实际游戏与加载器要求自动选择；缺少时会在下载任务中配置并校验官方运行环境。可在设置中关闭自动下载或手动指定。"), installButton);
  updateInstallState();
  const browser = versionBrowser((item) => {
    version.value = item.id;
    detailTitle.textContent = `安装 ${item.id}`;
    browser.node.hidden = true;
    form.hidden = false;
    node.closest("main")?.scrollTo({ top: 0 });
    void reloadLoaders();
    detailTitle.tabIndex = -1;
    detailTitle.focus({ preventScroll: true });
  });
  form.prepend(
    button(
      "返回版本列表",
      () => {
        form.hidden = true;
        browser.node.hidden = false;
        browser.focusSelection();
      },
      "quiet",
    ),
  );
  form.hidden = !version.value;
  if (version.value) { browser.node.hidden = true; detailTitle.textContent = `安装 ${version.value}`; void reloadLoaders(); }
  const tasks = panel("下载任务");
  tasks.append(taskCards());
  node.append(browser.node, form, tasks);
  void api("install.catalog", undefined)
    .then((catalog) => browser.setCatalog(catalog))
    .catch((error) => {
      browser.error();
      notify(error);
    });
  constructing = false;
  return node;
}
