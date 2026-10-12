# M-A-3 T10: native voice client for the Island. Voice is an input/output modality. This file sends voice.* Host
# actions and renders the Host VoiceSnapshot. It never authorizes anything, never fabricates text or a level, and
# animates nothing from timers. Requests run off the UI thread: one FIFO queue, one in-flight HttpClient request,
# and a 100 ms DispatcherTimer that only inspects finished tasks. Closing the Island never calls agent or mission
# actions; it closes the voice session so the Host releases the microphone.
Add-Type -AssemblyName System.Net.Http

$bunnyIcons['mic'] = 'M 12,2 a 3,3 0 0 0 -3,3 v 7 a 3,3 0 0 0 6,0 V 5 a 3,3 0 0 0 -3,-3 Z M 19,10 v 2 a 7,7 0 0 1 -14,0 v -2 M 12,19 v 3'
$bunnyVoiceHotkeyId = 0x4246
# Product chord: Ctrl+Alt+Space (MOD_ALT 0x1 | MOD_CONTROL 0x2 | MOD_NOREPEAT 0x4000, VK_SPACE 0x20).
# -HotkeyTest (a dedicated live check only) registers Ctrl+Alt+Shift+F12 instead, so a test never reaches a running product Island.
$bunnyVoiceChord = if ($HotkeyTest) { @(0x4007, 0x7B) } else { @(0x4003, 0x20) }
$bunnyVoicePollMs = 200
$bunnyVoiceFreshMs = 1000
$bunnyVoiceHoldMs = 350
# A quick tap latches tap-to-talk: the turn stays open until the next tap, this deadline, or the Host's own cap.
$bunnyVoiceTapLatchMs = 10000
$bunnyVoiceFlightTimeoutMs = 12000
$bunnyNativeKeysDefinition = @'
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool RegisterHotKey(System.IntPtr hWnd, int id, uint fsModifiers, uint vk);
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError = true)]
public static extern bool UnregisterHotKey(System.IntPtr hWnd, int id);
[System.Runtime.InteropServices.DllImport("user32.dll")]
public static extern short GetAsyncKeyState(int vKey);
'@

$script:bunnyVoiceSnapshot = $null
$script:bunnyVoiceOkAt = 0
$script:bunnyVoiceError = $null
$script:bunnyVoiceShortcutNote = ''
$script:bunnyVoiceQueue = New-Object System.Collections.ArrayList
$script:bunnyVoiceFlight = $null
$script:bunnyVoiceLastPoll = 0
$script:bunnyVoiceOpenPolling = $false
$script:bunnyVoiceUiSeen = $null
$script:bunnyVoiceUiEpoch = $null
$script:bunnyVoiceTapLatched = $false
$script:bunnyVoiceTapAt = 0
$script:bunnyVoiceHttp = $null
$script:bunnyVoiceListening = $false
$script:bunnyVoiceListenAt = 0
$script:bunnyVoiceHeld = $false
$script:bunnyVoiceHeldAt = 0
$script:bunnyVoiceMouseAt = 0
# Pointer activation that Click will report: the Click that follows a mouse release is the pointer's own, never a toggle.
$script:bunnyVoicePointerClick = $false
$script:bunnyVoicePointerUpAt = 0
# Outcome of the last listen.start: known (the Host answered with its turn), none (refused or never sent), unknown (lost).
$script:bunnyVoiceStartState = 'none'
$script:bunnyVoiceStartTurn = $null
# True while the Host may hold this Island's session (an open or listen was sent or queued and no close has been).
$script:bunnyVoiceOpenSent = $false
$script:bunnyVoiceUpdating = $false
$script:bunnyVoiceLayoutKey = ''
$script:bunnyVoiceRegistered = $false
$script:bunnyVoiceHwnd = [IntPtr]::Zero
$script:bunnyVoiceHook = $null

function Get-BunnyNowMs { [DateTimeOffset]::Now.ToUnixTimeMilliseconds() }

function Get-BunnyVoiceClient {
  if (-not $script:bunnyVoiceHttp) {
    $client = [System.Net.Http.HttpClient]::new()
    $client.Timeout = [TimeSpan]::FromSeconds(8)
    $script:bunnyVoiceHttp = $client
  }
  return $script:bunnyVoiceHttp
}

function New-BunnyVoiceRequestMessage([string]$Action, $Data) {
  $credentials = Get-Content -LiteralPath $bunnyCredentialPath -Raw | ConvertFrom-Json
  $request = [System.Net.Http.HttpRequestMessage]::new([System.Net.Http.HttpMethod]::Post, 'http://127.0.0.1:' + [string]$credentials.port + '/command')
  $request.Headers.Authorization = [System.Net.Http.Headers.AuthenticationHeaderValue]::new('Bearer', [string]$credentials.token)
  $request.Content = [System.Net.Http.StringContent]::new((@{ action = $Action; data = $Data } | ConvertTo-Json -Depth 8 -Compress), [Text.Encoding]::UTF8, 'application/json')
  return $request
}

function Add-BunnyVoiceRequest([string]$Action, $Data = @{}, [bool]$Urgent = $false) {
  if ($Action -eq 'voice.state' -and $script:bunnyVoiceQueue.Count -gt 0) { return }
  $item = @{ action = $Action; data = $Data }
  if ($Action -eq 'voice.session.open' -or $Action -eq 'voice.listen.start') { $script:bunnyVoiceOpenSent = $true }
  if ($Action -eq 'voice.session.close') { $script:bunnyVoiceOpenSent = $false }
  if ($Urgent) { $script:bunnyVoiceQueue.Insert(0, $item) } else { [void]$script:bunnyVoiceQueue.Add($item) }
  Invoke-BunnyVoicePump
}

function Start-BunnyVoiceFlight {
  $item = $script:bunnyVoiceQueue[0]
  $script:bunnyVoiceQueue.RemoveAt(0)
  # The queue is single-flight FIFO, so a release is dequeued only after the listen.start before it has settled. Bind it to
  # the turn that start was answered with (never to an older snapshot). A start whose answer was lost has no known turn:
  # the release then goes unbound and ends whatever capture the Host holds. The Host ignores a release whose turn is stale.
  if ([string]$item.action -eq 'voice.listen.end' -and -not $item.data.turnId -and $script:bunnyVoiceStartState -eq 'known' -and $script:bunnyVoiceStartTurn) {
    $item.data = @{ turnId = [string]$script:bunnyVoiceStartTurn }
  }
  try {
    $request = New-BunnyVoiceRequestMessage ([string]$item.action) $item.data
    $script:bunnyVoiceFlight = @{ action = [string]$item.action; send = (Get-BunnyVoiceClient).SendAsync($request); read = $null; response = $null; stage = 'send'; at = Get-BunnyNowMs }
  } catch {
    # The request was never sent, so the Host holds no capture from it.
    Set-BunnyVoiceStartOutcome ([string]$item.action) 'none' $null
    $script:bunnyVoiceError = 'Voice request could not be sent'
  }
}

