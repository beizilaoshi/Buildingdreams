/** Private protocol: no event from this module is sent directly to a renderer. */
export interface PclCredential { uuid: string; name: string; accessToken: string; refreshToken: string; expiresAt: number; profile: Record<string, unknown> }
export interface PclEvent { version: 2; sessionId: string; kind: string; stage: string; time: string; [key: string]: unknown }
export function officialVerification(value: string): boolean {
  return ["https://www.microsoft.com/link", "https://microsoft.com/link", "https://www.microsoft.com/devicelogin", "https://microsoft.com/devicelogin"].includes(value);
}
export function parsePclEvent(line: string, session: string): PclEvent {
  if (Buffer.byteLength(line) > 65536) throw new Error("认证通信无效");
  // Reject duplicate keys before JSON.parse can silently collapse them.
  const keys = topKeys(line);
  const event = JSON.parse(line);
  if (!event || Array.isArray(event) || typeof event !== "object") throw new Error("认证通信无效");
  const base = ["version", "sessionId", "kind", "stage", "time"];
  const extra: Record<string, string[]> = { heartbeat: [], progress: event.registryOwned === undefined ? [] : ["registryOwned", "registryOwner"], device: ["userCode", "verificationUri", "expiresAt", "interval"], completed: ["uuid", "name", "accessToken", "refreshToken", "expiresAt", "profile"], terminal: ["code"], cleanup: ["code"] };
  if (event.version !== 2 || event.sessionId !== session || !Object.hasOwn(extra, event.kind) || typeof event.stage !== "string" || !/^(initializing|presentation_gate_passed|MsLoginStep1New|MsLoginStep1Refresh|MsLoginStep[2-6])$/.test(event.stage) || !utc(event.time)) throw new Error("认证通信无效");
  const allowed = [...base, ...extra[event.kind]];
  if (Object.keys(event).sort().join() !== allowed.sort().join()) throw new Error("认证通信无效");
  // Nested profile keys may repeat other names, but top-level duplicate fields never may.
  for (const key of allowed) if (keys.filter(k => k === key).length !== 1) throw new Error("认证通信无效");
  if (event.kind === "progress" && event.registryOwned !== undefined && (event.registryOwned !== true || event.registryOwner !== "zhumeng.pcl.auth.v2")) throw new Error("认证通信无效");
  if (event.kind === "device" && (!str(event.userCode, 32) || !/^[A-Z0-9-]{4,32}$/.test(event.userCode) || !officialVerification(event.verificationUri) || !utc(event.expiresAt) || !Number.isInteger(event.interval) || event.interval < 1 || event.interval > 300)) throw new Error("认证通信无效");
  if (event.kind === "completed" && (typeof event.uuid !== "string" || !/^[a-f0-9]{32}$/i.test(event.uuid) || typeof event.name !== "string" || !/^[A-Za-z0-9_]{3,16}$/.test(event.name) || !str(event.accessToken,16384) || !str(event.refreshToken,16384) || !utc(event.expiresAt) || !event.profile || Array.isArray(event.profile) || typeof event.profile !== "object")) throw new Error("认证通信无效");
  if (event.kind === "terminal" && !["account_action_required","unlicensed","profile_required","network_error","declined","expired","cancelled","unsupported"].includes(event.code)) throw new Error("认证通信无效");
  if (event.kind === "cleanup" && !["complete","failed","parent_required"].includes(event.code)) throw new Error("认证通信无效");
  return event;
}
function str(v: unknown, max: number): v is string { return typeof v === "string" && v.length > 0 && v.length <= max && !v.includes("\0"); }
function utc(v: unknown): boolean { return typeof v === "string" && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,7})?Z$/.test(v) && Number.isFinite(Date.parse(v)); }
function topKeys(line: string): string[] {
  const keys: string[]=[];
  let depth=0;
  for(let i=0;i<line.length;i++) {
    const c=line[i];
    if(c==='"') {
      const start=i++;
      while(i<line.length) { if(line[i]==="\\") i+=2; else if(line[i]==='"') break; else i++; }
      let next=i+1; while(/\s/.test(line[next]??"") && next<line.length) next++;
      if(depth===1 && line[next]===":") keys.push(JSON.parse(line.slice(start,i+1)));
    } else if(c==="{" || c==="[") { if(++depth>16) throw new Error("认证通信无效"); }
    else if(c==="}" || c==="]") depth--;
  }
  return keys;
}
