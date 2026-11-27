import { test, expect, _electron as electron } from '@playwright/test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
test('external server setup, multi-profile login, cancellation and persisted home selection use real IPC', async () => {
    const data = await mkdtemp(join(tmpdir(), 'zhumeng-external-ui-'));
    const app = await electron.launch({ args: ['.'], env: { ...process.env, ZHUMENG_DATA_DIR: data } });
    try {
        const page = await app.firstWindow();
        const errors: string[] = [];
        page.on('pageerror', e => errors.push(e.message));
        await page.waitForSelector('.home-intro');
        await page.keyboard.press('Escape');
        await page.evaluate(() => window.launcher.invoke('settings.patch', { openingEnabled: false, reducedMotion: true, checkUpdatesOnStartup: false }));
        await app.evaluate((_e, cwd) => { const req = (process as any).mainModule.require.bind((process as any).mainModule), Service = req(req('node:path').join(cwd, 'dist/main/services/external-accounts.js')).ExternalAccountService; const original = Service.prototype.addServer; Service.prototype.addServer = function (url: string) { this.fetcher = async (url: string, init: any) => { const body = init?.body ? JSON.parse(init.body) : undefined; const alice = { id: '0123456789abcdef0123456789abcdef', name: 'Alice' }, bob = { id: '1123456789abcdef0123456789abcdef', name: 'Bob' }; if (url.endsWith('authserver/authenticate'))
            return new Response(JSON.stringify({ accessToken: 'FIXTURE_TOKEN', clientToken: 'FIXTURE_CLIENT', availableProfiles: [alice, bob] })); if (url.endsWith('authserver/refresh'))
            return new Response(JSON.stringify({ accessToken: 'ROTATED_TOKEN', clientToken: 'FIXTURE_CLIENT', selectedProfile: body.selectedProfile ?? alice })); if (url.endsWith('authserver/signout') || url.endsWith('authserver/validate'))
            return new Response(null, { status: 204 }); return new Response(JSON.stringify({ meta: { serverName: 'Fixture Skin', links: { register: 'https://example.org/register' } }, skinDomains: ['example.org'], signaturePublickey: 'test' })); }; return original.call(this, url); }; }, process.cwd());
        await page.getByRole('button', { name: '登录 / 添加账号 →', exact: true }).click();
        await page.getByLabel('服务器 API 地址（支持自动识别）').fill('https://example.org/api');
        await page.getByRole('button', { name: '添加服务器', exact: true }).click();
        await expect(page.locator('.version-row').filter({ hasText: 'Fixture Skin' })).toBeVisible();
        await page.getByRole('button', { name: '外置登录', exact: true }).click();
        const modal = page.getByRole('dialog', { name: '外置登录', exact: true });
        await expect(modal.getByRole('radio', { name: /Fixture Skin/ })).toBeVisible();
        await modal.getByLabel('账户', { exact: true }).fill('fixture-user');
        await modal.getByLabel('密码', { exact: true }).fill('FIXTURE_PASSWORD');
        await modal.getByRole('button', { name: '登录', exact: true }).click();
        await expect(modal.getByRole('radio', { name: 'Bob', exact: true })).toBeVisible();
        await modal.getByRole('radio', { name: 'Bob', exact: true }).click();
        await modal.getByRole('button', { name: '使用所选角色', exact: true }).click();
        await expect(modal).toHaveCount(0);
        const accounts = await page.evaluate(() => window.launcher.invoke('accounts.list', undefined));
        expect(accounts).toHaveLength(1);
        expect(accounts[0]).toMatchObject({ kind: 'external', name: 'Bob' });
        expect(JSON.stringify(accounts)).not.toMatch(/TOKEN|CLIENT|PASSWORD/);
        await page.getByRole('button', { name: '首页', exact: true }).click();
        await expect(page.locator('.player-summary')).toContainText('Bob');
        await expect(page.locator('.player-summary')).toContainText('Fixture Skin');
        await page.reload();
        await expect(page.locator('.player-summary')).toContainText('Bob');
        await expect(page.getByRole('radio', { name: '外置认证', exact: true })).toHaveAttribute('aria-checked', 'true');
        await page.getByRole('button', { name: '外置登录', exact: true }).click();
        await page.getByRole('dialog').getByLabel('账户', { exact: true }).fill('fixture-user');
        await page.getByRole('dialog').getByLabel('密码', { exact: true }).fill('FIXTURE_PASSWORD');
        await page.getByRole('dialog').getByRole('button', { name: '登录', exact: true }).click();
        await expect(page.getByRole('dialog').getByRole('radio', { name: 'Alice', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
        expect(await page.evaluate(() => window.launcher.invoke('accounts.list', undefined))).toHaveLength(1);
        await page.screenshot({ path: '.superpowers/sdd/2026-11-13-full-parity/external-home.png' });
        expect(errors).toEqual([]);
    }
    finally {
        await app.close();
        await rm(data, { recursive: true, force: true });
    }
});
test('instance auth server choice survives failed save and persists after retry',async()=>{
 const data=await mkdtemp(join(tmpdir(),'zhumeng-auth-policy-ui-'));const app=await electron.launch({args:['.'],env:{...process.env,ZHUMENG_DATA_DIR:data}});
 try{const page=await app.firstWindow();await page.waitForSelector('.home-intro');await page.keyboard.press('Escape');await page.evaluate(()=>window.launcher.invoke('settings.patch',{openingEnabled:false,reducedMotion:true}));
 await app.evaluate(async(_e,fixture)=>{const req=(process as any).mainModule.require.bind((process as any).mainModule),path=req('node:path'),fs=req('node:fs/promises');await fs.mkdir(path.join(fixture.data,'game','versions','AuthGame'),{recursive:true});await fs.writeFile(path.join(fixture.data,'game','versions','AuthGame','AuthGame.json'),JSON.stringify({id:'AuthGame',mainClass:'Main',libraries:[],minecraftArguments:''}));const Service=req(path.join(fixture.cwd,'dist/main/services/external-accounts.js')).ExternalAccountService,original=Service.prototype.addServer;Service.prototype.addServer=function(url:string){this.fetcher=async()=>new Response(JSON.stringify({meta:{serverName:'Policy Skin'},skinDomains:[],signaturePublickey:'test'}));return original.call(this,url);};const Instances=req(path.join(fixture.cwd,'dist/main/services/instances.js')).InstanceService,save=Instances.prototype.setAuthentication;(globalThis as any).policyFail=true;Instances.prototype.setAuthentication=function(...args:any[]){if((globalThis as any).policyFail)throw Error('fixture policy write failed');return save.apply(this,args);};},{cwd:process.cwd(),data});
 const server=await page.evaluate(()=>window.launcher.invoke('external.addServer','https://example.org/api'));await page.evaluate(root=>window.launcher.invoke('instances.import',root),join(data,'game'));await page.reload();await page.getByRole('button',{name:'游戏库',exact:true}).click();await page.getByRole('button',{name:'管理游戏',exact:true}).click();const modal=page.getByRole('dialog',{name:'AuthGame · 管理游戏',exact:true});await modal.getByRole('radio',{name:/Policy Skin/}).click();await modal.getByRole('button',{name:'保存实例认证策略',exact:true}).click();await expect(modal.getByRole('alert')).toContainText('fixture policy write failed');await expect(modal.getByRole('radio',{name:/Policy Skin/})).toHaveAttribute('aria-checked','true');await app.evaluate(()=>{(globalThis as any).policyFail=false;});await modal.getByRole('button',{name:'保存实例认证策略',exact:true}).click();await expect(modal.locator('[role=alert]')).toHaveText('');const instances=await page.evaluate(()=>window.launcher.invoke('instances.list',undefined));expect(instances[0].authentication).toEqual({kind:'external',serverId:server.id});await page.screenshot({path:'.superpowers/sdd/2026-11-13-full-parity/external-policy.png'});
 }finally{await app.close();await rm(data,{recursive:true,force:true});}
});
