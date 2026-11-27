import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {analyzeCrash,collectDiagnostics,redactDiagnostics,importDiagnostic} from '../src/main/services/diagnostics';
it('explains specific signatures with evidence and keeps unknown failures honest',()=>{
 const r=analyzeCrash([{name:'latest.log',text:'java.lang.OutOfMemoryError: Java heap space\nUnsupportedClassVersionError: class file version 65.0'}]);
 expect(r.findings.map(f=>f.id)).toEqual(expect.arrayContaining(['heap','java-version']));
 expect(r.findings.every(f=>f.evidence.length>0&&f.suggestion.length>0)).toBe(true);
 expect(analyzeCrash([{name:'latest.log',text:'ordinary unknown error'}]).findings).toEqual([]);
 expect(analyzeCrash([{name:'latest.log',text:'[INFO] This feature requires version 1.2 or later.\n[ERROR] Unknown plugin failure'}]).findings).toEqual([]);
 const common=analyzeCrash([{name:'latest.log',text:'java.net.UnknownHostException: example.invalid\nShader compilation failed\nNo space left on device\nFailed to load mod'}]);
 expect(common.findings.map(f=>f.id)).toEqual(expect.arrayContaining(['network','shader','disk','loader']));
});
it('rejects linked log directories and files, and bounds aggregate reports',async()=>{
 const root=await mkdtemp(join(tmpdir(),'zh-diag-links-')),outside=await mkdtemp(join(tmpdir(),'zh-diag-outside-'));
 await writeFile(join(outside,'latest.log'),'PRIVATE_OUTSIDE');
 await symlink(outside,join(root,'logs'),'junction');
 expect(JSON.stringify(await collectDiagnostics(root))).not.toContain('PRIVATE_OUTSIDE');
 const regular=await mkdtemp(join(tmpdir(),'zh-diag-bounds-'));await mkdir(join(regular,'logs'));await mkdir(join(regular,'crash-reports'));
 await writeFile(join(regular,'logs/latest.log'),'x'.repeat(2*1024*1024));await writeFile(join(regular,'logs/debug.log'),'y'.repeat(2*1024*1024));await writeFile(join(regular,'crash-reports/crash-limit.txt'),'not-in-report');
 const report=await collectDiagnostics(regular);expect(report.files.reduce((n,f)=>n+Buffer.byteLength(f.text),0)).toBeLessThanOrEqual(4*1024*1024);expect(report.omitted.some(s=>s.includes('4 MB'))).toBe(true);
 await expect(importDiagnostic(join(regular,'logs/latest.log.exe'))).rejects.toThrow();
});
it('redacts identity, auth command lines, bearer tokens, JWT and private paths',()=>{
 const text='--accessToken "very-secret"\nAuthorization: Bearer bearer-secret\n"refresh_token":"refresh-secret"\naccessToken=plain-secret\nuser@example.com 0123456789abcdef0123456789abcdef C:\\Users\\Private\\.minecraft\\logs\\latest.log';
 const r=redactDiagnostics(text);
 for(const s of ['very-secret','bearer-secret','refresh-secret','plain-secret','user@example.com','0123456789abcdef0123456789abcdef','Private'])expect(r).not.toContain(s);
});
it('collects only bounded recent game logs and excludes links and unrelated files',async()=>{
 const root=await mkdtemp(join(tmpdir(),'zh-diagnostic-'));
 await mkdir(join(root,'logs'));await mkdir(join(root,'crash-reports'));
 await writeFile(join(root,'logs/latest.log'),'java.lang.OutOfMemoryError: Java heap space');
 await writeFile(join(root,'crash-reports/crash-one.txt'),'Invalid maximum heap size');
 await writeFile(join(root,'accounts.json'),'NEVER_READ');
 const r=await collectDiagnostics(root);
 expect(r.files.map(f=>f.name)).toEqual(expect.arrayContaining(['logs/latest.log','crash-reports/crash-one.txt']));
 expect(JSON.stringify(r)).not.toContain('NEVER_READ');expect(r.findings.some(f=>f.id==='heap')).toBe(true);
 await writeFile(join(root,'logs/latest.log'),'x'.repeat(2*1024*1024+1));
 const bounded=await collectDiagnostics(root);expect(bounded.omitted.length).toBeGreaterThan(0);
});
