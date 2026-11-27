import {noPayload,type CommandRouter} from './ipc';
import {validateLinkConfig} from '../shared/link';
import {LinkService} from './services/link';
export function registerLinkCommands(router:CommandRouter,service:LinkService,deps:{chooseBinary:()=>Promise<string|null>;copy:(text:string)=>void}){
 router.register('link.state',noPayload,()=>service.state());
 router.register('link.configure',validateLinkConfig,c=>service.configure(c));
 router.register('link.pickCore',noPayload,()=>deps.chooseBinary());
 router.register('link.pickCli',noPayload,()=>deps.chooseBinary());
 router.register('link.create',noPayload,()=>service.create());
 router.register('link.join',v=>{if(!v||typeof v!=='object'||typeof (v as {invite?:unknown}).invite!=='string'||(v as {invite:string}).invite.length>8192)throw Error('无效邀请码');return {invite:(v as {invite:string}).invite};},v=>service.join(v.invite));
 router.register('link.leave',noPayload,()=>service.leave());
 router.register('link.copy',v=>{if(!v||typeof v!=='object'||!['ip','invite'].includes((v as {kind:string}).kind))throw Error('无效复制目标');return {kind:(v as {kind:'ip'|'invite'}).kind};},async v=>{deps.copy(await service.copyValue(v.kind));});
}
