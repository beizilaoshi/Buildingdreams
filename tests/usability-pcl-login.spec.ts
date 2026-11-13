import { test, expect, _electron as electron, type ElectronApplication } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
async function install(app: ElectronApplication) {
  await app.evaluate((_e,cwd)=>{
    const req=(process as any).mainModule.require.bind((process as any).mainModule);
    const Router=req(req("node:path").join(cwd,"dist/main/ipc.js")).CommandRouter, original=Router.prototype.invoke;
    const f:any=(globalThis as any).pclFixture={mode:"preparing",calls:[],generation:0};
    Router.prototype.invoke=async function(command:string,payload:unknown) {
      f.calls.push({command,payload});
      if(command==="accounts.beginMicrosoftLogin")return {loginId:"pcl-"+(++f.generation),provider:"pcl",userCode:"",verificationUri:"",expiresAt:Date.now()+900000,interval:0.02};
      if(command==="accounts.pollMicrosoftLogin") {
        if(f.hold) await new Promise(r=>{f.release=r;});
        if(f.mode==="completed") return {status:"completed",account:{id:"ms-fixture",name:"PclFixture",uuid:"a".repeat(32),kind:"microsoft",status:"ready"}};
        if(f.mode==="error")return {status:"failed",code:f.code??"worker_error"};
        return {status:"pending",interval:0.02,stage:f.mode,device:f.mode==="preparing"?undefined:{loginId:payload,provider:"pcl",userCode:"TEST-CODE",verificationUri:"https://www.microsoft.com/link",expiresAt:Date.now()+900000,interval:0.02}};
      }
      if(["accounts.copyUserCode","app.openVerification","accounts.cancelMicrosoftLogin"].includes(command))return;
      if(command==="accounts.choosePcl")return true;
      return original.call(this,command,payload);
    };
  },process.cwd());
}
test("PCL prepares early, opens safe device details once, waits patiently, retries and cancels stale generation",async()=>{
  const data=await mkdtemp(join(tmpdir(),"pcl-ui-"));
  const app=await electron.launch({args:["."],env:{...process.env,ZHUMENG_DATA_DIR:data}});
  try {
    const page=await app.firstWindow();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");
    await page.evaluate(()=>window.launcher.invoke("settings.patch",{openingEnabled:false,reducedMotion:true}));await page.reload();await install(app);
    await page.getByRole("radio",{name:"微软正版",exact:true}).click();await page.getByRole("button",{name:"登录 Microsoft",exact:true}).click();
    let modal=page.getByRole("dialog",{name:"登录 Microsoft",exact:true});
    await expect(modal).toContainText("正在准备 PCL");await expect(modal.getByLabel("Microsoft 客户端 ID")).toHaveCount(0);
    expect(await app.evaluate(()=>(globalThis as any).pclFixture.calls.filter((c:any)=>c.command==="app.openVerification").length)).toBe(0);
    await app.evaluate(()=>(globalThis as any).pclFixture.mode="authenticating");await expect(modal).toContainText("TEST-CODE");
    await expect.poll(()=>app.evaluate(()=>(globalThis as any).pclFixture.calls.filter((c:any)=>c.command==="app.openVerification").length)).toBe(1);
    await app.evaluate(()=>(globalThis as any).pclFixture.mode="waiting");await expect(modal).toContainText("加载可能需要时间，请耐心等待");
    for(const [width,height] of [[1280,820],[960,640]]) {await page.setViewportSize({width,height});await page.screenshot({path:`.superpowers/sdd/2026-11-12-pcl-headless/task3-pcl-${width}.png`});}
    expect(await app.evaluate(()=>(globalThis as any).pclFixture.calls.filter((c:any)=>c.command==="app.openVerification").length)).toBe(1);
    await app.evaluate(()=>{const f=(globalThis as any).pclFixture;f.mode="error";f.code="dependency_error";});await expect(modal).toContainText("PCL");await modal.getByRole("button",{name:"选择 PCL 文件",exact:true}).click();
    await app.evaluate(()=>{const f=(globalThis as any).pclFixture;f.mode="authenticating";f.hold=true;});
    await expect(modal).toBeVisible();await page.keyboard.press("Escape");await expect(modal).toHaveCount(0);
    await app.evaluate(()=>{const f=(globalThis as any).pclFixture;f.mode="completed";f.release?.();});
    expect(await page.evaluate(()=>localStorage.getItem("account"))).toBeNull();
    await expect.poll(()=>app.evaluate(()=>(globalThis as any).pclFixture.calls.filter((c:any)=>c.command==="accounts.cancelMicrosoftLogin").length)).toBeGreaterThanOrEqual(1);
  } finally {await app.close();await rm(data,{recursive:true,force:true});}
});
test("PCL terminal reasons remain actionable and only dependency failures offer choosing PCL",async()=>{
  const data=await mkdtemp(join(tmpdir(),"pcl-reasons-"));
  const app=await electron.launch({args:["."],env:{...process.env,ZHUMENG_DATA_DIR:data}});
  try {
    const page=await app.firstWindow();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");
    await page.evaluate(()=>window.launcher.invoke("settings.patch",{openingEnabled:false,reducedMotion:true}));await page.reload();await install(app);
    await page.getByRole("radio",{name:"微软正版",exact:true}).click();
    const cases=[
      ["unlicensed","没有 Minecraft Java 版授权",false],
      ["declined","授权已拒绝",false],
      ["expired","设备代码已过期",false],
      ["account_action_required","完成额外验证",false],
      ["profile_required","尚未建立 Minecraft Java 版角色资料",false],
      ["network_error","认证网络请求失败",false],
      ["cancelled","登录已取消",false],
      ["worker_error","认证服务异常",false],
      ["unsupported","不支持当前 PCL 文件",true],
      ["dependency_error","无法读取受支持的 PCL 文件",true],
    ] as const;
    for(const [code,text,dependency] of cases) {
      await app.evaluate((_e,code)=>{const f=(globalThis as any).pclFixture;f.mode="error";f.code=code;},code);
      await page.getByRole("button",{name:"登录 Microsoft",exact:true}).click();
      const modal=page.getByRole("dialog",{name:"登录 Microsoft",exact:true});
      await expect(modal).toContainText(text);
      if(dependency)await expect(modal.getByRole("button",{name:"选择 PCL 文件",exact:true})).toBeVisible();
      else await expect(modal.getByRole("button",{name:"选择 PCL 文件",exact:true})).toBeHidden();
      await page.keyboard.press("Escape");await expect(modal).toHaveCount(0);
    }
  } finally {await app.close();await rm(data,{recursive:true,force:true});}
});

