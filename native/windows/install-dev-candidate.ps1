# MA5-S1: per-user install, replacement and uninstall of a Windows development candidate (package-dev-candidate.ps1).
# It never touches the owner's Bunny-A install, the Host, its credentials, Bunny A settings or any project folder.
param(
  [string]$Package,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\BunnyA-DevCandidate'),
  [string]$ShortcutDirectory = (Join-Path ([Environment]::GetFolderPath('Programs')) 'Bunny A (Dev Candidate)'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$shortcut = Join-Path $ShortcutDirectory 'Bunny A (Dev Candidate).lnk'
$marker = Join-Path $InstallRoot 'install.json'

function Test-Inside([string]$Path, [string]$Folder) {
  ([IO.Path]::GetFullPath($Path).TrimEnd('\') + '\').StartsWith([IO.Path]::GetFullPath($Folder).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
# Protected locations: the owner's release install, its Bunny A settings and the Host's credentials.
foreach ($protected in @((Join-Path $env:LOCALAPPDATA 'Bunny-A'), (Join-Path $env:LOCALAPPDATA 'BunnyA'), (Join-Path $env:APPDATA 'bunny-a'))) {
  if ((Test-Inside $InstallRoot $protected) -or (Test-Inside $protected $InstallRoot)) { throw "Refusing to install at $InstallRoot (overlaps $protected)." }
}
for ($f = $InstallRoot; $f; $f = [IO.Path]::GetDirectoryName($f)) { if (Test-Path -LiteralPath (Join-Path $f '.git')) { throw 'Refusing to install inside a Git checkout.' } }
function Assert-NotRunning {
  $running = @(Get-CimInstance Win32_Process -Filter "Name='BunnyA.exe'" | Where-Object { $_.ExecutablePath -and (Test-Inside $_.ExecutablePath $InstallRoot) })
  if ($running.Count) { throw ("Bunny A is running from $InstallRoot (pid " + ($running.ProcessId -join ', ') + '). Quit it first; nothing was changed.') }
}

if ($Uninstall) {
  Assert-NotRunning
  if (Test-Path -LiteralPath $InstallRoot) {
    # Only a folder this script installed is removed; anything else at that path is left alone.
    if (-not (Test-Path -LiteralPath $marker) -or (Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json).schema -ne 'bunny-windows-dev-install.v1') { throw "$InstallRoot was not installed by this script; nothing was removed." }
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $shortcut) {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if (Test-Inside $target $InstallRoot) { Remove-Item -LiteralPath $shortcut; if (-not (Get-ChildItem -LiteralPath $ShortcutDirectory -Force)) { Remove-Item -LiteralPath $ShortcutDirectory } }
  }
  [ordered]@{ uninstalled = $InstallRoot; removedShortcut = -not (Test-Path -LiteralPath $shortcut) } | ConvertTo-Json -Compress
  return
}

if (-not $Package -or -not (Test-Path -LiteralPath $Package)) { throw 'Name the candidate zip with -Package.' }
Assert-NotRunning
$staging = "$InstallRoot.staging-" + [Guid]::NewGuid().ToString('N')
$previous = "$InstallRoot.previous-" + [Guid]::NewGuid().ToString('N')
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  [IO.Compression.ZipFile]::ExtractToDirectory((Resolve-Path -LiteralPath $Package).Path, $staging)
  $candidate = Get-Content -LiteralPath (Join-Path $staging 'candidate.json') -Raw | ConvertFrom-Json
  if ($candidate.schema -ne 'bunny-windows-dev-candidate.v1') { throw 'Not a Bunny A development candidate.' }
  foreach ($file in $candidate.files) {
    $path = Join-Path $staging $file.path
    if (-not (Test-Path -LiteralPath $path) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Candidate file failed verification: $($file.path)" }
  }
  [IO.File]::WriteAllText((Join-Path $staging 'install.json'), ([ordered]@{
    schema = 'bunny-windows-dev-install.v1'; version = $candidate.version; installedAt = [DateTime]::UtcNow.ToString('o')
    packageSha256 = (Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash.ToLowerInvariant(); files = @($candidate.files).Count
  } | ConvertTo-Json))
  # Replacement swaps whole folders; a failure puts the previous version back.
  $replaced = Test-Path -LiteralPath $InstallRoot
  if ($replaced) { Move-Item -LiteralPath $InstallRoot -Destination $previous }
  try { New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallRoot) | Out-Null; Move-Item -LiteralPath $staging -Destination $InstallRoot }
  catch { if ($replaced) { Move-Item -LiteralPath $previous -Destination $InstallRoot }; throw }
  if ($replaced) { Remove-Item -LiteralPath $previous -Recurse -Force }
  New-Item -ItemType Directory -Force -Path $ShortcutDirectory | Out-Null
  $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
  $link.TargetPath = Join-Path $InstallRoot 'BunnyA.exe'; $link.WorkingDirectory = $InstallRoot; $link.Description = 'Bunny A development candidate'
  $link.Save()
  [ordered]@{ installed = $InstallRoot; version = $candidate.version; replacedPrevious = $replaced; shortcut = $shortcut } | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
