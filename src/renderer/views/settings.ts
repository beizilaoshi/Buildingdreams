import { homeContentSettingsCard } from '../components/home-content';
import { updateCard } from '../components/updates';
import { networkSettingsCard } from '../components/settings-network-card';
import { launchSettingsCard } from "../components/launch-settings";
import { choice } from "../components/choice";
import {
  api,
  state,
  selected,
  e,
  button,
  panel,
  field,
  input,
  instancePicker,
  notify,
  refresh,
  go,
} from "../ui";
import { dialog } from "../components/dialog";
import { taskCards } from "./download";
import "./settings-workbench.css";
import { settingsWorkbench, generalSettingsCard } from "../components/settings-workbench";
import type { JavaContext } from "../../shared/types";
import { accountManager } from "../components/account-manager";
import { pendingAppearanceSettings } from '../ui';
export function settings() {
  const workbench = settingsWorkbench();
  const node = workbench.node;
  workbench.add('updates', '更新', updateCard());
  workbench.add("general", "常用", generalSettingsCard());
  workbench.add('navigation','导航与标题',navigationSettingsCard());
  workbench.add('network', '下载网络', networkSettingsCard());
  const backup = panel('设置备份与恢复', '备份外观、内存和启动偏好；账号、密钥、本机路径、命令、参数与服务器信息不迁移。');
  const preview = e('div');
  backup.append(button('导出设置备份', async()=>{if(pendingAppearanceSettings.size)throw Error('外观尚未保存，请先在个性化中完成保存。');const path=await api('settings.export',undefined);if(path)notify('设置备份已导出');},'quiet'),button('选择备份并预览',async()=>{
    const result=await api('settings.importPreview',undefined);if(!result)return;
    preview.replaceChildren(e('p','',`将恢复 ${result.fields.length} 组设置：${result.fields.join('、')}`),...result.notes.map(note=>e('p','muted',note)),button('确认恢复',async()=>{if(pendingAppearanceSettings.size)throw Error('外观尚未保存，请先完成保存。');await api('settings.importApply',result.token);preview.replaceChildren();notify('设置已恢复');go('settings');},'primary'),button('取消',()=>preview.replaceChildren(),'quiet'));
  },'quiet'),preview);
  workbench.add('backup','备份与恢复',backup);
  const appearance = panel("个性化", "背景、材质、排版与首页文案，可保存为自己的外观方案。");
  appearance.append(button("打开个性化", () => go("personalize"), "primary"));
  workbench.add("appearance", "外观", appearance);
  const runtime = panel(
    "Java 与内存",
    "当前实例的配置独立保存；全局默认应用到新安装的游戏。",
  );
  runtime.append(instancePicker());
  const scope = choice(
    [
      ["instance", "当前实例"],
      ["global", "新游戏默认值"],
    ],
    selected() ? "instance" : "global",
  );
  const java = input();
  const javaMinMajor = input();
  javaMinMajor.type = "number";
  javaMinMajor.min = "1";
  javaMinMajor.max = "99";
  javaMinMajor.placeholder = "自动判断";
  const javaMaxMajor = input();
  javaMaxMajor.type = "number";
  javaMaxMajor.min = "1";
  javaMaxMajor.max = "99";
  javaMaxMajor.placeholder = "不限";
  const mode = choice(
    [
      ["auto", "自动选择"],
      ["instance", "仅使用当前版本目录 Java"],
      ["manual", "手动指定"],
    ],
    "auto",
  );
  mode.setAttribute("aria-label", "Java 选择方式");
  java.placeholder = "手动模式选择 java.exe 或 javaw.exe；保存后应用";
  const automatic = document.createElement("input");
  automatic.type = "checkbox";
  automatic.checked = state.settings.autoDownloadJava;
  automatic.onchange = () => {
    void api("settings.patch", { autoDownloadJava: automatic.checked })
      .then((value) => {
        state.settings = value;
        void showPlan();
      })
      .catch(notify);
  };
  const status = e("div", "java-plan-status muted");
  const advancedJava = document.createElement("details");
  advancedJava.className = "settings-advanced java-advanced";
  const advancedSummary = document.createElement("summary");
  advancedSummary.textContent = "高级 Java 设置";
  advancedJava.append(advancedSummary);
  status.setAttribute("role", "status");
  let generation = 0;
  const context = (): JavaContext =>
    scope.value === "instance" && selected()
      ? { instanceId: selected()!.id }
      : { family: 17 };
  const showPlan = async () => {
    const current = ++generation;
    try {
      if (scope.value === "global" && state.settings.javaPath) {
        const chosen = await api("java.inspect", state.settings.javaPath);
        if (current !== generation) return;
        status.replaceChildren(
          e(
            "p",
            "",
            "新游戏手动默认值；每个游戏在启动或运行加载器处理器前会检查兼容性。",
          ),
          e("p", "", `Java ${chosen.version} · ${chosen.arch}`),
          e("p", "", chosen.path),
        );
        return;
      }
      const plan = await api("java.plan", context());
      if (current !== generation) return;
      status.replaceChildren(
        e(
          "p",
          "",
          scope.value === "global"
            ? "新游戏默认使用按版本自动选择；以下是 Java 17 下载系列预览。实例要求以实际游戏元数据为准。"
            : plan.requirement.reason,
        ),
        e("p", plan.error ? "error" : "", plan.reason),
      );
      if (plan.selected) status.append(e("p", "", plan.selected.path));
    } catch (error) {
      if (current === generation) status.textContent = String(error);
    }
  };
  status.addEventListener("java-refresh", () => void showPlan());
  mode.onchange = () => {
    if (scope.value !== "instance" && mode.value === "instance") {
      mode.value = "auto";
      notify("仅使用当前版本目录 Java 仅适用于单个游戏实例");
    }
    java.disabled = mode.value !== "manual";
    if (mode.value === "manual") advancedJava.open = true;
    void showPlan();
  };

  const memory = input();
  memory.type = "number";
  memory.min = "512";
  memory.step = "512";
  const args = document.createElement("textarea");
  args.placeholder = "每行一个 JVM 参数";
  const fill = () => {
    const value = scope.value === "instance" ? selected() : state.settings;
    java.value = value?.javaPath ?? "";
    javaMinMajor.value = scope.value === "instance" && selected()?.javaMinMajor !== undefined ? String(selected()!.javaMinMajor) : "";
    javaMaxMajor.value = scope.value === "instance" && selected()?.javaMaxMajor !== undefined ? String(selected()!.javaMaxMajor) : "";
    javaMinMajor.disabled = scope.value !== "instance";
    javaMaxMajor.disabled = scope.value !== "instance";
    mode.value = java.value ? "manual" : scope.value === "instance" && selected()?.javaMode === "instance" ? "instance" : "auto";
    if (scope.value !== "instance" && mode.value === "instance") mode.value = "auto";
    java.disabled = mode.value !== "manual";
    advancedJava.open = mode.value === "manual";
    void showPlan();
    memory.value = String(value?.memoryMb ?? 4096);
    args.value = value?.javaArgs.join("\n") ?? "";
  };
  scope.onchange = fill;
  fill();
  const grid = e("div", "form-grid");
  grid.append(
    field("配置范围", scope),
    field("Java 选择方式", mode),
    field("缺少兼容 Java 时自动下载", automatic),
    field("最大内存（MB）", memory),
  );
  const advancedGrid = e("div", "form-grid");
  advancedGrid.append(
    field("Java 可执行文件", java),
    field("最低 Java 主版本（可选覆盖）", javaMinMajor),
    field("最高 Java 主版本（可选覆盖）", javaMaxMajor),
    field("JVM 参数（每行一个）", args),
  );
  const advancedTools = e("div", "row wrap");
  advancedTools.append(
    button(
      "选择 Java",
      async () => {
        const path = await api("dialog.choose", "java");
        if (path) {
          const result = await api("java.inspect", path);
          java.value = result.path;
          mode.value = "manual";
          java.disabled = false;
          advancedJava.open = true;
          notify(`Java ${result.version} · ${result.arch}`);
        }
      },
      "quiet",
    ),
    button(
      "自动检测 Java",
      async () => {
        const found = await api("java.detect", undefined);
        const body = e("div");
        if (!found.length)
          body.append(
            e(
              "p",
              "muted",
              "未检测到 Java。可使用自动配置下载经过校验的官方运行环境。",
            ),
          );
        for (const item of found)
          body.append(
            button(
              `Java ${item.version} · ${item.arch} · ${item.path}`,
              () => {
                java.value = item.path;
                mode.value = "manual";
                java.disabled = false;
                advancedJava.open = true;
                modal.close();
              },
              "version-row",
            ),
          );
        const modal = dialog("可用运行环境", body);
      },
      "quiet",
    ),
  );
  const saveConfig = button(
      "保存运行配置",
      async () => {
        if (scope.value !== "instance" && mode.value === "instance")
          throw new Error("仅使用当前版本目录 Java 仅适用于单个游戏实例");
        const patch = {
          memoryMb: Number(memory.value),
          javaArgs: args.value
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
          javaPath: mode.value === "manual" ? java.value : "",
          ...(scope.value === "instance" ? {
            javaMode: mode.value === "instance" ? "instance" as const : "auto" as const,
            javaMinMajor: javaMinMajor.value ? Number(javaMinMajor.value) : undefined,
            javaMaxMajor: javaMaxMajor.value ? Number(javaMaxMajor.value) : undefined,
          } : {}),
        };
        if (mode.value === "manual" && !java.value)
          throw new Error("请先选择 Java 可执行文件");
        if ((javaMinMajor.value && (!Number.isInteger(Number(javaMinMajor.value)) || Number(javaMinMajor.value) < 1 || Number(javaMinMajor.value) > 99)) ||
            (javaMaxMajor.value && (!Number.isInteger(Number(javaMaxMajor.value)) || Number(javaMaxMajor.value) < 1 || Number(javaMaxMajor.value) > 99)) ||
            (javaMinMajor.value && javaMaxMajor.value && Number(javaMinMajor.value) > Number(javaMaxMajor.value)))
          throw new Error("Java 自定义范围无效；主版本必须在 1–99，且最低版本不能高于最高版本");
        if (scope.value === "instance") {
          const item = selected();
          if (!item) throw new Error("请先选择实例");
          await api("instances.patch", { id: item.id, ...patch });
          await refresh();
        } else
          state.settings = await api("settings.patch", {
            ...patch,
            javaPath: patch.javaPath,
          });
        await showPlan();
        notify("运行配置已保存");
      },
      "primary",
    );
  const configure = button(
    "自动配置（缺少时下载）",
    async () => {
      if (mode.value === "manual")
        throw new Error(
          "当前为手动指定模式；请保存有效路径，或切换自动选择并保存",
        );
      if (mode.value === "instance")
        throw new Error("当前仅搜索该 Minecraft 版本目录，不会自动下载；请切换自动选择或手动指定 Java");
      if (scope.value === "instance") {
        const item = selected();
        if (!item) throw new Error("请先选择实例");
        await api("instances.patch", {
          id: item.id,
          memoryMb: item.memoryMb,
          javaArgs: item.javaArgs,
          javaPath: "",
          javaMode: "auto",
          javaMinMajor: javaMinMajor.value ? Number(javaMinMajor.value) : undefined,
          javaMaxMajor: javaMaxMajor.value ? Number(javaMaxMajor.value) : undefined,
        });
        await refresh();
      } else state.settings = await api("settings.patch", { javaPath: "" });
      await api("java.ensure", context());
      notify(`Java 配置已加入下载任务，可在下方取消。`);
      state.tasks = await api("tasks.list", undefined);
      runtime.querySelector(".task-list")?.replaceWith(taskCards());
      void showPlan();
    },
    "primary",
  );
  const tools = e("div", "row wrap");
  tools.append(configure, saveConfig);
  const downloads = e("div", "row");
  for (const major of [8, 16, 17, 21, 25] as const)
    downloads.append(
      button(
        `下载 Java ${major}`,
        async () => {
          await api("java.ensure", { family: major });
          notify(`Java ${major} 配置已加入任务；不会覆盖手动路径。`);
        },
        "quiet",
      ),
    );
  const note = e(
      "p",
      "muted",
      "自动模式按 Minecraft 元数据和加载器要求选择；仅版本目录模式仿照 PCL 只查当前版本文件夹；手动指定会覆盖自动兼容范围。自动下载优先按 Mojang 官方组件清单补全，旧版或无组件时使用 Temurin 官方 ZIP；不会修改系统 Java。",
    );
  advancedJava.append(advancedGrid, advancedTools, note, downloads);
  runtime.append(grid, status, tools, advancedJava, taskCards());
  workbench.add("runtime", "运行环境", runtime);
  const source = panel(
    "内容来源",
    "第三方启动器需申请并获准使用 CurseForge API；密钥权限可能限制搜索和指纹匹配。密钥仅发送给 CurseForge 官方 API。",
  );
  const key = input("", "输入 CurseForge API 密钥");
  key.type = "password";
  key.autocomplete = "off";
  const remember = document.createElement("input");
  remember.type = "checkbox";
  const providerStatus = e("p", "muted");
  providerStatus.setAttribute("role", "status");
  const statusText = (s: {
    configured: boolean;
    session: boolean;
    persisted: boolean;
    encryption: boolean;
  }) => {
    providerStatus.textContent = s.configured
      ? `CurseForge 已配置 · ${s.persisted ? "系统加密保存" : "仅本次会话"}`
      : "CurseForge 尚未配置；Modrinth 可直接使用";
    remember.disabled = !s.encryption;
    if (!s.encryption) remember.checked = false;
  };
  void api("content.providerStatus", undefined)
    .then(statusText)
    .catch(() => {
      providerStatus.textContent = "来源凭据状态不可用，可清除后重新配置";
    });
  source.append(
    providerStatus,
    field("CurseForge API 密钥", key),
    field("使用系统加密记住密钥", remember),
    button(
      "保存来源密钥",
      async () => {
        const result = await api("content.setProviderKey", {
          provider: "curseforge",
          key: key.value,
          remember: remember.checked,
        });
        key.value = "";
        statusText(result);
        notify("来源密钥已保存");
      },
      "primary",
    ),
    button(
      "清除来源密钥",
      async () => {
        statusText(
          await api("content.clearProviderKey", { provider: "curseforge" }),
        );
        key.value = "";
      },
      "quiet",
    ),
  );
  workbench.add("content", "内容与安装", source);
  const client = input(state.settings.microsoftClientId);
  workbench.add("accounts", "账号", accountManager((id) => {
    client.value = id;
  }));
  const advanced = document.createElement("details");
  advanced.className = "settings-advanced account-advanced";
  const accountSummary = document.createElement("summary");
  accountSummary.textContent = "Microsoft 登录高级配置";
  advanced.append(accountSummary, e("p", "muted", "Microsoft 公共客户端 ID 需要允许个人账号设备授权并具有 Minecraft 服务权限。"));
  advanced.append(
    field("Microsoft 客户端 ID", client),
    button(
      "保存客户端 ID",
      async () => {
        state.settings = await api("settings.patch", {
          microsoftClientId: client.value.trim(),
        });
        notify("客户端 ID 已保存");
      },
      "quiet",
    ),
  );
  workbench.add("accounts", "账号", advanced);
  const directory = input(state.settings.gameDirectory);
  const installation = panel("游戏安装目录", "用于新安装的游戏；已有游戏保留原位置。");
  installation.append(
    field("新游戏安装目录（留空使用应用数据目录）", directory),
    button(
      "选择安装目录",
      async () => {
        const path = await api("dialog.choose", "game");
        if (path) {
          directory.value = path;
          state.settings = await api("settings.patch", { gameDirectory: path });
          notify("新游戏安装目录已保存");
        }
      },
      "quiet",
    ),
    button(
      "保存安装目录",
      async () => {
        state.settings = await api("settings.patch", {
          gameDirectory: directory.value,
        });
        notify("安装目录已保存");
      },
      "quiet",
    ),
  );
  workbench.add("content", "内容与安装", installation);
  workbench.add("launch", "游戏启动", launchSettingsCard());
  workbench.add('appearance', '外观与主题', homeContentSettingsCard());
  workbench.finish();
  return node;
}
import { navigationSettingsCard } from '../components/navigation-settings';