test("PCL begin rejection with empty client ID shows its actual error",async()=>{
  const data=await mkdtemp(join(tmpdir(),"pcl-begin-error-"));
  const app=await electron.launch({args:["."],env:{...process.env,ZHUMENG_DATA_DIR:data}});
  try {
    const page=await app.firstWindow(); await page.waitForSelector(".home-intro"); await page.keyboard.press("Escape");
    await page.evaluate(()=>window.launcher.invoke("settings.patch",{openingEnabled:false,reducedMotion:true,microsoftClientId:""})); await page.reload(); await install(app);
    await app.evaluate((_e,cwd)=>{const req=(process as any).mainModule.require.bind((process as any).mainModule); const Router=req(req("node:path").join(cwd,"dist/main/ipc.js")).CommandRouter; const original=Router.prototype.invoke; Router.prototype.invoke=function(command:string,payload:unknown){if(command==="accounts.beginMicrosoftLogin")return Promise.reject(new Error("系统凭据加密不可用")); return original.call(this,command,payload);};},process.cwd());
    await page.getByRole("radio",{name:"微软正版",exact:true}).click(); await page.getByRole("button",{name:"登录 Microsoft",exact:true}).click();
    const modal=page.getByRole("dialog",{name:"登录 Microsoft",exact:true}); await expect(modal).toContainText("系统凭据加密不可用"); await expect(modal.getByLabel("Microsoft 客户端 ID")).toHaveCount(0); await expect(modal.getByRole("button",{name:"重试登录"})).toBeVisible();
  } finally {await app.close();await rm(data,{recursive:true,force:true});}
});
