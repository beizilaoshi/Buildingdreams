import {test,expect,_electron as electron} from '@playwright/test';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';import {tmpdir} from 'node:os';
test('real Electron uses both provider transports and preserves independent all-source state',async()=>{
 const data=await mkdtemp(join(tmpdir(),'aggregate-ui-'));const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');
 await page.evaluate(()=>window.launcher.invoke('content.setProviderKey',{provider:'curseforge',key:'fixture-only-key',remember:false}));
 await app.evaluate(()=>{
  globalThis.fetch=async(input:any)=>{const u=new URL(String(input));
   if(u.hostname==='api.curseforge.com'){
    const offset=Number(u.searchParams.get('index')),limit=Number(u.searchParams.get('pageSize'));
    const count=Math.max(0,Math.min(limit,3-offset));
    return new Response(JSON.stringify({data:Array.from({length:count},(_,i)=>({id:offset+i+1,gameId:432,classId:6,name:'Same name CF '+(offset+i),slug:'cf-'+(offset+i),summary:'CF fixture',authors:[],categories:[],downloadCount:10,thumbsUpCount:0,allowModDistribution:true,links:{websiteUrl:'https://www.curseforge.com/minecraft/mc-mods/fixture'}})),pagination:{index:offset,pageSize:limit,resultCount:count,totalCount:3}}));
   }
   if(u.pathname.endsWith('/search')){const offset=Number(u.searchParams.get('offset')),limit=Number(u.searchParams.get('limit'));return new Response(JSON.stringify({hits:Array.from({length:Math.max(0,Math.min(limit,45-offset))},(_,i)=>({project_id:'mr'+(offset+i),slug:'mr-'+(offset+i),title:'Same name MR '+(offset+i),description:'MR fixture',downloads:10,categories:[]})),offset,limit,total_hits:45}));}
   throw Error('Unexpected fixture route '+u.pathname);
  };
 });
 await page.getByRole('button',{name:'模组',exact:true}).click();
 await page.getByRole('radio',{name:'全部来源',exact:true}).click();
 await expect(page.locator('.content-project-row')).toHaveCount(40);
 await expect(page.locator('.content-source-status')).toHaveText(['Modrinth：45 个项目','CurseForge：3 个项目']);
 await expect(page.locator('.content-project-row').nth(1)).toContainText('CF 0');
 await page.getByRole('button',{name:'下一页',exact:true}).click();
 await expect(page.locator('.content-project-row')).toHaveCount(8);
 await expect(page.locator('.content-project-row').first()).toContainText('MR 37');
 await page.getByRole('radio',{name:'Modrinth',exact:true}).click();
 await expect(page.locator('.content-result-count')).toContainText('第 1 页');
 await page.getByRole('radio',{name:'全部来源',exact:true}).click();
 await expect(page.locator('.content-result-count')).toContainText('第 2 页');
 await page.screenshot({path:'.superpowers/aggregate-electron.png',fullPage:true});
 }finally{await app.close();await rm(data,{recursive:true,force:true})}
});
