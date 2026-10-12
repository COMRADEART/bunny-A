# T13 native-final LIVE window state command on ONE Island window: minimize or restore, then report the rect.
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [Parameter(Mandatory = $true)][ValidateSet('minimize', 'restore')][string]$Command,
  [string]$Out = ''
)
. (Join-Path $PSScriptRoot '../perf/native/native-common.ps1')
$utf8 = [Text.UTF8Encoding]::new($false)
$mainHwnd = Get-IslandMainWindow $IslandPid
$hwnd = [IntPtr]$mainHwnd
if (-not ('T13Win' -as [type])) {
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class T13Win {
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hwnd, int cmd);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr hwnd);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr hwnd);
}
'@
}
$cmd = if ($Command -eq 'minimize') { 6 } else { 9 }
[void][T13Win]::ShowWindow($hwnd, $cmd)
Start-Sleep -Milliseconds 1200
$rect = New-Object T13Native+RECT
[void][T13Native]::GetWindowRect($hwnd, [ref]$rect)
$record = [ordered]@{
  islandPid = $IslandPid; command = $Command
  isIconic = [T13Win]::IsIconic($hwnd); isZoomed = [T13Win]::IsZoomed($hwnd)
  rect = "$($rect.Left),$($rect.Top),$($rect.Right - $rect.Left),$($rect.Bottom - $rect.Top)"
}
$json = $record | ConvertTo-Json -Depth 4
if ($Out) { [IO.File]::WriteAllText($Out, $json, $utf8) }
Write-Output $json