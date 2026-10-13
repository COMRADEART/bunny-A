# T13 native-final LIVE screenshot of ONE Island window rect. Copies physical on-screen pixels only while this
# Island PID is the foreground window; a shot is refused otherwise (never steals focus away from the operator).
param(
  [Parameter(Mandatory = $true)][int]$IslandPid,
  [Parameter(Mandatory = $true)][string]$Out
)
. (Join-Path $PSScriptRoot '../perf/native/native-common.ps1')
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
$utf8 = [Text.UTF8Encoding]::new($false)
$mainHwnd = Get-IslandMainWindow $IslandPid
$hwnd = [IntPtr]$mainHwnd
function Fg-Pid { $h = [T13Native]::GetForegroundWindow(); $p = 0; [void][T13Native]::GetWindowThreadProcessId($h, [ref]$p); return [int]$p }
function Focus-Island {
  if (-not ('T13Focus' -as [type])) {
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class T13Focus2 {
  [DllImport("user32.dll")] public static extern bool AttachThreadInput(uint idAttach, uint idAttachTo, bool fAttach);
  [DllImport("kernel32.dll")] public static extern uint GetCurrentThreadId();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
}
'@
  }
  $fgH = [T13Native]::GetForegroundWindow(); $fgp = [uint32]0
  $fgThread = [T13Focus2]::GetWindowThreadProcessId($fgH, [ref]$fgp)
  $me = [T13Focus2]::GetCurrentThreadId()
  [void][T13Focus2]::AttachThreadInput($me, $fgThread, $true)
  [void][T13Native]::SetForegroundWindow($hwnd)
  [void][T13Focus2]::AttachThreadInput($me, $fgThread, $false)
  Start-Sleep -Milliseconds 400
}
$record = [ordered]@{ islandPid = $IslandPid; foreground = $false; captured = $null; rect = $null }
if ((Fg-Pid) -ne $IslandPid) { Focus-Island }
$record.foreground = ((Fg-Pid) -eq $IslandPid)
if ($record.foreground) {
  $rect = New-Object T13Native+RECT
  [void][T13Native]::GetWindowRect($hwnd, [ref]$rect)
  $w = $rect.Right - $rect.Left; $h = $rect.Bottom - $rect.Top
  if ($w -gt 100 -and $h -gt 40) {
    $bmp = New-Object Drawing.Bitmap $w, $h
    $g = [Drawing.Graphics]::FromImage($bmp)
    $g.CopyFromScreen($rect.Left, $rect.Top, 0, 0, $bmp.Size)
    $g.Dispose()
    $bmp.Save($Out, [Drawing.Imaging.ImageFormat]::Png)
    $bmp.Dispose()
    $record.captured = $Out
    $record.rect = "$($rect.Left),$($rect.Top),$w,$h"
  }
}
[IO.File]::WriteAllText(($Out -replace '\.png$', '.json'), ($record | ConvertTo-Json -Depth 4), $utf8)
Write-Output ($record | ConvertTo-Json -Depth 4)