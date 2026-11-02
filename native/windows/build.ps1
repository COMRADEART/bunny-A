param([string]$Dotnet = 'dotnet')
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$project = Join-Path $PSScriptRoot 'BunnyA'
$tests = Join-Path $PSScriptRoot 'BunnyA.Tests'
$env:DOTNET_CLI_HOME = Join-Path $workspace 'test-results/native-toolchain/home'
$env:NUGET_PACKAGES = Join-Path $workspace 'test-results/native-toolchain/packages'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
$config = Join-Path $PSScriptRoot 'NuGet.Config'
# E2b: the canonical character art is derived into public/bunny-a/characters; the WPF pack copy is a build output, so
# every build converges it from THAT copy (adds new ids, refreshes changed ones, never deletes, never fails the build
# on a pack-only extra — the manifest in assets/t13/derived stays the source of truth).
$webCharacters = Join-Path $workspace 'public/bunny-a/characters'
$packCharacters = Join-Path $project 'Assets/characters'
if ((Test-Path $webCharacters) -and (Test-Path $packCharacters)) {
  Get-ChildItem $webCharacters -Filter *.png | ForEach-Object {
    $pack = Join-Path $packCharacters $_.Name
    if (-not (Test-Path $pack) -or (Get-FileHash $pack).Hash -ne (Get-FileHash $_.FullName).Hash) {
      Copy-Item $_.FullName $pack -Force
      Write-Host "E2b: synced character art $($_.Name) from the canonical runtime copy"
    }
  }
}
Push-Location $project
try {
  & $Dotnet restore BunnyA.csproj --configfile $config
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $Dotnet build BunnyA.csproj --no-restore
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
} finally { Pop-Location }
# MA5-S2: the notch's Host-state mapping checks (dependency-free console; exit code = failures).
Push-Location $tests
try {
  & $Dotnet restore BunnyA.Tests.csproj --configfile $config
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $Dotnet run --project BunnyA.Tests.csproj --no-restore
  exit $LASTEXITCODE
} finally { Pop-Location }
