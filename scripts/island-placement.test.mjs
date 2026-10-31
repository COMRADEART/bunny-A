// M-A-3 T10: Island notch placement rules (V47, V48, V49). Windows only: the rules run in Windows PowerShell 5.1 by
// dot-sourcing install/Bunny-Island.Placement.ps1. All cases run in ONE powershell.exe invocation (JSON in, JSON out).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const placementPath = join(root, 'install', 'Bunny-Island.Placement.ps1');
const visualPath = join(root, 'install', 'Bunny-Island.Visual.ps1');
const skip = process.platform === 'win32' ? false : 'Island placement is a Windows PowerShell surface';

// Work areas in DIPs: the 125% and 150% scaled desktops, a taskbar on each side, and extremes.
const areas = [
  { name: '1920x1080 minus taskbar', left: 0, top: 0, width: 1920, height: 1040 },
  { name: '1536x864 at 125% minus taskbar', left: 0, top: 0, width: 1536, height: 816 },
  { name: '1707x960 at 150% minus taskbar', left: 0, top: 0, width: 1707, height: 920 },
  { name: '1280x720 minus taskbar', left: 0, top: 0, width: 1280, height: 672 },
  { name: '1024x768 minus taskbar', left: 0, top: 0, width: 1024, height: 728 },
  { name: '800x600 minus taskbar', left: 0, top: 0, width: 800, height: 552 },
  { name: '3840x2160 minus taskbar', left: 0, top: 0, width: 3840, height: 2112 },
  { name: 'taskbar on the left', left: 72, top: 0, width: 1848, height: 1040 },
  { name: 'taskbar on the top', left: 0, top: 48, width: 1920, height: 992 },
  { name: 'tiny', left: 0, top: 0, width: 200, height: 100 },
  { name: 'one pixel', left: 0, top: 0, width: 1, height: 1 },
];
const sizes = [
  { width: 360, height: 76 },
  { width: 384, height: 76 },
  { width: 420, height: 76 },
  { width: 540, height: 664 },
  { width: 1920, height: 1080 },
  { width: 1, height: 1 },
  { width: 0, height: 0 },
  { width: 360, height: 400 },
];
const offsets = [0, 0.5, 1, -5, 7.5, null];
const edges = ['top', 'bottom', 'left', 'right'];
const agentCounts = [0, 1, 3, 5, 9];
const EPS = 1e-6;

function buildCases() {
  const cases = [];
  let n = 0;
  for (const area of areas) for (const size of sizes) for (const offset of offsets) for (const edge of edges) {
    cases.push({ id: n, area, size, offset, edge, agents: agentCounts[n % agentCounts.length] });
    n += 1;
  }
  cases.push({ id: n++, area: areas[1], size: sizes[0], offset: 1, edge: 'center', agents: 2 }); // unknown edge -> top
  return cases;
}

const runnerSource = `param([string]$Placement, [string]$Cases, [string]$Out)
. $Placement
$items = Get-Content -LiteralPath $Cases -Raw | ConvertFrom-Json
$results = foreach ($c in $items) {
  $area = @{ Left = [double]$c.area.left; Top = [double]$c.area.top; Width = [double]$c.area.width; Height = [double]$c.area.height }
  $size = @{ Width = [double]$c.size.width; Height = [double]$c.size.height }
  $p = Get-BunnyPlacement -Edge $c.edge -WorkArea $area -Size $size -Offset $c.offset
  $l = Get-BunnyIndicatorLayout -Placement $p -AgentCount ([int]$c.agents)
  [pscustomobject]@{ id = $c.id; left = $p.Left; top = $p.Top; width = $p.Width; height = $p.Height; edge = $p.Edge; orientation = $p.Orientation; side = $p.IndicatorSide; count = $l.Count; visible = $l.Visible; overflow = $l.Overflow; slots = $l.Slots; label = $l.Label; axis = $l.Axis }
}
[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject @($results) -Depth 4 -Compress), [Text.UTF8Encoding]::new($false))
`;

let placements = null;
let cases = null;

