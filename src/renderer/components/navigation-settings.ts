import {api,state,panel,e,input,field,button} from '../ui';
import {NAVIGATION_PAGES} from '../../shared/navigation';
const labels=['首页','游戏库','下载','模组','整合包','个性化','设置','关于'];
export function navigationSettingsCard():HTMLElement{
 const card=panel('导航与标题栏','可隐藏任意导航入口；按 F12 临时显示全部，再按一次恢复。隐藏入口不会停用对应功能。');
 const title=input(state.settings.titleText);title.maxLength=60;
 const imageHeight=input(String(state.settings.titleImageHeight));imageHeight.type='number';imageHeight.min='16';imageHeight.max='32';
 const imageActions=e('div');imageActions.append(button('选择标题图片',async()=>{const image=await api('wallpaper.titleImage',undefined);if(image)await api('settings.patch',{titleImage:image});},'quiet'),button('移除标题图片',()=>api('settings.patch',{titleImage:''}),'quiet'));
 const options=e('div','form-grid'),controls:HTMLInputElement[]=[];
 NAVIGATION_PAGES.forEach((page,i)=>{const control=input();control.type='checkbox';control.checked=state.settings.navigationHidden.includes(page);controls.push(control);options.append(field('隐藏'+labels[i],control));});
 card.append(field('标题栏文字',title),field('标题图片高度（16–32像素）',imageHeight),imageActions,options,button('保存导航与标题',async()=>{await api('settings.patch',{titleText:title.value,titleImageHeight:Number(imageHeight.value),navigationHidden:NAVIGATION_PAGES.filter((_,i)=>controls[i].checked)});},'primary'),button('恢复全部入口',async()=>{await api('settings.patch',{navigationHidden:[]});controls.forEach(c=>c.checked=false);},'quiet'));
 return card;
}
