// Visual Experience 2.0: the native Notch theme rules. The pure functions in install/Bunny-Island.Theme.ps1 run in Windows
// PowerShell 5.1 (one powershell.exe invocation, JSON in, JSON out) against the real Host view built by
// src/lib/bunny-host/ui-theme.ts, plus hostile inputs that must all fall back to the accepted glass Notch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_UI_PREFERENCE, UI_THEME_IDS, uiThemeView } from '../src/lib/bunny-host/ui-theme.ts';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const themePath = join(root, 'install', 'Bunny-Island.Theme.ps1');
const visualPath = join(root, 'install', 'Bunny-Island.Visual.ps1');
const packagePath = join(root, 'scripts', 'package-bunny-desktop.ps1');
const skip = process.platform === 'win32' ? false : 'The Notch theme is a Windows PowerShell surface';

const views = {};
for (const id of UI_THEME_IDS)
  for (const highContrast of [false, true]) views[`${id}${highContrast ? '-hc' : ''}`] = uiThemeView({ ...DEFAULT_UI_PREFERENCE, theme: id, highContrast, variant: 'dark' }, 7);
const good = views.pixel;
const clone = (value) => JSON.parse(JSON.stringify(value));
const attachGlass = (view, glass) => { const v = clone(view); v.notch.glass = glass; return v; };
// E2a: the notch tokens may carry the optional glass block from the v2 preference (intensity + rim/sheen alphas).
views.glassGlass85 = attachGlass(views.glass, { intensity: 85, rimAlpha: 0.895, sheenAlpha: 0.707 });
views.glassGlass100 = attachGlass(views.glass, { intensity: 100, rimAlpha: 1, sheenAlpha: 0.8 });
const hostileGlassViews = {
  intensityHigh: { intensity: 101, rimAlpha: 0.5, sheenAlpha: 0.5 },
  intensityNegative: { intensity: -1, rimAlpha: 0.5, sheenAlpha: 0.5 },
  intensityFloat: { intensity: 1.5, rimAlpha: 0.5, sheenAlpha: 0.5 },
  intensityGarbage: { intensity: '85);calc', rimAlpha: 0.5, sheenAlpha: 0.5 },
  rimAlphaHuge: { intensity: 85, rimAlpha: 1.5, sheenAlpha: 0.5 },
  sheenNegative: { intensity: 85, rimAlpha: 0.5, sheenAlpha: -0.1 },
  missingFields: { intensity: 85 },
  wrongTypeRim: { intensity: 85, rimAlpha: 'opaque', sheenAlpha: 0.5 },
};
const hostileGlass = {};
for (const [name, glass] of Object.entries(hostileGlassViews)) hostileGlass[name] = attachGlass(views.glass, glass);
const hostile = {
  missing: null,
  noNotch: { revision: 1 },
  foreignSchema: { ...clone(good), notch: { ...clone(good.notch), schema: 'bunny-a.ui-theme.v9' } },
  badHex: (() => { const v = clone(good); v.notch.dark.fill = '#12345g'; return v; })(),
  shortHex: (() => { const v = clone(good); v.notch.light.ink = '#fff'; return v; })(),
  injection: (() => { const v = clone(good); v.notch.dark.accent = '$(Remove-Item C:\\x)'; return v; })(),
  subexpressionFont: (() => { const v = clone(good); v.notch.font = '$(calc.exe)'; return v; })(),
  unknownFont: (() => { const v = clone(good); v.notch.font = 'Comic Sans MS'; return v; })(),
  unknownShape: (() => { const v = clone(good); v.notch.shape = 'star'; return v; })(),
  hugeRadius: (() => { const v = clone(good); v.notch.radius = 99; return v; })(),
  negativeBorder: (() => { const v = clone(good); v.notch.border = -1; return v; })(),
  badThemeId: (() => { const v = clone(good); v.notch.theme = 'pixel; rm'; return v; })(),
  badVariant: (() => { const v = clone(good); v.notch.variant = 'sepia'; return v; })(),
  missingPalette: (() => { const v = clone(good); delete v.notch.light; return v; })(),
  // Independent review finding 7: `$` also matches before a trailing newline; the module anchors with \z.
  trailingNewlineHex: (() => { const v = clone(good); v.notch.dark.fill = '#AABBCC\n'; return v; })(),
  trailingNewlineId: (() => { const v = clone(good); v.notch.theme = 'pixel\n'; return v; })(),
};

