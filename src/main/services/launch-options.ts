import type { LaunchOption, ResolvedVersion } from '@xmcl/core';
import type { Instance, JavaRuntime } from '../../shared/types';
import { effectiveLaunchSettings, type LaunchSettings } from '../../shared/launch-settings';
import type { LaunchAccount } from './launch';
export function buildLaunchOptions(item: Instance, version: ResolvedVersion, java: JavaRuntime, account: LaunchAccount, preferences: LaunchSettings): LaunchOption {
    const p = effectiveLaunchSettings(preferences);
    if (item.javaArgs.length > 128 || item.javaArgs.some(a => typeof a !== 'string' || a.length > 4096 || /[\0\r\n]/.test(a) || !a.startsWith('-') || /^(?:-Xm[sx]|-XX:(?:MaxRAM|InitialRAM|MinRAM|MaxHeapSize|InitialHeapSize)|-XX:Flags=|-Xbootclasspath|-cp(?:=|$)|-classpath(?:=|$)|--class-path|--module-path|--upgrade-module-path|--patch-module|--module(?:=|$)|-m$|-jar$|@|-D(?:java\.class\.path|java\.library\.path|user\.dir|libraryDirectory)=)/i.test(a)))
        throw Error('Java 参数不能覆盖托管内存、路径或主类');
    if (p.gc !== 'auto' && item.javaArgs.some(a => /^-XX:[+-]Use\w+GC/.test(a)))
        throw Error('Java 参数与所选 GC 冲突');
    if (p.gc === 'g1' && java.major < 8)
        throw Error('G1 需要 Java 8 或更新版本');
    if ((p.gc === 'zgc' || item.javaArgs.includes('-XX:+UseZGC')) && (java.major < 17 || !['amd64', 'x86_64', 'aarch64', 'arm64'].includes(java.arch)))
        throw Error('ZGC 需要 64 位 Java 17 或更新版本');
    const options: LaunchOption = { javaPath: java.path, version, gamePath: item.gameDir, resourcePath: item.resourceDir, maxMemory: item.memoryMb, extraJVMArgs: [...item.javaArgs, ...(p.gc === 'g1' ? ['-XX:+UseG1GC'] : p.gc === 'zgc' ? ['-XX:+UseZGC'] : [])], extraMCArgs: [...p.gameArgs], resolution: { width: p.width, height: p.height, fullscreen: p.fullscreen }, gameProfile: { name: account.name, id: account.uuid }, accessToken: account.accessToken, launcherName: '筑梦启动器', launcherBrand: '筑梦启动器', extraExecOption: { shell: false, windowsHide: true } };
    if (p.versionInfo)
        options.versionType = p.versionInfo;
    // XMCL suppresses fullscreen when metadata already emits width; append it explicitly.
    if (p.fullscreen) {
        options.resolution = undefined;
        options.extraMCArgs!.push('--fullscreen');
    }
    if (p.serverHost) {
        const m = /^1\.(\d+)(?:\.(\d+))?$/.exec(version.minecraftVersion);
        const quick = (!!m && Number(m[1]) >= 20) || JSON.stringify(version.arguments.game).includes('quickPlayMultiplayer');
        if (quick)
            options.quickPlayMultiplayer = `${p.serverHost.includes(':') ? '[' + p.serverHost + ']' : p.serverHost}:${p.serverPort}`;
        else
            options.server = { ip: p.serverHost, port: p.serverPort };
    }
    return options;
}
const ps = (value: string) => "'" + value.replace(/'/g, "''") + "'";
/** Windows CRT argv quoting, performed at runtime so environment values remain literal. */
export function powershellScript(executable: string, args: string[], directory: string, environment: boolean): string {
    const values = args.map(a => {
        if (environment)
            return '(' + ps(a) + ".Replace('__ZH_TOKEN__', $env:ZHUMENG_ACCESS_TOKEN).Replace('__ZH_UUID__', $env:ZHUMENG_UUID).Replace('__ZH_NAME__', $env:ZHUMENG_PLAYER_NAME))";
        return ps(a.replaceAll('__ZH_TOKEN__', 'REDACTED_TOKEN').replaceAll('__ZH_UUID__', '00000000000000000000000000000000').replaceAll('__ZH_NAME__', 'Player'));
    });
    return `# 筑梦：仅导出 Java 参数。需已有完整游戏、原生库与 Java；不执行启动前命令或窗口辅助操作。\n# 默认身份已脱敏；联网身份需显式选择环境变量模式重新导出。\n$ErrorActionPreference = 'Stop'\n${environment ? "foreach ($name in @('ZHUMENG_ACCESS_TOKEN','ZHUMENG_UUID','ZHUMENG_PLAYER_NAME')) { if (-not [Environment]::GetEnvironmentVariable($name)) { throw 'Required identity environment variable is missing' } }\n" : ''}function Quote-Arg([string]$value) {\n  $result = '\"'; $slashes = 0\n  foreach ($char in $value.ToCharArray()) {\n    if ($char -eq [char]92) { $slashes++; continue }\n    if ($char -eq [char]34) { $result += ('\\' * ($slashes * 2 + 1)) + '\"' } else { $result += ('\\' * $slashes) + $char }\n    $slashes = 0\n  }\n  return $result + ('\\' * ($slashes * 2)) + '\"'\n}\n$argv = @(\n${values.map(v => '  ' + v).join('\n')}\n)\n$info = New-Object System.Diagnostics.ProcessStartInfo\n$info.FileName = ${ps(executable)}\n$info.WorkingDirectory = ${ps(directory)}\n$info.UseShellExecute = $false\n$info.Arguments = (($argv | ForEach-Object { Quote-Arg $_ }) -join ' ')\n$child = [System.Diagnostics.Process]::Start($info)\n$child.WaitForExit()\nexit $child.ExitCode\n`;
}
