import { choice } from "./components/choice";
import { applySettings } from "./components/glass";
import { notify } from "./components/toast";
export { notify } from "./components/toast";
import type {
  Settings,
  Instance,
  AccountSummary,
  TaskSnapshot,
  CommandMap,
} from "../shared/types";
/** Retained appearance intent overlays every full settings response, across pages. */
export const pendingAppearanceSettings = new Map<keyof Settings, { value: unknown; version: number }>();
function acceptSettings(snapshot: Settings): Settings {
  state.settings = { ...snapshot, ...Object.fromEntries([...pendingAppearanceSettings].map(([key, entry]) => [key, entry.value])) };
  applySettings(state.settings);
  return state.settings;
}
let settingsRequest = 0;
let lastSettingsResponse = 0;
export const api = async <K extends keyof CommandMap>(
  command: K,
  payload: CommandMap[K]["payload"],
) => {
  const isSettings = command === "settings.read" || command === "settings.patch" || command === "settings.reset";
  const request = isSettings ? ++settingsRequest : 0;
  const result = await window.launcher.invoke(command, payload);
  if (isSettings) {
    // A delayed older response must not restore values already accepted from a newer write.
    if (request < lastSettingsResponse) return state.settings as CommandMap[K]["result"];
    lastSettingsResponse = request;
    return acceptSettings(result as Settings) as CommandMap[K]["result"];
  }
  return result;
};
function readFavorites(): string[] {
  try {
    const saved: unknown = JSON.parse(
      localStorage.getItem("favorites") ?? "[]",
    );
    return Array.isArray(saved)
      ? saved.filter((id): id is string => typeof id === "string")
      : [];
  } catch {
    return [];
  }
}
type AccountKind = AccountSummary['kind'];
function readAccountSelection(): { kind?: AccountKind; local?: string; microsoft?: string } {
  try {
    const value = JSON.parse(localStorage.getItem('accountSelection') ?? '{}');
    return value && typeof value === 'object' ? value : {};
  } catch { return {}; }
}
const accountSelection = readAccountSelection();
export const state = {
  settings: null as unknown as Settings,
  instances: [] as Instance[],
  accounts: [] as AccountSummary[],
  tasks: [] as TaskSnapshot[],
  instanceId: localStorage.getItem("instance") ?? "",
  accountId: localStorage.getItem("account") ?? "",
  accountKind: (accountSelection.kind === 'microsoft' || accountSelection.kind === 'local' ? accountSelection.kind : undefined) as AccountKind | undefined,
  page: "home",
  favorites: new Set<string>(readFavorites()),
};
export const selected = () =>
  state.instances.find((x) => x.id === state.instanceId) ?? state.instances[0];
function persistAccountSelection() {
  accountSelection.kind = state.accountKind;
  localStorage.setItem('accountSelection', JSON.stringify(accountSelection));
  if (state.accountId) localStorage.setItem('account', state.accountId);
  else localStorage.removeItem('account');
}
export function selectAccount(identity: AccountSummary) {
  state.accountKind = identity.kind;
  state.accountId = identity.id;
  accountSelection[identity.kind] = identity.id;
  persistAccountSelection();
}
export function selectAccountKind(kind: AccountKind) {
  state.accountKind = kind;
  state.accountId = accountSelection[kind] ?? '';
  account();
  persistAccountSelection();
}
export function account() {
  // Migrate legacy selection once; explicit modes never fall back across kinds.
  if (!state.accountKind) state.accountKind = state.accounts.find(x => x.id === state.accountId)?.kind ?? state.accounts[0]?.kind ?? 'local';
  const kind = state.accountKind;
  const identity = state.accounts.find(x => x.kind === kind && x.id === state.accountId)
    ?? state.accounts.find(x => x.kind === kind && x.id === accountSelection[kind])
    ?? state.accounts.find(x => x.kind === kind);
  state.accountId = identity?.id ?? '';
  if (identity) accountSelection[kind] = identity.id;
  return identity;
}
export async function refresh(includeTasks = true) {
  const [instances, accounts, tasks] = await Promise.all([
    api("instances.list", undefined),
    api("accounts.list", undefined),
    includeTasks ? api("tasks.list", undefined) : Promise.resolve(undefined),
  ]);
  state.instances = instances; state.accounts = accounts;
  account(); persistAccountSelection();
  if (tasks) state.tasks = tasks;
}
export const e = (tag: string, className = "", text = "") => {
  const node = document.createElement(tag);
  node.className = className;
  node.textContent = text;
  return node;
};
export function button(text: string, action: () => unknown, className = "") {
  const node = e("button", className, text) as HTMLButtonElement;
  node.type = "button";
  node.onclick = () => {
    try {
      const result = action();
      if (result instanceof Promise) void result.catch(notify);
    } catch (error) {
      notify(error);
    }
  };
  return node;
}
export function field(label: string, input: HTMLElement) {
  const node = e(input.matches("input,textarea") ? "label" : "div", "field");
  node.append(e("span", "field-label", label), input);
  input.setAttribute("aria-label", label);
  return node;
}
export function input(value = "", placeholder = "") {
  const node = document.createElement("input");
  node.value = value;
  node.placeholder = placeholder;
  return node;
}
export function panel(title: string, subtitle = "") {
  const node = e("section", "glass panel");
  node.append(e("h2", "", title));
  if (subtitle) node.append(e("p", "muted", subtitle));
  return node;
}
export function heading(title: string, subtitle: string) {
  const node = e("header", "page-heading");
  node.append(e("h1", "", title), e("p", "muted", subtitle));
  return node;
}
export const go = (page: string) =>
  window.dispatchEvent(new CustomEvent("navigate", { detail: page }));
export function instancePicker() {
  const node = choice(
    state.instances.length
      ? state.instances.map((x) => [x.id, x.name])
      : [["", "暂无游戏实例"]],
    selected()?.id,
  );
  node.disabled = !state.instances.length;
  node.setAttribute("aria-label", "当前实例");
  node.onchange = () => {
    state.instanceId = node.value;
    localStorage.setItem("instance", node.value);
    go(state.page);
  };
  return node;
}
export function persistFavorite(id: string) {
  state.favorites.has(id)
    ? state.favorites.delete(id)
    : state.favorites.add(id);
  localStorage.setItem("favorites", JSON.stringify([...state.favorites]));
}

let accountFocusRequested = false;
export function openAccounts() {
  accountFocusRequested = true;
  go('settings');
}
export function focusAccounts(section: HTMLElement) {
  if (!accountFocusRequested) return;
  accountFocusRequested = false;
  section.tabIndex = -1;
  section.setAttribute('aria-label', '账号与身份');
  requestAnimationFrame(() => {
    if (!section.isConnected) return;
    section.scrollIntoView({ block: 'start' });
    section.focus({ preventScroll: true });
  });
}
