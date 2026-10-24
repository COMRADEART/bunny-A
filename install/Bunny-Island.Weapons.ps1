# M-A-3 T13: the Personal Agent strip and the weapon detail card. Each bound slot is one weapon character on a PERSISTENT
# element keyed by slot: the element is created once, and a poll only updates its art, ring, badge and tooltip. A loop
# starts only when its motion key changes (a real state change), never on every 2 s poll. One-shots fire only on an
# observed transition to VERIFIED, FAILED or COMPLETED. Motion stops when the strip is hidden, the Island is reduced or
# off, the system disables animation, or high contrast is on (Set-BunnyMotionMode clears $bunnyAnimate).
# Internal team members and providers are never drawn: the strip shows the bound slots and a neutral count of the rest.
$script:bunnyWeaponChips = @{}
$script:bunnyWeaponPrevious = $null
$script:bunnyWeaponDetailSlot = $null
$script:bunnyWeaponStopConfirm = $null
# One weapon chip: 44 DIP wide and 46 DIP tall, so the target meets 44 DIP (the compact art is 30 x 62 native). The step adds the margins.
$script:bunnyWeaponCellWidth = 44
$script:bunnyWeaponCellHeight = 46
$script:bunnyWeaponCellStep = 48
$script:bunnyWeaponTaskMs = @{ planning = 2400; researching = 1800; coding = 1400; testing = 1000; filework = 2000; verifying = 2400; active = 3200 }

function Get-BunnyStripCellCount {
  $view = Get-BunnyPersonalAgentStrip $bunnySnapshot.personalAgents
  $tasks = Get-BunnyTaskStrip $bunnySnapshot.persistentTasks ([bool]$bunnyOnline) $bunnySnapshot.proactive
  return (@($view.Slots).Count + $(if ($view.Unslotted -gt 0) { 1 } else { 0 }) + $(if ($tasks.Count -gt 0) { 1 } else { 0 }))
}

# MA4-S2-T1: one neutral cell for persistent tasks in the same strip as the weapons, so it follows the strip's placement
# (left of a horizontal notch, above a side notch). Its dot and number are the Host's current task facts; it never
# animates. The element is created once and only updated on each poll. A click opens the task details in the dashboard.
$script:bunnyTaskChip = $null
function Get-BunnyTaskChip($Tasks) {
  if (-not $script:bunnyTaskChip) {
    $chip = New-BunnyCharacterButton 12
    $chip.Width = $script:bunnyWeaponCellWidth; $chip.Height = $script:bunnyWeaponCellHeight; $chip.Margin = [Windows.Thickness]::new(2); $chip.Cursor = [Windows.Input.Cursors]::Hand
    $stack = [Windows.Controls.StackPanel]::new(); $stack.HorizontalAlignment = 'Center'; $stack.VerticalAlignment = 'Center'
    $dot = [Windows.Shapes.Ellipse]::new(); $dot.Width = 8; $dot.Height = 8; $dot.HorizontalAlignment = 'Center'; $dot.Margin = [Windows.Thickness]::new(0, 0, 0, 3)
    $number = [Windows.Controls.TextBlock]::new(); $number.FontSize = 10; $number.FontWeight = 'SemiBold'; $number.HorizontalAlignment = 'Center'
    $number.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty, 'BunnyText')
    [void]$stack.Children.Add($dot); [void]$stack.Children.Add($number); $chip.Content = $stack
    $chip.Tag = @{ Dot = $dot; Number = $number }
    $chip.Add_Click({ Open-BunnyApplication '' })
    $script:bunnyTaskChip = $chip
  }
  $chip = $script:bunnyTaskChip
  $chip.Tag.Dot.SetResourceReference([Windows.Shapes.Shape]::FillProperty, $Tasks.Tone)
  $chip.Tag.Number.Text = [string]$Tasks.Count
  $chip.ToolTip = $Tasks.ToolTip
  [Windows.Automation.AutomationProperties]::SetName($chip, ('Persistent tasks: ' + $Tasks.Headline))
  return $chip
}

# Horizontal notch: the strip is ONE row beside the body (spec section 10), so its extent is every cell in that row, plus the
# capsule padding and border, less the small overlap that joins it to the body. Vertical notch: the strip is above, not beside.
function Get-BunnyStripExtent {
  if (-not $bunnyControls.AgentStrip -or $bunnyControls.AgentStrip.Visibility -ne 'Visible') { return 0 }
  $cells = Get-BunnyStripCellCount
  if ($cells -le 0) { return 0 }
  return ($cells * $script:bunnyWeaponCellStep + 14 - 12)
}

