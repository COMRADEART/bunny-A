param([string]$PackageName='Bunny-A-Windows-v2')
$ErrorActionPreference='Stop'
$bunnyWorkspace=Split-Path -Parent $PSScriptRoot
$lastBuildPath=Join-Path $bunnyWorkspace 'node_modules/.nitro/last-build.json'
$lastBuildContent=if(Test-Path -LiteralPath $lastBuildPath) {[IO.File]::ReadAllText($lastBuildPath)} else {$null}
if($PackageName -notmatch '^[A-Za-z0-9-]+$') {throw 'Invalid package name.'}
$bunnyBuild=Join-Path $bunnyWorkspace ('test-results/bunny-desktop-build-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$bunnyPackage=Join-Path $bunnyWorkspace ('releases/'+$PackageName)
if(Test-Path -LiteralPath $bunnyPackage) {throw 'Package exists. Use a new name to preserve it.'}
New-Item -ItemType Directory -Path $bunnyBuild -Force | Out-Null
Push-Location $bunnyWorkspace
try {
  foreach($relative in @(git ls-files --cached --others --exclude-standard)) {
    if($relative.StartsWith('artifacts/') -or $relative.StartsWith('.vercel/')) {continue}
    $source=Join-Path $bunnyWorkspace $relative
    if(-not(Test-Path -LiteralPath $source -PathType Leaf)) {continue}
    $target=Join-Path $bunnyBuild $relative
    New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
    Copy-Item -LiteralPath $source -Destination $target
  }
  New-Item -ItemType Junction -Path (Join-Path $bunnyBuild 'node_modules') -Target (Join-Path $bunnyWorkspace 'node_modules') | Out-Null
  $previousPreset=$env:JEV_DESKTOP_BUILD
  try {$env:JEV_DESKTOP_BUILD='1';npm run build --prefix $bunnyBuild;if($LASTEXITCODE -ne 0) {throw 'Bunny-A standalone build failed.'}}
  finally {$env:JEV_DESKTOP_BUILD=$previousPreset}
  New-Item -ItemType Directory -Path $bunnyPackage -Force | Out-Null
  Copy-Item -LiteralPath (Join-Path $bunnyBuild '.output') -Destination (Join-Path $bunnyPackage '.output') -Recurse
  foreach($name in @('Bunny-Host.mjs','Bunny-Server.mjs','Bunny-Island.ps1','Bunny-Island.Visual.ps1','Bunny-Island.Motion.ps1','Launch-Bunny-A.ps1','Launch-Bunny-A.cmd','manifest.mjs')) {Copy-Item -LiteralPath (Join-Path $bunnyWorkspace ('install/'+$name)) -Destination $bunnyPackage}
  # Every folder the Host's import graph reaches (desktop-install.test.mjs checks this list), with subfolders.
  foreach($directory in @('bunny-host','orch','bunny-missions')) {
    $source=(Resolve-Path -LiteralPath (Join-Path $bunnyWorkspace ('src/lib/'+$directory))).Path
    Get-ChildItem -LiteralPath $source -Filter '*.ts' -Recurse -File | Where-Object Name -notlike '*.test.ts' | ForEach-Object {
      $target=Join-Path $bunnyPackage ('src/lib/'+$directory+$_.FullName.Substring($source.Length))
      New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
      Copy-Item -LiteralPath $_.FullName -Destination $target
    }
  }
  # Type-stripped Host files are ESM. No npm install is required for the native Host.
  '{"type":"module"}' | Set-Content -LiteralPath (Join-Path $bunnyPackage 'package.json') -Encoding ascii
  New-Item -ItemType Directory -Path (Join-Path $bunnyPackage 'runtime') -Force | Out-Null
  $nodePath=(Get-Command node).Source
  Copy-Item -LiteralPath $nodePath -Destination (Join-Path $bunnyPackage 'runtime/node.exe')
  $notice=Join-Path $bunnyWorkspace 'releases/installed/JEV-Windows-v1/runtime/LICENSE'
  if(Test-Path -LiteralPath $notice) {Copy-Item -LiteralPath $notice -Destination (Join-Path $bunnyPackage 'runtime/LICENSE')}
  else {throw 'Node runtime license unavailable; package must not ship without it.'}
  Compress-Archive -LiteralPath $bunnyPackage -DestinationPath ($bunnyPackage+'.zip')
  Get-FileHash -LiteralPath ($bunnyPackage+'.zip') -Algorithm SHA256
} finally {if($null -ne $lastBuildContent) {[IO.File]::WriteAllText($lastBuildPath,$lastBuildContent)};Pop-Location}
