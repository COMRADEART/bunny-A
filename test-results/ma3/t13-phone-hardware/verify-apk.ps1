$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$tools = Join-Path $repo 'test-results/android-tools'
$scratch = Join-Path $PSScriptRoot 'local-build'
$logs = Join-Path $PSScriptRoot 'apk-logs'
foreach ($directory in @($scratch,$logs)) { New-Item -ItemType Directory -Path $directory -Force | Out-Null }
foreach ($name in @('compiled','generated','classes','dex','helpers','tests')) { New-Item -ItemType Directory -Path (Join-Path $scratch $name) -Force | Out-Null }
$results = [Collections.Generic.List[object]]::new()
function Run([string]$Name,[string]$Program,[string[]]$Arguments) {
  $start = [DateTime]::UtcNow
  & $Program @Arguments > (Join-Path $logs "$Name.log") 2>&1
  $exitCode = $LASTEXITCODE
  $results.Add(@{ name=$Name; exitCode=$exitCode; recordedAt=$start.ToString('o'); log="apk-logs/$Name.log" })
  if ($exitCode -ne 0) { throw "APK check failed: $Name (exit $exitCode)" }
}
$apk = Join-Path $repo 'releases/Bunny-A-Android-v2.apk'
$beforeHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$source = Join-Path $repo 'android/app/src/main'
$aapt = Join-Path $tools 'aapt2/aapt2.exe'
$platform = Join-Path $tools 'android.jar'
$helpers = Join-Path $scratch 'helpers'
$unsigned = Join-Path $scratch 'unsigned.apk'
$failure = $null
try {
  Run 'compile-helpers' 'javac' @('-encoding','UTF-8','-classpath',(Join-Path $tools 'apksig.jar'),'-d',$helpers,(Join-Path $repo 'android/tools/SignApk.java'),(Join-Path $repo 'android/tools/PackageApk.java'),(Join-Path $PSScriptRoot 'CompareApk.java'))
  Run 'signature' 'java' @('-cp',($helpers+';'+(Join-Path $tools 'apksig.jar')),'SignApk','verify',$apk)
  Run 'manifest' $aapt @('dump','badging',$apk)
  Run 'manifest-xml' $aapt @('dump','xmltree',$apk,'--file','AndroidManifest.xml')
  Run 'compile-resources' $aapt @('compile','--dir',(Join-Path $source 'res'),'-o',(Join-Path $scratch 'compiled'))
  $resources = @(Get-ChildItem -LiteralPath (Join-Path $scratch 'compiled') -File | ForEach-Object FullName)
  Run 'link-resources' $aapt (@('link','--manifest',(Join-Path $source 'AndroidManifest.xml'),'-I',$platform,'--java',(Join-Path $scratch 'generated'),'-o',(Join-Path $scratch 'resources.apk')) + $resources)
  $sources = @(Get-ChildItem -LiteralPath (Join-Path $source 'java'),(Join-Path $scratch 'generated') -Filter '*.java' -Recurse | ForEach-Object FullName)
  Run 'compile-source' 'javac' (@('--release','8','-encoding','UTF-8','-classpath',$platform,'-d',(Join-Path $scratch 'classes')) + $sources)
  $classes = @(Get-ChildItem -LiteralPath (Join-Path $scratch 'classes') -Filter '*.class' -Recurse | ForEach-Object FullName)
  Run 'dex' 'java' (@('-cp',(Join-Path $tools 'r8.jar'),'com.android.tools.r8.D8','--release','--min-api','26','--lib',$platform,'--output',(Join-Path $scratch 'dex')) + $classes)
  Run 'package-unsigned' 'java' @('-cp',$helpers,'PackageApk',(Join-Path $scratch 'resources.apk'),(Join-Path $scratch 'dex/classes.dex'),$unsigned)
  Run 'candidate-content-comparison' 'java' @('-cp',$helpers,'CompareApk',$apk,$unsigned)
  Run 'compile-address-policy' 'javac' @('--release','8','-d',(Join-Path $scratch 'tests'),(Join-Path $source 'java/com/routeragent/jev/ServerAddress.java'),(Join-Path $repo 'android/tests/ServerAddressTest.java'))
  Run 'address-policy' 'java' @('-cp',(Join-Path $scratch 'tests'),'com.routeragent.jev.ServerAddressTest')
} catch { $failure = $_.Exception.Message }
$afterHash = (Get-FileHash -LiteralPath $apk -Algorithm SHA256).Hash.ToLowerInvariant()
$report = [ordered]@{ recordedAt=[DateTime]::UtcNow.ToString('o'); apk='releases/Bunny-A-Android-v2.apk'; sha256=$beforeHash; apkPreserved=($beforeHash -eq $afterHash); bytes=(Get-Item -LiteralPath $apk).Length; checks=$results.ToArray(); pass=($null -eq $failure); failure=$failure; signingSecretsRead=$false; reSigned=$false; installed=$false; sourceIdentityMethod='Recompiled current candidate Android sources without signing; compare every uncompressed APK entry except META-INF signing metadata.' }
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'apk-observations.json'),($report | ConvertTo-Json -Depth 6)+"`n")
Write-Output ([pscustomobject]$report | Select-Object sha256,apkPreserved,pass,failure | ConvertTo-Json)
if ($failure) { exit 1 }
