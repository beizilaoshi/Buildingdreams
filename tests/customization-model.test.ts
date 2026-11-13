import { expect, test } from 'vitest';
import { APPEARANCE_KEYS, APPEARANCE_PRESETS, appearancePatch, resetAppearanceGroup, parseAppearance, serializeAppearance, validateAppearanceProfiles } from '../src/shared/appearance';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../src/shared/settings';
test('appearance presets and reset stay in appearance whitelist',()=>{
 expect(APPEARANCE_PRESETS).toHaveLength(4);
 for(const settings of [...APPEARANCE_PRESETS.map(p=>p.settings),resetAppearanceGroup('all')]){
  expect(Object.keys(settings).every(k=>APPEARANCE_KEYS.includes(k as never))).toBe(true);
  expect(validateSettingsPatch(settings)).toEqual(settings);
 }
 expect(appearancePatch({...DEFAULT_SETTINGS,javaPath:'SECRET'})).not.toHaveProperty('javaPath');
});
test('strict versioned JSON rejects unknown runtime, prototypes and bad values',()=>{
 for(const text of ['{',JSON.stringify({version:2,settings:{}}),JSON.stringify({version:1,settings:{javaPath:'secret'}}),'{"version":1,"settings":{"__proto__":{}}}',JSON.stringify({version:1,settings:{backgroundColor:'red;bad'}}),' '.repeat(65537)]) expect(()=>parseAppearance(text)).toThrow();
 expect(parseAppearance(serializeAppearance(DEFAULT_SETTINGS))).toEqual(appearancePatch(DEFAULT_SETTINGS));
});
test('profiles are bounded and never contain recursive/runtime settings',()=>{
 expect(validateAppearanceProfiles([{id:'mine-1',name:'我的',settings:{theme:'dark'}}])).toHaveLength(1);
 for(const value of [Array(25).fill({id:'x',name:'x',settings:{}}),[{id:'x',name:'x',settings:{appearanceProfiles:[]}}],[{id:'x',name:'x',settings:{launch:{}}}],[{id:'__proto__',name:'x',settings:{}}],[{id:'x',name:'x',settings:{},extra:1}]]) expect(()=>validateAppearanceProfiles(value)).toThrow();
});
test('local photos are omitted with explicit reselection note',()=>{
 const text=serializeAppearance({...DEFAULT_SETTINGS,wallpaper:'file:///C:/private/photo.png'});
 expect(text).not.toContain('private'); expect(text).toContain('重新选择');
 expect(parseAppearance(text).wallpaper).toBe('builtin:moon-lake');
});

test('night lake default and painterly presets preserve the original visual direction',()=>{
 expect(DEFAULT_SETTINGS.wallpaper).toBe('builtin:moon-lake');
 expect(APPEARANCE_PRESETS.slice(0,2)).toMatchObject([
  {id:'moonlake-night',name:'月湖星语',settings:{theme:'dark',wallpaper:'builtin:moon-lake'}},
  {id:'cloud-dawn',name:'云海晨光',settings:{theme:'light',wallpaper:'builtin:cloud-dawn'}},
 ]);
});

test('group reset follows the visible theme section',()=>{
 expect(resetAppearanceGroup('background')).not.toHaveProperty('theme');
 expect(resetAppearanceGroup('material')).toHaveProperty('theme',DEFAULT_SETTINGS.theme);
});
