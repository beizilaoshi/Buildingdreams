import { wallpaperRotationPanel } from '../components/wallpaper-rotation-panel';
import { musicPanel } from "../components/music-panel";
import { choice } from "../components/choice";
import { api, state, e, button, heading, panel, field, input, notify, pendingAppearanceSettings as dirty } from "../ui";
import { applySettings } from "../components/glass";
import { playOpening } from "../components/opening";
import type { Settings } from "../../shared/types";
import { APPEARANCE_GROUPS, APPEARANCE_PRESETS, appearancePatch, resetAppearanceGroup } from "../../shared/appearance";

// Keep writes ordered even when navigation replaces the workbench mid-save.
let writes = Promise.resolve();
let revision = 0;
let pending = 0;
let saveFailed = false;
let updateSaveState = () => {};
function saveAppearance(patch: Partial<Settings>) {
  const version = ++revision;
  for (const key of Object.keys(patch) as (keyof Settings)[]) dirty.set(key, { value: patch[key], version });
  pending++;
  state.settings = { ...state.settings, ...patch };
  applySettings(state.settings);
  const result = writes.then(async () => {
    const snapshot = new Map(dirty);
    try {
      const saved = await api("settings.patch", Object.fromEntries([...snapshot].map(([key, entry]) => [key, entry.value])));
      for (const [key, entry] of snapshot) if (dirty.get(key)?.version === entry.version) dirty.delete(key);
      state.settings = { ...saved, ...Object.fromEntries([...dirty].map(([key, entry]) => [key, entry.value])) };
      saveFailed = false;
      applySettings(state.settings);
    } catch (error) {
      saveFailed = true;
      throw error;
    } finally {
      pending--;
      updateSaveState();
    }
  });
  writes = result.catch(() => {});
  return result;
}
export function personalize() {
  const node = e("div", "customization-workbench");
  node.append(heading("个性化", "从一片梦中风景开始，打造属于你的筑梦。修改即时预览并自动保存。"));
  const toolbar = e("div", "customization-toolbar");
  const search = input("", "搜索背景、玻璃、排版或动效…"); search.type = "search"; search.setAttribute("aria-label", "搜索个性化设置");
  const status = e("span", "muted customization-status"); status.setAttribute("role", "status");
  const retry = button("重试保存", () => save({}), "quiet");
  toolbar.append(search, status, retry); node.append(toolbar);
  const anchors = e("nav", "customization-anchors"); anchors.setAttribute("aria-label", "个性化分类"); node.append(anchors);
  const sections: HTMLElement[] = [];
  const updates: (() => void)[] = [];
  const sync = () => updates.forEach(fn => fn());
  const save = async (patch: Partial<Settings>) => {
    const promise = saveAppearance(patch); updateSaveState(); sync();
    try { await promise; }
    catch (error) { notify(error); }
  };
  const section = (id: string, title: string, group?: keyof typeof APPEARANCE_GROUPS) => {
    const card = panel(""); card.firstElementChild?.remove(); card.id = `customization-${id}`;
    const head = e("div", "customization-section-head"); head.append(e("h2", "", title));
    if (group) head.append(button("重置本组", () => save(resetAppearanceGroup(group)), "quiet"));
    card.append(head); sections.push(card); node.append(card);
    anchors.append(button(title, () => { search.value = ""; filter(); card.scrollIntoView({ behavior: document.documentElement.dataset.motion === "reduced" ? "instant" : "smooth", block: "start" }); }, "quiet"));
    return card;
  };
  const filter = () => {
    const query = search.value.toLowerCase().trim();
    for (const card of sections) card.hidden = !!query && !card.textContent?.toLowerCase().includes(query);
    empty.hidden = sections.some(card => !card.hidden);
  };
  search.oninput = filter;
  const grid = (card: HTMLElement) => { const g = e("div", "form-grid"); card.append(g); return g; };
  const choices = (g: HTMLElement, key: keyof Settings, label: string, options: [string,string][]) => {
    const control = choice(options, String(state.settings[key])); control.dataset.setting = key;
    control.onchange = () => void save({ [key]: control.value });
    updates.push(() => { control.value = String(state.settings[key]); }); g.append(field(label, control));
  };
  const range = (g: HTMLElement, key: keyof Settings, label: string, min: number, max: number, step: number, unit = "") => {
    const wrap = e("div", "range-control"); const slider = input(), number = input();
    slider.type = "range"; number.type = "number";
    for (const c of [slider,number]) { c.min=String(min); c.max=String(max); c.step=String(step); c.dataset.setting=key; c.setAttribute("aria-label", label + (c === number ? "数值" : "")); }
    const update = () => { slider.value = number.value = String(state.settings[key]); }; updates.push(update); update();
    const changed = (c: HTMLInputElement) => { const value = Number(c.value); if (c.value === "" || !Number.isFinite(value) || value<min || value>max) return; void save({ [key]: value }); };
    slider.oninput = () => changed(slider); number.onchange = () => changed(number);
    wrap.append(slider, number); if(unit) wrap.append(e("span", "muted", unit)); g.append(field(label,wrap));
  };
  const check = (g: HTMLElement, key: keyof Settings, label: string) => {
    const control = input(); control.type="checkbox"; control.dataset.setting=key;
    control.onchange=()=>void save({[key]:control.checked}); updates.push(()=>{control.checked=Boolean(state.settings[key]);}); control.checked=Boolean(state.settings[key]); g.append(field(label,control));
  };
  const color = (g: HTMLElement, key: keyof Settings, label: string) => {
    const wrap=e("div","color-picker"), wheel=e("div","color-wheel"), plane=e("div","color-plane"), marker=e("span","color-plane-marker");
    const hue=input(), code=input(); hue.type="range"; hue.min="0"; hue.max="359"; hue.step="1"; hue.dataset.setting=key; hue.dataset.colorChannel="hue";
    code.maxLength=7; code.dataset.setting=key; code.dataset.colorChannel="hex"; code.setAttribute("aria-label",label+"十六进制色值");
    wheel.dataset.colorWheel=String(key); plane.setAttribute("role","slider"); plane.setAttribute("tabindex","0"); plane.setAttribute("aria-label",label+"饱和度和明度");
    wheel.append(plane,marker); wrap.append(wheel,hue,code); const colorField=e("div","field"); colorField.append(e("span","field-label",label),wrap); g.append(colorField);
    let currentHue=220, saturation=.38, lightness=.68;
    const rgbToHsl=(hex:string)=>{const r=parseInt(hex.slice(1,3),16)/255,gg=parseInt(hex.slice(3,5),16)/255,b=parseInt(hex.slice(5,7),16)/255,max=Math.max(r,gg,b),min=Math.min(r,gg,b),d=max-min;let h=0,s=0,l=(max+min)/2;if(d){s=d/(1-Math.abs(2*l-1));switch(max){case r:h=((gg-b)/d)%6;break;case gg:h=(b-r)/d+2;break;default:h=(r-gg)/d+4;}h*=60;if(h<0)h+=360;}return [h,s,l] as const;};
    const toHex=(h:number,s:number,l:number)=>{const c=(1-Math.abs(2*l-1))*s,x=c*(1-Math.abs((h/60)%2-1)),m=l-c/2;const [r,gg,b]=h<60?[c,x,0]:h<120?[x,c,0]:h<180?[0,c,x]:h<240?[0,x,c]:h<300?[x,0,c]:[c,0,x];return "#"+[r,gg,b].map(v=>Math.round((v+m)*255).toString(16).padStart(2,"0")).join("");};
    const update=()=>{const value=String(state.settings[key]);code.value=value;[currentHue,saturation,lightness]=rgbToHsl(value);hue.value=String(Math.round(currentHue));plane.style.setProperty("--wheel-hue",String(currentHue));marker.style.left=`${saturation*100}%`;marker.style.top=`${(1-lightness)*100}%`;};
    updates.push(update); update();
    const commit=()=>{const value=toHex(currentHue,saturation,lightness);code.value=value;void save({[key]:value});};
    hue.setAttribute("aria-label",label+"色相"); hue.oninput=()=>{currentHue=Number(hue.value);plane.style.setProperty("--wheel-hue",String(currentHue));commit();};
    const move=(event:PointerEvent)=>{const rect=plane.getBoundingClientRect();saturation=Math.min(1,Math.max(0,(event.clientX-rect.left)/rect.width));lightness=1-Math.min(1,Math.max(0,(event.clientY-rect.top)/rect.height));marker.style.left=`${saturation*100}%`;marker.style.top=`${(1-lightness)*100}%`;commit();};
    plane.onpointerdown=event=>{plane.setPointerCapture(event.pointerId);move(event);}; plane.onpointermove=event=>{if(plane.hasPointerCapture(event.pointerId))move(event);};
    plane.onkeydown=event=>{const step=event.shiftKey?.1:.02;if(event.key==="ArrowLeft")saturation=Math.max(0,saturation-step);else if(event.key==="ArrowRight")saturation=Math.min(1,saturation+step);else if(event.key==="ArrowUp")lightness=Math.min(1,lightness+step);else if(event.key==="ArrowDown")lightness=Math.max(0,lightness-step);else return;event.preventDefault();marker.style.left=`${saturation*100}%`;marker.style.top=`${(1-lightness)*100}%`;commit();};
    code.onchange=()=>{if(/^#[\da-f]{6}$/i.test(code.value)){[currentHue,saturation,lightness]=rgbToHsl(code.value);void save({[key]:code.value.toLowerCase()});}else update();};
  };
  const presets=section("presets","01 · 风格方案"), presetGrid=e("div","customization-presets");
  for(const preset of APPEARANCE_PRESETS) { const b=button("",()=>save(preset.settings),"customization-preset"); b.append(e("strong","",preset.name),e("p","muted",preset.description)); presetGrid.append(b); }
  presets.append(presetGrid,e("p","muted","方案是可继续细调的起点；不会更改账号、Java 或游戏配置。"));
  const background=section("background","02 · 背景与风景","background"), bg=grid(background);
  choices(bg,"backgroundStyle","背景模式",[["image","图片"],["gradient","渐变"],["solid","纯色"]]);
  choices(bg,"wallpaperFit","图片填充",[["cover","填满"],["contain","完整"],["stretch","拉伸"]]);
  choices(bg,"backgroundAnimation","动态背景",[["off","静态"],["ambient","环境动态"],["interactive","交互动态"]]);
  choices(bg,"backgroundEffect","氛围点缀",[["auto","随风景"],["petals","飘落花瓣"],["stars","微光星点"],["none","无点缀"]]);
  range(bg,"backgroundMotionIntensity","动态强度",0,1,.01);
  range(bg,"backgroundMotionSpeed","动态速度",.25,2,.05);
  choices(bg,"backgroundQuality","动态画质",[["low","节能 · 24 帧"],["balanced","均衡 · 30 帧"],["high","细腻 · 45 帧"]]);
  background.append(e("p","muted","让天空、湖面与前景轻轻流动；交互动态会跟随鼠标。减少动态效果、窗口隐藏或纯色/渐变背景时自动静止。设备不支持时保留静态风景。"));
  const gallery=e("div","wallpaper-gallery");
  for(const [id,title,file] of [["moon-lake","月映湖","moonlake"],["sakura-night","樱庭星夜","wallpapers/sakura-night"],["cloud-dawn","云海晨光","wallpapers/cloud-dawn"],["voxel-twilight","方块黄昏","wallpapers/voxel-twilight"],["voxel-dawn","方块晨曦","wallpapers/voxel-dawn"],["aurora","极光","aurora"],["garden","花园","garden"],["dunes","沙丘","dunes"],["bloom-light","晨光","bloom-light"],["bloom-dark","暮色","bloom-dark"]]) {
    const b=button(title,()=>save({wallpaper:`builtin:${id}`,backgroundStyle:"image"}),"wallpaper-choice"); b.dataset.wallpaper=`builtin:${id}`; b.style.backgroundImage=`linear-gradient(transparent,#101628cc),url("./assets/${file}.png")`; updates.push(()=>b.setAttribute("aria-pressed",String(state.settings.wallpaper===`builtin:${id}`))); gallery.append(b);
  }
  background.append(gallery,button("选择本地图片",async()=>{const path=await api("dialog.choose","wallpaper"); if(path) await save({wallpaper:path,backgroundStyle:"image"});},"quiet"));
  background.append(wallpaperRotationPanel());
  const bgFine=grid(background); color(bgFine,"backgroundColor","底色 / 渐变起点"); color(bgFine,"gradientColor","渐变终点");
  check(bgFine,"gradientAnimation","动态渐变颜色"); range(bgFine,"gradientSpeed","渐变流动速度",.25,4,.25);
  for(const [key,label,min,max,step] of [["wallpaperBrightness","图片亮度",0,1,.01],["wallpaperBlur","图片模糊",0,100,1],["wallpaperSaturation","图片饱和度",0,2,.01],["backgroundOverlay","暗色遮罩",0,.85,.01],["backgroundVignette","边缘暗角",0,1,.01],["wallpaperScale","图片缩放",1,1.5,.01],["wallpaperPositionX","图片水平位置",0,100,1],["wallpaperPositionY","图片垂直位置",0,100,1]] as const) range(bgFine,key,label,min,max,step);
  const material=grid(section("material","03 · 玻璃与颜色","material"));
  choices(material,"theme","主题",[["dark","深色"],["light","浅色"],["system","跟随系统"]]); choices(material,"glassStyle","卡片材质",[["frosted","磨砂玻璃"],["clear","清透玻璃"],["solid","实色"]]); color(material,"accentColor","强调色");
  for(const [key,label,min,max,step] of [["glassOpacity","卡片不透明度",0,1,.01],["glassBlur","玻璃模糊",0,100,1],["glassRefraction","玻璃折射",0,1,.01],["glassBorderOpacity","边框亮度",0,1,.01],["glassShadow","卡片阴影",0,1,.01],["cornerRadius","卡片圆角",0,48,1]] as const) range(material,key,label,min,max,step);
  const layout=grid(section("layout","04 · 排版与布局","layout"));
  choices(layout,"fontFamily","界面字体",[["system","系统字体"],["yahei","微软雅黑"],["segoe","Segoe UI"]]); choices(layout,"density","卡片密度",[["comfortable","舒适"],["compact","紧凑"]]);
  choices(layout,"libraryView","游戏库布局",[["cards","卡片"],["list","列表"]]);
  range(layout,"fontScale","文字缩放",.85,1.2,.01); range(layout,"navWidth","导航宽度",72,128,1,"px"); range(layout,"contentWidth","内容最大宽度",960,1800,10,"px"); range(layout,"cardSpacing","卡片间距",12,32,1,"px"); check(layout,"navigationLabels","显示导航文字");
  const home=grid(section("home","05 · 首页文案","home"));
  check(home,"rainbowText","彩虹标题文字（标题与品牌）");
  for(const [key,label,max] of [["homeTitle","首页标题",80],["homeSubtitle","首页副标题",160]] as const) { const text=document.createElement("textarea");text.maxLength=max;text.value=state.settings[key];text.dataset.setting=key;text.oninput=()=>void save({[key]:text.value});updates.push(()=>{if(text.value!==state.settings[key])text.value=state.settings[key];}); home.append(field(`${label}（最多 ${max} 字）`,text)); }
  range(home,"homeTitleSize","标题字号",32,76,1,"px"); choices(home,"homeTextAlign","标题对齐",[["left","左对齐"],["center","居中"]]); check(home,"showHomeIntro","显示首页引言");
  const motionCard=section("motion","06 · 动效与通知","motion"),motion=grid(motionCard);
  choices(motion,"pageTransition","页面切换",[["slide","滑入"],["fade","淡入"],["none","无动画"]]); choices(motion,"notificationPosition","通知位置",[["top-right","右上角"],["bottom-right","右下角"]]); choices(motion,"openingTheme","开场主题",[["dream","月光凝梦"],["aurora","流光极夜"],["minimal","极简"]]); range(motion,"openingSpeed","开场速度",.25,4,.25); range(motion,"animationSpeed","界面动画速度",.25,4,.25); check(motion,"openingEnabled","启用开场"); check(motion,"particles","粒子效果"); check(motion,"parallax","鼠标光影"); check(motion,"reducedMotion","减少动态效果"); motionCard.append(button("预览开场",()=>playOpening({...state.settings,openingEnabled:true}),"quiet"));
  const profiles=section("profiles","07 · 我的方案与备份");
  profiles.append(e("p","muted","最多保存 24 个个人方案。JSON 仅包含外观设置；本地照片需在其他设备重新选择。"));
  const profileTools=e("div","customization-profile-tools"),name=input("","新方案名称");name.maxLength=40; name.setAttribute("aria-label","新方案名称");
  const list=e("div","customization-profiles");
  const renderProfiles=()=>{
    list.replaceChildren();
    for(const profile of state.settings.appearanceProfiles) {
      const row=e("div","customization-profile"), rename=input(profile.name); rename.maxLength=40;rename.setAttribute("aria-label",`重命名方案 ${profile.name}`);
      rename.onchange=()=>{const title=rename.value.trim();if(!title){rename.value=profile.name;return;} void save({appearanceProfiles:state.settings.appearanceProfiles.map(p=>p.id===profile.id?{...p,name:title}:p)});};
      row.append(rename,button("应用",()=>save(profile.settings),"quiet"),button("更新",()=>save({appearanceProfiles:state.settings.appearanceProfiles.map(p=>p.id===profile.id?{...p,settings:appearancePatch(state.settings)}:p)}),"quiet"),button("删除",()=>save({appearanceProfiles:state.settings.appearanceProfiles.filter(p=>p.id!==profile.id)}),"quiet"));list.append(row);
    }
  };
  let profilesSnapshot=""; updates.push(()=>{const next=JSON.stringify(state.settings.appearanceProfiles);if(next!==profilesSnapshot){profilesSnapshot=next;renderProfiles();}});
  profileTools.append(name,button("保存为新方案",async()=>{const title=name.value.trim();if(!title){name.focus();return;}if(state.settings.appearanceProfiles.length>=24){notify("最多保存 24 个方案，请先删除一个。");return;}await save({appearanceProfiles:[...state.settings.appearanceProfiles,{id:crypto.randomUUID(),name:title,settings:appearancePatch(state.settings)}]});name.value="";},"primary"));
  const preview=e("div","customization-import-preview");preview.hidden=true;
  profileTools.append(button("导出外观 JSON",async()=>{await writes;if(dirty.size || saveFailed)throw Error("外观尚未保存，请先重试保存后再导出。");const path=await api("appearance.export",undefined);if(path)notify("外观方案已导出");},"quiet"),button("导入外观 JSON",async()=>{const patch=await api("appearance.import",undefined);if(!patch)return;preview.replaceChildren(e("p","",`已校验 ${Object.keys(patch).length} 项外观设置，应用后会自动保存。`),button("应用导入方案",async()=>{await save(patch);preview.hidden=true;},"primary"),button("取消",()=>{preview.hidden=true;},"quiet"));preview.hidden=false;},"quiet"),button("恢复全部默认外观",()=>save(resetAppearanceGroup("all")),"quiet"));
  profiles.append(profileTools,preview,list);
  const empty=e("p","muted","没有匹配的设置，试试其他关键词。"); empty.hidden=true;node.append(empty);updateSaveState=()=>{status.textContent=pending?"正在保存…":saveFailed||dirty.size?"保存失败，尚未保存":"已自动保存";retry.hidden=!saveFailed;sync();};updateSaveState();
  node.append(musicPanel());
  return node;
}
