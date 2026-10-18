param([string]$Name='portrait',[switch]$Keyboard)
$ErrorActionPreference='Stop'
Add-Type -AssemblyName System.Drawing
$repo=[IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../..'))
$adb=Join-Path $repo 'test-results/android-tools/platform-tools/adb.exe'
$devices=@(& $adb devices | Where-Object {$_ -match '^\S+\s+device\b'})
if($devices.Count -ne 1){throw 'Exactly one authorized handset required.'}
$serial=($devices[0] -split '\s+')[0]
$null=& $adb -s $serial shell am start -W -n com.routeragent.jev/.MainActivity
$focus=@(& $adb -s $serial shell dumpsys window)
$focused=[bool]($focus -match 'mCurrentFocus.*com\.routeragent\.jev')
if(-not $focused){throw 'Bunny-A is not the focused app; refuse capture of unrelated phone content.'}
$temporary='/data/local/tmp/bunny-t13-ui-'+[guid]::NewGuid().ToString('N')+'.xml'
try{
  $null=& $adb -s $serial shell uiautomator dump $temporary
  $xmlText=(@(& $adb -s $serial shell cat $temporary) -join "`n")
}finally{$null=& $adb -s $serial shell rm -f $temporary}
$start=$xmlText.IndexOf('<?xml')
if($start -lt 0){throw 'No UI hierarchy returned.'}
$end=$xmlText.LastIndexOf('</hierarchy>')
[xml]$xml=$xmlText.Substring($start,$end+12-$start)
$nodes=@($xml.SelectNodes('//node') | Where-Object {$_.package -eq 'com.routeragent.jev'})
$safe='^(?:Connect to Bunny-A|Your agents, wherever you work\.|Use the secure phone address shown in Bunny Island, then enter its one-time pairing code\.|Computer.s HTTPS address|https://your-server\.example|Your computer must be awake with Bunny-A Host running\. A temporary tunnel address can change after reconnecting\.|Connect|Connection help|Bunny-A . router_agent\s+Android 8 or newer . version 2\.0|Bunny-A|Connection|Reload|Connection unavailable|Try again|Change connection|Open in browser|Remote connection|Got it|OK)$'
$sanitized=@($nodes | ForEach-Object { @{class=$_.class;bounds=$_.bounds;text=if($_.text -match $safe){$_.text}elseif($_.text){'[WITHHELD]'}else{''};description=if($_.'content-desc' -match $safe){$_.'content-desc'}elseif($_.'content-desc'){'[WITHHELD]'}else{''};clickable=$_.clickable;enabled=$_.enabled;focused=$_.focused} })
$report=@{recordedAt=[DateTime]::UtcNow.ToString('o');name=$Name;focusedAppVerified=$focused;nodes=$sanitized;hierarchyExitCode=$LASTEXITCODE;rawHierarchyRetained=$false;screen=(@(& $adb -s $serial shell wm size) -join ' ');keyboardRequested=[bool]$Keyboard}
$screenshotDirectory=Join-Path $PSScriptRoot 'screenshots'
New-Item -ItemType Directory -Path $screenshotDirectory -Force | Out-Null
# Only native connection/error/help screens are eligible for saved screenshots.
$connectionScreen=[bool]($nodes | Where-Object {$_.text -eq 'Connect to Bunny-A'}) -or ([bool]($nodes|Where-Object {$_.text -eq 'Connect'}) -and [bool]($nodes|Where-Object {$_.text -eq 'Connection help'}))
$failureScreen=[bool]($nodes | Where-Object {$_.text -eq 'Connection unavailable'})
if($connectionScreen -or $failureScreen){
  # Saved configured origins are private. Cover all editable fields and URL labels.
  $info=[Diagnostics.ProcessStartInfo]::new()
  $info.FileName=$adb
  $info.Arguments='-s '+$serial+' exec-out screencap -p'
  $info.UseShellExecute=$false;$info.CreateNoWindow=$true;$info.RedirectStandardOutput=$true;$info.RedirectStandardError=$true
  $process=[Diagnostics.Process]::Start($info)
  $memory=[IO.MemoryStream]::new()
  $process.StandardOutput.BaseStream.CopyTo($memory);$process.WaitForExit()
  if($process.ExitCode -ne 0){throw 'Native screenshot failed.'}
  $memory.Position=0
  $bitmap=[Drawing.Bitmap]::new($memory)
  $graphics=[Drawing.Graphics]::FromImage($bitmap)
  $graphics.FillRectangle([Drawing.Brushes]::Black,0,0,$bitmap.Width,[int]($bitmap.Height*0.045))
  $graphics.FillRectangle([Drawing.Brushes]::Black,0,[int]($bitmap.Height*0.96),$bitmap.Width,[int]($bitmap.Height*0.04)+1)
  $viewport=$nodes|Where-Object {$_.class -eq 'android.widget.ScrollView'}|Select-Object -First 1
  if($viewport -and $viewport.bounds -match '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){
    $left=[int]$Matches[1];$top=[int]$Matches[2];$right=[int]$Matches[3];$bottom=[int]$Matches[4]
    $graphics.FillRectangle([Drawing.Brushes]::Black,0,0,$bitmap.Width,$top)
    $graphics.FillRectangle([Drawing.Brushes]::Black,0,$bottom,$bitmap.Width,($bitmap.Height-$bottom))
    $graphics.FillRectangle([Drawing.Brushes]::Black,0,0,$left,$bitmap.Height)
    $graphics.FillRectangle([Drawing.Brushes]::Black,$right,0,($bitmap.Width-$right),$bitmap.Height)
  }
  foreach($node in $nodes){
    if($node.class -eq 'android.widget.EditText' -or ($node.text -match '^https?://' -and $node.text -ne 'https://your-server.example')){
      if($node.bounds -match '^\[(\d+),(\d+)\]\[(\d+),(\d+)\]$'){
        $graphics.FillRectangle([Drawing.Brushes]::DarkSlateGray,[int]$Matches[1],[int]$Matches[2],([int]$Matches[3]-[int]$Matches[1]),([int]$Matches[4]-[int]$Matches[2]))
      }
    }
  }
  if($Keyboard){$graphics.FillRectangle([Drawing.Brushes]::Black,0,[int]($bitmap.Height*0.66),$bitmap.Width,[int]($bitmap.Height*0.34)+1)}
  $bitmap.Save((Join-Path $screenshotDirectory "$Name.png"),[Drawing.Imaging.ImageFormat]::Png)
  $graphics.Dispose();$bitmap.Dispose();$memory.Dispose();$process.Dispose()
  $report.screenshot="screenshots/$Name.png"
  $report.sanitization='System status/navigation areas, editable/URL fields masked in memory before saving; keyboard area additionally masked when requested.'
}else{$report.screenshot='WITHHELD: screen was not a known native connection/error surface'}
[IO.File]::WriteAllText((Join-Path $PSScriptRoot "$Name-surface.json"),($report | ConvertTo-Json -Depth 6)+"`n")
$report | Select-Object focusedAppVerified,screenshot | ConvertTo-Json
