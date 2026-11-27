import {randomUUID} from 'node:crypto';
import {extname} from 'node:path';
import {open,rename,rm} from 'node:fs/promises';
import type {CommandRouter} from './ipc';
import {noPayload} from './ipc';
import type {DiagnosticReport} from '../shared/diagnostics';
import {collectDiagnostics,importDiagnostic} from './services/diagnostics';
export interface DiagnosticDependencies {
 gameDirectory(id:string):Promise<string>;
 sessionLog(id:string):string;
 chooseImport():Promise<string|null>;
 chooseExport():Promise<string|null>;
 copy?:(text:string)=>void;
}
export function registerDiagnosticsCommands(router:CommandRouter,deps:DiagnosticDependencies){
 const reports=new Map<string,DiagnosticReport>();
 function remember(report:DiagnosticReport){const id=randomUUID();if(reports.size>=3)reports.delete(reports.keys().next().value!);reports.set(id,report);return {id,report};}
 const identifier=(v:unknown)=>{if(typeof v!=='string'||!v.trim()||v.length>200)throw Error('无效诊断标识');return v;};
 router.register('diagnostics.collect',identifier,async id=>remember(await collectDiagnostics(await deps.gameDirectory(id),deps.sessionLog(id))));
 router.register('diagnostics.import',noPayload,async()=>{const path=await deps.chooseImport();return path?remember(await importDiagnostic(path)):null;});
 router.register('diagnostics.copy',identifier,async id=>{
  const report=reports.get(id);if(!report)throw Error('诊断已过期，请重新分析');
  if(!deps.copy)throw Error('系统剪贴板不可用');
  const summary=report.findings.length?report.findings.map(f=>`${f.title}\n${f.suggestion}\n${f.evidence}`).join('\n\n'):'未识别到已知错误特征；请附上脱敏诊断报告。';
  deps.copy(`筑梦启动器诊断摘要\n${summary}`);return true;
 });
 router.register('diagnostics.export',identifier,async id=>{
  const report=reports.get(id);if(!report)throw Error('诊断已过期，请重新分析');
  const destination=await deps.chooseExport();if(!destination)return null;
  if(extname(destination).toLowerCase()!=='.json')throw Error('诊断报告必须保存为 .json');
  const temporary=destination+'.'+randomUUID()+'.tmp';
  try{const file=await open(temporary,'wx',0o600);try{await file.writeFile(JSON.stringify(report,null,2),'utf8');await file.sync();}finally{await file.close();}await rename(temporary,destination);return destination;}
  finally{await rm(temporary,{force:true});}
 });
}