function Get-BunnyWeaponLabel([string]$Weapon) {
  if ($script:BunnyWeaponLabel.ContainsKey($Weapon)) { return $script:BunnyWeaponLabel[$Weapon] }
  return $Weapon
}

# A real Button supplies the standard WPF automation peer and Tab/Enter/Space behavior. A focusable Border alone is
# invisible to UI Automation as an actionable control. The transparent template preserves the character-only capsule.
function New-BunnyCharacterButton([int]$Radius = 12) {
  $button = [Windows.Controls.Button]::new()
  $button.Focusable = $true; $button.IsTabStop = $true; $button.Padding = [Windows.Thickness]::new(0)
  $button.HorizontalContentAlignment = 'Stretch'; $button.VerticalContentAlignment = 'Stretch'
  $button.Background = [Windows.Media.Brushes]::Transparent; $button.BorderThickness = [Windows.Thickness]::new(0)
  $button.Template = [Windows.Markup.XamlReader]::Parse(('<ControlTemplate xmlns="http://schemas.microsoft.com/winfx/2006/xaml/presentation" TargetType="Button"><Border CornerRadius="{0}" Background="{{TemplateBinding Background}}" BorderBrush="{{TemplateBinding BorderBrush}}" BorderThickness="{{TemplateBinding BorderThickness}}" Padding="{{TemplateBinding Padding}}"><ContentPresenter HorizontalAlignment="{{TemplateBinding HorizontalContentAlignment}}" VerticalAlignment="{{TemplateBinding VerticalContentAlignment}}"/></Border></ControlTemplate>' -f $Radius))
  return $button
}

# Basis text for the detail card: the Host's own words for where a state came from. Never a percentage.
function Get-BunnyPresentationBasisText($Basis) {
  if (-not $Basis) { return 'No basis reported.' }
  switch ([string]$Basis.kind) {
    'provider-event' { return 'Provider reported: ' + ([string]$Basis.event -replace '^agent\.', '') }
    'capability' { return 'Host step: ' + [string]$Basis.action }
    'command' { return 'Host command: ' + ([string]$Basis.classified -replace '^agent\.', '') }
    'team-step' { return 'Team step: ' + [string]$Basis.role }
    'mission-result' { return 'Mission result: ' + [string]$Basis.verifiedSteps + ' verified, ' + [string]$Basis.unverifiedSteps + ' unverified' }
    'agent-state' { return 'Agent state: ' + ([string]$Basis.agentState).Replace('_', ' ').ToLower() }
    'step-state' { return 'Mission step: ' + ([string]$Basis.stepState).Replace('_', ' ').ToLower() }
    'no-category' { return 'No activity category reported.' }
    'agent-missing' { return 'The bound Agent was not found.' }
    'unassigned' { return 'Not assigned to an Agent.' }
    default { return 'Basis not reported.' }
  }
}

