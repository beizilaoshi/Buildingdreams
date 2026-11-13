import { beforeEach, afterEach, expect, test } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCipheriv, createDecipheriv } from "node:crypto";
import { AccountService } from "../src/main/services/accounts";
import { PNG } from "pngjs";
let dir: string, now: number, replies: any[], requests: any[];
const key = Buffer.alloc(32, 7),
  iv = Buffer.alloc(12, 2);
const protector = {
  isEncryptionAvailable: () => true,
  encryptString: (s: string) => {
    const c = createCipheriv("aes-256-gcm", key, iv);
    return Buffer.concat([c.update(s), c.final(), c.getAuthTag()]);
  },
  decryptString: (b: Buffer) => {
    const d = createDecipheriv("aes-256-gcm", key, iv);
    d.setAuthTag(b.subarray(-16));
    return Buffer.concat([d.update(b.subarray(0, -16)), d.final()]).toString();
  },
};
function service(
  clientId = "12345678-1234-1234-1234-123456789abc",
  protect = protector,
) {
  return new AccountService(
    join(dir, "accounts.vault"),
    protect,
    async () => clientId,
    async (url, init) => {
      requests.push({ url, init });
      const r = replies.shift();
      if (r instanceof Error) throw r;
      if (r instanceof Response) return r;
      return new Response(JSON.stringify(r), { status: r?.error ? 400 : 200 });
    },
    () => now,
  );
}
const device = {
  device_code: "SECRET_DEVICE",
  user_code: "ABCD",
  expires_in: 900,
  interval: 5,
};
test("local account appearance is explicit default and performs no network requests", async () => {
  const s = service();
  const a = await s.addLocal("Steve");
  expect(await s.appearance(a.id)).toEqual({
    accountId: a.id,
    source: "default",
    reason: "local",
  });
  expect(requests).toHaveLength(0);
});
function success(items = [{ name: "game_minecraft" }]) {
  return [
    { access_token: "SECRET_MS", refresh_token: "SECRET_REFRESH" },
    { Token: "SECRET_XBL", DisplayClaims: { xui: [{ uhs: "hash" }] } },
    { Token: "SECRET_XSTS" },
    { access_token: "SECRET_GAME", expires_in: 3600 },
    { items },
    { id: "0123456789abcdef0123456789abcdef", name: "Steve" },
  ];
}
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "accounts-"));
  now = 1000;
  replies = [];
  requests = [];
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});
test("requires configured strict client GUID before networking", async () => {
  for (const id of ["", "-".repeat(36)])
    await expect(service(id).beginMicrosoftLogin()).rejects.toThrow("客户端");
  expect(requests).toHaveLength(0);
});
test("pending, slow_down, expiry and cancellation have explicit safe outcomes", async () => {
  const s = service();
  replies = [
    device,
    { error: "authorization_pending" },
    { error: "slow_down" },
  ];
  const d = await s.beginMicrosoftLogin();
  expect(JSON.stringify(d)).not.toContain("SECRET");
  now += 5000;
  expect(await s.pollMicrosoftLogin(d.loginId)).toMatchObject({
    status: "pending",
  });
  now += 5000;
  expect(await s.pollMicrosoftLogin(d.loginId)).toMatchObject({
    status: "pending",
    interval: 10,
  });
  now += 900000;
  expect(await s.pollMicrosoftLogin(d.loginId)).toMatchObject({
    status: "expired",
  });
  replies = [device];
  const c = await s.beginMicrosoftLogin();
  await s.cancelMicrosoftLogin(c.loginId);
  expect(await s.pollMicrosoftLogin(c.loginId)).toMatchObject({
    status: "cancelled",
  });
});
test("successful ownership persists only encrypted bytes and returns redacted summaries", async () => {
  const s = service();
  replies = [device, ...success()];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  const r = await s.pollMicrosoftLogin(d.loginId);
  expect(r.status).toBe("completed");
  expect(JSON.stringify([r, await s.list()])).not.toContain("SECRET");
  expect(
    (await readFile(join(dir, "accounts.vault"))).toString(),
  ).not.toContain("SECRET");
  expect(await service().list()).toMatchObject([
    { name: "Steve", status: "ready" },
  ]);
  expect(await s.getLaunchIdentity((await s.list())[0].id)).toMatchObject({
    accessToken: "SECRET_GAME",
  });
  expect(requests.every((r) => r.init.redirect === "error")).toBe(true);
});
test("active texture metadata survives encrypted login/refresh without entering public account summaries", async () => {
  const url = "https://textures.minecraft.net/texture/" + "b".repeat(64);
  const s = service();
  const chain = success();
  (chain[5] as any).skins = [
    { state: "INACTIVE", url: "https://evil.invalid/a" },
    { state: "ACTIVE", url },
  ];
  replies = [device, ...chain];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  await s.pollMicrosoftLogin(d.loginId);
  const persisted = JSON.parse(
    protector.decryptString(await readFile(join(dir, "accounts.vault"))),
  );
  expect(persisted[0].texture).toBe(url);
  expect(JSON.stringify(await s.list())).not.toMatch(/texture|SECRET|skins/);
  replies = [
    new Response(
      new Uint8Array(PNG.sync.write(new PNG({ width: 64, height: 64 }))),
    ),
  ];
  const appearance = await service().appearance((await s.list())[0].id);
  expect(appearance.source).toBe("official");
  expect(requests.at(-1).url).toBe(url);
  expect(requests.at(-1).init.headers).toBeUndefined();
  now += 3600000;
  const next = success();
  (next[5] as any).skins = [];
  replies = next;
  await s.getLaunchIdentity((await s.list())[0].id);
  expect(
    JSON.parse(
      protector.decryptString(await readFile(join(dir, "accounts.vault"))),
    )[0].texture,
  ).toBeNull();
});
test("legacy encrypted vault without texture remains launch compatible and fetches only its public official UUID", async () => {
  const uuid = "0123456789abcdef0123456789abcdef";
  await writeFile(
    join(dir, "accounts.vault"),
    protector.encryptString(
      JSON.stringify([
        {
          summary: {
            id: "legacy",
            name: "Steve",
            uuid,
            kind: "microsoft",
            status: "ready",
          },
          accessToken: "SECRET_GAME",
          expiresAt: now + 3600000,
        },
      ]),
    ),
  );
  const s = service();
  replies = [{ id: uuid, properties: [] }];
  expect(await s.appearance("legacy")).toMatchObject({
    source: "default",
    reason: "missing",
  });
  expect(requests[0].url).toBe(
    "https://sessionserver.mojang.com/session/minecraft/profile/" + uuid,
  );
  expect(requests[0].init.headers).toBeUndefined();
  expect((await s.getLaunchIdentity("legacy")).accessToken).toBe("SECRET_GAME");
});
test("without entitlement cannot produce launch identity", async () => {
  const s = service();
  replies = [device, ...success([])];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  expect(await s.pollMicrosoftLogin(d.loginId)).toMatchObject({
    status: "unlicensed",
  });
  expect(await s.list()).toEqual([]);
});
test("refresh failure expires account and never returns stale credentials or remote error", async () => {
  const s = service();
  replies = [device, ...success()];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  await s.pollMicrosoftLogin(d.loginId);
  const id = (await s.list())[0].id;
  now += 3600000;
  replies = [new Error("SECRET_REFRESH")];
  await expect(s.getLaunchIdentity(id)).rejects.toThrow("过期");
  expect(await s.list()).toMatchObject([{ status: "expired" }]);
});
test("local identity has vanilla offline UUID and no encryption fallback", async () => {
  const s = service();
  const a = await s.addLocal("Notch");
  expect(a).toMatchObject({
    kind: "local",
    uuid: "b50ad385829d3141a2167e7d7539ba7f",
  });
  expect((await s.getLaunchIdentity(a.id)).accessToken).toBeTruthy();
  const bad = service("", { ...protector, isEncryptionAvailable: () => false });
  await expect(bad.addLocal("Steve")).rejects.toThrow("加密");
});
test("offline rename retains record identity, recalculates UUID and persists other accounts", async () => {
  const s = service();
  const a = await s.addLocal("Steve"),
    other = await s.addLocal("Alex");
  const renamed = await s.renameLocal({ id: a.id, name: "Notch" });
  expect(renamed).toEqual({
    ...a,
    name: "Notch",
    uuid: "b50ad385829d3141a2167e7d7539ba7f",
  });
  expect(await service().list()).toEqual([renamed, other]);
  expect(await s.addLocal("Notch")).toEqual(renamed);
  expect(await s.list()).toHaveLength(2);
});
test("offline rename rejects invalid, absent, Microsoft and duplicate targets without changing vault", async () => {
  const s = service();
  const a = await s.addLocal("Steve");
  await s.addLocal("Alex");
  replies = [device, ...success()];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  await s.pollMicrosoftLogin(d.loginId);
  const before = await s.list();
  for (const value of [
    { id: a.id, name: "x" },
    { id: a.id, name: "中文名" },
    { id: "missing", name: "Notch" },
    { id: a.id, name: "Alex" },
    { id: before[2].id, name: "Notch" },
  ])
    await expect(s.renameLocal(value)).rejects.toThrow();
  expect(await s.list()).toEqual(before);
  expect(await service().list()).toEqual(before);
});
test("rename IPC validates exact fields and clipboard only accepts bounded device codes", async () => {
  const s = service(),
    router = new CommandRouter();
  let copied = "";
  registerAccountCommands(router, s, async (code) => {
    copied = code;
  });
  const a = await s.addLocal("Steve");
  for (const payload of [
    null,
    [],
    {},
    { id: a.id, name: "Notch", extra: true },
    { id: 42, name: "Notch" },
  ])
    await expect(
      router.invoke("accounts.renameLocal", payload),
    ).rejects.toThrow();
  await expect(
    router.invoke("accounts.renameLocal", { id: a.id, name: "Notch" }),
  ).resolves.toMatchObject({ id: a.id, name: "Notch" });
  for (const payload of ["", "a".repeat(33), "hello world", 42, "ABCD\0"])
    await expect(
      router.invoke("accounts.copyUserCode", payload),
    ).rejects.toThrow();
  expect(copied).toBe("");
  await router.invoke("accounts.copyUserCode", "ABCD-EFGH");
  expect(copied).toBe("ABCD-EFGH");
});
test("failed offline rename commit retains previous memory and encrypted identity", async () => {
  const s = service(),
    a = await s.addLocal("Steve");
  vi.mocked(rename).mockRejectedValueOnce(new Error("disk failure"));
  await expect(s.renameLocal({ id: a.id, name: "Notch" })).rejects.toThrow(
    "disk failure",
  );
  expect(await s.list()).toEqual([a]);
  expect(await service().list()).toEqual([a]);
});
import { registerAccountCommands } from "../src/main/account-router";
import { CommandRouter } from "../src/main/ipc";
import { validateSettingsPatch } from "../src/shared/settings";
test("runtime IPC rejects malformed payloads and strict client IDs", async () => {
  const router = new CommandRouter();
  registerAccountCommands(router, service());
  for (const [command, payload] of [
    ["accounts.list", {}],
    ["accounts.remove", {}],
    ["accounts.pollMicrosoftLogin", ""],
    ["accounts.addLocal", 42],
    ["accounts.appearance", {}],
  ])
    await expect(router.invoke(command, payload)).rejects.toThrow();
  expect(() =>
    validateSettingsPatch({ microsoftClientId: "-".repeat(36) }),
  ).toThrow();
});
test("refresh renews the full chain and persists rotated tokens", async () => {
  const s = service();
  replies = [device, ...success()];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  await s.pollMicrosoftLogin(d.loginId);
  const id = (await s.list())[0].id;
  now += 3600000;
  replies = success();
  expect((await s.getLaunchIdentity(id)).accessToken).toBe("SECRET_GAME");
  expect(await service().list()).toMatchObject([{ status: "ready" }]);
  expect(requests.at(-6).init.body).toContain("refresh_token");
});
test("declined and server expiry stop polling and redact response data", async () => {
  for (const error of ["authorization_declined", "expired_token"]) {
    const s = service();
    replies = [device, { error, error_description: "SECRET" }];
    const d = await s.beginMicrosoftLogin();
    now += 5000;
    const result = await s.pollMicrosoftLogin(d.loginId);
    expect(result).toEqual({
      status: error === "expired_token" ? "expired" : "declined",
    });
    expect(await s.pollMicrosoftLogin(d.loginId)).toEqual(result);
  }
});
test("network error never exposes secrets and failed encryption never writes plaintext", async () => {
  const s = service();
  replies = [new Error("SECRET")];
  await expect(s.beginMicrosoftLogin()).rejects.toThrow("身份服务");
  await expect(readFile(join(dir, "accounts.vault"))).rejects.toThrow();
});
test("cancelling an in-flight token poll prevents account insertion", async () => {
  let resolve!: (value: Response) => void;
  let calls = 0;
  const s = new AccountService(
    join(dir, "accounts.vault"),
    protector,
    async () => "12345678-1234-1234-1234-123456789abc",
    async () => {
      if (calls++ === 0) return new Response(JSON.stringify(device));
      return new Promise<Response>((done) => {
        resolve = done;
      });
    },
    () => now,
  );
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  const poll = s.pollMicrosoftLogin(d.loginId);
  await s.cancelMicrosoftLogin(d.loginId);
  resolve(new Response(JSON.stringify(success()[0])));
  expect(await poll).toEqual({ status: "cancelled" });
  expect(await s.list()).toEqual([]);
});
import { vi } from "vitest";
import { rename } from "node:fs/promises";
vi.mock("node:fs/promises", async (original) => {
  const actual = await original<typeof import("node:fs/promises")>();
  return { ...actual, rename: vi.fn(actual.rename) };
});
test("commit boundary rejects cancellation while persisted rename is paused", async () => {
  const actual =
    await vi.importActual<typeof import("node:fs/promises")>(
      "node:fs/promises",
    );
  let entered!: () => void, release!: () => void;
  const paused = new Promise<void>((r) => (entered = r)),
    gate = new Promise<void>((r) => (release = r));
  vi.mocked(rename).mockImplementationOnce(async (from, to) => {
    entered();
    await gate;
    await actual.rename(from, to);
  });
  const s = service();
  replies = [device, ...success()];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  const poll = s.pollMicrosoftLogin(d.loginId);
  await paused;
  let cancellationError: unknown;
  try {
    await s.cancelMicrosoftLogin(d.loginId);
  } catch (e) {
    cancellationError = e;
  }
  release();
  const result = await poll;
  expect(cancellationError).toBeInstanceOf(Error);
  expect(result.status).toBe("completed");
  await s.cancelMicrosoftLogin(d.loginId);
  expect(await s.pollMicrosoftLogin(d.loginId)).toEqual(result);
  expect(await service().list()).toHaveLength(1);
});
test("failed vault commit leaves neither ready memory account nor persisted account", async () => {
  vi.mocked(rename).mockRejectedValueOnce(new Error("disk failure"));
  const s = service();
  replies = [device, ...success()];
  const d = await s.beginMicrosoftLogin();
  now += 5000;
  await expect(s.pollMicrosoftLogin(d.loginId)).rejects.toThrow();
  expect(await s.list()).toEqual([]);
  expect(await service().list()).toEqual([]);
});
test("terminal sessions expire and outstanding sessions have a fixed bound", async () => {
  const s = service();
  replies = [device];
  const d = await s.beginMicrosoftLogin();
  await s.cancelMicrosoftLogin(d.loginId);
  now += 300001;
  await expect(s.pollMicrosoftLogin(d.loginId)).rejects.toThrow("登录不存在");
  replies = Array.from({ length: 129 }, () => device);
  for (let i = 0; i < 128; i++) await s.beginMicrosoftLogin();
  await expect(s.beginMicrosoftLogin()).rejects.toThrow("登录会话");
});
test("local insert and remove publish memory changes only after vault commit", async () => {
  const s = service();
  vi.mocked(rename).mockRejectedValueOnce(new Error("disk failure"));
  await expect(s.addLocal("Steve")).rejects.toThrow();
  expect(await s.list()).toEqual([]);
  const account = await s.addLocal("Steve");
  vi.mocked(rename).mockRejectedValueOnce(new Error("disk failure"));
  await expect(s.remove(account.id)).rejects.toThrow();
  expect(await s.list()).toEqual([account]);
  expect(await service().list()).toEqual([account]);
});