function runBatch() {
  if (placements) return placements;
  const dir = mkdtempSync(join(tmpdir(), 'island-placement-'));
  try {
    cases = buildCases();
    const casesPath = join(dir, 'cases.json');
    const runnerPath = join(dir, 'runner.ps1');
    const outPath = join(dir, 'out.json');
    writeFileSync(casesPath, JSON.stringify(cases));
    writeFileSync(runnerPath, runnerSource, 'utf8');
    const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runnerPath, '-Placement', placementPath, '-Cases', casesPath, '-Out', outPath], { encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, 'powershell placement run failed: ' + (run.stderr || run.stdout));
    placements = JSON.parse(readFileSync(outPath, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(placements.length, cases.length);
    return placements;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('V47-V49: every edge, work area, size and offset places the notch fully inside the WorkArea', { skip }, () => {
  const results = runBatch();
  for (const result of results) {
    const c = cases[result.id];
    const area = c.area;
    const label = `${area.name} ${c.edge} ${c.size.width}x${c.size.height} offset=${c.offset}`;
    assert.ok(result.width > 0 && result.height > 0, `${label}: non-positive footprint`);
    assert.ok(result.left >= area.left - EPS, `${label}: left ${result.left} outside work area`);
    assert.ok(result.top >= area.top - EPS, `${label}: top ${result.top} outside work area`);
    assert.ok(result.left + result.width <= area.left + area.width + EPS, `${label}: right edge outside work area`);
    assert.ok(result.top + result.height <= area.top + area.height + EPS, `${label}: bottom edge outside work area`);
  }
});

test('V47: top and bottom are horizontal with agent indicators LEFT of the body', { skip }, () => {
  for (const result of runBatch()) {
    const edge = cases[result.id].edge;
    if (edge !== 'top' && edge !== 'bottom' && edge !== 'center') continue;
    assert.equal(result.orientation, 'horizontal', `id ${result.id}`);
    assert.equal(result.side, 'left', `id ${result.id}`);
    // Unknown edges normalise to top; the test does not treat them as a separate case.
    const expectedEdge = edge === 'bottom' ? 'bottom' : 'top';
    assert.equal(result.edge, expectedEdge, `id ${result.id}`);
  }
});

test('V48: left and right are vertical with agent indicators at the TOP of the body', { skip }, () => {
  for (const result of runBatch()) {
    const edge = cases[result.id].edge;
    if (edge !== 'left' && edge !== 'right') continue;
    assert.equal(result.orientation, 'vertical', `id ${result.id}`);
    assert.equal(result.side, 'top', `id ${result.id}`);
    // Swap contract: the bar thickness (requested height) becomes the width, the notch length becomes the height.
    // The 1 px minimum applies to zero-size requests; the inner-area clamp always applies.
    assert.ok(result.width <= Math.max(1, cases[result.id].size.height) + EPS, `id ${result.id}: width exceeds bar thickness`);
    assert.ok(result.height <= Math.max(1, cases[result.id].size.width) + EPS, `id ${result.id}: height exceeds notch length`);
  }
});

test('V49: indicator layout is bounded (at most 4 weapon chips plus one overflow chip) and counts overflow exactly', { skip }, () => {
  for (const result of runBatch()) {
    assert.ok(result.visible <= 4, `id ${result.id}: visible chips ${result.visible}`);
    assert.ok(result.slots <= 5, `id ${result.id}: slots ${result.slots}`);
    assert.equal(result.visible + result.overflow, result.count, `id ${result.id}: count mismatch`);
    assert.equal(result.overflow, Math.max(0, result.count - 4), `id ${result.id}: overflow`);
    assert.equal(result.label, result.overflow > 0 ? '+' + result.overflow : '', `id ${result.id}: label`);
  }
});

test('V47/V48: the indicator axis follows the notch orientation (ONE row beside a horizontal notch, ONE column above a vertical one)', { skip }, () => {
  for (const result of runBatch()) {
    const edge = cases[result.id].edge;
    if (edge === 'center') continue;
    const vertical = edge === 'left' || edge === 'right';
    assert.equal(result.axis, vertical ? 'column' : 'row', `id ${result.id} ${edge}`);
  }
});

test('V49: the DPI-scaled 1536x816 work area (125%) keeps the default top notch centred and on-screen', { skip }, () => {
  const result = runBatch().find((r) => {
    const c = cases[r.id];
    return c.area.name.startsWith('1536x864') && c.edge === 'top' && c.size.width === 360 && c.size.height === 76 && c.offset === 0.5;
  });
  assert.ok(result, 'case present');
  assert.equal(result.left, 4 + (1536 - 8 - 360) / 2);
  assert.equal(result.top, 4);
});

test('V49: the bottom notch sits above the taskbar edge with the same margin as the top', { skip }, () => {
  const result = runBatch().find((r) => {
    const c = cases[r.id];
    return c.area.name.startsWith('1920x1080') && c.edge === 'bottom' && c.size.width === 360 && c.size.height === 76 && c.offset === 0;
  });
  assert.ok(result, 'case present');
  assert.equal(result.top + result.height, 1040 - 4);
  assert.equal(result.left, 4);
});

test('Visual layer routes every edge through Get-BunnyPlacement and keeps the window title unchanged', () => {
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /Get-BunnyPlacement -Edge \$edge/);
  assert.match(visual, /\$edge=ConvertTo-BunnyEdge \$bunnyPreferences\.edge/);
  const island = readFileSync(join(root, 'install', 'Bunny-Island.ps1'), 'utf8');
  assert.match(island, /Title="Bunny Island"/);
});

test('V47/V48: the vertical size is swapped before placement (length along the edge, thickness across it)', () => {
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /\$size=if\(\$vertical\)\{@\{Width=\$height;Height=\$width\}\}else\{@\{Width=\$width;Height=\$height\}\}/);
  // Expanded and collapsed vertical notches are sized by the same Resize-Bunny path, not a second layout.
  assert.match(visual, /function Resize-Bunny \{[\s\S]*?\$height=\[Math\]::Min\(\$bunnyVisualRoot\.DesiredSize\.Height,\$area\.Height-12\)/);
});

test('Settings offers Top, Bottom, Left and Right, and the choice is persisted under the edge key', () => {
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /Add-BunnyChoice \$edgeChoice @\(@\('top','Top'\),@\('bottom','Bottom'\),@\('left','Left'\),@\('right','Right'\)\) 'edge'/);
  assert.match(visual, /edge='top'; edgeOffset=0\.5/);
  assert.match(visual, /Add-BunnyChoice[\s\S]*\$bunnyPreferences\[\$this\.Tag\]=\$this\.SelectedItem\.Tag;Save-BunnyPreferences/);
});

test('display-settings and DPI changes re-fit the notch through Resize-Bunny (size clamp and placement), not only the position', () => {
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /BeginInvoke\(\[Action\]\{Resize-Bunny\}\)/);
  assert.match(visual, /Add_DpiChanged\(\{Resize-Bunny\}\)/);
});

