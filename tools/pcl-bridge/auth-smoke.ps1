param([switch]$Device)
$ErrorActionPreference='Stop'
Add-Type -TypeDefinition @'
using System;using System.Runtime.InteropServices;
public static class PclSmokeWindow {
 delegate bool Callback(IntPtr h,IntPtr p);
 [DllImport("user32.dll")]static extern bool EnumWindows(Callback callback,IntPtr param);
 [DllImport("user32.dll")]static extern uint GetWindowThreadProcessId(IntPtr h,out uint id);
 [DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr h);
 public static bool Present(int process){bool seen=false;EnumWindows((h,p)=>{uint id;GetWindowThreadProcessId(h,out id);if(id==process&&IsWindowVisible(h))seen=true;return true;},IntPtr.Zero);return seen;}
}
'@
$pin='0DB34E19D9EEB6D496D20FABE786EC16BBD36BA6B0CCDC8D29CB7E909C114397'
$source='D:/桌面/Plain Craft Launcher 2.exe'
if((Get-FileHash -LiteralPath $source).Hash -ne $pin){throw 'Source pin mismatch'}
$base=Join-Path $PSScriptRoot ('runs/'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory $base | Out-Null
Copy-Item "$PSScriptRoot/bin/Test/*" $base
Copy-Item -LiteralPath $source -Destination "$base/Plain Craft Launcher 2.exe"
function Case([string]$mode,[string]$inputLine,[bool]$deviceCase=$false){
 $id=[guid]::NewGuid().ToString('D');$nonce=$id.Replace('-','');$key="Software\ZhumengPclBridge\auth-$nonce"
 $fixture=$null;$fixtureMarker=[guid]::NewGuid().ToString('N');$ownedAck=$false
 $existing=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key);if($existing){$existing.Dispose();throw 'Test nonce collision; choose another nonce'}
 if($mode -eq 'collision'){$fixture=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($key);$fixture.SetValue('TestActor',$fixtureMarker)}
 $si=[Diagnostics.ProcessStartInfo]::new("$base/PclBridge.exe",'--auth');$si.WorkingDirectory=$base
 $si.UseShellExecute=$false;$si.CreateNoWindow=$true;$si.RedirectStandardInput=$true;$si.RedirectStandardOutput=$true;$si.RedirectStandardError=$true
 $si.EnvironmentVariables['BRIDGE_TEST_AUTH']=$mode
 foreach($n in @('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')){$p=Join-Path $base $n;New-Item -ItemType Directory -Force $p|Out-Null;$si.EnvironmentVariables[$n]=$p}
 $p=[Diagnostics.Process]::Start($si);$events=@();$deviceSeen=$false;$beats=0;$cancelled=$false;$cancelAt=$null
 try {
  # Simulate another actor winning after the parent's old absence check.
  if($mode -eq 'race'){$fixture=[Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($key);$fixture.SetValue('TestActor',$fixtureMarker)}
  $line=if($inputLine){$inputLine.Replace('SESSION',$id)}else{"{`"command`":`"login`",`"sessionId`":`"$id`"}"}
  $p.StandardInput.WriteLine($line);$p.StandardInput.Flush()
  if($mode -eq 'eof'){$p.StandardInput.Close()}
  $read=$p.StandardOutput.ReadLineAsync();$limit=[DateTime]::UtcNow.AddSeconds(40)
  while([DateTime]::UtcNow -lt $limit){
   if([PclSmokeWindow]::Present($p.Id)){throw 'Visible owned window'}
   if($read.Wait(100)){
    if($null -eq $read.Result){break};$e=$read.Result|ConvertFrom-Json;$events+=,$e
    if($e.version -ne 2){throw 'Not protocol v2'}
    if($e.registryOwned){if($e.sessionId -ne $id -or $e.registryOwner -ne 'zhumeng.pcl.auth.v2'){throw 'Invalid ownership acknowledgement'};$ownedAck=$true}
    if($e.kind -eq 'device'){$deviceSeen=$true}
    if($e.kind -eq 'heartbeat'){$beats++}
    if($deviceCase -and $e.testCode){"DEVICE_DIAGNOSTIC code=$($e.testCode)"}
    if($mode -eq 'prompt' -and $e.testHook){"HOOK_SIGNATURE=$($e.testHook)"}
    if(!$cancelled -and (($deviceCase -and $deviceSeen -and $beats -ge 2) -or (!$deviceCase -and $e.stage -in @('test_wait','test_init_wait')))){
     if($mode -eq 'init_eof'){$cancelAt=[DateTime]::UtcNow;$p.StandardInput.Close();$cancelled=$true;$read=$p.StandardOutput.ReadLineAsync();continue}
     $cancelId=if($mode -eq 'mismatch'){[guid]::NewGuid().ToString('D')}else{$id}
     $cancel="{`"command`":`"cancel`",`"sessionId`":`"$cancelId`"}"
     $cancelAt=[DateTime]::UtcNow;$p.StandardInput.WriteLine($cancel);if($mode -eq 'duplicate'){$p.StandardInput.WriteLine($cancel)};$p.StandardInput.Flush();$cancelled=$true
    }
    $read=$p.StandardOutput.ReadLineAsync()
   }
  }
  if(!$p.WaitForExit(1000)){throw 'Owned worker deadline'}
  if($p.StandardError.ReadToEnd()){throw 'Unexpected stderr'}
  $terminal=@($events|Where-Object kind -eq terminal)
  if($terminal.Count -ne 1 -or @($events|Where-Object kind -eq completed).Count){throw 'Terminal/result invariant'}
  if(@($events|Where-Object kind -eq cleanup).Count -ne 1){throw 'Cleanup event invariant'}
  $expected=if($mode -eq 'prompt'){'unlicensed'}elseif($mode -in @('hung','duplicate','eof','init_cancel','init_eof') -or $deviceCase){'cancelled'}else{'unsupported'}
  if($terminal[0].code -ne $expected){throw 'Unexpected typed terminal'}
  $expectedExit=if($mode -in @('hung','mismatch','duplicate','init_cancel','init_eof') -or $deviceCase){32}elseif($mode -in @('prompt','eof')){0}else{20}
  if($p.ExitCode -ne $expectedExit){throw 'Unexpected process exit'}
  if($mode -in @('init_cancel','init_eof') -and (!$cancelAt -or ([DateTime]::UtcNow-$cancelAt).TotalSeconds -gt 2)){throw 'Initialization cancellation exceeded bound'}
  if($mode -notin @('invalid','duplicate_field','nested','oversize','unknown_pin','collision','race') -and !$ownedAck){throw 'Missing atomic ownership acknowledgement'}
  if($deviceCase -and (!$deviceSeen -or $beats -lt 2 -or $terminal[0].code -ne 'cancelled')){"DEVICE_SMOKE_FAILED stage=$($terminal[0].stage) code=$($terminal[0].code) device_received=$deviceSeen heartbeat_count=$beats";throw 'Actual device request failed'}
  "PASS case=$mode terminal=$($terminal[0].code) device_received=$deviceSeen heartbeat_count=$beats owned_windows=False cleanup_event=True exit=$($p.ExitCode)"
 }finally{
  if(!$p.HasExited){$p.Kill();$p.WaitForExit()}
  # Deletion requires positive proof of native atomic create-new, never absence.
  if($ownedAck){[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($key,$false)}
  $check=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($key)
  try {
   if($fixture){
    if($ownedAck -or !$check -or $check.GetValue('TestActor') -ne $fixtureMarker){throw 'Collision/race key was modified or removed'}
    "PASS case=$mode collision_key_preserved=True ownership_ack=False"
   }elseif($check){throw 'Unproven registry ownership; key preserved for investigation'}
  }finally{
   if($check){$check.Dispose()}
   # Separate test actor cleans its own fixture only after preservation proof.
   if($fixture){$fixture.Dispose();[Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($key,$false)}
  }
 }
}
try {
 Case 'invalid' '{"command":"login","sessionId":"SESSION","extra":true}'
 Case 'duplicate_field' '{"command":"login","command":"login","sessionId":"SESSION"}'
 Case 'nested' '{"command":"login","sessionId":{"value":"SESSION"}}'
 Case 'oversize' ('x'*65537)
 [IO.File]::WriteAllText("$base/Plain Craft Launcher 2.exe",'unknown test bytes')
 try {Case 'unknown_pin' ''}finally{Copy-Item -LiteralPath $source -Destination "$base/Plain Craft Launcher 2.exe" -Force}
 Case 'prompt' ''
 Case 'hung' ''
 Case 'mismatch' ''
 Case 'duplicate' ''
 Case 'eof' ''
 Case 'init_cancel' ''
 Case 'init_eof' ''
 Case 'collision' ''
 Case 'race' ''
 $timingInfo=[Diagnostics.ProcessStartInfo]::new("$base/PclBridge.exe",'--test-timing');$timingInfo.UseShellExecute=$false;$timingInfo.CreateNoWindow=$true;$timingInfo.RedirectStandardOutput=$true
 $timing=[Diagnostics.Process]::Start($timingInfo);if(!$timing.WaitForExit(5000)){$timing.Kill();$timing.WaitForExit();throw 'Timing test timeout'}
 if($timing.ExitCode -ne 0){throw 'Timing tests failed'};$timing.StandardOutput.ReadToEnd().Trim()
 if($Device){Copy-Item "$PSScriptRoot/bin/Release/PclBridge.exe" "$base/PclBridge.exe" -Force;Case 'release_device' '' $true}
} finally {
 $runRoot=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot 'runs')).TrimEnd('\')+'\'
 $resolved=[IO.Path]::GetFullPath($base)
 if(!$resolved.StartsWith($runRoot,[StringComparison]::OrdinalIgnoreCase) -or [IO.Path]::GetFileName($resolved) -notmatch '^[a-f0-9]{32}$'){throw 'Cleanup containment check failed'}
 Remove-Item -LiteralPath $resolved -Recurse -Force
 if(Test-Path -LiteralPath $resolved){throw 'Owned private file cleanup failed'}
 'PASS exact parent-owned registry cleanup and private file cleanup'
}
if((Get-FileHash -LiteralPath $source).Hash -ne $pin){throw 'Original hash changed'}
'PASS original hash unchanged'
