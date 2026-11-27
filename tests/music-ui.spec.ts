import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
test('music real IPC, restricted protocol, playback and persisted card controls',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zhumeng-music-ui-'));const file=join(data,'sample.wav');const wave=Buffer.alloc(44+16000);wave.write('RIFF',0);wave.writeUInt32LE(wave.length-8,4);wave.write('WAVEfmt ',8);wave.writeUInt32LE(16,16);wave.writeUInt16LE(1,20);wave.writeUInt16LE(1,22);wave.writeUInt32LE(8000,24);wave.writeUInt32LE(16000,28);wave.writeUInt16LE(2,32);wave.writeUInt16LE(16,34);wave.write('data',36);wave.writeUInt32LE(16000,40);await writeFile(file,wave);
 await writeFile(join(data,'music.json'),JSON.stringify({preferences:{volume:0.2,random:false,autoPlay:false,pauseDuringGame:true},paths:[file]}));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');const snapshot=await page.evaluate(()=>window.launcher.invoke('music.read',undefined));expect(snapshot.tracks).toHaveLength(1);expect(JSON.stringify(snapshot)).not.toContain(data);
 const protocol=await app.evaluate(async({net},url)=>{const response=await net.fetch(url,{headers:{Range:'bytes=0-3'}});const invalid=await net.fetch('zhumeng-music://track/not-authorized');return{status:response.status,bytes:Array.from(new Uint8Array(await response.arrayBuffer())),invalid:invalid.status};},snapshot.tracks[0].url);expect(protocol).toEqual({status:206,bytes:[82,73,70,70],invalid:404});
 await page.getByRole('button',{name:'个性化',exact:true}).click();const card=page.locator('[data-music-panel]');await expect(card).toContainText('sample.wav');await card.getByRole('button',{name:'播放',exact:true}).click();await expect(card.getByRole('button',{name:'暂停',exact:true})).toBeVisible();await card.getByRole('button',{name:'暂停',exact:true}).click();await card.getByLabel('背景音乐音量').evaluate((input:HTMLInputElement)=>{input.value='31';input.dispatchEvent(new Event('input',{bubbles:true}));});await card.getByLabel('背景音乐音量').dispatchEvent('change');await expect.poll(async()=>page.evaluate(async()=>(await window.launcher.invoke('music.read',undefined)).preferences.volume)).toBe(0.31);
 await page.reload();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');await page.getByRole('button',{name:'个性化',exact:true}).click();await expect(page.locator('[data-music-panel] input[type=range]')).toHaveValue('31');
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
