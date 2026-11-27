import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
test('about link entry reports missing components and rejects empty discovery without pretending connected',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zm-link-ui-'));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
 const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
 await page.getByRole('button',{name:'关于',exact:true}).click();
 await page.getByRole('button',{name:'EasyTier 联机',exact:true}).click();
 const modal=page.getByRole('dialog',{name:'EasyTier 联机'});await expect(modal).toBeVisible();
 await expect(modal.getByRole('status')).toHaveText('未联机');
 await modal.getByRole('button',{name:'创建私密房间',exact:true}).click();
 await expect(page.locator('#toasts').getByText('请先配置并验证 EasyTier 组件',{exact:true})).toBeVisible();
 await expect(modal.getByRole('status')).toHaveText('未联机');
 await modal.getByLabel('EasyTier core 路径',{exact:true}).fill(resolve('validation/easytier-v2.6.4/easytier-windows-x86_64/easytier-core.exe'));
 await modal.getByLabel('EasyTier CLI 路径',{exact:true}).fill(resolve('validation/easytier-v2.6.4/easytier-windows-x86_64/easytier-cli.exe'));
 await modal.getByRole('button',{name:'保存并验证组件',exact:true}).click();
 await expect(modal.getByRole('button',{name:'创建私密房间',exact:true})).toBeEnabled();
 await modal.getByRole('button',{name:'创建私密房间',exact:true}).click();
 await expect(page.locator('#toasts').getByText('请先配置至少一个可达节点（自行托管或可信共享节点）',{exact:true})).toBeVisible();
 await expect(modal.getByRole('status')).toHaveText('未联机');await expect(modal.getByLabel('本房间私密邀请码',{exact:true})).toBeHidden();
 await modal.getByRole('button',{name:'离开 / 取消',exact:true}).click();await expect(modal.getByRole('status')).toHaveText('未联机');
 await modal.getByRole('button',{name:'关闭',exact:true}).click();await expect(modal).toHaveCount(0);
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});


test('before-quit waits for a delayed owned child already being left',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zm-link-shutdown-'));const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
 const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
 await app.evaluate(({app},cwd)=>{
 const require=(process as any).mainModule.require.bind((process as any).mainModule);
 const {LinkService}=require(require('node:path').join(cwd,'dist/main/services/link.js'));
 const original=LinkService.prototype.state;LinkService.prototype.state=function(){(globalThis as any).linkServiceUnderTest=this;return original.call(this);};
 },process.cwd());
 await page.evaluate(()=>window.launcher.invoke('link.state',undefined));
 await app.evaluate(()=>{
 const require=(process as any).mainModule.require.bind((process as any).mainModule);const {EventEmitter}=require('node:events');
 const child=Object.assign(new EventEmitter(),{exitCode:null,kill:()=>{setTimeout(()=>{child.exitCode=0;child.emit('exit',0);child.emit('close',0);},150);return true;}});
 (globalThis as any).linkServiceUnderTest.child=child;
 });
 let exited=false;const exit=new Promise<void>(resolve=>app.process().once('exit',()=>{exited=true;resolve();}));
 const started=Date.now();
 await app.evaluate(({app})=>{void (globalThis as any).linkServiceUnderTest.leave();app.quit();});
 await new Promise(r=>setTimeout(r,75));expect(exited).toBe(false);
 await exit;expect(Date.now()-started).toBeGreaterThanOrEqual(140);
 }finally{await app.close().catch(()=>undefined);await rm(data,{recursive:true,force:true});}
});