test('the indicator rule is shared: Visual asks Get-BunnyIndicatorLayout for the side and axis, never a second rule', () => {
  const visual = readFileSync(visualPath, 'utf8');
  const weapons = readFileSync(join(root, 'install', 'Bunny-Island.Weapons.ps1'), 'utf8');
  assert.match(visual, /function Get-BunnyIndicatorState[\s\S]*?Get-BunnyIndicatorLayout -Placement \$probe/);
  assert.match(visual, /\$bunnyVisualRoot\.Orientation=if\(\$layout\.Side -eq 'top'\)/);
  assert.match(visual, /\$bunnyControls\.AgentStrip\.Orientation=if\(\$layout\.Axis -eq 'row'\)\{'Horizontal'\}else\{'Vertical'\}/);
  // One container for every weapon (no two-wide grouping): the chips are added to the strip directly, in slot order.
  assert.doesNotMatch(weapons, /\$groupOrientation|\$group\.Children|\$start \+= 2/);
  assert.match(weapons, /foreach \(\$item in \$items\) \{ \[void\]\$strip\.Children\.Add\(\$item\) \}/);
});

test('no random value anywhere in the Island layer (placement, indicators and layout are deterministic)', () => {
  for (const name of readdirSync(join(root, 'install')).filter((n) => /^Bunny-Island.*\.ps1$/.test(n))) {
    assert.doesNotMatch(readFileSync(join(root, 'install', name), 'utf8'), /Get-Random|System\.Random/, name);
  }
});

// --- MA5-S2 Sprint 2: notch persistence (restart restore + preference loading + save wiring) ---

