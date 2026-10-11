# M-A-3 T10 live PRODUCT hotkey check: same as hotkey-test.ps1 but the Island runs without -HotkeyTest, so it registers
# the real chord Ctrl+Alt+Space, which is then injected. Disposable fake Host on 43891; production is never contacted.
$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$port = 43891
$island = 'C:/Users/allam/Documents/new/bun-router/install/Bunny-Island.ps1'
$utf8 = [Text.UTF8Encoding]::new($false)
Add-Type -Namespace BunnyT10 -Name Win -MemberDefinition @'
public delegate bool EnumProc(System.IntPtr h, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc p, System.IntPtr l);
[System.Runtime.InteropServices.DllImport("user32.dll", CharSet = System.Runtime.InteropServices.CharSet.Unicode)] public static extern int GetWindowText(System.IntPtr h, System.Text.StringBuilder s, int n);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(System.IntPtr h, out uint pid);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern bool PostMessage(System.IntPtr hWnd, uint msg, System.IntPtr wParam, System.IntPtr lParam);
[System.Runtime.InteropServices.DllImport("user32.dll")] public static extern void keybd_event(byte bVk, byte bScan, uint dwFlags, System.UIntPtr dwExtraInfo);
'@
# Every top-level window titled "Bunny Island" with its owning process id.
function Get-IslandWindows {
  $found = New-Object System.Collections.ArrayList
  $callback = [BunnyT10.Win+EnumProc]{ param($h, $l)
    $sb = New-Object System.Text.StringBuilder 256
    [void][BunnyT10.Win]::GetWindowText($h, $sb, 256)
    if ($sb.ToString() -eq 'Bunny Island') { $owner = [uint32]0; [void][BunnyT10.Win]::GetWindowThreadProcessId($h, [ref]$owner); [void]$found.Add(@{ hwnd = $h; pid = [int]$owner }) }
    return $true
  }
  [void][BunnyT10.Win]::EnumWindows($callback, [IntPtr]::Zero)
  return $found
}
$keyUp = 2
$vkControl = 0x11; $vkMenu = 0x12; $vkShift = 0x10; $vkF12 = 0x20

