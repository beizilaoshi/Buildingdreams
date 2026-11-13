import type { AccountService } from "./services/accounts";
import { CommandRouter, noPayload } from "./ipc";
function text(value: unknown): string {
  if (
    typeof value !== "string" ||
    !value ||
    value.length > 128 ||
    value.includes("\0")
  )
    throw new Error("无效账户参数");
  return value;
}
export function registerAccountCommands(
  router: CommandRouter,
  accounts: AccountService,
  copyCode: (code: string) => Promise<void> = async (code) => {
    const { clipboard } = await import("electron");
    await clipboard.writeText(code);
  },
): void {
  router.register("accounts.choosePcl", noPayload, () => accounts.choosePcl());
  router.register("accounts.list", noPayload, () => accounts.list());
  router.register("accounts.appearance", text, (id) => accounts.appearance(id));
  router.register("accounts.addLocal", text, (name) => accounts.addLocal(name));
  router.register(
    "accounts.renameLocal",
    (value) => {
      if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        Object.keys(value).sort().join(",") !== "id,name"
      )
        throw new Error("无效账户参数");
      const v = value as { id: unknown; name: unknown };
      return { id: text(v.id), name: text(v.name) };
    },
    (value) => accounts.renameLocal(value),
  );
  router.register(
    "accounts.copyUserCode",
    (value) => {
      if (typeof value !== "string" || !/^[A-Z0-9-]{4,32}$/.test(value))
        throw new Error("无效设备代码");
      return value;
    },
    copyCode,
  );
  router.register("accounts.beginMicrosoftLogin", noPayload, () =>
    accounts.beginMicrosoftLogin(),
  );
  router.register("accounts.pollMicrosoftLogin", text, (id) =>
    accounts.pollMicrosoftLogin(id),
  );
  router.register("accounts.cancelMicrosoftLogin", text, (id) =>
    accounts.cancelMicrosoftLogin(id),
  );
  router.register("accounts.remove", text, (id) => accounts.remove(id));
}
