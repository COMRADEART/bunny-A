# Visual Experience 2.0: the native Notch's theme rules (pure functions, no WPF state).
# The Host sends `uiTheme.notch` in its snapshot: flat tokens from src/lib/bunny-host/ui-theme.ts. This file validates every
# value AGAIN before WPF sees it: colours must be #rrggbb, the shape, font and numbers come from fixed allowlists and ranges,
# and anything else makes the whole theme fall back to the accepted black-glass Notch. Theme data is never evaluated or
# executed, and nothing here reads or changes what an Agent may do.

$script:BunnyNotchShapes = @('pill','capsule','block','frame','tab','blob','plate')
$script:BunnyNotchFonts = @('Segoe UI Variable Display','Segoe UI','Segoe UI Semibold','Bahnschrift','Cascadia Mono','Consolas','Georgia','Cambria','Palatino Linotype','Constantia','Segoe Print','Ink Free','Courier New','Sitka Text','Candara','Corbel','Lucida Console')
$script:BunnyNotchColorKeys = @('fill','fillEnd','stroke','ink','muted','accent','accentInk','glow')
$script:BunnyThemeIdPattern = '^[a-z0-9]{2,16}\z'

function Test-BunnyHexColor([object]$Value) {
 # \z, not $: $ also matches before a trailing newline.
 return ($Value -is [string]) -and ($Value -cmatch '^#[0-9a-fA-F]{6}\z')
}

# Returns a validated hashtable, or $null when the view is missing, from another schema, or has any invalid value.
function Get-BunnyNotchTheme($View) {
 if ($null -eq $View) { return $null }
 $notch = $View.notch
 if ($null -eq $notch) { return $null }
 if ([string]$notch.schema -cne 'bunny-a.ui-theme.v1') { return $null }
 $theme = [string]$notch.theme
 if ($theme -cnotmatch $script:BunnyThemeIdPattern) { return $null }
 $shape = [string]$notch.shape
 if ($script:BunnyNotchShapes -cnotcontains $shape) { return $null }
 $font = [string]$notch.font
 if ($script:BunnyNotchFonts -cnotcontains $font) { return $null }
 $radius = 0; $border = 0
 if (-not [int]::TryParse([string]$notch.radius, [ref]$radius) -or $radius -lt 0 -or $radius -gt 40) { return $null }
 if (-not [int]::TryParse([string]$notch.border, [ref]$border) -or $border -lt 0 -or $border -gt 4) { return $null }
 $variant = [string]$notch.variant
 if (@('system','light','dark') -cnotcontains $variant) { return $null }
 $palettes = @{}
 foreach ($side in @('light','dark')) {
  $source = $notch.$side
  if ($null -eq $source) { return $null }
  $colors = @{}
  foreach ($key in $script:BunnyNotchColorKeys) {
   $value = $source.$key
   if (-not (Test-BunnyHexColor $value)) { return $null }
   $colors[$key] = $value.ToUpperInvariant()
  }
  $palettes[$side] = $colors
 }
 $revision = 0
 [void][int]::TryParse([string]$View.revision, [ref]$revision)
 return @{
  Theme = $theme; Name = ([string]$notch.name).Substring(0, [Math]::Min(40, ([string]$notch.name).Length)); Shape = $shape; Font = $font
  Radius = $radius; Border = $border; Glow = [bool]($notch.glow -eq $true); HighContrast = [bool]($notch.highContrast -eq $true)
  Variant = $variant; Light = $palettes.light; Dark = $palettes.dark; Revision = $revision
 }
}

# Light or dark: an explicit workstation choice wins; "system" defers to the Notch's own setting, which may itself follow Windows.
# Revision 0 means the owner never saved a workstation theme, so the Notch keeps its own T13 appearance setting.
function Get-BunnyThemeLight($Theme, [string]$NativePreference, [bool]$WindowsLight) {
 if ($null -ne $Theme -and $Theme.Revision -gt 0 -and $Theme.Variant -ne 'system') { return $Theme.Variant -eq 'light' }
 if ($NativePreference -eq 'light') { return $true }
 if ($NativePreference -eq 'dark') { return $false }
 return $WindowsLight
}

