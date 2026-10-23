$ErrorActionPreference = 'Stop'
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$adb=Join-Path $repo 'test-results/android-tools/platform-tools/adb.exe'
$apk=Join-Path $repo 'releases/Bunny-A-Android-v2.apk'
$rows=@(& $adb devices -l)
$devices=@($rows | Where-Object {$_ -match '^\S+\s+device\b'})
if($devices.Count -ne 1){throw 'Exactly one authorized phone required.'}
$serial=($devices[0] -split '\s+')[0]
$commands=[Collections.Generic.List[object]]::new()
function Device([string[]]$Arguments,[string]$Description){
  $output=@(& $adb '-s' $serial @Arguments 2>&1 | ForEach-Object ToString)
  $commands.Add(@{command=$Description;exitCode=$LASTEXITCODE;recordedAt=[DateTime]::UtcNow.ToString('o')})
  if($LASTEXITCODE -ne 0){throw "Device command failed: $Description"}
  return $output
}
$report=[ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');package='com.routeragent.jev';candidateApkSha256=(Get-FileHash -LiteralPath $apk).Hash.ToLowerInvariant();installedApkSha256=$null;installedCandidateMatch=$false;dataCleared=$false;uninstalled=$false;downgraded=$false;upgradePerformed=$false;launch=$null;commands=$commands;pairingAttempted=$false}
try{
  $paths=Device @('shell','pm','path','com.routeragent.jev') 'adb shell pm path com.routeragent.jev'
  $base=@($paths | Where-Object {$_ -match '^package:.*base\.apk$'}) | Select-Object -First 1
  if($base){
    $installed=Join-Path $PSScriptRoot 'local-build/installed.apk'
    $null=Device @('pull',$base.Substring(8),$installed) 'adb pull <installed-base-apk> <ignored-local-scratch>'
    $report.installedApkSha256=(Get-FileHash -LiteralPath $installed).Hash.ToLowerInvariant()
    $report.installedCandidateMatch=$report.installedApkSha256 -eq $report.candidateApkSha256
    if(-not $report.installedCandidateMatch){throw 'Installed APK differs from verified candidate. Preserve data and inspect signer/version before any replacement.'}
  }else{
    $null=Device @('install','-r',$apk) 'adb install -r <verified-candidate-apk> (preserve application data)'
    $report.upgradePerformed=$true
    $paths=Device @('shell','pm','path','com.routeragent.jev') 'adb shell pm path com.routeragent.jev (after installation)'
    if(-not ($paths -match '^package:')){throw 'Package Manager did not confirm installation.'}
    $report.installedCandidateMatch=$true
  }
  $launch=Device @('shell','am','start','-W','-n','com.routeragent.jev/.MainActivity') 'adb shell am start -W -n com.routeragent.jev/.MainActivity'
  $report.launch=@($launch | Where-Object {$_ -match '^(Status:|LaunchState:|Activity:|TotalTime:|WaitTime:|Complete|Warning:)'})
  Start-Sleep -Seconds 3
  $report.pid=(Device @('shell','pidof','com.routeragent.jev') 'adb shell pidof com.routeragent.jev') -join ''
  $activities=Device @('shell','dumpsys','window') 'adb shell dumpsys window (only foreground match retained)'
  $report.foreground=[bool]($activities -match 'mCurrentFocus.*com\.routeragent\.jev')
  $crashes=Device @('logcat','-d',('--pid='+$report.pid),'-t','300','AndroidRuntime:E','*:S') 'adb logcat -d --pid=<app-pid> -t 300 AndroidRuntime:E *:S (crash markers only)'
  $report.crashMarkers=@($crashes | Where-Object {$_ -match 'FATAL EXCEPTION|Process: com\.routeragent\.jev|^.*(?:java\.lang|android\.view)\.[A-Za-z]+Exception:'} | ForEach-Object {$_ -replace 'https?://\S+','[ORIGIN]' -replace '(?i)(token|code|password|secret)\s*[=:]\s*\S+','$1=[REDACTED]'})
}catch{$report.blocker=$_.Exception.Message}
$report.commands=$commands.ToArray()
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'launch-observations.json'),($report | ConvertTo-Json -Depth 7)+"`n")
[pscustomobject]$report | Select-Object installedCandidateMatch,installedApkSha256,upgradePerformed,launch,foreground,crashMarkers,blocker | ConvertTo-Json -Depth 5
