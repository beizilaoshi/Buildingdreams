import {test,expect,_electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
test('real library diagnostic entry explains logs and strips secrets',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zh-diagnostics-ui-')),root=join(data,'game');
 await mkdir(join(root,'versions','Diagnostic'),{recursive:true});await mkdir(join(root,'logs'));
 await writeFile(join(root,'versions','Diagnostic','Diagnostic.json'),JSON.stringify({id:'Diagnostic',mainClass:'Main',libraries:[],minecraftArguments:''}));
 await writeFile(join(root,'logs/latest.log'),'accessToken=DO_NOT_EXPOSE\njava.lang.OutOfMemoryError: Java heap space');
 const app=await _electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
 await page.evaluate(async root=>{await window.launcher.invoke('instances.import',root);await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true});},root);
 await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();await page.getByRole('button',{name:'管理游戏',exact:true}).click();
 await page.getByRole('button',{name:'崩溃诊断',exact:true}).click();const modal=page.getByRole('dialog',{name:'游戏崩溃诊断'});
 await expect(modal.getByRole('heading',{name:'Java 堆内存不足'})).toBeVisible();
 await expect(modal).not.toContainText('DO_NOT_EXPOSE');await expect(modal.getByRole('button',{name:'导入日志',exact:true})).toBeVisible();await expect(modal.getByRole('button',{name:'复制排查摘要',exact:true})).toBeVisible();
 await expect(modal.getByRole('button',{name:'导出脱敏报告',exact:true})).toBeVisible();
 await modal.getByRole('button',{name:'复制排查摘要',exact:true}).click();
 const copied=await app.evaluate(({clipboard})=>clipboard.readText());expect(copied).toContain('Java 堆内存不足');expect(copied).not.toContain('DO_NOT_EXPOSE');
 }finally{await app.close();}
});
test('abnormal game exit opens automatic diagnosis with concrete memory advice',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zh-auto-diagnostics-')),game=join(data,'game');
 await mkdir(join(game,'versions','Broken'),{recursive:true});
 await writeFile(join(game,'versions','Broken','Broken.json'),JSON.stringify({id:'Broken',mainClass:'FixtureMain',libraries:[],minecraftArguments:'--username ${auth_player_name}'}));
 await writeFile(join(game,'versions','Broken','Broken.jar'),'fixture');
 const app=await _electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  await app.evaluate((_electron,cwd)=>{
   const req=(process as any).mainModule.require.bind((process as any).mainModule),path=req('node:path');
   req(path.join(cwd,'dist/main/services/java.js')).JavaService.prototype.detect=async()=>[{path:process.execPath,major:17,version:'17',arch:'amd64'}];
   const Launch=req(path.join(cwd,'dist/main/services/launch.js')).LaunchService,original=Launch.prototype.start;
   Launch.prototype.start=function(...args:any[]){this.runner=async()=>req('node:child_process').spawn(process.execPath,['-e','console.error("java.lang.OutOfMemoryError: Java heap space");setTimeout(()=>process.exit(1),200)'],{env:{...process.env,ELECTRON_RUN_AS_NODE:'1'},windowsHide:true});return original.apply(this,args);};
  },process.cwd());
  const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
  await page.evaluate(async root=>{await window.launcher.invoke('instances.import',root);await window.launcher.invoke('accounts.addLocal','CrashTester');await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true});},game);
  await page.reload();await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'启动游戏',exact:true}).click();
  const modal=page.getByRole('dialog',{name:'游戏异常排查'});await expect(modal.getByRole('heading',{name:'Java 堆内存不足'})).toBeVisible();
  await expect(modal).toContainText('自动收集最近日志');await expect(modal).toContainText('增加游戏内存');
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
test('settings backup previews before restoring and download policy persists through the real UI',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zh-backup-ui-')),file=join(data,'backup.json');
 await writeFile(file,JSON.stringify({version:1,settings:{memoryMb:6144,downloadConcurrency:3,downloadSpeedLimitKib:512}}));
 const app=await _electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
 await app.evaluate(({dialog},file)=>{dialog.showOpenDialog=(async()=>({canceled:false,filePaths:[file]})) as typeof dialog.showOpenDialog;},file);
 await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'选择备份并预览',exact:true}).click();
 await expect(page.getByRole('button',{name:'确认恢复',exact:true})).toBeVisible();
 expect((await page.evaluate(()=>window.launcher.invoke('settings.read',undefined))).memoryMb).not.toBe(6144);
 await page.getByRole('button',{name:'确认恢复',exact:true}).click();
 await expect.poll(()=>page.evaluate(async()=>(await window.launcher.invoke('settings.read',undefined)).memoryMb)).toBe(6144);
 await page.getByRole('searchbox',{name:'搜索设置',exact:true}).fill('下载网络');
 await expect(page.getByRole('heading',{name:'下载网络',exact:true})).toBeVisible();
 const settings=await page.evaluate(()=>window.launcher.invoke('settings.read',undefined));expect(settings.downloadConcurrency).toBe(3);expect(settings.downloadSpeedLimitKib).toBe(512);
 }finally{await app.close();}
});
test('help searches and returns to retained query, and support IPC survives a previously seen notice',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zh-help-ui-'));
 await writeFile(join(data,'notices-seen.json'),JSON.stringify({betaNotice:true}));
 const app=await _electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'关于',exact:true}).click();await page.getByRole('button',{name:'帮助与支持',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'帮助与支持'});await modal.getByRole('textbox',{name:'搜索帮助',exact:true}).fill('JVM');
 await modal.getByRole('button',{name:'自动选择与下载 Java',exact:true}).click();await expect(modal.getByText('内存并非越多越好',{exact:false})).toBeVisible();
 await modal.getByRole('button',{name:'返回帮助列表',exact:true}).click();await expect(modal.getByRole('textbox',{name:'搜索帮助',exact:true})).toHaveValue('JVM');
 await modal.getByRole('button',{name:'复制运行环境',exact:true}).click();
 const clip=await app.evaluate(({clipboard})=>clipboard.readText());expect(clip).toContain('Electron');expect(clip).not.toContain(data);
 }finally{await app.close();}
});
test('navigation can hide settings and F12 always recovers access after reload',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zh-nav-ui-'));
 const app=await _electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('textbox',{name:'标题栏文字',exact:true}).fill('我的筑梦窗口');
 await page.getByRole('checkbox',{name:'隐藏设置',exact:true}).check();
 await page.getByRole('button',{name:'保存导航与标题',exact:true}).click();await expect(page.locator('.window-brand')).toHaveText('我的筑梦窗口');
 await expect(page.locator('.navigation [data-page="settings"]')).toBeHidden();
 await page.reload();await page.waitForSelector('.home-intro');await expect(page.locator('.navigation [data-page="settings"]')).toBeHidden();
 await page.keyboard.press('F12');await expect(page.getByRole('button',{name:'设置',exact:true})).toBeVisible();await page.getByRole('button',{name:'设置',exact:true}).click();
 await page.getByRole('button',{name:'恢复全部入口',exact:true}).click();await page.keyboard.press('F12');await expect(page.getByRole('button',{name:'设置',exact:true})).toBeVisible();
 }finally{await app.close();}
});
