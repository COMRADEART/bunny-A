# Shared installed-state contract. No state path is derived from the development checkout.
$ErrorActionPreference='Stop'
function Test-BunnyInside([string]$Path,[string]$Folder) {
  $p=[IO.Path]::GetFullPath($Path).TrimEnd('\')+'\';$f=[IO.Path]::GetFullPath($Folder).TrimEnd('\')+'\'
  $p.StartsWith($f,[StringComparison]::OrdinalIgnoreCase)
}
function Assert-BunnyDirectory([string]$Path) {
  $full=[IO.Path]::GetFullPath($Path)
  for($folder=$full;$folder;$folder=[IO.Path]::GetDirectoryName($folder)) {
    if(Test-Path -LiteralPath (Join-Path $folder '.git')) {throw "Installed Bunny paths must be outside Git: $folder"}
    if(Test-Path -LiteralPath $folder) {
      $item=Get-Item -LiteralPath $folder -Force
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw "Installed Bunny paths cannot use a directory link: $folder"}
    }
  }
  $full
}
function Assert-BunnyTree([string]$Folder) {
  [void](Assert-BunnyDirectory $Folder)
  $pending=New-Object 'System.Collections.Generic.Stack[string]'
  $pending.Push($Folder)
  while($pending.Count) {
    foreach($item in Get-ChildItem -LiteralPath $pending.Pop() -Force) {
      if($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {throw "Installed Bunny files cannot use a link: $($item.FullName)"}
      if($item.PSIsContainer) {$pending.Push($item.FullName)}
    }
  }
}
function Get-BunnyStatePaths($Config) {
  if($Config.stateLayoutVersion -ne 2 -or $Config.schema -ne 'bunny-install/2') {throw 'Bunny state migration is required. This launcher requires bunny-install/2.'}
  $state=Assert-BunnyDirectory $Config.stateRoot
  if([IO.Path]::GetFullPath($Config.dataDirectory) -ne $state) {throw 'Bunny dataDirectory must equal its canonical stateRoot.'}
  [ordered]@{
    root=$state;database=(Join-Path $state 'host.sqlite');marker=(Join-Path $state 'state-layout.json')
    credentials=(Join-Path $state 'credentials\credentials.json');deployment=(Join-Path $state 'settings\deployment.json')
    consent=(Join-Path $state 'settings\remote-consent.json');remote=(Join-Path $state 'settings\remote.json')
    preferences=(Join-Path $state 'settings\island-ui.json');tunnelConfig=(Join-Path $state 'settings\tunnel.json')
    tunnelProcess=(Join-Path $state 'runtime\tunnel-process.json');cloudflared=(Join-Path $state 'cloudflared\cloudflared.exe')
    toolRecord=(Join-Path $state 'cloudflared\tool.json');logs=(Join-Path $state 'logs');backups=(Join-Path $state 'backups')
  }
}
function Assert-BunnyRelease([string]$Folder,$Identity) {
  [void](Assert-BunnyDirectory $Folder)
  Assert-BunnyTree $Folder
  $manifestPath=Join-Path $Folder 'release-manifest.json'
  if(-not $Identity -or $Identity.folder -ne $Folder -or -not $Identity.manifestSha256) {throw 'Installed release identity is missing or belongs to another folder.'}
  if((Get-FileHash -LiteralPath $manifestPath -Algorithm SHA256).Hash -ne $Identity.manifestSha256.ToUpperInvariant()) {throw 'Installed release manifest does not match install.json. Nothing was started.'}
  $manifest=Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
  if($manifest.release -ne $Identity.name -or $manifest.sourceCommit -ne $Identity.sourceCommit) {throw 'Installed release metadata does not match install.json.'}
  $listed=@{}
  foreach($file in $manifest.files) {
    $path=[IO.Path]::GetFullPath((Join-Path $Folder $file.path))
    if(-not(Test-BunnyInside $path $Folder) -or $listed.ContainsKey($path)) {throw 'Invalid or duplicate path in the release manifest.'}
    $listed[$path]=$true
    if(-not(Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.sha256.ToUpperInvariant()) {throw "Bunny-A release file changed or missing: $($file.path). Nothing was started."}
  }
  foreach($item in Get-ChildItem -LiteralPath $Folder -Recurse -File -Force) {
    if($item.FullName -ne $manifestPath -and -not $listed.ContainsKey($item.FullName)) {throw "Unexpected installed release file: $($item.FullName). Nothing was started."}
  }
  $manifest
}
function Set-BunnyStateEnvironment($Paths,[int]$Port) {
  $env:BUNNY_STATE_LAYOUT='2'
  $env:BUNNY_HOST_DATA_DIRECTORY=$Paths.root
  $env:BUNNY_HOST_CREDENTIALS_FILE=$Paths.credentials
  $env:BUNNY_HOST_PORT=[string]$Port
  $env:BUNNY_REMOTE_CONFIG=$Paths.remote
  $env:BUNNY_TUNNEL_CONFIG=$Paths.tunnelConfig
  $env:BUNNY_TUNNEL_PROCESS_FILE=$Paths.tunnelProcess
  $env:BUNNY_CLOUDFLARED_BINARY=$Paths.cloudflared
  $env:BUNNY_ROOT=$Paths.root
  Remove-Item Env:BUNNY_CLOUDFLARED_SHA256 -ErrorAction SilentlyContinue
  if(Test-Path -LiteralPath $Paths.toolRecord) {$env:BUNNY_CLOUDFLARED_SHA256=(Get-Content -LiteralPath $Paths.toolRecord -Raw | ConvertFrom-Json).sha256}
}
function Write-BunnyJson([string]$Path,$Value) {
  $temp=$Path+'.'+[guid]::NewGuid().ToString('N')+'.tmp'
  [IO.File]::WriteAllText($temp,($Value | ConvertTo-Json -Depth 12),[Text.UTF8Encoding]::new($false))
  if(Test-Path -LiteralPath $Path) {[IO.File]::Replace($temp,$Path,[System.Management.Automation.Language.NullString]::Value)} else {[IO.File]::Move($temp,$Path)}
}
