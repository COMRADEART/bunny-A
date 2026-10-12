# M-A-3 T13: Bunny companion and Personal Agent character art. The mapping tables and derivations below are pure (no WPF
# objects at load or in the derivations), so scripts/island-notch.test.mjs runs them in one powershell.exe batch. Only
# Get-BunnyCharacterSource touches WPF, and only the UI layer calls it.
# Source of truth: the board in assets/t13 (derive_assets.py). Runtime PNGs: characters\<id>.png in a release, or
# public\bunny-a\characters\<id>.png in a development checkout (the Island runs from install\ there).
$script:bunnyCharacterRoot = if (Test-Path -LiteralPath (Join-Path $PSScriptRoot 'characters')) { Join-Path $PSScriptRoot 'characters' } else { Join-Path (Split-Path -Parent $PSScriptRoot) 'public\bunny-a\characters' }
$script:bunnyCharacterCache = @{}
# A voice snapshot older than this (on an open session) means the poll is stale: the companion shows DISCONNECTED.
$script:bunnyCompanionStaleMs = 1000
$script:bunnyHappyMs = 6000

# Companion expression -> board art and overlay. Overlays are drawn as static rings, badges or a dim tint; none loops
# except through the Island's own animation rules (Presentation.ps1).
$script:BunnyCompanionArt = @{
  SLEEPING                 = @{ Id = 'bunny.sleeping';    Overlay = 'none' }
  READY                    = @{ Id = 'bunny.idle';        Overlay = 'none' }
  ARMING                   = @{ Id = 'bunny.listening';   Overlay = 'ring-live' }
  LISTENING                = @{ Id = 'bunny.listening';   Overlay = 'ring-live' }
  LISTENING_WHILE_SPEAKING = @{ Id = 'bunny.speaking';    Overlay = 'ring-live' }
  SPEAKING                 = @{ Id = 'bunny.speaking';    Overlay = 'none' }
  HELD                     = @{ Id = 'bunny.listening';   Overlay = 'ring-held' }
  TRANSCRIBING             = @{ Id = 'bunny.processing';  Overlay = 'none' }
  WAITING_FOR_RESPONSE     = @{ Id = 'bunny.processing';  Overlay = 'none' }
  THINKING                 = @{ Id = 'bunny.thinking';    Overlay = 'none' }
  INTERRUPTED              = @{ Id = 'bunny.interrupted'; Overlay = 'none' }
  PERMISSION               = @{ Id = 'bunny.listening';   Overlay = 'ring-amber' }
  MUTED                    = @{ Id = 'bunny.idle';        Overlay = 'badge-mute' }
  ERROR                    = @{ Id = 'bunny.interrupted'; Overlay = 'ring-amber' }
  DISCONNECTED             = @{ Id = 'bunny.sleeping';    Overlay = 'grey-unplug' }
  HAPPY                    = @{ Id = 'bunny.happy';       Overlay = 'none' }
  UNKNOWN                  = @{ Id = 'bunny.idle';        Overlay = 'none' }
}

# Weapon identity: the compact art for the strip, the hero for detail views, and the base loop. The loop period and the
# easing come from the T13 motion spec (section 6). Chakra rotates continuously; the others float or hover.
$script:BunnyWeaponBase = @{
  gada   = @{ Compact = 'gada.compact';   Hero = 'gada.hero';   Loop = 'float-tilt';  PeriodMs = 4200;  Ease = 'weighty' }
  spear  = @{ Compact = 'spear.compact';  Hero = 'spear.hero';  Loop = 'float-glint'; PeriodMs = 3000;  Ease = 'precise' }
  chakra = @{ Compact = 'chakra.compact'; Hero = 'chakra.hero'; Loop = 'spin';        PeriodMs = 12000; Ease = 'orbital' }
  sword  = @{ Compact = 'sword.compact';  Hero = 'sword.hero';  Loop = 'hover-sheen'; PeriodMs = 3600;  Ease = 'precise' }
}

function Get-BunnyCompanionArt([string]$State) {
  if ($script:BunnyCompanionArt.ContainsKey($State)) { return $script:BunnyCompanionArt[$State] }
  return $script:BunnyCompanionArt['READY']
}

