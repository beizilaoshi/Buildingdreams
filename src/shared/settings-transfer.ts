import { validateSettingsPatch } from './settings';
import { validateLaunchSettings } from './launch-settings';
import type { Settings } from './types';
export const SETTINGS_TRANSFER_MAX_BYTES=262144;
const excluded=['javaPath','javaArgs','gameDirectory','microsoftClientId'] as const;
const excludedLaunch=['preCommand','preCommandEnabled','preCommandWait','preCommandTimeout','gameArgs','serverHost','serverPort'] as const;
export interface SettingsTransferPreview { token:string; fields:string[]; notes:string[]; }
export interface PortableSettings { settings:Partial<Settings>; notes:string[]; }
function object(v:unknown):asserts v is Record<string,unknown>{if(!v||typeof v!=='object'||Array.isArray(v)||Object.getPrototypeOf(v)!==Object.prototype)throw Error('设置备份必须为普通对象');}
function portable(patch:Partial<Settings>,exporting:boolean):Partial<Settings>{
 const out=structuredClone(patch) as Record<string,unknown>;
 for(const key of excluded){if(!exporting&&Object.hasOwn(out,key))throw Error('备份包含不可移植配置');delete out[key];}
 if(out.launch){const launch={...(out.launch as Record<string,unknown>)};for(const key of excludedLaunch){if(!exporting&&Object.hasOwn(launch,key))throw Error('备份包含命令、参数或服务器配置');delete launch[key];}out.launch=launch;}
 const fix=(v:Record<string,unknown>)=>{if(v.titleImage){if(!exporting)throw Error('本地标题图片需重新选择');v.titleImage='';}if(typeof v.wallpaper==='string'&&!v.wallpaper.startsWith('builtin:')){if(!exporting)throw Error('本地背景需重新选择');v.wallpaper='builtin:moon-lake';}};
 fix(out);
 if(Array.isArray(out.appearanceProfiles))for(const p of out.appearanceProfiles)fix(p.settings);
 return out as Partial<Settings>;
}
export function serializeSettingsTransfer(settings:Settings):string{
 const value={version:1,settings:portable(validateSettingsPatch(settings),true)};
 const text=JSON.stringify(value,null,2);if(new TextEncoder().encode(text).length>SETTINGS_TRANSFER_MAX_BYTES)throw Error('设置备份过大');return text;
}
export function parseSettingsTransfer(text:string):PortableSettings{
 if(typeof text!=='string'||new TextEncoder().encode(text).length>SETTINGS_TRANSFER_MAX_BYTES)throw Error('设置备份过大');
 const value:unknown=JSON.parse(text);object(value);if(value.version!==1||Object.keys(value).some(k=>!['version','settings'].includes(k)))throw Error('不支持的设置备份版本或字段');object(value.settings);
 const safe=portable(value.settings as Partial<Settings>,false);const valid=validateSettingsPatch(safe);
 // Settings validation fills launch defaults; retain only explicitly imported portable keys.
 if(safe.launch)valid.launch=validateLaunchSettings(safe.launch) as Settings['launch'];
 return {settings:valid,notes:['账号、令牌、来源密钥、Microsoft 配置、Java/游戏路径、命令、参数和服务器地址均不迁移。','本地背景图片未打包，请重新选择；其他未包含的设置保持当前值。']};
}
