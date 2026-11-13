import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, mkdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('installation target remains bound to actual task lifetime and recovers on remount', async () => {
 const data = await mkdtemp(join(tmpdir(), 'install-ui-'));
 const app = await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try {
 const page = await app.firstWindow(); await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
 await page.evaluate(() => window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true}));
 await app.evaluate((_electron, cwd) => {
  const req=(process as any).mainModule.require.bind((process as any).mainModule);
  const path=req('node:path'), fs=req('node:fs/promises');
  const Router=req(path.join(cwd,'dist/main/ipc.js')).CommandRouter;
  const TaskService=req(path.join(cwd,'dist/main/services/tasks.js')).TaskService;
  const original=Router.prototype.invoke, tasks=new TaskService();
  const f:any=(globalThis as any).installFixture={calls:[], root:path.join(process.env.ZHUMENG_DATA_DIR,'nested','games'), active:undefined, finish:undefined, mode:'hold', instances:[]};
  tasks.onSnapshot((t:any)=>{ for(const w of _electron.BrowserWindow.getAllWindows()) w.webContents.send('launcher:task',t); });
  const start=(p:any)=>{
   if(f.active)return f.active;
   const id=tasks.start('安装 '+p.name,async(ctx:any)=>{
    await fs.mkdir(path.join(p.root,p.name,'game'),{recursive:true}); ctx.report(.4);
    if(f.mode==='hold')await new Promise((resolve,reject)=>{f.finish=resolve;ctx.signal.addEventListener('abort',()=>reject(Error('cancelled')),{once:true});});
    if(f.mode==='fail')throw Error('controlled failure');
    f.instances.push({id:'created',name:p.name,resourceDir:path.join(p.root,p.name),gameDir:path.join(p.root,p.name,'game'),minecraft:p.version});
   },()=>start(p),()=>{f.active=undefined;});
   f.active=id;return id;
  };
  Router.prototype.invoke=async function(command:any,p:any){f.calls.push({command,p});
   if(command==='install.catalog')return {latest:{release:'1.20.1',snapshot:'1.20.1'},versions:['1.20.1','1.21.1'].map(id=>({id,type:'release',url:'https://fixture.invalid',time:'2026-11-01',releaseTime:'2026-11-01'}))};
   if(command==='loaders.versions'){if(f.holdLoader){f.holdLoader=false;await new Promise((resolve,reject)=>{f.releaseLoader=(fail:boolean)=>fail?reject(Error('old view failure')):resolve(undefined);});}return [{version:p.minecraft==='1.21.1'?'0.17.1':'0.16.10',stable:true}];}
   if(command==='instances.list')return f.instances;
   if(command==='install.preview') {const root=p.root||f.root; if(p.root?.endsWith('slow')) await new Promise(r=>setTimeout(r,650));return {installRoot:root,resourceDir:path.join(root,p.name),gameDir:path.join(root,p.name,'game'),activeTaskId:f.active, ...(p.name==='Recover'?{existingDirectory:path.join(root,p.name),recoverableDirectory:path.join(root,p.name)}:{})};}
   if(command==='instances.import'){f.imported=p;return {id:'recovered'};}
   if(command==='install.vanilla'){const id=start(p);if(f.mode==='early')await tasks.wait(id);return id;}
   if(command==='tasks.list')return tasks.list();
   if(command==='tasks.cancel')return tasks.cancel(p);
   if(command==='tasks.retry')return tasks.retry(p);
   return original.call(this,command,p);
  };
 },process.cwd());
 await page.reload();await page.waitForSelector('.home-intro');
 const open=async()=>{await page.getByRole('button',{name:'下载',exact:true}).click();await page.getByRole('button',{name:'选择 1.20.1 · 最新正式版',exact:true}).click();};
 await open();const name=page.getByLabel('游戏名称',{exact:true});await expect(name).toHaveValue('Minecraft 1.20.1');
 await page.getByRole('radio',{name:'Fabric',exact:true}).click();await expect(name).toHaveValue('Minecraft 1.20.1 fabric 0.16.10');
 await name.fill('My game');await page.getByRole('radio',{name:'原版',exact:true}).click();await expect(name).toHaveValue('My game');
 await expect(page.locator('.install-target-paths')).toContainText('独立游戏目录：');await expect(page.locator('.install-target-status')).toContainText('版本隔离已开启');
 await mkdir('.superpowers/sdd/2026-11-12-install-recovery',{recursive:true});
 for(const width of [1280,960]){await page.setViewportSize({width,height:800});await page.screenshot({path:`.superpowers/sdd/2026-11-12-install-recovery/install-${width}.png`,fullPage:true});}
 const root=page.getByLabel('安装位置',{exact:true});
 const defaultRoot=await app.evaluate(()=> (globalThis as any).installFixture.root);
 await root.fill(defaultRoot+'-slow');await page.waitForTimeout(280);await root.fill(defaultRoot+'-new');
 await expect(page.locator('.install-target-paths')).toContainText(defaultRoot+'-new');await page.waitForTimeout(700);await expect(page.locator('.install-target-paths')).toContainText(defaultRoot+'-new');
 await page.getByRole('button',{name:'设为默认安装位置',exact:true}).click();
 expect(await page.evaluate(()=>window.launcher.invoke('settings.read',undefined))).toMatchObject({gameDirectory:defaultRoot+'-new'});
 await name.fill('Recover');await expect(page.getByRole('button',{name:'导入此已完成安装'})).toBeVisible();
 expect(await app.evaluate(()=> (globalThis as any).installFixture.imported)).toBeUndefined();
 await page.getByRole('button',{name:'导入此已完成安装'}).click();await expect.poll(()=>app.evaluate(()=> (globalThis as any).installFixture.imported)).toContain('Recover');await name.fill('My game');
 const start=page.getByRole('button',{name:'开始安装',exact:true});await expect(start).toBeEnabled();await start.evaluate((n:HTMLButtonElement)=>{n.click();n.click();});
 await expect(page.getByRole('button',{name:'安装任务进行中…'})).toBeDisabled();
 expect(await app.evaluate(()=> (globalThis as any).installFixture.calls.filter((c:any)=>c.command==='install.vanilla').length)).toBe(1);
 await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'下载',exact:true}).click();await expect(name).toHaveValue('My game');await expect(root).toHaveValue(defaultRoot+'-new');await expect(page.getByRole('button',{name:'安装任务进行中…'})).toBeDisabled();
 await page.getByRole('button',{name:'取消任务',exact:true}).click();await expect(start).toBeEnabled();
 await page.getByRole('button',{name:'重试',exact:true}).click();await expect(page.getByRole('button',{name:'安装任务进行中…'})).toBeDisabled();
 await app.evaluate(()=> (globalThis as any).installFixture.finish());await expect(start).toBeEnabled();
 await expect.poll(()=>app.evaluate(()=> (globalThis as any).installFixture.instances.length)).toBe(1);
 await app.evaluate(()=>{(globalThis as any).installFixture.mode='early';});await name.fill('Early');await expect(start).toBeEnabled();await start.click();await expect(start).toBeEnabled();
 expect(await app.evaluate(()=> (globalThis as any).installFixture.instances.length)).toBe(2);
 await app.evaluate(()=>{(globalThis as any).installFixture.mode='fail';});await name.fill('Failure');await expect(start).toBeEnabled();await start.click();await expect(page.locator('.task-card[data-status=failed]').first()).toBeVisible();await expect(start).toBeEnabled();

 // Remount restores only a loader actually offered for the chosen Minecraft version.
 await page.getByRole('radio',{name:'Fabric',exact:true}).click();
 await expect(page.getByRole('radio',{name:'0.16.10 · 稳定',exact:true})).toHaveAttribute('aria-checked','true');
 await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'下载',exact:true}).click();
 await page.getByRole('button',{name:'返回版本列表',exact:true}).click();await page.getByRole('searchbox',{name:'搜索 Minecraft 版本',exact:true}).fill('1.21.1');await page.getByRole('button',{name:'选择 1.21.1',exact:true}).click();
 await expect(page.getByRole('radio',{name:'0.17.1 · 稳定',exact:true})).toHaveAttribute('aria-checked','true');await expect(name).toHaveValue('Failure');
 await expect(page.locator('.install-target-paths')).toContainText('Failure');
 await expect.poll(()=>app.evaluate(()=> (globalThis as any).installFixture.calls.filter((c:any)=>c.command==='install.preview').at(-1).p.name)).toBe('Failure');
 await app.evaluate(()=>{(globalThis as any).installFixture.mode='early';});await expect(start).toBeEnabled();await start.click();
 expect(await app.evaluate(()=> (globalThis as any).installFixture.calls.filter((c:any)=>c.command==='install.vanilla').at(-1).p)).toMatchObject({name:'Failure',version:'1.21.1',loader:{kind:'fabric',version:'0.17.1'}});
 await page.getByRole('button',{name:'恢复自动名称',exact:true}).click();await expect(name).toHaveValue('Minecraft 1.21.1 fabric 0.17.1');
 await expect(page.locator('.install-target-paths')).toContainText('Minecraft 1.21.1 fabric 0.17.1');
 // Late success and failure from removed views cannot publish an older draft or preview.
 for(const fail of [false,true]){
  await app.evaluate(()=>{(globalThis as any).installFixture.holdLoader=true;});
  await page.getByRole('radio',{name:'Forge',exact:true}).click();
  await expect.poll(()=>app.evaluate(()=>typeof (globalThis as any).installFixture.releaseLoader)).toBe('function');
  await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'下载',exact:true}).click();
  await page.getByRole('radio',{name:'Fabric',exact:true}).click();await name.fill('Newest '+fail);await root.fill(defaultRoot+'-draft-'+fail);
  await expect(start).toBeEnabled();
  const previews=await app.evaluate(()=> (globalThis as any).installFixture.calls.filter((c:any)=>c.command==='install.preview').length);
  await app.evaluate((_e,fail)=>{(globalThis as any).installFixture.releaseLoader(fail);delete (globalThis as any).installFixture.releaseLoader;},fail);
  await page.waitForTimeout(350);
  expect(await app.evaluate(()=> (globalThis as any).installFixture.calls.filter((c:any)=>c.command==='install.preview').length)).toBe(previews);
  await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'下载',exact:true}).click();
  await expect(name).toHaveValue('Newest '+fail);await expect(root).toHaveValue(defaultRoot+'-draft-'+fail);await expect(page.getByRole('radio',{name:'Fabric',exact:true})).toHaveAttribute('aria-checked','true');
 }
 } finally {await app.close();await rm(data,{recursive:true,force:true});}
});