# The companion's expression from the voice snapshot. Mirrors companionState() in
# src/lib/bunny-host/voice/voice-companion.ts: same precedence, same thresholds. Used only when the Host does not send
# voice.companion. Pure: the snapshot and the clock in, {State, Reason} out.
function Get-BunnyCompanionState($Snap, [double]$Now) {
  if (-not $Snap -or -not $Snap.open) { return @{ State = 'SLEEPING'; Reason = 'Voice session closed.' } }
  $code = if ($Snap.error) { [string]$Snap.error.code } else { '' }
  if ($code -in @('WORKER_EXITED', 'WORKER_INTEGRITY', 'NOT_WINDOWS', 'DEVICE_LOST', 'DEVICE_UNAVAILABLE')) { return @{ State = 'DISCONNECTED'; Reason = $code } }
  if ([string]$Snap.state -eq 'DEVICE_UNAVAILABLE') { return @{ State = 'DISCONNECTED'; Reason = 'DEVICE_UNAVAILABLE' } }
  if ([string]$Snap.state -eq 'ERROR' -or $Snap.error) { return @{ State = 'ERROR'; Reason = $(if ($code) { $code } else { 'ERROR' }) } }
  $proposalLive = [bool]($Snap.proposal -and [double]$Snap.proposal.expiresAt -gt $Now)
  $clarificationLive = [bool]($Snap.clarification -and [double]$Snap.clarification.expiresAt -gt $Now)
  $micDenied = [bool]($Snap.devices -and [string]$Snap.devices.micPrivacy -eq 'deny')
  if ($proposalLive -or $clarificationLive -or $micDenied) {
    return @{ State = 'PERMISSION'; Reason = $(if ($proposalLive) { 'proposal' } elseif ($clarificationLive) { 'clarification' } else { 'microphone privacy' }) }
  }
  if ($Snap.muted -or [string]$Snap.state -eq 'MUTED' -or ($Snap.devices -and $Snap.devices.input -and $Snap.devices.input.muted)) { return @{ State = 'MUTED'; Reason = 'Microphone muted.' } }
  if ($Snap.capturing -and $Snap.playing) { return @{ State = 'LISTENING_WHILE_SPEAKING'; Reason = 'Capture and playback both confirmed by the worker.' } }
  if ($Snap.playing) { return @{ State = 'SPEAKING'; Reason = 'Playback confirmed by the worker.' } }
  if ($Snap.outputHeld) { return @{ State = 'HELD'; Reason = 'Reply paused while you speak.' } }
  if ([string]$Snap.state -eq 'INTERRUPTED') { return @{ State = 'INTERRUPTED'; Reason = 'Playback cancelled.' } }
  $bargeAt = if ($Snap.lastBargeIn -and [string]$Snap.lastBargeIn.outcome -eq 'interrupted' -and $Snap.lastBargeIn.decidedAt) { [double]$Snap.lastBargeIn.decidedAt } else { 0.0 }
  $interruptAt = if ($Snap.lastInterrupt -and $Snap.lastInterrupt.requestedAt) { [double]$Snap.lastInterrupt.requestedAt } else { 0.0 }
  $recent = @($bargeAt, $interruptAt | Where-Object { $_ -gt 0 -and ($Now - $_) -ge 0 -and ($Now - $_) -le 2500 }).Count -gt 0
  if ($recent -and [string]$Snap.state -notin @('PROCESSING', 'SPEAKING')) { return @{ State = 'INTERRUPTED'; Reason = 'Recent interruption receipt.' } }
  if ([string]$Snap.state -eq 'TRANSCRIBING') { return @{ State = 'TRANSCRIBING'; Reason = 'Finishing your words.' } }
  if ([string]$Snap.state -eq 'PROCESSING') {
    if ($Snap.timing -and $null -ne $Snap.timing.admittedAt -and $null -eq $Snap.timing.firstTokenAt) { return @{ State = 'WAITING_FOR_RESPONSE'; Reason = 'Answer admitted; no text yet.' } }
    return @{ State = 'THINKING'; Reason = 'Answer being produced.' }
  }
  if ([string]$Snap.state -eq 'ARMING' -or ($Snap.duplex -and $Snap.duplex.starting)) { return @{ State = 'ARMING'; Reason = 'Opening microphone.' } }
  $speakingNow = [bool]($Snap.level -and $Snap.level.speech -and ($Now - [double]$Snap.level.at) -ge 0 -and ($Now - [double]$Snap.level.at) -le 1000)
  $duplexActive = [bool]($Snap.duplex -and $Snap.duplex.active)
  if ([string]$Snap.state -eq 'LISTENING' -or ($Snap.capturing -and ($speakingNow -or -not $duplexActive))) {
    return @{ State = 'LISTENING'; Reason = $(if ($speakingNow) { 'You are speaking.' } else { 'Microphone open for this turn.' }) }
  }
  if ($Snap.capturing -and $duplexActive) { return @{ State = 'LISTENING'; Reason = 'Hands-free microphone open.' } }
  return @{ State = 'READY'; Reason = 'Session open and idle.' }
}