function runPowerShell() {
  const dir = mkdtempSync(join(tmpdir(), 'bunny-ve2-notch-'));
  try {
    const input = join(dir, 'in.json');
    writeFileSync(input, JSON.stringify({ views, hostile, hostileGlass }));
    const script = `
$ErrorActionPreference='Stop'
. '${themePath.replace(/'/g, "''")}'
$data = Get-Content -LiteralPath '${input.replace(/'/g, "''")}' -Raw | ConvertFrom-Json
$out = @{ themes = @{}; hostile = @{}; light = @{} }
foreach ($p in $data.views.PSObject.Properties) {
  $t = Get-BunnyNotchTheme $p.Value
  if ($null -eq $t) { $out.themes[$p.Name] = $null; continue }
  $out.themes[$p.Name] = @{
    theme = $t.Theme; shape = $t.Shape; font = $t.Font; glow = $t.Glow; hc = $t.HighContrast; revision = $t.Revision
    horizontal = Get-BunnyNotchRadius $t $false; vertical = Get-BunnyNotchRadius $t $true
    border = Get-BunnyNotchBorder $t $false; borderHc = Get-BunnyNotchBorder $t $true
    darkPalette = Get-BunnyNotchPalette $t $false 238; lightPalette = Get-BunnyNotchPalette $t $true 238
    key = Get-BunnyNotchThemeKey $t
  }
}
foreach ($p in $data.hostile.PSObject.Properties) { $out.hostile[$p.Name] = ($null -eq (Get-BunnyNotchTheme $p.Value)) }
$glassToken85 = Get-BunnyNotchTheme $data.views.glassGlass85
$out.glass = @{
  carried = [bool]($null -ne $glassToken85.Glass)
  intensity = $(if ($glassToken85.Glass) { $glassToken85.Glass.Intensity } else { -1 })
  rim = $(if ($glassToken85.Glass) { $glassToken85.Glass.Rim } else { -1 })
  sheen = $(if ($glassToken85.Glass) { $glassToken85.Glass.Sheen } else { -1 })
  keyGlassDirect = Get-BunnyNotchThemeKey @{ Theme = 'glass'; Revision = 7; Variant = 'dark'; HighContrast = $false; Glass = @{ Intensity = 85; Rim = 0.895; Sheen = 0.707 } }
  keyPlainDirect = Get-BunnyNotchThemeKey @{ Theme = 'glass'; Revision = 7; Variant = 'dark'; HighContrast = $false; Glass = $null }
}
$out.hostileGlass = @{}
foreach ($p in $data.hostileGlass.PSObject.Properties) {
  $t = Get-BunnyNotchTheme $p.Value
  $out.hostileGlass[$p.Name] = @{ themeValid = ($null -ne $t); glassDropped = [bool]($null -eq $t.Glass) }
}
$out.alpha = @{
  token = Get-BunnyNotchGlassAlpha (Get-BunnyNotchTheme $data.views.glassGlass100).Glass 7 'medium' $false
  tokenRev0 = Get-BunnyNotchGlassAlpha (Get-BunnyNotchTheme $data.views.glassGlass100).Glass 0 'medium' $false
  hc = Get-BunnyNotchGlassAlpha $null 0 'medium' $true
  leverLow = Get-BunnyNotchGlassAlpha $null 0 'low' $false
  leverHigh = Get-BunnyNotchGlassAlpha $null 0 'high' $false
  leverMedium = Get-BunnyNotchGlassAlpha $null 0 'medium' $false
  leverUnknown = Get-BunnyNotchGlassAlpha $null 0 'sepia' $false
  bandLowEdge = Get-BunnyNotchGlassAlpha @{ Intensity = 57 } 7 'medium' $false
  bandMidStart = Get-BunnyNotchGlassAlpha @{ Intensity = 58 } 7 'medium' $false
  bandMidEdge = Get-BunnyNotchGlassAlpha @{ Intensity = 92 } 7 'medium' $false
  bandHighStart = Get-BunnyNotchGlassAlpha @{ Intensity = 93 } 7 'medium' $false
}
$glass = Get-BunnyNotchTheme $data.views.glass
$out.light.explicitDark = Get-BunnyThemeLight $glass 'light' $true
$sys = @{} + $glass; $sys.Variant = 'system'
$out.light.systemNativeLight = Get-BunnyThemeLight $sys 'light' $false
$out.light.systemNativeDark = Get-BunnyThemeLight $sys 'dark' $true
$out.light.systemFollowsWindows = Get-BunnyThemeLight $sys 'system' $true
$out.light.noThemeNative = Get-BunnyThemeLight $null 'dark' $true
# Revision 0: nothing saved on the Host yet, so the Notch keeps its own appearance (independent review finding 1).
$unsaved = @{} + $glass; $unsaved.Revision = 0
$out.light.unsavedNativeDark = Get-BunnyThemeLight $unsaved 'dark' $true
$out.light.unsavedNativeLight = Get-BunnyThemeLight $unsaved 'light' $false
$out.defaultRadius = Get-BunnyNotchRadius $null $false
$out.defaultKey = Get-BunnyNotchThemeKey $null
$out | ConvertTo-Json -Depth 6 -Compress`;
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], { encoding: 'utf8', timeout: 120_000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(result.stdout.trim());
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('every theme (and its high-contrast form) reaches the Notch as validated tokens; hostile values fall back to glass', { skip }, () => {
  const out = runPowerShell();
  for (const id of UI_THEME_IDS) {
    for (const name of [id, `${id}-hc`]) {
      const t = out.themes[name];
      assert.ok(t, `${name} validates`);
      assert.equal(t.theme, id);
      assert.equal(t.revision, 7);
      for (const palette of [t.darkPalette, t.lightPalette])
        for (const [key, value] of Object.entries(palette)) assert.match(value, /^#[0-9A-F]{8}$/, `${name}.${key} is #AARRGGBB`);
      for (const radius of [t.horizontal, t.vertical])
        for (const corner of Object.values(radius)) assert.ok(corner >= 0 && corner <= 29, `${name} corner ${corner}`);
      assert.ok(t.border >= 1 && t.border <= 4);
      assert.equal(t.borderHc, 2);
      if (name.endsWith('-hc')) assert.equal(t.glow, false, 'no glow under high contrast');
    }
  }
  // The accepted glass Notch keeps its exact T13 radii.
  assert.deepEqual(out.themes.glass.horizontal, { TopLeft: 28, TopRight: 28, BottomRight: 28, BottomLeft: 28 });
  assert.deepEqual(out.themes.glass.vertical, { TopLeft: 29, TopRight: 29, BottomRight: 29, BottomLeft: 29 });
  assert.deepEqual(out.defaultRadius, { TopLeft: 28, TopRight: 28, BottomRight: 28, BottomLeft: 28 });
  assert.equal(out.defaultKey, 'default');
  // Shapes are genuinely different on the Notch: a block is square, a pill round, a blob uneven.
  assert.equal(out.themes.brutalism.horizontal.TopLeft, 0);
  assert.equal(out.themes.y2k.horizontal.TopLeft, 28);
  assert.notEqual(out.themes.clay.horizontal.TopRight, out.themes.clay.horizontal.TopLeft);
  assert.ok(new Set(UI_THEME_IDS.map((id) => out.themes[id].darkPalette.Fill)).size >= 18, 'the Notch material differs per theme');
  for (const [name, fellBack] of Object.entries(out.hostile)) assert.equal(fellBack, true, `${name} must fall back`);
  assert.deepEqual(out.light, { explicitDark: false, systemNativeLight: true, systemNativeDark: false, systemFollowsWindows: true, noThemeNative: false, unsavedNativeDark: false, unsavedNativeLight: true });
});

test('E2a the notch tokens may carry a glass block; a malformed block drops only itself, never the theme', { skip }, () => {
  const out = runPowerShell();
  assert.equal(out.glass.carried, true, 'the glass block is carried');
  assert.equal(out.glass.intensity, 85);
  assert.ok(Math.abs(out.glass.rim - 0.895) < 0.0001, 'rim alpha survives the round trip');
  assert.ok(Math.abs(out.glass.sheen - 0.707) < 0.0001);
  // Direct-construction pair: machine-independent, only intensity present on one side. (Key checks are direct-constructed:
  // the hosted PS 5.1 diverged on one JSON re-parse detail, and the contract does not rely on that path.)
  assert.notEqual(out.glass.keyGlassDirect, out.glass.keyPlainDirect, 'an intensity-only change restyles the notch');
  for (const [name, result] of Object.entries(out.hostileGlass)) {
    assert.equal(result.themeValid, true, `${name}: the theme itself stays valid`);
    assert.equal(result.glassDropped, true, `${name}: the malformed glass block drops, the island keeps its own lever`);
  }
});

test('E2a the glass-intensity alpha ladder reproduces the shipped 250/238/218 exactly at the mapped anchors', { skip }, () => {
  const out = runPowerShell();
  assert.deepEqual(out.alpha, {
    token: 218, tokenRev0: 238, hc: 255,
    leverLow: 250, leverHigh: 218, leverMedium: 238, leverUnknown: 238,
    bandLowEdge: 250, bandMidStart: 238, bandMidEdge: 238, bandHighStart: 218,
  });
});

test('the Notch theme module is data-only, wired into the Visual layer and packaged', () => {
  const theme = readFileSync(themePath, 'utf8');
  for (const forbidden of [/Invoke-Expression/i, /\biex\b/i, /ScriptBlock\]::Create/i, /Add-Type/i, /Start-Process/i, /\.Invoke\(/]) assert.doesNotMatch(theme, forbidden);
  assert.ok([...theme].every((ch) => ch.charCodeAt(0) < 128), "ASCII only: Windows PowerShell 5.1 reads BOM-less files as ANSI");
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /\. \(Join-Path \$PSScriptRoot 'Bunny-Island\.Theme\.ps1'\)/);
  assert.match(visual, /\$script:bunnySnapshot=Invoke-Bunny;\$script:bunnyOnline=\$true;Update-BunnyUiTheme;/);
  assert.match(visual, /if\(\$key-eq\$script:bunnyUiThemeKey\)\{return\}/, 'restyle only when the theme changes');
  // E2a: the alpha ladder and rim/sheen rendering come from the Glass Intensity helper; the shipped 250-ladder switch is gone
  // (the lever's 30/85/100 mapping switch remains, by design).
  assert.match(visual, /Get-BunnyNotchGlassAlpha/);
  assert.doesNotMatch(visual, /switch\(\$bunnyPreferences\.glass\)\{'low'\{250\}/);
  // The header keeps local brushes tuned for the black glass body; a themed (possibly light) body must replace them, or the
  // status text and icons render light-on-light (found in the Gate F native captures).
  assert.match(visual, /\$bunnyControls\.Header\.Resources\[\$key\]=\$\(if\(\$themedHeader-and\$palette\.ContainsKey\(\$key\)\)/);
  assert.match(readFileSync(packagePath, 'utf8'), /'Bunny-Island\.Theme\.ps1'/);
});
