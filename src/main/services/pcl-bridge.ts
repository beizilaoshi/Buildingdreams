import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { mkdtemp, mkdir, copyFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { DeviceLogin, DevicePoll } from "../../shared/types";
import { parsePclEvent, type PclCredential } from "./pcl-protocol";
import { removeOwnedPclRegistry } from "./pcl-registry";

export interface PclAttempt { login: DeviceLogin; poll(): DevicePoll; result: Promise<PclCredential>; cancel(): Promise<void> }
export interface PclProvider { begin(refreshToken?: string): PclAttempt; choose?(): Promise<boolean>; dispose?(): Promise<void> }
export interface PclRuntime {
  prepare(session: string): Promise<{ directory: string; executable: string }>;
  spawn(executable: string, directory: string): ChildProcessWithoutNullStreams;
  cleanup(session: string, directory: string | undefined, owned: boolean): Promise<void>;
}
class PclDependencyError extends Error {}
export class PclBridge implements PclProvider {
  private attempts = new Set<PclAttempt>();
  constructor(private runtime: PclRuntime, private now = Date.now, public choose?: () => Promise<boolean>) {}
  begin(refreshToken?: string): PclAttempt {
    if (refreshToken !== undefined && (typeof refreshToken !== "string" || !refreshToken || refreshToken.length > 16384)) throw new Error("认证凭据无效");
    const session = randomUUID(), started = this.now();
    const login: DeviceLogin = { loginId: session, userCode: "", verificationUri: "", expiresAt: started + 900000, interval: 1, provider: "pcl" };
    let state: DevicePoll = { status: "pending", interval: 1, stage: "preparing" }, child: ChildProcessWithoutNullStreams | undefined, directory: string | undefined;
    let cancelled = false, owned = false, final = false, cleanupEvent = false, failed = false, completed: PclCredential | undefined, lastBeat = started;
    let resolve!: (v: PclCredential) => void, reject!: (e: Error) => void;
    const result = new Promise<PclCredential>((yes,no) => { resolve=yes; reject=no; });
    void result.catch(() => {});
    let exited!: () => void;
    const exit = new Promise<void>(yes => { exited=yes; });
    let killTimer: ReturnType<typeof setTimeout> | undefined;
    const stop = () => {
      if (!child) return;
      if (child.stdin.writable) child.stdin.write(JSON.stringify({ command:"cancel", sessionId:session }) + "\n");
      killTimer ??= setTimeout(() => child?.kill(), 1500);
    };
    const fail = () => { failed=true; stop(); };
    const attempt: PclAttempt = {
      login, result,
      poll: () => {
        if (state.status !== "pending") return state;
        const elapsed = this.now() - started;
        return { ...state, device: login.userCode ? { ...login } : undefined, stage: elapsed >= 10000 && this.now()-lastBeat > 15000 ? "reconnecting" : elapsed >= 120000 ? "waiting" : state.stage };
      },
      cancel: async () => { cancelled=true; completed=undefined; stop(); await exit; },
    };
    this.attempts.add(attempt);
    void (async () => {
      let code: number | null = null;
      try {
        const prepared = await this.runtime.prepare(session); directory=prepared.directory;
        if (cancelled) throw new Error();
        child=this.runtime.spawn(prepared.executable, directory);
        let buffer=Buffer.alloc(0), stderrBytes=0;
        child.stdout.on("data", (data: Buffer) => {
          if (failed) return;
          buffer=Buffer.concat([buffer,data]);
          if (buffer.length > 131072) { fail(); return; }
          let end: number;
          while ((end=buffer.indexOf(10)) >= 0) {
            const line=buffer.subarray(0,end); buffer=buffer.subarray(end+1);
            try {
              const e=parsePclEvent(new TextDecoder("utf-8",{fatal:true}).decode(line).replace(/\r$/, ""),session);
              if (final && e.kind !== "cleanup" || cleanupEvent) throw new Error();
              if (e.kind === "progress" && e.registryOwned === true) { if(owned || e.stage !== "initializing") throw new Error(); owned=true; }
              if (["device","completed"].includes(e.kind) && !owned) throw new Error();
              if (e.kind === "heartbeat") lastBeat=this.now();
              if (e.kind === "progress") state={status:"pending",interval:1,stage:"authenticating"};
              if (e.kind === "device") Object.assign(login,{userCode:e.userCode,verificationUri:e.verificationUri,expiresAt:Date.parse(e.expiresAt as string),interval:e.interval});
              if (e.kind === "completed") { final=true; completed={uuid:e.uuid as string,name:e.name as string,accessToken:e.accessToken as string,refreshToken:e.refreshToken as string,expiresAt:Date.parse(e.expiresAt as string),profile:e.profile as Record<string,unknown>}; }
              if (e.kind === "terminal") { final=true; state={status:"failed",code:e.code as string}; }
              if (e.kind === "cleanup") { cleanupEvent=true; if(e.code !== "parent_required" && owned) failed=true; }
            } catch { fail(); }
          }
          if(buffer.length>65536) fail();
        });
        child.stderr.on("data", (data: Buffer) => { stderrBytes+=data.length; if(stderrBytes>65536) fail(); });
        const closed = new Promise<number|null>((yes,no) => { child!.once("error",()=>{failed=true;}); child!.once("close",yes); });
        child.stdin.on("error",fail);
        // Keep the input pipe open: EOF means cancellation.
        const request=JSON.stringify(refreshToken ? {command:"refresh",sessionId:session,refreshToken} : {command:"login",sessionId:session});
        if(Buffer.byteLength(request)>65536) { fail(); } else child.stdin.write(request+"\n");
        code=await closed;
        if(buffer.length) failed=true;
      } catch (error) {
        failed=true;
        if(error instanceof PclDependencyError) state={status:"failed",code:"dependency_error"};
      }
      finally {
        clearTimeout(killTimer);
        try { await this.runtime.cleanup(session,directory,owned); } catch { failed=true; }
        this.attempts.delete(attempt); exited();
      }
      if (!cancelled && !failed && code===0 && final && cleanupEvent && owned && completed && completed.expiresAt > this.now()) { resolve(completed); return; }
      completed=undefined;
      if(cancelled) state={status:"cancelled"};
      else if(state.status === "pending") state={status:"failed",code:"worker_error"};
      reject(new Error("PCL 认证未完成，请重试或选择受支持的 PCL 文件"));
    })();
    return attempt;
  }
  async dispose(): Promise<void> { await Promise.all([...this.attempts].map(a=>a.cancel())); }
}

export function privatePclRuntime(root: string, worker: string, dependency: () => Promise<string>): PclRuntime {
  const ownedDirectories=new Set<string>();
  return {
    async prepare(session) {
      const source=await dependency();
      let hash: string;
      try { hash=createHash("sha256").update(await readFile(source)).digest("hex"); }
      catch { throw new PclDependencyError("无法读取 PCL 文件"); }
      if(hash !== "0db34e19d9eeb6d496d20fabe786ec16bbd36ba6b0ccdc8d29cb7e909c114397") throw new PclDependencyError("不支持的 PCL 文件");
      await mkdir(root,{recursive:true});
      const directory=await mkdtemp(join(root,"auth-"+session+"-")); ownedDirectories.add(directory);
      try {
        for(const name of ["TEMP","APPDATA","LOCALAPPDATA","USERPROFILE"]) await mkdir(join(directory,name));
        await Promise.all([copyFile(join(worker,"PclBridge.exe"),join(directory,"PclBridge.exe")),copyFile(join(worker,"0Harmony.dll"),join(directory,"0Harmony.dll")),copyFile(source,join(directory,"Plain Craft Launcher 2.exe"))]);
        return {directory,executable:join(directory,"PclBridge.exe")};
      } catch(error) { await rm(directory,{recursive:true,force:true}); ownedDirectories.delete(directory); throw error; }
    },
    spawn(executable,directory) { return spawn(executable,["--auth"],{cwd:directory,windowsHide:true,stdio:"pipe",env:{...process.env,TEMP:join(directory,"TEMP"),TMP:join(directory,"TEMP"),APPDATA:join(directory,"APPDATA"),LOCALAPPDATA:join(directory,"LOCALAPPDATA"),USERPROFILE:join(directory,"USERPROFILE")}}); },
    async cleanup(session,directory,owned) {
      let failure=!owned;
      if(owned) { try { await removeOwnedPclRegistry(session); } catch { failure=true; } }
      if(directory) { if(!ownedDirectories.has(directory)) throw new Error("清理失败"); await rm(directory,{recursive:true,force:true}); ownedDirectories.delete(directory); }
      if(failure) throw new Error("认证清理归属无法确认");
    },
  };
}
