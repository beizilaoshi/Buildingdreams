import { spawn, type ChildProcess } from 'node:child_process';
import type { LaunchSettings } from '../../shared/launch-settings';
/** Commands are explicitly local opt-in. Never inherit account credentials or log command/output. */
export function preCommand(p: LaunchSettings, directory: string, signal: AbortSignal, own: (child: ChildProcess) => void, warn: (message: string) => void = () => { }): Promise<void> {
    if (!p.preCommandEnabled || !p.preCommand.trim())
        return Promise.resolve();
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn(p.preCommand, [], { cwd: directory, shell: true, windowsHide: true, stdio: 'ignore' });
        own(child);
        let done = false;
        const finish = (error?: Error) => { if (done)
            return; done = true; clearTimeout(timer); signal.removeEventListener('abort', abort); if (error && !p.preCommandWait)
            warn(error.message); error ? reject(error) : resolve(); };
        const abort = () => { child.kill(); finish(Error('启动前命令已取消')); };
        const timer = setTimeout(() => { child.kill(); finish(Error('启动前命令超时')); }, p.preCommandTimeout * 1000);
        signal.addEventListener('abort', abort, { once: true });
        child.once('error', () => finish(Error('启动前命令无法执行')));
        child.once('close', code => finish(code === 0 ? undefined : Error('启动前命令执行失败')));
        if (!p.preCommandWait)
            child.once('spawn', () => resolve());
        if (signal.aborted)
            abort();
    });
}
/** Static PowerShell source; user title travels through stdin JSON, never source interpolation. */
const cosmeticSource = `$ErrorActionPreference='Stop'
$data=[Console]::In.ReadToEnd() | ConvertFrom-Json
$target=Get-Process -Id ([int]$data.pid) -ErrorAction Stop
if ($target.StartTime.ToUniversalTime().Ticks.ToString() -ne [string]$data.birth) { throw 'Process identity changed' }
$target.PriorityClass=[string]$data.priority
if ($data.title) {
 Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class ZhumengWindow { [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern bool SetWindowText(IntPtr h, string s); }'
 for($i=0;$i -lt 30;$i++){ $target.Refresh(); if($target.HasExited){exit 0}; if($target.MainWindowHandle -ne [IntPtr]::Zero){if(-not [ZhumengWindow]::SetWindowText($target.MainWindowHandle,[string]$data.title)){throw 'Title unavailable'};exit 0};Start-Sleep -Milliseconds 500 }
 throw 'Game window unavailable'
}`;
export async function applyCosmetics(child: ChildProcess, p: LaunchSettings, signal: AbortSignal, own: (child: ChildProcess) => void, held: () => boolean): Promise<void> {
    if (!p.windowTitle && p.priority === 'normal')
        return;
    if (process.platform !== 'win32')
        throw Error('窗口标题与进程优先级仅支持 Windows');
    if (!child.pid || !held())
        return;
    // Query creation time separately; recheck held child after await and within helper before mutation.
    const birth = await runPowerShell('$ErrorActionPreference="Stop"; (Get-Process -Id ' + Number(child.pid) + ').StartTime.ToUniversalTime().Ticks.ToString()', undefined, signal, own, 5000);
    if (!held() || signal.aborted)
        return;
    await runPowerShell(cosmeticSource, JSON.stringify({ pid: child.pid, birth: birth.trim(), title: p.windowTitle, priority: { normal: 'Normal', belowNormal: 'BelowNormal', aboveNormal: 'AboveNormal' }[p.priority] }), signal, own, 20000);
}
function runPowerShell(source: string, input: string | undefined, signal: AbortSignal, own: (child: ChildProcess) => void, timeout: number): Promise<string> {
    signal.throwIfAborted();
    return new Promise((resolve, reject) => {
        const child = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-EncodedCommand', Buffer.from(source, 'utf16le').toString('base64')], { windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'ignore'] });
        own(child);
        let output = '';
        const abort = () => child.kill();
        const timer = setTimeout(abort, timeout);
        signal.addEventListener('abort', abort, { once: true });
        child.stdout?.on('data', chunk => { output += String(chunk); if (output.length > 4096)
            child.kill(); });
        child.stdin?.on('error', () => { });
        child.stdin?.end(input);
        const clean = () => { clearTimeout(timer); signal.removeEventListener('abort', abort); };
        child.once('error', () => { clean(); reject(Error('Windows 辅助操作无法启动')); });
        child.once('close', code => { clean(); code === 0 && !signal.aborted ? resolve(output) : reject(Error('Windows 辅助操作未完成（权限、窗口不可用或超时）')); });
    });
}
