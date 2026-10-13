# T13 PERF lane DPI sharpness comparison (LIVE pixels vs the RenderTargetBitmap smoke shot).
# A DWM bitmap-stretched Island would show the physical capture no sharper than the 1x RTB upscaled by 1.5 (bicubic).
# Measures edge energy (mean absolute Laplacian of luminance) over two crops and writes a side-by-side evidence PNG.
param(
  [Parameter(Mandatory = $true)][string]$Physical,
  [Parameter(Mandatory = $true)][string]$Rtb,
  [Parameter(Mandatory = $true)][string]$OutPng,
  [Parameter(Mandatory = $true)][string]$OutJson
)
Add-Type -AssemblyName System.Drawing
$phys = [Drawing.Bitmap]::FromFile($Physical)
$rtbBmp = [Drawing.Bitmap]::FromFile($Rtb)
$scale = $phys.Width / $rtbBmp.Width
# RTB upscaled to the physical size with bicubic interpolation (what a stretched 1x bitmap would look like).
$up = New-Object Drawing.Bitmap $phys.Width, $phys.Height
$gu = [Drawing.Graphics]::FromImage($up)
$gu.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::HighQualityBicubic
$gu.DrawImage($rtbBmp, 0, 0, $phys.Width, $phys.Height)
$gu.Dispose()
function Edge-Energy($bmp, [int]$x0, [int]$y0, [int]$w, [int]$h) {
  $sum = 0.0; $n = 0
  for ($y = $y0 + 1; $y -lt $y0 + $h - 1; $y++) {
    for ($x = $x0 + 1; $x -lt $x0 + $w - 1; $x++) {
      $c = $bmp.GetPixel($x, $y)
      $l = 0.299 * $c.R + 0.587 * $c.G + 0.114 * $c.B
      $lap = 0.0
      foreach ($d in @(@(-1,0),@(1,0),@(0,-1),@(0,1))) {
        $q = $bmp.GetPixel($x + $d[0], $y + $d[1])
        $lap += [Math]::Abs((0.299 * $q.R + 0.587 * $q.G + 0.114 * $q.B) - $l)
      }
      $sum += $lap; $n++
    }
  }
  return [Math]::Round($sum / $n, 3)
}
# Crops in PHYSICAL pixels of the window: Bunny companion and the "Voice is off" text.
$crops = [ordered]@{ bunnyArt = @(330, 20, 88, 80); voiceText = @(540, 50, 110, 30) }
$res = [ordered]@{ label = 'LIVE pixels (physical capture) vs SmokeTest RenderTargetBitmap (1x) upscaled 1.5x bicubic'; physicalPx = "$($phys.Width)x$($phys.Height)"; rtbPx = "$($rtbBmp.Width)x$($rtbBmp.Height)"; scale = [Math]::Round($scale, 3); edgeEnergyMeanAbsLaplacian = [ordered]@{} }
foreach ($k in $crops.Keys) {
  $c = $crops[$k]
  $res.edgeEnergyMeanAbsLaplacian[$k] = [ordered]@{ physicalNative = (Edge-Energy $phys $c[0] $c[1] $c[2] $c[3]); rtbUpscaled1_5x = (Edge-Energy $up $c[0] $c[1] $c[2] $c[3]) }
}
$res.verdictRule = 'physicalNative >> rtbUpscaled means the Island is rendered at 144 DPI (not bitmap-stretched); roughly equal means stretched'
# Side-by-side evidence: physical crop and upscaled-RTB crop, each x3 nearest-neighbour, for the Bunny art.
$cropBunny = $crops['bunnyArt']
$cw = $cropBunny[2]; $ch = $cropBunny[3]
$sheet = New-Object Drawing.Bitmap ($cw * 3 * 2 + 12), ($ch * 3)
$gs = [Drawing.Graphics]::FromImage($sheet)
$gs.Clear([Drawing.Color]::FromArgb(255, 30, 30, 30))
$gs.InterpolationMode = [Drawing.Drawing2D.InterpolationMode]::NearestNeighbor
$src1 = New-Object Drawing.Rectangle $cropBunny[0], $cropBunny[1], $cw, $ch
$gs.DrawImage($phys, (New-Object Drawing.Rectangle 0, 0, ($cw * 3), ($ch * 3)), $src1, [Drawing.GraphicsUnit]::Pixel)
$gs.DrawImage($up, (New-Object Drawing.Rectangle ($cw * 3 + 12), 0, ($cw * 3), ($ch * 3)), $src1, [Drawing.GraphicsUnit]::Pixel)
$gs.Dispose()
$sheet.Save($OutPng, [Drawing.Imaging.ImageFormat]::Png)
$sheet.Dispose(); $phys.Dispose(); $rtbBmp.Dispose(); $up.Dispose()
[IO.File]::WriteAllText($OutJson, ($res | ConvertTo-Json -Depth 5), [Text.UTF8Encoding]::new($false))
Write-Output ($res | ConvertTo-Json -Depth 5)
