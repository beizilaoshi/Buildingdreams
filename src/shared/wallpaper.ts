export interface WallpaperRotation {enabled:boolean;order:'sequence'|'random';intervalSeconds:number;startupRandom:boolean;paused:boolean;images:string[];}
export const DEFAULT_ROTATION:WallpaperRotation={enabled:false,order:'sequence',intervalSeconds:60,startupRandom:false,paused:false,images:[]};
export type RotationPatch=Partial<Omit<WallpaperRotation,'images'>>;
export function validateRotation(value:unknown):RotationPatch{if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效轮换设置');const out:RotationPatch={};for(const [k,v] of Object.entries(value)){if(['enabled','startupRandom','paused'].includes(k)){if(typeof v!=='boolean')throw Error('无效开关');(out as any)[k]=v;}else if(k==='order'){if(v!=='sequence'&&v!=='random')throw Error('无效顺序');out.order=v;}else if(k==='intervalSeconds'){if(typeof v!=='number'||!Number.isInteger(v)||v<10||v>86400)throw Error('间隔需为10–86400秒');out.intervalSeconds=v;}else throw Error('未知轮换设置');}return out;}
export function nextWallpaper(count:number,current:number,order:'sequence'|'random',random= Math.random):number {if(count<2)return 0;if(order==='sequence')return (current+1)%count;return (current+1+Math.floor(random()*(count-1)))%count;}
export interface WallpaperCommandMap {
 'wallpaper.rotation':{payload:undefined;result:WallpaperRotation};
 'wallpaper.configure':{payload:RotationPatch;result:WallpaperRotation};
 'wallpaper.select':{payload:'files'|'folder';result:WallpaperRotation|null};
 'wallpaper.clear':{payload:undefined;result:WallpaperRotation};
 'wallpaper.titleImage':{payload:undefined;result:string|null};
}