function New-BunnyWeaponChip([int]$SlotId) {
  $chip = New-BunnyCharacterButton 12
  $chip.Width = $script:bunnyWeaponCellWidth; $chip.Height = $script:bunnyWeaponCellHeight
  $chip.Margin = [Windows.Thickness]::new(2); $chip.BorderThickness = [Windows.Thickness]::new(0)
  # Board dock-top: the characters float inside ONE black-glass capsule, so a resting chip has no frame and no well of its
  # own. The focus ring (below) is the only border a chip ever draws, and only while it has keyboard focus.
  $chip.Background = [Windows.Media.Brushes]::Transparent
  $chip.SetResourceReference([Windows.Controls.Control]::BorderBrushProperty, 'BunnyAccent')
  $chip.RenderTransformOrigin = [Windows.Point]::new(.5, .5); $chip.Cursor = [Windows.Input.Cursors]::Hand; $chip.Focusable = $true
  $transform = [Windows.Media.TransformGroup]::new(); $scale = [Windows.Media.ScaleTransform]::new(); $rotate = [Windows.Media.RotateTransform]::new(); $move = [Windows.Media.TranslateTransform]::new()
  foreach ($item in @($scale, $rotate, $move)) { [void]$transform.Children.Add($item) }
  $chip.RenderTransform = $transform
  $grid = [Windows.Controls.Grid]::new()
  $image = [Windows.Controls.Image]::new(); $image.Stretch = 'Uniform'; $image.Margin = [Windows.Thickness]::new(1, 2, 1, 2)
  [Windows.Media.RenderOptions]::SetBitmapScalingMode($image, [Windows.Media.BitmapScalingMode]::HighQuality)
  $halo = [Windows.Controls.Border]::new(); $halo.CornerRadius = [Windows.CornerRadius]::new(12); $halo.BorderThickness = [Windows.Thickness]::new(1.5); $halo.Opacity = 0; $halo.IsHitTestVisible = $false
  $badge = [Windows.Controls.TextBlock]::new(); $badge.FontSize = 9; $badge.FontWeight = 'Bold'; $badge.HorizontalAlignment = 'Right'; $badge.VerticalAlignment = 'Bottom'; $badge.Margin = [Windows.Thickness]::new(0, 0, 2, 0); $badge.IsHitTestVisible = $false
  # T13.3 Gate H: a solid outline for high contrast, the active-speaker bar and the still-working dot. Hidden until the Host says so.
  $outline = [Windows.Controls.Border]::new(); $outline.CornerRadius = [Windows.CornerRadius]::new(12); $outline.BorderThickness = [Windows.Thickness]::new(2); $outline.Visibility = 'Collapsed'; $outline.IsHitTestVisible = $false
  $outline.SetResourceReference([Windows.Controls.Border]::BorderBrushProperty, 'BunnyText')
  $speaker = [Windows.Shapes.Rectangle]::new(); $speaker.Height = 3; $speaker.RadiusX = 1.5; $speaker.RadiusY = 1.5; $speaker.VerticalAlignment = 'Bottom'; $speaker.Margin = [Windows.Thickness]::new(10, 0, 10, -1); $speaker.Visibility = 'Collapsed'; $speaker.IsHitTestVisible = $false
  $speaker.SetResourceReference([Windows.Shapes.Shape]::FillProperty, 'BunnyText')
  $working = [Windows.Shapes.Ellipse]::new(); $working.Width = 6; $working.Height = 6; $working.HorizontalAlignment = 'Right'; $working.VerticalAlignment = 'Top'; $working.Margin = [Windows.Thickness]::new(0, 1, 1, 0); $working.Visibility = 'Collapsed'; $working.IsHitTestVisible = $false
  $working.SetResourceReference([Windows.Shapes.Shape]::FillProperty, 'BunnyAccent')
  # The art sits alone in its own container so a bitmap cache there holds the image with its effect, apart from the halo.
  $art = [Windows.Controls.Border]::new(); $art.Child = $image; $art.IsHitTestVisible = $false
  foreach ($element in @($art, $halo, $outline, $badge, $speaker, $working)) { [void]$grid.Children.Add($element) }
  $chip.Content = $grid
  $chip.Tag = @{ Slot = $SlotId; Key = ''; Scale = $scale; Rotate = $rotate; Move = $move; Art = $art; Image = $image; Halo = $halo; Badge = $badge; Outline = $outline; Speaker = $speaker; Working = $working; Skin = '' }
  $chip.Add_Click({ Show-BunnyWeaponDetail ([int]$this.Tag.Slot) })
  # Keyboard focus is visible: a 2 DIP accent border while the chip has focus (the same rule as the expanded slot rows).
  $chip.Add_GotKeyboardFocus({ $this.SetResourceReference([Windows.Controls.Control]::BorderBrushProperty, 'BunnyAccent'); $this.BorderThickness = [Windows.Thickness]::new(2) })
  $chip.Add_LostKeyboardFocus({ $this.BorderThickness = [Windows.Thickness]::new(0) })
  return $chip
}

# Neutral count of user-facing Agents that are in no slot: a dot cluster and the number. Not a weapon, not a letter.
function New-BunnyUnslottedChip([int]$Count) {
  $chip = [Windows.Controls.Border]::new()
  $chip.Width = $script:bunnyWeaponCellWidth; $chip.Height = $script:bunnyWeaponCellHeight
  # The neutral count floats in the same capsule as the weapons: no field or frame of its own.
  $chip.Margin = [Windows.Thickness]::new(2); $chip.CornerRadius = [Windows.CornerRadius]::new(12); $chip.BorderThickness = [Windows.Thickness]::new(0)
  $chip.Background = [Windows.Media.Brushes]::Transparent
  $stack = [Windows.Controls.StackPanel]::new(); $stack.HorizontalAlignment = 'Center'; $stack.VerticalAlignment = 'Center'
  $dots = [Windows.Controls.StackPanel]::new(); $dots.Orientation = 'Horizontal'; $dots.HorizontalAlignment = 'Center'
  for ($i = 0; $i -lt 3; $i++) {
    $dot = [Windows.Shapes.Ellipse]::new(); $dot.Width = 2.5; $dot.Height = 2.5; $dot.Margin = [Windows.Thickness]::new(0.8, 0, 0.8, 1.5)
    $dot.SetResourceReference([Windows.Shapes.Shape]::FillProperty, 'BunnyMuted'); [void]$dots.Children.Add($dot)
  }
  $number = [Windows.Controls.TextBlock]::new(); $number.Text = [string]$Count; $number.FontSize = 9; $number.FontWeight = 'SemiBold'; $number.HorizontalAlignment = 'Center'
  $number.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty, 'BunnyMuted')
  [void]$stack.Children.Add($dots); [void]$stack.Children.Add($number); $chip.Child = $stack
  $label = [string]$Count + $(if ($Count -eq 1) { ' more agent' } else { ' more agents' })
  $chip.ToolTip = $label
  [Windows.Automation.AutomationProperties]::SetName($chip, $label)
  return $chip
}

