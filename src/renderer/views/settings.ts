import { updateCard } from '../components/updates';
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
export function settings() {
  const workbench = settingsWorkbench();
  const node = workbench.node;
  workbench.add('updates', '更新', updateCard());
  workbench.add("general", "常用", generalSettingsCard());
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
  const mode = choice(
    [
      ["auto", "自动选择"],
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
    java.disabled = mode.value === "auto";
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
    mode.value = java.value ? "manual" : "auto";
    java.disabled = mode.value === "auto";
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
    field("Java 可执行文件", java),
    field("缺少兼容 Java 时自动下载", automatic),
    field("最大内存（MB）", memory),
    field("JVM 参数（每行一个）", args),
  );
  const tools = e("div", "row");
  tools.append(
    button(
      "选择 Java",
      async () => {
        const path = await api("dialog.choose", "java");
        if (path) {
          const result = await api("java.inspect", path);
          java.value = result.path;
          mode.value = "manual";
          java.disabled = false;
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
                modal.close();
              },
              "version-row",
            ),
          );
        const modal = dialog("可用运行环境", body);
      },
      "quiet",
    ),
    button(
      "保存运行配置",
      async () => {
        const patch = {
          memoryMb: Number(memory.value),
          javaArgs: args.value
            .split("\n")
            .map((x) => x.trim())
            .filter(Boolean),
          javaPath: mode.value === "auto" ? "" : java.value,
        };
        if (mode.value === "manual" && !java.value)
          throw new Error("请先选择 Java 可执行文件");
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
    ),
  );
  const configure = button(
    "自动配置（缺少时下载）",
    async () => {
      if (mode.value === "manual")
        throw new Error(
          "当前为手动指定模式；请保存有效路径，或切换自动选择并保存",
        );
      if (scope.value === "instance") {
        const item = selected();
        if (!item) throw new Error("请先选择实例");
        await api("instances.patch", {
          id: item.id,
          memoryMb: item.memoryMb,
          javaArgs: item.javaArgs,
          javaPath: "",
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
  tools.prepend(configure);
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
  runtime.append(
    grid,
    status,
    e(
      "p",
      "muted",
      "自动模式每次按游戏要求选择；缺少时从 Eclipse Adoptium 下载 Windows x64 ZIP（保留许可证）。下载不修改系统 Java。手动指定优先，兼容性不符会提示。",
    ),
    tools,
    downloads,
    taskCards(),
  );
  workbench.add("runtime", "运行环境", runtime);
  const source = panel(
    "内容来源",
    "CurseForge 使用你申请的 API 密钥；仅发送给官方 API。",
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
  const advanced = panel(
    "Microsoft 登录配置",
    "Microsoft 公共客户端 ID 需要允许个人账号设备授权并具有 Minecraft 服务权限。",
  );
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
  workbench.finish();
  return node;
}
