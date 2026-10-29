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
