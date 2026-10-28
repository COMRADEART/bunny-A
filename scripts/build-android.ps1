$ErrorActionPreference = 'Stop'
$workspace = Split-Path -Parent $PSScriptRoot
$tools = Join-Path $workspace 'test-results/android-tools'
$buildDirectory = Join-Path $workspace ('test-results/android-build-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
$sourceDirectory = Join-Path $workspace 'android/app/src/main'
$platformJar = Join-Path $tools 'android.jar'
$aapt = Join-Path $tools 'aapt2/aapt2.exe'
$apksig = Join-Path $tools 'apksig.jar'
$r8 = Join-Path $tools 'r8.jar'
$previousErrorPreference = $ErrorActionPreference
try {
  # Java writes its successful property report to stderr. Windows PowerShell
  # treats redirection as error records; validate exit status instead.
  $ErrorActionPreference = 'Continue'
  $javaReport = & java -XshowSettings:properties -version 2>&1
  $javaExit = $LASTEXITCODE
} finally { $ErrorActionPreference = $previousErrorPreference }
if ($javaExit -ne 0) { throw 'Java runtime probe failed.' }
$javaHomeLine = $javaReport | Select-String '^\s*java.home\s*='
$jdkRoot = ($javaHomeLine.ToString() -split '=',2)[1].Trim()
$keytool = Join-Path $jdkRoot 'bin/keytool.exe'
foreach ($required in @($platformJar,$aapt,$apksig,$r8)) {
  if (-not (Test-Path -LiteralPath $required)) { throw ('Missing Android build tool: '+$required) }
}
$toolchain = Get-Content -LiteralPath (Join-Path $workspace 'android/native-preview-toolchain.json') -Raw | ConvertFrom-Json
if ($toolchain.schema -ne 'bunny-android-preview-toolchain.v2') { throw 'Unexpected Android toolchain lock schema.' }
$javaVersionLine = $javaReport | Select-String '^\s*java.version\s*='
$actualJavaVersion = ($javaVersionLine.ToString() -split '=',2)[1].Trim()
# MA5-S1: any Java 21.0.x at or above the lock's minimum patch builds (javac --release 8 fixes the bytecode target);
# CI pins one exact patch for reproducible artifacts, and the dex hash below is comparable across patches.
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
foreach ($name in $hashes.Keys) {
  $actual=(Get-FileHash -Algorithm SHA256 -LiteralPath $hashes[$name]).Hash.ToLowerInvariant()
  if ($actual -ne $toolchain.sha256.$name) { throw ('Android build tool hash mismatch: '+$name) }
}

function Run-Checked([string]$Program,[string[]]$Arguments) {
  & $Program @Arguments
  if ($LASTEXITCODE -ne 0) { throw ('Build command failed: '+$Program) }
}
foreach ($directory in @('compiled','generated','classes','dex','helpers','tests')) {
  New-Item -ItemType Directory -Path (Join-Path $buildDirectory $directory) -Force | Out-Null
}
$compiled = Join-Path $buildDirectory 'compiled'
$generated = Join-Path $buildDirectory 'generated'
$classes = Join-Path $buildDirectory 'classes'
$helpers = Join-Path $buildDirectory 'helpers'
$tests = Join-Path $buildDirectory 'tests'
$dex = Join-Path $buildDirectory 'dex'
$resourceApk = Join-Path $buildDirectory 'resources.apk'
Run-Checked $aapt @('compile','--dir',(Join-Path $sourceDirectory 'res'),'-o',$compiled)
$resources = @(Get-ChildItem -LiteralPath $compiled -File | ForEach-Object FullName)
Run-Checked $aapt (@('link','--manifest',(Join-Path $sourceDirectory 'AndroidManifest.xml'),'-I',$platformJar,'--java',$generated,'-o',$resourceApk) + $resources)
$sources = @(Get-ChildItem -LiteralPath (Join-Path $sourceDirectory 'java'),$generated -Filter '*.java' -Recurse | ForEach-Object FullName)
Run-Checked 'javac' (@('--release','8','-encoding','UTF-8','-classpath',$platformJar,'-d',$classes) + $sources)
$classFiles = @(Get-ChildItem -LiteralPath $classes -Filter '*.class' -Recurse | ForEach-Object FullName)
Run-Checked 'java' (@('-cp',$r8,'com.android.tools.r8.D8','--release','--min-api','26','--lib',$platformJar,'--output',$dex) + $classFiles)
$helperSources = @(Get-ChildItem -LiteralPath (Join-Path $workspace 'android/tools') -Filter '*.java' | ForEach-Object FullName)
Run-Checked 'javac' (@('-encoding','UTF-8','-classpath',$apksig,'-d',$helpers) + $helperSources)
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/ServerAddress.java'),(Join-Path $workspace 'android/tests/ServerAddressTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.ServerAddressTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/KeystoreErasure.java'),(Join-Path $workspace 'android/tests/KeystoreErasureTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.KeystoreErasureTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/NativeCookiePolicy.java'),(Join-Path $workspace 'android/tests/NativeCookiePolicyTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.NativeCookiePolicyTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $sourceDirectory 'java/com/routeragent/jev/PollPolicy.java'),(Join-Path $workspace 'android/tests/PollPolicyTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.PollPolicyTest')
Run-Checked 'javac' @('--release','8','-d',$tests,(Join-Path $workspace 'android/tests/ManifestLauncherTest.java'))
Run-Checked 'java' @('-cp',$tests,'com.routeragent.jev.ManifestLauncherTest',(Join-Path $sourceDirectory 'AndroidManifest.xml'))
# MA5-S1: the core journeys are native. The compiled app must not reference android.webkit at all.
$dexBytes = [IO.File]::ReadAllBytes((Join-Path $dex 'classes.dex'))
if ([Text.Encoding]::ASCII.GetString($dexBytes).Contains('Landroid/webkit/')) { throw 'classes.dex references android.webkit; the companion must not depend on a WebView.' }
Write-Output ('classes.dex SHA-256: ' + (Get-FileHash -Algorithm SHA256 -LiteralPath (Join-Path $dex 'classes.dex')).Hash.ToLowerInvariant())
$unsigned = Join-Path $buildDirectory 'unsigned.apk'
Run-Checked 'java' @('-cp',$helpers,'PackageApk',$resourceApk,(Join-Path $dex 'classes.dex'),$unsigned)
$signingDirectory = Join-Path $tools 'signing'
New-Item -ItemType Directory -Path $signingDirectory -Force | Out-Null
$keyPath = Join-Path $signingDirectory 'jev.p12'
$passwordPath = Join-Path $signingDirectory 'password.txt'
if (-not (Test-Path -LiteralPath $keyPath)) {
  $randomBytes = [byte[]]::new(32)
  $randomGenerator = [Security.Cryptography.RandomNumberGenerator]::Create()
  $randomGenerator.GetBytes($randomBytes)
  $randomGenerator.Dispose()
  [Convert]::ToBase64String($randomBytes) | Set-Content -LiteralPath $passwordPath -Encoding ascii
  Run-Checked $keytool @('-genkeypair','-keystore',$keyPath,'-storetype','PKCS12','-alias','jev','-storepass:file',$passwordPath,'-keypass:file',$passwordPath,'-keyalg','RSA','-keysize','3072','-validity','10000','-dname','CN=JEV Local Build')
}
New-Item -ItemType Directory -Path (Join-Path $workspace 'releases') -Force | Out-Null
[xml]$manifest = Get-Content -LiteralPath (Join-Path $sourceDirectory 'AndroidManifest.xml') -Raw
$apkVersionCode = $manifest.manifest.GetAttribute('versionCode', 'http://schemas.android.com/apk/res/android')
if ($apkVersionCode -notmatch '^[1-9][0-9]*$') { throw 'Android manifest needs a positive integer versionCode.' }
$signed = Join-Path $workspace ("releases/Bunny-A-Android-v$apkVersionCode.apk")
Run-Checked 'java' @('-cp',($helpers+';'+$apksig),'SignApk','sign',$keyPath,$passwordPath,$unsigned,$signed)
$badging = (& $aapt dump badging $signed) -join "`n"
if ($LASTEXITCODE -ne 0) { throw 'aapt2 could not read the signed APK.' }
Write-Output $badging
# The installed artifact, not the source: package identity and the component the launcher starts.
if ($badging -notmatch "package: name='com\.routeragent\.jev'") { throw 'APK package identity changed.' }
# aapt2 badging lists no launchable-activity for an activity-alias, so the compiled manifest tree is checked instead:
# the one exported MAIN/LAUNCHER entry is the alias keeping the old component name, and it opens the native activity.
$tree = (& $aapt dump xmltree --file AndroidManifest.xml $signed) -join "`n"
$components = $tree -split '(?=\n\s*E: activity)'
$launchers = @($components | Where-Object { $_ -match 'android\.intent\.category\.LAUNCHER' })
if ($launchers.Count -ne 1) { throw ('APK must have exactly one launcher entry; found ' + $launchers.Count + '.') }
$launcher = $launchers[0]
if ($launcher -notmatch 'E: activity-alias' -or $launcher -notmatch ':name\([^)]*\)="\.MainActivity"' -or $launcher -notmatch ':exported\([^)]*\)=true' -or
    $launcher -notmatch ':targetActivity\([^)]*\)="com\.routeragent\.jev\.NativeCompanionActivity"' -or $launcher -notmatch 'android\.intent\.action\.MAIN') {
  throw 'APK launcher entry does not open com.routeragent.jev.NativeCompanionActivity.'
}
Write-Output 'APK launcher: com.routeragent.jev/.MainActivity (alias) -> com.routeragent.jev.NativeCompanionActivity'
Get-FileHash -LiteralPath $signed -Algorithm SHA256 | Format-List
Write-Output ('APK: '+$signed)
