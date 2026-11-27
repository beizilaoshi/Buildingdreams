import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, readFile, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

test('instance workbench persists metadata, lists directories, and unregisters without deleting imported data', async () => {
  const data=await mkdtemp(join(tmpdir(),'zhumeng-workbench-')), root=join(data,'Imported');
  await mkdir(join(root,'versions','Workbench'),{recursive:true});
  await writeFile(join(root,'versions','Workbench','Workbench.json'),JSON.stringify({id:'Workbench',mainClass:'Main',libraries:[],minecraftArguments:''}));
  await writeFile(join(root,'keep.txt'),'user data');
  const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
  try {
    const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
    await page.evaluate(async root=>{await window.launcher.invoke('instances.import',root);await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true});},root);
    await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();
    await page.getByRole('button',{name:'目录',exact:true}).click();
    const files=page.getByRole('dialog',{name:'游戏数据目录 · 内置管理'});
    await expect(files).toBeVisible();
    await files.getByRole('button',{name:/versions/}).click();
    await expect(files.getByText('游戏数据目录 / versions',{exact:true})).toBeVisible();
    await expect(files.getByRole('button',{name:/Workbench/})).toBeVisible();
    await files.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'管理游戏',exact:true}).click();
    const modal=page.getByRole('dialog',{name:'Workbench · 管理游戏'});
    await expect(modal.getByRole('textbox',{name:'游戏名称',exact:true})).toBeVisible();
    await modal.getByRole('textbox',{name:'游戏名称',exact:true}).fill('我的测试世界');
    await modal.getByRole('textbox',{name:'游戏说明',exact:true}).fill('安全管理回归');
    await modal.getByRole('textbox',{name:'游戏分类',exact:true}).fill('常玩');
    await modal.getByRole('button',{name:'保存游戏信息',exact:true}).click();
    await expect(page.locator('.game-card h2')).toHaveText('我的测试世界');
    const coverPath=join(data,'version-cover.png');await writeFile(coverPath,PNG.sync.write(new PNG({width:96,height:54})));
    await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},coverPath);
    await modal.getByRole('button',{name:'选择封面图片',exact:true}).click();
    await expect(modal.locator('.instance-cover-preview img')).toBeVisible();
    await expect(page.locator('.game-art.has-cover .instance-cover-image')).toBeVisible();
    await expect.poll(()=>page.evaluate(async()=>((await window.launcher.invoke('instances.list',undefined))[0].cover??''))).toMatch(/^[a-f0-9]{64}\.png$/);
    await page.screenshot({path:'validation/custom-version-cover.png'});
    await modal.getByRole('button',{name:'恢复默认封面',exact:true}).click();
    await expect(page.locator('.game-art.has-cover')).toHaveCount(0);
    await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();
    await expect(page.locator('.game-card h2')).toHaveText('我的测试世界');
    await expect(page.locator('.instance-description')).toHaveText('安全管理回归');
    await page.getByRole('button',{name:'管理游戏',exact:true}).click();
    await page.getByRole('dialog',{name:'我的测试世界 · 管理游戏'}).getByRole('button',{name:'删除游戏文件',exact:true}).click();
    await expect(page.getByRole('dialog',{name:'确认删除游戏文件'})).toHaveCount(0);
    await expect(page.locator('.game-card h2')).toHaveText('我的测试世界');
    await expect(await readFile(join(root,'keep.txt'),'utf8')).toBe('user data');
    await page.screenshot({path:'validation/instance-workspace.png'});
    await page.getByRole('dialog',{name:'我的测试世界 · 管理游戏'}).getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'管理目录',exact:true}).click();
    const dirs=page.getByRole('dialog',{name:'管理游戏目录'});
    await expect(dirs.getByText(root,{exact:true})).toBeVisible();
    await dirs.getByRole('textbox',{name:'目录显示名称',exact:true}).fill('我的游戏文件');
    await dirs.getByRole('button',{name:'保存目录名称',exact:true}).click();
    await dirs.getByRole('button',{name:'关闭',exact:true}).click();
    await page.getByRole('button',{name:'管理游戏',exact:true}).click();
    await page.getByRole('dialog',{name:'我的测试世界 · 管理游戏'}).getByRole('button',{name:'从游戏库移除',exact:true}).click();
    const confirm=page.getByRole('dialog',{name:'从游戏库移除'});
    await expect(confirm.getByText('磁盘文件会保留，可以再次导入。',{exact:true})).toBeVisible();
    await confirm.getByRole('button',{name:'确认移除',exact:true}).click();
    await expect(page.locator('.game-card')).toHaveCount(0);
    await expect(await readFile(join(root,'keep.txt'),'utf8')).toBe('user data');
    await access(join(root,'versions','Workbench','Workbench.json'));
  } finally {await app.close();}
});

