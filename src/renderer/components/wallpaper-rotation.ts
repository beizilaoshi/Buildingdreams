import {DEFAULT_ROTATION,nextWallpaper,type WallpaperRotation} from '../../shared/wallpaper';
let config:WallpaperRotation=structuredClone(DEFAULT_ROTATION),index=0,initialized=false,timer:ReturnType<typeof setTimeout>|undefined,paint=()=>{},baseImage=true;
export function rotationWallpaper(base:string){return config.enabled&&config.images.length?config.images[index]||config.images[0]:base;}
function suspended(){return document.hidden||!!document.querySelector('.launch-snake[open]')||document.documentElement.classList.contains('opening-active')||!baseImage;}
function schedule(){clearTimeout(timer);if(config.enabled&&!config.paused&&config.images.length>1&&!suspended())timer=setTimeout(()=>{nextRotation();},config.intervalSeconds*1000);}
export function nextRotation(){if(config.images.length){index=nextWallpaper(config.images.length,index,config.order);paint();}schedule();}
export function acceptRotation(next:WallpaperRotation){const changed=next.images.join()!==config.images.join();config=next;if(changed)index=0;paint();schedule();window.dispatchEvent(new CustomEvent('wallpaper-rotation',{detail:config}));}
export function rotationState(){return config;}
export function bindRotation(render:()=>void,image:boolean){paint=render;const changed=baseImage!==image;baseImage=image;if(initialized){if(changed)schedule();return;}initialized=true;document.addEventListener('visibilitychange',schedule);new MutationObserver(schedule).observe(document.documentElement,{subtree:true,attributes:true,attributeFilter:['open','class']});void window.launcher.invoke('wallpaper.rotation',undefined).then(next=>{config=next;if(next.startupRandom&&next.images.length)index=Math.floor(Math.random()*next.images.length);paint();schedule();}).catch(()=>{});}
