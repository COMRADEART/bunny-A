$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$observations = [ordered]@{ recordedAt = [DateTime]::UtcNow.ToString('o'); platform = 'Windows'; commands = @(); secretsPrinted = $false }
$adbCommand = Get-Command adb -ErrorAction SilentlyContinue
$adbCandidates = @(
  (Join-Path $env:LOCALAPPDATA 'Android/Sdk/platform-tools/adb.exe'),
  (Join-Path $workspaceRoot 'test-results/android-tools/platform-tools/adb.exe'),
  (Join-Path $workspaceRoot 'test-results/platform-tools/adb.exe'),
  'C:/Android/platform-tools/adb.exe', 'C:/platform-tools/adb.exe', 'C:/Android/Sdk/platform-tools/adb.exe'
)
foreach ($variable in @('ANDROID_HOME', 'ANDROID_SDK_ROOT')) {
  $value = [Environment]::GetEnvironmentVariable($variable)
  if ($value) { $adbCandidates += Join-Path $value 'platform-tools/adb.exe' }
}
$wingetRoot = Join-Path $env:LOCALAPPDATA 'Microsoft/WinGet/Packages'
if (Test-Path -LiteralPath $wingetRoot) {
  foreach ($directory in Get-ChildItem -LiteralPath $wingetRoot -Directory -Filter 'Google.PlatformTools*') {
    $adbCandidates += Join-Path $directory.FullName 'platform-tools/adb.exe'
  }
}
$adbPath = if ($adbCommand) { $adbCommand.Source } else { $adbCandidates | Where-Object { Test-Path -LiteralPath $_ -PathType Leaf } | Select-Object -First 1 }
$observations.adb = [ordered]@{ found = [bool]$adbPath; path = $adbPath; searched = $adbCandidates; authorizedDeviceCount = 0; devices = @() }
if ($adbPath) {
  $adbVersion = & $adbPath version 2>&1
  $observations.commands += @{ command = 'adb version'; exitCode = $LASTEXITCODE }
  $observations.adb.version = @($adbVersion | ForEach-Object { $_.ToString() })
  $deviceOutput = & $adbPath devices -l 2>&1
  $observations.commands += @{ command = 'adb devices -l'; exitCode = $LASTEXITCODE }
  $deviceIndex = 0
  foreach ($line in $deviceOutput) {
    if ($line.ToString() -match '^\S+\s+(device|offline|unauthorized)\b(.*)$') {
      $deviceIndex++
      $state = $Matches[1]
      $observations.adb.devices += @{ label = "device-$deviceIndex"; state = $state; serial = '[REDACTED]' }
      if ($state -eq 'device') { $observations.adb.authorizedDeviceCount++ }
    }
  }
} else { $observations.commands += @{ command = 'Get-Command adb plus SDK/platform-tools candidate probes'; exitCode = 0; result = 'ADB not found; device enumeration unavailable' } }