test('favorites migrate to registry; failed edits remain and late delete plans cannot reopen dialogs',async()=>{
  const data=await mkdtemp(join(tmpdir(),'zhumeng-workspace-gates-')),root=join(data,'game');
  await mkdir(join(root,'versions','Gate'),{recursive:true});
  await writeFile(join(root,'versions','Gate','Gate.json'),JSON.stringify({id:'Gate',mainClass:'Main',libraries:[],minecraftArguments:''}));
  const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
  try{
    const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
    await page.evaluate(async root=>{const items=await window.launcher.invoke('instances.import',root);localStorage.setItem('favorites',JSON.stringify([items[0].id]));await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true});},root);
    await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();
    await expect(page.getByRole('button',{name:'取消收藏',exact:true})).toBeVisible();
    expect(await page.evaluate(async()=>({favorite:(await window.launcher.invoke('instances.list',undefined))[0].favorite,legacy:localStorage.getItem('favorites')}))).toEqual({favorite:true,legacy:null});
    await page.getByRole('button',{name:'取消收藏',exact:true}).click();await expect(page.getByRole('button',{name:'加入收藏',exact:true})).toBeVisible();
    await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();await expect(page.getByRole('button',{name:'加入收藏',exact:true})).toBeVisible();
    await app.evaluate(async(_,cwd)=>{
      const require=(process as any).mainModule.require.bind((process as any).mainModule),path=require('node:path');
      const {InstanceService}=require(path.join(cwd,'dist/main/services/instances.js'));
      const original=InstanceService.prototype.metadata;
      InstanceService.prototype.metadata=function(id:string,value:unknown){if((globalThis as any).rejectMetadata)throw Error('实例正在运行，拒绝维护');return original.call(this,id,value);};
      (globalThis as any).rejectMetadata=true;
      const {InstanceMaintenance}=require(path.join(cwd,'dist/main/services/instance-maintenance.js'));
      InstanceMaintenance.prototype.planDelete=function(){return new Promise(resolve=>{(globalThis as any).releaseDelete=()=>resolve({token:'owned-plan',instanceId:'Gate',paths:['fixture-owned-root'],expires:Date.now()+60000});});};
      InstanceMaintenance.prototype.delete=async function(token:string,closed:boolean){(globalThis as any).deleted={token,closed};};
    },process.cwd());
    await page.getByRole('button',{name:'管理游戏',exact:true}).click();
    let modal=page.getByRole('dialog',{name:'Gate · 管理游戏'});
    await modal.getByRole('textbox',{name:'游戏名称',exact:true}).fill('未保存的编辑');
    await modal.getByRole('button',{name:'保存游戏信息',exact:true}).click();
    await expect(modal.getByRole('textbox',{name:'游戏名称',exact:true})).toHaveValue('未保存的编辑');
    await expect(page.locator('.game-card h2')).toHaveText('Gate');
    await modal.getByRole('button',{name:'删除游戏文件',exact:true}).click();
    await expect.poll(()=>app.evaluate(()=>typeof(globalThis as any).releaseDelete)).toBe('function');
    await modal.getByRole('button',{name:'关闭',exact:true}).click();
    await app.evaluate(()=>{(globalThis as any).releaseDelete();});
    await page.evaluate(()=>new Promise(resolve=>setTimeout(resolve,100)));
    await expect(page.getByRole('dialog',{name:'确认删除游戏文件'})).toHaveCount(0);
    await page.getByRole('button',{name:'管理游戏',exact:true}).click();modal=page.getByRole('dialog',{name:'Gate · 管理游戏'});
    await modal.getByRole('button',{name:'删除游戏文件',exact:true}).click();
    await app.evaluate(()=>{(globalThis as any).releaseDelete();});
    const confirm=page.getByRole('dialog',{name:'确认删除游戏文件'}),remove=confirm.getByRole('button',{name:'移至回收站',exact:true});
    await expect(remove).toBeDisabled();expect(await app.evaluate(()=>(globalThis as any).deleted)).toBeUndefined();
    await confirm.getByRole('checkbox',{name:'我已关闭所有相关外部游戏',exact:true}).check();await expect(remove).toBeEnabled();await remove.click();
    await expect.poll(()=>app.evaluate(()=>(globalThis as any).deleted)).toEqual({token:'owned-plan',closed:true});
  }finally{await app.close();}
});

