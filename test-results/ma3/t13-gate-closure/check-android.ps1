$ErrorActionPreference = 'Stop'
$workspaceRoot = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$out = Join-Path $PSScriptRoot 'android-checks'
New-Item -ItemType Directory -Path $out -Force | Out-Null
$results = @()
function Invoke-AndroidCheck([string]$Name, [string]$Program, [string[]]$Arguments, [string]$Description) {
  $log = Join-Path $out ($Name + '.log')
  & $Program @Arguments > $log 2>&1
  $script:results += @{ name = $Name; command = $Description; exitCode = $LASTEXITCODE; log = "android-checks/$Name.log" }
  if ($LASTEXITCODE -ne 0) { throw "Android check failed: $Name" }
}
$apksig = Join-Path $workspaceRoot 'test-results/android-tools/apksig.jar'
Invoke-AndroidCheck 'compile-apk-verifier' 'javac' @('-encoding','UTF-8','-classpath',$apksig,'-d',$out,(Join-Path $workspaceRoot 'android/tools/SignApk.java')) 'javac -encoding UTF-8 -classpath test-results/android-tools/apksig.jar -d <evidence>/android-checks android/tools/SignApk.java'
Invoke-AndroidCheck 'verify-existing-apk' 'java' @('-cp',($out + ';' + $apksig),'SignApk','verify',(Join-Path $workspaceRoot 'releases/Bunny-A-Android-v2.apk')) 'java -cp <evidence>/android-checks;test-results/android-tools/apksig.jar SignApk verify releases/Bunny-A-Android-v2.apk'
Invoke-AndroidCheck 'compile-address-policy' 'javac' @('--release','8','-d',$out,(Join-Path $workspaceRoot 'android/app/src/main/java/com/routeragent/jev/ServerAddress.java'),(Join-Path $workspaceRoot 'android/tests/ServerAddressTest.java')) 'javac --release 8 -d <evidence>/android-checks android/app/src/main/java/com/routeragent/jev/ServerAddress.java android/tests/ServerAddressTest.java'
Invoke-AndroidCheck 'address-policy' 'java' @('-cp',$out,'com.routeragent.jev.ServerAddressTest') 'java -cp <evidence>/android-checks com.routeragent.jev.ServerAddressTest'
Invoke-AndroidCheck 'apk-manifest' (Join-Path $workspaceRoot 'test-results/android-tools/aapt2/aapt2.exe') @('dump','badging',(Join-Path $workspaceRoot 'releases/Bunny-A-Android-v2.apk')) 'test-results/android-tools/aapt2/aapt2.exe dump badging releases/Bunny-A-Android-v2.apk'
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'android-checks.json'), ($results | ConvertTo-Json -Depth 5) + "`n", [Text.UTF8Encoding]::new($false))
Write-Output 'APK signature, manifest, and Android address-policy checks passed; no device runtime claim.'