// One extra rules batch: monitor restore (Select-BunnyMonitor), the preference load rule
// (Import-BunnyPreferences) placed through Set-BunnyPosition's exact composition, and work-area
// fingerprint stability. All pure rules, so the same dot-source + JSON runner pattern applies.
const rulesRunnerSource = `param([string]$Placement, [string]$Cases, [string]$Out)
. $Placement
$items = Get-Content -LiteralPath $Cases -Raw | ConvertFrom-Json
$results = foreach ($c in $items) {
  $kind = [string]$c.kind
  if ($kind -eq 'monitor') {
    $list = @()
    foreach ($m in $c.monitors) {
      $wa = @{ Left = [double]$m.left; Top = [double]$m.top; Width = [double]$m.width; Height = [double]$m.height }
      $list += @{ Device = [string]$m.device; WorkArea = $wa; Primary = [bool]$m.primary }
    }
    $saved = $null
    if ($null -ne $c.saved) { $saved = @{ device = [string]$c.saved.device; fingerprint = [string]$c.saved.fingerprint } }
    $chosen = Select-BunnyMonitor -Saved $saved -Monitors $list
    $deviceOut = ''
    $primaryOut = $false
    $printOut = ''
    if ($null -ne $chosen) {
      $deviceOut = [string]$chosen.Device
      $primaryOut = [bool]$chosen.Primary
      $printOut = Get-BunnyWorkAreaFingerprint $chosen.WorkArea
    }
    [pscustomobject]@{ id = $c.id; kind = $kind; device = $deviceOut; primary = $primaryOut; fingerprint = $printOut }
  }
  elseif ($kind -eq 'load') {
    # The Island's defaults, then the saved file through the same rules the Island runs at startup:
    # Import-BunnyPreferences (only known keys, corrupt file tolerated), then Set-BunnyPosition's
    # exact composition (position left/right override, ConvertTo-BunnyEdge, Get-BunnyPlacement).
    $defaults = @{ size = 'compact'; position = 'center'; idle = 'providers'; glass = 'medium'; motion = 'full'; collapse = 10; theme = 'dark'; primary = @('codex', 'claude', 'ollama'); edge = 'top'; edgeOffset = 0.5; blur = 'off'; monitor = $null }
    $table = @{}
    foreach ($p in $defaults.GetEnumerator()) { $table[$p.Key] = $p.Value }
    $applied = 0
    $failed = $false
    try { $applied = Import-BunnyPreferences -Table $table -SavedJson ([string]$c.savedJson) -KnownKeys (Get-BunnyPreferenceKeys) } catch { $failed = $true }
    $edge = ConvertTo-BunnyEdge $table.edge
    $offset = switch ([string]$table.position) { 'left' { 0.0 } 'right' { 1.0 } default { $table.edgeOffset } }
    $area = @{ Left = [double]$c.area.left; Top = [double]$c.area.top; Width = [double]$c.area.width; Height = [double]$c.area.height }
    $size = @{ Width = [double]$c.size.width; Height = [double]$c.size.height }
    $p = Get-BunnyPlacement -Edge $edge -WorkArea $area -Size $size -Offset $offset
    # The reference is the direct placement from the UNserialized values, proving the JSON round trip lost nothing.
    $refEdge = ConvertTo-BunnyEdge $c.reference.edge
    $refOffset = switch ([string]$c.reference.position) { 'left' { 0.0 } 'right' { 1.0 } default { $c.reference.edgeOffset } }
    $ref = Get-BunnyPlacement -Edge $refEdge -WorkArea $area -Size $size -Offset $refOffset
    [pscustomobject]@{ id = $c.id; kind = $kind
      applied = $applied; failed = $failed
      tableEdge = $edge; tablePosition = [string]$table.position
      left = $p.Left; top = $p.Top; width = $p.Width; height = $p.Height
      refLeft = $ref.Left; refTop = $ref.Top; refWidth = $ref.Width; refHeight = $ref.Height
      refEdge = $ref.Edge }
  }
  elseif ($kind -eq 'fingerprint') {
    $a = @{ Left = [double]$c.a.left; Top = [double]$c.a.top; Width = [double]$c.a.width; Height = [double]$c.a.height }
    $b = @{ Left = [double]$c.b.left; Top = [double]$c.b.top; Width = [double]$c.b.width; Height = [double]$c.b.height }
    [pscustomobject]@{ id = $c.id; kind = $kind; printA = (Get-BunnyWorkAreaFingerprint $a); printB = (Get-BunnyWorkAreaFingerprint $b) }
  }
}
[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject @($results) -Depth 4 -Compress), [Text.UTF8Encoding]::new($false))
`;

