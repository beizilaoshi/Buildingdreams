import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';import {createHash} from 'node:crypto';
test('explicit exact-hash identification reports each file, preserves old state and filters',async()=>{
 const data=await mkdtemp(join(tmpdir(),'identify-ui-')),root=join(data,'game'),mods=join(root,'versions','One','mods');
 await mkdir(mods,{recursive:true});await writeFile(join(root,'versions','One','One.json'),JSON.stringify({id:'One',mainClass:'Main',libraries:[],minecraftArguments:''}));
 for(const [name,bytes] of [['match.jar.old','match'],['missing.jar','missing'],['offline.jar','offline']])await writeFile(join(mods,name),bytes);
 const hashes=Object.fromEntries(['match','missing','offline'].map(b=>[b,createHash('sha1').update(b).digest('hex')]));
 const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{
  const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');await page.evaluate(root=>window.launcher.invoke('instances.import',root),root);
  await app.evaluate((_electron,hashes)=>{
   (globalThis as any).identifyQueries=[];
   globalThis.fetch=async(input:any)=>{
    const url=new URL(String(input));
    if(url.pathname.includes('/version_file/')){
     (globalThis as any).identifyQueries.push(url.pathname);
     if(url.pathname.endsWith(hashes.missing))return new Response('',{status:404});
     if(url.pathname.endsWith(hashes.offline))return new Response('',{status:503});
     if(url.pathname.endsWith(hashes.match))return Response.json({id:'exactver',project_id:'exactproject',name:'Matched',version_number:'1',date_published:'2026-01-01',game_versions:['1.21'],loaders:['fabric'],dependencies:[],files:[{filename:'match.jar',url:'https://cdn.modrinth.com/match.jar',size:5,hashes:{sha1:hashes.match}}]});
    }
    return Response.json({hits:[],offset:0,limit:20,total_hits:0});
   };
  },hashes);
  await page.reload();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');await page.getByRole('button',{name:'模组',exact:true}).click();
  const local=page.locator('.local-mods');await expect(local.getByRole('checkbox')).toHaveCount(3);
  expect(await app.evaluate(()=>(globalThis as any).identifyQueries)).toEqual([]);
  await local.getByRole('button',{name:'选择可见项',exact:true}).click();await local.getByRole('button',{name:'识别本地 Mod',exact:true}).click();
  await expect(page.getByRole('dialog')).toContainText('CurseForge');await expect(page.getByRole('dialog')).toContainText('match.jar.old');
  await page.getByRole('button',{name:'确认识别',exact:true}).click();
  await expect(local.locator('.local-operation-report')).toContainText('match.jar.old：已识别');await expect(local.locator('.local-operation-report')).toContainText('missing.jar：未匹配');await expect(local.locator('.local-operation-report')).toContainText('offline.jar：失败');
  expect(JSON.parse(await readFile(join(mods,'.zhumeng-mods.json'),'utf8'))['match.jar.old'].projectId).toBe('exactproject');
  expect(await readFile(join(mods,'match.jar.old'),'utf8')).toBe('match');
  await local.getByLabel('搜索本地 Mod').fill('match');await local.getByRole('radio',{name:'已禁用',exact:true}).click();
  await local.getByRole('button',{name:'识别本地 Mod',exact:true}).click();await expect(page.getByRole('dialog')).not.toContainText('match.jar.old');await page.getByRole('button',{name:'确认识别',exact:true}).click();
  await expect(local.getByRole('checkbox')).toHaveCount(1);await expect(local.getByLabel('搜索本地 Mod')).toHaveValue('match');await expect(local.getByRole('radio',{name:'已禁用',exact:true})).toBeChecked();
  expect((await app.evaluate(()=>(globalThis as any).identifyQueries)).filter((s:string)=>s.endsWith(hashes.match))).toHaveLength(1);
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