function Set-BunnyVoiceStartOutcome([string]$Action, [string]$Outcome, $Turn) {
  if ($Action -ne 'voice.listen.start') { return }
  $script:bunnyVoiceStartState = $Outcome
  $script:bunnyVoiceStartTurn = if ($Outcome -eq 'known' -and $Turn) { [string]$Turn } else { $null }
}

function Set-BunnyVoiceFlightLost($Flight) {
  # No answer arrived (timeout, unreachable, unreadable): a listen.start may still have opened a capture on the Host.
  Set-BunnyVoiceStartOutcome ([string]$Flight.action) 'unknown' $null
}

function Complete-BunnyVoiceResponse([int]$Status, [string]$Text, [string]$Action = '') {
  $body = $null
  try { $body = $Text | ConvertFrom-Json } catch { $body = $null }
  if ($Status -ge 200 -and $Status -lt 300 -and $body -and $body.data) {
    Set-BunnyVoiceSnapshot $body.data
    $inputTurn = if ($body.data.inputTurnId) { $body.data.inputTurnId } else { $body.data.turnId }
    Set-BunnyVoiceStartOutcome $Action 'known' $inputTurn
    return
  }
  # The Host answered and refused (or failed) before it captured anything.
  Set-BunnyVoiceStartOutcome $Action 'none' $null
  $script:bunnyVoiceError = if ($body -and $body.error) { [string]$body.error } else { 'Voice request failed (HTTP ' + $Status + ')' }
}

function Invoke-BunnyVoicePump {
  try { Invoke-BunnyVoicePumpCore } catch { $script:bunnyVoiceFlight = $null; $script:bunnyVoiceError = 'Voice client error: ' + $_.Exception.Message }
}

function Invoke-BunnyVoicePumpCore {
  $flight = $script:bunnyVoiceFlight
  if ($flight) {
    if ((Get-BunnyNowMs) - [double]$flight.at -gt $bunnyVoiceFlightTimeoutMs) {
      # The late HTTP result is dropped with the reference; it can never reach the snapshot.
      $script:bunnyVoiceFlight = $null
      Set-BunnyVoiceFlightLost $flight
      $script:bunnyVoiceError = 'Voice request timed out'
    } elseif ($flight.stage -eq 'send') {
      if ($flight.send.IsFaulted -or $flight.send.IsCanceled) {
        $script:bunnyVoiceFlight = $null
        Set-BunnyVoiceFlightLost $flight
        $script:bunnyVoiceError = 'Host unreachable for voice'
      } elseif ($flight.send.IsCompleted) {
        $flight.response = $flight.send.Result
        $flight.read = $flight.response.Content.ReadAsStringAsync()
        $flight.stage = 'read'
      }
    }
    $flight = $script:bunnyVoiceFlight
    if ($flight -and $flight.stage -eq 'read' -and $flight.read.IsCompleted) {
      $script:bunnyVoiceFlight = $null
      if ($flight.read.IsFaulted) { Set-BunnyVoiceFlightLost $flight; $script:bunnyVoiceError = 'Voice response could not be read' }
      else { Complete-BunnyVoiceResponse ([int]$flight.response.StatusCode) $flight.read.Result ([string]$flight.action) }
    }
  }
  if (-not $script:bunnyVoiceFlight -and $script:bunnyVoiceQueue.Count -gt 0) { Start-BunnyVoiceFlight }
}

function Test-BunnyVoiceNewer($Candidate, $Current) {
  # Within one Host epoch the monotonic voice.revision decides; across epochs, or when a snapshot has no revision yet,
  # updatedAt decides (the earlier rule). A Host restart starts a new epoch, so its revisions never compare with the old.
  if (-not $Current) { return $true }
  if (-not $Candidate) { return $false }
  if ($null -ne $Candidate.revision -and $null -ne $Current.revision -and [string]$Candidate.hostEpoch -eq [string]$Current.hostEpoch) {
    return ([double]$Candidate.revision -ge [double]$Current.revision)
  }
  return ([double]$Candidate.updatedAt -ge [double]$Current.updatedAt)
}

function Get-BunnyVoiceSource {
  # The 2 s /state snapshot and the 200 ms voice poll are both real Host facts; the newer one wins.
  $fromPoll = $script:bunnyVoiceSnapshot
  $fromState = if ($bunnySnapshot) { $bunnySnapshot.voice } else { $null }
  if (-not $fromPoll) { return $fromState }
  if (-not $fromState) { return $fromPoll }
  if (Test-BunnyVoiceNewer $fromPoll $fromState) { return $fromPoll }
  return $fromState
}

function Invoke-BunnyVoiceIntent($Snap) {
  # One-shot UI request from the Host. Opened once per seq, scoped to the Host epoch that numbered it: a Host restart
  # restarts seq at 1, so a new epoch starts its floor at 0 and an old seq never replays. The first seen seq only seeds,
  # so a stale intent from before this Island started never opens a window.
  if (-not $Snap) { return }
  $epoch = [string]$Snap.hostEpoch
  if ($script:bunnyVoiceUiEpoch -ne $epoch) {
    if ($null -ne $script:bunnyVoiceUiSeen) { $script:bunnyVoiceUiSeen = 0.0 }
    $script:bunnyVoiceUiEpoch = $epoch
  }
  $intent = $Snap.uiIntent
  # The first snapshot seeds the floor even when it carries no intent (seq 0, as planUiIntent does), so the first intent
  # produced after this Island started is never swallowed. An intent already present at start seeds its own seq.
  $hasIntent = [bool]($intent -and $null -ne $intent.seq)
  $seq = if ($hasIntent) { [double]$intent.seq } else { 0.0 }
  if ($null -eq $script:bunnyVoiceUiSeen) { $script:bunnyVoiceUiSeen = $seq; return }
  if (-not $hasIntent -or $seq -le $script:bunnyVoiceUiSeen) { return }
  $script:bunnyVoiceUiSeen = $seq
  $query = if ([string]$intent.kind -eq 'open_agent' -and $intent.agentId) { '?view=agentic&agent=' + [Uri]::EscapeDataString([string]$intent.agentId) } else { '?view=agentic' }
  try { Open-BunnyDashboard $query } catch { $script:bunnyVoiceError = 'Could not open the workspace' }
}

