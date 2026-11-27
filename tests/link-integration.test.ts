import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {describe,it,expect} from 'vitest';
import {LinkService} from '../src/main/services/link';
const core=process.env.ZHUMENG_TEST_EASYTIER_CORE;
const cli=process.env.ZHUMENG_TEST_EASYTIER_CLI;
describe.skipIf(!core||!cli)('official EasyTier owned process integration',()=>{
 it('verifies real CLI, starts owned room, reads virtual IP, leaves and restarts without private credentials',async()=>{
 const dir=await mkdtemp(join(tmpdir(),'zm-link-'));const file=join(dir,'link.json');const service=new LinkService(file);
 try{const ready=await service.configure({corePath:core!,cliPath:cli!,peers:['tcp://127.0.0.1:9']});expect(ready.version).toContain('easytier-core');const started=await service.create();expect(started.status,started.error).toBe('connected');expect(started.invite).toMatch(/^zm-link:1:/);expect(started.node).toContain('Virtual IP');expect((await readFile(file,'utf8'))).not.toContain('networkSecret');expect((await service.leave()).status).toBe('idle');expect((await service.state()).invite).toBeUndefined();expect((await new LinkService(file).state()).status).toBe('idle');const second=service.create();await service.leave();await second;expect((await service.state()).status).toBe('idle');}finally{await service.leave();await rm(dir,{recursive:true,force:true});}
 },30000);
});
