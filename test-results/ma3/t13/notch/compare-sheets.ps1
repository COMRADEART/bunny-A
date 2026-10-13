# Builds the T13 notch compare sheets: board crop (left) beside the native screenshot (right), plus a states montage.
# Reads assets\t13\reference\*.png and notch\shots\*.png; writes notch\compare\*.png. Read-only on the sources.
Add-Type -AssemblyName System.Drawing
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$repo = (Resolve-Path -LiteralPath (Join-Path $here '..\..\..\..')).Path
$ref = Join-Path $repo 'assets\t13\reference'
$shots = Join-Path $here 'shots'
$out = Join-Path $here 'compare'
New-Item -ItemType Directory -Path $out -Force | Out-Null

function Get-Bitmap([string]$Path) { return [Drawing.Bitmap]::FromFile($Path) }

function Draw-Scaled($Graphics, $Bitmap, [int]$X, [int]$Y, [double]$Scale) {
  $w = [int][Math]::Round($Bitmap.Width * $Scale); $h = [int][Math]::Round($Bitmap.Height * $Scale)
  $Graphics.InterpolationMode = 'HighQualityBicubic'
  $Graphics.DrawImage($Bitmap, $X, $Y, $w, $h)
  return @($w, $h)
}

function Save-Pair([string]$Name, [string]$BoardFile, [string]$NativeFile, [string]$BoardLabel, [string]$NativeLabel) {
  $board = Get-Bitmap (Join-Path $ref $BoardFile)
  $native = Get-Bitmap (Join-Path $shots $NativeFile)
  $boardScale = [Math]::Min(1.0, 700.0 / $board.Width)
  $nativeScale = 2.0
  $bw = [int][Math]::Round($board.Width * $boardScale); $bh = [int][Math]::Round($board.Height * $boardScale)
  $nw = [int][Math]::Round($native.Width * $nativeScale); $nh = [int][Math]::Round($native.Height * $nativeScale)
  $height = [Math]::Max($bh, $nh) + 40
  $sheet = New-Object Drawing.Bitmap ($bw + $nw + 60), $height
  $g = [Drawing.Graphics]::FromImage($sheet)
  $g.Clear([Drawing.Color]::FromArgb(255, 22, 24, 30))
  $font = New-Object Drawing.Font 'Segoe UI', 10
  $brush = [Drawing.Brushes]::White
  $g.DrawString('Board: ' + $BoardLabel, $font, $brush, 8, 8)
  $g.DrawString('Native: ' + $NativeLabel + ' (x2)', $font, $brush, ($bw + 36), 8)
  [void](Draw-Scaled $g $board 8 30 $boardScale)
  [void](Draw-Scaled $g $native ($bw + 36) 30 $nativeScale)
  $path = Join-Path $out $Name
  $sheet.Save($path, [Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $sheet.Dispose(); $board.Dispose(); $native.Dispose()
  return $path
}

$written = @()
$written += Save-Pair 'top-compare.png' 'dock-top.png' 'top-all-four-active.png' 'dock-top.png' 'top-all-four-active.png'
$written += Save-Pair 'bottom-compare.png' 'dock-bottom.png' 'bottom-all-four-active.png' 'dock-bottom.png' 'bottom-all-four-active.png'
$written += Save-Pair 'left-compare.png' 'dock-left.png' 'left-all-four-active.png' 'dock-left.png' 'left-all-four-active.png'
$written += Save-Pair 'right-compare.png' 'dock-right.png' 'right-all-four-active.png' 'dock-right.png' 'right-all-four-active.png'
$written += Save-Pair 'top-expanded-compare.png' 'dock-top.png' 'top-expanded-panel.png' 'dock-top.png' 'top-expanded-panel.png'
$written += Save-Pair 'top-listening-compare.png' 'notch-top-listening.png' 'top-listening.png' 'notch-top-listening.png' 'top-listening.png'

# States montage: every top-edge idle-state shot, 1x, in a 2-column grid.
$states = @('top-collapsed-idle', 'top-all-four-active', 'top-single-active', 'top-expanded-panel', 'top-agent-detail', 'top-listening', 'top-speaking', 'top-listening-while-speaking', 'top-permission-waiting', 'top-paused', 'top-verified', 'top-failed', 'top-offline', 'top-reduced-motion-all-active', 'top-light-all-active', 'top-light-expanded') | Where-Object { Test-Path (Join-Path $shots ($_ + '.png')) }
$images = @($states | ForEach-Object { Get-Bitmap (Join-Path $shots ($_ + '.png')) })
$cellW = 680; $rows = [int][Math]::Ceiling($images.Count / 2.0)
$cellH = 0; foreach ($img in $images) { $cellH = [Math]::Max($cellH, [int]($img.Height * [Math]::Min(1.0, $cellW / $img.Width)) + 26) }
$sheet = New-Object Drawing.Bitmap (2 * $cellW + 30), ($rows * $cellH + 20)
$g = [Drawing.Graphics]::FromImage($sheet); $g.Clear([Drawing.Color]::FromArgb(255, 22, 24, 30))
$font = New-Object Drawing.Font 'Segoe UI', 9
for ($i = 0; $i -lt $images.Count; $i++) {
  $col = $i % 2; $row = [int][Math]::Floor($i / 2)
  $x = 10 + $col * ($cellW + 10); $y = 10 + $row * $cellH
  $g.DrawString($states[$i], $font, [Drawing.Brushes]::White, $x, $y)
  $scale = [Math]::Min(1.0, $cellW / $images[$i].Width)
  [void](Draw-Scaled $g $images[$i] $x ($y + 20) $scale)
}
$montage = Join-Path $out 'states-montage.png'
$sheet.Save($montage, [Drawing.Imaging.ImageFormat]::Png)
$g.Dispose(); $sheet.Dispose(); foreach ($img in $images) { $img.Dispose() }
$written += $montage
$written
