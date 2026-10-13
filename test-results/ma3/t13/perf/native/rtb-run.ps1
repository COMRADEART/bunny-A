# T13 PERF lane DPI comparison run. Starts the real install\Bunny-Island.ps1 in -SmokeTest -CollapsedView (the RenderTargetBitmap
# smoke path, a comparison artifact only, NOT the native measurement) and, in parallel, captures the same window's real
# on-screen pixels (physical coordinates) about every 300 ms until the process exits. Its own PID only.
param(
  [Parameter(Mandatory = $true)][string]$Cred,
  [Parameter(Mandatory = $true)][string]$OutDir
)
. (Join-Path $PSScriptRoot 'native-common.ps1')
$repo = 'C:\Users\allam\Documents\new\bun-router'
$island = Join-Path $repo 'install\Bunny-Island.ps1'
New-Item -ItemType Directory -Path $OutDir -Force | Out-Null
$frames = Join-Path $OutDir 'frames'
New-Item -ItemType Directory -Path $frames -Force | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$pref = Join-Path $OutDir 'pref.json'
[IO.File]::WriteAllText($pref, (@{ edge = 'top'; position = 'center'; size = 'compact'; motion = 'full'; theme = 'dark'; glass = 'medium'; idle = 'providers'; collapse = 10; primary = @('codex', 'claude', 'ollama'); edgeOffset = 0.5; monitor = $null } | ConvertTo-Json -Compress), $utf8)
$shotDir = Join-Path $OutDir 'rtb'
$p = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $island, '-SmokeTest', '-CollapsedView', '-CredentialPath', $Cred, '-DeploymentPath', (Join-Path $OutDir 'no-deploy'), '-PreferencePath', $pref, '-ScreenshotDirectory', $shotDir) -WindowStyle Hidden -PassThru
$log = @()
$n = 0
$started = Get-Date
while (-not $p.HasExited -and ((Get-Date) - $started).TotalSeconds -lt 20) {
  Start-Sleep -Milliseconds 300
  try {
    $h = Get-IslandMainWindow $p.Id
    $r = New-Object T13Native+RECT
    [void][T13Native]::GetWindowRect($h, [ref]$r)
    $w = $r.Right - $r.Left; $hh = $r.Bottom - $r.Top
    if ($w -gt 100 -and $hh -gt 40) {
      $bmp = New-Object Drawing.Bitmap $w, $hh
      $g = [Drawing.Graphics]::FromImage($bmp)
      $g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
      $g.Dispose()
      $n++
      $f = Join-Path $frames ('frame-' + $n.ToString('000') + '.png')
      $bmp.Save($f, [Drawing.Imaging.ImageFormat]::Png)
      $bmp.Dispose()
      $log += [ordered]@{ frame = $n; t = [Math]::Round(((Get-Date) - $started).TotalSeconds, 2); w = $w; h = $hh; left = $r.Left; top = $r.Top }
    }
  } catch { $log += [ordered]@{ error = $_.Exception.Message } }
}
$p.WaitForExit(5000) | Out-Null
$rtb = Get-ChildItem -LiteralPath $shotDir -Filter '*.png' -ErrorAction SilentlyContinue | Select-Object -First 1
$summary = [ordered]@{ label = 'LIVE comparison artifact (SmokeTest RenderTargetBitmap path, PID ' + $p.Id + ') + same-window physical captures'; exitCode = $p.ExitCode; framesCaptured = $n; rtbFile = if ($rtb) { $rtb.FullName } else { $null }; frames = $log }
[IO.File]::WriteAllText((Join-Path $OutDir 'rtb-run.json'), ($summary | ConvertTo-Json -Depth 5), $utf8)
Write-Output ($summary | ConvertTo-Json -Depth 3)
