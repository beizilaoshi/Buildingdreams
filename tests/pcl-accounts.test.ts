import { test, expect } from "vitest";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { AccountService } from "../src/main/services/accounts";
import type { PclCredential } from "../src/main/services/pcl-protocol";
import type { PclAttempt, PclProvider } from "../src/main/services/pcl-bridge";
const protect={isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(Buffer.from(s).map(b=>b^71)),decryptString:(b:Buffer)=>Buffer.from(b).map(v=>v^71).toString()};
const credential:PclCredential={uuid:"b".repeat(32),name:"Alex",accessToken:"PRIVATE_ACCESS",refreshToken:"PRIVATE_REFRESH",expiresAt:500000,profile:{}};
function provider() {
  const attempts: {resolve:(v:PclCredential)=>void;cancelled:boolean;refresh?:string}[]=[];
  const bridge:PclProvider={begin(refresh){
    let resolve!:(v:PclCredential)=>void;
    const result=new Promise<PclCredential>(yes=>{resolve=yes;});
    const item={resolve,cancelled:false,refresh}; attempts.push(item);
    const attempt:PclAttempt={login:{loginId:"fixture-"+attempts.length,provider:"pcl",userCode:"",verificationUri:"",expiresAt:900000,interval:1},poll:()=>({status:"pending",interval:1,stage:"preparing"}),result,cancel:async()=>{item.cancelled=true;}};
    return attempt;
  }};return {bridge,attempts};
}
test("PCL accounts persist encrypted, expose summaries only and refresh through same provider",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"pcl-vault-"));
  try {
    const f=provider();let now=0;
    const file=join(dir,"accounts.vault");
    const service=new AccountService(file,protect,async()=>{throw Error("client id must not be read");},async()=>{throw Error("own-client network must not run");},()=>now,f.bridge);
    const login=await service.beginMicrosoftLogin();expect(login.userCode).toBe("");expect(JSON.stringify(login)).not.toContain("PRIVATE");
    expect(await service.pollMicrosoftLogin(login.loginId)).toMatchObject({status:"pending"});
    f.attempts[0].resolve(credential);await Promise.resolve();
    const completed=await service.pollMicrosoftLogin(login.loginId);expect(completed.status).toBe("completed");expect(JSON.stringify(completed)).not.toContain("PRIVATE");
    const raw=await readFile(file);expect(raw.toString()).not.toContain("PRIVATE");expect(JSON.parse(protect.decryptString(raw))[0].provider).toBe("pcl");
    now=500001;const identity=service.getLaunchIdentity("microsoft:"+credential.uuid);await new Promise(r=>setImmediate(r));expect(f.attempts[1].refresh).toBe(credential.refreshToken);
    f.attempts[1].resolve({...credential,accessToken:"REFRESHED_ACCESS",expiresAt:900000});expect((await identity).accessToken).toBe("REFRESHED_ACCESS");
    const local=await service.addLocal("Steve");expect((await service.getLaunchIdentity(local.id)).accessToken).toBe("local-test-identity");expect(f.attempts).toHaveLength(2);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("cancel before queued commit discards late credentials without touching vault",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"pcl-cancel-"));
  try {
    const f=provider(),service=new AccountService(join(dir,"vault"),protect,async()=>"",fetch,()=>0,f.bridge);
    const login=await service.beginMicrosoftLogin();await service.cancelMicrosoftLogin(login.loginId);f.attempts[0].resolve(credential);await Promise.resolve();
    expect(await service.pollMicrosoftLogin(login.loginId)).toEqual({status:"cancelled"});expect(await service.list()).toEqual([]);expect(f.attempts[0].cancelled).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true});}
});
test("retry cancellation still stops a bridge that reported terminal before exiting",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"pcl-terminal-"));
  try {
    let cancelled=false;
    const bridge:PclProvider={begin:()=>({login:{loginId:"terminal",provider:"pcl",userCode:"",verificationUri:"",expiresAt:900000,interval:1},poll:()=>({status:"failed",code:"network_error"}),result:new Promise(()=>{}),cancel:async()=>{cancelled=true;}})};
    const service=new AccountService(join(dir,"vault"),protect,async()=>"",fetch,()=>0,bridge);
    const login=await service.beginMicrosoftLogin();expect((await service.pollMicrosoftLogin(login.loginId)).status).toBe("failed");
    await service.cancelMicrosoftLogin(login.loginId);expect(cancelled).toBe(true);
  } finally {await rm(dir,{recursive:true,force:true});}
});

