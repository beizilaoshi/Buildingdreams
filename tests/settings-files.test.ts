import { test,expect,vi } from 'vitest';
import { mkdtemp,writeFile,readFile,rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';import {join} from 'node:path';
const dialogs=vi.hoisted(()=>({showSaveDialog:vi.fn(),showOpenDialog:vi.fn()}));vi.mock('electron',()=>({dialog:dialogs}));
import {registerSettingsFileCommands} from '../src/main/settings-files';import {CommandRouter} from '../src/main/ipc';import {DEFAULT_SETTINGS} from '../src/shared/settings';
test('native preview never mutates settings; apply keeps private launch values and failed apply remains retryable',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'settings-transfer-'));try{
 const path=join(dir,'backup.json');await writeFile(path,JSON.stringify({version:1,settings:{memoryMb:8192,launch:{width:1024}}}));dialogs.showOpenDialog.mockResolvedValue({canceled:false,filePaths:[path]});
 let current=structuredClone(DEFAULT_SETTINGS);current.launch.preCommand='private';let fail=true;const patch=vi.fn(async value=>{if(fail)throw Error('disk full');current={...current,...value,launch:value.launch?{...current.launch,...value.launch}:current.launch};return current;});const router=new CommandRouter();registerSettingsFileCommands(router,{read:async()=>current,restorePortable:patch},()=>null);
 const preview=await router.invoke('settings.importPreview',undefined) as {token:string};expect(patch).not.toHaveBeenCalled();await expect(router.invoke('settings.importApply',preview.token)).rejects.toThrow('disk full');fail=false;await router.invoke('settings.importApply',preview.token);expect(current.memoryMb).toBe(8192);expect(current.launch.preCommand).toBe('private');expect(current.launch.width).toBe(1024);await expect(router.invoke('settings.importApply',preview.token)).rejects.toThrow();
 dialogs.showSaveDialog.mockResolvedValue({canceled:false,filePath:join(dir,'out.json')});await router.invoke('settings.export',undefined);expect(await readFile(join(dir,'out.json'),'utf8')).not.toContain('private');
 dialogs.showOpenDialog.mockResolvedValue({canceled:true,filePaths:[]});expect(await router.invoke('settings.importPreview',undefined)).toBeNull();await expect(router.invoke('settings.importApply',{})).rejects.toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});

test('restore merges launch inside queued transaction and refuses private backup fields',async()=>{
 const {SettingsStore}=await import('../src/main/services/settings');const dir=await mkdtemp(join(tmpdir(),'settings-atomic-'));try{
 const store=new SettingsStore(join(dir,'settings.json'));const initial=await store.read();
 const save=store.patch({launch:{...initial.launch,preCommand:'new-private-command',gameArgs:['--demo'],serverHost:'private.example'}});
 const restore=store.restorePortable({launch:{width:1024} as typeof initial.launch});await Promise.all([save,restore]);const current=await store.read();expect(current.launch.width).toBe(1024);expect(current.launch.preCommand).toBe('new-private-command');expect(current.launch.serverHost).toBe('private.example');expect(current.launch.gameArgs).toEqual(['--demo']);
 expect(()=>store.restorePortable({javaPath:'C:/private'})).toThrow();
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('same preview rejects overlapping applies and a failed old apply never resurrects a replacement preview',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'settings-flight-'));try{const path=join(dir,'backup.json');await writeFile(path,JSON.stringify({version:1,settings:{memoryMb:8192}}));dialogs.showOpenDialog.mockResolvedValue({canceled:false,filePaths:[path]});
 let reject!: (reason:Error)=>void;const restorePortable=vi.fn(()=>new Promise<never>((_,r)=>{reject=r;}));const router=new CommandRouter();registerSettingsFileCommands(router,{read:async()=>structuredClone(DEFAULT_SETTINGS),restorePortable},()=>null);
 const first=await router.invoke('settings.importPreview',undefined) as {token:string};const apply=router.invoke('settings.importApply',first.token);const caught=expect(apply).rejects.toThrow('disk full');await expect(router.invoke('settings.importApply',first.token)).rejects.toThrow();expect(restorePortable).toHaveBeenCalledTimes(1);
 const second=await router.invoke('settings.importPreview',undefined) as {token:string};reject(Error('disk full'));await caught;await expect(router.invoke('settings.importApply',first.token)).rejects.toThrow();restorePortable.mockResolvedValueOnce(structuredClone(DEFAULT_SETTINGS) as never);await router.invoke('settings.importApply',second.token);
 }finally{await rm(dir,{recursive:true,force:true});}
});
