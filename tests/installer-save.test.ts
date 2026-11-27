import { describe, it, expect, vi } from 'vitest';
import { InstallerSaveService } from '../src/main/services/installer-save';
import { TaskService } from '../src/main/services/tasks';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { validateInstallerSave } from '../src/shared/install-components';
describe('installer files',()=>{
 it('rejects arbitrary URLs and paths at the IPC boundary',()=>{expect(()=>validateInstallerSave({kind:'forge',minecraft:'1.20.1',version:'../x'})).toThrow();expect(()=>validateInstallerSave({kind:'forge',minecraft:'1.20.1',version:'47.0.0',url:'https://evil'})).toThrow();});
 it('uses official coordinates and refuses missing sha1 before downloading',async()=>{const root=await mkdtemp(join(tmpdir(),'installer-save-'));try{const tasks=new TaskService();const download=vi.fn();const response=vi.fn(async(_url:string)=>new Response('not a checksum'));const service:any={root,tasks,network:{validateUrl:vi.fn(),response,download}};const files=new InstallerSaveService(service);await expect(tasks.wait(files.save({kind:'forge',minecraft:'1.20.1',version:'47.4.0'}))).rejects.toThrow('官方SHA1');expect(response.mock.calls[0]?.[0]).toBe('https://maven.minecraftforge.net/net/minecraftforge/forge/1.20.1-47.4.0/forge-1.20.1-47.4.0-installer.jar.sha1');expect(download).not.toHaveBeenCalled();}finally{await rm(root,{recursive:true,force:true});}});
 it('does not invent recommended builds',async()=>{const service:any={network:{json:async()=>({promos:{'1.20.1-latest':'47.4.0'}})}};expect(await new InstallerSaveService(service).promotions('1.20.1')).toEqual({latest:'47.4.0',changelog:'https://files.minecraftforge.net/net/minecraftforge/forge/index_1.20.1.html'});});
});
