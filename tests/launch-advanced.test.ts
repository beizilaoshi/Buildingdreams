import { expect, it } from 'vitest';
import { automaticMemory, javaSelectionMemory, launchMemory, renderWindowTitle, launcherLifecycleAction } from '../src/main/services/launch-advanced';
import { effectiveLaunchSettings } from '../src/shared/launch-settings';
it('bounds automatic memory by free, physical and 32-bit Java', () => {
 expect(automaticMemory({ totalMb: 16384, freeMb: 8192, arch: 'amd64', minecraft: '1.21', modded: true })).toBe(6144);
 expect(automaticMemory({ totalMb: 16384, freeMb: 8192, arch: 'x86', minecraft: '1.21', modded: true })).toBe(1024);
 expect(automaticMemory({ totalMb: 2048, freeMb: 800, arch: 'amd64', minecraft: '1.21', modded: true })).toBe(512);
});
it('keeps a 32-bit Java candidate eligible during automatic memory selection', () => {
 const preferences=effectiveLaunchSettings({memoryMode:'auto'});
 const budget=launchMemory(4096,preferences,{totalMb:16384,freeMb:8192,arch:'amd64',minecraft:'1.16.5',modded:false});
 expect(budget).toBe(2048);
 expect(javaSelectionMemory(budget,preferences)).toBe(1024);
 expect(launchMemory(budget,preferences,{totalMb:16384,freeMb:8192,arch:'x86',minecraft:'1.16.5',modded:false})).toBe(1024);
 expect(javaSelectionMemory(4096,effectiveLaunchSettings({memoryMode:'fixed'}))).toBe(4096);
});
it('uses live global settings when instance inherits memory', () => {
 const machine = {totalMb:16384,freeMb:8192,arch:'amd64',minecraft:'1.21',modded:false};
 expect(launchMemory(2048,effectiveLaunchSettings({memoryMode:'global'}),machine,3072)).toBe(3072);
 expect(launchMemory(2048,effectiveLaunchSettings({memoryMode:'global'}),machine,5120)).toBe(5120);
 expect(launchMemory(2048,effectiveLaunchSettings(),machine,5120)).toBe(2048);
});
it('substitutes supported titles literally, without recursive expansion', () => {
 expect(renderWindowTitle('{player} / {version} / {unknown}',{player:"$(evil) {version}",version:'1.21',instance:'I'})).toBe('$(evil) {version} / 1.21 / {unknown}');
});
it('only exits for an owned ready game at the configured event', () => {
 expect(launcherLifecycleAction('exitOnGameEnd','end',false,true)).toBeUndefined();
 expect(launcherLifecycleAction('exitOnGameEnd','end',true,false)).toBeUndefined();
 expect(launcherLifecycleAction('exitOnGameEnd','end',true,true)).toBe('exit');
});
