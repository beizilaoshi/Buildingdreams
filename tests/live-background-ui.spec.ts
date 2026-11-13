import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PNG } from 'pngjs';

test('one regional live scene reacts, pauses, restores and retains static fallback',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zhumeng-live-'));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
  const errors:string[]=[];page.on('pageerror',error=>errors.push(error.message));
  await page.evaluate(()=>window.launcher.invoke('settings.patch',{openingEnabled:false,backgroundAnimation:'interactive',backgroundMotionIntensity:.8,backgroundEffect:'none',backgroundQuality:'low'}));
  await page.reload();await page.waitForSelector('.home-intro');
  const scene=page.locator('.live-background');await expect(scene).toHaveAttribute('data-state','running');await expect(scene).toHaveCount(1);
  const frames=async()=>Number(await scene.getAttribute('data-frames'));
  const before=await frames();await expect.poll(frames).toBeGreaterThan(before+3);
  expect(await scene.evaluate((c:HTMLCanvasElement)=>c.width*c.height)).toBeLessThanOrEqual(1_005_000);
  await expect(scene).toHaveCSS('pointer-events','none');
  const sample=async()=>PNG.sync.read(await page.screenshot());
  await page.mouse.move(10,10);await page.waitForTimeout(450);const a=await sample();
  await page.mouse.move(1100,700);await page.waitForTimeout(650);const b=await sample();
  const changed=(x:number,y:number,w:number,h:number)=>{let count=0;for(let row=y;row<y+h;row++)for(let col=x;col<x+w;col++){const i=(row*a.width+col)*4;if(Math.abs(a.data[i]-b.data[i])+Math.abs(a.data[i+1]-b.data[i+1])+Math.abs(a.data[i+2]-b.data[i+2])>5)count++;}return count;};
  expect(changed(650,90,140,100)).toBeGreaterThan(80);expect(changed(500,380,130,60)).toBeGreaterThan(80);
  const firstPointer=await scene.getAttribute('data-pointer');expect(firstPointer).not.toBe('0,0');
  await page.getByRole('button',{name:'个性化',exact:true}).click();
  await page.getByRole('radio',{name:'环境动态',exact:true}).click();
  await page.mouse.move(20,20);await expect.poll(async()=>Math.abs(Number((await scene.getAttribute('data-pointer'))!.split(',')[0]))).toBeLessThan(.03);
  await page.getByRole('radio',{name:'静态',exact:true}).click();await expect(scene).toHaveAttribute('data-state','static');
  const stopped=await frames();await page.waitForTimeout(180);expect(await frames()).toBe(stopped);await expect(scene).toBeHidden();
  await page.getByRole('radio',{name:'交互动态',exact:true}).click();await expect(scene).toHaveAttribute('data-state','running');
  await page.getByRole('checkbox',{name:'减少动态效果',exact:true}).check();await expect(scene).toHaveAttribute('data-state','static');
  await page.getByRole('checkbox',{name:'减少动态效果',exact:true}).uncheck();await expect(scene).toHaveAttribute('data-state','running');
  await page.emulateMedia({reducedMotion:'reduce'});await expect(scene).toHaveAttribute('data-state','static');await page.emulateMedia({reducedMotion:'no-preference'});await expect(scene).toHaveAttribute('data-state','running');
  await page.getByRole('radio',{name:'纯色',exact:true}).click();await expect(scene).toHaveAttribute('data-state','static');
  await page.getByRole('radio',{name:'图片',exact:true}).click();await expect(scene).toHaveAttribute('data-state','running');
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:true});document.dispatchEvent(new Event('visibilitychange'));});await expect(scene).toHaveAttribute('data-state','static');
  const hiddenFrames=await frames();await page.waitForTimeout(150);expect(await frames()).toBe(hiddenFrames);
  await page.evaluate(()=>{Object.defineProperty(document,'hidden',{configurable:true,value:false});document.dispatchEvent(new Event('visibilitychange'));});await expect(scene).toHaveAttribute('data-state','running');
  await page.evaluate(()=>{const overlay=document.createElement('dialog');overlay.className='launch-snake';document.body.append(overlay);overlay.showModal();});await expect(scene).toHaveAttribute('data-state','static');
  await page.evaluate(()=>document.querySelector('.launch-snake')!.remove());await expect(scene).toHaveAttribute('data-state','running');
  await scene.evaluate((canvas:HTMLCanvasElement)=>{(window as any).liveContextExtension=canvas.getContext('webgl')!.getExtension('WEBGL_lose_context');(window as any).liveContextExtension.loseContext();});await expect(scene).toHaveAttribute('data-state','context-lost');await expect(scene).toBeHidden();
  await expect(page.locator('#wallpaper')).toHaveCSS('background-image',/moonlake/);
  await page.evaluate(()=>(window as any).liveContextExtension.restoreContext());await expect(scene).toHaveAttribute('data-state','running');
  // Delay one real image selection, then fail a newer one: the old decode must never revive the scene.
  await page.evaluate(()=>{const descriptor=Object.getOwnPropertyDescriptor(HTMLImageElement.prototype,'src')!;(window as any).imageSrcDescriptor=descriptor;Object.defineProperty(HTMLImageElement.prototype,'src',{configurable:true,get:descriptor.get,set(value:string){if(value.includes('sakura-night')){const image=this;(window as any).releaseOldImage=()=>descriptor.set!.call(image,value);}else if(value.includes('cloud-dawn'))descriptor.set!.call(this,'file:///missing-live-scene.png');else descriptor.set!.call(this,value);}});});
  await page.getByRole('button',{name:'樱庭星夜',exact:true}).click();await expect(scene).toHaveAttribute('data-state','static');
  await page.getByRole('button',{name:'云海晨光',exact:true}).click();await page.evaluate(()=>(window as any).releaseOldImage());await page.waitForTimeout(180);await expect(scene).toHaveAttribute('data-state','static');
  await page.evaluate(()=>Object.defineProperty(HTMLImageElement.prototype,'src',(window as any).imageSrcDescriptor));
  await page.getByRole('button',{name:'月映湖',exact:true}).click();await expect(scene).toHaveAttribute('data-state','running');
  for(let i=0;i<4;i++){await page.getByRole('button',{name:'首页',exact:true}).click();await page.getByRole('button',{name:'个性化',exact:true}).click();}
  await expect(scene).toHaveCount(1);const start=await frames();await page.waitForTimeout(500);expect((await frames())-start).toBeLessThanOrEqual(15);
  await page.getByRole('radio',{name:'细腻 · 45 帧',exact:true}).click();await page.getByRole('radio',{name:'飘落花瓣',exact:true}).click();
  const settings=await page.evaluate(()=>window.launcher.invoke('settings.read',undefined));expect(settings.backgroundQuality).toBe('high');expect(settings.backgroundEffect).toBe('petals');
  for(const [name,file] of [['月映湖','moonlake'],['樱庭星夜','sakura-night'],['云海晨光','cloud-dawn']]){
   await page.getByRole('button',{name,exact:true}).click();await expect(scene).toHaveAttribute('data-state','running');
   for(const theme of ['dark','light']){
    await page.getByRole('radio',{name:theme==='dark'?'深色':'浅色',exact:true}).click();await page.getByRole('button',{name:'首页',exact:true}).click();
    for(const [w,h] of [[1280,820],[960,640]]){
     await app.evaluate(({BrowserWindow},size)=>BrowserWindow.getAllWindows()[0].setSize(size[0],size[1]),[w,h]);
     await page.evaluate(async()=>{await new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)));await Promise.all(document.getAnimations().filter(a=>a.effect?.getTiming().iterations!==Infinity).map(a=>a.finished.catch(()=>{})));});
     await expect(page.locator('.launch-panel')).toBeInViewport({ratio:1});await expect(page.locator('.home-aside')).toBeInViewport({ratio:1});
     await page.screenshot({path:`validation/live-${file}-${theme}-${w}x${h}.png`});
    }
    await page.getByRole('button',{name:'个性化',exact:true}).click();
   }
  }
  // A renderer without WebGL still exposes the selected static wallpaper and functional controls.
  await page.addInitScript(()=>{const original=HTMLCanvasElement.prototype.getContext;HTMLCanvasElement.prototype.getContext=function(this:HTMLCanvasElement,kind:string,...args:any[]){if(kind==='webgl')return null;return original.call(this,kind as any,...args);} as typeof original;});
  await page.reload();await page.waitForSelector('.home-intro');await expect(scene).toHaveAttribute('data-state','static');await expect(scene).toBeHidden();
  await expect(page.locator('#wallpaper')).toHaveCSS('background-image',/cloud-dawn/);await page.getByRole('button',{name:'个性化',exact:true}).click();await expect(page.getByRole('radio',{name:'交互动态',exact:true})).toHaveAttribute('aria-checked','true');
  expect(errors).toEqual([]);
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
