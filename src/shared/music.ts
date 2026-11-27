export interface MusicPreferences { volume:number; random:boolean; autoPlay:boolean; pauseDuringGame:boolean; }
export interface MusicTrack { id:string; name:string; url:string; }
export interface MusicSnapshot { preferences:MusicPreferences; tracks:MusicTrack[]; }
export interface MusicCommandMap {
 'music.read':{payload:undefined;result:MusicSnapshot};
 'music.patch':{payload:Partial<MusicPreferences>;result:MusicSnapshot};
 'music.addFiles':{payload:undefined;result:MusicSnapshot};
 'music.addFolder':{payload:undefined;result:MusicSnapshot};
 'music.remove':{payload:string;result:MusicSnapshot};
 'music.clear':{payload:undefined;result:MusicSnapshot};
}
export const DEFAULT_MUSIC:MusicPreferences={volume:0.4,random:false,autoPlay:false,pauseDuringGame:true};
export function validateMusicPatch(value:unknown):Partial<MusicPreferences>{
 if(!value||typeof value!=='object'||Array.isArray(value))throw Error('无效音乐设置');
 const result:Partial<MusicPreferences>={};
 for(const [key,v] of Object.entries(value)){if(key==='volume'){if(typeof v!=='number'||!Number.isFinite(v)||v<0||v>1)throw Error('音量须介于 0–1');result.volume=v;}else if(key==='random'||key==='autoPlay'||key==='pauseDuringGame'){if(typeof v!=='boolean')throw Error('无效音乐开关');result[key]=v;}else throw Error('未知音乐设置');}return result;
}
