import type { AccountSummary, DeviceLogin } from "../../shared/types";
import {
  api,
  state,
  e,
  button,
  panel,
  input,
  field,
  refresh,
  focusAccounts,
  selectAccount,
  account as currentAccount,
} from "../ui";
import { dialog } from "./dialog";
import "./account-manager.css";

function message(error: unknown): string {
  return String(error)
    .replace(/^Error:\s*/, "")
    .replace(/^Error invoking remote method '[^']+':\s*/, "")
    .replace(/^Error:\s*/, "");
}

export function localAccountDialog(
  account?: AccountSummary,
  done: () => unknown = () => {},
) {
  const body = e("form");
  const name = input(account?.name ?? "");
  const error = e("p", "account-error");
  error.setAttribute("role", "alert");
  body.append(
    field("本地玩家名", name),
    e(
      "p",
      "muted",
      account
        ? "改名会改变离线 UUID，世界存档及服务器可能将你识别为新玩家。账号记录和选择保持不变。"
        : "使用 3–16 位英文字母、数字或下划线。",
    ),
    error,
  );
  const modal = dialog(account ? "修改本地玩家名" : "添加本地账号", body);
  const leave = () => modal.close();
  window.addEventListener("navigate", leave);
  modal.addEventListener(
    "close",
    () => window.removeEventListener("navigate", leave),
    { once: true },
  );
  name.oninput = () => {
    error.textContent = "";
  };
  let busy = false;
  const save = button("保存", () => submit(), "primary");
  body.append(
    save,
    button("取消", () => modal.close(), "quiet"),
  );
  const submit = async () => {
    if (busy) return;
    error.textContent = "";
    if (!/^[A-Za-z0-9_]{3,16}$/.test(name.value)) {
      error.textContent = "本地名称须为 3–16 位字母、数字或下划线";
      return;
    }
    busy = true;
    save.disabled = true;
    try {
      const result = account
        ? await api("accounts.renameLocal", {
            id: account.id,
            name: name.value,
          })
        : await api("accounts.addLocal", name.value);
      if (!modal.open) return;
      if (!account) selectAccount(result);
      await refresh();
      if (!modal.open) return;
      modal.close();
      done();
    } catch (err) {
      if (modal.open) error.textContent = message(err);
    } finally {
      busy = false;
      save.disabled = false;
    }
  };
  body.onsubmit = (event) => {
    event.preventDefault();
    void submit();
  };
  queueMicrotask(() => name.focus());
  return modal;
}
let activeLogin: HTMLDialogElement | undefined;
export function microsoftLogin(
  done: () => unknown,
  clientConfigured: (id: string) => void = () => {},
) {
  if (activeLogin?.open) {
    activeLogin.focus();
    return;
  }
  const body = e("div");
  const status = e("p", "muted", "正在准备 Microsoft 登录…");
  status.setAttribute("role", "status");
  const content = e("div");
  body.append(status, e("p", "muted", "PCL 提供正版认证 · 授权仅在 Microsoft 官方页面完成"), content);
  const modal = (activeLogin = dialog("登录 Microsoft", body));
  let live = true,
    epoch = 0,
    login: DeviceLogin | undefined,
    timer: ReturnType<typeof setTimeout> | undefined,
    busy = false;
  const current = (generation: number) =>
    live && modal.open && generation === epoch;
  const cancel = (id: string) =>
    void api("accounts.cancelMicrosoftLogin", id).catch(() => {});
  const stop = () => {
    if (!live) return;
    live = false;
    epoch++;
    clearTimeout(timer);
    if (login) cancel(login.loginId);
    window.removeEventListener("navigate", navigate);
    if (activeLogin === modal) activeLogin = undefined;
  };
  const close = () => {
    stop();
    modal.close();
  };
  const navigate = () => close();
  window.addEventListener("navigate", navigate);
  modal.addEventListener("close", stop, { once: true });
  modal.addEventListener("cancel", (event) => {
    event.preventDefault();
    close();
  });
  modal.querySelector("button")!.onclick = close;
  const retry = button("重试登录", () => begin(), "primary");
  retry.hidden = true;
  body.append(retry, button("取消登录", close, "quiet"));
  const terminal: Record<string, string> = {
    expired: "设备代码已过期，请重试登录。",
    declined: "授权已拒绝，请重试登录。",
    cancelled: "登录已取消。",
    unlicensed: "此 Microsoft 账号没有 Minecraft Java 版授权，请换账号后重试。",
    account_action_required: "此账号需要在 Microsoft 官方页面完成额外验证，请处理后重试。",
    profile_required: "此账号尚未建立 Minecraft Java 版角色资料，请在官方账户页面完成后重试。",
    network_error: "认证网络请求失败，请检查网络后重试。",
    unsupported: "不支持当前 PCL 文件，请选择受支持的版本后重试。",
    dependency_error: "无法读取受支持的 PCL 文件，请选择文件后重试。",
    worker_error: "认证服务异常，请重试登录。",
  };
  let shownCode = "";
  const showDevice = (session: DeviceLogin, generation: number) => {
    if (!session.userCode || !session.verificationUri || shownCode === session.userCode) return;
    shownCode = session.userCode;
      const copied = e("p", "muted", "正在复制代码…"),
        opened = e("p", "muted", "正在打开验证页面…");
      const copy = async () => {
        try {
          await api("accounts.copyUserCode", session.userCode);
          if (current(generation))
            copied.textContent = "代码已复制，可粘贴到验证页面。";
        } catch {
          if (current(generation))
            copied.textContent = "复制失败，请手动复制上方代码或重试。";
        }
      };
      const open = async () => {
        try {
          await api("app.openVerification", session.verificationUri);
          if (current(generation))
            opened.textContent = "已打开 Microsoft 验证页面。";
        } catch {
          if (current(generation))
            opened.textContent = "打开失败，请重新打开验证页面。";
        }
      };
      status.textContent =
        "在 Microsoft 页面粘贴代码并授权，正在等待登录完成。";
      content.replaceChildren(
        e("div", "device-code", session.userCode),
        copied,
        opened,
        button("复制代码", copy, "quiet"),
        button("重新打开验证页面", open, "quiet"),
      );
      void copy();
      void open();
  };
  const choose = button("选择 PCL 文件", async () => {
    try { if (await api("accounts.choosePcl", undefined)) await begin(); }
    catch { status.textContent = "无法选择 PCL 文件，请重试。"; }
  }, "quiet");
  choose.hidden = true;
  body.append(choose);
  const poll = async (generation: number) => {
    if (!current(generation) || !login) return;
    const session = login;
    try {
      const result = await api("accounts.pollMicrosoftLogin", session.loginId);
      if (!current(generation)) return;
      if (result.status === "pending") {
        if (result.device) showDevice(result.device, generation);
        if (result.stage === "waiting") status.textContent = "加载可能需要时间，请耐心等待";
        else if (result.stage === "reconnecting") status.textContent = "正在确认认证服务状态，请耐心等待…";
        else if (result.stage === "authenticating" && !shownCode) status.textContent = "PCL 正在验证正版身份…";
        timer = setTimeout(() => void poll(generation), result.interval * 1000);
        return;
      }
      if (result.status === "completed") {
        selectAccount(result.account);
        await refresh();
        if (!current(generation)) return;
        login = undefined;
        close();
        done();
        return;
      }
      const reason = result.status === "failed" ? result.code : result.status;
      status.textContent = terminal[reason] ?? "登录未完成，请重试。";
      choose.hidden = login?.provider !== "pcl" || !["unsupported", "dependency_error"].includes(reason);
      retry.hidden = false;
    } catch (err) {
      if (current(generation)) {
        status.textContent = "登录检查失败：" + message(err);
        retry.hidden = false;
      }
    }
  };
  const configure = () => {
    const client = input(state.settings.microsoftClientId);
    const error = e("p", "account-error");
    error.setAttribute("role", "alert");
    content.replaceChildren(
      e(
        "p",
        "muted",
        "需要你自己的有效 Microsoft 公共客户端 ID，支持个人账号设备授权及 Minecraft 服务。",
      ),
      field("Microsoft 客户端 ID", client),
      error,
      button(
        "保存并重试",
        async () => {
          if (busy) return;
          busy = true;
          try {
            state.settings = await api("settings.patch", {
              microsoftClientId: client.value.trim(),
            });
            clientConfigured(state.settings.microsoftClientId);
          } catch (err) {
            error.textContent = message(err);
            busy = false;
            return;
          }
          busy = false;
          if (live) await begin();
        },
        "primary",
      ),
    );
  };
  const begin = async () => {
    if (busy || !live) return;
    busy = true;
    const generation = ++epoch;
    clearTimeout(timer);
    if (login) cancel(login.loginId);
    login = undefined;
    shownCode = "";
    choose.hidden = true;
    content.replaceChildren();
    retry.hidden = true;
    status.textContent = "正在准备 Microsoft 登录…";
    try {
      const session = await api("accounts.beginMicrosoftLogin", undefined);
      if (!current(generation)) {
        cancel(session.loginId);
        return;
      }
      login = session;
      showDevice(session, generation);
      if (session.provider === "pcl" && !session.userCode) status.textContent = "正在准备 PCL 正版认证…";
      timer = setTimeout(() => void poll(generation), session.interval * 1000);
    } catch (err) {
      if (current(generation)) {
        status.textContent = "无法开始登录：" + message(err);
        retry.hidden = false;
        if (String(err).includes("请配置有效微软客户端 ID"))
          configure();
      }
    } finally {
      busy = false;
    }
  };
  void begin();
  return modal;
}
export function accountManager(clientConfigured: (id: string) => void = () => {}) {
  const node = panel(
    "账号与身份",
    "正版账号通过 Microsoft 设备授权；本地账号仅适用于本地测试与离线环境。",
  );
  focusAccounts(node);
  const list = e("div");
  const render = () => {
    list.replaceChildren();
    for (const account of state.accounts) {
      const row = e("div", "version-row");
      row.append(
        e("strong", "", account.name),
        e(
          "span",
          "badge",
          `${account.kind === "local" ? "本地" : "Microsoft"} · ${account.status === "ready" ? "可用" : "需重新登录"}`,
        ),
        button(
          currentAccount()?.id === account.id ? "已选择" : "选择",
          () => {
            selectAccount(account);
            render();
          },
          "quiet",
        ),
        account.kind === "local"
          ? button(
              "修改名字",
              () => localAccountDialog(account, render),
              "quiet",
            )
          : button(
              "重新登录",
              () => microsoftLogin(render, clientConfigured),
              "quiet",
            ),
        button(
          "移除",
          async () => {
            await api("accounts.remove", account.id);
            await refresh();
            render();
          },
          "quiet",
        ),
      );
      list.append(row);
    }
    if (!state.accounts.length)
      list.append(e("p", "muted", "还没有账号。添加一个身份，准备出发。"));
  };
  render();
  node.append(
    list,
    button(
      "添加本地账号",
      () => localAccountDialog(undefined, render),
      "quiet",
    ),
    button("登录 Microsoft", () => microsoftLogin(render, clientConfigured), "primary"),
  );
  return node;
}