$observations.java = @{}
foreach ($name in @('java', 'javac')) {
  $found = Get-Command $name -ErrorAction SilentlyContinue
  $observations.java[$name] = @{ found = [bool]$found; path = if ($found) { $found.Source } else { $null } }
}
$observations.build = @{ script = 'scripts/build-android.ps1'; scriptPresent = Test-Path -LiteralPath (Join-Path $workspaceRoot 'scripts/build-android.ps1'); gradlePresent = Test-Path -LiteralPath (Join-Path $workspaceRoot 'android/build.gradle'); tools = @() }
foreach ($file in @('android.jar','aapt2/aapt2.exe','apksig.jar','r8.jar')) {
  $observations.build.tools += @{ path = "test-results/android-tools/$file"; present = Test-Path -LiteralPath (Join-Path $workspaceRoot "test-results/android-tools/$file") }
}
$observations.apks = @(Get-ChildItem -LiteralPath (Join-Path $workspaceRoot 'releases') -File -Filter '*.apk' -ErrorAction SilentlyContinue | ForEach-Object { @{ path = "releases/$($_.Name)"; bytes = $_.Length; sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant() } })
$observations.remoteOriginEnvironment = @()
foreach ($scope in @('Process','User','Machine')) {
  $originValue = [Environment]::GetEnvironmentVariable('BUNNY_REMOTE_ORIGIN', $scope)
  $parsedOrigin = $null
  $validOrigin = $originValue -and [Uri]::TryCreate($originValue, [UriKind]::Absolute, [ref]$parsedOrigin)
  $observations.remoteOriginEnvironment += @{ scope = $scope; present = [bool]$originValue; validHttps = [bool]($validOrigin -and $parsedOrigin.Scheme -eq 'https' -and -not $parsedOrigin.UserInfo) }
}
$installedRoot = Join-Path $env:LOCALAPPDATA 'Bunny-A'
$installPath = Join-Path $installedRoot 'install.json'
$remotePaths = @((Join-Path $workspaceRoot 'remote.json'), (Join-Path $workspaceRoot '.bunny-a/remote.json'), (Join-Path $installedRoot 'state/settings/remote.json'), (Join-Path $installedRoot 'development/remote.json'))
$observations.installed = @{ configPresent = Test-Path -LiteralPath $installPath }
if (Test-Path -LiteralPath $installPath) {
  $installConfig = Get-Content -LiteralPath $installPath -Raw | ConvertFrom-Json
  $observations.installed.schema = $installConfig.schema
  $observations.installed.sourceCommit = $installConfig.current.sourceCommit
  if ($installConfig.stateRoot) { $remotePaths += Join-Path $installConfig.stateRoot 'settings/remote.json' }
}
if ($env:BUNNY_REMOTE_CONFIG) { $remotePaths += $env:BUNNY_REMOTE_CONFIG }
$observations.remoteConfigs = @()
foreach ($remotePath in $remotePaths | Select-Object -Unique) {
  $exists = Test-Path -LiteralPath $remotePath -PathType Leaf
  $summary = @{ path = $remotePath; present = $exists; validHttpsOrigin = $false }
  if ($exists) {
    try {
      $remoteConfig = Get-Content -LiteralPath $remotePath -Raw | ConvertFrom-Json
      $parsedRemote = $null
      $validRemote = $remoteConfig.url -and [Uri]::TryCreate($remoteConfig.url, [UriKind]::Absolute, [ref]$parsedRemote)
      $summary.validHttpsOrigin = [bool]($validRemote -and $parsedRemote.Scheme -eq 'https' -and -not $parsedRemote.UserInfo)
      $summary.enabled = $remoteConfig.enabled
    } catch { $summary.parseError = $true }
  }
  $observations.remoteConfigs += $summary
}
$processes = @(Get-CimInstance Win32_Process)
$observations.processes = @($processes | Where-Object { $_.Name -match '^(node|bun|adb|java|emulator|Narrator|cloudflared|ngrok)(\.exe)?$' } | ForEach-Object {
  $kind = if ($_.CommandLine -match '(?:--test\b|run-gates\.mjs)') { 'test-or-gate-runner' } elseif ($_.CommandLine -match 'vite') { 'development-web-server' } elseif ($_.ExecutablePath -like '*Bunny-A*') { 'installed-bunny-runtime' } elseif ($_.Name -match 'adb|emulator|cloudflared|ngrok|Narrator') { $_.Name } else { 'other-runtime' }
  @{ pid = $_.ProcessId; parentPid = $_.ParentProcessId; name = $_.Name; kind = $kind; executable = $_.ExecutablePath }
})
$observations.listeners = @(Get-NetTCPConnection -State Listen | Where-Object { $_.LocalPort -in @(8080,8081,8084,4317,4318,5037) } | ForEach-Object { @{ address = $_.LocalAddress; port = $_.LocalPort; pid = $_.OwningProcess } })
$observations.commands += @{ command = 'Get-CimInstance Win32_Process (selected fields; command lines classified in memory only)'; exitCode = 0 }
$observations.commands += @{ command = 'Get-NetTCPConnection -State Listen (selected ports)'; exitCode = 0 }
$observations.hardwareGateExecutable = [bool]($observations.adb.authorizedDeviceCount -gt 0 -and @($observations.remoteConfigs | Where-Object validHttpsOrigin).Count -gt 0)
$outputPath = Join-Path $PSScriptRoot 'android-environment.json'
[IO.File]::WriteAllText($outputPath, ($observations | ConvertTo-Json -Depth 9) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output ('Sanitized discovery saved. adb=' + [bool]$adbPath + '; authorizedDevices=' + $observations.adb.authorizedDeviceCount + '; hardwareGateExecutable=' + $observations.hardwareGateExecutable)