function Stop-BunnyWeaponMotion($Chip) {
  $tag = $Chip.Tag
  $tag.Move.BeginAnimation([Windows.Media.TranslateTransform]::XProperty, $null)
  $tag.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, $null)
  $tag.Rotate.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, $null)
  $tag.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleXProperty, $null)
  $tag.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleYProperty, $null)
  $tag.Halo.BeginAnimation([Windows.UIElement]::OpacityProperty, $null)
}

function Stop-BunnyWeaponStrip {
  foreach ($chip in @($script:bunnyWeaponChips.Values)) { Stop-BunnyWeaponMotion $chip; $chip.Tag.Key = '' }
}

function New-BunnyWeaponAnimation([double]$From, [double]$To, [double]$Ms, [bool]$Forever, [bool]$Reverse, [string]$Ease, [int]$Steps = 0) {
  if ($Steps -gt 0) {
    # Pixel art moves in whole steps (discrete key frames), as a sprite animation does.
    $stepped = [Windows.Media.Animation.DoubleAnimationUsingKeyFrames]::new()
    $stepped.Duration = [Windows.Duration]::new([TimeSpan]::FromMilliseconds([Math]::Max(50, $Ms)))
    for ($i = 0; $i -le $Steps; $i++) {
      $time = [Windows.Media.Animation.KeyTime]::FromPercent([double]$i / $Steps)
      [void]$stepped.KeyFrames.Add([Windows.Media.Animation.DiscreteDoubleKeyFrame]::new($From + ($To - $From) * $i / $Steps, $time))
    }
    $stepped.AutoReverse = $Reverse
    $stepped.RepeatBehavior = if ($Forever) { [Windows.Media.Animation.RepeatBehavior]::Forever } else { [Windows.Media.Animation.RepeatBehavior]::new(1) }
    return $stepped
  }
  $animation = [Windows.Media.Animation.DoubleAnimation]::new($From, $To, [Windows.Duration]::new([TimeSpan]::FromMilliseconds([Math]::Max(50, $Ms))))
  $animation.AutoReverse = $Reverse
  $animation.RepeatBehavior = if ($Forever) { [Windows.Media.Animation.RepeatBehavior]::Forever } else { [Windows.Media.Animation.RepeatBehavior]::new(1) }
  # Linear for the orbital spin; the other eases are cubic approximations of the spec's cubic-bezier curves.
  if ($Ease -ne 'orbital') { $easing = [Windows.Media.Animation.CubicEase]::new(); $easing.EasingMode = 'EaseInOut'; $animation.EasingFunction = $easing }
  return $animation
}