function Set-BunnyVoiceSnapshot($Snap) {
  $script:bunnyVoiceSnapshot = $Snap
  $script:bunnyVoiceOkAt = Get-BunnyNowMs
  $script:bunnyVoiceError = $null
  Invoke-BunnyVoiceIntent $Snap
}

function Test-BunnyVoiceQueued([string]$Action) {
  if ($script:bunnyVoiceFlight -and $script:bunnyVoiceFlight.action -eq $Action) { return $true }
  foreach ($item in $script:bunnyVoiceQueue) { if ($item.action -eq $Action) { return $true } }
  return $false
}

function Start-BunnyVoiceListen([string]$Source) {
  $snap = Get-BunnyVoiceSource
  # Hands-free has no hold: a push-to-talk start never reaches the Host in that mode (the hands-free start is explicit).
  if ($snap -and $snap.open -and [string]$snap.mode -eq 'hands_free') { return }
  if (-not ($snap -and $snap.open) -and -not (Test-BunnyVoiceQueued 'voice.session.open')) {
    Add-BunnyVoiceRequest 'voice.session.open' @{ mode = 'push_to_talk' } $false
  }
  $script:bunnyVoiceListening = $true
  $script:bunnyVoiceListenAt = Get-BunnyNowMs
  Set-BunnyView 'voice'
  Add-BunnyVoiceRequest 'voice.listen.start' @{ source = $Source } $false
}

function Stop-BunnyVoiceListen {
  # Every end (second tap, hold release, keyboard toggle, Host turn end) clears the tap-to-talk latch.
  $script:bunnyVoiceTapLatched = $false
  if (-not $script:bunnyVoiceListening) { return }
  $script:bunnyVoiceListening = $false
  Add-BunnyVoiceRequest 'voice.listen.end' @{} $false
}

function Request-BunnyVoiceInterrupt([string]$Source) {
  Add-BunnyVoiceRequest 'voice.interrupt' @{ source = $Source } $true
}

function Invoke-BunnyVoiceClick {
  # Keyboard activation (Space or Enter) toggles. Mouse activation is handled by the press and release pair: the Click
  # that a mouse release raises is the pointer's own and is consumed here, however long the button was held.
  # The mic never refuses to listen while SPEAKING: voice.listen.start is sent and the Host performs the barge-in.
  $pointerClick = [bool]$script:bunnyVoicePointerClick
  $script:bunnyVoicePointerClick = $false
  if ($pointerClick -and ((Get-BunnyNowMs) - [double]$script:bunnyVoicePointerUpAt) -lt 500) { return }
  if ($script:bunnyVoiceListening) { Stop-BunnyVoiceListen; return }
  Start-BunnyVoiceListen 'button'
}

function Start-BunnyVoicePointer {
  # Press-and-hold is push-to-talk, whether or not the Host is speaking. Stopping speech is the separate Interrupt control.
  # A press while a tap has latched the turn open is the second tap: it finishes that turn and starts nothing new.
  $script:bunnyVoiceMouseAt = Get-BunnyNowMs
  if ($script:bunnyVoiceTapLatched) { Stop-BunnyVoiceListen; return }
  Start-BunnyVoiceListen 'push_to_talk'
}

function Stop-BunnyVoicePointer {
  # A hold of at least the hold threshold ends the turn. A quick tap is tap-to-talk: the turn stays open, the view says
  # "Listening - tap to finish", and it ends on the next tap, the latch deadline, or the Host's own cap.
  # The Click that this release raises is the pointer's own (Invoke-BunnyVoiceClick consumes it), so it never restarts.
  $script:bunnyVoicePointerClick = $true
  $script:bunnyVoicePointerUpAt = Get-BunnyNowMs
  if (((Get-BunnyNowMs) - [double]$script:bunnyVoiceMouseAt) -ge $bunnyVoiceHoldMs) { Stop-BunnyVoiceListen; return }
  if ($script:bunnyVoiceListening) { $script:bunnyVoiceTapLatched = $true; $script:bunnyVoiceTapAt = Get-BunnyNowMs }
}

# Opens and listens that were queued but not yet sent never reach the Host once the Island closes.
function Clear-BunnyVoiceOpening {
  $kept = New-Object System.Collections.ArrayList
  foreach ($item in $script:bunnyVoiceQueue) {
    if ([string]$item.action -ne 'voice.session.open' -and [string]$item.action -ne 'voice.listen.start') { [void]$kept.Add($item) }
  }
  $script:bunnyVoiceQueue = $kept
}

function Invoke-BunnyVoiceCloseNow {
  # The close is ordered after a request already in flight (bounded wait), so an open that is in flight cannot land after it.
  Clear-BunnyVoiceOpening
  $flight = $script:bunnyVoiceFlight
  if ($flight -and $flight.send) { try { [void]$flight.send.Wait(1500) } catch { } }
  $script:bunnyVoiceFlight = $null
  $script:bunnyVoiceListening = $false
  $script:bunnyVoiceTapLatched = $false
  $script:bunnyVoiceOpenSent = $false
  [void](Get-BunnyVoiceClient).SendAsync((New-BunnyVoiceRequestMessage 'voice.session.close' @{ source = 'island_exit' })).Wait(1500)
}

# The toggle shows the Host's mode and nothing else. Switching never opens the microphone: hands-free needs the explicit
# Start hands-free control (voice.listen.start source hands_free), which creates the Host grant. The Host switches the
# mode in place when a session is already open (same session, same worker).
function Set-BunnyHandsFree([bool]$Want) {
  if ($script:bunnyVoiceUpdating) { return }
  $snap = Get-BunnyVoiceSource
  $mode = if ($Want) { 'hands_free' } else { 'push_to_talk' }
  if ($snap -and $snap.open) {
    if ([string]$snap.mode -eq $mode) { return }
    # A press still held when the mode changes is ended first (queued ahead of the open): hands-free has no hold.
    Stop-BunnyVoiceListen
    Add-BunnyVoiceRequest 'voice.session.open' @{ mode = $mode } $false
  } elseif ($Want) {
    Add-BunnyVoiceRequest 'voice.session.open' @{ mode = $mode } $false
  }
  Set-BunnyView 'voice'
}

