import { test, expect, vi, afterEach } from "vitest";
import { execFile } from "node:child_process";
import { mkdtemp, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AccountService } from "../src/main/services/accounts";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { PclBridge, privatePclRuntime, type PclRuntime } from "../src/main/services/pcl-bridge";
import { parsePclEvent } from "../src/main/services/pcl-protocol";
import { removeOwnedPclRegistry } from "../src/main/services/pcl-registry";
vi.mock("node:child_process", async importOriginal => ({ ...await importOriginal<typeof import("node:child_process")>(), execFile: vi.fn() }));
afterEach(()=>vi.mocked(execFile).mockReset());
function fixture(registryCleanup?: PclRuntime["cleanup"]) {
  let now=0, session="", cleanup=0, closed=false, cleanedOwned=false;
  const child=Object.assign(new EventEmitter(),{stdin:new PassThrough(),stdout:new PassThrough(),stderr:new PassThrough(),kill:()=>{close(1);return true;}});
  const close=(code=0)=>{closed=true; child.emit("close",code);};
  const runtime: PclRuntime={prepare:async id=>{session=id;return {directory:"private",executable:"worker"};},spawn:()=>child as any,cleanup:async(s,_d,owned)=>{expect(closed).toBe(true);cleanup++;cleanedOwned=owned;await registryCleanup?.(s,undefined,owned);}};
  const bridge=new PclBridge(runtime,()=>now), attempt=bridge.begin();
  const emit=(kind:string, extra:object={})=>child.stdout.write(JSON.stringify({version:2,sessionId:session,kind,stage:"initializing",time:"2026-11-12T00:00:00Z",...extra})+"\n");
  const ready=()=>new Promise(resolve=>setImmediate(resolve));
  return {attempt,emit,close,ready,child,bridge,clock:(v:number)=>{now=v;},stats:()=>({cleanup,cleanedOwned}),owned:()=>emit("progress",{registryOwned:true,registryOwner:"zhumeng.pcl.auth.v2"})};
}
const credential={uuid:"a".repeat(32),name:"Steve",accessToken:"fixture-access",refreshToken:"fixture-refresh",expiresAt:"2026-11-13T00:00:00Z",profile:{id:"a".repeat(32),name:"Steve"}};
test("completion stays private until child exit and mandatory cleanup",async()=>{
  const f=fixture(); await f.ready(); f.owned(); f.emit("completed",credential); f.emit("cleanup",{code:"parent_required"});
  let settled=false; void f.attempt.result.then(()=>{settled=true;}); await f.ready(); expect(settled).toBe(false); expect(f.stats().cleanup).toBe(0);
  f.close(); expect((await f.attempt.result).name).toBe("Steve"); expect(f.stats()).toEqual({cleanup:1,cleanedOwned:true});
});
test("heartbeat uses receive time, stale remains pending and patient wait never succeeds",async()=>{
  const f=fixture();await f.ready();f.owned();f.clock(120001);f.emit("heartbeat");expect(f.attempt.poll()).toMatchObject({status:"pending",stage:"waiting"});f.clock(140001);expect(f.attempt.poll()).toMatchObject({status:"pending",stage:"reconnecting"});f.close(1);await expect(f.attempt.result).rejects.toThrow();
});
test.each(["wrong-session","unknown","oversize","missing-final","nonzero","no-ownership","post-final","stderr"])("fails closed: %s",async mode=>{
  const f=fixture();await f.ready(); if(mode!=="no-ownership")f.owned();
  if(mode==="wrong-session")f.emit("heartbeat",{sessionId:"different"});
  else if(mode==="unknown")f.emit("surprise");
  else if(mode==="oversize")f.child.stdout.write("x".repeat(65537));
  else if(mode==="stderr")f.child.stderr.write("x".repeat(65537));
  else if(mode!=="missing-final") {f.emit("completed",credential);if(mode==="post-final")f.emit("heartbeat");f.emit("cleanup",{code:"parent_required"});}
  f.close(mode==="nonzero"?32:0);await expect(f.attempt.result).rejects.toThrow();expect(f.stats().cleanedOwned).toBe(mode!=="no-ownership");
});
test("cancel invalidates a late completion and cleanup occurs after exit",async()=>{
  const f=fixture();await f.ready();f.owned();const cancelled=f.attempt.cancel();f.emit("completed",credential);f.emit("cleanup",{code:"parent_required"});expect(f.stats().cleanup).toBe(0);f.close();await cancelled;await expect(f.attempt.result).rejects.toThrow();expect(f.attempt.poll()).toEqual({status:"cancelled"});
});
test("protocol rejects duplicate top-level fields, nesting and arbitrary URLs",()=>{
  const base={version:2,sessionId:"session",kind:"heartbeat",stage:"initializing",time:"2026-11-12T00:00:00Z"};
  expect(()=>parsePclEvent(JSON.stringify(base).replace('{','{"version":2,'),"session")).toThrow();
  expect(()=>parsePclEvent(JSON.stringify({...base,kind:"device",userCode:"ABCD",verificationUri:"https://evil.invalid",expiresAt:base.time,interval:5}),"session")).toThrow();
  expect(()=>parsePclEvent(JSON.stringify({...base,kind:"completed",...credential}),"session")).not.toThrow();
});
test.each(["execution", "access"])("successful delete followed by %s verification failure rejects credentials and never saves",async mode=>{
  vi.mocked(execFile).mockImplementation(((file:string,args:string[],_options:unknown,callback:Function)=>{
    if(file === "reg.exe") callback(args[0] === "delete" ? null : Object.assign(new Error(),{code:1}),"","");
    else if(mode === "execution") callback(Object.assign(new Error(),{code:"ENOENT"}),"","");
    else callback(null,JSON.stringify({deleteCode:0,queryCode:5}),"");
    return {stdin:{end:()=>{},on:()=>{}}};
  }) as any);
  const dir=await mkdtemp(join(tmpdir(),"pcl-cleanup-reject-")),vault=join(dir,"accounts.vault");
  try {
    const native=privatePclRuntime("unused","unused",async()=>"unused");
    const f=fixture(native.cleanup);await f.ready();
    const protector={isEncryptionAvailable:()=>true,encryptString:(v:string)=>Buffer.from(v),decryptString:(v:Buffer)=>v.toString()};
    const accounts=new AccountService(vault,protector,async()=>"",fetch,()=>0,{begin:()=>f.attempt});
    const login=await accounts.beginMicrosoftLogin();f.owned();f.emit("completed",credential);f.emit("cleanup",{code:"parent_required"});f.close();
    await expect(f.attempt.result.then(()=>true,()=>false)).resolves.toBe(false);
    expect((await accounts.pollMicrosoftLogin(login.loginId)).status).toBe("failed");
    expect(await accounts.list()).toEqual([]);await expect(access(vault)).rejects.toMatchObject({code:"ENOENT"});
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("registry cleanup accepts only successful delete and positive Win32 missing-key status",async()=>{
  const session="12345678-1234-4234-8234-123456789abc";
  for(const [deleteCode,queryCode,accepted] of [[0,2,true],[0,0,false],[0,5,false],[5,2,false],[2,2,false]] as const) {
    vi.mocked(execFile).mockImplementation(((_file:unknown,_args:unknown,_options:unknown,callback:Function)=>{
      callback(null,JSON.stringify({deleteCode,queryCode}),"");return {stdin:{end:()=>{},on:()=>{}}};
    }) as any);
    expect(await removeOwnedPclRegistry(session).then(()=>true,()=>false)).toBe(accepted);
  }
});
