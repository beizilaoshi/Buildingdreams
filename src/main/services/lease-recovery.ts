import { spawn } from 'node:child_process';

export type LeaseProcessResult =
  | { status: 'dead' }
  | { status: 'running'; pid: number }
  | { status: 'ambiguous'; reason: string };

/** Pure decision helper so recovery semantics stay deterministic in tests. */
export function decideLeaseProcess(rows: Array<{ pid: unknown; commandLine: unknown }>, marker: string): LeaseProcessResult {
  const expected = `-Dzhumeng.launchMarker=${marker}`;
  const matches: number[] = [];
  for (const row of rows) {
    if (typeof row.pid !== 'number' || !Number.isSafeInteger(row.pid) || row.pid < 1)
      return { status: 'ambiguous', reason: '系统返回的进程信息不完整' };
    if (typeof row.commandLine !== 'string' || !row.commandLine)
      return { status: 'ambiguous', reason: '有 Java 进程的命令行无法读取' };
    if (row.commandLine.includes(expected)) matches.push(row.pid);
  }
  if (matches.length === 0) return { status: 'dead' };
  if (matches.length === 1) return { status: 'running', pid: matches[0] };
  return { status: 'ambiguous', reason: '同一启动标记出现在多个进程中' };
}

/** Consume only the summary emitted by the PowerShell filter, never raw command lines. */
export function decideLeaseSnapshot(value: { matches: unknown; inaccessible: unknown }): LeaseProcessResult {
  if (value.inaccessible !== false) return { status: 'ambiguous', reason: '有 Java 进程的命令行无法读取' };
  if (!Array.isArray(value.matches) || value.matches.some(pid => typeof pid !== 'number' || !Number.isSafeInteger(pid) || pid < 1))
    return { status: 'ambiguous', reason: '系统返回的进程信息不完整' };
  if (value.matches.length === 0) return { status: 'dead' };
  if (value.matches.length === 1) return { status: 'running', pid: value.matches[0] as number };
  return { status: 'ambiguous', reason: '同一启动标记出现在多个进程中' };
}

const POWERSHELL_SNAPSHOT = String.raw`
$ErrorActionPreference = 'Stop'
try {
  $marker = [Console]::In.ReadLine()
  if ($marker -notmatch '^[a-f0-9-]{36}$') { throw 'invalid marker' }
  $expected = '-Dzhumeng.launchMarker=' + $marker
  $rows = @(Get-CimInstance -ClassName Win32_Process -Filter "Name = 'java.exe' OR Name = 'javaw.exe'" -ErrorAction Stop)
  $matches = @()
  $inaccessible = $false
  foreach ($row in $rows) {
    if ([string]::IsNullOrEmpty($row.CommandLine)) { $inaccessible = $true; continue }
    if ($row.CommandLine.Contains($expected)) { $matches += [int]$row.ProcessId }
  }
  ConvertTo-Json -InputObject ([pscustomobject]@{ matches = @($matches); inaccessible = $inaccessible }) -Compress -Depth 2
} catch {
  ConvertTo-Json -InputObject ([pscustomobject]@{ matches = @(); inaccessible = $true }) -Compress -Depth 2
}
`;

/**
 * Windows CIM is used only to compare the exact launcher-generated random marker.
 * The marker is sent over stdin, never placed on the powershell command line. The
 * PowerShell child emits only matching PIDs and a completeness bit, never command lines.
 */
export async function verifyLaunchMarker(marker: string, timeoutMs = 4000): Promise<LeaseProcessResult> {
  if (!/^[a-f0-9-]{36}$/.test(marker)) return { status: 'ambiguous', reason: '启动标记格式无效' };
  if (process.platform !== 'win32') return { status: 'ambiguous', reason: '当前系统暂不支持安全核对游戏进程命令行' };
  return new Promise(resolve => {
    let settled = false, output = '', failed = false;
    const finish = (result: LeaseProcessResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(result);
    };
    const child = spawn('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', POWERSHELL_SNAPSHOT], {
      windowsHide: true,
      shell: false,
      stdio: ['pipe', 'pipe', 'ignore'],
    });
    const timer = setTimeout(() => {
      failed = true;
      child.kill();
      finish({ status: 'ambiguous', reason: '检查游戏进程超时' });
    }, Math.max(250, Math.min(timeoutMs, 8000)));
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      output += chunk;
      if (output.length > 16 * 1024) {
        failed = true;
        child.kill();
        finish({ status: 'ambiguous', reason: '系统进程列表超出安全检查范围' });
      }
    });
    child.once('error', () => finish({ status: 'ambiguous', reason: '无法启动系统进程检查' }));
    child.once('close', code => {
      if (settled) return;
      if (failed || code !== 0) return finish({ status: 'ambiguous', reason: '系统进程检查未能完整完成' });
      try {
        const parsed = JSON.parse(output.trim());
        finish(decideLeaseSnapshot(parsed));
      } catch {
        finish({ status: 'ambiguous', reason: '系统进程检查结果无法解析' });
      }
    });
    child.stdin.end(marker + '\n');
  });
}
