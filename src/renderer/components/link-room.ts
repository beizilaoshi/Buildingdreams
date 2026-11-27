import {api,e,button,panel,notify} from '../ui';
import {dialog} from './dialog';
import type {LinkState} from '../../shared/link';
export async function showLink(){
 const body=e('div','stack');body.style.maxWidth='850px';
 body.append(e('p','muted','EasyTier 私密联机：创建者先在 Minecraft 中“对局域网开放”，朋友用虚拟 IP:游戏端口直连。邀请码包含网络密钥，只发送给可信朋友。关闭此面板仍保持联机，退出启动器会断开；重启后须重新加入。'));
 const setup=panel('组件与发现节点','从官方 EasyTier/EasyTier GitHub Releases 下载并解压 Windows 压缩包，保留 wintun.dll 等文件。选择你信任的可执行组件（已验证 2.6.4）。不自动下载或运行服务。');
 const core=document.createElement('input');core.setAttribute('aria-label','EasyTier core 路径');core.placeholder='easytier-core.exe 绝对路径';
 const cli=document.createElement('input');cli.setAttribute('aria-label','EasyTier CLI 路径');cli.placeholder='easytier-cli.exe 绝对路径';
 const peers=document.createElement('textarea');peers.setAttribute('aria-label','发现节点');peers.placeholder='每行一个可信节点，如 tcp://你的服务器:11010';
 const row1=e('div','row');row1.append(core,button('选择 core',async()=>{const p=await api('link.pickCore',undefined);if(p)core.value=p;}));
 const row2=e('div','row');row2.append(cli,button('选择 CLI',async()=>{const p=await api('link.pickCli',undefined);if(p)cli.value=p;}));
 const status=e('p');status.setAttribute('role','status');const details=e('pre','licenses');details.style.maxHeight='300px';details.style.overflow='auto';details.style.whiteSpace='pre-wrap';
 const invite=document.createElement('textarea');invite.setAttribute('aria-label','私密邀请码');invite.placeholder='粘贴朋友发来的 zm-link:1:… 邀请码';invite.autocomplete='off';
 const result=document.createElement('textarea');result.readOnly=true;result.setAttribute('aria-label','本房间私密邀请码');result.hidden=true;
 let closed=false;let busy=false;let revision=0;let readSequence=0;let timer:ReturnType<typeof setInterval>|undefined;let latest:LinkState={status:'idle',config:{corePath:'',cliPath:'',peers:[]}};const controls:HTMLButtonElement[]=[];
 function render(s:LinkState){if(closed)return;latest=s;status.textContent=({idle:'未联机',starting:'正在启动，可点击离开取消',connected:'本机联机组件已启动（同伴连接以列表为准）',error:'联机失败'})[s.status]+(s.virtualIp?` · 虚拟 IP ${s.virtualIp}`:'')+(s.error?` · ${s.error}`:'');details.textContent=[s.node?'本机 / NAT 状态\n'+s.node:'',s.peers?'同伴 / 延迟 / NAT\n'+s.peers:''].filter(Boolean).join('\n\n');result.value=s.invite??'';result.hidden=!s.invite;for(const b of controls)b.disabled=busy||s.status==='starting'||s.status==='connected';}
 async function action(fn:()=>Promise<LinkState>){const request=++revision;readSequence++;busy=true;render(latest);try{const state=await fn();if(request===revision)render(state);}catch(err){if(!closed&&request===revision)notify(err instanceof Error?err.message:String(err),{kind:'error'});}finally{if(request===revision){busy=false;render(latest);}}}
 const save=button('保存并验证组件',()=>action(()=>api('link.configure',{corePath:core.value.trim(),cliPath:cli.value.trim(),peers:peers.value.split(/\r?\n/).map(s=>s.trim()).filter(Boolean)}))) as HTMLButtonElement;
 const create=button('创建私密房间',()=>action(()=>api('link.create',undefined)),'primary') as HTMLButtonElement;
 const join=button('加入邀请码房间',()=>action(()=>api('link.join',{invite:invite.value.trim()})),'primary') as HTMLButtonElement;
 controls.push(save,create,join);setup.append(row1,row2,peers,save);body.append(setup,invite,create,join,button('离开 / 取消',()=>action(()=>api('link.leave',undefined))),'');
 body.append(status,button('复制虚拟 IP',async()=>{await api('link.copy',{kind:'ip'});notify('虚拟 IP 已复制',{kind:'success'});}),result,button('复制私密邀请码',async()=>{await api('link.copy',{kind:'invite'});notify('邀请码含密钥，请仅分享给可信朋友',{kind:'success'});}),details,e('p','muted','加入邀请码会连接其中指定的节点。节点由房间创建者配置；请核对来源。TUN 驱动可能需要管理员权限。没有同伴时请检查节点可达性、防火墙以及朋友是否加入同一房间。'));
 const modal=dialog('EasyTier 联机',body);modal.addEventListener('close',()=>{closed=true;clearInterval(timer);});
 const initialRevision=revision;
 try{const state=await api('link.state',undefined);if(closed)return;if(initialRevision===revision){core.value=state.config.corePath;cli.value=state.config.cliPath;peers.value=state.config.peers.join('\n');render(state);}}
 catch{if(!closed&&initialRevision===revision)render({...latest,error:'暂时无法读取联机状态，将自动重试'});}
 if(closed)return;
 timer=setInterval(async()=>{if(closed||busy)return;const request=revision;const sequence=++readSequence;try{const state=await api('link.state',undefined);if(!closed&&!busy&&request===revision&&sequence===readSequence)render(state);}catch{if(!closed&&!busy&&request===revision&&sequence===readSequence)render({...latest,error:'暂时无法读取联机状态，将自动重试'});}},2500);
}