# What the companion shows right now. Host offline or stale voice wins (DISCONNECTED); otherwise the Host expression or
# mirror applies. A just-verified Agent may overlay only READY/SLEEPING with HAPPY (six seconds).
function Get-BunnyCompanionDisplay($Snap, [double]$Now, [bool]$HostOnline, [bool]$VoiceFresh, [double]$HappyUntil) {
  if (-not $HostOnline) { return @{ State = 'DISCONNECTED'; Reason = 'Host offline' } }
  if (-not $VoiceFresh -and $Snap -and $Snap.open) { return @{ State = 'DISCONNECTED'; Reason = 'Voice status is stale' } }
  if (-not $Snap) { return @{ State = 'UNKNOWN'; Reason = 'Voice status has not been received.' } }
  $view = if ($VoiceFresh -and $Snap.companion -and $Snap.companion.state -and [string]$Snap.companion.state -notin @('HAPPY', 'UNKNOWN') -and $script:BunnyCompanionArt.ContainsKey([string]$Snap.companion.state)) {
    @{ State = [string]$Snap.companion.state; Reason = [string]$Snap.companion.reason }
  } else { Get-BunnyCompanionState $Snap $Now }
  # A verification is a client overlay of an idle expression; it never hides capture, playback or attention.
  if ($HappyUntil -gt $Now -and [string]$view.State -in @('READY', 'SLEEPING')) { return @{ State = 'HAPPY'; Reason = 'A Personal Agent finished and was verified.' } }
  return $view
}

# Weapon presentation -> motion. Only the Host's presentation states are accepted; anything else is static.
# Loop: base (the weapon's own loop), static, or none. Task: the effect layer for a task state (a ring breathe, see the
# report: the per-weapon choreography is not drawn). Speed scales the base loop. OneShot fires only on an OBSERVED
# transition (Get-BunnyVerifiedTransitions), never on first load.
function Get-BunnyWeaponMotion([string]$State) {
  $task = @{ PLANNING = 'planning'; RESEARCHING = 'researching'; CODING = 'coding'; TESTING = 'testing'; FILE_WORK = 'filework'; VERIFYING = 'verifying'; ACTIVE = 'active' }
  $motion = @{ State = $State; Loop = 'static'; Task = 'none'; Speed = 1.0; Ring = 'none'; Badge = 'none'; Desaturate = $false; Opacity = 1.0; OneShot = 'none' }
  if ($task.ContainsKey($State)) { $motion.Loop = 'base'; $motion.Task = $task[$State] }
  switch ($State) {
    'IDLE' { $motion.Loop = 'base' }
    'WAITING' { $motion.Loop = 'base'; $motion.Speed = 0.6; $motion.Opacity = 0.8 }
    'WAITING_FOR_USER' { $motion.Ring = 'amber-pulse'; $motion.Badge = 'alert-amber' }
    'PAUSED' { $motion.Desaturate = $true; $motion.Badge = 'pause' }
    'COMPLETED' { $motion.OneShot = 'completed'; $motion.Badge = 'check-neutral' }
    'VERIFIED' { $motion.Ring = 'green'; $motion.Badge = 'check-green'; $motion.OneShot = 'verified' }
    'FAILED' { $motion.Desaturate = $true; $motion.Ring = 'red'; $motion.Badge = 'alert-red'; $motion.OneShot = 'failed' }
    'STOPPED' { $motion.Desaturate = $true }
    'RECOVERING' { $motion.Loop = 'dashed'; $motion.Opacity = 0.6 }
    'OFFLINE' { $motion.Desaturate = $true; $motion.Opacity = 0.45 }
  }
  if ($task.ContainsKey($State)) { $motion.Ring = 'task-breathe' }
  return $motion
}

