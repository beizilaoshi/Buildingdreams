export const NAVIGATION_PAGES=['home','library','download','mods','packs','personalize','settings','about'] as const;
export type NavigationPage=typeof NAVIGATION_PAGES[number];
export function hiddenNavigation(value:unknown):NavigationPage[]{
 if(!Array.isArray(value)||value.length>NAVIGATION_PAGES.length||new Set(value).size!==value.length||value.some(v=>!NAVIGATION_PAGES.includes(v as NavigationPage)))throw Error('无效隐藏导航设置');
 return [...value] as NavigationPage[];
}
