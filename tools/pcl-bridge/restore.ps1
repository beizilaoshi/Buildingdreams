$ErrorActionPreference='Stop'
$version='2.4.3'
$hash='F07AF11A0D62447E7E1B6E3FCF1E28FC75D9F8D1ABF2D6EE79AABCDC4DB43E88'
$vendor=Join-Path $PSScriptRoot 'vendor'
$archive=Join-Path $vendor "lib.harmony.$version.nupkg"
New-Item -ItemType Directory -Force $vendor|Out-Null
if(!(Test-Path -LiteralPath $archive)){Invoke-WebRequest "https://api.nuget.org/v3-flatcontainer/lib.harmony/$version/lib.harmony.$version.nupkg" -OutFile $archive}
if((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $hash){throw 'Harmony package pin mismatch'}
# Expand only the pinned official archive, into the local ignored dependency tree.
$zip=Join-Path $vendor 'package.zip';Copy-Item -LiteralPath $archive -Destination $zip -Force
Expand-Archive -LiteralPath $zip -DestinationPath (Join-Path $vendor 'package') -Force
if(!(Test-Path -LiteralPath "$vendor/package/lib/net48/0Harmony.dll")){throw 'Pinned Harmony net48 asset missing'}