# The base loop and the task effect for one chip. Called only when the motion key changes. The skin scales the hover
# (subtle) and the period, steps it for pixel art, or stops it (intensity off); it never starts motion the state does not.
function Start-BunnyWeaponMotion($Chip, $Base, $Motion, $Skin) {
  Stop-BunnyWeaponMotion $Chip
  $tag = $Chip.Tag
  $tag.Halo.Opacity = switch ($Motion.Ring) { 'amber-pulse' { 0.9 } 'green' { 0.9 } 'red' { 0.9 } 'task-breathe' { 0.5 } default { 0 } }
  if (-not $bunnyAnimate -or -not $Base -or ($Skin -and -not $Skin.Animate)) { return }
  $amp = if ($Skin) { [double]$Skin.Amplitude } else { 1.0 }
  $steps = if ($Skin) { [int]$Skin.Steps } else { 0 }
  $period = [double]$Base.PeriodMs / [Math]::Max(0.1, [double]$Motion.Speed) * $(if ($Skin) { [double]$Skin.PeriodScale } else { 1.0 })
  if ($Motion.Loop -eq 'base') {
    switch ([string]$Base.Loop) {
      'float-tilt' { $tag.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, (New-BunnyWeaponAnimation 0 (-2 * $amp) $period $true $true $Base.Ease $steps)); $tag.Rotate.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, (New-BunnyWeaponAnimation (-2 * $amp) (2 * $amp) ($period * 1.1) $true $true $Base.Ease $steps)) }
      'float-glint' { $tag.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, (New-BunnyWeaponAnimation 0 (-1.5 * $amp) $period $true $true $Base.Ease $steps)) }
      'spin' { $tag.Rotate.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, (New-BunnyWeaponAnimation 0 360 $period $true $false $Base.Ease $(if ($steps) { 16 } else { 0 }))) }
      'hover-sheen' { $tag.Move.BeginAnimation([Windows.Media.TranslateTransform]::YProperty, (New-BunnyWeaponAnimation 0 (-1.5 * $amp) $period $true $true $Base.Ease $steps)); $tag.Rotate.BeginAnimation([Windows.Media.RotateTransform]::AngleProperty, (New-BunnyWeaponAnimation (-1 * $amp) (1 * $amp) $period $true $true $Base.Ease $steps)) }
    }
  }
  if ($Motion.Task -ne 'none') {
    $taskMs = [double]$script:bunnyWeaponTaskMs[[string]$Motion.Task]
    $tag.Halo.BeginAnimation([Windows.UIElement]::OpacityProperty, (New-BunnyWeaponAnimation 0.15 0.7 $taskMs $true $true 'standard'))
  }
  if ($Motion.Ring -eq 'amber-pulse') { $tag.Halo.BeginAnimation([Windows.UIElement]::OpacityProperty, (New-BunnyWeaponAnimation 0.3 1.0 2400 $true $true 'standard')) }
}

# One-shots, fired only on an observed transition. They end on their own (FillBehavior Stop) and leave the static state.
function Invoke-BunnyWeaponOneShot($Chip, [string]$Kind) {
  if (-not $Chip -or -not $bunnyAnimate) { return }
  $tag = $Chip.Tag
  switch ($Kind) {
    'verified' {
      $grow = New-BunnyWeaponAnimation 1 1.12 450 $false $true 'standard'; $grow.FillBehavior = 'Stop'
      $tag.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleXProperty, $grow)
      $tag.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleYProperty, $grow.Clone())
      $flash = New-BunnyWeaponAnimation 1 0 900 $false $false 'standard'; $flash.FillBehavior = 'Stop'
      $tag.Halo.BeginAnimation([Windows.UIElement]::OpacityProperty, $flash)
    }
    'failed' {
      $shake = New-BunnyWeaponAnimation -2 2 100 $false $true 'standard'; $shake.RepeatBehavior = [Windows.Media.Animation.RepeatBehavior]::new(2); $shake.FillBehavior = 'Stop'
      $tag.Move.BeginAnimation([Windows.Media.TranslateTransform]::XProperty, $shake)
    }
    'completed' {
      $settle = New-BunnyWeaponAnimation 0.97 1 220 $false $false 'standard'; $settle.FillBehavior = 'Stop'
      $tag.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleXProperty, $settle)
      $tag.Scale.BeginAnimation([Windows.Media.ScaleTransform]::ScaleYProperty, $settle.Clone())
    }
  }
}

