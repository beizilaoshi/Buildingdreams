import {EventEmitter} from 'node:events';
import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({stat:vi.fn(),readFile:vi.fn(),writeFile:vi.fn(),rename:vi.fn(),rm:vi.fn(),execFile:vi.fn()}));
vi.mock('node:fs/promises',()=>({...mocks,mkdir:vi.fn().mockResolvedValue(undefined)}));
vi.mock('node:child_process',()=>({execFile:mocks.execFile,spawn:vi.fn()}));
import {LinkService} from '../src/main/services/link';
const config={corePath:'C:/core.exe',cliPath:'C:/cli.exe',peers:['tcp://localhost:11010']};
const deferred=()=>{let resolve!:(v?:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};};
beforeEach(()=>{vi.clearAllMocks();mocks.readFile.mockRejectedValue(Object.assign(Error('missing'),{code:'ENOENT'}));mocks.stat.mockResolvedValue({isFile:()=>true});mocks.writeFile.mockResolvedValue(undefined);mocks.rename.mockResolvedValue(undefined);mocks.rm.mockResolvedValue(undefined);mocks.execFile.mockImplementation((path,args,options,callback)=>{callback(null,args[0]==='--version'?'easytier-core 2.6.4':'--rpc-portal --instance-name node peer');});});
describe('link lifecycle serialization',()=>{
 it('all leave callers, including shutdown, wait for the owned child exit',async()=>{
 const service=new LinkService('C:/test/link.json');await service.state();
 const child=Object.assign(new EventEmitter(),{exitCode:null,kill:vi.fn(()=>true)});
 (service as any).child=child;
 let firstDone=false,shutdownDone=false;
 const first=service.leave().then(()=>{firstDone=true;});
 const shutdown=service.leave().then(()=>{shutdownDone=true;});
 await new Promise(r=>setTimeout(r,150));
 expect(firstDone).toBe(false);expect(shutdownDone).toBe(false);expect(child.kill).toHaveBeenCalledTimes(1);
 child.exitCode=0 as any;child.emit('exit',0);child.emit('close',0);await Promise.all([first,shutdown]);
 });
 it('reserves configuration before filesystem validation',async()=>{
 const gate=deferred();mocks.stat.mockReturnValueOnce(gate.promise);
 const service=new LinkService('C:/test/link.json');await service.state();
 const first=service.configure(config);await Promise.resolve();
 const second=service.configure({...config,corePath:'C:/other.exe'});
 const result=expect(second).rejects.toThrow('请先离开');gate.resolve({isFile:()=>true});await result;await first;
 expect(mocks.rename).toHaveBeenCalledTimes(1);
 });
 it('leave cancels configure during stat and waits for its cleanup',async()=>{
 const gate=deferred();mocks.stat.mockReturnValueOnce(gate.promise);
 const service=new LinkService('C:/test/link.json');await service.state();
 const configure=service.configure(config);const rejected=expect(configure).rejects.toThrow('取消');await Promise.resolve();
 const leaving=service.leave();gate.resolve({isFile:()=>true});await leaving;await rejected;
 expect(mocks.rename).not.toHaveBeenCalled();expect((await service.state()).config.corePath).toBe('');
 });
 it('cleans cancelled staging writes and preserves current configuration',async()=>{
 mocks.readFile.mockResolvedValue(JSON.stringify(config));const gate=deferred();mocks.writeFile.mockReturnValueOnce(gate.promise);
 const service=new LinkService('C:/test/link.json');await service.state();
 const configuring=service.configure({...config,corePath:'C:/new.exe'});const rejected=expect(configuring).rejects.toThrow('取消');
 await vi.waitFor(()=>expect(mocks.writeFile).toHaveBeenCalled());
 const leaving=service.leave();gate.resolve();await rejected;await leaving;
 expect(mocks.rename).not.toHaveBeenCalled();expect(mocks.rm).toHaveBeenCalled();expect((await service.state()).config).toEqual(config);
 });
 it('does not release shutdown at the forced-kill timeout before the owned exit',async()=>{
 vi.useFakeTimers();try{
 const service=new LinkService('C:/test/link.json');await service.state();
 const child=Object.assign(new EventEmitter(),{exitCode:null,kill:vi.fn(()=>true)});(service as any).child=child;
 let done=false;const leaving=service.leave().then(()=>{done=true;});
 await vi.advanceTimersByTimeAsync(2500);expect(child.kill).toHaveBeenLastCalledWith('SIGKILL');expect(done).toBe(false);
 child.emit('close',0);await leaving;expect(done).toBe(true);
 }finally{vi.useRealTimers();}
 });
 it('restores the last valid file if leave interrupts an in-flight rename',async()=>{
 mocks.readFile.mockResolvedValue(JSON.stringify(config));const gate=deferred();mocks.rename.mockReturnValueOnce(gate.promise);
 const service=new LinkService('C:/test/link.json');await service.state();
 const configuring=service.configure({...config,corePath:'C:/new.exe'});const rejected=expect(configuring).rejects.toThrow('取消');
 await vi.waitFor(()=>expect(mocks.rename).toHaveBeenCalled());const leaving=service.leave();gate.resolve();await rejected;await leaving;
 expect(mocks.writeFile).toHaveBeenLastCalledWith(expect.any(String),JSON.stringify(config),expect.any(Object));
 expect(mocks.rename).toHaveBeenCalledTimes(2);expect((await service.state()).config).toEqual(config);
 });
 it('cleans staging files after disk errors and releases the operation reservation',async()=>{
 mocks.writeFile.mockRejectedValueOnce(Error('disk full'));const service=new LinkService('C:/test/link.json');await service.state();
 await expect(service.configure(config)).rejects.toThrow('无法验证或保存 EasyTier 组件配置');expect(mocks.rm).toHaveBeenCalled();await expect(service.configure(config)).resolves.toMatchObject({config});
 });

 it('retains ownership and rejects rather than reporting success when the child never exits',async()=>{
 vi.useFakeTimers();try{
 const service=new LinkService('C:/test/link.json');await service.state();
 const child=Object.assign(new EventEmitter(),{exitCode:null,kill:vi.fn(()=>true)});(service as any).child=child;
 const rejected=expect(service.leave()).rejects.toThrow('尚未退出');await vi.advanceTimersByTimeAsync(5000);await rejected;
 expect((service as any).child).toBe(child);expect(child.kill).toHaveBeenCalledTimes(2);
 const retry=service.leave();child.emit('close',0);await retry;expect((service as any).child).toBeUndefined();
 }finally{vi.useRealTimers();}
 });
 it('only stops and clears the captured owned handle',async()=>{
 const service=new LinkService('C:/test/link.json');await service.state();
 const child=Object.assign(new EventEmitter(),{exitCode:null,kill:vi.fn(()=>true)});
 const other=Object.assign(new EventEmitter(),{exitCode:null,kill:vi.fn(()=>true)});(service as any).child=child;
 const leaving=service.leave();(service as any).child=other;child.emit('close',0);await leaving;
 expect(other.kill).not.toHaveBeenCalled();expect((service as any).child).toBe(other);
 });

});
