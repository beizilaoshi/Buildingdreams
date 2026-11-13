import { expect, test } from 'vitest';
import { DEFAULT_SETTINGS, validateSettingsPatch } from '../src/shared/settings';
import { appearancePatch, parseAppearance, resetAppearanceGroup, serializeAppearance, validateAppearanceProfiles } from '../src/shared/appearance';
import { imageRectangle, liveSceneEnabled, sceneEffect, sceneResolution, SCENE_QUALITY } from '../src/renderer/components/live-background';

test('live background contract defaults and strict validation survive appearance persistence',()=>{
 expect(DEFAULT_SETTINGS).toMatchObject({backgroundAnimation:'interactive',backgroundMotionIntensity:.4,backgroundMotionSpeed:.7,backgroundEffect:'auto',backgroundQuality:'balanced'});
 const patch={backgroundAnimation:'ambient',backgroundMotionIntensity:.8,backgroundMotionSpeed:1.4,backgroundEffect:'petals',backgroundQuality:'high'} as const;
 expect(validateSettingsPatch(patch)).toEqual(patch);
 expect(parseAppearance(serializeAppearance({...DEFAULT_SETTINGS,...patch}))).toMatchObject(patch);
 expect(validateAppearanceProfiles([{id:'live',name:'动态',settings:patch}])[0].settings).toEqual(patch);
 for(const key of Object.keys(patch) as (keyof typeof patch)[])expect(resetAppearanceGroup('background')[key]).toEqual(DEFAULT_SETTINGS[key]);
});
test('live options reject invalid data and preserve unrelated settings',()=>{
 for(const patch of [{backgroundAnimation:'live2d'},{backgroundEffect:'html'},{backgroundQuality:'ultra'},{backgroundMotionIntensity:1.01},{backgroundMotionIntensity:NaN},{backgroundMotionSpeed:.2}])expect(()=>validateSettingsPatch(patch)).toThrow();
 expect(validateSettingsPatch({backgroundMotionIntensity:9,backgroundMotionSpeed:0},true)).toEqual({backgroundMotionIntensity:1,backgroundMotionSpeed:.25});
 expect(resetAppearanceGroup('background')).not.toHaveProperty('javaPath');
 expect({...DEFAULT_SETTINGS,...resetAppearanceGroup('background')}.wallpaper).toBe('builtin:moon-lake');
});
test('scene lifecycle suppresses motion for each static condition',()=>{
 expect(liveSceneEnabled(DEFAULT_SETTINGS,false,false,false)).toBe(true);
 for(const settings of [{backgroundAnimation:'off'},{backgroundMotionIntensity:0},{backgroundStyle:'gradient'},{backgroundStyle:'solid'},{reducedMotion:true}] as const)expect(liveSceneEnabled({...DEFAULT_SETTINGS,...settings},false,false,false)).toBe(false);
 for(const flags of [[true,false,false],[false,true,false],[false,false,true]])expect(liveSceneEnabled(DEFAULT_SETTINGS,...flags as [boolean,boolean,boolean])).toBe(false);
});
test('quality budgets bound actual render resolution, not CSS layout',()=>{
 for(const quality of ['low','balanced','high'] as const){
  const [w,h]=sceneResolution(7680,4320,4,quality);expect(w*h).toBeLessThanOrEqual(SCENE_QUALITY[quality].pixels+5000);expect(w/h).toBeCloseTo(7680/4320,2);
 }
 expect(sceneResolution(960,640,2,'low')).toEqual([960,640]);
 expect(sceneResolution(100,100,1,'high')).toEqual([100,100]);
});
test('image-space crop preserves cover contain stretch and endpoint positioning',()=>{
 expect(imageRectangle(100,100,200,100,'cover',50,50)).toEqual([-.5,0,2,1]);
 expect(imageRectangle(100,100,200,100,'cover',100,0)).toEqual([-1,0,2,1]);
 expect(imageRectangle(100,100,200,100,'contain',50,100)).toEqual([0,.5,1,.5]);
 expect(imageRectangle(100,100,200,100,'stretch',0,0)).toEqual([0,0,1,1]);
});
test('automatic point effects follow painterly scene; arbitrary local photos stay conservative',()=>{
 expect(sceneEffect({...DEFAULT_SETTINGS,wallpaper:'builtin:sakura-night'})).toBe(2);
 expect(sceneEffect({...DEFAULT_SETTINGS,wallpaper:'builtin:moon-lake'})).toBe(1);
 expect(sceneEffect({...DEFAULT_SETTINGS,wallpaper:'zhumeng-wallpaper://local/photo.png'})).toBe(0);
 expect(sceneEffect({...DEFAULT_SETTINGS,backgroundEffect:'none'})).toBe(0);
});
