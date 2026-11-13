param([string]$PclPath='D:/桌面/Plain Craft Launcher 2.exe')
$ErrorActionPreference='Stop'
$worker=Join-Path $PSScriptRoot 'bin/Release/PclBridge.exe'
if(!(Test-Path $worker)){throw 'FAIL: native worker missing'}
$pin='0DB34E19D9EEB6D496D20FABE786EC16BBD36BA6B0CCDC8D29CB7E909C114397'
$before=(Get-FileHash -LiteralPath $PclPath -Algorithm SHA256).Hash
if($before -ne $pin){throw 'Source pin mismatch; not copied or executed'}
$base=Join-Path $PSScriptRoot ('runs/'+[guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Path $base | Out-Null
Copy-Item -LiteralPath $worker -Destination $base
$target=Join-Path $base 'Plain Craft Launcher 2.exe'
function Start-Owned {
 $info=[Diagnostics.ProcessStartInfo]::new((Join-Path $base 'PclBridge.exe'))
 $info.WorkingDirectory=$base;$info.UseShellExecute=$false;$info.CreateNoWindow=$true
 $info.RedirectStandardInput=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
 foreach($name in @('TEMP','TMP','APPDATA','LOCALAPPDATA','USERPROFILE')){
  $private=Join-Path $base $name;New-Item -ItemType Directory -Force $private | Out-Null;$info.EnvironmentVariables[$name]=$private
 }
 [Diagnostics.Process]::Start($info)
}
# Unknown bytes must be rejected before any target load or registry override.
[IO.File]::WriteAllText($target,'unknown-test-binary')
$p=Start-Owned
if(!$p.WaitForExit(10000)){$p.Kill();throw 'Unknown binary timeout'}
$unknown=$p.StandardOutput.ReadToEnd();$errors=$p.StandardError.ReadToEnd()
if($p.ExitCode -ne 20 -or $unknown -notmatch 'hash_mismatch' -or $unknown -match 'registry_isolated' -or $unknown -notmatch 'registry_calls_0"' -or $errors){throw 'Unknown binary did not fail closed'}
$unknown
'PASS unknown hash rejected before registry/assembly load'
Copy-Item -LiteralPath $PclPath -Destination $target -Force
$p=Start-Owned
try {
 $p.StandardInput.WriteLine('{"command":"probe"}');$p.StandardInput.Flush()
 $read=$p.StandardOutput.ReadLineAsync();$lines=[Collections.Generic.List[string]]::new();$deadline=[DateTime]::UtcNow.AddSeconds(35);$initialized=$false;$heartbeats=0
 while([DateTime]::UtcNow -lt $deadline){
  if($read.Wait(250)){
   $line=$read.Result;if($null -eq $line){break};$lines.Add($line);$event=$line|ConvertFrom-Json
   if($event.kind -eq 'heartbeat'){$heartbeats++}
   if($event.stage -eq 'initialized'){$initialized=$true}
   if($initialized -and $heartbeats -ge 2){break}
   $read=$p.StandardOutput.ReadLineAsync()
  }
 }
 if(!$initialized -or $heartbeats -lt 2){$lines;throw 'BLOCKED: runtime initialization or independent heartbeat proof failed'}
 $p.StandardInput.WriteLine('cancel');$p.StandardInput.Flush()
 # Finish outstanding async read before reading the remaining stream.
 if(!$read.IsCompleted){$null=$read.Wait(10000);if($read.IsCompleted -and $read.Result){$lines.Add($read.Result)}}
 if(!$p.WaitForExit(10000)){throw 'Owned cancellation timeout'}
 $tail=$p.StandardOutput.ReadToEnd();if($tail){$lines.Add($tail)}
 $stderr=$p.StandardError.ReadToEnd();$lines
 if($p.ExitCode -ne 0 -or $stderr -or ($lines -join "`n") -notmatch 'registry_cleanup_complete'){throw 'Cancellation/restoration/stderr proof failed'}
 'PASS isolated actual module initialization, helpers/queue, no visible owned HWND, 5 second heartbeat, cancellation and registry restoration'
} finally {if(!$p.HasExited){$p.Kill();$p.WaitForExit()}}
$after=(Get-FileHash -LiteralPath $PclPath -Algorithm SHA256).Hash
if($after -ne $before){throw 'Original source hash changed'}
'PASS original executable hash unchanged'
"Private run artifacts: $base"


# Fault hooks are compiled only into a separate test executable, never Release.
$testWorker=Join-Path $PSScriptRoot 'bin/Test/PclBridge.exe'
if(!(Test-Path $testWorker)){throw 'Missing BRIDGE_TESTS worker; run build.ps1'}
Copy-Item -LiteralPath $testWorker -Destination (Join-Path $base 'PclBridge.exe') -Force
function Own-KeySnapshot {
 $key=[Microsoft.Win32.Registry]::CurrentUser.OpenSubKey('Software\ZhumengPclBridge')
 try {if($key){@($key.GetSubKeyNames() | Sort-Object)}}finally{if($key){$key.Dispose()}}
}
foreach($fault in @('before_sentinel','delete_failure')) {
 $keysBefore=@(Own-KeySnapshot)
 $env:BRIDGE_TEST_FAULT=$fault
 try {$p=Start-Owned}finally{Remove-Item Env:BRIDGE_TEST_FAULT}
 try {
  if($fault -eq 'delete_failure'){$p.StandardInput.WriteLine('{"command":"probe"}');$p.StandardInput.WriteLine('cancel');$p.StandardInput.Flush()}
  if(!$p.WaitForExit(10000)){throw 'Fault cleanup timeout'}
  $output=$p.StandardOutput.ReadToEnd();$stderr=$p.StandardError.ReadToEnd()
  $expected=if($fault -eq 'delete_failure'){31}else{30}
  $stage=if($fault -eq 'delete_failure'){'registry_cleanup_failed'}else{'registry_cleanup_complete'}
  if($p.ExitCode -ne $expected -or $output -notmatch $stage -or $stderr){throw "Fault $fault did not fail/clean as expected"}
  if(@(Compare-Object $keysBefore @(Own-KeySnapshot)).Count){throw "Fault $fault leaked an owned registry subtree"}
  "PASS injected $fault exit=$($p.ExitCode) stage=$stage; owned subtree snapshot unchanged"
 } finally {if(!$p.HasExited){$p.Kill();$p.WaitForExit()}}
}
if((Get-FileHash -LiteralPath $PclPath -Algorithm SHA256).Hash -ne $before){throw 'Original changed after negatives'}
'PASS original hash unchanged after negative cleanup tests'

