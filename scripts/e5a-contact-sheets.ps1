param([string]$Evidence='docs/ux/e5a/evidence')
Add-Type -AssemblyName System.Drawing
$report=Get-Content (Join-Path $Evidence baseline.json) -Raw | ConvertFrom-Json
$font=[Drawing.Font]::new('Segoe UI',11)
$brush=[Drawing.Brushes]::Black
foreach($profile in @('desktop','windows-narrow','mobile-web')) {
 foreach($variant in @('light','dark')) {
  $rows=@($report.captures | Where-Object { $_.profile -eq $profile -and $_.variant -eq $variant -and $_.section -in $report.screens.id -and $_.id -notmatch '^(intensity|high-contrast|reduced|os-reduced|forced|focus|companion|inspector)' })
  $rows=@($rows | Sort-Object { [array]::IndexOf(@($report.screens.id), $_.section) })
  for($part=0;$part -lt 2;$part++){
   $batch=@($rows | Select-Object -Skip ($part*13) -First 13)
   $cw=350; $ch=if($profile -eq 'mobile-web'){480}else{325}
   $bitmap=[Drawing.Bitmap]::new(($cw*4),($ch*4))
   $g=[Drawing.Graphics]::FromImage($bitmap);$g.Clear([Drawing.Color]::FromArgb(235,237,241));$g.InterpolationMode='HighQualityBicubic'
   for($i=0;$i -lt $batch.Count;$i++){
    $item=$batch[$i]; $x=($i%4)*$cw; $y=[math]::Floor($i/4)*$ch
    $g.DrawString(($item.section+' · '+$item.status),$font,$brush,($x+8),($y+5))
    $path=Join-Path $Evidence $item.screenshot
    if(Test-Path -LiteralPath $path){$img=[Drawing.Image]::FromFile((Resolve-Path -LiteralPath $path));$scale=[math]::Min(($cw-12)/$img.Width,($ch-33)/$img.Height);$w=[int]($img.Width*$scale);$h=[int]($img.Height*$scale);$g.DrawImage($img,($x+6),($y+28),$w,$h);$img.Dispose()}
   }
   $g.Dispose();$name='contact-'+$profile+'-'+$variant+'-'+($part+1)+'.jpg';$bitmap.Save((Join-Path (Resolve-Path $Evidence) $name),[Drawing.Imaging.ImageFormat]::Jpeg);$bitmap.Dispose()
  }
 }
}
foreach($variant in @('light','dark')){
 $rows=@($report.captures | Where-Object { $_.id -match '^companion' -and $_.variant -eq $variant })
 $bitmap=[Drawing.Bitmap]::new(1250,580);$g=[Drawing.Graphics]::FromImage($bitmap);$g.Clear([Drawing.Color]::FromArgb(235,237,241));$g.InterpolationMode='HighQualityBicubic'
 for($i=0;$i -lt $rows.Count;$i++){ $item=$rows[$i];$x=$i*250;$g.DrawString(($item.section+' '+$item.status),$font,$brush,($x+5),5);$img=[Drawing.Image]::FromFile((Join-Path (Resolve-Path $Evidence) $item.screenshot));$g.DrawImage($img,($x+5),30,240,520);$img.Dispose() }
 $g.Dispose();$bitmap.Save((Join-Path (Resolve-Path $Evidence) ('contact-companion-'+$variant+'.jpg')),[Drawing.Imaging.ImageFormat]::Jpeg);$bitmap.Dispose()
}
$font.Dispose()