# A proposal the Host has not expired yet. The Host keeps an unanswered proposal until a later turn, so the expiry is checked here.
function Get-BunnyVoiceLiveProposal($Snap, [double]$Now) {
  if (-not $Snap -or -not $Snap.proposal) { return $null }
  if ($Now -ge [double]$Snap.proposal.expiresAt) { return $null }
  return $Snap.proposal
}

function Get-BunnyVoiceLabel($Snap, [bool]$Open, [bool]$Fresh, [string]$State, $Waiting, [bool]$Proposal) {
  if (-not $bunnyOnline) { return 'Host offline - voice unavailable' }
  if (-not $Open) { return 'Voice is off' }
  if (-not $Fresh) { return 'Reconnecting' + $bunnyEllipsis }
  if ($Snap.muted -or $State -eq 'MUTED') { return 'Microphone muted' }
  # Composite truth, as voice-model.ts: each half is claimed only from its own real flag.
  if ($Snap.duplex -and $Snap.duplex.releasing) { return 'Releasing microphone' + $bunnyEllipsis }
  if ($Snap.capturing -and $Snap.playing) { return 'Listening and speaking' }
  if ($Snap.playing) { return 'Speaking' }
  if ($Snap.outputHeld) { return 'Paused for you' }
  if ($Snap.capturing) { return 'Listening' }
  if ($Proposal -or @($Waiting).Count -gt 0) { return 'Needs approval' }
  if ($State -eq 'TRANSCRIBING' -or $State -eq 'PROCESSING') { return 'Processing' }
  if ($State -eq 'INTERRUPTED') { return 'Interrupted' }
  if ($State -eq 'ERROR' -or $State -eq 'DEVICE_UNAVAILABLE') { return 'Voice needs attention' }
  return 'Ready'
}

function Get-BunnyVoiceDeviceLine($Snap) {
  if (-not $bunnyOnline) { return '' }
  if ($script:bunnyVoiceError) { return [string]$script:bunnyVoiceError }
  if (-not $Snap) { return '' }
  $code = if ($Snap.error) { [string]$Snap.error.code } else { '' }
  if ($Snap.devices -and $Snap.devices.micPrivacy -eq 'deny') { return 'Microphone access is off in Windows privacy settings' }
  if ($code -eq 'ENDPOINT_MUTED' -or ($Snap.devices -and $Snap.devices.input -and $Snap.devices.input.muted -eq $true)) { return 'Microphone is muted in Windows' }
  if ($code -eq 'PERMISSION_DENIED') { return 'Microphone access is off in Windows privacy settings' }
  if ($code -eq 'DEVICE_UNAVAILABLE') { return 'Microphone unavailable: no usable input device' }
  if ($code -eq 'DEVICE_LOST') { return 'Microphone disconnected' }
  # Playback into a muted or zero-volume endpoint is inaudible: say so instead of implying Bunny is heard.
  if ($Snap.devices -and $Snap.devices.output -and $Snap.devices.output.present -and ($Snap.devices.output.muted -eq $true -or ($null -ne $Snap.devices.output.volume -and [double]$Snap.devices.output.volume -eq 0))) { return "Speakers are muted in Windows. Bunny's replies are shown as text." }
  if ($code -eq 'DEVICE_BUSY') { return 'Microphone is in use by another app' }
  # Same copy as HANDS_FREE_UNAVAILABLE in voice-model.ts: hands-free is refused and push-to-talk remains.
  if ($code -eq 'AEC_UNAVAILABLE') { return 'Echo-cancelled hands-free audio is unavailable. Use push-to-talk.' }
  if ($code) {
    $message = [string]$Snap.error.message
    if ($message.Length -gt 160) { $message = $message.Substring(0, 160) }
    return $message
  }
  return ''
}

# The hands-free status row, derived from snapshot.duplex (mirrors handsFreeStatus in voice-model.ts). It never drives the
# toggle. Empty outside hands-free mode.
function Get-BunnyHandsFreeRow($Snap) {
  # Nothing is shown while no session is open: mode and the last stop reason outlive a close on the Host.
  if (-not $Snap -or -not $Snap.open -or [string]$Snap.mode -ne 'hands_free') { return '' }
  $duplex = $Snap.duplex
  if ($Snap.muted -or [string]$Snap.state -eq 'MUTED') { return 'Muted' }
  if ($duplex -and $duplex.starting) { return 'Starting' + $bunnyEllipsis }
  if ($duplex -and $duplex.releasing) { return 'Releasing microphone' + $bunnyEllipsis }
  if (($duplex -and $duplex.available -eq $false) -or ($Snap.error -and [string]$Snap.error.code -eq 'AEC_UNAVAILABLE')) {
    return 'Echo-cancelled hands-free audio is unavailable. Use push-to-talk.'
  }
  if ($duplex -and $duplex.active) {
    if ($Snap.outputHeld) { return 'Paused for you' }
    return 'Listening while Bunny speaks (echo-cancelled)'
  }
  $stopped = if ($duplex) { $duplex.stopped } else { $null }
  if ($stopped) {
    $reason = [string]$stopped.reason
    if ($reason -eq 'idle') { return 'Stopped after 2 minutes of silence' }
    if ($reason -eq 'lifetime') { return 'Stopped after 30 minutes' }
    return 'Stopped (' + $reason.Replace('_', ' ') + ')'
  }
  return 'Off. Press Start hands-free to listen.'
}

# Compact barge-in receipt (mirrors bargeInNote in voice-model.ts): data only, shown only when the Host measured it.
function Get-BunnyBargeInNote($Snap) {
  if (-not $Snap -or -not $Snap.open -or -not $Snap.lastBargeIn -or $null -eq $Snap.lastBargeIn.detectionToSilenceMs) { return '' }
  $ms = [double]$Snap.lastBargeIn.detectionToSilenceMs
  if ($ms -lt 0) { return '' }
  return 'Stopped speaking in ' + [string][Math]::Round($ms) + ' ms'
}