function buildRulesCases() {
  const cases = [];
  let n = 0;
  // Restore matrix: saved monitor configs against candidate monitor lists. The primary work area is the
  // 1920x1040 DIP one; a secondary sits at -1920 (negative coordinates of a left-side display).
  const primaryArea = { left: 0, top: 0, width: 1920, height: 1040 };
  const secondaryArea = { left: -1920, top: 0, width: 2560, height: 1400 };
  const dpiChangedArea = { left: 0, top: 0, width: 1536, height: 816 };
  const saved = (device, area) => ({ device, fingerprint: [area.left, area.top, area.width, area.height].join(',') });
  const monitorList = (entries) => entries.map(([device, area, primary]) => ({ device, left: area.left, top: area.top, width: area.width, height: area.height, primary }));
  const onPrimary = monitorList([['\\\\.\\DISPLAY1', primaryArea, true]]);
  const twoMonitors = monitorList([
    ['\\\\.\\DISPLAY1', primaryArea, true],
    ['\\\\.\\DISPLAY2', secondaryArea, false],
  ]);
  const push = (expect) => {
    cases.push({ id: n++, kind: 'monitor', ...expect });
  };
  // Exact match on the primary, exact match on a secondary (the notch restores where it was docked),
  // fingerprint changed (resolution/DPI), device gone, no monitor at all.
  push({ saved: saved('\\\\.\\DISPLAY1', primaryArea), monitors: onPrimary, want: '\\\\.\\DISPLAY1', primary: true });
  push({ saved: saved('\\\\.\\DISPLAY2', secondaryArea), monitors: twoMonitors, want: '\\\\.\\DISPLAY2', primary: false });
  push({ saved: saved('\\\\.\\DISPLAY1', primaryArea), monitors: monitorList([['\\\\.\\DISPLAY1', dpiChangedArea, true]]), want: '\\\\.\\DISPLAY1', primary: true, note: 'fingerprint changed -> fallback still primary' });
  push({ saved: saved('\\\\.\\DISPLAY3', secondaryArea), monitors: twoMonitors, want: '\\\\.\\DISPLAY1', primary: true, note: 'device gone -> primary' });
  push({ saved: null, monitors: twoMonitors, want: '\\\\.\\DISPLAY1', primary: true });
  push({ saved: saved('\\\\.\\DISPLAY1', primaryArea), monitors: [], want: '', primary: false, note: 'no monitors -> null' });
  push({ saved: saved('\\\\.\\DISPLAY1', dpiChangedArea), monitors: monitorList([['\\\\.\\DISPLAY1', dpiChangedArea, true], ['\\\\.\\DISPLAY2', secondaryArea, false]]), want: '\\\\.\\DISPLAY1', primary: true });
  // Preference round trip through the file format the Island itself writes (dock release shape).
  const area = primaryArea;
  const size = { width: 360, height: 76 };
  const savedShape = (edge, edgeOffset, position) => JSON.stringify({ size: 'compact', position, idle: 'providers', glass: 'medium', motion: 'full', collapse: 10, theme: 'dark', primary: ['codex', 'claude', 'ollama'], edge, edgeOffset, blur: 'off', monitor: { device: '\\\\.\\DISPLAY1', fingerprint: [area.left, area.top, area.width, area.height].join(',') } });
  for (const edge of edges) {
    for (const [edgeOffset, position] of [[0.25, 'center'], [0.75, 'center'], [0.5, 'left'], [0.5, 'right']]) {
      cases.push({
        id: n++, kind: 'load', area,
        size,
        savedJson: savedShape(edge, edgeOffset, position),
        reference: { edge, edgeOffset, position },
      });
    }
  }
  // Unsafe files: corrupt JSON keeps defaults; unknown keys are skipped; hostile values are validated
  // at placement time (edge normalises to top, offset falls back to 0.5).
  cases.push({ id: n++, kind: 'load', area, size, savedJson: 'not-json-at-all {{{', reference: { edge: 'top', edgeOffset: 0.5, position: 'center' }, expectApplied: 0, expectDefaultOnly: true });
  cases.push({
    id: n++, kind: 'load', area, size,
    savedJson: JSON.stringify({ edge: 'diagonal', edgeOffset: 'not-a-number', fancy: 'x' }),
    reference: { edge: 'top', edgeOffset: 0.5, position: 'center' },
    expectApplied: 2, expectDefaultOnly: true,
  });
  cases.push({
    id: n++, kind: 'load', area, size,
    savedJson: JSON.stringify({ edge: 'left', edgeOffset: '0.2', position: 'center' }),
    reference: { edge: 'left', edgeOffset: 0.2, position: 'center' },
  });
  // Fingerprint stability (Get-BunnyWorkAreaFingerprint rounds each DIP coordinate): drift smaller than half a
  // DIP cell must keep the key, and every real geometry change (resolution, DPI, another display) must break it.
  cases.push({ id: n++, kind: 'fingerprint', a: { left: 100.2, top: 10.3, width: 1920.1, height: 1040.2 }, b: { left: 100.4, top: 10.1, width: 1920.3, height: 1040.4 }, same: true });
  cases.push({ id: n++, kind: 'fingerprint', a: primaryArea, b: dpiChangedArea, same: false });
  cases.push({ id: n++, kind: 'fingerprint', a: primaryArea, b: secondaryArea, same: false });
  return cases;
}

