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
Run-Checked $aapt @('dump','badging',$signed)
Get-FileHash -LiteralPath $signed -Algorithm SHA256 | Format-List
Write-Output ('APK: '+$signed)
