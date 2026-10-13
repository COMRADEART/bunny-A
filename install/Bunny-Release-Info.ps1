# Bunny-A release identity (M-A-1D). Answers "which build is running?" from the installed release manifest and
# the live processes, never from a Git checkout. Read-only: it starts, stops and changes nothing.
param([string]$InstallConfig,[switch]$Quick)
$ErrorActionPreference='Stop'
$release=$PSScriptRoot
if(-not $InstallConfig) {$InstallConfig=Join-Path (Split-Path -Parent (Split-Path -Parent $release)) 'install.json'}
$config=if(Test-Path -LiteralPath $InstallConfig) {Get-Content -LiteralPath $InstallConfig -Raw | ConvertFrom-Json} else {$null}
. (Join-Path $release 'Bunny-State.ps1')
$paths=if($config) {Get-BunnyStatePaths $config} else {$null}
$manifestPath=Join-Path $release 'release-manifest.json'
$manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$node=Join-Path $release 'runtime\node.exe'
function Get-GitCheckout([string]$Path) {
  if(-not $Path -or -not(Test-Path -LiteralPath $Path)) {return $null}
  for($folder=Get-Item -LiteralPath $Path;$folder;$folder=$folder.Parent) {if(Test-Path -LiteralPath (Join-Path $folder.FullName '.git')) {return $folder.FullName}}
  $null
}
function Get-ProcessInfo([int]$Id,[string]$Entry) {
  $process=Get-CimInstance Win32_Process -Filter ('ProcessId='+$Id) -ErrorAction SilentlyContinue
  if(-not $process) {return $null}
  [ordered]@{pid=$Id;executable=$process.ExecutablePath;commandLine=$process.CommandLine;started=$process.CreationDate.ToUniversalTime().ToString('o');runtimeFromThisRelease=($process.ExecutablePath -eq $node);entryFromThisRelease=[bool]($Entry -and $process.CommandLine.Contains((Join-Path $release $Entry)))}
}

# Integrity: every file on disk against the manifest (Quick: Host, launcher and runtime files only).
$listed=@{}; foreach($file in $manifest.files) {$listed[$file.path]=$file}
$checked=0; $changed=@(); $missing=@(); $extra=@()
foreach($file in $manifest.files) {
  if($Quick -and $file.origin -notin @('source','tooling','runtime')) {continue}
  $path=Join-Path $release $file.path
  if(-not(Test-Path -LiteralPath $path -PathType Leaf)) {$missing+=$file.path;continue}
  $checked++
  if((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256.ToUpperInvariant()) {$changed+=$file.path}
}
if(-not $Quick) {
  $prefix=$release.TrimEnd('\')+'\'
  foreach($item in Get-ChildItem -LiteralPath $release -Recurse -File) {
    $relative=$item.FullName.Substring($prefix.Length).Replace('\','/')
    if($relative -ne 'release-manifest.json' -and -not $listed.ContainsKey($relative)) {$extra+=$relative}
  }
}

$data=if($paths) {$paths.root} else {$null}
$dataItem=if($data -and (Test-Path -LiteralPath $data)) {Get-Item -LiteralPath $data} else {$null}
$port=if($config -and $config.hostPort) {[int]$config.hostPort} else {43119}
$health=$null; try {$health=Invoke-RestMethod "http://127.0.0.1:$port/health" -TimeoutSec 2} catch {}
$web=$null; try {$web=Invoke-RestMethod 'http://127.0.0.1:8084/bunny-health' -TimeoutSec 2} catch {}
$tunnel=$null
if($paths -and (Test-Path -LiteralPath $paths.tunnelProcess)) {$tunnel=Get-ProcessInfo ([int](Get-Content -LiteralPath $paths.tunnelProcess -Raw | ConvertFrom-Json).pid) 'scripts\bunny-tunnel.mjs'}
$islands=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {$_.CommandLine -match 'Start-Bunny-Release\.ps1|start-bunny-island\.ps1'} | ForEach-Object {[ordered]@{pid=$_.ProcessId;commandLine=$_.CommandLine;fromThisRelease=$_.CommandLine.Contains((Join-Path $release 'Start-Bunny-Release.ps1'))}})
$shortcutPath=if($config -and $config.shortcut) {$config.shortcut} else {Join-Path ([Environment]::GetFolderPath('Startup')) 'Bunny-A.lnk'}
$shortcut=$null
if(Test-Path -LiteralPath $shortcutPath) {$link=(New-Object -ComObject WScript.Shell).CreateShortcut($shortcutPath);$shortcut=[ordered]@{path=$shortcutPath;targetPath=$link.TargetPath;arguments=$link.Arguments;workingDirectory=$link.WorkingDirectory;startsThisRelease=$link.Arguments.Contains((Join-Path $release 'Start-Bunny-Release.ps1'))}}

[ordered]@{
  checkedAt=(Get-Date).ToUniversalTime().ToString('o')
  release=[ordered]@{name=$manifest.release;version=$manifest.version;sourceCommit=$manifest.sourceCommit;toolingCommit=$manifest.toolingCommit;builtAt=$manifest.builtAt;folder=$release;manifestSha256=(Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLower();hostSchemaUserVersion=$manifest.compatibility.hostSchemaUserVersion;insideGitCheckout=(Get-GitCheckout $release)}
  integrity=[ordered]@{ok=(-not($changed.Count+$missing.Count+$extra.Count));manifestMatchesInstall=($config.currentRelease.manifestSha256 -eq (Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash.ToLower());scope=if($Quick) {'host, launcher and runtime files'} else {'all files'};checked=$checked;changed=$changed;missing=$missing;extra=$extra}
  install=if($config) {[ordered]@{config=$InstallConfig;stateLayoutVersion=$config.stateLayoutVersion;stateRoot=$config.stateRoot;dataDirectory=$data;database=$paths.database;credentials=$paths.credentials;cloudflared=$paths.cloudflared;logs=$paths.logs;backups=$paths.backups;stateInsideGitCheckout=(Get-GitCheckout $data);dataDirectoryLinkTarget=if($dataItem -and $dataItem.LinkType) {@($dataItem.Target)[0]} else {$null};workspace=$config.workspace;workspaceInsideGitCheckout=(Get-GitCheckout $config.workspace);currentRelease=$config.currentRelease.name}} else {$null}
  shortcut=$shortcut
  host=if($health) {[ordered]@{instanceId=$health.instanceId;process=(Get-ProcessInfo ([int]$health.pid) 'Bunny-Host.mjs')}} else {$null}
  # The dashboard gateway runs the package named in deployment.json on this release's runtime.
  gateway=if($web) {[ordered]@{root=$web.root;package=if($paths -and (Test-Path -LiteralPath $paths.deployment)) {(Get-Content -LiteralPath $paths.deployment -Raw | ConvertFrom-Json).packagePath} else {$null};process=(Get-ProcessInfo ([int]$web.pid) $null)}} else {$null}
  tunnelWorker=$tunnel
  island=$islands
} | ConvertTo-Json -Depth 6
