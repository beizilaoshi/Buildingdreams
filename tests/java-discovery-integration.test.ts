import {it,expect,vi} from 'vitest';
vi.mock('../src/main/services/java-discovery',()=>({discoverWindowsJava:async()=>['Z:\\OfficialRuntime\\bin\\java.exe']}));
import {JavaService} from '../src/main/services/java';
it('actually probes discovered official runtimes before the bounded fallback candidates',async()=>{
 const service=new JavaService(),inspect=vi.spyOn(service,'inspect').mockImplementation(async path=>{if(path==='Z:\\OfficialRuntime\\bin\\java.exe')return {path,version:'21.0.1',major:21,arch:'amd64'};throw Error('missing');});
 const found=await service.detect();expect(inspect.mock.calls[0][0]).toBe('Z:\\OfficialRuntime\\bin\\java.exe');expect(found.some(j=>j.major===21)).toBe(true);
});
