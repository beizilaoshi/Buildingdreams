import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('launch snake owns the viewport until truthful completion and releases every terminal path', async () => {
 const data = await mkdtemp(join(tmpdir(), 'zhumeng-snake-')), game = join(data, 'game');
 await mkdir(join(game, 'versions', 'Snake'), { recursive: true });
 await writeFile(join(game, 'versions', 'Snake', 'Snake.json'), JSON.stringify({ id:'Snake', mainClass:'NeverExecuted', libraries:[], minecraftArguments:'' }));
 const app = await electron.launch({ args:['.'], env:{...process.env, ZHUMENG_DATA_DIR:data} });
 try {
  const page = await app.firstWindow(); await page.waitForSelector('.home-intro'); await page.keyboard.press('Escape');
  await page.evaluate(async root => { await window.launcher.invoke('instances.import', root); await window.launcher.invoke('accounts.addLocal','SnakePlayer'); await window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true}); }, game);
  await app.evaluate((_e,cwd) => {
   const req=(process as any).mainModule.require.bind((process as any).mainModule), Launch=req(req('node:path').join(cwd,'dist/main/services/launch.js')).LaunchService;
   const f:any=(globalThis as any).snakeFixture={calls:0};
   const originalStatus=Launch.prototype.status; Launch.prototype.status=function(id:string) { if(f.statusFail) throw new Error('fixture status failure'); return originalStatus.call(this,id); };
   f.emit=(phase:string, extra:any={}) => { const value={instanceId:f.id,phase,time:Date.now(),...extra}; f.service.states.set(value.instanceId,value); f.service.events.emit('state',value); return value; };
   Launch.prototype.launch=async function(id:string) { f.calls++; f.id=id; f.service=this; return new Promise((resolve,reject)=>{f.resolve=resolve;f.reject=reject;}); };
   Launch.prototype.cancel=async function() { f.cancelCalls=(f.cancelCalls||0)+1; return f.emit('preparing'); };
   Launch.prototype.stop=async function(id:string) { f.stopIds=(f.stopIds||[]).concat(id); if(f.cancelFail) throw new Error('fixture stop failure'); if(f.stopNoop) return f.emit(f.stopIdle ? 'idle' : 'preparing'); f.emit('stopping'); f.emit('running',{pid:123}); return new Promise(resolve=>{ f.finishStop=()=>resolve(f.emit('stopping')); }); };
  },process.cwd());
  await page.reload();
  const modal=page.locator('.launch-snake');
  const start=()=>page.getByRole('button',{name:'启动游戏',exact:true}).click();
  await start(); await expect(modal).toBeVisible(); expect(await app.evaluate(()=>(globalThis as any).snakeFixture.calls)).toBe(1);
  await page.keyboard.press('Tab'); await expect(modal.getByRole('button')).toBeFocused();
  await page.mouse.click(45,150); await expect(modal.locator('canvas')).toHaveAttribute('data-feeds','1');
  await expect(page.locator('.home-intro')).toBeVisible();
  await page.getByRole('button',{name:'游戏库',exact:true}).evaluate((n:HTMLButtonElement)=>n.click());
  await expect(modal).toBeVisible();
  await page.locator('.launch-controls button').first().evaluate((n:HTMLButtonElement)=>n.click());
  expect(await app.evaluate(()=>(globalThis as any).snakeFixture.calls)).toBe(1);
  await app.evaluate(()=>{const f=(globalThis as any).snakeFixture; f.emit('running',{instanceId:'other',pid:123,windowReady:true}); f.emit('failed',{time:1});f.emit('running',{pid:123});}); await expect(modal).toBeVisible();
  for(const width of [1280,960]) { await app.evaluate(({BrowserWindow},w)=>BrowserWindow.getAllWindows()[0].setSize(w,w===960?640:820),width); await page.screenshot({path:`validation/launch-snake-${width}.png`}); }
  await app.evaluate(()=>{const f=(globalThis as any).snakeFixture; f.cancelFail=true;}); await page.keyboard.press('Escape'); await expect(modal.getByRole('button')).toBeEnabled();
  await app.evaluate(()=>{const f=(globalThis as any).snakeFixture; f.cancelFail=false; f.stopNoop=true;}); await page.keyboard.press('Escape'); await expect(modal.getByRole('button')).toBeEnabled(); await expect(modal).toBeVisible();
  await app.evaluate(()=>{const f=(globalThis as any).snakeFixture; f.stopNoop=false;}); await page.keyboard.press('Escape'); await expect(modal.getByRole('button')).toBeDisabled(); await expect(modal).toBeVisible();
  await app.evaluate(()=>{(globalThis as any).snakeFixture.finishStop();}); await expect(modal.getByRole('button')).toBeDisabled(); await expect(modal).toBeVisible();
  expect(await app.evaluate(()=>{const f=(globalThis as any).snakeFixture; return { cancels:f.cancelCalls||0, ids:f.stopIds, id:f.id };})).toMatchObject({cancels:0});
  expect(await app.evaluate(()=>{const f=(globalThis as any).snakeFixture; return f.stopIds.every((id:string)=>id===f.id);})).toBe(true);
  await app.evaluate(()=>{const f=(globalThis as any).snakeFixture;f.reject(new Error('aborted before child close'));});
  await expect(page.locator('.launch-controls')).toContainText('正在停止'); await expect(modal).toBeVisible();
  await page.getByRole('button',{name:'首页',exact:true}).evaluate((n:HTMLButtonElement)=>n.click()); await expect(modal).toBeVisible();
  await page.locator('.launch-controls button').first().evaluate((n:HTMLButtonElement)=>n.click());
  expect(await app.evaluate(()=>(globalThis as any).snakeFixture.calls)).toBe(1);
  await app.evaluate(()=>{(globalThis as any).snakeFixture.emit('cancelled');});await expect(modal).toHaveCount(0);
  for(const outcome of ['failed','reject','running','graphics','exited']) {
   await start(); await expect(modal).toBeVisible();
   await app.evaluate((_e,outcome)=>{const f=(globalThis as any).snakeFixture;if(outcome==='reject')f.reject(new Error('fixture reject'));else {f.emit(outcome==='graphics'?'running':outcome,{pid:['running','graphics'].includes(outcome)?123:undefined,windowReady:outcome==='running'?true:undefined,gameReady:outcome==='graphics'?true:undefined,readinessSource:outcome==='graphics'?'graphics-log':undefined});f.resolve({pid:123});}},outcome);
   await expect(modal).toHaveCount(0);
   if(['running','graphics'].includes(outcome)) await app.evaluate(()=>{(globalThis as any).snakeFixture.emit('exited');});
  }
  await start(); await expect(modal).toBeVisible();
  await app.evaluate(()=>{const f=(globalThis as any).snakeFixture;f.stopNoop=true;f.stopIdle=true;}); await page.keyboard.press('Escape'); await expect(modal.getByRole('button')).toBeEnabled();
  await app.evaluate(()=>{const f=(globalThis as any).snakeFixture;f.statusFail=true;f.reject(new Error('no owned attempt'));}); await expect(modal.getByRole('button')).toBeEnabled(); await expect(modal).toBeVisible();
  await app.evaluate(()=>{(globalThis as any).snakeFixture.statusFail=false;}); await page.keyboard.press('Escape'); await expect(modal).toHaveCount(0);
  await start(); await expect(modal).toBeVisible(); await page.reload(); await expect(modal).toHaveCount(0);
 } finally { await app.close(); await rm(data,{recursive:true,force:true}); }
});
