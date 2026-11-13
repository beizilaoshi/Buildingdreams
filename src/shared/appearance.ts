import { DEFAULT_SETTINGS, validateSettingsPatch } from './settings';
import type { AppearanceProfile, Settings } from './types';
export const APPEARANCE_GROUPS = {
  background: ['wallpaper','wallpaperFit','wallpaperBrightness','wallpaperBlur','backgroundStyle','backgroundColor','gradientColor','backgroundOverlay','backgroundVignette','wallpaperSaturation','wallpaperPositionX','wallpaperPositionY','wallpaperScale','backgroundAnimation','backgroundMotionIntensity','backgroundMotionSpeed','backgroundEffect','backgroundQuality'],
  material: ['theme','glassOpacity','glassBlur','glassRefraction','glassStyle','glassBorderOpacity','glassShadow','accentColor','cornerRadius'],
  layout: ['density','navigationLabels','libraryView','fontFamily','fontScale','navWidth','contentWidth','cardSpacing'],
  home: ['homeTitle','homeSubtitle','homeTitleSize','homeTextAlign','showHomeIntro'],
  motion: ['openingTheme','openingSpeed','openingEnabled','particles','parallax','animationSpeed','reducedMotion','pageTransition','notificationPosition'],
} as const satisfies Record<string, readonly (keyof Settings)[]>;
export const APPEARANCE_KEYS = Object.values(APPEARANCE_GROUPS).flat();
export const APPEARANCE_MAX_BYTES = 65536;
function object(value: unknown): asserts value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.getPrototypeOf(value) !== Object.prototype) throw Error('外观配置必须为普通对象');
}
function validateAppearance(value: unknown): Partial<Settings> {
  object(value);
  for (const key of Object.keys(value)) if (!(APPEARANCE_KEYS as readonly string[]).includes(key)) throw Error(`未知外观项: ${key}`);
  return validateSettingsPatch(value);
}
export function appearancePatch(settings: Partial<Settings>): Partial<Settings> {
  return validateAppearance(Object.fromEntries(APPEARANCE_KEYS.filter(key => Object.hasOwn(settings,key)).map(key=>[key,settings[key]])));
}
export function resetAppearanceGroup(group: keyof typeof APPEARANCE_GROUPS | 'all'): Partial<Settings> {
  const keys = group === 'all' ? APPEARANCE_KEYS : APPEARANCE_GROUPS[group];
  if (!keys) throw Error('未知外观分组');
  return Object.fromEntries(keys.map(key=>[key,DEFAULT_SETTINGS[key]]));
}
export const APPEARANCE_PRESETS: readonly {id:string;name:string;description:string;settings:Partial<Settings>}[] = [
  {id:'moonlake-night',name:'月湖星语',description:'日式绘本月湖夜色与柔和磨砂玻璃',settings:{theme:'dark',wallpaper:'builtin:moon-lake',backgroundStyle:'image',backgroundOverlay:0.28,glassStyle:'frosted',accentColor:'#93a8ff'}},
  {id:'cloud-dawn',name:'云海晨光',description:'手绘云海晨光与轻盈卡片',settings:{theme:'light',wallpaper:'builtin:cloud-dawn',backgroundStyle:'image',backgroundOverlay:0.12,glassStyle:'frosted',accentColor:'#7363ca'}},
  {id:'minimal-dark',name:'极简深色',description:'沉静纯色与克制动效',settings:{theme:'dark',backgroundStyle:'solid',backgroundColor:'#11182e',glassStyle:'solid',particles:false,parallax:false,accentColor:'#93a8ff'}},
  {id:'clear-light',name:'清透浅色',description:'浅色渐变与清透材质',settings:{theme:'light',backgroundStyle:'gradient',backgroundColor:'#dce8ff',gradientColor:'#f3e7fb',glassStyle:'clear',backgroundOverlay:0,accentColor:'#6656ba'}},
];
export function validateAppearanceProfiles(value: unknown): AppearanceProfile[] {
  if(!Array.isArray(value)||value.length>24) throw Error('个人方案最多24个');
  const ids=new Set<string>();
  return value.map(item=>{
    object(item);
    if(Object.keys(item).some(key=>!['id','name','settings'].includes(key))) throw Error('未知个人方案字段');
    if(typeof item.id!=='string'||!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(item.id)||['__proto__','constructor','prototype'].includes(item.id)||ids.has(item.id)) throw Error('无效或重复方案标识');
    if(typeof item.name!=='string'||!item.name.trim()||item.name.length>40||item.name.includes('\0')) throw Error('无效方案名称');
    ids.add(item.id);
    return {id:item.id,name:item.name,settings:validateAppearance(item.settings)};
  });
}
export function serializeAppearance(settings: Partial<Settings>): string {
  const patch=appearancePatch(settings);
  const local=typeof patch.wallpaper==='string'&&!patch.wallpaper.startsWith('builtin:');
  if(local) patch.wallpaper='builtin:moon-lake';
  const text=JSON.stringify({version:1,settings:patch,...(local?{note:'本地背景照片未打包，请重新选择本地背景。'}:{})},null,2);
  if(new TextEncoder().encode(text).length>APPEARANCE_MAX_BYTES)throw Error('外观文件过大');
  return text;
}
export function parseAppearance(text: string): Partial<Settings> {
  if(typeof text!=='string'||new TextEncoder().encode(text).length>APPEARANCE_MAX_BYTES) throw Error('外观文件过大');
  const value:unknown=JSON.parse(text); object(value);
  if(value.version!==1||Object.keys(value).some(key=>!['version','settings','note'].includes(key))||(value.note!==undefined&&(typeof value.note!=='string'||value.note.length>200))) throw Error('无效外观文件版本或字段');
  const patch=validateAppearance(value.settings);
  if(patch.wallpaper!==undefined&&!patch.wallpaper.startsWith('builtin:')) throw Error('导入本地背景请重新选择照片');
  return patch;
}
