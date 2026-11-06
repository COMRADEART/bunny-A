$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $workspace 'test-results/android-tools'
$buildDirectory = Join-Path $workspace ('test-results/android-aab-build-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$sourceDirectory = Join-Path $workspace 'android/app/src/main'
$platformJar = Join-Path $tools 'android.jar'
$aapt = Join-Path $tools 'aapt2/aapt2.exe'
$apksig = Join-Path $tools 'apksig.jar'
$r8 = Join-Path $tools 'r8.jar'
$bundletool = Join-Path $tools 'bundletool.jar'

$previousErrorPreference = $ErrorActionPreference
try {
  $ErrorActionPreference = 'Continue'
  $javaReport = & java -XshowSettings:properties -version 2>&1
  $javaExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorPreference }
if ($javaExit -ne 0) { throw 'Java runtime probe failed.' }
$javaHomeLine = $javaReport | Select-String '^\s*java.home\s*='
$jdkRoot = ($javaHomeLine.ToString() -split '=',2)[1].Trim()
$keytool = Join-Path $jdkRoot 'bin/keytool.exe'

foreach ($required in @($platformJar,$aapt,$apksig,$r8,$bundletool)) {
  if (-not (Test-Path -LiteralPath $required)) { throw ('Missing Android build tool: '+$required) }
}
$toolchain = Get-Content -LiteralPath (Join-Path $workspace 'android/native-preview-toolchain.json') -Raw | ConvertFrom-Json
if ($toolchain.schema -ne 'bunny-android-preview-toolchain.v2') { throw 'Unexpected Android toolchain lock schema.' }
$javaVersionLine = $javaReport | Select-String '^\s*java.version\s*='
$actualJavaVersion = ($javaVersionLine.ToString() -split '=',2)[1].Trim()
if ($actualJavaVersion -notmatch '^(\d+)\.(\d+)\.(\d+)$' -or [int]$Matches[1] -ne $toolchain.java.feature -or [int]$Matches[2] -ne 0 -or [int]$Matches[3] -lt $toolchain.java.minimumPatch) {
  throw ('Java ' + $actualJavaVersion + ' is outside the Android toolchain policy (' + $toolchain.java.feature + '.0.x, x >= ' + $toolchain.java.minimumPatch + ').')
}
Write-Output ('Java ' + $actualJavaVersion + ' (policy ' + $toolchain.java.feature + '.0.x, x >= ' + $toolchain.java.minimumPatch + '; CI pins ' + $toolchain.java.ciPinned + ')')

try {
  $ErrorActionPreference = 'Continue'
  $javacVersion = (& javac -version 2>&1 | Out-String).Trim()
  $javacExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorPreference }
if ($javacExit -ne 0 -or $javacVersion -ne ('javac ' + $actualJavaVersion)) { throw ('javac must come from the same JDK as java: ' + $javacVersion) }

$hashes = @{ androidJar=$platformJar; r8Jar=$r8; apksigJar=$apksig; aapt2Exe=$aapt }
if ($toolchain.sha256.bundletoolJar) { $hashes.bundletoolJar = $bundletool }
foreach ($name in $hashes.Keys) {
  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $hashes[$name]).Hash.ToLowerInvariant()
  if ($actual -ne $toolchain.sha256.$name) { throw ('Android build tool hash mismatch: '+$name) }
}

function Run-Checked([string]$Program,[string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('Build command failed: '+$Program) }
}

foreach ($directory in @('compiled','generated','classes','dex','helpers','tests','staging')) {
  New-Item -ItemType Directory -Path (Join-Path $buildDirectory $directory) -Force | Out-Null
}
$compiled = Join-Path $buildDirectory 'compiled'
$generated = Join-Path $buildDirectory 'generated'
$classes = Join-Path $buildDirectory 'classes'
$helpers = Join-Path $buildDirectory 'helpers'
$tests = Join-Path $buildDirectory 'tests'
$dex = Join-Path $buildDirectory 'dex'
$staging = Join-Path $buildDirectory 'staging'
$protoApk = Join-Path $buildDirectory 'proto-resources.apk'

# 1. Compile resources with aapt2
Run-Checked $aapt @('compile','--dir',(Join-Path $sourceDirectory 'res'),'-o',$compiled)
$resources = @(Get-ChildItem -LiteralPath $compiled -File | ForEach-Object FullName)

# 2. Link in proto-format for App Bundle creation
Run-Checked $aapt (@('link','--proto-format','--manifest',(Join-Path $sourceDirectory 'AndroidManifest.xml'),'-I',$platformJar,'--java',$generated,'-o',$protoApk) + $resources)

# 3. Compile Java sources
$sources = @(Get-ChildItem -LiteralPath (Join-Path $sourceDirectory 'java'),$generated -Filter '*.java' -Recurse | ForEach-Object FullName)
Run-Checked 'javac' (@('--release','8','-encoding','UTF-8','-classpath',$platformJar,'-d',$classes) + $sources)

# 4. Dex compilation with D8
$classFiles = @(Get-ChildItem -LiteralPath $classes -Filter '*.class' -Recurse | ForEach-Object FullName)
Run-Checked 'java' (@('-cp',$r8,'com.android.tools.r8.D8','--release','--min-api','26','--lib',$platformJar,'--output',$dex) + $classFiles)

# 5. Build helper tools
$helperSources = @(Get-ChildItem -LiteralPath (Join-Path $workspace 'android/tools') -Filter '*.java' | ForEach-Object FullName)
Run-Checked 'javac' (@('-encoding','UTF-8','-classpath',$apksig,'-d',$helpers) + $helperSources)

