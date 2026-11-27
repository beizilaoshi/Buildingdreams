import {it,expect} from 'vitest';
import {validateSettingsPatch,DEFAULT_SETTINGS} from '../src/shared/settings';
it('validates navigation selections and custom title without affecting appearance-only profiles',()=>{
 expect(validateSettingsPatch({navigationHidden:['settings','mods'],titleText:'我的筑梦'})).toEqual({navigationHidden:['settings','mods'],titleText:'我的筑梦'});
 for(const value of [['bad'],['mods','mods'],null])expect(()=>validateSettingsPatch({navigationHidden:value})).toThrow();
 expect(()=>validateSettingsPatch({titleText:'x'.repeat(61)})).toThrow();
 expect(DEFAULT_SETTINGS.navigationHidden).toEqual([]);
});