# A render fault is reported in the device line; it must never mark the Host offline in Update-Bunny.
# The Notch's short voice line. The full headline stays in the expanded panel; nothing here is claimed beyond the headline.
function Get-BunnyNotchStatus([string]$Headline) {
  $ellipsis = $bunnyEllipsis
  switch ($Headline) {
    'Host offline - voice unavailable' { return 'Host offline' }
    'Voice is off' { return 'Voice is off' }
    'Listening' { return 'Listening' + $ellipsis }
    'Listening - tap to finish' { return 'Listening' + $ellipsis }
    'Speaking' { return 'Speaking' + $ellipsis }
    'Listening and speaking' { return 'Listening and speaking' }
    'Processing' { return 'Thinking' + $ellipsis }
    'Microphone muted' { return 'Muted' }
    'Ready' { return 'Ready' }
    default { if ($Headline.StartsWith('Needs approval')) { return 'Needs approval' }; return $Headline }
  }
}
# Five bars with fixed relative heights. Heights come from the real level only; without a fresh level they rest flat and dim.
function Update-BunnyNotchBars([double]$Rms, [bool]$Live) {
  $factors = @(0.45, 0.8, 1.0, 0.7, 0.5)
  for ($i = 0; $i -lt 5; $i++) {
    $bar = $bunnyControls['Bar' + ($i + 1)]
    $bar.Height = if ($Live) { [Math]::Round(4 + 16 * $Rms * $factors[$i], 1) } else { 4 }
    $bar.Opacity = if ($Live) { 1 } else { 0.35 }
  }
}

function Update-BunnyVoice {
  try { Update-BunnyVoiceView } catch { $script:bunnyVoiceError = 'Voice display error: ' + $_.Exception.Message }
}