# The Notch strip shows only bound slots: a slot with an Agent id and the active flag. Unassigned slots draw nothing,
# and internal team members are never slots, so they only ever appear in the neutral unslotted count. Slot order is kept.
function Get-BunnyPersonalAgentStrip($Snapshot) {
  if (-not $Snapshot) { return @{ Slots = @(); Unslotted = 0 } }
  $bound = @($Snapshot.slots | Where-Object { $_ -and $_.active -and $null -ne $_.agentId -and [string]$_.agentId -ne '' } | Sort-Object { [int]$_.slot })
  $unslotted = [Math]::Max(0, [int]$Snapshot.unslottedAgents)
  return @{ Slots = @($bound | Select-Object -First 4); Unslotted = $unslotted }
}

# Terminal cues require two live observations of the same bound Agent. First load, reconnect and rebinding never
# celebrate a historical result; a downgrade from VERIFIED to unverified completion never celebrates either.
function Get-BunnyObservedTransitions($Previous, $Snapshot, [bool]$Online = $true) {
  if (-not $Online -or $null -eq $Previous -or -not $Snapshot) { return @() }
  # The memory is a dictionary from the Island; a parsed object (for example from JSON) is accepted the same way.
  $memory = @{}
  if ($Previous -is [System.Collections.IDictionary]) { foreach ($key in $Previous.Keys) { $memory[[string]$key] = $Previous[$key] } }
  else { foreach ($property in $Previous.PSObject.Properties) { $memory[[string]$property.Name] = $property.Value } }
  $result = @()
  foreach ($slot in @($Snapshot.slots | Where-Object { $_ })) {
    $key = [string]$slot.slot
    if (-not $memory.ContainsKey($key)) { continue }
    $before = $memory[$key]
    $state = [string]$slot.presentation.state
    $agentId = [string]$slot.agentId
    if (-not $agentId -or $agentId -ne [string]$before.AgentId -or [string]$before.State -eq $state -or [string]$before.State -eq 'OFFLINE') { continue }
    $cue = switch ($state) { 'VERIFIED' { 'verified' } 'FAILED' { 'failed' } 'COMPLETED' { if ([string]$before.State -ne 'VERIFIED') { 'completed' } } }
    if ($cue) { $result += @{ Slot = [int]$slot.slot; Kind = $cue } }
  }
  return $result
}

function Get-BunnyVerifiedTransitions($Previous, $Snapshot, [bool]$Online = $true) {
  return @(Get-BunnyObservedTransitions $Previous $Snapshot $Online | Where-Object { $_.Kind -eq 'verified' } | ForEach-Object { $_.Slot })
}

# Width of a PNG from its IHDR chunk (bytes 16-19, big-endian). Zero for anything that is not a PNG.
function Get-BunnyPngWidth([string]$Path) {
  $stream = [IO.File]::OpenRead($Path)
  try {
    $header = New-Object byte[] 24
    if ($stream.Read($header, 0, 24) -lt 24) { return 0 }
  } finally { $stream.Dispose() }
  if ($header[0] -ne 0x89 -or $header[1] -ne 0x50) { return 0 }
  return [int](($header[16] -shl 24) -bor ($header[17] -shl 16) -bor ($header[18] -shl 8) -bor $header[19])
}

# Character bitmap for the UI layer. Frozen, OnLoad, decoded no larger than the on-screen need (never upscaled), and cached
# per id and width so a 2-second poll never reloads a file. Returns $null when the art is missing (the UI then draws nothing
# for it rather than a letter or a generic circle).
function Get-BunnyCharacterSource([string]$Id, [int]$Width) {
  $key = $Id + '@' + $Width
  if ($script:bunnyCharacterCache.ContainsKey($key)) { return $script:bunnyCharacterCache[$key] }
  if ($Id -notmatch '^[a-z]+\.[a-z0-9]+$') { return $null }
  $path = Join-Path $script:bunnyCharacterRoot ($Id + '.png')
  if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { return $null }
  $bitmap = [Windows.Media.Imaging.BitmapImage]::new()
  $bitmap.BeginInit()
  $bitmap.CacheOption = [Windows.Media.Imaging.BitmapCacheOption]::OnLoad
  $bitmap.UriSource = [Uri]::new($path)
  if ((Get-BunnyPngWidth $path) -gt $Width) { $bitmap.DecodePixelWidth = $Width }
  $bitmap.EndInit()
  $bitmap.Freeze()
  $script:bunnyCharacterCache[$key] = $bitmap
  return $bitmap
}

$script:BunnyWeaponLabel = @{ gada = 'Gada'; spear = 'Spear'; chakra = 'Vishnu Chakra'; sword = 'Sword' }