test("replacement waits for owned cancellation before starting another worker",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"barrier-"));
 try { let release!:()=>void; const f=provider(); const begin=f.bridge.begin.bind(f.bridge); f.bridge.begin=(token)=>{const a=begin(token); if(!token) a.cancel=()=>new Promise<void>(r=>{release=r;}); return a;};
 const service=new AccountService(join(dir,"vault"),protect,async()=>"",fetch,()=>0,f.bridge);
 const first=await service.beginMicrosoftLogin(); const cancelling=service.cancelMicrosoftLogin(first.loginId); const next=service.beginMicrosoftLogin(); await new Promise(r=>setImmediate(r)); expect(f.attempts).toHaveLength(1); release(); await cancelling; await next; expect(f.attempts).toHaveLength(2);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test("pending PCL refresh leaves vault available and abort prevents late save",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"refresh-"));
 try {const f=provider();let now=0; const service=new AccountService(join(dir,"vault"),protect,async()=>"",fetch,()=>now,f.bridge); const login=await service.beginMicrosoftLogin(); f.attempts[0].resolve(credential); await Promise.resolve(); await service.pollMicrosoftLogin(login.loginId); const local=await service.addLocal("Steve"); now=500001;
 const controller=new AbortController(); const identity=service.getLaunchIdentity("microsoft:"+credential.uuid,controller.signal); await new Promise(r=>setImmediate(r)); const list=service.list(); const offline=service.getLaunchIdentity(local.id); expect(await Promise.race([Promise.all([list,offline]).then(()=>true),new Promise(r=>setTimeout(()=>r(false),50))])).toBe(true); controller.abort(); f.attempts[1].resolve({...credential,accessToken:"LATE",expiresAt:900000}); await expect(identity).rejects.toThrow(); expect((await service.list()).find(a=>a.kind==="microsoft")?.status).toBe("expired"); expect(f.attempts[1].cancelled).toBe(true);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test("removed account cannot be recreated by an in-flight refresh",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"refresh-remove-"));
 try {const f=provider();let now=0;const service=new AccountService(join(dir,"vault"),protect,async()=>"",fetch,()=>now,f.bridge);const login=await service.beginMicrosoftLogin();f.attempts[0].resolve(credential);await Promise.resolve();await service.pollMicrosoftLogin(login.loginId);now=500001;const id="microsoft:"+credential.uuid;const result=service.getLaunchIdentity(id);await new Promise(r=>setImmediate(r));await service.remove(id);f.attempts[1].resolve({...credential,expiresAt:900000});await expect(result).rejects.toThrow("账户已更改");expect(await service.list()).toEqual([]);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test("concurrent begins serialize each prior worker cleanup",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"barrier-many-"));
 try {const f=provider();const releases:(()=>void)[]=[];const begin=f.bridge.begin.bind(f.bridge);f.bridge.begin=(token)=>{const a=begin(token);a.cancel=()=>new Promise<void>(r=>releases.push(r));return a;};const service=new AccountService(join(dir,"vault"),protect,async()=>"",fetch,()=>0,f.bridge);await service.beginMicrosoftLogin();const second=service.beginMicrosoftLogin(),third=service.beginMicrosoftLogin();await new Promise(r=>setImmediate(r));expect(f.attempts).toHaveLength(1);releases.shift()!();await second;await new Promise(r=>setImmediate(r));expect(f.attempts).toHaveLength(2);releases.shift()!();await third;expect(f.attempts).toHaveLength(3);
 } finally {await rm(dir,{recursive:true,force:true});}
});

test("PCL identity stays on its provider when the clock crosses the refresh boundary",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"pcl-clock-"));
 try {const f=provider();let boundary=false,reads=0,requests=0;const file=join(dir,"vault");const service=new AccountService(file,protect,async()=>"",async()=>{requests++;throw new Error("legacy request");},()=>boundary ? (reads++ === 0 ? 0 : 2) : 0,f.bridge);const login=await service.beginMicrosoftLogin();f.attempts[0].resolve({...credential,expiresAt:60001});await Promise.resolve();await service.pollMicrosoftLogin(login.loginId);const before=await readFile(file);boundary=true;const identity=await service.getLaunchIdentity("microsoft:"+credential.uuid);expect(identity.accessToken).toBe(credential.accessToken);expect(requests).toBe(0);expect(f.attempts).toHaveLength(1);expect(await readFile(file)).toEqual(before);
 } finally {await rm(dir,{recursive:true,force:true});}
});