function Update-BunnyVoiceView {
  $now = Get-BunnyNowMs
  $stateSnap = if ($bunnySnapshot) { $bunnySnapshot.voice } else { $null }
  if ($stateSnap) { Invoke-BunnyVoiceIntent $stateSnap }
  $snap = Get-BunnyVoiceSource
  $open = [bool]($snap -and $snap.open)
  $script:bunnyVoiceOpenPolling = $open
  $fresh = ($now - [double]$script:bunnyVoiceOkAt) -lt $bunnyVoiceFreshMs
  $state = if ($snap) { [string]$snap.state } else { '' }
  $waiting = @($bunnySnapshot.agents.agents | Where-Object { $_.authorization -and $_.authorization.state -eq 'WAITING_FOR_USER' })
  $proposal = Get-BunnyVoiceLiveProposal $snap $now
  $label = Get-BunnyVoiceLabel $snap $open $fresh $state $waiting ([bool]$proposal)
  if ($label -eq 'Needs approval') {
    $who = if ($proposal) { [string]$proposal.agentName } elseif ($waiting.Count) { [string]$waiting[0].name } else { '' }
    if ($who) { $label = 'Needs approval for ' + $who }
  }
  # A tap-latched turn the user never finished ends at the latch deadline, so the mic is never open unannounced.
  if ($script:bunnyVoiceTapLatched -and ($now - [double]$script:bunnyVoiceTapAt) -gt $bunnyVoiceTapLatchMs) { Stop-BunnyVoiceListen }
  # A turn the Host has already ended must not keep the local "listening" intent alive.
  if ($script:bunnyVoiceListening -and $open -and -not $snap.capturing -and $state -ne 'ARMING' -and -not (Test-BunnyVoiceQueued 'voice.listen.start') -and ($now - [double]$script:bunnyVoiceListenAt) -gt 1500) {
    $script:bunnyVoiceListening = $false
    $script:bunnyVoiceTapLatched = $false
  }
  $headline = $label
  if ($script:bunnyVoiceTapLatched -and $label -eq 'Listening') { $headline = 'Listening - tap to finish' }

  # Level meter: driven only by a fresh snapshot.level while the worker reports capture. No timer, no waveform.
  $track = $bunnyControls.VoiceMeterTrack
  $maxWidth = if ($track.ActualWidth -gt 0) { $track.ActualWidth } else { 240 }
  $rms = 0.0
  if ($open -and $fresh -and $snap.capturing -and $snap.level -and (($now - [double]$snap.level.at) -ge 0) -and (($now - [double]$snap.level.at) -lt $bunnyVoiceFreshMs)) {
    $rms = [Math]::Min(1.0, [Math]::Max(0.0, [double]$snap.level.rms))
  }
  $bunnyControls.VoiceMeter.Width = [Math]::Round($maxWidth * $rms, 1)
  # The Notch shows the same truth in a short form, and its bars move only with that real level (flat when there is none).
  $bunnyControls.NotchStatus.Text = Get-BunnyNotchStatus $headline
  Update-BunnyNotchBars $rms ([bool]($open -and $fresh -and $snap.capturing))

  $device = Get-BunnyVoiceDeviceLine $snap
  $deviceLine = (@($device, $script:bunnyVoiceShortcutNote) | Where-Object { $_ }) -join ' '
  $showCompact = [bool]($open -or $script:bunnyVoiceError)
  # The voice line lives in the Notch status and the expanded panel; the compact line never grows the collapsed Notch.
  $bunnyControls.CompactVoice.Visibility = 'Collapsed'
  $bunnyControls.CompactVoice.Text = if ($deviceLine) { $headline + ' ' + $bunnyDot + ' ' + $deviceLine } else { $headline }
  $bunnyControls.VoiceHeadline.Text = $headline
  $handsFreeMode = [bool]($open -and [string]$snap.mode -eq 'hands_free')
  $bunnyControls.VoiceHint.Text = if (-not $open) { 'Hold the mic or press Ctrl + Alt + Space to talk. Bunny answers out loud and never acts on speech alone.' } elseif ($script:bunnyVoiceTapLatched) { 'Tap the mic again to finish. Speech is only text until you confirm an action on screen.' } elseif ($proposal) { 'Confirm or cancel on screen. Speech alone never changes an agent.' } elseif ($handsFreeMode) { 'Hands-free keeps the microphone on while Bunny speaks, using Windows echo cancellation on the default speaker. It turns off after 2 minutes of silence and after 30 minutes.' } else { 'Speech is only text until you confirm an action on screen.' }
  $bunnyControls.VoiceDevice.Text = $deviceLine
  $partial = if ($open -and $snap -and $snap.partial) { [string]$snap.partial } else { '' }
  $bunnyControls.VoicePartialLabel.Visibility = if ($partial) { 'Visible' } else { 'Collapsed' }
  $bunnyControls.VoicePartial.Visibility = if ($partial) { 'Visible' } else { 'Collapsed' }
  $bunnyControls.VoicePartial.Text = $partial
  $final = if ($snap -and $snap.finalTranscript) { 'You said: ' + [string]$snap.finalTranscript } else { '' }
  $bunnyControls.VoiceFinal.Text = $final
  $answer = if ($snap -and $snap.answer) { [string]$snap.answer } else { '' }
  $bunnyControls.VoiceAnswer.Text = $answer
  $route = if ($snap -and $snap.route) { 'Answered by ' + [string]$snap.route.provider + ' ' + $bunnyDot + ' ' + [string]$snap.route.model } else { '' }
  $bunnyControls.VoiceRoute.Text = $route
  $bunnyControls.VoiceRoute.Visibility = if ($route) { 'Visible' } else { 'Collapsed' }
  $clarify = if ($snap -and $snap.clarification) { [string]$snap.clarification.question + ' Options: ' + ((@($snap.clarification.candidates) | ForEach-Object { [string]$_.name }) -join ' / ') } else { '' }
  $bunnyControls.VoiceClarify.Text = $clarify
  $bunnyControls.VoiceClarify.Visibility = if ($clarify) { 'Visible' } else { 'Collapsed' }
  if ($proposal) {
    # A Mission stop is screen-confirm only (voice never confirms it), so its sentence says so and never offers voice.
    $isMission = [string]$proposal.subject -eq 'mission'
    $verb = switch ([string]$proposal.action) { 'agent.pause' { 'Pause' } 'agent.resume' { 'Resume' } 'agent.stop' { 'Stop' } 'mission.stop' { 'Stop' } default { 'Change' } }
    $subjectWord = if ($isMission) { 'the Mission ' } else { '' }
    $sayConfirm = [string]$proposal.confirmVia -eq 'voice_or_screen' -and -not $isMission
    $bunnyControls.VoiceProposalText.Text = $verb + ' ' + $subjectWord + [string]$proposal.agentName + '? ' + $(if ($sayConfirm) { 'Say confirm or press Confirm.' } else { 'Press Confirm on screen to proceed.' })
    $bunnyControls.VoiceProposal.Visibility = 'Visible'
  } else {
    $bunnyControls.VoiceProposal.Visibility = 'Collapsed'
  }

  $online = [bool]$bunnyOnline
  $duplex = if ($snap) { $snap.duplex } else { $null }
  $duplexBusy = [bool]($duplex -and ($duplex.active -or $duplex.starting -or $duplex.releasing))
  $duplexUnavailable = [bool]($duplex -and $duplex.available -eq $false) -or [bool]($snap -and $snap.error -and [string]$snap.error.code -eq 'AEC_UNAVAILABLE')
  $deviceBlocked = [bool]($snap -and ($snap.muted -or $snap.devices.micPrivacy -eq 'deny'))
  $startShown = [bool]($handsFreeMode -and -not $duplexBusy)
  $startEnabled = [bool]($online -and $fresh -and $startShown -and -not $duplexUnavailable -and -not $deviceBlocked)
  $finishShown = [bool]($open -and $duplex -and $duplex.active -and $snap.inputTurnId)
  $handsFreeRow = Get-BunnyHandsFreeRow $snap
  $receipt = Get-BunnyBargeInNote $snap
  $script:bunnyVoiceStart.Visibility = if ($startShown) { 'Visible' } else { 'Collapsed' }
  $script:bunnyVoiceStart.IsEnabled = $startEnabled
  $script:bunnyVoiceFinish.Visibility = if ($finishShown) { 'Visible' } else { 'Collapsed' }
  $script:bunnyVoiceFinish.IsEnabled = $online -and $finishShown
  $script:bunnyVoiceRow.Text = $handsFreeRow
  $script:bunnyVoiceRow.Visibility = if ($handsFreeRow) { 'Visible' } else { 'Collapsed' }
  $script:bunnyVoiceReceipt.Text = $receipt
  $script:bunnyVoiceReceipt.Visibility = if ($receipt) { 'Visible' } else { 'Collapsed' }

  # The collapsed notch has no room for a status line, so the mic glyph carries the state: accent while listening or speaking.
  $voiceInk = if ($label -eq 'Listening' -or $label -eq 'Listening and speaking' -or $label -eq 'Speaking' -or $label -eq 'Paused for you') { 'BunnyAccent' } elseif ($label -like 'Voice needs*' -or $label -like 'Host offline*') { 'BunnyWarning' } else { '' }
  $bunnyControls.VoiceButton.IsEnabled = $online -and -not $handsFreeMode
  $bunnyControls.VoiceButton.ToolTip = 'Voice: ' + $headline
  if ($voiceInk) { $bunnyControls.VoiceButton.SetResourceReference([Windows.Controls.Control]::ForegroundProperty, $voiceInk) } else { $bunnyControls.VoiceButton.ClearValue([Windows.Controls.Control]::ForegroundProperty) }
  # Hands-free has no hold: push-to-talk is disabled in that mode, as in the React panel.
  $bunnyControls.VoiceMic.IsEnabled = $online -and -not $handsFreeMode
  # Interrupt: enabled from a fresh snapshot while Bunny is audible, thinking, or holding a reply (cancels the hold).
  $bunnyControls.VoiceInterrupt.IsEnabled = $online -and $open -and $fresh -and ([bool]$snap.playing -or [bool]$snap.outputHeld -or $state -eq 'PROCESSING')
  $bunnyControls.VoiceMute.IsEnabled = $online -and $open
  $bunnyControls.VoiceMute.Content = if ($snap -and $snap.muted) { 'Unmute' } else { 'Mute' }
  $bunnyControls.VoiceClose.IsEnabled = $online -and $open
  $script:bunnyVoiceUpdating = $true
  try { $bunnyControls.VoiceHandsFree.IsChecked = $handsFreeMode } finally { $script:bunnyVoiceUpdating = $false }
  $bunnyControls.VoiceHandsFree.IsEnabled = $online
  $bunnyControls.VoiceText.IsEnabled = $online
  $bunnyControls.VoiceSend.IsEnabled = $online -and ([string]$bunnyControls.VoiceText.Text).Trim().Length -gt 0
  $bunnyControls.VoiceConfirm.IsEnabled = $online -and [bool]$proposal
  $bunnyControls.VoiceCancelProposal.IsEnabled = $online -and [bool]$proposal

  $layoutKey = '' + $showCompact + '|' + [bool]$proposal + '|' + [bool]$deviceLine + '|' + [bool]$clarify + '|' + [bool]$route + '|' + [bool]$partial + '|' + [bool]$handsFreeRow + '|' + [bool]$receipt + '|' + $startShown + '|' + $finishShown
  if ($layoutKey -ne $script:bunnyVoiceLayoutKey) {
    $script:bunnyVoiceLayoutKey = $layoutKey
    Resize-Bunny
  }
}

