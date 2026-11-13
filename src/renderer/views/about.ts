import { updateCard } from '../components/updates';
import { api, e, button, heading, panel, notify } from "../ui";
import { dialog } from "../components/dialog";
const COMMUNITY_URL = "https://qm.qq.com/q/C28ONm8EQa";
const COMMUNITY_GROUP = "638500178";
async function copyCommunity() {
  await api("app.copyCommunityGroup", undefined);
  notify(`群号 ${COMMUNITY_GROUP} 已复制`, { kind: "success" });
}
export function about() {
  const node = e("div");
  node.append(heading("关于筑梦", "让每一个世界，从梦开始。"));
  const card = panel("杯艺宣", "筑梦启动器开发者");
  card.classList.add("developer-card");
  const avatar = e("div", "developer-avatar", "杯");
  card.prepend(avatar);
  const community = panel("社区交流群", "加入筑梦交流群，反馈问题与交流玩法");
  community.classList.add("community-card");
  const actions = e("div", "community-actions");
  actions.append(
    button(
      "添加社区交流群 ↗",
      () => api("app.openCommunity", undefined),
      "primary",
    ),
    button("复制群号", copyCommunity, "text-button"),
  );
  community.append(
    e("p", "muted", `QQ 群号：${COMMUNITY_GROUP}`),
    actions,
    e(
      "p",
      "muted community-hint",
      `也可以在 QQ 中搜索群号，或访问 ${COMMUNITY_URL}`,
    ),
  );
  card.append(
    e("p", "muted", "用细节照顾每一次出发，用热爱连接每一个世界。"),
    button(
      "GitHub · 杯艺宣 ↗",
      () => api("app.openDeveloper", undefined),
      "primary",
    ),
  );
  node.append(
    updateCard(),
    card,
    community,
    button(
      "查看第三方软件许可",
      async () => {
        dialog(
          "第三方软件许可",
          e("pre", "licenses", await api("app.licenses", undefined)),
        );
      },
      "text-button",
    ),
  );
  return node;
}