# The glass body's corners. Pills and capsules stay fully round (half the 58 DIP body); flat shapes use the theme radius; a
# blob is deliberately uneven. The accepted glass theme keeps its exact T13 radii (28 horizontal, 29 vertical).
function Get-BunnyNotchRadius($Theme, [bool]$Vertical) {
 $round = $(if ($Vertical) { 29 } else { 28 })
 if ($null -eq $Theme -or $Theme.Theme -eq 'glass') { return @{ TopLeft = $round; TopRight = $round; BottomRight = $round; BottomLeft = $round } }
 switch ($Theme.Shape) {
  'pill' { return @{ TopLeft = $round; TopRight = $round; BottomRight = $round; BottomLeft = $round } }
  'capsule' { return @{ TopLeft = $round; TopRight = $round; BottomRight = $round; BottomLeft = $round } }
  'blob' { return @{ TopLeft = $round; TopRight = [Math]::Round($round * 0.55); BottomRight = $round; BottomLeft = [Math]::Round($round * 0.7) } }
  'tab' { return @{ TopLeft = [Math]::Min($Theme.Radius, 16); TopRight = [Math]::Min($Theme.Radius, 16); BottomRight = 2; BottomLeft = 2 } }
  default { $r = [Math]::Min($Theme.Radius, 16); return @{ TopLeft = $r; TopRight = $r; BottomRight = $r; BottomLeft = $r } }
 }
}

# Stroke width for the body and strip: at least 1 DIP so the edge is always visible, and 2 under high contrast.
function Get-BunnyNotchBorder($Theme, [bool]$HighContrast) {
 if ($HighContrast) { return 2 }
 if ($null -eq $Theme -or $Theme.Theme -eq 'glass') { return 1 }
 return [Math]::Max(1, [Math]::Min(4, $Theme.Border))
}

# The theme's colours for the chosen appearance, as WPF-ready #AARRGGBB strings. Text roles map to the Notch resource keys.
function Get-BunnyNotchPalette($Theme, [bool]$Light, [int]$Alpha) {
 if ($null -eq $Theme) { return $null }
 $c = $(if ($Light) { $Theme.Light } else { $Theme.Dark })
 $a = '{0:X2}' -f [Math]::Max(200, [Math]::Min(255, $Alpha))
 return @{
  Fill = '#' + $a + $c.fill.Substring(1); FillEnd = '#' + $a + $c.fillEnd.Substring(1)
  Stroke = '#FF' + $c.stroke.Substring(1); Glow = '#FF' + $c.glow.Substring(1)
  BunnyText = '#FF' + $c.ink.Substring(1); BunnyMuted = '#FF' + $c.muted.Substring(1)
  BunnyAccent = '#FF' + $c.accent.Substring(1); BunnyOnAccent = '#FF' + $c.accentInk.Substring(1)
  BunnyAccentSoft = '#26' + $c.accent.Substring(1); BunnySep = '#40' + $c.muted.Substring(1); BunnySegment = '#33' + $c.muted.Substring(1)
  BunnyField = '#1F' + $c.muted.Substring(1); BunnyHover = '#24' + $c.accent.Substring(1)
  BunnyPopup = '#FF' + $c.fill.Substring(1); BunnyPanel = '#F2' + $c.fill.Substring(1)
 }
}

# A stable key for "did the theme change": the Notch restyles only when this differs, never on every poll.
function Get-BunnyNotchThemeKey($Theme) {
 if ($null -eq $Theme) { return 'default' }
 return '{0}|{1}|{2}|{3}' -f $Theme.Theme, $Theme.Revision, $Theme.Variant, $Theme.HighContrast
}
