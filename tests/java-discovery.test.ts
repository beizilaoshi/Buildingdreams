import {it,expect} from 'vitest';
import {mkdtemp,mkdir,writeFile,symlink} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {parseJavaRegistry,officialRuntimeCandidates} from '../src/main/services/java-discovery';
it('uses only known registry install values as Java roots',()=>{
 const r=parseJavaRegistry('HKEY_LOCAL_MACHINE\\SOFTWARE\\JavaSoft\n    JavaHome    REG_SZ    C:\\Java\\jdk-21\n    Path    REG_EXPAND_SZ    C:\\Java\\jre\\bin\n    Arbitrary    REG_SZ    C:\\Other\\payload\n    JavaHome    REG_SZ    relative\\path');
 expect(r).toEqual(['C:\\Java\\jdk-21\\bin\\java.exe','C:\\Java\\jre\\bin\\java.exe']);
});
it('finds only bounded official runtime trees and never follows links',async()=>{
 const root=await mkdtemp(join(tmpdir(),'java-discovery-')),outside=await mkdtemp(join(tmpdir(),'java-outside-'));
 const runtime=join(root,'java-runtime-gamma','windows-x64','java-runtime-gamma','bin');await mkdir(runtime,{recursive:true});await writeFile(join(runtime,'java.exe'),'fixture');
 await mkdir(join(outside,'bin'));await writeFile(join(outside,'bin','java.exe'),'outside');await symlink(outside,join(root,'linked'),'junction');
 expect(await officialRuntimeCandidates([root])).toEqual([join(runtime,'java.exe')]);
});
