# M-A-3 T10 I3 blur experiment. Runs the Island in -SmokeTest twice against the disposable fake Host: once with the alpha
# glass (blur=off) and once with SetWindowCompositionAttribute acrylic (blur=acrylic). Each run captures the ON-SCREEN
# pixels of the notch (Graphics.CopyFromScreen), because RenderTargetBitmap cannot see DWM backdrop effects.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-t10-blur-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$utf8 = [Text.UTF8Encoding]::new($false)
$node = (Get-Command node).Source
$port = 43896
$results = @()
foreach ($mode in @('off', 'acrylic')) {
  $log = Join-Path $work ('blur-' + $mode + '.commands.jsonl')
  $fake = Start-Process -FilePath $node -ArgumentList @((Join-Path $here 'fake-host.mjs'), [string]$port, 'idle', $log) -WindowStyle Hidden -PassThru
  try {
    $ready = $false
    for ($i = 0; $i -lt 50 -and -not $ready; $i++) { try { $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $port + '/state') -Headers @{ Authorization = 'Bearer notch-fake-token' } -TimeoutSec 2; $ready = ($r.StatusCode -eq 200) } catch { Start-Sleep -Milliseconds 150 } }
    if (-not $ready) { throw 'fake host did not start' }
    $cred = Join-Path $work 'cred.json'
    [IO.File]::WriteAllText($cred, (@{ token = 'notch-fake-token'; port = $port } | ConvertTo-Json -Compress), $utf8)
    $pref = Join-Path $work ('pref-' + $mode + '.json')
    [IO.File]::WriteAllText($pref, (@{ edge = 'top'; position = 'center'; size = 'compact'; motion = 'reduced'; theme = 'dark'; blur = $mode } | ConvertTo-Json -Compress), $utf8)
    $receiptPath = Join-Path $work ('blur-' + $mode + '.receipt.json')
    $hook = @"
`$ErrorActionPreference = 'Stop'
Update-Bunny
Set-BunnyView 'idle'
Update-Bunny
`$enabled = `$false
if ('$mode' -eq 'acrylic') { `$enabled = Enable-BunnyBlur }
# Let DWM apply the backdrop before capturing the real screen pixels.
`$frame = [Windows.Threading.DispatcherFrame]::new(); `$timer = [Windows.Threading.DispatcherTimer]::new(); `$timer.Interval = [TimeSpan]::FromMilliseconds(700); `$timer.Add_Tick({ `$timer.Stop(); `$frame.Continue = `$false }); `$timer.Start(); [Windows.Threading.Dispatcher]::PushFrame(`$frame)
Add-Type -AssemblyName System.Drawing
`$source = [Windows.PresentationSource]::FromVisual(`$bunnyWindow)
`$scale = `$source.CompositionTarget.TransformToDevice.M11
`$x = [int][Math]::Floor(`$bunnyWindow.Left * `$scale); `$y = [int][Math]::Floor(`$bunnyWindow.Top * `$scale)
`$w = [int][Math]::Ceiling(`$bunnyWindow.ActualWidth * `$scale); `$h = [int][Math]::Ceiling(`$bunnyWindow.ActualHeight * `$scale)
`$bitmap = New-Object System.Drawing.Bitmap `$w, `$h
`$graphics = [System.Drawing.Graphics]::FromImage(`$bitmap)
`$graphics.CopyFromScreen(`$x, `$y, 0, 0, (New-Object System.Drawing.Size `$w, `$h))
`$out = Join-Path '$here' ('blur-screen-$mode.png')
`$bitmap.Save(`$out, [System.Drawing.Imaging.ImageFormat]::Png)
`$graphics.Dispose(); `$bitmap.Dispose()
[IO.File]::WriteAllText('$receiptPath', ([ordered]@{ mode = '$mode'; blurApplied = `$enabled; scale = `$scale; screenRect = @{ x = `$x; y = `$y; w = `$w; h = `$h }; screenshot = `$out } | ConvertTo-Json -Depth 4), [Text.UTF8Encoding]::new(`$false))
"@
    $hookPath = Join-Path $work ('blur-' + $mode + '.hook.ps1')
    [IO.File]::WriteAllText($hookPath, $hook, $utf8)
    $deploy = Join-Path $work 'no-deploy'
    powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $here 'wrapper.ps1') -HookFile $hookPath -Pref $pref -Shots $here -Cred $cred -Deploy $deploy | Out-Null
    if ($LASTEXITCODE -ne 0 -or -not (Test-Path -LiteralPath $receiptPath)) { throw ('blur run ' + $mode + ' exit ' + $LASTEXITCODE) }
    $results += Get-Content -LiteralPath $receiptPath -Raw | ConvertFrom-Json
  } finally {
    if ($fake -and -not $fake.HasExited) { Stop-Process -Id $fake.Id -Force }
  }
  $port += 1
}
$results | ConvertTo-Json -Depth 4