$otherBefore = @(Get-IslandWindows)
$work = Join-Path ([IO.Path]::GetTempPath()) ('bunny-t10-hotkey-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
New-Item -ItemType Directory -Path $work | Out-Null
$log = Join-Path $work 'commands.jsonl'
$fake = Start-Process -FilePath (Get-Command node).Source -ArgumentList @((Join-Path $here 'fake-host.mjs'), [string]$port, 'speaking', $log) -WindowStyle Hidden -PassThru
$cred = Join-Path $work 'cred.json'
[IO.File]::WriteAllText($cred, (@{ token = 'notch-fake-token'; port = $port } | ConvertTo-Json -Compress), $utf8)
$pref = Join-Path $work 'pref.json'
[IO.File]::WriteAllText($pref, (@{ edge = 'top'; position = 'center'; size = 'compact'; motion = 'full'; theme = 'dark' } | ConvertTo-Json -Compress), $utf8)
$receipt = [ordered]@{ milestone = 'M-A-3 T10'; check = 'I4 global hotkey live (PRODUCT chord)'; chord = 'Ctrl+Alt+Space (product chord)'; productionIslandNote = 'production v26 Island registers no global hotkey (grep of v26 install shows no RegisterHotKey), so WM_HOTKEY reaches only this test Island'; fakeHostPort = $port; fakeHostVoiceMode = 'speaking'; otherIslandWindowsBeforeStart = $otherBefore.Count }
$islandProc = $null
$pressAt = 0
try {
  $ready = $false
  for ($i = 0; $i -lt 60 -and -not $ready; $i++) {
    try { $r = Invoke-WebRequest -UseBasicParsing -Uri ('http://127.0.0.1:' + $port + '/state') -Headers @{ Authorization = 'Bearer notch-fake-token' } -TimeoutSec 2; $ready = ($r.StatusCode -eq 200) } catch { }
    if (-not $ready) { Start-Sleep -Milliseconds 150 }
  }
  if (-not $ready) { throw 'fake host did not start' }
  $deploy = Join-Path $work 'no-deploy'
  $islandProc = Start-Process -FilePath 'powershell.exe' -ArgumentList @('-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', $island, '-CredentialPath', $cred, '-DeploymentPath', $deploy, '-PreferencePath', $pref) -WindowStyle Hidden -PassThru
  $own = $null
  for ($i = 0; $i -lt 150 -and -not $own; $i++) { Start-Sleep -Milliseconds 200; $own = @(Get-IslandWindows | Where-Object { $_.pid -eq $islandProc.Id }) | Select-Object -First 1 }
  if (-not $own) { throw 'this test Island window did not appear' }
  Start-Sleep -Milliseconds 4000
  $receipt.ownIslandWindowFound = $true
  # Chord: Ctrl, Alt, Shift, then F12 down; hold 900 ms; release F12, Shift, Alt, Ctrl.
  $pressAt = [DateTimeOffset]::Now.ToUnixTimeMilliseconds()
  [BunnyT10.Win]::keybd_event([byte]$vkControl, 0, 0, [UIntPtr]::Zero)
  [BunnyT10.Win]::keybd_event([byte]$vkMenu, 0, 0, [UIntPtr]::Zero)
  [BunnyT10.Win]::keybd_event([byte]$vkF12, 0, 0, [UIntPtr]::Zero)
  Start-Sleep -Milliseconds 900
  [BunnyT10.Win]::keybd_event([byte]$vkF12, 0, $keyUp, [UIntPtr]::Zero)
  [BunnyT10.Win]::keybd_event([byte]$vkMenu, 0, $keyUp, [UIntPtr]::Zero)
  [BunnyT10.Win]::keybd_event([byte]$vkControl, 0, $keyUp, [UIntPtr]::Zero)
  $receipt.injectedHoldMs = [DateTimeOffset]::Now.ToUnixTimeMilliseconds() - $pressAt
  Start-Sleep -Milliseconds 2500
  # Close THIS Island through its own window: Closing releases the microphone (voice.session.close).
  [void][BunnyT10.Win]::PostMessage($own.hwnd, 0x0010, [IntPtr]::Zero, [IntPtr]::Zero)
  $islandProc.WaitForExit(8000) | Out-Null
  $receipt.islandExitedAfterClose = $islandProc.HasExited
  Start-Sleep -Milliseconds 400
} finally {
  if ($islandProc -and -not $islandProc.HasExited) { Stop-Process -Id $islandProc.Id -Force; $receipt.islandForceStopped = $true }
  if ($fake -and -not $fake.HasExited) { Stop-Process -Id $fake.Id -Force }
}
$events = @(Get-Content -LiteralPath $log -ErrorAction SilentlyContinue | ForEach-Object { $_ | ConvertFrom-Json } | Where-Object { $_.action -ne 'voice.state' })
$receipt.nonPollCommands = @($events | ForEach-Object { [ordered]@{ action = $_.action; atOffsetMs = $_.at - $pressAt; data = $_.data } })
$start = @($events | Where-Object { $_.action -eq 'voice.listen.start' }) | Select-Object -First 1
$end = @($events | Where-Object { $_.action -eq 'voice.listen.end' }) | Select-Object -First 1
$receipt.listenStartReceived = [bool]$start
$receipt.listenEndReceived = [bool]$end
$receipt.listenHoldMs = if ($start -and $end) { $end.at - $start.at } else { $null }
$receipt.interruptSent = [bool](@($events | Where-Object { $_.action -eq 'voice.interrupt' }).Count)
$receipt.sessionCloseOnClose = [bool](@($events | Where-Object { $_.action -eq 'voice.session.close' }).Count)
$receipt.verdict = if ($receipt.listenStartReceived -and $receipt.listenEndReceived -and $receipt.listenHoldMs -ge 350 -and $receipt.sessionCloseOnClose -and -not $receipt.interruptSent) { 'PASS' } else { 'FAIL' }
[IO.File]::WriteAllText((Join-Path $here 'hotkey-product-receipt.json'), ($receipt | ConvertTo-Json -Depth 6), $utf8)
Write-Output ('verdict=' + $receipt.verdict + ' listenStart=' + $receipt.listenStartReceived + ' listenEnd=' + $receipt.listenEndReceived + ' holdMs=' + $receipt.listenHoldMs + ' interrupt=' + $receipt.interruptSent + ' sessionCloseOnClose=' + $receipt.sessionCloseOnClose + ' islandExited=' + $receipt.islandExitedAfterClose)