function Set-BunnyWeaponChip($Chip, $Slot, [bool]$Offline) {
  $tag = $Chip.Tag
  $weapon = [string]$Slot.weapon
  $base = $script:BunnyWeaponBase[$weapon]
  $state = if ($Offline) { 'OFFLINE' } else { [string]$Slot.presentation.state }
  $motion = Get-BunnyWeaponMotion $state
  $skin = Get-BunnyCharacterSkin $weapon (Get-BunnySlotAppearance $bunnySnapshot.characterAppearance ([int]$Slot.slot)) ([bool]$bunnyAnimate) ([bool][Windows.SystemParameters]::HighContrast)
  $decodeWidth = if ($base -and $skin.PixelGrid) { Get-BunnyPixelDecodeWidth $base.Compact $skin.PixelGrid } else { $skin.DecodeWidth }
  $source = if ($base) { Get-BunnyCharacterSource $base.Compact $decodeWidth } else { $null }
  if ($source -and $tag.Image.Source -ne $source) { $tag.Image.Source = $source }
  $skinKey = (@($skin.Style, [string]$skin.Outline) -join '|')
  if ($skinKey -ne $tag.Skin) {
    $tag.Skin = $skinKey
    [Windows.Media.RenderOptions]::SetBitmapScalingMode($tag.Image, [Windows.Media.BitmapScalingMode]$skin.Scaling)
    $tag.Image.Effect = if ($skin.Effect) {
      $shadow = [Windows.Media.Effects.DropShadowEffect]::new()
      $shadow.Color = [Windows.Media.ColorConverter]::ConvertFromString([string]$skin.Effect.Color)
      $shadow.BlurRadius = [double]$skin.Effect.Blur; $shadow.ShadowDepth = [double]$skin.Effect.Depth; $shadow.Opacity = [double]$skin.Effect.Opacity
      $shadow.Freeze(); $shadow
    } else { $null }
    # A shader effect re-runs every frame while the chip's transform animates. The cache is on the art's container, not on
    # the image: WPF applies an element's own effect after its cache, so only a cached parent holds the effect's output.
    $tag.Art.CacheMode = if ($skin.Effect) {
      $cache = [Windows.Media.BitmapCache]::new(); $cache.RenderAtScale = [Math]::Max(1.0, [double](Get-BunnyDeviceScale).X); $cache
    } else { $null }
    $tag.Outline.Visibility = if ($skin.Outline) { 'Visible' } else { 'Collapsed' }
  }
  $role = Get-BunnyNotchRole ([int]$Slot.slot) $state $(if ($Offline -or -not $bunnySnapshot.personalAgentContext) { $null } else { $bunnySnapshot.personalAgentContext.foreground })
  $tag.Speaker.Visibility = if ($role.Speaking) { 'Visible' } else { 'Collapsed' }
  $tag.Working.Visibility = if ($role.Working) { 'Visible' } else { 'Collapsed' }
  $tag.Image.Opacity = if ($motion.Desaturate) { 0.55 } else { $motion.Opacity }
  $label = if ($Slot.presentation) { [string]$Slot.presentation.label } else { 'Status unknown' }
  if ($Offline) { $label = 'last known, Host offline: ' + $label }
  if ($role.Speaking) { $label = $label + ', speaking now' }
  $name = (Get-BunnyWeaponLabel $weapon) + ' ' + [char]0x2014 + ' ' + [string]$Slot.displayName + ', ' + $label
  $Chip.ToolTip = $name
  [Windows.Automation.AutomationProperties]::SetName($Chip, $name)
  $ring = switch ($motion.Ring) { 'amber-pulse' { 'BunnyWarning' } 'green' { 'BunnyPositive' } 'red' { 'BunnyNegative' } 'task-breathe' { 'BunnyAccent' } default { 'BunnySep' } }
  $tag.Halo.SetResourceReference([Windows.Controls.Border]::BorderBrushProperty, $ring)
  $badgeInk = switch ($motion.Badge) { 'check-green' { 'BunnyPositive' } 'alert-amber' { 'BunnyWarning' } 'alert-red' { 'BunnyNegative' } 'check-neutral' { 'BunnyMuted' } default { 'BunnyMuted' } }
  $tag.Badge.Text = switch ($motion.Badge) { 'check-green' { [string][char]0x2713 } 'check-neutral' { [string][char]0x2713 } 'alert-amber' { '!' } 'alert-red' { '!' } 'pause' { 'II' } default { '' } }
  $tag.Badge.SetResourceReference([Windows.Controls.TextBlock]::ForegroundProperty, $badgeInk)
  $key = (@($weapon, $state, $motion.Loop, $motion.Task, $motion.Ring, [string]$motion.Speed, [string]$bunnyAnimate, $skin.Style, [string]$skin.Animate, [string]$skin.Amplitude) -join '|')
  if ($key -ne $tag.Key) { $tag.Key = $key; Start-BunnyWeaponMotion $Chip $base $motion $skin }
}

