import { homeAccount, addHomeAccount } from "../components/home-account";
import { launchControls } from "../components/launch-controls";
import { api, state, selected, e, button, go } from "../ui";
import { dialog } from "../components/dialog";

function chooseGame() {
  const cards = e("div", "home-game-choices");
  const modal = dialog("选择游戏", cards);
  for (const instance of state.instances) {
    const card = button("", () => {
      state.instanceId = instance.id;
      localStorage.setItem("instance", instance.id);
      modal.close(); go("home");
    }, "glass home-game-card");
    card.setAttribute("aria-pressed", String(selected()?.id === instance.id));
    card.append(e("span", "badge", instance.loader?.kind ?? "原版"), e("h3", "", instance.name), e("p", "muted", `Minecraft ${instance.minecraft}`));
    cards.append(card);
  }
}
export function home() {
  const node = e("div", "home-page");
  const intro = e("header", "home-intro");
  intro.append(e("p", "eyebrow", "ZHUMENG LAUNCHER / 筑梦"), e("h1", "", state.settings.homeTitle), e("p", "home-caption", state.settings.homeSubtitle));
  node.append(intro);
  const workspace = e("div", "home-lower");
  const launch = e("section", "glass launch-panel");
  const item = selected();
  launch.append(e("p", "eyebrow", "A WORLD OF POSSIBILITIES"), e("h2", "", item?.name ?? "为梦想，创建第一个世界"), e("p", "muted", item ? `Minecraft ${item.minecraft} · ${item.loader?.kind ?? "原版"} · ${item.memoryMb} MB` : "安装喜爱的版本，或带上已有的游戏目录。"));
  if (item) launch.append(e("p", "launch-status", item.status === "ready" ? "● 游戏文件已就绪" : "● 需要检查游戏文件"));
  const actions = e("div", "row");
  if (item) actions.append(launchControls(item.id, 'primary launch-button', undefined, () => addHomeAccount()));
  else actions.append(button('安装游戏', () => go('download'), 'primary launch-button'));
  if (state.instances.length > 1) actions.append(button("切换游戏", chooseGame, "quiet"));
  actions.append(button("管理游戏库", () => go("library"), "quiet"));
  launch.append(actions);
  const javaStatus = e("div","java-task-summary"); javaStatus.setAttribute("role","group"); javaStatus.setAttribute("aria-label","Java 配置任务");
  const updateJavaTask = () => {
    const task = state.tasks.filter(t=>t.label.includes("自动配置 Java")).at(-1);
    javaStatus.replaceChildren();
    if(!task) return;
    if(task.status === "queued" || task.status === "running") javaStatus.append(e("span","muted",`${task.label} · ${Math.round(task.progress*100)}%`),button("取消 Java 配置",()=>api("tasks.cancel",task.id),"quiet"));
    else if(task.status === "cancelled") javaStatus.append(e("span","muted","Java 配置已取消。"));
    else if(task.status === "failed") javaStatus.append(e("span","error",task.error ?? "Java 配置失败"));
  };
  javaStatus.addEventListener("java-task",updateJavaTask);updateJavaTask();launch.append(javaStatus);
  const aside = homeAccount();
  workspace.append(launch, aside); node.append(workspace);
  return node;
}
