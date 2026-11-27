export interface LinkConfig {corePath:string;cliPath:string;peers:string[]}
export interface LinkRoom {networkName:string;networkSecret:string;peers:string[]}
export interface LinkState {status:'idle'|'starting'|'connected'|'error';config:LinkConfig;version?:string;invite?:string;networkName?:string;virtualIp?:string;node?:string;peers?:string;error?:string}
export interface LinkCommandMap {
 'link.state':{payload:undefined;result:LinkState};
 'link.configure':{payload:LinkConfig;result:LinkState};
 'link.pickCore':{payload:undefined;result:string|null};
 'link.pickCli':{payload:undefined;result:string|null};
 'link.create':{payload:undefined;result:LinkState};
 'link.join':{payload:{invite:string};result:LinkState};
 'link.leave':{payload:undefined;result:LinkState};
 'link.copy':{payload:{kind:'ip'|'invite'};result:void};
}
export function validatePeers(value:unknown):string[]{
 if(!Array.isArray(value)||value.length>16)throw Error('最多配置 16 个节点');
 return value.map(p=>{if(typeof p!=='string'||p.length>256)throw Error('无效节点');let u:URL;try{u=new URL(p);}catch{throw Error('节点须为 tcp://主机:端口 或 udp://主机:端口');}if(!['tcp:','udp:','ws:','wss:','quic:'].includes(u.protocol)||!u.hostname||!u.port||u.username||u.password||u.search||u.hash||!['','/'].includes(u.pathname))throw Error('无效节点地址');return p;});
}
export function validateLinkConfig(v:unknown):LinkConfig{
 if(!v||typeof v!=='object'||Array.isArray(v))throw Error('无效组件配置');const c=v as LinkConfig;
 for(const p of [c.corePath,c.cliPath])if(typeof p!=='string'||p.length>2048||!(/^[A-Za-z]:[\\/]/.test(p)||p.startsWith('/'))||/[\x00-\x1f]/.test(p)||(/\.(cmd|bat|ps1)$/i.test(p)))throw Error('请选择可信组件的绝对可执行路径');
 return {corePath:c.corePath,cliPath:c.cliPath,peers:validatePeers(c.peers)};
}
function validateRoom(v:unknown):LinkRoom {if(!v||typeof v!=='object')throw Error('无效邀请码');const r=v as LinkRoom;if(typeof r.networkName!=='string'||!/^zm-[a-zA-Z0-9-]{4,80}$/.test(r.networkName)||typeof r.networkSecret!=='string'||! /^[a-zA-Z0-9_-]{16,128}$/.test(r.networkSecret))throw Error('无效房间凭据');return {networkName:r.networkName,networkSecret:r.networkSecret,peers:validatePeers(r.peers)};}
export function encodeInvite(room:LinkRoom):string{return 'zm-link:1:'+btoa(JSON.stringify(validateRoom(room)));}
export function decodeInvite(value:string):LinkRoom {if(typeof value!=='string'||value.length>8192||!value.startsWith('zm-link:1:'))throw Error('无效或不支持的邀请码');try{return validateRoom(JSON.parse(atob(value.slice(10))));}catch{throw Error('邀请码损坏或格式无效');}}
