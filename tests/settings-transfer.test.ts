import { test, expect } from 'vitest';
import type { Settings } from '../src/shared/types';
import { DEFAULT_SETTINGS } from '../src/shared/settings';
import { serializeSettingsTransfer, parseSettingsTransfer } from '../src/shared/settings-transfer';
test('portable backup removes local paths, commands, custom arguments and client configuration recursively',()=>{
 const settings:Settings=structuredClone(DEFAULT_SETTINGS);settings.javaPath='C:/private/java.exe';settings.gameDirectory='D:/private';settings.microsoftClientId='11111111-1111-1111-1111-111111111111';settings.javaArgs=['secret'];settings.wallpaper='zhumeng-wallpaper://local/private.png';settings.launch.preCommand='secret';settings.launch.gameArgs=['secret'];settings.launch.serverHost='private.example';settings.appearanceProfiles=[{id:'a',name:'方案',settings:{wallpaper:'zhumeng-wallpaper://local/private.png'}}];
 const text=serializeSettingsTransfer(settings);expect(text).not.toMatch(/private|secret|11111111/);const parsed=parseSettingsTransfer(text);expect(parsed.settings.memoryMb).toBe(4096);expect(parsed.settings.launch).not.toHaveProperty('preCommand');expect(parsed.settings).not.toHaveProperty('javaPath');
});
test('strict schema refuses unknown, sensitive, nonportable and invalid settings without clamping',()=>{
 for(const value of [{version:2,settings:{}},{version:1,settings:{javaPath:'x'}},{version:1,settings:{memoryMb:1}},{version:1,settings:{wallpaper:'https://evil/a'}},{version:1,settings:{launch:{preCommand:'run'}}},{version:1,settings:{},token:'secret'}])expect(()=>parseSettingsTransfer(JSON.stringify(value))).toThrow();
 expect(()=>parseSettingsTransfer('x'.repeat(262145))).toThrow();
});
