import {test,expect,_electron as electron} from "@playwright/test";
import {mkdtemp,mkdir,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import {join} from "node:path";
test("local mods select visible, expose hidden selection, confirm exact files and report actual mutations", async () => {
 const data=await mkdtemp(join(tmpdir(),"local-mods-ui-")),root=join(data,"game");
 for(const id of ["One","Two"]) {
  await mkdir(join(root,"versions",id,"mods"),{recursive:true});
  await writeFile(join(root,"versions",id,id+".json"),JSON.stringify({id,mainClass:"Main",libraries:[],minecraftArguments:""}));
  for(const name of ["alpha.jar","beta.jar.disabled"]) await writeFile(join(root,"versions",id,"mods",name),id+name);
 }
 const app=await electron.launch({args:["."],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try {
  const page=await app.firstWindow(); await page.waitForSelector(".home-intro"); await page.keyboard.press("Escape");
  await page.evaluate(root=>window.launcher.invoke("instances.import",root),root);
  await page.reload();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");
  await page.getByRole("button",{name:"模组",exact:true}).click();
  const local=page.locator(".local-mods");
  await expect(local.getByRole("checkbox")).toHaveCount(2);
  await local.getByLabel("搜索本地 Mod").fill("alpha");
  await local.getByRole("button",{name:"选择可见项",exact:true}).click();
  await local.getByLabel("搜索本地 Mod").fill("beta");
  await expect(local.locator(".local-selection-summary")).toContainText("隐藏 1");
  await local.getByRole("button",{name:"批量禁用",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("alpha.jar");
  await expect(page.getByRole("dialog")).not.toContainText("beta.jar.disabled");
  await page.getByRole("button",{name:"确认禁用",exact:true}).click();
  await expect(local.locator(".local-operation-report")).toContainText("alpha.jar：已完成");
  // Both fixture directories are isolated; exactly one alpha is renamed.
  const changed=await Promise.all(["One","Two"].map(id=>readFile(join(root,"versions",id,"mods","alpha.jar.disabled"),"utf8").catch(()=>null)));
  expect(changed.filter(Boolean)).toHaveLength(1);
  await local.getByRole("button",{name:"清除选择",exact:true}).click();
  await local.getByLabel("搜索本地 Mod").fill("");
  await local.getByRole("radio",{name:"已禁用",exact:true}).click();
  await expect(local.getByRole("checkbox")).toHaveCount(2);
  await local.getByRole("button",{name:"选择可见项",exact:true}).click();
  await local.getByRole("button",{name:"批量移除",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("alpha.jar.disabled");
  await page.getByRole("button",{name:"关闭",exact:true}).click();
  const picker=page.getByRole("radiogroup",{name:"当前实例",exact:true});
  await picker.getByRole("radio",{checked:false}).first().click();
  await expect(page.locator(".local-selection-summary")).toContainText("已选择 0");
  await app.evaluate(({BrowserWindow})=>BrowserWindow.getAllWindows()[0].setSize(960,640));
  await page.locator(".local-mods").scrollIntoViewIfNeeded();
  await page.waitForTimeout(500);
  for(const theme of ["dark","light"] as const){
   await page.evaluate(theme=>window.launcher.invoke("settings.patch",{theme,reducedMotion:true}),theme);
   await page.reload();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");
   await page.getByRole("button",{name:"模组",exact:true}).click();await page.locator(".local-mods").scrollIntoViewIfNeeded();
   await expect(page.locator("html")).toHaveAttribute("data-motion","reduced");
   await page.waitForTimeout(100);
   await page.screenshot({path:`scratch/pcl-mod-batch-fix1-${theme}-min.png`,fullPage:false});
  }
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
test("native multi import shows chosen names and per-file outcomes without selecting new files", async()=>{
 const data=await mkdtemp(join(tmpdir(),"local-import-ui-")),root=join(data,"game"),source=join(data,"sources");
 await mkdir(join(root,"versions","One","mods"),{recursive:true});await mkdir(source);
 await writeFile(join(root,"versions","One","One.json"),JSON.stringify({id:"One",mainClass:"Main",libraries:[],minecraftArguments:""}));
 const {ZipFile}=await import("yazl"),zip=new ZipFile(),chunks:Buffer[]=[];
 zip.addBuffer(Buffer.from(JSON.stringify({id:"actual",name:"Actual Metadata Title",version:"7.2"})),"fabric.mod.json");
 const zipped=new Promise<Buffer>(resolve=>{zip.outputStream.on("data",b=>chunks.push(b));zip.outputStream.on("end",()=>resolve(Buffer.concat(chunks)));});zip.end();
 await writeFile(join(root,"versions","One","mods","keep.jar"),"keep");
 await writeFile(join(source,"new.jar"),await zipped);await writeFile(join(source,"bad.txt"),"invalid");
 const app=await electron.launch({args:["."],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  const page=await app.firstWindow();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");await page.evaluate(root=>window.launcher.invoke("instances.import",root),root);
  await app.evaluate(({dialog},paths)=>{dialog.showOpenDialog=(async (...args:any[])=>{const options=args.at(-1);if(!options.properties.includes("multiSelections"))throw new Error("not multi picker");return {canceled:false,filePaths:paths};}) as typeof dialog.showOpenDialog;},[join(source,"new.jar"),join(source,"bad.txt"),join(source,"new.jar")]);
  await page.reload();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");await page.getByRole("button",{name:"模组",exact:true}).click();
  const local=page.locator(".local-mods");await local.getByRole("button",{name:"导入本地 Mod",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("new.jar");await expect(page.getByRole("dialog")).toContainText("bad.txt");await page.getByRole("button",{name:"确认导入",exact:true}).click();
  await expect(local.locator(".local-operation-report")).toContainText("new.jar：已完成");await expect(local.locator(".local-operation-report")).toContainText("bad.txt：失败");await expect(local.locator(".local-operation-report")).toContainText("new.jar：失败");
  await expect(local.locator(".local-selection-summary")).toContainText("已选择 0");
  await local.getByLabel("搜索本地 Mod").fill("Actual Metadata Title");await expect(local.getByRole("checkbox")).toHaveCount(1);await expect(local).toContainText("7.2");await expect(local).toContainText("fabric");
  expect(await readFile(join(root,"versions","One","mods","new.jar"))).toEqual(await readFile(join(source,"new.jar")));
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
test("batch update UI waits for actual task results and keeps per-file HTTP failures visible",async()=>{
 const data=await mkdtemp(join(tmpdir(),"local-updates-ui-")),root=join(data,"game"),mods=join(root,"versions","1.21.1","mods");
 const {createHash}=await import("node:crypto");const bytes="old mod",sha1=createHash("sha1").update(bytes).digest("hex");
 await mkdir(mods,{recursive:true});await writeFile(join(root,"versions","1.21.1","1.21.1.json"),JSON.stringify({id:"1.21.1",mainClass:"Main",minecraftArguments:"",libraries:[{name:"net.fabricmc:fabric-loader:0.16.10"}]}));
 for(const name of ["a","b"])await writeFile(join(mods,name+".jar"),bytes);
 await writeFile(join(mods,".zhumeng-mods.json"),JSON.stringify({"a.jar":{projectId:"a",versionId:"old-a",sha1},"b.jar":{projectId:"b",versionId:"old-b",sha1}}));
 await mkdir(join(root,"versions","Other","mods"),{recursive:true});await writeFile(join(root,"versions","Other","Other.json"),JSON.stringify({id:"Other",mainClass:"Main",libraries:[],minecraftArguments:""}));await writeFile(join(root,"versions","Other","mods","other.jar"),"other");
 const app=await electron.launch({args:["."],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  const page=await app.firstWindow();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");await page.evaluate(root=>window.launcher.invoke("instances.import",root),root);
  await app.evaluate((_electron,{bytes,sha1})=>{
   const version=(id:string)=>({id,project_id:id.endsWith("a")?"a":"b",name:id,version_number:id,date_published:id.startsWith("old")?"2025-01-01":"2026-01-01",game_versions:["1.21.1"],loaders:["fabric"],dependencies:[],files:[{filename:id+".jar",url:"https://cdn.modrinth.com/"+id,primary:true,size:bytes.length,hashes:{sha1}}]});
   globalThis.fetch=async(url:any)=>{const u=new URL(String(url));
    if((globalThis as any).holdModCheck && u.pathname.includes("/project/")){(globalThis as any).modCheckPending=true;await new Promise<void>(r=>(globalThis as any).releaseModCheck=r);}
    if(u.hostname==="cdn.modrinth.com"){if((globalThis as any).holdModDownload){(globalThis as any).modDownloadPending=true;await new Promise<void>(r=>(globalThis as any).releaseModDownload=r);}await new Promise(r=>setTimeout(r,200));return u.pathname.endsWith("new-b") && !(globalThis as any).retryModSuccess?new Response("unavailable",{status:503}):new Response(bytes);}
    if(u.pathname.includes("/project/")&&u.pathname.endsWith("/version")){const id=u.pathname.split("/").at(-2)!;return new Response(JSON.stringify([version("new-"+id),version("old-"+id)]));}
    if(u.pathname.includes("/version/"))return new Response(JSON.stringify(version(u.pathname.split("/").at(-1)!)));
    return new Response(JSON.stringify({hits:[],offset:0,limit:20,total_hits:0}));};
  },{bytes,sha1});
  await page.reload();await page.waitForSelector(".home-intro");await page.keyboard.press("Escape");await page.getByRole("button",{name:"模组",exact:true}).click();
  const local=page.locator(".local-mods");await expect(local.getByRole("checkbox")).toHaveCount(2);await local.getByRole("button",{name:"检查更新",exact:true}).click();
  await expect(local.locator(".local-check-report")).toContainText("找到 2 项更新");await local.getByRole("radio",{name:"可更新",exact:true}).click();await local.getByRole("button",{name:"选择可见项",exact:true}).click();await local.getByRole("button",{name:"批量更新",exact:true}).click();
  await expect(page.getByRole("dialog")).toContainText("a.jar");await expect(page.getByRole("dialog")).toContainText("b.jar");await page.getByRole("button",{name:"确认更新",exact:true}).click();
  await expect(local.locator(".local-operation-report")).toContainText("a.jar：已完成");await expect(local.locator(".local-operation-report")).toContainText("b.jar：失败");await expect(local.locator(".local-operation-report")).toContainText("HTTP 503");
  expect(await readFile(join(mods,"new-a.jar"),"utf8")).toBe(bytes);expect(await readFile(join(mods,"b.jar"),"utf8")).toBe(bytes);
  const tasks=await page.evaluate(()=>window.launcher.invoke("tasks.list",undefined));expect(tasks.find(t=>t.label==="批量更新 Mod")?.status).toBe("failed");
  const originalId=tasks.find(t=>t.label==="批量更新 Mod")!.id;
  const originalReport=await page.evaluate(id=>window.launcher.invoke("mods.batchResult",id),originalId);
  await app.evaluate(()=>{(globalThis as any).retryModSuccess=true;});
  await page.locator("#task-toggle").click();
  await page.locator(`#task-panel [data-task-id="${originalId}"]`).getByRole("button",{name:"重试",exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=> (await window.launcher.invoke("tasks.list",undefined)).filter(t=>t.label==="批量更新 Mod").map(t=>t.status))).toEqual(["failed","completed"]);
  const retryId=await page.evaluate(async()=> (await window.launcher.invoke("tasks.list",undefined)).filter(t=>t.label==="批量更新 Mod")[1].id);
  expect(await page.evaluate(id=>window.launcher.invoke("mods.batchResult",id),originalId)).toEqual(originalReport);
  expect(await page.evaluate(id=>window.launcher.invoke("mods.batchResult",id),retryId)).toEqual([{fileName:"a.jar",status:"skipped",reason:"previously-completed"},{fileName:"b.jar",status:"completed"}]);
  expect(await readFile(join(mods,"new-b.jar"),"utf8")).toBe(bytes);
  await page.keyboard.press("Escape");
  const captured=await page.evaluate(async()=> (await window.launcher.invoke("instances.list",undefined)).find(i=>i.name==="1.21.1")!.id);
  const reviewed=await page.evaluate(id=>window.launcher.invoke("mods.list",id),captured);
  await app.evaluate(()=>{(globalThis as any).holdModDownload=true;});
  const cancelledId=await page.evaluate(({id,items})=>window.launcher.invoke("mods.batchUpdate",{instanceId:id,items}),{id:captured,items:reviewed.map(m=>({fileName:m.fileName,sha1:m.sha1,versionId:m.projectId==="a"?"next-a":"next-b"}))});
  await expect.poll(()=>app.evaluate(()=>Boolean((globalThis as any).modDownloadPending))).toBe(true);
  await page.locator("#task-toggle").click();
  await page.locator(`#task-panel [data-task-id="${cancelledId}"]`).getByRole("button",{name:"取消任务",exact:true}).click();
  await app.evaluate(()=>{(globalThis as any).holdModDownload=false;(globalThis as any).releaseModDownload();});
  await expect(page.locator(`#task-panel [data-task-id="${cancelledId}"]`)).toContainText("已取消");
  const cancelledReport=await page.evaluate(id=>window.launcher.invoke("mods.batchResult",id),cancelledId);expect(cancelledReport?.map(r=>r.status)).toEqual(["skipped","skipped"]);
  await page.locator(`#task-panel [data-task-id="${cancelledId}"]`).getByRole("button",{name:"重试",exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=> (await window.launcher.invoke("tasks.list",undefined)).filter(t=>t.label==="批量更新 Mod").map(t=>t.status))).toEqual(["failed","completed","cancelled","completed"]);
  const cancelledRetry=await page.evaluate(async()=> (await window.launcher.invoke("tasks.list",undefined)).filter(t=>t.label==="批量更新 Mod")[3].id);
  expect(await page.evaluate(id=>window.launcher.invoke("mods.batchResult",id),cancelledId)).toEqual(cancelledReport);
  expect((await page.evaluate(id=>window.launcher.invoke("mods.batchResult",id),cancelledRetry))?.map(r=>r.status)).toEqual(["completed","completed"]);
  expect(await readFile(join(mods,"next-a.jar"),"utf8")).toBe(bytes);expect(await readFile(join(mods,"next-b.jar"),"utf8")).toBe(bytes);
  expect(await readFile(join(root,"versions","Other","mods","other.jar"),"utf8")).toBe("other");
  await page.keyboard.press("Escape");
  await app.evaluate(()=>{(globalThis as any).holdModCheck=true;});
  await local.getByRole("button",{name:"检查更新",exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>Boolean((globalThis as any).modCheckPending))).toBe(true);
  await page.getByRole("radiogroup",{name:"当前实例",exact:true}).getByRole("radio",{name:"Other",exact:true}).click();
  await app.evaluate(()=>{(globalThis as any).holdModCheck=false;(globalThis as any).releaseModCheck();});
  await expect(page.locator(".local-mod-list")).toContainText("other.jar");
  await expect(page.locator(".local-check-report")).toBeEmpty();
  await expect(page.locator(".local-selection-summary")).toContainText("已选择 0");
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
