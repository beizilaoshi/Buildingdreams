import { execFile } from "node:child_process";
import { join } from "node:path";

// Fixed program, no shell interpolation. Input is only a parent-generated GUID.
// Win32 ERROR_FILE_NOT_FOUND (2) is positive absence; every other error fails closed.
const program = `
$ErrorActionPreference = 'Stop'
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class ZhumengOwnedRegistry {
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] public static extern int RegDeleteTree(IntPtr root, string path);
 [DllImport("advapi32.dll", CharSet=CharSet.Unicode)] public static extern int RegOpenKeyEx(IntPtr root, string path, int options, int access, out IntPtr handle);
 [DllImport("advapi32.dll")] public static extern int RegCloseKey(IntPtr handle);
}
'@
$session = [Console]::In.ReadLine()
if ($session -cnotmatch '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$') { exit 20 }
$path = 'Software\\ZhumengPclBridge\\auth-' + $session.Replace('-', '')
$root = [IntPtr]::new(-2147483647)
$deleted = [ZhumengOwnedRegistry]::RegDeleteTree($root, $path)
$handle = [IntPtr]::Zero
$queried = [ZhumengOwnedRegistry]::RegOpenKeyEx($root, $path, 0, 131097, [ref]$handle)
if ($handle -ne [IntPtr]::Zero) { [void][ZhumengOwnedRegistry]::RegCloseKey($handle) }
[Console]::Out.WriteLine(('{"deleteCode":' + $deleted + ',"queryCode":' + $queried + '}'))
`;
export async function removeOwnedPclRegistry(session: string): Promise<void> {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(session))
    throw new Error("认证清理归属无法确认");
  const result = await new Promise<string>((resolve,reject) => {
    const child = execFile(join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(program,"utf16le").toString("base64")],
      { windowsHide:true, timeout:15000, maxBuffer:1024, encoding:"utf8" },
      (error,stdout) => error ? reject(new Error("认证清理无法验证")) : resolve(stdout));
    child.stdin?.on("error", () => reject(new Error("认证清理无法验证")));
    child.stdin?.end(session + "\n");
  });
  let value: unknown;
  try { value=JSON.parse(result); } catch { throw new Error("认证清理无法验证"); }
  if (!value || typeof value !== "object" || Array.isArray(value) || Object.keys(value).sort().join() !== "deleteCode,queryCode" ||
      (value as {deleteCode:unknown}).deleteCode !== 0 || (value as {queryCode:unknown}).queryCode !== 2)
    throw new Error("认证清理无法验证");
}
