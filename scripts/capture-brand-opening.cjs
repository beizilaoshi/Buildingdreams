// Capture actual startup, never change application preferences outside an isolated test profile.
const { _electron: electron } = require('@playwright/test');
const { mkdtemp, mkdir, rm, writeFile } = require('node:fs/promises');
const { tmpdir } = require('node:os'); const { join } = require('node:path');
(async () => {
 const data = await mkdtemp(join(tmpdir(), 'zhumeng-brand-capture-'));
 const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
 try {
  const page = await app.firstWindow(); await page.waitForSelector('.opening'); await page.keyboard.press('Escape');
  const out = 'validation/brand-opening'; await mkdir(out, { recursive: true });
  const timings = [];
  for (const theme of ['dark', 'light']) for (const size of [[1280,800], [960,640]]) {
   await app.evaluate(({ BrowserWindow }, size) => BrowserWindow.getAllWindows()[0].setContentSize(...size), size);
   await page.evaluate(patch => window.launcher.invoke('settings.patch', patch), { theme, openingEnabled:true, reducedMotion:false, openingSpeed:1, animationSpeed:1 });
   await page.reload(); await page.waitForSelector('.opening'); const start = Date.now();
   for (const [name, target] of [['fade',150], ['logo',650], ['reveal',1600], ['complete',2550]]) {
    await page.waitForTimeout(Math.max(0,target-(Date.now()-start)));
    const actual = Date.now()-start; const clip = await page.locator('#app').evaluate(el=>getComputedStyle(el).clipPath);
    await page.screenshot({ path: `${out}/startup-${theme}-${size[0]}-${name}.png` });
    timings.push({theme,size,name,target,actual,clip});
   }
  }
  await page.evaluate(patch=>window.launcher.invoke('settings.patch',patch),{theme:'dark',openingSpeed:1,animationSpeed:1});
  await page.reload(); await page.waitForSelector('.opening'); const start = Date.now(); const frames=[];
  for (let i=0;i<36;i++) { await page.waitForTimeout(Math.max(0,i*80-(Date.now()-start))); const file=`${out}/video-${String(i).padStart(3,'0')}.png`; await page.screenshot({path:file}); frames.push({file,time:Date.now()-start}); }
  let concat=''; frames.forEach((frame,i)=>{ concat+=`file '${frame.file.split('/').pop()}'\n`; if(i<frames.length-1)concat+=`duration ${(frames[i+1].time-frame.time)/1000}\n`; });
  await writeFile(`${out}/frames.txt`,concat); await writeFile(`${out}/timings.json`,JSON.stringify({timings,frames},null,2));
 } finally { await app.close(); await rm(data,{recursive:true,force:true}); }
})().catch(error=>{ console.error(error); process.exitCode=1; });