test('in-app file browser appends later pages without removing earlier files',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zhumeng-browser-pages-')),root=join(data,'game');
 await mkdir(join(root,'versions','Page'),{recursive:true});
 await writeFile(join(root,'versions','Page','Page.json'),JSON.stringify({id:'Page',mainClass:'Main',libraries:[]}));
 await Promise.all(Array.from({length:501},(_,index)=>writeFile(join(root,`row-${String(index).padStart(3,'0')}.txt`),'x')));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
  await page.evaluate(async root=>{await window.launcher.invoke('instances.import',root);await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true});},root);
  await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();
  await page.getByRole('button',{name:'目录',exact:true}).click();
  const files=page.getByRole('dialog',{name:'游戏数据目录 · 内置管理'});
  await expect(files.getByText('📄 row-000.txt',{exact:true})).toBeVisible();
  await files.getByRole('button',{name:'加载更多文件',exact:true}).click();
  await expect(files.getByText('📄 row-500.txt',{exact:true})).toBeVisible();
  await expect(files.getByText('📄 row-000.txt',{exact:true})).toBeVisible();
 }finally{await app.close();}
});

test('display categories persist and hidden instances can be shown from the library',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zhumeng-hidden-instance-')),root=join(data,'game');
 await mkdir(join(root,'versions','Hidden'),{recursive:true});
 await writeFile(join(root,'versions','Hidden','Hidden.json'),JSON.stringify({id:'Hidden',mainClass:'Main',libraries:[]}));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
  await page.evaluate(async root=>{const [item]=await window.launcher.invoke('instances.import',root);await window.launcher.invoke('instances.metadata',{id:item.id,metadata:{displayType:'hidden'}});await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true});},root);
  await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();
  await expect(page.locator('.game-card')).toHaveCount(0);
  const show=page.getByRole('checkbox',{name:'显示隐藏版本',exact:true});await show.check();
  await expect(page.locator('.game-card h2')).toHaveText('Hidden');
  await expect(page.locator('.game-card')).toContainText('隐藏');
  await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();
  await expect(page.locator('.game-card h2')).toHaveText('Hidden');
  await show.uncheck();await expect(page.locator('.game-card')).toHaveCount(0);
 }finally{await app.close();}
});

test('world backup management stays in app and protects current progress on restore',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zhumeng-world-ui-')),root=join(data,'game'),world=join(root,'saves','Dream');
 await mkdir(join(root,'versions','World'),{recursive:true});await mkdir(world,{recursive:true});
 await writeFile(join(root,'versions','World','World.json'),JSON.stringify({id:'World',mainClass:'Main',libraries:[]}));
 await writeFile(join(world,'level.dat'),'original world');
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
  await page.evaluate(async root=>{await window.launcher.invoke('instances.import',root);await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true});},root);
  await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();await page.getByRole('button',{name:'管理游戏',exact:true}).click();
  await page.getByRole('dialog',{name:'World · 管理游戏'}).getByRole('button',{name:'打开存档管理页面',exact:true}).click();
  const manager=page.locator('.instance-manager-page');await expect(manager.getByRole('heading',{name:'存档管理',exact:true})).toBeVisible();await expect(manager).toContainText('找到 1 个存档');await expect(manager).toContainText('共 0 份备份，占用 0 B');
  await page.screenshot({path:'validation/standalone-save-manager.png'});
  await manager.getByRole('button',{name:'立即备份此存档',exact:true}).click();await expect(manager.locator('.world-backup-card')).toHaveCount(1);await expect(manager).toContainText('共 1 份备份，占用 14 B');
  await writeFile(join(world,'level.dat'),'changed world');
  await manager.getByRole('button',{name:'恢复此备份',exact:true}).click();await page.getByRole('dialog',{name:'确认恢复存档'}).getByRole('button',{name:'确认恢复',exact:true}).click();
  await expect.poll(()=>readFile(join(world,'level.dat'),'utf8').catch(()=>'' )).toBe('original world');
  await expect(manager.locator('.world-backup-card')).toHaveCount(2);
  await rm(world,{recursive:true,force:true});
  await manager.getByRole('button',{name:'刷新存档列表',exact:true}).click();
  await expect(manager.getByRole('radio',{name:'Dream',exact:true})).toBeVisible();
  await manager.locator('.world-backup-card').nth(1).getByRole('button',{name:'恢复此备份',exact:true}).click();
  await page.getByRole('dialog',{name:'确认恢复存档'}).getByRole('button',{name:'确认恢复',exact:true}).click();
  await expect.poll(()=>readFile(join(world,'level.dat'),'utf8').catch(()=>'' )).toBe('original world');
  await manager.getByRole('button',{name:'返回游戏库',exact:true}).click();
  await expect(page.locator('.game-card h2')).toHaveText('World');
  await page.getByRole('button',{name:'管理游戏',exact:true}).click();
  await page.getByRole('dialog',{name:'World · 管理游戏'}).getByRole('button',{name:'打开 Mod 管理页面',exact:true}).click();
  await expect(page.locator('.instance-manager-page').getByRole('heading',{name:'Mod 管理',exact:true})).toBeVisible();
  await expect(page.locator('.instance-manager-page .local-mods')).toBeVisible();
  await page.screenshot({path:'validation/standalone-mod-manager.png'});
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
