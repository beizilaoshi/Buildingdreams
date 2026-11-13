import type {
  ContentProject,
  ContentVersion,
  ContentKind,
  ResourceKind,
} from "../../shared/content";
import { newPackName } from "../../shared/content";
import {
  contentGroups,
  versionFilters,
  type ContentGroup,
} from "../../shared/content-groups";
import { api, e, button, input, field, notify, state } from "../ui";
import { choice } from "./choice";
import { dialog } from "./dialog";
import {
  projectRow,
  projectIdentity,
  type ProjectIdentity,
} from "./content-project-row";
interface Target {
  minecraft: string;
  loader: string;
  instance?: { id: string; name: string; minecraft: string; loader?: string };
}
export function projectDetail(
  hit: ProjectIdentity,
  type: ContentKind,
  target: Target,
  open: (hit: ProjectIdentity) => void,
  back: () => void,
  nested: boolean,
) {
  const node = e("section", "glass panel content-detail");
  node.append(
    button(nested ? "返回上一级" : "返回搜索结果", back, "quiet content-back"),
  );
  const header = e("div");
  header.append(projectRow(hit));
  const actions = e("div", "row content-project-actions");
  const status = e("div", "content-project-status");
  const versionsHost = e("div", "content-version-browser");
  node.append(header, actions, status, versionsHost);
  let project: ContentProject | undefined,
    versions: ContentVersion[] | undefined,
    filterValue: string | undefined;
  const expanded = new Set<string>();
  const limits = new Map<string, number>();
  const dependencies = new Map<string, Promise<ContentProject>>();
  let loadGeneration = 0;
  const showError = (error: unknown) =>
    e("p", "error", error instanceof Error ? error.message : String(error));
  const save = async (version: ContentVersion, filename: string) => {
    const task = await api("content.saveVersion", {
      projectId: hit.project_id,
      versionId: version.id,
      filename,
    });
    if (task) notify("文件下载已加入任务");
  };
  const installPack = (version: ContentVersion) => {
    const body = e("div");
    const name = input(
      (project?.title ?? hit.title)
        .replace(/[\\/:<>"|?*\x00-\x1f]/g, " ")
        .replace(/[. ]+$/g, "")
        .slice(0, 80),
    );
    const error = e("p", "error");
    const submit = button(
      "创建并安装",
      async () => {
        let value: string;
        try {
          value = newPackName(name.value);
        } catch (err) {
          error.textContent = err instanceof Error ? err.message : String(err);
          return;
        }
        if (
          state.instances.some(
            (i) =>
              i.name.toLowerCase() === value.toLowerCase() ||
              i.versionId.toLowerCase() === value.toLowerCase(),
          )
        ) {
          error.textContent = "实例名称已存在，请使用其他名称";
          return;
        }
        submit.disabled = true;
        try {
          await api("packs.installOnline", {
            projectId: hit.project_id,
            filename: (version.files.find(
              (f) => f.primary && /\.(mrpack|zip)$/i.test(f.filename),
            ) ??
              version.files.find((f) => /\.(mrpack|zip)$/i.test(f.filename)))!
              .filename,
            versionId: version.id,
            name: value,
          });
          notify("整合包安装已加入任务");
          modal.close();
        } catch (err) {
          error.textContent = err instanceof Error ? err.message : String(err);
          submit.disabled = false;
        }
      },
      "primary",
    );
    body.append(
      e("p", "muted", `${hit.title} · ${version.name} · 将创建独立游戏实例`),
      field("新实例名称", name),
      error,
      submit,
    );
    const modal = dialog("安装整合包版本", body);
  };
  const installMod = (version: ContentVersion) => {
    const instance = target.instance;
    if (!instance) throw new Error("请先在游戏库选择一个实例，再打开项目详情");
    const body = e("div");
    body.append(
      e(
        "p",
        "",
        `${version.name} → ${instance.name} · Minecraft ${instance.minecraft} · ${instance.loader ?? "原版"}`,
      ),
      e("p", "muted", "将校验兼容性并安装此版本及必需依赖。"),
      button(
        "确认安装到此实例",
        async () => {
          await api("mods.install", {
            instanceId: instance.id,
            versionId: version.id,
          });
          notify("模组安装已加入任务");
          modal.close();
        },
        "primary",
      ),
    );
    const modal = dialog("安装模组", body);
  };
  const installResource = async (version: ContentVersion, filename: string) => {
    const instance = target.instance;
    if (!instance) throw new Error("请先选择安装实例并重新打开详情");
    const body = e("div"),
      error = e("p", "error"),
      summary = e("p");
    let worldId: string | undefined;
    const updateSummary = () => {
      summary.textContent = `${filename} → ${instance.name} · Minecraft ${instance.minecraft}${worldId ? ` · 存档 ${worldId}` : ""}`;
    };
    updateSummary();
    const submit = button(
      "确认安装所选文件",
      async () => {
        submit.disabled = true;
        try {
          await api("content.installResource", {
            instanceId: instance.id,
            kind: type as ResourceKind,
            projectId: hit.project_id,
            versionId: version.id,
            filename,
            ...(worldId ? { worldId } : {}),
          });
          notify("所选文件安装已加入任务，请在任务页查看结果");
          modal.close();
        } catch (err) {
          error.textContent = err instanceof Error ? err.message : String(err);
          submit.disabled = type === "datapack" && !worldId;
        }
      },
      "primary",
    );
    body.append(
      summary,
      e(
        "p",
        "muted",
        "仅安装所选文件。必需前置资源需另行核实和安装；同名文件不会被覆盖。",
      ),
    );
    if (type === "shader")
      body.append(
        e(
          "p",
          "muted",
          "使用光影需要兼容的 Iris / OptiFine，请自行安装对应环境。",
        ),
      );
    const worldsHost = e("div");
    if (type === "datapack") {
      submit.disabled = true;
      worldsHost.append(e("p", "muted", "正在读取现有存档…"));
      body.append(worldsHost);
    }
    body.append(error, submit);
    const modal = dialog("安装资源文件", body);
    if (type === "datapack") {
      try {
        const worlds = await api("content.worlds", { instanceId: instance.id });
        worldsHost.replaceChildren();
        if (!worlds.length)
          worldsHost.append(
            e(
              "p",
              "muted",
              "没有可用存档。请先在此实例创建并保存世界，再重新打开安装；也可以使用另存为。",
            ),
          );
        else {
          const choices = choice(
            worlds.map((w) => [w.id, w.name]),
            "",
            true,
            true,
          );
          choices.setAttribute("aria-label", "目标存档");
          choices.onchange = () => {
            worldId = choices.value;
            updateSummary();
            submit.disabled = !worldId;
          };
          worldsHost.append(
            e("p", "muted", "选择现有存档（最多显示 200 个有效存档）"),
            choices,
          );
        }
      } catch (err) {
        worldsHost.replaceChildren(
          showError(err),
          e("p", "muted", "请检查存档后重试，或使用另存为。"),
        );
      }
    }
  };
  const dependencyProject = (dep: ContentVersion["dependencies"][number]) => {
    const key = dep.project_id ?? `version:${dep.version_id}`;
    let promise = dependencies.get(key);
    if (!promise) {
      promise = (async () => {
        const projectId =
          dep.project_id ??
          (dep.version_id
            ? (await api("content.version", { versionId: dep.version_id }))
                .project_id
            : undefined);
        if (!projectId) throw new Error("未提供项目信息");
        return api("content.project", { projectId });
      })();
      if (dependencies.size >= 128)
        dependencies.delete(dependencies.keys().next().value!);
      dependencies.set(key, promise);
    }
    return promise;
  };
  const addDependencies = (body: HTMLElement, group: ContentGroup) => {
    const unique = new Map<string, ContentVersion["dependencies"][number]>();
    const unknown = group.versions
      .flatMap((v) => v.dependencies)
      .filter(
        (d) =>
          d.dependency_type === "required" && !d.project_id && !d.version_id,
      ).length;
    if (unknown)
      body.append(
        e("p", "muted", `${unknown} 个前置资源缺少项目标识，安装前需要核实。`),
      );
    for (const version of group.versions)
      for (const dep of version.dependencies)
        if (
          dep.dependency_type === "required" &&
          (dep.project_id || dep.version_id)
        )
          unique.set(dep.project_id ?? `version:${dep.version_id}`, dep);
    if (!unique.size) return;
    const holder = e("div", "content-dependencies");
    holder.append(e("h3", "", "前置资源"));
    body.append(holder);
    const dependencyLimit = limits.get("deps:" + group.key) ?? 30;
    const entries = [...unique.entries()].slice(0, dependencyLimit);
    const jobs = entries.map(([key, dep]) => {
      const slot = e("div", "content-dependency-slot");
      slot.append(e("p", "muted", `正在读取前置项目 ${key}…`));
      holder.append(slot);
      return async () => {
        try {
          const info = await dependencyProject(dep);
          slot.replaceChildren(
            projectRow(projectIdentity(info), () =>
              open(projectIdentity(info)),
            ),
          );
        } catch {
          slot.replaceChildren(
            e("p", "muted", `前置项目 ${key} · 信息暂不可用`),
            button(
              "重新读取前置项目",
              () => {
                dependencies.delete(key);
                return dependencyProject(dep).then((info) =>
                  slot.replaceChildren(
                    projectRow(projectIdentity(info), () =>
                      open(projectIdentity(info)),
                    ),
                  ),
                );
              },
              "quiet",
            ),
          );
        }
      };
    });
    // Bound concurrent project/team requests, including large dependency graphs.
    void Promise.all(
      Array.from({ length: Math.min(4, jobs.length) }, async () => {
        while (jobs.length) await jobs.shift()!();
      }),
    );
    if (unique.size > dependencyLimit) {
      const more = button(
        "显示更多前置资源",
        () => {
          limits.set("deps:" + group.key, dependencyLimit + 30);
          renderVersions();
        },
        "quiet",
      );
      more.dataset.contentFocus = "deps:" + group.key;
      holder.append(more);
    }
  };
  const fileVersionRow = (version: ContentVersion, duplicates: Set<string>) => {
    const row = e("article", "content-file-version");
    const primary = version.files.find((f) => f.primary) ?? version.files[0];
    row.append(
      e(
        "h4",
        "",
        duplicates.has(version.name)
          ? (primary?.filename ?? version.name)
          : version.name,
      ),
    );
    const releaseType = version.version_type
      ? { release: "● 正式版", beta: "◐ 测试版", alpha: "◌ 实验版" }[
          version.version_type
        ]
      : "类型未知";
    const requiredCount = version.dependencies.filter(
      (d) => d.dependency_type === "required",
    ).length;
    row.append(
      e(
        "p",
        "muted",
        `${new Date(version.date_published).toLocaleDateString("zh-CN")} · ${releaseType} · ${version.game_versions.join("、")} · ${version.loaders.join(" / ")}${requiredCount ? ` · ${requiredCount} 个前置` : ""}${version.downloads ? ` · ${version.downloads.toLocaleString()} 次下载` : ""}`,
      ),
    );
    const tools = e("div", "row content-file-actions");
    if (type === "modpack") {
      const install = button(
        "安装此版本",
        () => installPack(version),
        "primary",
      );
      install.disabled =
        !project ||
        !version.files.some(
          (f) =>
            !f.unavailableReason &&
            f.url &&
            /\.(mrpack|zip)$/i.test(f.filename),
        );
      tools.append(install);
    } else if (type === "mod") {
      const install = button(
        target.instance ? `安装到 ${target.instance.name}` : "未选择安装实例",
        () => installMod(version),
        "quiet",
      );
      install.disabled =
        !project ||
        !primary?.url ||
        !!primary.unavailableReason ||
        !target.instance ||
        !version.game_versions.includes(target.instance.minecraft) ||
        (!!target.instance.loader &&
          !version.loaders.includes(target.instance.loader));
      tools.append(install);
    }
    for (const file of version.files) {
      if (!["mod", "modpack"].includes(type) && /\.zip$/i.test(file.filename)) {
        const install = button(
          target.instance
            ? `安装 ${file.filename} 到 ${target.instance.name}`
            : `未选择安装实例 · ${file.filename}`,
          () => installResource(version, file.filename),
          "primary",
        );
        install.disabled =
          !project ||
          !file.url ||
          !!file.unavailableReason ||
          !target.instance ||
          !version.game_versions.includes(target.instance.minecraft) ||
          (type === "datapack" && !version.loaders.includes("datapack"));
        tools.append(install);
      }
      const action = button(
        `另存为 ${file.filename}`,
        () => save(version, file.filename),
        type === "mod" && file === primary ? "primary" : "quiet",
      );
      action.title = `${file.size.toLocaleString()} 字节 · 保存已校验文件`;
      action.disabled = !project || !file.url || !!file.unavailableReason;
      tools.append(action);
      if (file.unavailableReason) {
        tools.append(e("p", "muted", file.unavailableReason));
        if (file.website)
          tools.append(
            button(
              "前往官方文件页面",
              () =>
                api("content.openFilePage", {
                  versionId: version.id,
                  filename: file.filename,
                }),
              "quiet",
            ),
          );
      }
    }
    if (!version.files.length)
      tools.append(e("p", "muted", "此版本没有可下载文件"));
    row.append(tools);
    return row;
  };
  const renderVersions = () => {
    if (!versions) return;
    const focused =
      document.activeElement instanceof HTMLElement &&
      versionsHost.contains(document.activeElement)
        ? document.activeElement
        : undefined;
    const focusedKey = focused?.dataset.contentFocus;
    const focusedFilter =
      focused?.getAttribute("role") === "radio"
        ? focused.dataset.value
        : undefined;
    versionsHost.replaceChildren();
    const filters = versionFilters(versions);
    if (filterValue === undefined)
      filterValue = versions.some((v) =>
        v.game_versions.includes(target.minecraft),
      )
        ? filters.label(target.minecraft)
        : "";
    if (filters.labels.length > 1) {
      const filter = choice(
        [
          ["", "全部"],
          ...filters.labels.map((label) => [label, label] as [string, string]),
        ],
        filterValue,
      );
      filter.onchange = () => {
        filterValue = filter.value;
        renderVersions();
      };
      versionsHost.append(field("Minecraft 版本筛选", filter));
    }
    const visible = versions.filter(
      (v) =>
        !filterValue ||
        v.game_versions.some((mc) => filters.label(mc) === filterValue),
    );
    const groups = contentGroups(
      visible,
      type,
      target.minecraft,
      target.loader,
    );
    if (!groups.length) {
      versionsHost.append(e("p", "muted", "没有符合条件的版本。"));
      return;
    }
    const maxGroups = limits.get("__groups") ?? 24;
    for (const group of groups.slice(0, maxGroups)) {
      const card = e("section", "content-version-group");
      const label = `${group.key}${group.recommended ? "（所选版本）" : ""}`;
      // Initialize only once; closing a recommended group stays closed until this detail is left.
      const marker = "init:" + group.key;
      if (!limits.has(marker)) {
        limits.set(marker, 1);
        if (group.recommended || groups.length === 1) expanded.add(group.key);
      }
      const toggle = button(
        `${expanded.has(group.key) ? "⌄" : "›"} ${label} · ${group.versions.length} 个版本`,
        () => {
          expanded.has(group.key)
            ? expanded.delete(group.key)
            : expanded.add(group.key);
          renderVersions();
        },
        "content-group-toggle",
      );
      toggle.dataset.contentFocus = "group:" + group.key;
      toggle.setAttribute("aria-expanded", String(expanded.has(group.key)));
      card.append(toggle);
      if (expanded.has(group.key)) {
        const body = e("div", "content-group-body");
        if (group.minecraft === "其他")
          body.append(
            e("p", "muted", "版本元数据可能尚未更新，请在下载前确认兼容性。"),
          );
        if (type !== "modpack") addDependencies(body, group);
        body.append(e("h3", "", "版本列表"));
        const names = new Set<string>(),
          duplicates = new Set<string>();
        for (const version of group.versions) {
          if (names.has(version.name)) duplicates.add(version.name);
          names.add(version.name);
        }
        const limit = limits.get(group.key) ?? 20;
        for (const version of group.versions.slice(0, limit))
          body.append(fileVersionRow(version, duplicates));
        if (group.versions.length > limit) {
          const more = button(
            "显示更多版本",
            () => {
              limits.set(group.key, limit + 20);
              renderVersions();
            },
            "quiet",
          );
          more.dataset.contentFocus = "more:" + group.key;
          body.append(more);
        }
        card.append(body);
      }
      versionsHost.append(card);
    }
    if (groups.length > maxGroups) {
      const more = button(
        "显示更多版本分组",
        () => {
          limits.set("__groups", maxGroups + 24);
          renderVersions();
        },
        "quiet",
      );
      more.dataset.contentFocus = "more-groups";
      versionsHost.append(more);
    }
    if (focusedFilter !== undefined)
      Array.from(versionsHost.querySelectorAll<HTMLElement>('[role="radio"]'))
        .find((n) => n.dataset.value === focusedFilter)
        ?.focus({ preventScroll: true });
    else if (focusedKey) {
      const keys = Array.from(
        versionsHost.querySelectorAll<HTMLElement>("[data-content-focus]"),
      );
      (
        keys.find((n) => n.dataset.contentFocus === focusedKey) ??
        keys.find(
          (n) =>
            n.dataset.contentFocus ===
            "group:" + focusedKey.replace(/^more:/, ""),
        ) ??
        keys[0]
      )?.focus({ preventScroll: true });
    }
  };
  const load = async () => {
    const generation = ++loadGeneration;
    status.replaceChildren(e("p", "muted", "正在读取项目资料…"));
    versionsHost.replaceChildren(e("p", "muted", "正在获取版本列表…"));
    const projectJob = api("content.project", { projectId: hit.project_id })
      .then((info) => {
        if (generation !== loadGeneration) return;
        if (
          type === "datapack"
            ? !["mod", "datapack"].includes(info.projectType)
            : info.projectType !== type
        )
          throw new Error("项目类型与搜索结果不匹配");
        project = info;
        header.replaceChildren(projectRow(projectIdentity(info, hit.author)));
        status.replaceChildren();
        if (type === "shader")
          status.append(
            e(
              "p",
              "muted",
              "光影需要兼容的 Iris / OptiFine 环境，安装仅保存所选文件。",
            ),
          );
        if (versions) renderVersions();
        actions.replaceChildren(
          button(
            info.provider === "curseforge"
              ? "转到 CurseForge"
              : "转到 Modrinth",
            () =>
              api("content.openProject", {
                projectId: info.id,
                link: "website",
              }),
            "quiet",
          ),
          button(
            "复制名称",
            () =>
              api("content.copyName", { projectId: info.id }).then(() =>
                notify("已复制项目名称"),
              ),
            "quiet",
          ),
        );
        for (const [key, label] of [
          ["source_url", "源代码"],
          ["issues_url", "问题反馈"],
          ["wiki_url", "项目 Wiki"],
        ] as const)
          if (info[key])
            actions.append(
              button(
                label,
                () =>
                  api("content.openProject", { projectId: info.id, link: key }),
                "quiet",
              ),
            );
        if (info.license)
          status.append(
            e(
              "p",
              "muted",
              `${info.license} · ${info.followers.toLocaleString()} 人关注`,
            ),
          );
      })
      .catch((error) => {
        if (generation === loadGeneration) {
          status.replaceChildren(
            showError(error),
            button("重试项目资料", load, "quiet"),
          );
        }
      });
    const versionsJob = api("content.versions", {
      projectId: hit.project_id,
      filter: { projectType: type },
    })
      .then((items) => {
        if (generation !== loadGeneration) return;
        versions = items;
        renderVersions();
      })
      .catch((error) => {
        if (generation === loadGeneration)
          versionsHost.replaceChildren(
            showError(error),
            button("重试版本列表", load, "quiet"),
          );
      });
    await Promise.all([projectJob, versionsJob]);
  };
  void load();
  return node;
}
