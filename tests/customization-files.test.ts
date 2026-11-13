import { expect,test,vi,beforeEach,afterEach } from 'vitest';
import { mkdtemp,writeFile,readFile,rm,readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
const dialogs=vi.hoisted(()=>({showSaveDialog:vi.fn(),showOpenDialog:vi.fn()}));
vi.mock('electron',()=>({dialog:dialogs}));
const writeFailure=vi.hoisted(()=>({enabled:false}));
vi.mock('node:fs/promises',async importOriginal=>{
 const actual=await importOriginal<typeof import('node:fs/promises')>();
 return {...actual,open:async(...args:Parameters<typeof actual.open>)=>{
  const handle=await actual.open(...args);
  if(writeFailure.enabled&&args[1]==='wx'){
   handle.writeFile=async()=>{await handle.write('partial');throw Object.assign(new Error('disk full'),{code:'ENOSPC'});};
  }
  return handle;
 }};
});
import { registerAppearanceFileCommands } from '../src/main/appearance-files';
import { CommandRouter } from '../src/main/ipc';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { SettingsStore } from '../src/main/services/settings';
let dir:string;
beforeEach(async()=>{vi.resetAllMocks();writeFailure.enabled=false;dir=await mkdtemp(join(tmpdir(),'appearance-'));});
afterEach(async()=>{await rm(dir,{recursive:true,force:true});});
function setup(){const router=new CommandRouter();const read=vi.fn(async()=>({...DEFAULT_SETTINGS,javaPath:'SECRET'}));registerAppearanceFileCommands(router,{read},()=>null);return {router,read};}
test('cancelled dialogs do no work and validate no payload',async()=>{
 const {router,read}=setup();dialogs.showSaveDialog.mockResolvedValue({canceled:true});dialogs.showOpenDialog.mockResolvedValue({canceled:true,filePaths:[]});
 expect(await router.invoke('appearance.export',undefined)).toBeNull();expect(await router.invoke('appearance.import',undefined)).toBeNull();expect(read).not.toHaveBeenCalled();
 await expect(router.invoke('appearance.export',{})).rejects.toThrow();
});
test('export owns appearance only, import validates without applying',async()=>{
 const {router}=setup();const file=join(dir,'style.json');dialogs.showSaveDialog.mockResolvedValue({filePath:file});
 expect(await router.invoke('appearance.export',undefined)).toBe(file);expect(await readFile(file,'utf8')).not.toContain('SECRET');
 dialogs.showOpenDialog.mockResolvedValue({filePaths:[file]});expect(await router.invoke('appearance.import',undefined)).toMatchObject({theme:'system'});
 await writeFile(file,'{"version":1,"settings":{"javaArgs":["secret"]}}');await expect(router.invoke('appearance.import',undefined)).rejects.toThrow();
 await writeFile(file,' '.repeat(65537));await expect(router.invoke('appearance.import',undefined)).rejects.toThrow();
 dialogs.showSaveDialog.mockResolvedValue({filePath:join(dir,'missing','style.json')});await expect(router.invoke('appearance.export',undefined)).rejects.toThrow();
});
test('legacy settings retain wallpaper/runtime while defaults and named profiles persist',async()=>{
 const path=join(dir,'settings.json');await writeFile(path,JSON.stringify({wallpaper:'builtin:moon-lake',javaPath:'C:/Java/java.exe',memoryMb:8192}));
 const store=new SettingsStore(path);expect(await store.read()).toMatchObject({wallpaper:'builtin:moon-lake',javaPath:'C:/Java/java.exe',memoryMb:8192,backgroundOverlay:0.28,startupPage:'home'});
 await store.patch({appearanceProfiles:[{id:'mine',name:'我的方案',settings:{fontScale:1.1}}]});
 expect((await new SettingsStore(path).read()).appearanceProfiles).toEqual([{id:'mine',name:'我的方案',settings:{fontScale:1.1}}]);
});

test('failed partial export preserves destination bytes and cleans its temporary sibling',async()=>{
 const {router}=setup();const file=join(dir,'existing.json');const original='previous valid export bytes';
 await writeFile(file,original);dialogs.showSaveDialog.mockResolvedValue({filePath:file});writeFailure.enabled=true;
 await expect(router.invoke('appearance.export',undefined)).rejects.toThrow('disk full');
 expect(await readFile(file,'utf8')).toBe(original);
 expect(await readdir(dir)).toEqual(['existing.json']);
});