let rulesPlacements = null;
let rulesCases = null;

function runRulesBatch() {
  if (rulesPlacements) return rulesPlacements;
  const dir = mkdtempSync(join(tmpdir(), 'island-persist-'));
  try {
    rulesCases = buildRulesCases();
    const casesPath = join(dir, 'rules-cases.json');
    const runnerPath = join(dir, 'rules-runner.ps1');
    const outPath = join(dir, 'rules-out.json');
    writeFileSync(casesPath, JSON.stringify(rulesCases));
    writeFileSync(runnerPath, rulesRunnerSource, 'utf8');
    const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', runnerPath, '-Placement', placementPath, '-Cases', casesPath, '-Out', outPath], { encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, 'powershell persistence rules run failed: ' + (run.stderr || run.stdout));
    rulesPlacements = JSON.parse(readFileSync(outPath, 'utf8').replace(/^\uFEFF/, ''));
    assert.equal(rulesPlacements.length, rulesCases.length);
    return rulesPlacements;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('Sprint 2: Select-BunnyMonitor restore matrix — matched device with the same work-area fingerprint is chosen, a DPI/resolution change or a detached display falls back to the primary, and an empty list returns no monitor at all', { skip }, () => {
  const results = runRulesBatch();
  for (const result of results) {
    if (result.kind !== 'monitor') continue;
    const c = rulesCases[result.id];
    const label = 'monitor case ' + result.id + (c.note ? ' (' + c.note + ')' : '');
    assert.equal(result.device, c.want, label);
    if (result.device === '') {
      assert.equal(result.primary, false, label + ': an empty monitor list returns no monitor');
      assert.equal(result.fingerprint, '', label + ': an empty monitor list has no fingerprint');
    } else {
      assert.equal(result.primary, c.primary, label + ': primary flag matches the chosen entry');
      assert.ok(result.fingerprint.length > 0, label + ': chosen fingerprint computed');
    }
  }
});

test('Sprint 2: preferences saved by a dock release (edge, along-edge offset, position, monitor) reload through the startup load rule and place the notch at the identical footprint', { skip }, () => {
  const results = runRulesBatch();
  for (const result of results) {
    if (result.kind !== 'load') continue;
    const c = rulesCases[result.id];
    const label = 'load case ' + result.id + ' edge=' + c.reference.edge + ' position=' + c.reference.position;
    if (c.expectApplied !== undefined) {
      assert.equal(result.applied, c.expectApplied, label + ': applied-key count');
      assert.equal(result.failed, false, label + ': the load rule never throws to its caller');
      assert.equal(result.tableEdge, 'top', label + ': unsafe input falls back to the normalised placement edge');
    } else {
      assert.ok(result.applied >= 2, label + ': edge and offset keys applied');
      assert.equal(result.failed, false, label + ': the load rule never throws to its caller');
    }
    for (const key of ['left', 'top', 'width', 'height']) {
      assert.equal(Math.abs(result[key] - result['ref' + key.charAt(0).toUpperCase() + key.slice(1)]), 0, label + ': ' + key + ' identical to the direct placement');
    }
  }
});

test('Sprint 2: the saved monitor footprint lies inside the chosen work area after restore (placement recomputed from the loaded values stays in the primary when the display changes)', { skip }, () => {
  const results = runRulesBatch();
  for (const result of results) {
    if (result.kind !== 'load') continue;
    const c = rulesCases[result.id];
    const label = 'load case ' + result.id;
    assert.ok(result.top >= c.area.top - EPS, label + ': top of the work area');
    assert.ok(result.left >= c.area.left - EPS, label + ': left of the work area');
    assert.ok(result.left + result.width <= c.area.left + c.area.width + EPS, label + ': right of the work area');
    assert.ok(result.top + result.height <= c.area.top + c.area.height + EPS, label + ': bottom of the work area');
  }
});

test('Sprint 2: a work-area fingerprint is stable for drift smaller than half a DIP cell (rounding) and distinguishes every real geometry change (resolution, DPI, another display)', { skip }, () => {
  const results = runRulesBatch();
  for (const result of results) {
    if (result.kind !== 'fingerprint') continue;
    const c = rulesCases[result.id];
    const label = 'fingerprint case ' + result.id;
    if (c.same) assert.equal(result.printA, result.printB, label + ': within-half-cell drift keeps the fingerprint');
    else assert.notEqual(result.printA, result.printB, label + ': a real geometry change breaks the fingerprint');
  }
});

test('Sprint 2 source lock: a drag release saves edge, along-edge offset, centre position and the monitor fingerprint through the Island save, and routes the snap through the tested nearest-edge rule', () => {
  const visual = readFileSync(visualPath, 'utf8');
  const start = visual.indexOf('function Invoke-BunnyDockRelease');
  assert.ok(start >= 0, 'Invoke-BunnyDockRelease present');
  const body = visual.slice(start, start + 1500);
  for (const fragment of [
    '$target=Get-BunnyNearestEdge',
    '$bunnyPreferences.edge=$target.Edge',
    '$bunnyPreferences.edgeOffset=$target.Offset',
    "$bunnyPreferences.position='center'",
    '$bunnyPreferences.monitor=@{device=',
    'Save-BunnyPreferences',
  ]) {
    assert.ok(body.includes(fragment), 'dock release missing: ' + fragment);
  }
});

test('Sprint 2 source lock: the keyboard chord body (Set-BunnyDockEdge) saves the edge through the same Island save as a drag release', () => {
  const visual = readFileSync(visualPath, 'utf8');
  const start = visual.indexOf('function Set-BunnyDockEdge');
  assert.ok(start >= 0, 'Set-BunnyDockEdge present');
  const body = visual.slice(start, start + 300);
  assert.ok(body.includes('$bunnyPreferences.edge=ConvertTo-BunnyEdge $Edge'), 'keyboard dock normalises the edge');
  assert.ok(body.includes("$bunnyPreferences.position='center'"), 'keyboard dock re-centres');
  assert.ok(body.includes('Save-BunnyPreferences'), 'keyboard dock saves');
  for (const edgeKey of ['Up', 'Down', 'Left', 'Right']) {
    assert.match(visual, new RegExp("'" + edgeKey + "'\\{'(top|bottom|left|right)'\\}"), 'chord maps ' + edgeKey);
  }
  assert.match(visual, /Set-BunnyDockEdge \$edge;return \$true/, 'the chord path ends in the saving body, never a fallback');
});

test('Sprint 2 source lock: startup applies only known preference keys (extracted Import-BunnyPreferences behind a file-existence guard; corrupt files never break the show; unknown keys ignored)', () => {
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /try \{ if \(Test-Path -LiteralPath \$bunnyPreferencePath\) \{ Import-BunnyPreferences -Table \$bunnyPreferences -SavedJson \(Get-Content -LiteralPath \$bunnyPreferencePath -Raw\) -KnownKeys \(Get-BunnyPreferenceKeys\) \} \} catch \{ \}/);
  assert.doesNotMatch(visual, /\$bunnyPreferences\.ContainsKey\(\$property\.Name\)/, 'the inline load loop is retired, not duplicated');
  const placement = readFileSync(placementPath, 'utf8');
  assert.match(placement, /function Get-BunnyPreferenceKeys \{ return \$script:BunnyPreferenceKeys \}/);
  assert.match(placement, /function Import-BunnyPreferences \{[\s\S]{0,900}?\$keys -contains \$property\.Name[\s\S]{0,200}?\$Table\.ContainsKey[\s\S]{0,300}?\$Table\[\$property\.Name\] = \$property\.Value/);
  assert.match(placement, /function Import-BunnyPreferences \{[\s\S]{0,1400}?return 0/, 'the load rule reports zero on unreadable input');
});