# The strip: bound slots in slot order, then the neutral count. Chips are reused; only the layout containers are rebuilt.
function Update-BunnyAgentStrip {
  $strip = $bunnyControls.AgentStrip
  $snapshot = $bunnySnapshot.personalAgents
  $view = Get-BunnyPersonalAgentStrip $snapshot
  $transitions = @(Get-BunnyObservedTransitions $script:bunnyWeaponPrevious $snapshot ([bool]$bunnyOnline))
  # Offline data is retained for display only, never seeded as an observation. Reconnect starts a new comparison.
  $script:bunnyWeaponPrevious = if ($bunnyOnline) { @{} } else { $null }
  if ($bunnyOnline) {
    foreach ($slot in @($snapshot.slots | Where-Object { $_ })) { $script:bunnyWeaponPrevious[[string]$slot.slot] = @{ State = [string]$slot.presentation.state; AgentId = [string]$slot.agentId } }
  } else { $script:bunnyHappyUntil = 0.0 }
  if (@($transitions | Where-Object { $_.Kind -eq 'verified' }).Count) { $script:bunnyHappyUntil = [double](Get-BunnyNowMs) + $script:bunnyHappyMs }
  $slots = @($view.Slots)
  $tasks = Get-BunnyTaskStrip $bunnySnapshot.persistentTasks ([bool]$bunnyOnline) $bunnySnapshot.proactive
  $cells = $slots.Count + $(if ($view.Unslotted -gt 0) { 1 } else { 0 }) + $(if ($tasks.Count -gt 0) { 1 } else { 0 })
  $strip.Children.Clear()
  if ($cells -eq 0) { Stop-BunnyWeaponStrip; $strip.Visibility = 'Collapsed'; $bunnyControls.StripCapsule.Visibility = 'Collapsed'; Set-BunnyJoin; return }
  $strip.Visibility = 'Visible'; $bunnyControls.StripCapsule.Visibility = 'Visible'; Set-BunnyJoin
  $items = @()
  foreach ($slot in $slots) {
    $id = [int]$slot.slot
    if (-not $script:bunnyWeaponChips.ContainsKey($id)) { $script:bunnyWeaponChips[$id] = New-BunnyWeaponChip $id }
    $chip = $script:bunnyWeaponChips[$id]
    Set-BunnyWeaponChip $chip $slot (-not $bunnyOnline)
    $items += $chip
  }
  foreach ($id in @($script:bunnyWeaponChips.Keys)) {
    if (-not @($slots | Where-Object { [int]$_.slot -eq [int]$id }).Count) { Stop-BunnyWeaponMotion $script:bunnyWeaponChips[$id]; $script:bunnyWeaponChips[$id].Tag.Key = '' }
  }
  if ($view.Unslotted -gt 0) { $items += New-BunnyUnslottedChip $view.Unslotted }
  if ($tasks.Count -gt 0) { $items += Get-BunnyTaskChip $tasks }
  # One container for every cell, in slot order: the orientation (row or column) is set by the layout (Set-BunnyLayout).
  foreach ($item in $items) { [void]$strip.Children.Add($item) }
  foreach ($transition in $transitions) {
    $id = [int]$transition.Slot
    if (@($slots | Where-Object { [int]$_.slot -eq $id }).Count -and $script:bunnyWeaponChips.ContainsKey($id)) { Invoke-BunnyWeaponOneShot $script:bunnyWeaponChips[$id] ([string]$transition.Kind) }
  }
}

function Get-BunnyWeaponSlotRecord {
  if ($null -eq $script:bunnyWeaponDetailSlot) { return $null }
  return @($bunnySnapshot.personalAgents.slots | Where-Object { $_ -and [int]$_.slot -eq [int]$script:bunnyWeaponDetailSlot }) | Select-Object -First 1
}

function Show-BunnyWeaponDetail([int]$SlotId) {
  $selected = @($bunnySnapshot.personalAgents.slots | Where-Object { $_ -and [int]$_.slot -eq $SlotId -and $_.active -and $_.agentId }) | Select-Object -First 1
  if (-not $selected) { return }
  $script:bunnyWeaponDetailSlot = $SlotId
  $script:bunnyWeaponStopConfirm = $null
  # The view must be 'weapon' before the card fills: Update-BunnyWeaponDetail draws nothing in any other view.
  Set-BunnyView 'weapon'
  Update-BunnyWeaponDetail
  [void]$bunnyControls.WeaponBack.Focus()
}

