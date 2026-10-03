# Installs a pinned Bunny-A release (M-A-1D) outside any Git checkout and points the logon shortcut at it.
# It never starts or stops a process, and never moves or rewrites the Host database: the existing data
# folder is linked as <InstallRoot>\state\.bunny-a. The shortcut is rewritten last, after rollback materials
# are saved; -Rollback restores the saved shortcut, deployment.json and install.json.
param(
  [string]$Package,
  [string]$InstallRoot=(Join-Path $env:LOCALAPPDATA 'Bunny-A'),
  # Existing Host data folder (credentials, database, remote settings). Kept where it is.
  [string]$DataDirectory,
  [string]$Workspace=(Join-Path $env:USERPROFILE 'Bunny-Workspace'),
  [string]$StartupDirectory=[Environment]::GetFolderPath('Startup'),
  [int]$HostPort=43119,
  # Tests only: accept a package built with -SkipDashboardBuild.
  [switch]$AllowTestPackage,
  [switch]$Rollback,
  [string]$RollbackDirectory
)
$ErrorActionPreference='Stop'
$shortcutPath=Join-Path $StartupDirectory 'Bunny-A.lnk'
$installConfig=Join-Path $InstallRoot 'install.json'
function Get-GitCheckout([string]$Path) {
  $full=[IO.Path]::GetFullPath($Path)
  for($folder=$full;$folder;$folder=[IO.Path]::GetDirectoryName($folder)) {if(Test-Path -LiteralPath (Join-Path $folder '.git')) {return $folder}}
  $null
}
function Test-Inside([string]$Path,[string]$Folder) {
  $p=[IO.Path]::GetFullPath($Path).TrimEnd('\')+'\'; $f=[IO.Path]::GetFullPath($Folder).TrimEnd('\')+'\'
  $p.StartsWith($f,[StringComparison]::OrdinalIgnoreCase)
}
function Get-TreeHashes([string]$Folder) {
  $prefix=(Resolve-Path -LiteralPath $Folder).Path.TrimEnd('\')+'\'
  $hashes=@{}; foreach($item in Get-ChildItem -LiteralPath $Folder -Recurse -File -Force) {$hashes[$item.FullName.Substring($prefix.Length)]=(Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash}
  $hashes
}
function Test-SameTree([string]$Left,[string]$Right) {
  $a=Get-TreeHashes $Left; $b=Get-TreeHashes $Right
  if($a.Count -ne $b.Count) {return $false}
  foreach($key in $a.Keys) {if($b[$key] -ne $a[$key]) {return $false}}
  $true
}
function Test-Release([string]$Folder) {
  $manifest=Get-Content -LiteralPath (Join-Path $Folder 'release-manifest.json') -Raw | ConvertFrom-Json
  $listed=@{}; foreach($file in $manifest.files) {$listed[$file.path.Replace('/','\')]=$file.sha256.ToUpperInvariant()}
  $found=Get-TreeHashes $Folder; $found.Remove('release-manifest.json')
  if($found.Count -ne $listed.Count) {throw "Release $Folder does not match its manifest (file count $($found.Count) vs $($listed.Count))."}
  foreach($key in $listed.Keys) {if($found[$key] -ne $listed[$key]) {throw "Release file does not match its manifest: $key"}}
  $manifest
}
function Save-Shortcut([string]$Destination) {
  if(-not(Test-Path -LiteralPath $shortcutPath)) {return $null}
  Copy-Item -LiteralPath $shortcutPath -Destination (Join-Path $Destination 'Bunny-A.lnk')
  $link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath)
  $saved=[ordered]@{path=$shortcutPath;targetPath=$link.TargetPath;arguments=$link.Arguments;workingDirectory=$link.WorkingDirectory;sha256=(Get-FileHash -LiteralPath $shortcutPath -Algorithm SHA256).Hash.ToLower()}
  [IO.File]::WriteAllText((Join-Path $Destination 'shortcut.json'),($saved | ConvertTo-Json))
  $saved
}

if($Rollback) {
  if(-not $RollbackDirectory) {$RollbackDirectory=@(Get-ChildItem -LiteralPath (Join-Path $InstallRoot 'rollback') -Directory | Sort-Object Name)[-1].FullName}
  $restored=[ordered]@{rollbackDirectory=$RollbackDirectory}
  $savedLink=Join-Path $RollbackDirectory 'Bunny-A.lnk'
  if(Test-Path -LiteralPath $savedLink) {Copy-Item -LiteralPath $savedLink -Destination $shortcutPath -Force;$restored.shortcut=(Get-Content -LiteralPath (Join-Path $RollbackDirectory 'shortcut.json') -Raw | ConvertFrom-Json)}
  elseif(Test-Path -LiteralPath $shortcutPath) {Remove-Item -LiteralPath $shortcutPath;$restored.shortcut='removed (none existed before install)'}
  $savedDeployment=Join-Path $RollbackDirectory 'deployment.json'
  $record=Get-Content -LiteralPath (Join-Path $RollbackDirectory 'rollback.json') -Raw | ConvertFrom-Json
  if((Test-Path -LiteralPath $savedDeployment) -and $record.deploymentPath) {Copy-Item -LiteralPath $savedDeployment -Destination $record.deploymentPath -Force;$restored.deployment=$record.deploymentPath}
  $savedConfig=Join-Path $RollbackDirectory 'install.json'
  if(Test-Path -LiteralPath $savedConfig) {Copy-Item -LiteralPath $savedConfig -Destination $installConfig -Force;$restored.installConfig='previous'}
  elseif(Test-Path -LiteralPath $installConfig) {Move-Item -LiteralPath $installConfig -Destination (Join-Path $RollbackDirectory 'install.rolled-back.json') -Force;$restored.installConfig='none before install; current moved into the rollback folder'}
  $restored.note='Releases, the state link and the workspace were left in place. Restart Bunny-A (stop the running Host, then run the restored shortcut) to use the restored startup.'
  return ([pscustomobject]$restored | ConvertTo-Json -Depth 4)
}

if(-not $Package) {throw 'Specify -Package (a release .zip or folder).'}
if(-not $DataDirectory) {throw 'Specify -DataDirectory, the existing Bunny-A data folder (it is kept where it is).'}
$DataDirectory=(Resolve-Path -LiteralPath $DataDirectory).Path
New-Item -ItemType Directory -Path $InstallRoot -Force | Out-Null
$InstallRoot=(Resolve-Path -LiteralPath $InstallRoot).Path
$Workspace=[IO.Path]::GetFullPath($Workspace)
$releasesRoot=Join-Path $InstallRoot 'releases'
$stateRoot=Join-Path $InstallRoot 'state'
if(Get-GitCheckout $InstallRoot) {throw "The install folder is inside a Git checkout: $(Get-GitCheckout $InstallRoot)"}
if(Get-GitCheckout $Workspace) {throw "The default task workspace must not be inside a Git checkout: $(Get-GitCheckout $Workspace)"}
foreach($forbidden in @($InstallRoot,$DataDirectory)) {if((Test-Inside $Workspace $forbidden) -or (Test-Inside $forbidden $Workspace)) {throw "The default task workspace must be separate from $forbidden."}}

# 1. Release: staged, verified against its manifest, then moved into releases\<name> (never overwritten).
$stamp=Get-Date -Format 'yyyyMMdd-HHmmss'
$staging=Join-Path $InstallRoot ('staging\'+$stamp)
New-Item -ItemType Directory -Path $staging -Force | Out-Null
$packageSha=$null
if($Package -like '*.zip') {
  $packageSha=(Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash.ToLower()
  $sidecar=$Package+'.sha256'
  if(Test-Path -LiteralPath $sidecar) {if((Get-Content -LiteralPath $sidecar -Raw).Split(' ')[0].Trim() -ne $packageSha) {throw 'Package hash does not match its .sha256 file.'}}
  Expand-Archive -LiteralPath $Package -DestinationPath $staging
  $source=@(Get-ChildItem -LiteralPath $staging -Directory)[0].FullName
} else {
  $source=Join-Path $staging (Split-Path -Leaf $Package)
  Copy-Item -LiteralPath $Package -Destination $source -Recurse
}
$manifest=Test-Release $source
if(-not $manifest.build.dashboardBuild -and -not $AllowTestPackage) {throw 'This package has no dashboard build (a test package).'}
$target=Join-Path $releasesRoot $manifest.release
New-Item -ItemType Directory -Path $releasesRoot -Force | Out-Null
if(Test-Path -LiteralPath $target) {
  [void](Test-Release $target)
  if((Get-FileHash -LiteralPath (Join-Path $target 'release-manifest.json')).Hash -ne (Get-FileHash -LiteralPath (Join-Path $source 'release-manifest.json')).Hash) {throw "A different release named $($manifest.release) is already installed."}
  Remove-Item -LiteralPath $staging -Recurse -Force
} else {
  Move-Item -LiteralPath $source -Destination $target
  Remove-Item -LiteralPath $staging -Recurse -Force
  # Installed releases are deployment artifacts: read-only, and checked against the manifest at every launch.
  Get-ChildItem -LiteralPath $target -Recurse -File | ForEach-Object {$_.IsReadOnly=$true}
}
Remove-Item -LiteralPath (Join-Path $InstallRoot 'staging') -Force -ErrorAction SilentlyContinue
$manifestSha=(Get-FileHash -LiteralPath (Join-Path $target 'release-manifest.json') -Algorithm SHA256).Hash.ToLower()

# 2. State root: the existing data folder, linked in place (no copy, no new database).
New-Item -ItemType Directory -Path $stateRoot -Force | Out-Null
$stateData=Join-Path $stateRoot '.bunny-a'
if(Test-Path -LiteralPath $stateData) {
  $item=Get-Item -LiteralPath $stateData -Force
  $linked=if($item.LinkType) {[IO.Path]::GetFullPath(@($item.Target)[0])} else {$item.FullName}
  if($linked.TrimEnd('\') -ne $DataDirectory.TrimEnd('\')) {throw "$stateData already points to $linked, not $DataDirectory."}
} else {New-Item -ItemType Junction -Path $stateData -Target $DataDirectory | Out-Null}
New-Item -ItemType Directory -Path $Workspace -Force | Out-Null

# 3. Rollback materials, before anything the old startup uses is changed.
$rollbackRoot=Join-Path $InstallRoot ('rollback\'+$stamp)
New-Item -ItemType Directory -Path $rollbackRoot -Force | Out-Null
$previousShortcut=Save-Shortcut $rollbackRoot
if(Test-Path -LiteralPath $installConfig) {Copy-Item -LiteralPath $installConfig -Destination (Join-Path $rollbackRoot 'install.json')}
$deploymentPath=Join-Path $DataDirectory 'deployment.json'
$gateway=$null
if(Test-Path -LiteralPath $deploymentPath) {
  Copy-Item -LiteralPath $deploymentPath -Destination (Join-Path $rollbackRoot 'deployment.json')
  $deployment=Get-Content -LiteralPath $deploymentPath -Raw | ConvertFrom-Json
  $gateway=[ordered]@{previous=$deployment.packagePath;current=$deployment.packagePath;relocated=$false}
  # A dashboard package kept inside a checkout is copied, byte for byte, next to the releases.
  if(Get-GitCheckout $deployment.packagePath) {
    $copy=Join-Path $releasesRoot (Split-Path -Leaf $deployment.packagePath)
    if(-not(Test-Path -LiteralPath $copy)) {Copy-Item -LiteralPath $deployment.packagePath -Destination $copy -Recurse;Get-ChildItem -LiteralPath $copy -Recurse -File | ForEach-Object {$_.IsReadOnly=$true}}
    if(-not(Test-SameTree $deployment.packagePath $copy)) {throw "$copy differs from the configured gateway package."}
    [IO.File]::WriteAllText($deploymentPath,([ordered]@{packagePath=$copy} | ConvertTo-Json -Compress))
    $gateway.current=$copy; $gateway.relocated=$true
  }
}
[IO.File]::WriteAllText((Join-Path $rollbackRoot 'rollback.json'),([ordered]@{createdAt=(Get-Date).ToUniversalTime().ToString('o');shortcutPath=$shortcutPath;previousShortcut=$previousShortcut;deploymentPath=if($gateway) {$deploymentPath} else {$null};gateway=$gateway;dataDirectory=$DataDirectory;installedRelease=$target} | ConvertTo-Json -Depth 4))
@"
# Bunny-A startup rollback ($stamp)

Restores the startup that existed before release $($manifest.release) was installed. No Git checkout is involved.

1. Stop the running Host only if it has no active jobs (Bunny-A Island or dashboard shows none), e.g.
   ``Stop-Process -Id <Host pid from Bunny-Release-Info.ps1>``.
2. ``powershell -NoProfile -ExecutionPolicy Bypass -File <repo>\scripts\install-bunny-release.ps1 -Rollback -InstallRoot "$InstallRoot" -RollbackDirectory "$rollbackRoot" -StartupDirectory "$StartupDirectory"``
   (or copy ``Bunny-A.lnk`` from this folder to ``$StartupDirectory`` and ``deployment.json`` back to ``$deploymentPath``).
3. Run the restored shortcut, or sign out and in.

Previous shortcut: $(if($previousShortcut) {$previousShortcut.targetPath+' '+$previousShortcut.arguments} else {'none'})
Previous gateway package: $(if($gateway) {$gateway.previous} else {'none'})
Host data (unchanged, never moved): $DataDirectory
Back up the database before any rollback with a read-only ``VACUUM INTO`` (see the M-A-1D report).
Installed releases are kept: $releasesRoot
"@ | Set-Content -LiteralPath (Join-Path $rollbackRoot 'ROLLBACK.md') -Encoding utf8

# 4. install.json, then the shortcut last: the atomic switch to the pinned release.
$previous=@(); if(Test-Path -LiteralPath $installConfig) {$old=Get-Content -LiteralPath $installConfig -Raw | ConvertFrom-Json;if($old.currentRelease) {$previous=@($old.previousReleases)+@($old.currentRelease) | Where-Object {$_}}}
$config=[ordered]@{
  schema='bunny-install/1';installedAt=(Get-Date).ToUniversalTime().ToString('o');installRoot=$InstallRoot;stateRoot=$stateRoot;dataDirectory=$DataDirectory
  dataDirectoryInsideGitCheckout=(Get-GitCheckout $DataDirectory);workspace=$Workspace;hostPort=$HostPort;shortcut=$shortcutPath;rollbackDirectory=$rollbackRoot
  currentRelease=[ordered]@{name=$manifest.release;version=$manifest.version;folder=$target;sourceCommit=$manifest.sourceCommit;toolingCommit=$manifest.toolingCommit;manifestSha256=$manifestSha;packageSha256=$packageSha}
  previousReleases=@($previous)
}
[IO.File]::WriteAllText($installConfig,($config | ConvertTo-Json -Depth 5))
$launcher=Join-Path $target 'Start-Bunny-Release.ps1'
$shell=New-Object -ComObject WScript.Shell
$shortcut=$shell.CreateShortcut($shortcutPath)
$shortcut.TargetPath=Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
$shortcut.Arguments='-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "'+$launcher+'"'
$shortcut.WorkingDirectory=$target
$shortcut.WindowStyle=7
$shortcut.Description="Start the pinned Bunny-A release $($manifest.release) ($($manifest.sourceCommit.Substring(0,7))) at Windows login; dashboard stays closed."
$shortcut.Save()
[pscustomobject]@{release=$manifest.release;folder=$target;sourceCommit=$manifest.sourceCommit;manifestSha256=$manifestSha;packageSha256=$packageSha;shortcut=$shortcutPath;launcher=$launcher;stateRoot=$stateRoot;dataDirectory=$DataDirectory;workspace=$Workspace;gateway=$gateway;rollbackDirectory=$rollbackRoot} | ConvertTo-Json -Depth 4
