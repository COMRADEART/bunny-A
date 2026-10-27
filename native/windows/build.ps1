param([string]$Dotnet = 'dotnet')
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$project = Join-Path $PSScriptRoot 'BunnyA'
$env:DOTNET_CLI_HOME = Join-Path $workspace 'test-results/native-toolchain/home'
$env:NUGET_PACKAGES = Join-Path $workspace 'test-results/native-toolchain/packages'
$env:DOTNET_GENERATE_ASPNET_CERTIFICATE = 'false'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'
Push-Location $project
try {
  & $Dotnet restore BunnyA.csproj --configfile (Join-Path $PSScriptRoot 'NuGet.Config')
  if ($LASTEXITCODE -ne 0) { exit $LASTEXITCODE }
  & $Dotnet build BunnyA.csproj --no-restore
  exit $LASTEXITCODE
} finally { Pop-Location }
