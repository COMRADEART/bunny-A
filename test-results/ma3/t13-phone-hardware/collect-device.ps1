$ErrorActionPreference = 'Stop'
$repo = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$adb = Join-Path $repo 'test-results/android-tools/platform-tools/adb.exe'
$commands = [Collections.Generic.List[object]]::new()
function Adb([string[]]$Arguments,[string]$Description) {
  $output = @(& $adb @Arguments 2>&1 | ForEach-Object ToString)
  $commands.Add(@{ command=$Description;exitCode=$LASTEXITCODE;recordedAt=[DateTime]::UtcNow.ToString('o') })
  if($LASTEXITCODE -ne 0){throw "ADB command failed: $Description"}
  return $output
}
$version = Adb @('version') 'adb version'
$raw = Adb @('devices','-l') 'adb devices -l'
$devices = @()
foreach($line in $raw){if($line -match '^(\S+)\s+(device|offline|unauthorized)\b'){$devices+=@{serial=$Matches[1];state=$Matches[2]}}}
$report = [ordered]@{recordedAt=[DateTime]::UtcNow.ToString('o');adbVersion=($version | Select-Object -First 2);deviceCount=$devices.Count;authorizedCount=@($devices | Where-Object state -eq 'device').Count;devices=@($devices | ForEach-Object {@{alias='phone-'+([array]::IndexOf($devices,$_)+1);state=$_.state}});selected=$false;physical=$false;installed=$null;commands=$commands;identifiersRetained=$false}
try {
  if($devices.Count -ne 1 -or $devices[0].state -ne 'device') { $report.blocker='Exactly one intended authorized handset is required.' }
  else {
    $serial = $devices[0].serial
    $report.selected = $true
    $properties = @{}
    foreach($name in @('ro.build.version.release','ro.build.version.sdk','ro.product.cpu.abi','ro.product.cpu.abilist','ro.product.manufacturer','ro.product.model','ro.kernel.qemu','ro.hardware')) {
      $properties[$name] = (Adb @('-s',$serial,'shell','getprop',$name) "adb -s <selected> shell getprop $name") -join ''
    }
    $report.properties = $properties
    $report.physical = ($serial -notmatch '^emulator-' -and $properties['ro.kernel.qemu'] -ne '1' -and $properties['ro.hardware'] -notmatch 'goldfish|ranchu')
    if(-not $report.physical){throw 'Emulated devices cannot satisfy physical acceptance.'}
    $report.apiCompatible = [int]$properties['ro.build.version.sdk'] -ge 26
    $packagePath = Adb @('-s',$serial,'shell','pm','path','com.routeragent.jev') 'adb -s <selected> shell pm path com.routeragent.jev'
    $report.installed = [bool]($packagePath -match '^package:')
    if($report.installed) {
      $packageDetails = Adb @('-s',$serial,'shell','dumpsys','package','com.routeragent.jev') 'adb -s <selected> shell dumpsys package com.routeragent.jev (selected fields only)'
      $report.installedIdentity = @($packageDetails | Where-Object {$_ -match '^\s*(versionCode=|versionName=|minSdk=|targetSdk=)'} | ForEach-Object Trim)
    }
  }
} catch {$report.blocker=$_.Exception.Message}
$report.commands = $commands.ToArray()
[IO.File]::WriteAllText((Join-Path $PSScriptRoot 'device-observations.json'),($report | ConvertTo-Json -Depth 8)+"`n")
[pscustomobject]$report | Select-Object deviceCount,authorizedCount,selected,physical,properties,installed,blocker | ConvertTo-Json -Depth 4