# 6. Execute unit tests
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/ServerAddress.java'),(Join-Path $workspace 'android/tests/ServerAddressTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.ServerAddressTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/KeystoreErasure.java'),(Join-Path $workspace 'android/tests/KeystoreErasureTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.KeystoreErasureTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/NativeCookiePolicy.java'),(Join-Path $workspace 'android/tests/NativeCookiePolicyTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.NativeCookiePolicyTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/PollPolicy.java'),(Join-Path $workspace 'android/tests/PollPolicyTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.PollPolicyTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/HostExchange.java'),(Join-Path $workspace 'android/tests/HostExchangeTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.HostExchangeTest')
Run-Checked 'javac' @('--release','8','-encoding','UTF-8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/HostExchange.java'),(Join-Path $sourceDirectory 'java/com/routeragent/jev/ChatTurn.java'),(Join-Path $workspace 'android/tests/HostExchangeTest.java'),(Join-Path $workspace 'android/tests/ChatTurnTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.ChatTurnTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $workspace 'android/tests/ManifestLauncherTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.ManifestLauncherTest',(Join-Path $sourceDirectory 'AndroidManifest.xml'))
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/CompanionAppearance.java'),(Join-Path $workspace 'android/tests/CompanionAppearanceTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.CompanionAppearanceTest')

# 7. Architecture verification
$dexBytes = [IO.File]::ReadAllBytes((Join-Path $dex 'classes.dex'))
if ([Text.Encoding]::ASCII.GetString($dexBytes).Contains('Landroid/webkit/')) { throw 'classes.dex references android.webkit; the companion must not depend on a WebView.' }
Write-Output ('classes.dex SHA-256: ' + (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dex 'classes.dex')).Hash.ToLowerInvariant())

# 8. Package base module zip using PackageModule helper
$baseZip = Join-Path $buildDirectory 'base.zip'
Run-Checked 'java' @('-cp',$helpers,'com.routeragent.jev.tools.PackageModule',$protoApk,(Join-Path $dex 'classes.dex'),$baseZip)

# 9. Build AAB using bundletool
New-Item -ItemType Directory -Path (Join-Path $workspace 'releases') -Force | Out-Null
[xml]$manifest = Get-Content -LiteralPath (Join-Path $sourceDirectory 'AndroidManifest.xml') -Raw
$apkVersionCode = $manifest.manifest.GetAttribute('versionCode', 'http://schemas.android.com/apk/res/android')
if ($apkVersionCode -notmatch '^[1-9][0-9]*$') { throw 'Android manifest needs a positive integer versionCode.' }
$aabOutput = Join-Path $workspace ("releases/Bunny-A-Android-v$apkVersionCode.aab")

Run-Checked 'java' @('-jar',$bundletool,'build-bundle',('--modules='+$baseZip),('--output='+$aabOutput),'--overwrite')
Write-Output ('Built AAB: ' + $aabOutput)

# 10. Validate AAB structure
Run-Checked 'java' @('-jar',$bundletool,'validate',('--bundle='+$aabOutput))
Write-Output 'bundletool validate: PASSED'

# 11. Validate bundle split APK generation and signing continuity
$signingDirectory = Join-Path $tools 'signing'
$keyPath = Join-Path $signingDirectory 'jev.p12'
$passwordPath = Join-Path $signingDirectory 'password.txt'
if (Test-Path -LiteralPath $keyPath) {
  $testApks = Join-Path $buildDirectory 'bundle-splits.apks'
  Run-Checked 'java' @('-jar',$bundletool,'build-apks',('--bundle='+$aabOutput),('--output='+$testApks),('--ks='+$keyPath),('--ks-pass=file:'+$passwordPath),'--ks-key-alias=jev',('--key-pass=file:'+$passwordPath),'--overwrite')
  Write-Output 'bundletool build-apks: verified split APK generation with signing key'
  
  # Extract master split APK to verify badging and signature
  Add-Type -AssemblyName System.IO.Compression.FileSystem
  $zip = [System.IO.Compression.ZipFile]::OpenRead($testApks)
  $entry = $zip.GetEntry('splits/base-master.apk')
  $extracted = Join-Path $buildDirectory 'base-master.apk'
  [System.IO.Compression.ZipFileExtensions]::ExtractToFile($entry, $extracted)
  $zip.Dispose()
  
  $badging = (& $aapt dump badging $extracted) -join "`n"
  if ($badging -notmatch "package: name='com\.routeragent\.jev'") { throw 'AAB split APK package identity changed.' }
  if ($badging -notmatch "versionCode='$apkVersionCode'") { throw 'AAB split APK versionCode mismatch.' }
  Write-Output "AAB split APK badging verified: com.routeragent.jev v$apkVersionCode"

  # Verify signature using SignApk
  Run-Checked 'java' @('-cp',($helpers+';'+$apksig),'SignApk','verify',$extracted)
}

$aabHash = (Get-FileHash -LiteralPath $aabOutput -Algorithm SHA256).Hash.ToLowerInvariant()
Write-Output ('AAB SHA-256: ' + $aabHash)
[IO.File]::WriteAllText($aabOutput + '.sha256', ($aabHash + '  ' + (Split-Path -Leaf $aabOutput) + "`n"))
Write-Output ('AAB Release Candidate (Unsigned Base): ' + $aabOutput)
Write-Output 'Note: Base AAB is unsigned. Run scripts/sign-android-aab.ps1 with an owner-approved upload key for release distribution.'
Write-Output ('AAB Release Candidate: ' + $aabOutput)
