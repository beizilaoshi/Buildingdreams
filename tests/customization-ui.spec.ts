import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('appearance workbench previews, serializes, restores and persists safe customization', async () => {
 const data=await mkdtemp(join(tmpdir(),'zhumeng-custom-ui-'));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try {
  const page=await app.firstWindow(); await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
  const errors:string[]=[];page.on('pageerror',e=>errors.push(e.message));
  await page.evaluate(()=>window.launcher.invoke('settings.patch',{openingEnabled:false,javaPath:'appearance-preserve-java',javaArgs:['-Dappearance=preserve']}));
  await page.reload(); await page.waitForSelector('.home-intro');
  await page.getByRole('button',{name:'个性化',exact:true}).click();
  await expect(page.locator('.customization-workbench')).toBeVisible();
  await expect(page.locator('.customization-workbench details')).toHaveCount(0);
  const search=page.getByRole('searchbox',{name:'搜索个性化设置'}); await search.fill('标题字号');
  await expect(page.locator('#customization-home')).toBeVisible();await expect(page.locator('#customization-background')).toBeHidden();await search.fill('');
  await page.getByRole('radio',{name:'纯色',exact:true}).click();
  await expect(page.locator('html')).toHaveAttribute('data-background','solid');
  await expect(page.locator('#wallpaper')).toHaveCSS('background-image','none');
  await page.getByRole('radio',{name:'渐变',exact:true}).click();await expect(page.locator('#wallpaper')).toHaveCSS('background-image',/linear-gradient/);
  await page.getByRole('button',{name:'方块晨曦',exact:true}).click();await expect(page.locator('#wallpaper')).toHaveCSS('background-image',/voxel-dawn/);
  await page.getByRole('radio',{name:'实色',exact:true}).click();await expect(page.locator('#customization-material')).toHaveCSS('backdrop-filter','none');
  const nav=page.locator('input[data-setting="navWidth"][type="number"]');await nav.fill('120');await nav.dispatchEvent('change');await expect(page.locator('.navigation')).toHaveCSS('width','120px');
  const font=page.locator('input[data-setting="fontScale"][type="number"]');await font.fill('1.2');await font.dispatchEvent('change');await expect(page.locator('.customization-toolbar input')).toHaveCSS('font-size','15.6px');
  const brightness=page.locator('input[data-setting="wallpaperBrightness"][type="range"]');
  await brightness.evaluate((el:HTMLInputElement)=>{for(const v of ['0.2','0.7','0.45']){el.value=v;el.dispatchEvent(new Event('input',{bubbles:true}));}});
  await expect.poll(()=>page.evaluate(async()=>(await window.launcher.invoke('settings.read',undefined)).wallpaperBrightness)).toBe(.45);
  await page.locator('textarea[data-setting="homeTitle"]').fill('<img src=x onerror=alert(1)> 我的世界');
  await page.locator('textarea[data-setting="homeSubtitle"]').fill('属于我的冒险');
  await page.getByRole('textbox',{name:'新方案名称',exact:true}).fill('我的晨曦');await page.getByRole('button',{name:'保存为新方案',exact:true}).click();
  await expect(page.locator('.customization-profile')).toHaveCount(1);
  await page.getByRole('button',{name:'恢复全部默认外观',exact:true}).click();
  await expect(page.locator('.navigation')).toHaveCSS('width','96px');
  const settings=await page.evaluate(()=>window.launcher.invoke('settings.read',undefined));expect(settings.javaPath).toBe('appearance-preserve-java');expect(settings.javaArgs).toEqual(['-Dappearance=preserve']);
  await page.locator('.customization-profile').getByRole('button',{name:'应用',exact:true}).click();
  await page.getByRole('button',{name:'首页',exact:true}).click();await expect(page.locator('.home-intro h1')).toHaveText('<img src=x onerror=alert(1)> 我的世界');await expect(page.locator('.home-intro h1 img')).toHaveCount(0);
  await page.reload();await page.waitForSelector('.home-intro');await expect(page.locator('.home-intro h1')).toContainText('我的世界');
  await page.getByRole('button',{name:'个性化',exact:true}).click();await expect(page.locator('.customization-profile')).toHaveCount(1);await expect(page.locator('input[data-setting="navWidth"][type="number"]')).toHaveValue('120');
  const rename=page.getByRole('textbox',{name:'重命名方案 我的晨曦'});await rename.fill('保留的晨曦');await rename.dispatchEvent('change');
  await expect(page.getByRole('textbox',{name:'重命名方案 保留的晨曦'})).toBeVisible();
  await page.locator('#customization-layout').getByRole('button',{name:'重置本组',exact:true}).click();
  await expect(nav).toHaveValue('96');await expect(page.locator('textarea[data-setting="homeTitle"]')).toHaveValue('<img src=x onerror=alert(1)> 我的世界');
  const exportPath=join(data,'appearance.json');
  await app.evaluate(({dialog},path)=>{dialog.showSaveDialog=async()=>({canceled:false,filePath:path});},exportPath);
  await page.getByRole('button',{name:'导出外观 JSON',exact:true}).click();
  await expect.poll(async()=>{try{return JSON.parse(await readFile(exportPath,'utf8')).version;}catch{return null;}}).toBe(1);
  const exported=JSON.parse(await readFile(exportPath,'utf8'));expect(exported.settings.javaPath).toBeUndefined();expect(exported.settings.appearanceProfiles).toBeUndefined();
  exported.settings.homeTitle='从文件导入的标题';await writeFile(exportPath,JSON.stringify(exported));
  await app.evaluate(({dialog},path)=>{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[path]});},exportPath);
  await page.getByRole('button',{name:'导入外观 JSON',exact:true}).click();await expect(page.getByRole('button',{name:'应用导入方案',exact:true})).toBeVisible();
  await expect(page.locator('textarea[data-setting="homeTitle"]')).not.toHaveValue('从文件导入的标题');
  await page.getByRole('button',{name:'应用导入方案',exact:true}).click();await expect(page.locator('textarea[data-setting="homeTitle"]')).toHaveValue('从文件导入的标题');
  await app.evaluate(({dialog})=>{dialog.showOpenDialog=async()=>({canceled:true,filePaths:[]});dialog.showSaveDialog=async()=>({canceled:true,filePath:""});});
  await page.getByRole('button',{name:'导入外观 JSON',exact:true}).click();await expect(page.locator('.customization-import-preview')).toBeHidden();
  await page.getByRole('radio',{name:'淡入',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-transition','fade');
  await page.getByRole('radio',{name:'右下角',exact:true}).click();await expect(page.locator('#toasts')).toHaveCSS('bottom','22px');
  await page.getByRole('radio',{name:'居中',exact:true}).click();
  await page.getByRole('button',{name:'首页',exact:true}).click();await expect(page.locator('.home-intro')).toHaveCSS('text-align','center');
  await page.getByRole('button',{name:'个性化',exact:true}).click();
  // Restore the default hero, then inspect both palettes and supported sizes.
  await page.getByRole('button',{name:'恢复全部默认外观',exact:true}).click();
  for(const close of await page.locator('#toasts button[aria-label]').all()) await close.click();
  for(const theme of ['dark','light']) {
    await page.getByRole('radio',{name:theme==='dark'?'深色':'浅色',exact:true}).click();
    for(const [w,h] of [[1280,820],[960,640]]) {
      await app.evaluate(({BrowserWindow},[w,h])=>BrowserWindow.getAllWindows()[0].setSize(w,h),[w,h]);
      await page.locator('.content').evaluate(el=>el.scrollTop=0);
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.customization-workbench')!).opacity==='1');
      await page.evaluate(async()=>{await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
      await page.screenshot({path:`validation/customization-${theme}-${w}x${h}.png`});
      await page.getByRole('button',{name:'首页',exact:true}).click();await expect(page.locator('.launch-panel')).toBeInViewport({ratio:1});await expect(page.locator('.home-aside')).toBeInViewport({ratio:1});
      await page.waitForFunction(()=>getComputedStyle(document.querySelector('.home-page')!).opacity==='1');
      await page.screenshot({path:`validation/customization-home-${theme}-${w}x${h}.png`});
      await page.getByRole('button',{name:'个性化',exact:true}).click();
    }
  }
  expect(errors).toEqual([]);
 } finally {await app.close();await rm(data,{recursive:true,force:true});}
});

test('failed saves remain visible across remount and block stale export until recovery', async()=>{
 const data=await mkdtemp(join(tmpdir(),'zhumeng-custom-failure-'));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try {
  const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
  await page.evaluate(()=>window.launcher.invoke('settings.patch',{openingEnabled:false}));
  await page.getByRole('button',{name:'个性化',exact:true}).click();
  await app.evaluate(({dialog},cwd)=>{
   const require=(process as any).mainModule.require.bind((process as any).mainModule);
   const {SettingsStore}=require(require('node:path').join(cwd,'dist/main/services/settings.js'));
   const original=SettingsStore.prototype.patch;let once=true;
   SettingsStore.prototype.patch=function(patch:any){if(once){once=false;return Promise.reject(Error('fixture save rejected'));}return original.call(this,patch);};
   (globalThis as any).exportDialogs=0;dialog.showSaveDialog=async()=>{(globalThis as any).exportDialogs++;return {canceled:true,filePath:''};};
  },process.cwd());
  const nav=page.locator('input[data-setting="navWidth"][type="number"]');await nav.fill('110');await nav.blur();
  await expect(page.locator('.customization-status')).toHaveText('保存失败，尚未保存');await expect(page.locator('.navigation')).toHaveCSS('width','110px');
  expect((await page.evaluate(()=>window.launcher.invoke('settings.read',undefined))).navWidth).toBe(96);
  await page.getByRole('button',{name:'设置',exact:true}).click();
  await page.getByRole('radiogroup',{name:'启动时打开',exact:true}).getByRole('radio',{name:'游戏库',exact:true}).click();
  await expect.poll(()=>page.evaluate(async()=>(await window.launcher.invoke('settings.read',undefined)).startupPage)).toBe('library');
  await page.getByRole('button',{name:'个性化',exact:true}).click();
  await expect(page.locator('.customization-status')).toHaveText('保存失败，尚未保存');await expect(page.getByRole('button',{name:'重试保存',exact:true})).toBeVisible();await expect(nav).toHaveValue('110');
  await page.getByRole('button',{name:'导出外观 JSON',exact:true}).click();expect(await app.evaluate(()=>(globalThis as any).exportDialogs)).toBe(0);
  // Capture must use the same retained intent as controls and CSS, before retry begins.
  await page.getByRole('textbox',{name:'新方案名称',exact:true}).fill('跨页保留');await page.getByRole('button',{name:'保存为新方案',exact:true}).click();
  await expect(page.locator('.customization-status')).toHaveText('已自动保存');
  expect((await page.evaluate(()=>window.launcher.invoke('settings.read',undefined))).appearanceProfiles[0].settings.navWidth).toBe(110);
  await page.locator('input[data-setting="fontScale"][type="number"]').fill('1.1');await page.locator('input[data-setting="fontScale"][type="number"]').dispatchEvent('change');
  await expect(page.locator('.customization-status')).toHaveText('已自动保存');
  const stored=await page.evaluate(()=>window.launcher.invoke('settings.read',undefined));expect(stored.navWidth).toBe(110);expect(stored.fontScale).toBe(1.1);
  await expect(nav).toHaveValue('110');await expect(page.locator('.navigation')).toHaveCSS('width','110px');
  // Hold an older general-settings response after it writes, then complete a newer appearance write.
  await app.evaluate((_,cwd)=>{
   const require=(process as any).mainModule.require.bind((process as any).mainModule);
   const {SettingsStore}=require(require('node:path').join(cwd,'dist/main/services/settings.js'));
   const original=SettingsStore.prototype.patch;
   SettingsStore.prototype.patch=function(patch:any){const result=original.call(this,patch);if(patch.startMaximized===true)return result.then((snapshot:any)=>new Promise(resolve=>{(globalThis as any).releaseGeneral=()=>resolve(snapshot);}));return result;};
  },process.cwd());
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('checkbox',{name:'启动时最大化窗口',exact:true}).check();
  await expect.poll(()=>app.evaluate(()=>typeof(globalThis as any).releaseGeneral)).toBe('function');
  await page.getByRole('button',{name:'个性化',exact:true}).click();await nav.fill('120');await nav.blur();
  await expect(page.locator('.customization-status')).toHaveText('已自动保存');
  await app.evaluate(()=>(globalThis as any).releaseGeneral());
  await page.getByRole('button',{name:'设置',exact:true}).click();await page.getByRole('button',{name:'个性化',exact:true}).click();
  await expect(nav).toHaveValue('120');await expect(page.locator('.navigation')).toHaveCSS('width','120px');
  const interleaved=await page.evaluate(()=>window.launcher.invoke('settings.read',undefined));expect(interleaved.navWidth).toBe(120);expect(interleaved.startMaximized).toBe(true);
  await page.getByRole('button',{name:'导出外观 JSON',exact:true}).click();await expect.poll(()=>app.evaluate(()=>(globalThis as any).exportDialogs)).toBe(1);
  await page.getByRole('radio',{name:'浅色',exact:true}).click();await page.locator('#customization-background').getByRole('button',{name:'重置本组',exact:true}).click();await expect(page.locator('html')).toHaveAttribute('data-theme','light');
  await page.locator('#customization-material').getByRole('button',{name:'重置本组',exact:true}).click();
  await expect(page.getByRole('radio',{name:'跟随系统',exact:true})).toHaveAttribute('aria-checked','true');
  for(const close of await page.locator('#toasts button[aria-label]').all()) await close.click();
  for(const [name,file] of [['樱庭星夜','sakura-night'],['云海晨光','cloud-dawn']]) {
   await page.getByRole('button',{name,exact:true}).click();
   await expect.poll(()=>page.evaluate(async file=>{const image=new Image();image.src=new URL(`./assets/wallpapers/${file}.png`,location.href).href;await image.decode();return image.naturalWidth;},file)).toBeGreaterThan(1000);
   await page.getByRole('button',{name:'首页',exact:true}).click();await page.waitForFunction(()=>getComputedStyle(document.querySelector('.home-page')!).opacity==='1');
   await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});await page.screenshot({path:`validation/customization-home-${file}.png`});await page.getByRole('button',{name:'个性化',exact:true}).click();
  }
 } finally {await app.close();await rm(data,{recursive:true,force:true});}
});
