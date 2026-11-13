import type { PclProvider, PclAttempt } from "./pcl-bridge";
import type { PclCredential } from "./pcl-protocol";
import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile, rename, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { AppearanceService, activeTexture } from "./appearance";
import type {
  AccountSummary,
  DeviceLogin,
  DevicePoll,
} from "../../shared/types";
export interface TokenProtector {
  isEncryptionAvailable(): boolean;
  encryptString(value: string): Buffer;
  decryptString(value: Buffer): string;
}
interface StoredAccount {
  summary: AccountSummary;
  provider?: "pcl";
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  clientId?: string;
  texture?: string | null;
}
interface Pending {
  bridge?: PclAttempt;
  cancellation?: Promise<void>;
  credential?: PclCredential;
  bridgeFailed?: boolean;
  public: DeviceLogin;
  code: string;
  clientId: string;
  nextPoll: number;
  state?: DevicePoll;
  busy?: boolean;
  committing?: boolean;
  terminalAt?: number;
}
const authority = "https://login.microsoftonline.com/consumers/oauth2/v2.0/";
const scope = "XboxLive.signin offline_access";
export const clientIdPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function required(value: unknown): string {
  if (typeof value !== "string" || !value) throw new Error("身份响应无效");
  return value;
}
function duration(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0)
    throw new Error("身份响应无效");
  return value * 1000;
}
export class AccountService {
  private accounts: StoredAccount[] = [];
  private loaded = false;
  private pending = new Map<string, Pending>();
  private queue: Promise<unknown> = Promise.resolve();
  private transition: Promise<unknown> = Promise.resolve();
  private interactive?: Pending;
  constructor(
    private file: string,
    private protector: TokenProtector,
    private clientId: () => Promise<string>,
    private fetcher: typeof fetch = fetch,
    private now = Date.now,
    private bridge?: PclProvider,
  ) {}
  private serialized<T>(work: () => Promise<T>): Promise<T> {
    const next = this.queue.then(work);
    this.queue = next.catch(() => {});
    return next;
  }
  private encryption(): void {
    if (!this.protector.isEncryptionAvailable())
      throw new Error("系统凭据加密不可用");
  }
  private async load(): Promise<void> {
    if (this.loaded) return;
    this.encryption();
    try {
      const parsed = JSON.parse(
        this.protector.decryptString(await readFile(this.file)),
      );
      if (!Array.isArray(parsed)) throw new Error();
      this.accounts = parsed;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT")
        throw new Error("账户保险库无法读取");
    }
    this.loaded = true;
  }
  private async save(accounts = this.accounts): Promise<void> {
    this.encryption();
    await mkdir(dirname(this.file), { recursive: true });
    const temporary = this.file + "." + randomUUID() + ".tmp";
    await writeFile(
      temporary,
      this.protector.encryptString(JSON.stringify(accounts)),
      { mode: 0o600 },
    );
    await rename(temporary, this.file);
    this.accounts = accounts;
  }
  private summary(account: StoredAccount): AccountSummary {
    const s = account.summary;
    return {
      ...s,
      status:
        s.kind === "microsoft" &&
        s.status === "ready" &&
        (account.expiresAt ?? 0) <= this.now()
          ? "expired"
          : s.status,
    };
  }
  list(): Promise<AccountSummary[]> {
    return this.serialized(async () => {
      await this.load();
      return this.accounts.map((a) => this.summary(a));
    });
  }
  async appearance(id: string) {
    // Snapshot under the vault queue; a slow CDN must not block switching/removing accounts.
    const a = await this.serialized(async () => {
      await this.load();
      const value = this.accounts.find((item) => item.summary.id === id);
      if (!value) throw new Error("账户不存在");
      return {
        id,
        uuid: value.summary.uuid,
        kind: value.summary.kind,
        texture: value.texture,
      };
    });
    return new AppearanceService(this.fetcher).get(
      a.id,
      a.uuid,
      a.kind,
      a.texture,
    );
  }
  addLocal(name: string): Promise<AccountSummary> {
    return this.serialized(async () => {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(name))
        throw new Error("本地名称须为 3–16 位字母、数字或下划线");
      await this.load();
      const existing = this.accounts.find(
        (a) => a.summary.kind === "local" && a.summary.name === name,
      );
      if (existing) return this.summary(existing);
      const bytes = createHash("md5")
        .update("OfflinePlayer:" + name, "utf8")
        .digest();
      bytes[6] = (bytes[6] & 15) | 48;
      bytes[8] = (bytes[8] & 63) | 128;
      const summary: AccountSummary = {
        id: randomUUID(),
        name,
        uuid: bytes.toString("hex"),
        kind: "local",
        status: "ready",
      };
      await this.save([...this.accounts, { summary }]);
      return { ...summary };
    });
  }
  remove(id: string): Promise<void> {
    return this.serialized(async () => {
      await this.load();
      await this.save(this.accounts.filter((a) => a.summary.id !== id));
    });
  }
  renameLocal(value: { id: string; name: string }): Promise<AccountSummary> {
    return this.serialized(async () => {
      if (!/^[A-Za-z0-9_]{3,16}$/.test(value.name))
        throw new Error("本地名称须为 3–16 位字母、数字或下划线");
      await this.load();
      const account = this.accounts.find((a) => a.summary.id === value.id);
      if (!account) throw new Error("账户不存在");
      if (account.summary.kind !== "local")
        throw new Error("Microsoft 玩家名须在官方个人资料中修改");
      if (
        this.accounts.some(
          (a) =>
            a !== account &&
            a.summary.kind === "local" &&
            a.summary.name === value.name,
        )
      )
        throw new Error("已有同名本地账号，请选择该账号");
      const bytes = createHash("md5")
        .update("OfflinePlayer:" + value.name, "utf8")
        .digest();
      bytes[6] = (bytes[6] & 15) | 48;
      bytes[8] = (bytes[8] & 63) | 128;
      const summary = {
        ...account.summary,
        name: value.name,
        uuid: bytes.toString("hex"),
      };
      await this.save(
        this.accounts.map((a) => (a === account ? { ...a, summary } : a)),
      );
      return { ...summary };
    });
  }
  private async request(
    url: string,
    body?: unknown,
    bearer?: string,
  ): Promise<any> {
    try {
      const form = body instanceof URLSearchParams;
      const response = await this.fetcher(url, {
        method: body ? "POST" : "GET",
        redirect: "error",
        signal: AbortSignal.timeout(30000),
        headers: {
          ...(body
            ? {
                "Content-Type": form
                  ? "application/x-www-form-urlencoded"
                  : "application/json",
              }
            : {}),
          ...(bearer ? { Authorization: "Bearer " + bearer } : {}),
        },
        body: body
          ? form
            ? body.toString()
            : JSON.stringify(body)
          : undefined,
      });
      const data = await response.json();
      if (
        !response.ok &&
        ![
          "authorization_pending",
          "slow_down",
          "expired_token",
          "authorization_declined",
          "access_denied",
        ].includes(data.error)
      )
        throw new Error();
      return data;
    } catch {
      throw new Error("身份服务请求失败，请重试或重新登录");
    }
  }
  private pruneSessions(): void {
    for (const [id, p] of this.pending) {
      const end = p.terminalAt ?? p.public.expiresAt;
      if (!p.busy && (!p.bridge || p.state) && this.now() - end > 300000) this.pending.delete(id);
    }
  }
  private finish(p: Pending, state: DevicePoll): DevicePoll {
    p.code = "";
    p.credential = undefined;
    p.state = state;
    p.terminalAt = this.now();
    return state;
  }
  async beginMicrosoftLogin(): Promise<DeviceLogin> {
    if (this.bridge) {
      const next = this.transition.then(async () => {
        if (this.interactive) {
          if (this.interactive.committing) await this.serialized(async () => {});
          await this.cancelOwned(this.interactive);
        }
        this.pruneSessions();
        if (this.pending.size >= 128) throw new Error("登录会话过多，请稍后重试");
        this.encryption();
        const attempt = this.bridge!.begin();
        const pending: Pending = { public: attempt.login, code: "", clientId: "", nextPoll: 0, bridge: attempt };
        this.interactive = pending;
        this.pending.set(attempt.login.loginId, pending);
        void attempt.result.then(credential => { if (!pending.state) pending.credential = credential; }, () => { pending.bridgeFailed = true; });
        return { ...attempt.login };
      });
      this.transition = next.catch(() => {});
      return next;
    }
    this.pruneSessions();
    if (this.pending.size >= 128) throw new Error("登录会话过多，请稍后重试");
    this.encryption();
    const id = await this.clientId();
    if (!clientIdPattern.test(id)) throw new Error("请配置有效微软客户端 ID");
    const data = await this.request(
      authority + "devicecode",
      new URLSearchParams({ client_id: id, scope }),
    );
    const login: DeviceLogin = {
      loginId: randomUUID(),
      userCode: required(data.user_code),
      verificationUri: "https://www.microsoft.com/link",
      expiresAt: this.now() + duration(data.expires_in),
      interval: Math.max(5, data.interval ?? 5),
    };
    if (this.pending.size >= 128) throw new Error("登录会话过多，请稍后重试");
    this.pending.set(login.loginId, {
      public: login,
      code: required(data.device_code),
      clientId: id,
      nextPoll: this.now() + login.interval * 1000,
    });
    return { ...login };
  }
  private cancelOwned(p: Pending): Promise<void> {
    if (p.committing) return Promise.reject(new Error("登录正在保存，无法取消"));
    if (!p.state) this.finish(p, { status: "cancelled" });
    return p.cancellation ??= p.bridge?.cancel() ?? Promise.resolve();
  }
  async cancelMicrosoftLogin(id: string): Promise<void> {
    this.pruneSessions();
    const p = this.pending.get(id);
    if (!p) throw new Error("登录不存在");
    await this.cancelOwned(p);
  }
  async pollMicrosoftLogin(id: string): Promise<DevicePoll> {
    this.pruneSessions();
    const p = this.pending.get(id);
    if (!p) throw new Error("登录不存在");
    if (p.state) return p.state;
    if (p.bridge) {
      if (!p.credential) {
        const state = p.bridge.poll();
        if (p.bridgeFailed || state.status !== "pending") return this.finish(p, state.status === "pending" ? { status: "failed", code: "worker_error" } : state);
        return state;
      }
      const credential = p.credential;
      return this.serialized(async () => {
        if (p.state) return p.state;
        await this.load();
        if (p.state) return p.state;
        const account = this.pclAccount(credential);
        p.committing = true;
        try {
          await this.save([...this.accounts.filter(a => a.summary.id !== account.summary.id), account]);
          p.credential = undefined;
          return this.finish(p, { status: "completed", account: this.summary(account) });
        } finally { p.committing = false; }
      });
    }
    if (this.now() >= p.public.expiresAt) {
      p.code = "";
      return this.finish(p, { status: "expired" });
    }
    if (p.busy || this.now() < p.nextPoll)
      return { status: "pending", interval: p.public.interval };
    p.busy = true;
    p.nextPoll = this.now() + p.public.interval * 1000;
    try {
      const token = await this.request(
        authority + "token",
        new URLSearchParams({
          client_id: p.clientId,
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: p.code,
        }),
      );
      if (p.state) return p.state;
      if (token.error === "authorization_pending")
        return { status: "pending", interval: p.public.interval };
      if (token.error === "slow_down") {
        p.public.interval += 5;
        p.nextPoll = this.now() + p.public.interval * 1000;
        return { status: "pending", interval: p.public.interval };
      }
      if (token.error) {
        p.code = "";
        return this.finish(p, {
          status: token.error === "expired_token" ? "expired" : "declined",
        });
      }
      const account = await this.authenticate(token, p.clientId);
      if (p.state) return p.state;
      if (!account) {
        p.code = "";
        return this.finish(p, { status: "unlicensed" });
      }
      return await this.serialized(async () => {
        if (p.state) return p.state;
        await this.load();
        if (p.state) return p.state;
        // Cancellation is allowed before this synchronous boundary, never mid-commit.
        p.committing = true;
        try {
          await this.save([
            ...this.accounts.filter((a) => a.summary.id !== account.summary.id),
            account,
          ]);
          return this.finish(p, {
            status: "completed",
            account: this.summary(account),
          });
        } finally {
          p.committing = false;
        }
      });
    } finally {
      p.busy = false;
    }
  }
  choosePcl(): Promise<boolean> { return this.bridge?.choose?.() ?? Promise.resolve(false); }
  async dispose(): Promise<void> {
    for (const p of this.pending.values()) if (p.bridge && !p.state && !p.committing) this.finish(p, { status: "cancelled" });
    await this.bridge?.dispose?.();
  }
  private pclAccount(c: PclCredential): StoredAccount {
    return { provider: "pcl", summary: { id: "microsoft:" + c.uuid, uuid: c.uuid, name: c.name, kind: "microsoft", status: "ready" }, accessToken: c.accessToken, refreshToken: c.refreshToken, expiresAt: c.expiresAt, texture: activeTexture(c.profile) };
  }
  private async authenticate(
    token: any,
    clientId: string,
  ): Promise<StoredAccount | undefined> {
    const ms = required(token.access_token),
      refresh = required(token.refresh_token);
    const xbox = await this.request(
      "https://user.auth.xboxlive.com/user/authenticate",
      {
        Properties: {
          AuthMethod: "RPS",
          SiteName: "user.auth.xboxlive.com",
          RpsTicket: "d=" + ms,
        },
        RelyingParty: "http://auth.xboxlive.com",
        TokenType: "JWT",
      },
    );
    const hash = required(xbox.DisplayClaims?.xui?.[0]?.uhs);
    const xsts = await this.request(
      "https://xsts.auth.xboxlive.com/xsts/authorize",
      {
        Properties: { SandboxId: "RETAIL", UserTokens: [required(xbox.Token)] },
        RelyingParty: "rp://api.minecraftservices.com/",
        TokenType: "JWT",
      },
    );
    const mc = await this.request(
      "https://api.minecraftservices.com/authentication/login_with_xbox",
      { identityToken: "XBL3.0 x=" + hash + ";" + required(xsts.Token) },
    );
    const accessToken = required(mc.access_token),
      expiresAt = this.now() + duration(mc.expires_in);
    const ownership = await this.request(
      "https://api.minecraftservices.com/entitlements/mcstore",
      undefined,
      accessToken,
    );
    if (
      !Array.isArray(ownership.items) ||
      !ownership.items.some((x: any) => x.name === "game_minecraft")
    )
      return undefined;
    const profile = await this.request(
      "https://api.minecraftservices.com/minecraft/profile",
      undefined,
      accessToken,
    );
    if (
      !/^[a-f0-9]{32}$/i.test(profile.id) ||
      !/^[A-Za-z0-9_]{3,16}$/.test(profile.name)
    )
      throw new Error("Minecraft 资料无效");
    return {
      summary: {
        id: "microsoft:" + profile.id,
        name: profile.name,
        uuid: profile.id,
        kind: "microsoft",
        status: "ready",
      },
      accessToken,
      refreshToken: refresh,
      expiresAt,
      clientId,
      texture: activeTexture(profile),
    };
  }
  getLaunchIdentity(
    id: string,
    signal?: AbortSignal,
  ): Promise<{ name: string; uuid: string; accessToken: string }> {
    return this.getIdentity(id, signal);
  }
  private async getIdentity(id: string, signal?: AbortSignal): Promise<{ name: string; uuid: string; accessToken: string }> {
    const snapshot = await this.serialized(async () => { await this.load(); return this.accounts.find(a => a.summary.id === id); });
    if (snapshot?.provider === "pcl") {
      if (signal?.aborted) throw new Error("启动已取消");
      if (snapshot.summary.status === "ready" && (snapshot.expiresAt ?? 0) > this.now() + 60000) {
        return this.serialized(async () => {
          if (signal?.aborted) throw new Error("启动已取消");
          if (!this.accounts.includes(snapshot)) throw new Error("账户已更改");
          return { name: snapshot.summary.name, uuid: snapshot.summary.uuid, accessToken: required(snapshot.accessToken) };
        });
      }
      if (!this.bridge) throw new Error("账户已过期，请重新登录");
      const attempt = this.bridge.begin(required(snapshot.refreshToken));
      let cancel: Promise<void> | undefined;
      let rejectAbort!: (error: Error) => void;
      const aborted = new Promise<never>((_, reject) => { rejectAbort = reject; });
      const abort = () => {
        cancel ??= attempt.cancel();
        void cancel.then(() => rejectAbort(new Error("启动已取消")), rejectAbort);
      };
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
      try {
        const credential = await Promise.race([attempt.result, aborted]);
        if (signal?.aborted) throw new Error("启动已取消");
        const refreshed = this.pclAccount(credential);
        if (refreshed.summary.id !== id) throw new Error("身份不匹配");
        return await this.serialized(async () => {
          if (signal?.aborted) throw new Error("启动已取消");
          if (!this.accounts.includes(snapshot)) throw new Error("账户已更改");
          await this.save(this.accounts.map(a => a === snapshot ? refreshed : a));
          return { name: refreshed.summary.name, uuid: refreshed.summary.uuid, accessToken: required(refreshed.accessToken) };
        });
      } finally { signal?.removeEventListener("abort", abort); }
    }
    return this.serialized(async () => {
      await this.load();
      let account = this.accounts.find((a) => a.summary.id === id);
      if (!account) throw new Error("账户不存在");
      if (account !== snapshot) throw new Error("账户已更改");
      if (account.summary.kind === "local")
        return {
          name: account.summary.name,
          uuid: account.summary.uuid,
          accessToken: "local-test-identity",
        };
      if (
        account.summary.status !== "ready" ||
        (account.expiresAt ?? 0) <= this.now() + 60000
      ) {
        try {
          const token = await this.request(
            authority + "token",
            new URLSearchParams({
              client_id: required(account.clientId),
              grant_type: "refresh_token",
              refresh_token: required(account.refreshToken),
              scope,
            }),
          );
          token.refresh_token ??= account.refreshToken;
          const refreshed = await this.authenticate(
            token,
            required(account.clientId),
          );
          if (!refreshed || refreshed.summary.id !== id) throw new Error();
          await this.save(
            this.accounts.map((a) => (a === account ? refreshed : a)),
          );
          account = refreshed;
        } catch {
          account.summary.status = "expired";
          delete account.accessToken;
          await this.save();
          throw new Error("账户已过期，请重新登录");
        }
      }
      return {
        name: account.summary.name,
        uuid: account.summary.uuid,
        accessToken: required(account.accessToken),
      };
    });
  }
}
