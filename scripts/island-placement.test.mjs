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
    placements = JSON.parse(readFileSync(outPath, 'utf8').replace(/^﻿/, ''));
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

test('V49: indicator layout is bounded (at most 3 chips plus one overflow chip) and counts overflow exactly', { skip }, () => {
  for (const result of runBatch()) {
    assert.ok(result.visible <= 3, `id ${result.id}: visible chips ${result.visible}`);
    assert.ok(result.slots <= 4, `id ${result.id}: slots ${result.slots}`);
    assert.equal(result.visible + result.overflow, result.count, `id ${result.id}: count mismatch`);
    assert.equal(result.overflow, Math.max(0, result.count - 3), `id ${result.id}: overflow`);
    assert.equal(result.label, result.overflow > 0 ? '+' + result.overflow : '', `id ${result.id}: label`);
  }
});

test('V47/V48: the indicator axis follows the notch orientation (a column beside a horizontal notch, a row above a vertical one)', { skip }, () => {
  for (const result of runBatch()) {
    const edge = cases[result.id].edge;
    if (edge === 'center') continue;
    const vertical = edge === 'left' || edge === 'right';
    assert.equal(result.axis, vertical ? 'row' : 'column', `id ${result.id} ${edge}`);
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
  const presentation = readFileSync(join(root, 'install', 'Bunny-Island.Presentation.ps1'), 'utf8');
  assert.match(visual, /function Get-BunnyIndicatorState[\s\S]*?Get-BunnyIndicatorLayout -Placement \$probe/);
  assert.match(visual, /\$bunnyVisualRoot\.Orientation=if\(\$layout\.Side -eq 'top'\)/);
  assert.match(visual, /\$bunnyControls\.AgentStrip\.Orientation=if\(\$layout\.Axis -eq 'row'\)/);
  assert.match(presentation, /for \(\$index = 0; \$index -lt \$layout\.Visible; \$index\+\+\)/);
  assert.match(presentation, /if \(\$layout\.Overflow -gt 0\)/);
});

test('no random value anywhere in the Island layer (placement, indicators and layout are deterministic)', () => {
  for (const name of readdirSync(join(root, 'install')).filter((n) => /^Bunny-Island.*\.ps1$/.test(n))) {
    assert.doesNotMatch(readFileSync(join(root, 'install', name), 'utf8'), /Get-Random|System\.Random/, name);
  }
});
