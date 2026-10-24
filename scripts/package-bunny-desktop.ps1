param(
  [string]$PackageName,
  # Explicit prerelease metadata for a disposable test package; installed release pins stay unchanged.
  [string]$TestVersion,
  # Pinned build input (M-A-1D): every runtime file comes from `git archive` of this commit, never from the
  # working tree, so a branch switch or an uncommitted edit cannot reach a release. Defaults to install/release-pin.json.
  [string]$SourceCommit,
  # Commit holding the release launcher and release tools (install/Start-Bunny-Release.ps1, Bunny-Release-Info.ps1).
  [string]$ToolingCommit='HEAD',
  [string]$Repository=(Split-Path -Parent $PSScriptRoot),
  [string]$OutputDirectory,
  # Tests only: skip the dashboard (Vite/Nitro) build. The installer refuses such a package unless told it is a test.
  [switch]$SkipDashboardBuild,
  [switch]$NoArchive
)
$ErrorActionPreference='Stop'
function Invoke-Git([string[]]$Arguments) {
  $output=& git -C $Repository @Arguments
  if($LASTEXITCODE -ne 0) {throw ('git '+($Arguments -join ' ')+' failed.')}
  $output
}
function Export-Commit([string]$Commit,[string]$Destination,[string[]]$Paths) {
  # core.autocrlf=false: files are the exact committed bytes, so their hashes can be checked against git blobs.
  $tar=Join-Path ([IO.Path]::GetTempPath()) ('bunny-release-'+[guid]::NewGuid().ToString('N')+'.tar')
  try {
    & git -C $Repository -c core.autocrlf=false archive --format=tar -o $tar $Commit @Paths
    if($LASTEXITCODE -ne 0) {throw "git archive $Commit failed."}
    New-Item -ItemType Directory -Path $Destination -Force | Out-Null
    & (Join-Path $env:WINDIR 'System32/tar.exe') -xf $tar -C $Destination
    if($LASTEXITCODE -ne 0) {throw "Extracting $Commit failed."}
  } finally {Remove-Item -LiteralPath $tar -Force -ErrorAction SilentlyContinue}
}
$toolingSha=(Invoke-Git @('rev-parse','--verify',($ToolingCommit+'^{commit}'))).Trim()
$pin=(Invoke-Git @('-c','core.autocrlf=false','show',($toolingSha+':install/release-pin.json'))) -join "`n" | ConvertFrom-Json
if(-not $PackageName) {$PackageName=$pin.release}
if(-not $SourceCommit) {$SourceCommit=$pin.sourceCommit}
if($PackageName -notmatch '^[A-Za-z0-9-]+$') {throw 'Invalid package name.'}
if($TestVersion) {
  if($PackageName -notmatch '-TEST$' -or $TestVersion -notmatch '^\d+\.\d+\.\d+-[A-Za-z0-9.-]+$') {throw 'TestVersion requires a named TEST package and prerelease version.'}
  $pin.version=$TestVersion
}
$sourceSha=(Invoke-Git @('rev-parse','--verify',($SourceCommit+'^{commit}'))).Trim()
$bunnyWorkspace=(Resolve-Path -LiteralPath $Repository).Path
if(-not $OutputDirectory) {$OutputDirectory=Join-Path $bunnyWorkspace 'releases'}
$lastBuildPath=Join-Path $bunnyWorkspace 'node_modules/.nitro/last-build.json'
$lastBuildContent=if(Test-Path -LiteralPath $lastBuildPath) {[IO.File]::ReadAllText($lastBuildPath)} else {$null}
$bunnyBuild=Join-Path $bunnyWorkspace ('test-results/bunny-release-build-'+(Get-Date -Format 'yyyyMMdd-HHmmss'))
$bunnyTooling=$bunnyBuild+'-tooling'
$bunnyPackage=Join-Path $OutputDirectory $PackageName
if(Test-Path -LiteralPath $bunnyPackage) {throw 'Package exists. Use a new name to preserve it.'}
$toolingFiles=@('install/Start-Bunny-Release.ps1','install/Bunny-Release-Info.ps1','install/Bunny-State.ps1','install/release-pin.json','scripts/migrate-bunny-state.ps1','scripts/bunny-state-migration.mjs','scripts/install-bunny-release.ps1')
& git -C $Repository cat-file -e ($toolingSha+':scripts/bunny-rollback-preflight.mjs') 2>$null
if($LASTEXITCODE -eq 0) {$toolingFiles+=@('scripts/bunny-rollback-preflight.mjs')}
$origins=New-Object System.Collections.ArrayList
function Add-PackageFile([string]$From,[string]$PackagePath,[string]$Origin,[string]$RepoPath) {
  $target=Join-Path $bunnyPackage $PackagePath
  New-Item -ItemType Directory -Path (Split-Path -Parent $target) -Force | Out-Null
  Copy-Item -LiteralPath $From -Destination $target
  [void]$origins.Add([pscustomobject]@{path=$PackagePath;origin=$Origin;repoPath=$RepoPath})
}
try {
  Export-Commit $sourceSha $bunnyBuild @()
  Export-Commit $toolingSha $bunnyTooling $toolingFiles
  if(-not $SkipDashboardBuild) {
    $modules=Join-Path $bunnyWorkspace 'node_modules'
    if(-not(Test-Path -LiteralPath $modules)) {throw 'node_modules is required for the dashboard build.'}
    New-Item -ItemType Junction -Path (Join-Path $bunnyBuild 'node_modules') -Target $modules | Out-Null
    $previousPreset=$env:JEV_DESKTOP_BUILD
    try {$env:JEV_DESKTOP_BUILD='1';npm run build --prefix $bunnyBuild;if($LASTEXITCODE -ne 0) {throw 'Bunny-A standalone build failed.'}}
    finally {$env:JEV_DESKTOP_BUILD=$previousPreset}
  }
  New-Item -ItemType Directory -Path $bunnyPackage -Force | Out-Null
  # T4 native ownership is built only from the pinned archive's auditable C source.
  # No working-tree binary or downloaded prebuilt module can enter this release.
  if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'native/bunny-owned-process.c')) {
    & node (Join-Path $bunnyBuild 'scripts/build-owned-process.mjs') $bunnyBuild | Out-Null
    if($LASTEXITCODE -ne 0) {throw 'Windows ownership native build failed.'}
    foreach($name in @('native/bunny-owned-process.c','native/README.md','scripts/build-owned-process.mjs')) {Add-PackageFile (Join-Path $bunnyBuild $name) $name 'source' $name}
    foreach($name in @('native/bunny-owned-process.node','native/bunny-owned-process.node.json')) {Add-PackageFile (Join-Path $bunnyBuild $name) $name 'generated' $null}
  }
  # M-A-3 T10: the voice worker is compiled only from the pinned archive's C# source with the Windows csc (no prebuilt
  # working-tree binary). The Host refuses to launch it unless the release manifest lists the same sha256.
  if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'native/voice/BunnyVoiceWorker.cs')) {
    Remove-Item -LiteralPath (Join-Path $bunnyBuild 'native/voice/bunny-voice-worker.exe') -Force -ErrorAction SilentlyContinue
    # The pinned archive carries no gitignored vendor folder. When it pins whisper, the pin-verified runtime DLLs, model and
    # headers are copied from the workspace's staged vendor folder into the build tree first, so the shim is compiled here
    # from the archive's whisper-shim.c and recorded in this build's own record (never a prebuilt working-tree shim).
    $buildPin=Join-Path $bunnyBuild 'native/voice/whisper-pin.json'
    if(Test-Path -LiteralPath $buildPin) {
      $pinInputs=Get-Content -LiteralPath $buildPin -Raw | ConvertFrom-Json
      $vendorFrom=Join-Path $bunnyWorkspace 'native/voice/vendor'
      $vendorTo=Join-Path $bunnyBuild 'native/voice/vendor'
      $runtimeTo=Join-Path $vendorTo 'runtime'
      New-Item -ItemType Directory -Path (Join-Path $runtimeTo 'models') -Force | Out-Null
      $inputs=@()
      foreach($property in $pinInputs.runtimeFiles.PSObject.Properties) {$inputs+=@{name=$property.Name;sha=[string]$property.Value}}
      $inputs+=@{name=('models/'+$pinInputs.model.name);sha=[string]$pinInputs.model.sha256}
      foreach($entry in $inputs) {
        $from=Join-Path (Join-Path $vendorFrom 'runtime') $entry.name
        if(-not (Test-Path -LiteralPath $from)) {throw ('Whisper runtime is not staged (missing '+$entry.name+'); run scripts/stage-whisper.mjs first.')}
        if((Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash.ToLower() -ne $entry.sha.ToLower()) {throw ('Staged whisper file differs from the pin: '+$entry.name)}
        Copy-Item -LiteralPath $from -Destination (Join-Path $runtimeTo $entry.name)
      }
      $headerFrom=Join-Path $vendorFrom 'whisper-src-v1.9.4'
      if(-not (Test-Path -LiteralPath $headerFrom)) {throw 'Pinned whisper.cpp headers are not staged; run scripts/stage-whisper.mjs first.'}
      foreach($relative in @('whisper.cpp-1.9.4/include','whisper.cpp-1.9.4/ggml/include')) {
        $to=Join-Path (Join-Path $vendorTo 'whisper-src-v1.9.4') $relative
        New-Item -ItemType Directory -Path (Split-Path -Parent $to) -Force | Out-Null
        Copy-Item -LiteralPath (Join-Path $headerFrom $relative) -Destination $to -Recurse
      }
    }
    & node (Join-Path $bunnyBuild 'scripts/build-voice-worker.mjs') $bunnyBuild | Out-Null
    if($LASTEXITCODE -ne 0) {throw 'Bunny voice worker build failed.'}
    foreach($name in @('native/voice/BunnyVoiceWorker.cs','native/voice/README.md','scripts/build-voice-worker.mjs')) {Add-PackageFile (Join-Path $bunnyBuild $name) $name 'source' $name}
    foreach($name in @('native/voice/bunny-voice-worker.exe','native/voice/bunny-voice-worker.json')) {Add-PackageFile (Join-Path $bunnyBuild $name) $name 'generated' $null}
  }
  # M-A-3 T10 whisper recognizer: the pinned runtime is copied from the workspace's staged vendor folder (stage-whisper.mjs
  # verifies it against native/voice/whisper-pin.json). Nothing is downloaded here, and every copied file is hash-checked
  # against the pin before it enters the release. Older pinned sources have no pin and package without it.
  $whisperPin=Join-Path $bunnyBuild 'native/voice/whisper-pin.json'
  if(Test-Path -LiteralPath $whisperPin) {
    $pinData=Get-Content -LiteralPath $whisperPin -Raw | ConvertFrom-Json
    # The runtime staged into the build tree above: pin-verified DLLs and model plus the shim compiled in this build.
    $stagedRuntime=Join-Path $bunnyBuild 'native/voice/vendor/runtime'
    $shimRecord=(Get-Content -LiteralPath (Join-Path $bunnyBuild 'native/voice/bunny-voice-worker.json') -Raw | ConvertFrom-Json).whisperShim
    if(-not $shimRecord -or -not (Test-Path -LiteralPath $stagedRuntime)) {throw 'Whisper runtime is not staged; run scripts/stage-whisper.mjs first.'}
    $whisperFiles=@(@{name='bunny-whisper-shim.dll';sha=[string]$shimRecord.binarySha256})
    foreach($property in $pinData.runtimeFiles.PSObject.Properties) {$whisperFiles+=@{name=$property.Name;sha=[string]$property.Value}}
    $whisperFiles+=@{name=('models/'+$pinData.model.name);sha=[string]$pinData.model.sha256}
    foreach($entry in $whisperFiles) {
      $from=Join-Path $stagedRuntime $entry.name
      if(-not (Test-Path -LiteralPath $from)) {throw ('Whisper file missing: '+$entry.name)}
      $actual=(Get-FileHash -LiteralPath $from -Algorithm SHA256).Hash.ToLower()
      if($actual -ne ([string]$entry.sha).ToLower()) {throw ('Whisper file differs from the pin: '+$entry.name)}
      Add-PackageFile $from ('native/voice/vendor/runtime/'+$entry.name) 'vendor' $null
    }
    Add-PackageFile $whisperPin 'native/voice/whisper-pin.json' 'source' 'native/voice/whisper-pin.json'
  }
  if(-not $SkipDashboardBuild) {Copy-Item -LiteralPath (Join-Path $bunnyBuild '.output') -Destination (Join-Path $bunnyPackage '.output') -Recurse}
  foreach($name in @('Bunny-Host.mjs','Bunny-Server.mjs','Bunny-Island.ps1','Bunny-Island.Visual.ps1','Bunny-Island.Motion.ps1','Launch-Bunny-A.ps1','Launch-Bunny-A.cmd','manifest.mjs')) {Add-PackageFile (Join-Path $bunnyBuild ('install/'+$name)) $name 'source' ('install/'+$name)}
  # Older pinned rollback sources predate the presentation helper.
  if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'install/Bunny-Island.Presentation.ps1')) {Add-PackageFile (Join-Path $bunnyBuild 'install/Bunny-Island.Presentation.ps1') 'Bunny-Island.Presentation.ps1' 'source' 'install/Bunny-Island.Presentation.ps1'}
  # M-A-3 T10 notch placement and native voice layers; older pinned sources predate them.
  # T13 sources require all three native modules and their art. Historical rollback pins predate characters.
  if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'install/Bunny-Island.Characters.ps1')) {
    foreach($name in @('Bunny-Island.Characters.ps1','Bunny-Island.Companion.ps1','Bunny-Island.Weapons.ps1')) {Add-PackageFile (Join-Path $bunnyBuild ('install/'+$name)) $name 'source' ('install/'+$name)}
    $characterSource=Join-Path $bunnyBuild 'public/bunny-a/characters'
    if(-not(Test-Path -LiteralPath $characterSource -PathType Container)) {throw 'Bunny character art is missing from the build.'}
    foreach($item in @(Get-ChildItem -LiteralPath $characterSource -Filter '*.png' -File)) {Add-PackageFile $item.FullName ('characters/'+$item.Name) 'source' ('public/bunny-a/characters/'+$item.Name)}
  }
  foreach($name in @('Bunny-Island.Placement.ps1','Bunny-Island.Voice.ps1','Bunny-Island.Theme.ps1')) {if(Test-Path -LiteralPath (Join-Path $bunnyBuild ('install/'+$name))) {Add-PackageFile (Join-Path $bunnyBuild ('install/'+$name)) $name 'source' ('install/'+$name)}}
  # The tunnel worker runs from the release too, so remote access never starts code from a checkout.
  foreach($name in @('bunny-tunnel.mjs','bunny-tunnel-state.mjs','bunny-tunnel-paths.mjs','bunny-tunnel-worker.mjs')) {if(Test-Path -LiteralPath (Join-Path $bunnyBuild ('scripts/'+$name))) {Add-PackageFile (Join-Path $bunnyBuild ('scripts/'+$name)) ('scripts/'+$name) 'source' ('scripts/'+$name)}}
  foreach($relative in $toolingFiles) {$destination=if($relative.StartsWith('install/')) {Split-Path -Leaf $relative} else {$relative};Add-PackageFile (Join-Path $bunnyTooling $relative) $destination 'tooling' $relative}
  # Every folder the Host's import graph reaches (desktop-install.test.mjs checks this list), with subfolders.
  foreach($directory in @('bunny-host','orch','bunny-missions')) {
    $source=(Resolve-Path -LiteralPath (Join-Path $bunnyBuild ('src/lib/'+$directory))).Path
    Get-ChildItem -LiteralPath $source -Filter '*.ts' -Recurse -File | Where-Object Name -notlike '*.test.ts' | ForEach-Object {
      $relative=('src/lib/'+$directory+$_.FullName.Substring($source.Length)).Replace('\','/')
      Add-PackageFile $_.FullName $relative 'source' $relative
    }
  }
  # T6 includes the actual browser API runtime; never resolve it from a development checkout.
  $browserRuntime=$null
  if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'src/lib/bunny-missions/cross-app.ts')) {
    $browserRuntime=(& node (Join-Path $bunnyBuild 'scripts/package-browser-runtime.mjs') $bunnyBuild $bunnyWorkspace $bunnyPackage) | ConvertFrom-Json
    if($LASTEXITCODE -ne 0) {throw 'Pinned browser runtime export failed.'}
    foreach($item in $browserRuntime.origins) {[void]$origins.Add($item)}
  }
  # MA4 schemas execute in the standalone Host, outside the bundled dashboard.
  $hostRuntime=$null
  if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'src/lib/bunny-host/ma4/registry.ts')) {
    $hostRuntime=(& node (Join-Path $bunnyBuild 'scripts/package-host-runtime.mjs') $bunnyBuild $bunnyWorkspace $bunnyPackage) | ConvertFrom-Json
    if($LASTEXITCODE -ne 0) {throw 'Pinned Host runtime export failed.'}
    foreach($item in $hostRuntime.origins) {[void]$origins.Add($item)}
  }
  # Type-stripped Host files are ESM. Runtime dependencies are shipped; no npm install is required.
  '{"type":"module"}' | Set-Content -LiteralPath (Join-Path $bunnyPackage 'package.json') -Encoding ascii
  New-Item -ItemType Directory -Path (Join-Path $bunnyPackage 'runtime') -Force | Out-Null
  $nodePath=(Get-Command node).Source
  Copy-Item -LiteralPath $nodePath -Destination (Join-Path $bunnyPackage 'runtime/node.exe')
  # The Node installer ships no license file; the licensed runtime notice is kept with this packaging script's workspace.
  $notice=Join-Path (Split-Path -Parent $nodePath) 'LICENSE'
  if(-not(Test-Path -LiteralPath $notice)) {$notice=Join-Path (Split-Path -Parent $PSScriptRoot) 'releases/installed/JEV-Windows-v1/runtime/LICENSE'}
  if(Test-Path -LiteralPath $notice) {Copy-Item -LiteralPath $notice -Destination (Join-Path $bunnyPackage 'runtime/LICENSE')}
  else {throw 'Node runtime license unavailable; package must not ship without it.'}
  $lock=Join-Path $bunnyBuild 'package-lock.json'
  $build=[ordered]@{
    builtAt=(Get-Date).ToUniversalTime().ToString('o')
    node=(& $nodePath --version)
    os=[Environment]::OSVersion.VersionString
    dashboardBuild=(-not $SkipDashboardBuild)
    packageLockSha256=if(Test-Path -LiteralPath $lock) {(Get-FileHash -LiteralPath $lock -Algorithm SHA256).Hash.ToLower()} else {$null}
    dashboardDependencies='node_modules of the build machine workspace (not reinstalled)'
    hostRuntime=if($hostRuntime) {$hostRuntime.packages} else {$null}
    browserRuntime=if($browserRuntime) {$browserRuntime.packages} else {$null}
    browserExecutable=if($browserRuntime) {$browserRuntime.browserExecutable} else {$null}
  }
  $layoutVersion=if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'src/lib/bunny-host/state-paths.server.ts')) {2} else {1}
  $compatibility=[ordered]@{hostEntry='Bunny-Host.mjs';launcher='Start-Bunny-Release.ps1';hostPortDefault=43119;stateLayoutVersion=$layoutVersion;databaseSchemaVersion=3;codexCompatibilityPolicyVersion=1;hostFailurePolicyVersion=1}
  if(Test-Path -LiteralPath (Join-Path $bunnyBuild 'native/bunny-owned-process.c')) {$compatibility.gitProcessOwnershipPolicyVersion=1}
  # M-A-3 T9R-F04: provider sessions and probes run in the reduced-access, stdin-capable job helper.
  if((Test-Path -LiteralPath (Join-Path $bunnyBuild 'native/bunny-owned-process.c')) -and (Select-String -LiteralPath (Join-Path $bunnyBuild 'native/bunny-owned-process.c') -SimpleMatch 'OWNED_JOB_ACCESS' -Quiet)) {$compatibility.providerProcessContainmentPolicyVersion=1}
  $record=[ordered]@{release=$PackageName;version=$pin.version;sourceCommit=$sourceSha;toolingCommit=$toolingSha;builtAt=$build.builtAt;build=$build;compatibility=$compatibility;origins=$origins}
  [IO.File]::WriteAllText((Join-Path $bunnyPackage '.release-build.json'),($record | ConvertTo-Json -Depth 6))
  $helper=Join-Path $PSScriptRoot 'bunny-release.mjs'
  & $nodePath $helper manifest $bunnyPackage | Out-Null; if($LASTEXITCODE -ne 0) {throw 'Release manifest failed.'}
  foreach($check in @(@('verify',$bunnyPackage),@('closure',$bunnyPackage),@('source-check',$bunnyWorkspace,$bunnyPackage))) {
    & $nodePath $helper @check | Out-Null
    if($LASTEXITCODE -ne 0) {throw ('Release check failed: '+$check[0])}
  }
  if(-not $NoArchive) {
    $zip=$bunnyPackage+'.zip'
    for($attempt=1;;$attempt++) {
      try {Compress-Archive -LiteralPath $bunnyPackage -DestinationPath $zip;break}
      catch {if($attempt -ge 3) {throw};Remove-Item -LiteralPath $zip -Force -ErrorAction SilentlyContinue;Start-Sleep -Seconds 2}
    }
    $hash=(Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLower()
    [IO.File]::WriteAllText($zip+'.sha256',$hash+'  '+(Split-Path -Leaf $zip)+"`n")
    [pscustomobject]@{package=$zip;sha256=$hash;sourceCommit=$sourceSha;toolingCommit=$toolingSha}
  } else {[pscustomobject]@{package=$bunnyPackage;sourceCommit=$sourceSha;toolingCommit=$toolingSha}}
} finally {if($null -ne $lastBuildContent) {[IO.File]::WriteAllText($lastBuildPath,$lastBuildContent)}}
