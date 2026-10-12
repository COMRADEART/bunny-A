# M-A-3 T13: Bunny, the companion in the Notch. The art follows the companion state (Host voice.companion when sent, otherwise
# the mirror in Characters.ps1); the client overlays DISCONNECTED (Host offline or a stale voice poll) and HAPPY (a bound
# slot was OBSERVED moving into VERIFIED). Motion starts only on a state change and stops when motion is off or reduced.
# The level ring is scaled by the REAL input level (snapshot.level.rms, only while level.at is fresh), not by a timer.
$script:bunnyCompanionKey = ''
$script:bunnyHappyUntil = 0.0
$script:bunnyCompanionTransform = $null

# Called once after the Visual XAML is loaded. The transforms are created here, never per poll.
function Initialize-BunnyCompanion {
  $art = $bunnyControls.BunnyArt
  $transform = [Windows.Media.TransformGroup]::new()
  $scale = [Windows.Media.ScaleTransform]::new(); $move = [Windows.Media.TranslateTransform]::new()
  [void]$transform.Children.Add($scale); [void]$transform.Children.Add($move)
  $art.RenderTransformOrigin = [Windows.Point]::new(.5, .5)
  $art.RenderTransform = $transform
  $script:bunnyCompanionTransform = @{ Scale = $scale; Move = $move }
}

function Stop-BunnyCompanionMotion {
  $t = $script:bunnyCompanionTransform
  if (-not $t) { return }
  $t.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, $null)
  $t.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleXProperty, $null)
  $t.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleYProperty, $null)
  $bunnyControls.CompanionRing.BeginAnimation([Windows.UIElement]::OpacityProperty, $null)
  $bunnyControls.CompanionRing.Opacity = 0
}

# Board-derived motion per companion state (spec section 9). Looping states run forever; one-shots run once.
function Start-BunnyCompanionMotion([string]$State) {
  Stop-BunnyCompanionMotion
  if (-not $bunnyAnimate -or -not $script:bunnyCompanionTransform) { return }
  $t = $script:bunnyCompanionTransform
  switch ($State) {
    'SLEEPING' { $grow = New-BunnyWeaponAnimation 1 1.02 5000 $true $true 'standard'; $t.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleXProperty, $grow); $t.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleYProperty, $grow.Clone()) }
    'READY' { $t.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, (New-BunnyWeaponAnimation 0 -1.5 4000 $true $true 'standard')) }
    'SPEAKING' { $t.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, (New-BunnyWeaponAnimation 0 -1.5 1200 $true $true 'standard')) }
    'LISTENING_WHILE_SPEAKING' { $t.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, (New-BunnyWeaponAnimation 0 -1.5 1200 $true $true 'standard')) }
    'INTERRUPTED' { $recoil = New-BunnyWeaponAnimation 0.96 1 200 $false $false 'standard'; $recoil.FillBehavior = 'Stop'; $t.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleXProperty, $recoil); $t.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleYProperty, $recoil.Clone()) }
    'HAPPY' { $hop = New-BunnyWeaponAnimation 0 -6 600 $false $true 'standard'; $hop.FillBehavior = 'Stop'; $t.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, $hop) }
    'PERMISSION' { $pulse = New-BunnyWeaponAnimation 0.3 1 2400 $true $true 'standard'; $bunnyControls.CompanionRing.BeginAnimation([Windows.UIElement]::OpacityProperty, $pulse) }
    'ERROR' { $pulse = New-BunnyWeaponAnimation 0.3 1 2400 $true $true 'standard'; $bunnyControls.CompanionRing.BeginAnimation([Windows.UIElement]::OpacityProperty, $pulse) }
  }
}

function Update-BunnyCompanion {
  if (-not $bunnyControls.BunnyArt) { return }
  $now = [double](Get-BunnyNowMs)
  $snap = Get-BunnyVoiceSource
  $fresh = ($now - [double]$script:bunnyVoiceOkAt) -lt $bunnyVoiceFreshMs
  $display = Get-BunnyCompanionDisplay $snap $now ([bool]$bunnyOnline) ([bool]$fresh) ([double]$script:bunnyHappyUntil)
  $state = [string]$display.State
  $art = Get-BunnyCompanionArt $state
  $source = Get-BunnyCharacterSource $art.Id 96
  if ($source -and $bunnyControls.BunnyArt.Source -ne $source) { $bunnyControls.BunnyArt.Source = $source }
  $ring = switch ($art.Overlay) {
    'ring-amber' { 'BunnyWarning' }
    'ring-held' { 'BunnyAccent' }
    default { 'BunnyAccent' }
  }
  $bunnyControls.CompanionRing.SetResourceReference([Windows.Controls.Border]::BorderBrushProperty, $ring)
  $bunnyControls.CompanionTint.Opacity = if ($art.Overlay -eq 'grey-unplug') { 0.55 } else { 0 }
  $bunnyControls.BunnyArt.Opacity = if ($state -eq 'DISCONNECTED') { 0.6 } else { 1 }
  $badge = switch ($art.Overlay) { 'badge-mute' { [string][char]0x00D7 } 'grey-unplug' { '-' } default { '' } }
  $bunnyControls.CompanionBadgeText.Text = $badge
  $bunnyControls.CompanionBadge.Visibility = if ($badge) { 'Visible' } else { 'Collapsed' }
  $label = $state.Replace('_', ' ').ToLower()
  $name = 'Ask Bunny, ' + $label + $(if ([string]$display.Reason) { '. ' + [string]$display.Reason } else { '' })
  [Windows.Automation.AutomationProperties]::SetName($bunnyControls.BunnyButton, $name)
  $bunnyControls.BunnyButton.ToolTip = $name
  $key = $state + '|' + [string]$bunnyAnimate
  if ($key -ne $script:bunnyCompanionKey) { $script:bunnyCompanionKey = $key; Start-BunnyCompanionMotion $state }
  # Level ring: real input level only, and only while the level sample is fresh. Anything else keeps the ring at rest.
  $level = if ($snap -and $snap.level) { $snap.level } else { $null }
  $levelAge = if ($level) { $now - [double]$level.at } else { [double]::NaN }
  $levelFresh = [bool]($bunnyAnimate -and $level -and $levelAge -ge 0 -and $levelAge -le 1000 -and $state -in @('ARMING', 'LISTENING', 'LISTENING_WHILE_SPEAKING'))
  $rms = if ($levelFresh) { [Math]::Min(1.0, [Math]::Max(0.0, [double]$level.rms)) } else { 0.0 }
  $scale = 1 + 0.22 * $rms
  $bunnyControls.RingScale.ScaleX = $scale; $bunnyControls.RingScale.ScaleY = $scale
  # Static ring opacity. The amber pulse is an animation (Start-BunnyCompanionMotion) and is left alone while it runs.
  if (-not ($bunnyAnimate -and $art.Overlay -eq 'ring-amber')) {
    $bunnyControls.CompanionRing.Opacity = switch ($art.Overlay) {
      'ring-live' { if ($levelFresh) { 0.45 + 0.55 * $rms } else { 0.6 } }
      'ring-held' { 0.7 }
      'ring-amber' { 0.9 }
      default { 0 }
    }
  }
}
