$ErrorActionPreference='Stop'
$stageRoot='C:\Users\allam\AppData\Local\Bunny-A-T10-stage'
$repo='C:\Users\allam\Documents\new\bun-router'
$pin=Get-Content -LiteralPath (Join-Path $repo 'install\release-pin.json') -Raw | ConvertFrom-Json
New-Item -ItemType Directory -Path (Join-Path $stageRoot 'startup') -Force | Out-Null
# Establish a private shortcut fixture; the real Windows Startup folder is never written.
if(-not(Test-Path -LiteralPath (Join-Path $stageRoot 'startup\Bunny-A.lnk'))) {
$link=(New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $stageRoot 'startup\Bunny-A.lnk'))
$link.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$link.Arguments='-NoProfile -File "'+(Join-Path $stageRoot ('releases\'+$pin.release+'\Start-Bunny-Release.ps1'))+'"'
$link.WorkingDirectory=$stageRoot
$link.Save()
}
& (Join-Path $repo 'scripts\install-bunny-release.ps1') -Package (Join-Path $repo ('releases\'+$pin.release+'.zip')) -InstallRoot $stageRoot -DataDirectory (Join-Path $stageRoot 'state') -Workspace 'C:\Users\allam\Bunny-Workspace-T10-stage' -StartupDirectory (Join-Path $stageRoot 'startup') -HostPort 45129 | Out-File (Join-Path $PSScriptRoot 'stage-install.json') -Encoding utf8
$env:BUNNY_MISSIONS='1'
& (Join-Path $stageRoot ('releases\'+$pin.release+'\Start-Bunny-Release.ps1')) -NoIsland -NoGateway -NoRemote
Invoke-RestMethod 'http://127.0.0.1:45129/health' | ConvertTo-Json -Depth 8 | Set-Content (Join-Path $PSScriptRoot 'stage-health.json') -Encoding utf8
Write-Output 'T10 exact candidate installed and healthy in disposable root only.'
