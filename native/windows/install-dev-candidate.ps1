# MA5-S1: per-user install, replacement and uninstall of a Windows development candidate (package-dev-candidate.ps1).
# It never touches the owner's Bunny-A install, the Host, its credentials, Bunny A settings or any project folder.
# S1R1: an existing folder is replaced or removed only when its install.json proves this script installed it there and
# it holds nothing the marker does not list; anything else at the path is refused and left exactly as it was.
param(
  [string]$Package,
  [string]$ExpectedSha256,
  [string]$InstallRoot = (Join-Path $env:LOCALAPPDATA 'Programs\BunnyA-DevCandidate'),
  [string]$ShortcutDirectory = (Join-Path ([Environment]::GetFolderPath('Programs')) 'Bunny A (Dev Candidate)'),
  [switch]$Uninstall
)
$ErrorActionPreference = 'Stop'
$InstallRoot = [IO.Path]::GetFullPath($InstallRoot).TrimEnd('\')
$shortcut = Join-Path $ShortcutDirectory 'Bunny A (Dev Candidate).lnk'
$marker = Join-Path $InstallRoot 'install.json'
$markerSchema = 'bunny-windows-dev-install.v1'
$product = 'bunny-a-windows-dev-candidate'
# Test-only fault injection (S1R1 rollback tests); unset in normal use.
$fault = $env:BUNNY_DEV_INSTALL_FAULT

function Test-Inside([string]$Path, [string]$Folder) {
  ([IO.Path]::GetFullPath($Path).TrimEnd('\') + '\').StartsWith([IO.Path]::GetFullPath($Folder).TrimEnd('\') + '\', [StringComparison]::OrdinalIgnoreCase)
}
function Test-Link($Item) { [bool]($Item.Attributes -band [IO.FileAttributes]::ReparsePoint) }
# A relative path inside a package or marker: forward slashes, no rooting, no "..", no drive or stream colon.
function Test-SafeRelative([string]$Path) { $Path -and $Path -notmatch '(^|[\\/])\.\.([\\/]|$)|:|^[\\/]' }
# Lists a folder's entries without ever following a junction or link: those are returned, not entered.
function Get-Entries([string]$Folder) {
  foreach ($item in Get-ChildItem -LiteralPath $Folder -Force) {
    $item
    if ($item.PSIsContainer -and -not (Test-Link $item)) { Get-Entries $item.FullName }
  }
}

# Protected locations: the owner's release install, its Bunny A settings and the Host's credentials.
foreach ($protected in @((Join-Path $env:LOCALAPPDATA 'Bunny-A'), (Join-Path $env:LOCALAPPDATA 'BunnyA'), (Join-Path $env:APPDATA 'bunny-a'))) {
  if ((Test-Inside $InstallRoot $protected) -or (Test-Inside $protected $InstallRoot)) { throw "Refusing to install at $InstallRoot (overlaps $protected)." }
}
for ($f = $InstallRoot; $f; $f = [IO.Path]::GetDirectoryName($f)) {
  if (Test-Path -LiteralPath (Join-Path $f '.git')) { throw 'Refusing to install inside a Git checkout.' }
  # A junction or link anywhere on the path could redirect the install, or a removal, somewhere else.
  if ((Test-Path -LiteralPath $f) -and (Test-Link (Get-Item -LiteralPath $f -Force))) { throw "Refusing: $f is a junction or symbolic link; nothing was changed." }
}
function Assert-NotRunning {
  $running = @(Get-CimInstance Win32_Process -Filter "Name='BunnyA.exe'" | Where-Object { $_.ExecutablePath -and (Test-Inside $_.ExecutablePath $InstallRoot) })
  if ($running.Count) { throw ("Bunny A is running from $InstallRoot (pid " + ($running.ProcessId -join ', ') + '). Quit it first; nothing was changed.') }
}
# Ownership is proven, never assumed from the folder existing: a well-formed marker for this product naming this exact
# folder, and no file, folder, junction or link in it that the marker does not list.
function Assert-Owned {
  $why = $null
  try {
    $m = if (Test-Path -LiteralPath $marker -PathType Leaf) { Get-Content -LiteralPath $marker -Raw | ConvertFrom-Json }
    if (-not $m) { $why = 'it has no install marker' }
    elseif ($m.schema -ne $markerSchema -or $m.product -ne $product) { $why = 'its install marker is not a Bunny A development install' }
    elseif ($m.installRoot -ne $InstallRoot) { $why = 'its install marker names a different folder' }
    elseif ($m.packageSha256 -notmatch '^[0-9a-f]{64}$' -or $null -eq $m.files -or @($m.files | Where-Object { $_ -isnot [string] -or -not (Test-SafeRelative $_) }).Count) { $why = 'its install marker is malformed' }
  } catch { $why = 'its install marker is unreadable' }
  if (-not $why) {
    $listed = @{ 'install.json' = $true }
    foreach ($path in $m.files) {
      $parts = $path.Split('/')
      for ($i = 1; $i -le $parts.Count; $i++) { $listed[($parts[0..($i - 1)] -join '\')] = $true }
    }
    foreach ($item in Get-Entries $InstallRoot) {
      $relative = $item.FullName.Substring($InstallRoot.Length + 1)
      if (Test-Link $item) { $why = "it contains a junction or symbolic link ($relative)"; break }
      if (-not $listed.ContainsKey($relative)) { $why = "it contains $relative, which this script did not install"; break }
    }
  }
  if ($why) { throw "$InstallRoot was not installed by this script ($why); nothing was changed." }
}
function Assert-ShortcutOurs {
  if (Test-Path -LiteralPath $shortcut) {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if (-not $target -or -not (Test-Inside $target $InstallRoot)) { throw "$shortcut points somewhere else; nothing was changed." }
  }
}

if ($Uninstall) {
  Assert-NotRunning
  if (Test-Path -LiteralPath $InstallRoot) {
    Assert-Owned
    Remove-Item -LiteralPath $InstallRoot -Recurse -Force
  }
  if (Test-Path -LiteralPath $shortcut) {
    $target = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut).TargetPath
    if (Test-Inside $target $InstallRoot) { Remove-Item -LiteralPath $shortcut; if (-not (Get-ChildItem -LiteralPath $ShortcutDirectory -Force)) { Remove-Item -LiteralPath $ShortcutDirectory } }
  }
  [ordered]@{ uninstalled = $InstallRoot; removedShortcut = -not (Test-Path -LiteralPath $shortcut) } | ConvertTo-Json -Compress
  return
}

if (-not $Package -or -not (Test-Path -LiteralPath $Package -PathType Leaf)) { throw 'Name the candidate zip with -Package.' }
$Package = (Resolve-Path -LiteralPath $Package).Path
$packageSha256 = (Get-FileHash -LiteralPath $Package -Algorithm SHA256).Hash.ToLowerInvariant()
if ($ExpectedSha256 -and $packageSha256 -ne $ExpectedSha256.Trim().ToLowerInvariant()) { throw "The candidate's SHA-256 is $packageSha256, not the expected one; nothing was changed." }
Assert-NotRunning
# Every check that can refuse runs before anything is written.
$replaced = Test-Path -LiteralPath $InstallRoot
if ($replaced) { Assert-Owned }
Assert-ShortcutOurs
$staging = "$InstallRoot.staging-" + [Guid]::NewGuid().ToString('N')
$previous = "$InstallRoot.previous-" + [Guid]::NewGuid().ToString('N')
Add-Type -AssemblyName System.IO.Compression.FileSystem
try {
  # Each entry is placed by hand after proving it lands inside staging; a hostile archive never escapes it.
  New-Item -ItemType Directory -Path $staging | Out-Null
  $zip = [IO.Compression.ZipFile]::OpenRead($Package)
  try {
    foreach ($entry in $zip.Entries) {
      $target = [IO.Path]::GetFullPath((Join-Path $staging $entry.FullName))
      if (-not (Test-SafeRelative $entry.FullName) -or -not (Test-Inside $target $staging) -or $target -eq $staging) { throw "Unsafe archive entry: $($entry.FullName)" }
      if ($entry.FullName.EndsWith('/') -or $entry.FullName.EndsWith('\')) { New-Item -ItemType Directory -Force -Path $target | Out-Null; continue }
      New-Item -ItemType Directory -Force -Path (Split-Path -Parent $target) | Out-Null
      [IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $target, $false)
    }
  } finally { $zip.Dispose() }
  $candidate = Get-Content -LiteralPath (Join-Path $staging 'candidate.json') -Raw | ConvertFrom-Json
  if ($candidate.schema -ne 'bunny-windows-dev-candidate.v1') { throw 'Not a Bunny A development candidate.' }
  $expected = @{ 'candidate.json' = $true }
  foreach ($file in $candidate.files) {
    if ($file.path -isnot [string] -or -not (Test-SafeRelative $file.path) -or $file.path.Contains('\')) { throw "Unsafe candidate path: $($file.path)" }
    $path = Join-Path $staging $file.path
    if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant() -ne $file.sha256) { throw "Candidate file failed verification: $($file.path)" }
    $parts = $file.path.Split('/')
    for ($i = 1; $i -le $parts.Count; $i++) { $expected[($parts[0..($i - 1)] -join '\')] = $true }
  }
  # Nothing the manifest does not list is installed, so the install's own marker will always prove ownership later.
  foreach ($item in Get-Entries $staging) {
    $relative = $item.FullName.Substring($staging.Length + 1)
    if (-not $expected.ContainsKey($relative)) { throw "Candidate contains an entry its manifest does not list: $relative" }
  }
  [IO.File]::WriteAllText((Join-Path $staging 'install.json'), ([ordered]@{
    schema = $markerSchema; product = $product; installRoot = $InstallRoot; version = $candidate.version; installedAt = [DateTime]::UtcNow.ToString('o')
    packageSha256 = $packageSha256; files = @(@('candidate.json') + @($candidate.files | ForEach-Object { $_.path }))
  } | ConvertTo-Json))
  # Replacement swaps whole folders. Until the new one is fully in place the previous one is kept aside, and any failure
  # puts it back exactly; the half-installed new folder came from staging, so removing it removes only our own files.
  $swapped = $false; $linkCreated = $false
  if ($replaced) { Move-Item -LiteralPath $InstallRoot -Destination $previous }
  try {
    if ($fault -eq 'after-backup') { throw 'Injected fault: after the previous install was set aside.' }
    New-Item -ItemType Directory -Force -Path (Split-Path -Parent $InstallRoot) | Out-Null
    Move-Item -LiteralPath $staging -Destination $InstallRoot
    $swapped = $true
    $linkCreated = -not (Test-Path -LiteralPath $shortcut)
    New-Item -ItemType Directory -Force -Path $ShortcutDirectory | Out-Null
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut($shortcut)
    $link.TargetPath = Join-Path $InstallRoot 'BunnyA.exe'; $link.WorkingDirectory = $InstallRoot; $link.Description = 'Bunny A development candidate'
    $link.Save()
    if ($fault -eq 'after-swap') { throw 'Injected fault: after the new install was moved in.' }
  } catch {
    if ($swapped) { Remove-Item -LiteralPath $InstallRoot -Recurse -Force }
    if ($replaced) { Move-Item -LiteralPath $previous -Destination $InstallRoot }
    elseif ($linkCreated -and (Test-Path -LiteralPath $shortcut)) { Remove-Item -LiteralPath $shortcut }
    throw
  }
  if ($replaced) { Remove-Item -LiteralPath $previous -Recurse -Force }
  [ordered]@{ installed = $InstallRoot; version = $candidate.version; replacedPrevious = $replaced; shortcut = $shortcut } | ConvertTo-Json -Compress
} finally {
  if (Test-Path -LiteralPath $staging) { Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue }
}