function Invoke-BunnyVoiceTick {
  try {
    Invoke-BunnyVoicePump
    $now = Get-BunnyNowMs
    if ($script:bunnyVoiceOpenPolling -and $script:bunnyVoiceQueue.Count -eq 0 -and -not $script:bunnyVoiceFlight -and ($now - [double]$script:bunnyVoiceLastPoll) -ge $bunnyVoicePollMs) {
      $script:bunnyVoiceLastPoll = $now
      Add-BunnyVoiceRequest 'voice.state' @{} $false
    }
    Update-BunnyVoice
  } catch {
    $script:bunnyVoiceError = $_.Exception.Message
  }
}

# ---- global push-to-talk: Ctrl + Alt + Space, MOD_NOREPEAT, released detected by polling ----
function Register-BunnyVoiceHotkey {
  $script:bunnyVoiceShortcutNote = ''
  # Smoke runs never claim the global shortcut, so they neither register it nor report it.
  if ($SmokeTest -and -not $HotkeyTest) { return }
  try {
    if (-not ('Bunny.NativeKeys' -as [type])) { Add-Type -Namespace Bunny -Name NativeKeys -MemberDefinition $bunnyNativeKeysDefinition }
    $hwnd = ([Windows.Interop.WindowInteropHelper]::new($bunnyWindow)).Handle
    $source = [Windows.Interop.HwndSource]::FromHwnd($hwnd)
    $script:bunnyVoiceHook = [Windows.Interop.HwndSourceHook]{
      param($hwnd, $msg, $wParam, $lParam, $handled)
      try {
        if ($msg -eq 0x0312 -and $wParam.ToInt64() -eq $bunnyVoiceHotkeyId) { Start-BunnyHotkeyHold; $handled.Value = $true }
      } catch { $script:bunnyVoiceError = 'Shortcut error: ' + $_.Exception.Message }
      return [IntPtr]::Zero
    }
    $source.AddHook($script:bunnyVoiceHook)
    $script:bunnyVoiceHwnd = $hwnd
    # $bunnyVoiceChord: the product chord (MOD_ALT | MOD_CONTROL | MOD_NOREPEAT, VK_SPACE) or the -HotkeyTest chord.
    $script:bunnyVoiceRegistered = [Bunny.NativeKeys]::RegisterHotKey($hwnd, $bunnyVoiceHotkeyId, [uint32]$bunnyVoiceChord[0], [uint32]$bunnyVoiceChord[1])
    if (-not $script:bunnyVoiceRegistered) { $script:bunnyVoiceShortcutNote = 'Shortcut unavailable (in use)' }
  } catch {
    $script:bunnyVoiceShortcutNote = 'Shortcut unavailable'
  }
}

function Start-BunnyHotkeyHold {
  if ($script:bunnyVoiceHeld) { return }
  # Hands-free has no hold. The shortcut press is the explicit hands-free start instead, and no release is ever sent for it.
  $snap = Get-BunnyVoiceSource
  if ($snap -and $snap.open -and [string]$snap.mode -eq 'hands_free') { Start-BunnyHandsFreeListen; return }
  $script:bunnyVoiceHeld = $true
  $script:bunnyVoiceHeldAt = Get-BunnyNowMs
  Start-BunnyVoiceListen 'hotkey'
  $script:bunnyVoiceHotkeyTimer.Start()
}

function Invoke-BunnyHotkeyPoll {
  if (([Bunny.NativeKeys]::GetAsyncKeyState($bunnyVoiceChord[1]) -band 0x8000) -ne 0) { return }
  $script:bunnyVoiceHotkeyTimer.Stop()
  $script:bunnyVoiceHeld = $false
  # Held at least 350 ms: an explicit end. Shorter taps leave the turn to voice activity detection.
  if ((Get-BunnyNowMs) - [double]$script:bunnyVoiceHeldAt -ge $bunnyVoiceHoldMs) { Stop-BunnyVoiceListen }
}

function Stop-BunnyVoiceHotkey {
  try { if ($script:bunnyVoiceHotkeyTimer) { $script:bunnyVoiceHotkeyTimer.Stop() } } catch { }
  if ($script:bunnyVoiceRegistered) {
    try { [void][Bunny.NativeKeys]::UnregisterHotKey($script:bunnyVoiceHwnd, $bunnyVoiceHotkeyId) } catch { }
    $script:bunnyVoiceRegistered = $false
  }
}

# The explicit user start that creates the Host hands-free grant. Nothing else (mode switch, unmute) opens hands-free capture.
function Start-BunnyHandsFreeListen {
  $snap = Get-BunnyVoiceSource
  if (-not ($snap -and $snap.open -and [string]$snap.mode -eq 'hands_free')) { return }
  # A live or starting duplex lane is never restarted by a second press (the control is hidden then, the shortcut is not).
  if ($snap.duplex -and ($snap.duplex.active -or $snap.duplex.starting -or $snap.duplex.releasing)) { return }
  Add-BunnyVoiceRequest 'voice.listen.start' @{ source = 'hands_free' } $false
}

# Ends the live echo-cancelled input turn by its input id. A no-op unless the duplex input is active.
function Finish-BunnyVoiceTurn {
  $snap = Get-BunnyVoiceSource
  if ($snap -and $snap.open -and $snap.duplex -and $snap.duplex.active -and $snap.inputTurnId) {
    Add-BunnyVoiceRequest 'voice.listen.end' @{ turnId = [string]$snap.inputTurnId } $false
  }
}

# ---- wiring: names come from the Visual XAML (every x:Name is bound into $bunnyControls) ----
$script:bunnyVoiceHotkeyTimer = [Windows.Threading.DispatcherTimer]::new()
$script:bunnyVoiceHotkeyTimer.Interval = [TimeSpan]::FromMilliseconds(40)
$script:bunnyVoiceHotkeyTimer.Add_Tick({ Invoke-BunnyHotkeyPoll })
$script:bunnyVoiceTimer = [Windows.Threading.DispatcherTimer]::new()
$script:bunnyVoiceTimer.Interval = [TimeSpan]::FromMilliseconds(100)
$script:bunnyVoiceTimer.Add_Tick({ Invoke-BunnyVoiceTick })
$script:bunnyVoiceTimer.Start()

