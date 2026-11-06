param(
  [string]$Dotnet,
  [string]$OutputDirectory,
  [string]$MakeAppx,
  [string]$Version,
  [string]$Publisher
)
$ErrorActionPreference = 'Stop'
$workspace = (Resolve-Path (Join-Path $PSScriptRoot '..')).Path

if (-not $Dotnet) {
  $toolchainDotnet = Join-Path $workspace 'test-results/native-toolchain/dotnet/dotnet.exe'
  if (Test-Path -LiteralPath $toolchainDotnet) {
    $Dotnet = (Resolve-Path -LiteralPath $toolchainDotnet).Path
  } else {
    $Dotnet = 'dotnet'
  }
}

if (-not $MakeAppx) {
  $kitCandidates = @(
    'C:\Program Files (x86)\Windows Kits\10\bin\10.0.22621.0\x64\makeappx.exe',
    'C:\Program Files (x86)\Windows Kits\10\bin\10.0.26100.0\x64\makeappx.exe',
    'C:\Program Files (x86)\Windows Kits\10\App Certification Kit\makeappx.exe'
  )
  foreach ($candidate in $kitCandidates) {
    if (Test-Path -LiteralPath $candidate) {
      $MakeAppx = $candidate
      break
    }
  }
  if (-not $MakeAppx) {
    $found = Get-Command makeappx.exe -ErrorAction SilentlyContinue
    if ($found) { $MakeAppx = $found.Source }
  }
}

if (-not $MakeAppx -or -not (Test-Path -LiteralPath $MakeAppx)) {
  throw 'makeappx.exe not found in Windows Kits or PATH.'
}

if (-not $OutputDirectory) {
  $OutputDirectory = Join-Path $workspace 'releases'
}
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null

$env:DOTNET_CLI_HOME = Join-Path $workspace 'test-results/native-toolchain/home'
$env:NUGET_PACKAGES = Join-Path $workspace 'test-results/native-toolchain/packages'
$env:DOTNET_CLI_TELEMETRY_OPTOUT = '1'

$staging = Join-Path $workspace ('test-results/msix-staging-' + [Guid]::NewGuid().ToString('N'))
try {
  New-Item -ItemType Directory -Path $staging -Force | Out-Null

  # 1. Publish Release build of BunnyA
  $nativeProj = Join-Path $workspace 'native/windows/BunnyA/BunnyA.csproj'
  $nugetConfig = Join-Path $workspace 'native/windows/NuGet.Config'
  Write-Output "Restoring $nativeProj..."
  & $Dotnet restore $nativeProj --configfile $nugetConfig | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'dotnet restore failed' }

  Write-Output "Publishing $nativeProj to $staging..."
  & $Dotnet publish $nativeProj -c Release --no-restore -o $staging -p:ContinuousIntegrationBuild=true -p:DebugType=none | Out-Null
  if ($LASTEXITCODE -ne 0) { throw 'dotnet publish failed' }

  # 2. Copy AppxManifest.xml and visual assets
  $manifestSrc = Join-Path $workspace 'native/windows/BunnyA/AppxManifest.xml'
  if (-not (Test-Path -LiteralPath $manifestSrc)) { throw "Missing $manifestSrc" }
  Copy-Item -LiteralPath $manifestSrc -Destination (Join-Path $staging 'AppxManifest.xml') -Force

  $assetsSrc = Join-Path $workspace 'native/windows/BunnyA/Assets/msix'
  $assetsDest = Join-Path $staging 'Assets/msix'
  New-Item -ItemType Directory -Path $assetsDest -Force | Out-Null
  Copy-Item -Path (Join-Path $assetsSrc '*') -Destination $assetsDest -Recurse -Force

  [xml]$manifestXml = Get-Content -LiteralPath (Join-Path $staging 'AppxManifest.xml') -Raw
  if ($Version) { $manifestXml.Package.Identity.Version = $Version }
  if ($Publisher) { $manifestXml.Package.Identity.Publisher = $Publisher }
  $manifestXml.Save((Join-Path $staging 'AppxManifest.xml'))
  $identityName = $manifestXml.Package.Identity.Name
  $version = $manifestXml.Package.Identity.Version
  $msixName = "$identityName-$version.msix"
  $msixPath = Join-Path $OutputDirectory $msixName

  # 3. Pack with makeappx.exe
  Write-Output "Packaging MSIX with $MakeAppx..."
  & $MakeAppx pack /v /h SHA256 /d $staging /p $msixPath /o
  if ($LASTEXITCODE -ne 0) { throw 'makeappx pack failed' }

  # 4. Hash
  $hash = (Get-FileHash -LiteralPath $msixPath -Algorithm SHA256).Hash.ToLowerInvariant()
  [IO.File]::WriteAllText($msixPath + '.sha256', ($hash + '  ' + (Split-Path -Leaf $msixPath) + "`n"))

  Write-Output "MSIX package built: $msixPath"
  Write-Output "MSIX SHA-256: $hash"
  Write-Output "Identity: $identityName"
  Write-Output "Version: $version"
  Write-Output "Publisher: $($manifestXml.Package.Identity.Publisher)"
  Write-Output "EntryPoint: $($manifestXml.Package.Applications.Application.EntryPoint)"
  Write-Output "Executable: $($manifestXml.Package.Applications.Application.Executable)"

  [pscustomobject]@{
    Package = $msixPath
    Sha256 = $hash
    Identity = $identityName
    Version = $version
  }
} finally {
  Remove-Item -LiteralPath $staging -Recurse -Force -ErrorAction SilentlyContinue
}
