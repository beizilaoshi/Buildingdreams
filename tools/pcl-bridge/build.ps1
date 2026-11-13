$ErrorActionPreference = 'Stop'
& "$PSScriptRoot/restore.ps1"
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$vswhere = "${env:ProgramFiles(x86)}/Microsoft Visual Studio/Installer/vswhere.exe"
$msbuild = & $vswhere -utf8 -latest -products '*' -requires Microsoft.Component.MSBuild -find 'MSBuild/**/Bin/MSBuild.exe' | Select-Object -First 1
if (!$msbuild) { throw 'VS MSBuild not installed' }
& $msbuild "$PSScriptRoot/PclBridge.csproj" /t:Build /p:Configuration=Release /nologo /verbosity:minimal
"MSBUILD_EXIT_CODE=$LASTEXITCODE"
if ($LASTEXITCODE) { throw 'Native build failed' }


& $msbuild "$PSScriptRoot/PclBridge.csproj" /t:Rebuild /p:Configuration=Release /p:DefineConstants=BRIDGE_TESTS /p:OutputPath=bin/Test/ /nologo /verbosity:minimal
"MSBUILD_EXIT_CODE=$LASTEXITCODE"
if ($LASTEXITCODE) { throw 'Native test build failed' }