Set-BunnyButton $bunnyControls.VoiceButton '' 'mic' 17
foreach ($button in @($bunnyControls.VoiceButton, $bunnyControls.VoiceMic)) {
  $button.Add_PreviewMouseLeftButtonDown({ Start-BunnyVoicePointer })
  $button.Add_PreviewMouseLeftButtonUp({ Stop-BunnyVoicePointer })
  $button.Add_Click({ Invoke-BunnyVoiceClick })
}
# Hands-free controls that the XAML does not carry: the explicit Start hands-free and Finish my turn buttons, the status
# row and the barge-in receipt. Each is named for automation and parented beside its XAML peers, so the layout stays in
# the Visual file's rows.
$script:bunnyVoiceStart = [Windows.Controls.Button]::new()
$script:bunnyVoiceStart.Content = 'Start hands-free'
$script:bunnyVoiceStart.Visibility = 'Collapsed'
$script:bunnyVoiceStart.SetResourceReference([Windows.FrameworkElement]::StyleProperty, 'PrimaryButton')
[Windows.Automation.AutomationProperties]::SetName($script:bunnyVoiceStart, 'Start hands-free listening')
$script:bunnyVoiceFinish = [Windows.Controls.Button]::new()
$script:bunnyVoiceFinish.Content = 'Finish my turn'
$script:bunnyVoiceFinish.Visibility = 'Collapsed'
$script:bunnyVoiceFinish.SetResourceReference([Windows.FrameworkElement]::StyleProperty, 'BunnyButtonBase')
[Windows.Automation.AutomationProperties]::SetName($script:bunnyVoiceFinish, 'Finish my turn')
$script:bunnyVoiceRow = [Windows.Controls.TextBlock]::new()
$script:bunnyVoiceRow.FontSize = 12
$script:bunnyVoiceRow.TextWrapping = 'Wrap'
$script:bunnyVoiceRow.Margin = [Windows.Thickness]::new(0, 0, 0, 6)
$script:bunnyVoiceRow.Visibility = 'Collapsed'
$script:bunnyVoiceRow.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty, 'BunnyMuted')
[Windows.Automation.AutomationProperties]::SetName($script:bunnyVoiceRow, 'Hands-free status')
$script:bunnyVoiceReceipt = [Windows.Controls.TextBlock]::new()
$script:bunnyVoiceReceipt.FontSize = 12
$script:bunnyVoiceReceipt.TextWrapping = 'Wrap'
$script:bunnyVoiceReceipt.Margin = [Windows.Thickness]::new(0, 0, 0, 6)
$script:bunnyVoiceReceipt.Visibility = 'Collapsed'
$script:bunnyVoiceReceipt.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty, 'BunnyMuted')
[Windows.Automation.AutomationProperties]::SetName($script:bunnyVoiceReceipt, 'Last barge-in')
$voiceRow = $bunnyControls.VoiceMute.Parent
$voiceRow.Children.Insert($voiceRow.Children.IndexOf($bunnyControls.VoiceMute), $script:bunnyVoiceStart)
$voiceRow.Children.Insert($voiceRow.Children.IndexOf($bunnyControls.VoiceMute), $script:bunnyVoiceFinish)
$voiceColumn = $bunnyControls.VoiceHint.Parent
$hintIndex = $voiceColumn.Children.IndexOf($bunnyControls.VoiceHint)
$voiceColumn.Children.Insert($hintIndex + 1, $script:bunnyVoiceRow)
$voiceColumn.Children.Insert($hintIndex + 2, $script:bunnyVoiceReceipt)
$script:bunnyVoiceStart.Add_Click({ Start-BunnyHandsFreeListen })
$script:bunnyVoiceFinish.Add_Click({ Finish-BunnyVoiceTurn })
$bunnyControls.VoiceInterrupt.Add_Click({ Request-BunnyVoiceInterrupt 'button' })
$bunnyControls.VoiceMute.Add_Click({
  $snap = Get-BunnyVoiceSource
  if ($snap -and $snap.open) { Add-BunnyVoiceRequest 'voice.mute' @{ on = (-not [bool]$snap.muted) } $true }
})
$bunnyControls.VoiceClose.Add_Click({ $script:bunnyVoiceListening = $false; $script:bunnyVoiceTapLatched = $false; Add-BunnyVoiceRequest 'voice.session.close' @{ source = 'island_button' } $true })
$bunnyControls.VoiceHandsFree.Add_Click({ Set-BunnyHandsFree ([bool]$bunnyControls.VoiceHandsFree.IsChecked) })
$bunnyControls.VoiceConfirm.Add_Click({
  $snap = Get-BunnyVoiceSource
  if ($snap -and $snap.proposal) { Add-BunnyVoiceRequest 'voice.control.confirm' @{ proposalId = [string]$snap.proposal.id } $false }
})
$bunnyControls.VoiceCancelProposal.Add_Click({ Add-BunnyVoiceRequest 'voice.control.cancel' @{} $true })
$bunnyControls.VoiceSend.Add_Click({
  $text = ([string]$bunnyControls.VoiceText.Text).Trim()
  if (-not $text) { return }
  $snap = Get-BunnyVoiceSource
  if (-not ($snap -and $snap.open) -and -not (Test-BunnyVoiceQueued 'voice.session.open')) { Add-BunnyVoiceRequest 'voice.session.open' @{ mode = 'push_to_talk' } $false }
  Add-BunnyVoiceRequest 'voice.text' @{ text = $text } $false
  $bunnyControls.VoiceText.Text = ''
})
$bunnyControls.VoiceText.Add_TextChanged({ Update-BunnyVoice })

$bunnyWindow.Add_SourceInitialized({ Register-BunnyVoiceHotkey })
# Closing releases the microphone (voice.session.close, bounded wait) and the global hotkey. It never calls agent.* or
# mission.* actions: Host-owned work keeps running after the Island closes.
$bunnyWindow.Add_Closing({
  Stop-BunnyVoiceHotkey
  if ($script:bunnyVoiceOpenPolling -or $script:bunnyVoiceOpenSent) {
    try { Invoke-BunnyVoiceCloseNow } catch { }
  }
})
$bunnyWindow.Add_Closed({
  try { $script:bunnyVoiceTimer.Stop() } catch { }
  try { if ($script:bunnyVoiceHttp) { $script:bunnyVoiceHttp.Dispose() } } catch { }
})
# The first render happens from Update-Bunny (Loaded), after every dot-sourced layer defined its helpers.
