import {e,button,panel,field,notify} from '../ui';
import {getMusicController} from './music';
export function musicPanel(){
 const controller=getMusicController();const card=panel('背景音乐');card.dataset.musicPanel='true';
 const status=e('p','muted');status.setAttribute('role','status');const actions=e('div','row wrap');
 const play=button('播放',async()=>{if(controller.playing)controller.pause();else await controller.play();},'quiet');
 actions.append(play,button('下一首',()=>controller.next(),'quiet'),button('添加音乐',()=>controller.change('music.addFiles'),'quiet'),button('添加文件夹',()=>controller.change('music.addFolder'),'quiet'),button('清空列表',()=>controller.change('music.clear'),'quiet'));
 const volume=document.createElement('input');volume.type='range';volume.min='0';volume.max='100';volume.step='1';volume.setAttribute('aria-label','背景音乐音量');volume.addEventListener('input',()=>{controller.audio.volume=Number(volume.value)/100;});volume.addEventListener('change',()=>{void controller.patch({volume:Number(volume.value)/100}).catch(notify);});card.append(status,actions,field('背景音乐音量',volume));
 const toggles=new Map<string,HTMLInputElement>();for(const [key,title] of [['random','随机播放（每轮不重复）'],['autoPlay','启动时自动播放'],['pauseDuringGame','游戏启动时暂停，结束后恢复']] as const){const input=document.createElement('input');input.type='checkbox';input.addEventListener('change',()=>{void controller.patch({[key]:input.checked}).catch(notify);});toggles.set(key,input);card.append(field(title,input));}
 const list=e('div','stack');card.append(e('p','muted','支持 MP3、WAV、FLAC、OGG、M4A、AAC、OPUS；每首最多 64 MiB，列表最多 300 首。文件夹只读取当前层。'),list);
 const paint=()=>{status.textContent=(controller.snapshot.tracks.find(t=>t.id===controller.currentId)?.name??'尚未选择音乐')+' · '+(controller.pausedForGame?'游戏期间暂停':controller.playing?'正在播放':'已暂停')+(controller.message?' · '+controller.message:'');play.textContent=controller.playing?'暂停':'播放';volume.value=String(Math.round(controller.snapshot.preferences.volume*100));for(const [key,input]of toggles)input.checked=controller.snapshot.preferences[key as 'random'];list.replaceChildren();for(const track of controller.snapshot.tracks){const row=e('div','row');row.append(e('span','',track.name),button('移除',()=>controller.change('music.remove',track.id),'quiet'));list.append(row);}};
 // Mounted cards receive DOM events; no persistent callback retains detached views.
 card.addEventListener('music-refresh',paint);paint();void controller.initialize().then(paint).catch(notify);return card;
}