# The card reads only the Host's personal-agents record. Commands are the existing agent.* actions, and each one shows
# its outcome only after the Host answers (Begin-BunnyCommand reports a refusal through the notice line).
function Update-BunnyWeaponDetail {
  if ($bunnyView -ne 'weapon') { return }
  $slot = Get-BunnyWeaponSlotRecord
  if (-not $slot) { Set-BunnyView 'idle'; return }
  $c = $bunnyControls
  $base = $script:BunnyWeaponBase[[string]$slot.weapon]
  $hero = if ($base) { Get-BunnyCharacterSource $base.Hero 160 } else { $null }
  if ($hero -and $c.WeaponHero.Source -ne $hero) { $c.WeaponHero.Source = $hero }
  $agent = $slot.agent
  $c.WeaponTitle.Text = [string]$slot.displayName
  $c.WeaponWeapon.Text = (Get-BunnyWeaponLabel ([string]$slot.weapon)) + ' ' + [char]0x00B7 + ' ' + $(if ($agent) { [string]$agent.name } else { 'No Agent bound' })
  $stateText = if ($slot.presentation) { [string]$slot.presentation.label } else { 'Status unknown' }
  $c.WeaponState.Text = if ($bunnyOnline) { $stateText } else { 'Last known: ' + $stateText + ' (Host offline)' }
  $c.WeaponBasis.Text = Get-BunnyPresentationBasisText $slot.presentation.basis
  $mission = if ($agent -and $agent.missionTitle) { [string]$agent.missionTitle } else { 'No Mission' }
  $project = if ($agent -and $agent.projectId) { @($bunnySnapshot.projects | Where-Object { $_.id -eq $agent.projectId }) | Select-Object -First 1 } else { $null }
  $c.WeaponContext.Text = 'Mission: ' + $mission + "`nProject: " + $(if ($project) { [string]$project.name } elseif ($agent -and $agent.projectId) { 'bound project' } else { 'none' })
  $progress = $slot.progress
  $c.WeaponProgress.Text = if ($progress -and [int]$progress.total -gt 0) { [string]$progress.completed + ' of ' + [string]$progress.total + ' steps ' + [char]0x00B7 + ' ' + [string]$progress.verified + ' verified' } else { 'No Mission steps yet' }
  $pending = if ($slot.attention) { [int]$slot.attention.pendingApprovals } else { 0 }
  $c.WeaponAttention.Text = 'Pending approvals: ' + [string]$pending
  $failure = if ($agent -and $agent.failure) { ([string]$agent.failure).Replace('_', ' ').ToLower() } else { '' }
  $c.WeaponFailure.Text = if ($failure) { 'Failure: ' + $failure } else { '' }
  $c.WeaponFailure.Visibility = if ($failure) { 'Visible' } else { 'Collapsed' }
  $c.WeaponTechnical.Text = 'Model for current task: ' + $(if ($slot.technical -and $slot.technical.model) { [string]$slot.technical.model + ' (' + [string]$slot.technical.provider + ')' } else { 'not reported' })
  $agentState = if ($agent) { [string]$agent.state } else { '' }
  $canPause = [bool]($agent -and $bunnyOnline -and -not $bunnyPending -and $agentState -in @('CREATED', 'PLANNING', 'RUNNING', 'WAITING_FOR_USER', 'WAITING_FOR_DEPENDENCY', 'VERIFYING'))
  $canResume = [bool]($agent -and $bunnyOnline -and -not $bunnyPending -and $agentState -eq 'PAUSED')
  $canStop = [bool]($agent -and $bunnyOnline -and -not $bunnyPending -and $agentState -notin @('COMPLETED', 'FAILED', 'STOPPED', ''))
  $c.WeaponPause.Visibility = if ($canPause) { 'Visible' } else { 'Collapsed' }
  $c.WeaponResume.Visibility = if ($canResume) { 'Visible' } else { 'Collapsed' }
  $c.WeaponStop.Visibility = if ($canStop) { 'Visible' } else { 'Collapsed' }
  $confirming = $agent -and $script:bunnyWeaponStopConfirm -eq [string]$agent.id
  $c.WeaponStop.Content = if ($confirming) { 'Stop now' } else { 'Stop' }
  $c.WeaponOpen.Visibility = if ($agent) { 'Visible' } else { 'Collapsed' }
}

function Invoke-BunnyWeaponCommand([string]$Action) {
  $slot = Get-BunnyWeaponSlotRecord
  if (-not $slot -or -not $slot.agent) { return }
  $agentId = [string]$slot.agent.id
  if ($Action -eq 'agent.stop' -and $script:bunnyWeaponStopConfirm -ne $agentId) {
    $script:bunnyWeaponStopConfirm = $agentId
    $bunnyControls.Notice.Text = 'Stop future admissions? Already admitted effects are not undone. Press Stop now to confirm.'
    Update-BunnyWeaponDetail
    return
  }
  $script:bunnyWeaponStopConfirm = $null
  # Begin-BunnyCommand drops a command while another is in flight; the notice must not claim a send that never happened.
  if ($bunnyPending) { return }
  $bunnyControls.Notice.Text = 'Sent to the Host. Waiting for its answer.'
  Begin-BunnyCommand $Action @{ id = $agentId }
  Update-BunnyWeaponDetail
}

$bunnyControls.WeaponPause.Add_Click({ Invoke-BunnyWeaponCommand 'agent.pause' })
$bunnyControls.WeaponResume.Add_Click({ Invoke-BunnyWeaponCommand 'agent.resume' })
$bunnyControls.WeaponStop.Add_Click({ Invoke-BunnyWeaponCommand 'agent.stop' })
$bunnyControls.WeaponOpen.Add_Click({
  $slot = Get-BunnyWeaponSlotRecord
  if ($slot -and $slot.agent) { Open-BunnyDashboard ('?view=agentic&agent=' + [Uri]::EscapeDataString([string]$slot.agent.id)) }
})
$bunnyControls.WeaponBack.Add_Click({ Close-BunnyDetails })
