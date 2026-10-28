# MA5-S1: builds the WPF client in Release twice, refuses to package unless both builds are byte-identical, and writes a
# development-candidate zip plus a manifest of every file's SHA-256. Unsigned: a development artifact, not a release.
param([string]$Dotnet = 'dotnet', [string]$OutputDirectory)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$project = Join-Path $PSScriptRoot 'BunnyA/BunnyA.csproj'
if (-not $OutputDirectory) { $OutputDirectory = Join-Path $workspace 'releases' }
$env:DOTNET_CLI_HOME = Join-Path $workspace 'test-results/native-toolchain/home'
$env:NUGET_PACKAGES = Join-Path $workspace 'test-results/native-toolchain/packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$scratch = Join-Path $workspace ('test-results/windows-candidate-' + [Guid]::NewGuid().ToString('N'))

function Publish([string]$Into) {
  # Each build gets its own copy of the sources (no shared bin/obj) in a different folder, so identical output
  # also shows the binaries do not depend on where they were built (PathMap in the project).
  $src = "$Into-src"
  robocopy (Split-Path -Parent $project) $src /E /XD bin obj /NFL /NDL /NJH /NJS | Out-Null
  if ($LASTEXITCODE -ge 8) { throw 'source copy failed' }
  Copy-Item -LiteralPath (Join-Path $PSScriptRoot 'NuGet.Config') -Destination $src
  $proj = Join-Path $src 'BunnyA.csproj'
  & $Dotnet restore $proj --configfile (Join-Path $src 'NuGet.Config') | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'restore failed' }
  & $Dotnet publish $proj -c Release --no-restore -o $Into -p:ContinuousIntegrationBuild=true -p:DebugType=none | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'publish failed' }
}
function Hashes([string]$Folder) {
  $prefix = (Resolve-Path -LiteralPath $Folder).Path.TrimEnd('\') + '\'
  Get-ChildItem -LiteralPath $Folder -Recurse -File | Sort-Object FullName | ForEach-Object {
    [ordered]@{ path = $_.FullName.Substring($prefix.Length).Replace('\', '/'); bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() }
  }
}

try {
  Publish (Join-Path $scratch 'a')
  Publish (Join-Path $scratch 'b')
  $a = @(Hashes (Join-Path $scratch 'a')); $b = @(Hashes (Join-Path $scratch 'b'))
  $diff = Compare-Object ($a | ForEach-Object { "$($_.path) $($_.sha256)" }) ($b | ForEach-Object { "$($_.path) $($_.sha256)" })
  if ($diff) { throw ('Release builds differ: ' + (($diff | ForEach-Object InputObject) -join '; ')) }
  [xml]$csproj = Get-Content -LiteralPath $project -Raw
  $version = $csproj.Project.PropertyGroup.Version | Where-Object { $_ } | Select-Object -First 1
  New-Item -ItemType Directory -Force -Path $OutputDirectory | Out-Null
  $name = "BunnyA-Windows-dev-$version"
  $manifest = [ordered]@{
    schema = 'bunny-windows-dev-candidate.v1'; product = 'Bunny A (native Windows client)'; version = $version
    classification = 'development candidate; unsigned; not for distribution'; reproducible = 'two clean Release builds compared byte for byte'
    entry = 'BunnyA.exe'; files = $a
  }
  [IO.File]::WriteAllText((Join-Path $scratch 'a/candidate.json'), ($manifest | ConvertTo-Json -Depth 5))
  $zip = Join-Path $OutputDirectory "$name.zip"
  if (Test-Path -LiteralPath $zip) { Remove-Item -LiteralPath $zip }
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  [IO.Compression.ZipFile]::CreateFromDirectory((Join-Path $scratch 'a'), $zip)
  Write-Output ('Files: ' + $a.Count + ' (identical across two Release builds)')
  Write-Output ('BunnyA.exe SHA-256: ' + ($a | Where-Object { $_.path -eq 'BunnyA.exe' }).sha256)
  Write-Output ('BunnyA.dll SHA-256: ' + ($a | Where-Object { $_.path -eq 'BunnyA.dll' }).sha256)
  Write-Output ('Candidate: ' + $zip + ' SHA-256 ' + (Get-FileHash -LiteralPath $zip -Algorithm SHA256).Hash.ToLowerInvariant())
} finally {
  Remove-Item -LiteralPath $scratch -Recurse -Force -ErrorAction SilentlyContinue
}
