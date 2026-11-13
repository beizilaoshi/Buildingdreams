import { it, expect, vi } from "vitest";
import { writeFile, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { LaunchService } from "../src/main/services/launch";
import { AccountService } from "../src/main/services/accounts";
import { InstanceService } from "../src/main/services/instances";
import { JavaService } from "../src/main/services/java";
import { fixture } from "./minecraft-fixture";
import type { PclProvider } from "../src/main/services/pcl-bridge";
it("launch cancellation reaches an owned PCL refresh",async()=>{
 const dir=await mkdtemp(join(tmpdir(),"launch-refresh-"));
 try {
  const credential={uuid:"b".repeat(32),name:"Alex",accessToken:"access",refreshToken:"refresh",expiresAt:500000,profile:{}};let resolve!:(value:typeof credential)=>void;let cancelled=false;let count=0;
  const bridge:PclProvider={begin:()=>({login:{loginId:String(++count),provider:"pcl",userCode:"",verificationUri:"",expiresAt:900000,interval:1},poll:()=>({status:"pending",interval:1}),result:new Promise(r=>{resolve=r;}),cancel:async()=>{cancelled=true;resolve(credential);}})};
  const protect={isEncryptionAvailable:()=>true,encryptString:(s:string)=>Buffer.from(s),decryptString:(b:Buffer)=>b.toString()};let now=0;const accounts=new AccountService(join(dir,"vault"),protect,async()=>"",fetch,()=>now,bridge);const login=await accounts.beginMicrosoftLogin();resolve(credential);await Promise.resolve();await accounts.pollMicrosoftLogin(login.loginId);now=500001;
  const root=await fixture();await writeFile(join(root,"versions/base/base.jar"),"fixture");const instances=new InstanceService();const [item]=await instances.importDirectory(root);const java=new JavaService();vi.spyOn(java,"detect").mockResolvedValue([{path:process.execPath,major:17,version:"17",arch:"amd64"}]);
  const service=new LaunchService(instances,java,(id,signal)=>accounts.getLaunchIdentity(id,signal));const launch=service.launch(item.id,"microsoft:"+credential.uuid);const rejected=expect(launch).rejects.toThrow();await vi.waitFor(()=>expect(count).toBe(2));await service.cancel(item.id);await rejected;expect(cancelled).toBe(true);expect(service.status(item.id).phase).toBe("cancelled");
 } finally {await rm(dir,{recursive:true,force:true});}
});
