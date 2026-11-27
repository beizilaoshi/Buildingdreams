import {api,e,button} from '../ui';
import {dialog} from './dialog';
import type {DiagnosticReport} from '../../shared/diagnostics';
export async function showDiagnostics(instanceId:string,title='游戏崩溃诊断',automatic=false):Promise<void>{
 const body=e('div','stack');
 const info=e('p','muted',automatic?'游戏异常结束后已自动收集最近日志。筑梦只在本机分析，导出前可检查脱敏报告。':'读取最近日志并检查常见原因；分析结果仅供排查，未命中规则不代表没有问题。导出前仍建议检查脱敏内容。');body.append(info);
 const content=e('div','stack');let sessionId='',currentReport:DiagnosticReport|undefined;
 const render=(report:DiagnosticReport)=>{
  currentReport=report;
  content.replaceChildren();
  if(!report.findings.length)content.append(e('p','muted',report.files.length?'未识别到已知特征，请查看脱敏日志或导出报告求助。':'尚无可读取的日志；可导入 .log 或 .txt 文件。'));
  for(const finding of report.findings){const card=e('section','glass card');card.append(e('h3','',finding.title),e('p','',finding.suggestion),e('pre','logs',finding.evidence));content.append(card);}
  for(const file of report.files){const details=document.createElement('details');details.append(e('summary','',file.name),e('pre','logs',file.text));content.append(details);}
  if(report.omitted.length)content.append(e('p','muted','已跳过：'+report.omitted.join('；')));
 };
 const actions=e('div','row wrap');
 const refresh=async()=>{const session=await api('diagnostics.collect',instanceId);sessionId=session.id;render(session.report);};
 actions.append(button('重新分析',refresh,'quiet'),button('导入日志',async()=>{const session=await api('diagnostics.import',undefined);if(session){sessionId=session.id;render(session.report);}},'quiet'),button('复制排查摘要',async()=>{if(!sessionId||!currentReport)throw Error('请先完成日志分析');await api('diagnostics.copy',sessionId);},'quiet'),button('导出脱敏报告',async()=>{if(!sessionId)throw Error('请先分析日志');await api('diagnostics.export',sessionId);},'quiet'));
 body.append(actions,content);const modal=dialog(title,body);if(automatic)body.append(button('返回游戏库',()=>{modal.close();window.dispatchEvent(new CustomEvent('navigate',{detail:'library'}));},'quiet'));await refresh();
}
