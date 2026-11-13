import { DEFAULT_LAUNCH, effectiveLaunchSettings, validateLaunchSettings } from "./launch-settings";
import { validateAppearanceProfiles } from './appearance';
import type { Settings } from './types';
export const DEFAULT_SETTINGS: Readonly<Settings> = Object.freeze({
  checkUpdatesOnStartup: true, updateChannel: 'preview',
  backgroundAnimation: 'interactive', backgroundMotionIntensity: 0.4, backgroundMotionSpeed: 0.7,
  backgroundEffect: 'auto', backgroundQuality: 'balanced',
  backgroundStyle: 'image', backgroundColor: '#11182e', gradientColor: '#43558a', backgroundOverlay: 0.28,
  backgroundVignette: 0.35, wallpaperSaturation: 0.9, wallpaperPositionX: 50, wallpaperPositionY: 50, wallpaperScale: 1,
  glassStyle: 'frosted', glassBorderOpacity: 0.2, glassShadow: 0.25,
  fontFamily: 'system', fontScale: 1, navWidth: 96, contentWidth: 1440, cardSpacing: 20,
  homeTitle: '让每一个世界，\n从梦开始。', homeSubtitle: '月光已至，你的下一段冒险正在等待。',
  homeTitleSize: 60, homeTextAlign: 'left', showHomeIntro: true,
  pageTransition: 'slide', notificationPosition: 'top-right', startupPage: 'home', startMaximized: false,
  notifyTaskCompletion: true, notifyTaskFailure: true, appearanceProfiles: [],
  launch: structuredClone(DEFAULT_LAUNCH),
  theme: 'system', wallpaper: 'builtin:moon-lake', wallpaperFit: 'cover', wallpaperBrightness: 0.8, wallpaperBlur: 0,
  glassOpacity: 0.65, glassBlur: 24, glassRefraction: 0.35, accentColor: '#93a8ff', cornerRadius: 20,
  density: 'comfortable', navigationLabels: true, libraryView: 'cards', openingTheme: 'dream', openingSpeed: 1,
  openingEnabled: true, particles: true, parallax: true, animationSpeed: 1, reducedMotion: false,
  javaPath: '', autoDownloadJava: true, memoryMb: 4096, javaArgs: [], gameDirectory: '', microsoftClientId: '',
});
const ranges: Partial<Record<keyof Settings, [number, number]>> = {
  backgroundMotionIntensity: [0, 1], backgroundMotionSpeed: [0.25, 2],
  backgroundOverlay: [0, 0.85], backgroundVignette: [0, 1], wallpaperSaturation: [0, 2], wallpaperPositionX: [0, 100], wallpaperPositionY: [0, 100], wallpaperScale: [1, 1.5],
  glassBorderOpacity: [0, 1], glassShadow: [0, 1], fontScale: [0.85, 1.2], navWidth: [72, 128], contentWidth: [960, 1800], cardSpacing: [12, 32], homeTitleSize: [32, 76],
  wallpaperBrightness: [0, 1], wallpaperBlur: [0, 100], glassOpacity: [0, 1], glassBlur: [0, 100], glassRefraction: [0, 1],
  cornerRadius: [0, 48], openingSpeed: [0.25, 4], animationSpeed: [0.25, 4], memoryMb: [512, 131072],
};
const choices: Partial<Record<keyof Settings, string[]>> = {
  updateChannel: ['preview','stable'],
  backgroundAnimation: ['off','ambient','interactive'], backgroundEffect: ['auto','petals','stars','none'], backgroundQuality: ['low','balanced','high'],
  backgroundStyle: ['image','gradient','solid'], glassStyle: ['frosted','clear','solid'], fontFamily: ['system','yahei','segoe'], homeTextAlign: ['left','center'], pageTransition: ['slide','fade','none'], notificationPosition: ['top-right','bottom-right'], startupPage: ['home','library','download'],
  theme: ['light', 'dark', 'system'], wallpaperFit: ['cover', 'contain', 'stretch'], density: ['compact', 'comfortable'],
  libraryView: ['cards', 'list'], openingTheme: ['dream', 'aurora', 'minimal'],
};
export function validateSettingsPatch(input: unknown, clamp = false): Partial<Settings> {
  if (!input || typeof input !== 'object' || Array.isArray(input) || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('配置必须为对象');
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (!Object.hasOwn(DEFAULT_SETTINGS, key)) throw new Error(`未知配置项: ${key}`);
    const field = key as keyof Settings;
    const range = ranges[field];
    if (field === 'appearanceProfiles') { result[key] = validateAppearanceProfiles(value); } else if (field === 'launch') { result[key] = effectiveLaunchSettings(validateLaunchSettings(value)); } else if (range) {
      if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error(`无效数字: ${key}`);
      if (!clamp && (value < range[0] || value > range[1])) throw new Error(`配置超出范围: ${key}`);
      result[key] = Math.max(range[0], Math.min(range[1], value));
    } else if (choices[field]) {
      if (typeof value !== 'string' || !choices[field]!.includes(value)) throw new Error(`无效选项: ${key}`);
      result[key] = value;
    } else if (field === 'javaArgs') {
      if (!Array.isArray(value) || value.length > 128 || value.some(v => typeof v !== 'string' || v.length > 4096 || v.includes('\0'))) throw new Error('无效 Java 参数');
      result[key] = [...value];
    } else {
      if (typeof value !== typeof DEFAULT_SETTINGS[field]) throw new Error(`无效类型: ${key}`);
      if (typeof value === 'string' && (value.length > 4096 || value.includes('\0'))) throw new Error(`文本过长或包含空字符: ${key}`);
      if ((field === 'homeTitle' || field === 'homeSubtitle') && (value as string).length > (field === 'homeTitle' ? 80 : 160)) throw new Error('首页文案过长');
      if (['accentColor','backgroundColor','gradientColor'].includes(field) && !/^#[0-9a-f]{6}$/i.test(value as string)) throw new Error('无效强调色');
      if (field === 'microsoftClientId' && value !== '' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value as string)) throw new Error('无效微软客户端 ID');
      result[key] = value;
    }
  }
  return result as Partial<Settings>;
}
