$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
foreach($json in Get-ChildItem -LiteralPath $PSScriptRoot -Filter '*-surface.json' -File){
  $surface=Get-Content -LiteralPath $json.FullName -Raw|ConvertFrom-Json
  if(-not $surface.screenshot -or -not $surface.screenshot.StartsWith('screenshots/')){continue}
  $path=Join-Path $PSScriptRoot $surface.screenshot
  $viewport=$surface.nodes|Where-Object class -eq 'android.widget.ScrollView'|Select-Object -First 1
  if(-not $viewport -or $viewport.bounds -notmatch '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){throw 'Missing observed app viewport for screenshot sanitization.'}
  $left=[int]$Matches[1];$top=[int]$Matches[2];$right=[int]$Matches[3];$bottom=[int]$Matches[4]
  $bytes=[IO.File]::ReadAllBytes($path);$memory=[IO.MemoryStream]::new($bytes)
  $bitmap=[Drawing.Bitmap]::new($memory);$graphics=[Drawing.Graphics]::FromImage($bitmap)
  $graphics.FillRectangle([Drawing.Brushes]::Black,0,0,$bitmap.Width,$top)
  $graphics.FillRectangle([Drawing.Brushes]::Black,0,$bottom,$bitmap.Width,($bitmap.Height-$bottom))
  $graphics.FillRectangle([Drawing.Brushes]::Black,0,0,$left,$bitmap.Height)
  $graphics.FillRectangle([Drawing.Brushes]::Black,$right,0,($bitmap.Width-$right),$bitmap.Height)
  $bitmap.Save($path,[Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose();$bitmap.Dispose();$memory.Dispose()
}
'All retained screenshots masked to observed app viewport, including landscape system bars.'
