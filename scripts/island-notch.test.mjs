// M-A-3 T13: native Notch rules. Docking geometry (drag-to-dock, DPI, monitors), companion expression, Personal Agent
// strip, weapon motion and the character art contract. Windows only: the pure rules run in Windows PowerShell 5.1 by
// dot-sourcing install/Bunny-Island.Placement.ps1 and install/Bunny-Island.Characters.ps1. All cases run in ONE
// powershell.exe invocation (JSON in, JSON out). The static checks read the sources and the packaged art.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const install = join(root, 'install');
const placementPath = join(install, 'Bunny-Island.Placement.ps1');
const charactersPath = join(install, 'Bunny-Island.Characters.ps1');
const weaponsPath = join(install, 'Bunny-Island.Weapons.ps1');
const companionPath = join(install, 'Bunny-Island.Companion.ps1');
const visualPath = join(install, 'Bunny-Island.Visual.ps1');
const packagePath = join(root, 'scripts', 'package-bunny-desktop.ps1');
const artDir = join(root, 'public', 'bunny-a', 'characters');
const skip = process.platform === 'win32' ? false : 'Island notch rules are a Windows PowerShell surface';

// One ordered list of named calls. Each case names a function and its positional arguments.
const primary = { Left: 0, Top: 0, Width: 1920, Height: 1040 };
const secondaryLeft = { Left: -1920, Top: 0, Width: 1920, Height: 1040 };
const monitors = [
  { Device: '\\\\.\\DISPLAY1', WorkArea: primary, Primary: true },
  { Device: '\\\\.\\DISPLAY2', WorkArea: secondaryLeft, Primary: false },
];
const SIZE = { Width: 360, Height: 76 };
const now = 1_000_000;
const snap = (over = {}) => ({ protocol: 'bunny-voice/1', open: true, state: 'IDLE', capturing: false, playing: false, muted: false, outputHeld: false, level: null, proposal: null, clarification: null, error: null, lastBargeIn: null, lastInterrupt: null, timing: null, duplex: null, devices: { micPrivacy: 'allow' }, ...over });

const cases = [
  // DPI: device pixels to DIPs at 125% and 150%, and a secondary monitor left of the primary (negative coordinates).
  { name: 'dpi125', fn: 'Convert-BunnyDeviceRect', args: [{ Left: 0, Top: 0, Width: 2400, Height: 1300 }, 1.25, 1.25] },
  { name: 'dpi150', fn: 'Convert-BunnyDeviceRect', args: [{ Left: 0, Top: 0, Width: 2560, Height: 1400 }, 1.5, 1.5] },
  { name: 'dpiSecondaryLeft125', fn: 'Convert-BunnyDeviceRect', args: [{ Left: -2400, Top: 0, Width: 2400, Height: 1300 }, 1.25, 1.25] },
  { name: 'fingerprint', fn: 'Get-BunnyWorkAreaFingerprint', args: [{ Left: -1919.6, Top: 0.2, Width: 1920, Height: 1040 }] },
  // Nearest edge: each edge, the 125% work area, a secondary monitor left of primary, taskbars on the left and top.
  { name: 'edgeTop', fn: 'Get-BunnyNearestEdge', args: [{ X: 960, Y: 3 }, primary, SIZE] },
  { name: 'edgeBottom', fn: 'Get-BunnyNearestEdge', args: [{ X: 960, Y: 1036 }, primary, SIZE] },
  { name: 'edgeLeft', fn: 'Get-BunnyNearestEdge', args: [{ X: 2, Y: 500 }, primary, SIZE] },
  { name: 'edgeRight', fn: 'Get-BunnyNearestEdge', args: [{ X: 1917, Y: 500 }, primary, SIZE] },
  { name: 'edgeTopOffsetCentred', fn: 'Get-BunnyNearestEdge', args: [{ X: 960, Y: 3 }, primary, SIZE] },
  { name: 'edgeSecondaryRight', fn: 'Get-BunnyNearestEdge', args: [{ X: -5, Y: 500 }, secondaryLeft, SIZE] },
  { name: 'edgeSecondaryLeft', fn: 'Get-BunnyNearestEdge', args: [{ X: -1915, Y: 500 }, secondaryLeft, SIZE] },
  { name: 'edgeTaskbarLeft', fn: 'Get-BunnyNearestEdge', args: [{ X: 74, Y: 500 }, { Left: 72, Top: 0, Width: 1848, Height: 1040 }, SIZE] },
  { name: 'edgeTaskbarTop', fn: 'Get-BunnyNearestEdge', args: [{ X: 960, Y: 50 }, { Left: 0, Top: 48, Width: 1920, Height: 992 }, SIZE] },
  { name: 'edgeCornerTie', fn: 'Get-BunnyNearestEdge', args: [{ X: 0, Y: 0 }, primary, SIZE] },
  { name: 'edgeOffsetClampedHigh', fn: 'Get-BunnyNearestEdge', args: [{ X: 1900, Y: 3 }, primary, SIZE] },
  { name: 'edgeOffsetClampedLow', fn: 'Get-BunnyNearestEdge', args: [{ X: -40, Y: 3 }, primary, SIZE] },
  // Placement after a drag: every edge, on every monitor and DPI work area, stays inside the work area.
  { name: 'placeTopSecondary', fn: 'Get-BunnyPlacement', args: ['top', secondaryLeft, SIZE, 1] },
  { name: 'placeRightSecondary', fn: 'Get-BunnyPlacement', args: ['right', secondaryLeft, { Width: 360, Height: 76 }, 1] },
  { name: 'placeLeftPrimary150', fn: 'Get-BunnyPlacement', args: ['left', { Left: 0, Top: 0, Width: 1707, Height: 920 }, { Width: 540, Height: 100 }, 0] },
  { name: 'placeBottomPrimary125', fn: 'Get-BunnyPlacement', args: ['bottom', { Left: 0, Top: 0, Width: 1536, Height: 816 }, { Width: 384, Height: 76 }, 0.5] },
  { name: 'expandTop', fn: 'Get-BunnyExpandDirection', args: ['top'] },
  { name: 'expandBottom', fn: 'Get-BunnyExpandDirection', args: ['bottom'] },
  { name: 'expandLeft', fn: 'Get-BunnyExpandDirection', args: ['left'] },
  { name: 'expandRight', fn: 'Get-BunnyExpandDirection', args: ['right'] },
  { name: 'expandUnknown', fn: 'Get-BunnyExpandDirection', args: ['center'] },
  { name: 'insideSecondary', fn: 'Test-BunnyRectInside', args: [{ Left: -1900, Top: 4, Width: 300, Height: 76 }, secondaryLeft] },
  { name: 'outsideSecondary', fn: 'Test-BunnyRectInside', args: [{ Left: 10, Top: 4, Width: 300, Height: 76 }, secondaryLeft] },
  // Restore: the saved monitor must exist with the same device name and the same geometry, else the primary.
  { name: 'restoreSaved', fn: 'Select-BunnyMonitor', args: [{ device: '\\\\.\\DISPLAY2', fingerprint: '-1920,0,1920,1040' }, monitors] },
  { name: 'restoreGeometryChanged', fn: 'Select-BunnyMonitor', args: [{ device: '\\\\.\\DISPLAY2', fingerprint: '-1920,0,1600,900' }, monitors] },
  { name: 'restoreMonitorRemoved', fn: 'Select-BunnyMonitor', args: [{ device: '\\\\.\\DISPLAY9', fingerprint: '-1920,0,1920,1040' }, monitors] },
  { name: 'restoreNothingSaved', fn: 'Select-BunnyMonitor', args: [null, monitors] },
  { name: 'restoreNoPrimaryFlag', fn: 'Select-BunnyMonitor', args: [null, [{ Device: 'A', WorkArea: primary, Primary: false }, { Device: 'B', WorkArea: secondaryLeft, Primary: false }]] },
  { name: 'restoreNoMonitors', fn: 'Select-BunnyMonitor', args: [null, []] },
  // Companion expression mirror (voice-companion.ts precedence).
  { name: 'compClosed', fn: 'Get-BunnyCompanionState', args: [snap({ open: false }), now] },
  { name: 'compWorkerExited', fn: 'Get-BunnyCompanionState', args: [snap({ error: { code: 'WORKER_EXITED' } }), now] },
  { name: 'compProposal', fn: 'Get-BunnyCompanionState', args: [snap({ proposal: { expiresAt: now + 1000 } }), now] },
  { name: 'compMuted', fn: 'Get-BunnyCompanionState', args: [snap({ muted: true }), now] },
  { name: 'compBothSpeaking', fn: 'Get-BunnyCompanionState', args: [snap({ capturing: true, playing: true }), now] },
  { name: 'compSpeaking', fn: 'Get-BunnyCompanionState', args: [snap({ playing: true }), now] },
  { name: 'compHeld', fn: 'Get-BunnyCompanionState', args: [snap({ outputHeld: true }), now] },
  { name: 'compRecentBarge', fn: 'Get-BunnyCompanionState', args: [snap({ lastBargeIn: { outcome: 'interrupted', decidedAt: now - 500 } }), now] },
  { name: 'compStaleBarge', fn: 'Get-BunnyCompanionState', args: [snap({ lastBargeIn: { outcome: 'interrupted', decidedAt: now - 3000 } }), now] },
  { name: 'compAdmitted', fn: 'Get-BunnyCompanionState', args: [snap({ state: 'PROCESSING', timing: { admittedAt: now - 10, firstTokenAt: null } }), now] },
  { name: 'compThinking', fn: 'Get-BunnyCompanionState', args: [snap({ state: 'PROCESSING', timing: { admittedAt: now - 10, firstTokenAt: now - 5 } }), now] },
  { name: 'compSpeakingLevel', fn: 'Get-BunnyCompanionState', args: [snap({ state: 'LISTENING', capturing: true, level: { speech: true, at: now - 100, rms: 0.4 } }), now] },
  { name: 'compIdle', fn: 'Get-BunnyCompanionState', args: [snap(), now] },
  { name: 'displayOffline', fn: 'Get-BunnyCompanionDisplay', args: [snap({ playing: true }), now, false, true, 0] },
  { name: 'displayStale', fn: 'Get-BunnyCompanionDisplay', args: [snap({ playing: true }), now, true, false, 0] },
  { name: 'displayHappy', fn: 'Get-BunnyCompanionDisplay', args: [snap(), now, true, true, now + 3000] },
  { name: 'displayHappyWhileSpeaking', fn: 'Get-BunnyCompanionDisplay', args: [snap({ playing: true }), now, true, true, now + 3000] },
  { name: 'displayHappyWhilePermission', fn: 'Get-BunnyCompanionDisplay', args: [snap({ proposal: { expiresAt: now + 1000 } }), now, true, true, now + 3000] },
  { name: 'displayHappyWhileMuted', fn: 'Get-BunnyCompanionDisplay', args: [snap({ muted: true }), now, true, true, now + 3000] },
  { name: 'displayHappyWhileError', fn: 'Get-BunnyCompanionDisplay', args: [snap({ error: { code: 'INTERNAL' } }), now, true, true, now + 3000] },
  { name: 'displayUnknown', fn: 'Get-BunnyCompanionDisplay', args: [null, now, true, true, now + 3000] },
  { name: 'displayHostHappyRefused', fn: 'Get-BunnyCompanionDisplay', args: [snap({ playing: true, companion: { state: 'HAPPY', reason: 'invalid' } }), now, true, true, 0] },
  { name: 'compFutureInterrupt', fn: 'Get-BunnyCompanionState', args: [snap({ lastInterrupt: { requestedAt: now + 10000 } }), now] },
  { name: 'compRecentBeforeFutureInterrupt', fn: 'Get-BunnyCompanionState', args: [snap({ lastBargeIn: { outcome: 'interrupted', decidedAt: now - 100 }, lastInterrupt: { requestedAt: now + 10000 } }), now] },
  { name: 'compEndpointMuted', fn: 'Get-BunnyCompanionState', args: [snap({ devices: { micPrivacy: 'allow', input: { muted: true } } }), now] },
  { name: 'displayHostState', fn: 'Get-BunnyCompanionDisplay', args: [snap({ companion: { state: 'THINKING', reason: 'Host says so' } }), now, true, true, 0] },
  { name: 'displayClosedNotStale', fn: 'Get-BunnyCompanionDisplay', args: [snap({ open: false }), now, true, false, 0] },
  // Weapon motion: the Host's presentation states map to a loop, a ring, a badge and at most one one-shot.
  { name: 'motionPlanning', fn: 'Get-BunnyWeaponMotion', args: ['PLANNING'] },
  { name: 'motionWaiting', fn: 'Get-BunnyWeaponMotion', args: ['WAITING'] },
  { name: 'motionNeedsUser', fn: 'Get-BunnyWeaponMotion', args: ['WAITING_FOR_USER'] },
  { name: 'motionVerified', fn: 'Get-BunnyWeaponMotion', args: ['VERIFIED'] },
  { name: 'motionFailed', fn: 'Get-BunnyWeaponMotion', args: ['FAILED'] },
  { name: 'motionPaused', fn: 'Get-BunnyWeaponMotion', args: ['PAUSED'] },
  { name: 'motionUnknown', fn: 'Get-BunnyWeaponMotion', args: ['UNKNOWN'] },
  { name: 'motionRecovering', fn: 'Get-BunnyWeaponMotion', args: ['RECOVERING'] },
  // Personal Agent strip: bound active slots in slot order, at most four; unbound and inactive slots never draw.
  { name: 'stripOrder', fn: 'Get-BunnyPersonalAgentStrip', args: [{
    unslottedAgents: 2,
    slots: [
      { slot: 3, weapon: 'chakra', agentId: 'ag3', active: true, presentation: { state: 'RESEARCHING' } },
      { slot: 1, weapon: 'gada', agentId: 'ag1', active: true, presentation: { state: 'CODING' } },
      { slot: 2, weapon: 'spear', agentId: null, active: true, presentation: { state: 'UNASSIGNED' } },
      { slot: 4, weapon: 'sword', agentId: 'ag4', active: false, presentation: { state: 'IDLE' } },
    ],
  }] },
  { name: 'stripCapFour', fn: 'Get-BunnyPersonalAgentStrip', args: [{
    unslottedAgents: 0,
    slots: [1, 2, 3, 4].map((slot) => ({ slot, weapon: 'gada', agentId: 'a' + slot, active: true, presentation: { state: 'IDLE' } })),
  }] },
  { name: 'stripNull', fn: 'Get-BunnyPersonalAgentStrip', args: [null] },
  // Verified transitions: a first observation only seeds the memory; an observed move into VERIFIED fires once.
  { name: 'verifiedSeed', fn: 'Get-BunnyVerifiedTransitions', args: [null, { slots: [{ slot: 1, presentation: { state: 'VERIFIED' } }] }] },
  { name: 'verifiedObserved', fn: 'Get-BunnyVerifiedTransitions', args: [{ '1': { State: 'CODING', AgentId: 'a' }, '2': { State: 'VERIFIED', AgentId: 'b' } }, { slots: [{ slot: 1, agentId: 'a', presentation: { state: 'VERIFIED' } }, { slot: 2, agentId: 'b', presentation: { state: 'VERIFIED' } }] }] },
  { name: 'verifiedNewSlot', fn: 'Get-BunnyVerifiedTransitions', args: [{ '1': { State: 'CODING', AgentId: 'a' } }, { slots: [{ slot: 2, agentId: 'b', presentation: { state: 'VERIFIED' } }] }] },
  { name: 'verifiedRebound', fn: 'Get-BunnyVerifiedTransitions', args: [{ '1': { State: 'CODING', AgentId: 'a' } }, { slots: [{ slot: 1, agentId: 'b', presentation: { state: 'VERIFIED' } }] }] },
  { name: 'verifiedOffline', fn: 'Get-BunnyVerifiedTransitions', args: [{ '1': { State: 'CODING', AgentId: 'a' } }, { slots: [{ slot: 1, agentId: 'a', presentation: { state: 'VERIFIED' } }] }, false] },
  { name: 'settledTransitions', fn: 'Get-BunnyObservedTransitions', args: [{ '1': { State: 'CODING', AgentId: 'a' }, '2': { State: 'CODING', AgentId: 'b' }, '3': { State: 'VERIFIED', AgentId: 'c' } }, { slots: [{ slot: 1, agentId: 'a', presentation: { state: 'FAILED' } }, { slot: 2, agentId: 'b', presentation: { state: 'COMPLETED' } }, { slot: 3, agentId: 'c', presentation: { state: 'COMPLETED' } }] }] },
  // T13.3 Gate H: character styles on native chips. Every weapon × style, the signature fallback, intensity and contrast.
  ...['gada', 'spear', 'chakra', 'sword'].flatMap((weapon) =>
    ['glossy', 'cel', 'arcade', 'comic', 'pixel'].map((style) => ({ name: `skin_${weapon}_${style}`, fn: 'Get-BunnyCharacterSkin', args: [weapon, { style, intensity: 'full', highContrast: false }, true, false] })),
  ),
  ...['gada', 'spear', 'chakra', 'sword'].map((weapon) => ({ name: `skinSignature_${weapon}`, fn: 'Get-BunnyCharacterSkin', args: [weapon, null, true, false] })),
  { name: 'skinUnknownStyle', fn: 'Get-BunnyCharacterSkin', args: ['sword', { style: 'vaporwave', intensity: 'turbo', highContrast: 'yes' }, true, false] },
  { name: 'skinSubtle', fn: 'Get-BunnyCharacterSkin', args: ['gada', { style: null, intensity: 'subtle', highContrast: false }, true, false] },
  { name: 'skinOff', fn: 'Get-BunnyCharacterSkin', args: ['gada', { style: null, intensity: 'off', highContrast: false }, true, false] },
  { name: 'skinIslandStill', fn: 'Get-BunnyCharacterSkin', args: ['gada', { style: 'arcade', intensity: 'full', highContrast: false }, false, false] },
  { name: 'skinAgentContrast', fn: 'Get-BunnyCharacterSkin', args: ['chakra', { style: 'arcade', intensity: 'full', highContrast: true }, true, false] },
  { name: 'skinSystemContrast', fn: 'Get-BunnyCharacterSkin', args: ['gada', null, true, true] },
  { name: 'appearanceRow', fn: 'Get-BunnySlotAppearance', args: [{ schema: 'bunny-a.character-appearance.v1', slots: [{ slot: 1, appearance: { style: 'pixel', intensity: 'full', highContrast: false } }, { slot: 2, appearance: { style: null, intensity: 'subtle', highContrast: false } }] }, 1] },
  { name: 'appearanceMissing', fn: 'Get-BunnySlotAppearance', args: [null, 1] },
  { name: 'roleGadaSpeaking', fn: 'Get-BunnyNotchRole', args: [1, 'IDLE', 1] },
  { name: 'roleSwordWorking', fn: 'Get-BunnyNotchRole', args: [4, 'CODING', 1] },
  { name: 'roleBunnySpeaking', fn: 'Get-BunnyNotchRole', args: [1, 'RESEARCHING', 'bunny'] },
  { name: 'roleNoContext', fn: 'Get-BunnyNotchRole', args: [1, 'IDLE', null] },
  { name: 'roleVerifiedNotWorking', fn: 'Get-BunnyNotchRole', args: [2, 'VERIFIED', 1] },
  // Character art: PNG width from the header (never decoded larger than need).
  { name: 'pngWidth', fn: 'Get-BunnyPngWidth', args: [join(artDir, 'gada.compact.png')] },
  { name: 'pngWidthNotPng', fn: 'Get-BunnyPngWidth', args: [charactersPath] },
  { name: 'pngHeight', fn: 'Get-BunnyPngHeight', args: [join(artDir, 'gada.compact.png')] },
  ...['gada', 'spear', 'chakra', 'sword'].map((weapon) => ({ name: `pixelWidth_${weapon}`, fn: 'Get-BunnyPixelDecodeWidth', args: [`${weapon}.compact`, 24] })),
  { name: 'pixelWidthBadId', fn: 'Get-BunnyPixelDecodeWidth', args: ['..\\secrets', 24] },
];

function runBatch() {
  const dir = mkdtempSync(join(tmpdir(), 'island-notch-'));
  try {
    const casesPath = join(dir, 'cases.json');
    const runnerPath = join(dir, 'runner.ps1');
    const outPath = join(dir, 'out.json');
    writeFileSync(casesPath, JSON.stringify(cases));
    writeFileSync(runnerPath, `param([string]$Install, [string]$Cases, [string]$Out)
. (Join-Path $Install 'Bunny-Island.Placement.ps1')
. (Join-Path $Install 'Bunny-Island.Characters.ps1')
$items = Get-Content -LiteralPath $Cases -Raw | ConvertFrom-Json
$results = foreach ($item in @($items)) {
  try { $callArgs = @($item.args); $value = & $item.fn @callArgs; $ok = $true } catch { $value = $_.Exception.Message; $ok = $false }
  [pscustomobject]@{ name = $item.name; ok = $ok; value = $value }
}
[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject @($results) -Depth 8 -Compress), [Text.UTF8Encoding]::new($false))
`, 'utf8');
    const run = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runnerPath, install, casesPath, outPath], { encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, 'powershell notch batch failed: ' + (run.stderr || run.stdout));
    const results = JSON.parse(readFileSync(outPath, 'utf8').replace(/^\uFEFF/, ''));
    return Object.fromEntries(results.map((row) => [row.name, row]));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

let batch = null;
function get(name) {
  if (!batch) batch = runBatch();
  const row = batch[name];
  assert.ok(row, `missing case ${name}`);
  assert.ok(row.ok, `${name} threw: ${row.value}`);
  return row.value;
}
const near = (actual, expected, tolerance = 0.01, label = '') => assert.ok(Math.abs(actual - expected) <= tolerance, `${label} ${actual} != ${expected}`);

test('DPI: device work areas convert to DIPs at 125% and 150%, and a secondary monitor left of primary keeps negative DIPs', { skip }, () => {
  const d125 = get('dpi125');
  near(d125.Width, 1920, 0.01, 'width 125%'); near(d125.Height, 1040, 0.01, 'height 125%');
  const d150 = get('dpi150');
  near(d150.Width, 1706.67, 0.01, 'width 150%'); near(d150.Height, 933.33, 0.01, 'height 150%');
  const left = get('dpiSecondaryLeft125');
  near(left.Left, -1920, 0.01, 'secondary left'); near(left.Width, 1920, 0.01, 'secondary width');
});

test('work-area fingerprint rounds to whole DIPs so a saved monitor matches again only when its geometry is unchanged', { skip }, () => {
  assert.equal(get('fingerprint'), '-1920,0,1920,1040');
});

test('drag-to-dock: the release point picks the nearest edge of the monitor under the pointer, for all four edges', { skip }, () => {
  assert.equal(get('edgeTop').Edge, 'top');
  assert.equal(get('edgeBottom').Edge, 'bottom');
  assert.equal(get('edgeLeft').Edge, 'left');
  assert.equal(get('edgeRight').Edge, 'right');
  near(get('edgeTop').Offset, 0.5, 0.01, 'centred offset');
  assert.ok(get('edgeLeft').Offset > 0 && get('edgeLeft').Offset < 1, 'left offset is along the edge');
});

test('drag-to-dock: a secondary monitor left of primary (negative coordinates) snaps to its own edges', { skip }, () => {
  assert.equal(get('edgeSecondaryRight').Edge, 'right', 'its right edge is at x = 0 on the primary boundary');
  assert.equal(get('edgeSecondaryLeft').Edge, 'left');
});

test('drag-to-dock: the taskbar on the left or the top moves the usable edge, and the snap follows the work area', { skip }, () => {
  assert.equal(get('edgeTaskbarLeft').Edge, 'left');
  assert.equal(get('edgeTaskbarTop').Edge, 'top');
});

test('drag-to-dock: a corner resolves to a single edge by the fixed tie order (top, bottom, left, right)', { skip }, () => {
  assert.equal(get('edgeCornerTie').Edge, 'top');
});

test('drag-to-dock: the offset is clamped to 0..1 when the pointer is past either end of the edge', { skip }, () => {
  assert.equal(get('edgeOffsetClampedHigh').Offset, 1);
  assert.equal(get('edgeOffsetClampedLow').Offset, 0);
});

test('placement after a drag stays wholly inside its work area for every edge, monitor and DPI', { skip }, () => {
  const areas = { placeTopSecondary: secondaryLeft, placeRightSecondary: secondaryLeft, placeLeftPrimary150: { Left: 0, Top: 0, Width: 1707, Height: 920 }, placeBottomPrimary125: { Left: 0, Top: 0, Width: 1536, Height: 816 } };
  for (const [name, area] of Object.entries(areas)) {
    const placement = get(name);
    assert.ok(placement.Left >= area.Left - 0.01 && placement.Top >= area.Top - 0.01, `${name} starts outside`);
    assert.ok(placement.Left + placement.Width <= area.Left + area.Width + 0.01, `${name} overflows right`);
    assert.ok(placement.Top + placement.Height <= area.Top + area.Height + 0.01, `${name} overflows bottom`);
  }
});

test('expansion direction is anchored to the dock edge: TOP down, BOTTOM up, LEFT right, RIGHT left', { skip }, () => {
  assert.equal(get('expandTop'), 'down');
  assert.equal(get('expandBottom'), 'up');
  assert.equal(get('expandLeft'), 'right');
  assert.equal(get('expandRight'), 'left');
  assert.equal(get('expandUnknown'), 'down', 'an unknown edge normalises to top, so it expands down');
});

test('the on-screen check accepts a rect inside a secondary monitor and rejects one that leaves it', { skip }, () => {
  assert.equal(get('insideSecondary'), true);
  assert.equal(get('outsideSecondary'), false);
});

test('restore: a saved monitor is used only when it still exists with the same geometry; otherwise the primary monitor', { skip }, () => {
  assert.equal(get('restoreSaved').Device, '\\\\.\\DISPLAY2');
  assert.equal(get('restoreGeometryChanged').Device, '\\\\.\\DISPLAY1', 'geometry changed falls back to primary');
  assert.equal(get('restoreMonitorRemoved').Device, '\\\\.\\DISPLAY1', 'a removed monitor falls back to primary');
  assert.equal(get('restoreNothingSaved').Device, '\\\\.\\DISPLAY1');
  assert.equal(get('restoreNoPrimaryFlag').Device, 'A', 'with no primary flag the first monitor is used');
  assert.equal(get('restoreNoMonitors'), null, 'no monitors means no target; the caller keeps the system work area');
});

test('companion mirror: the voice snapshot maps to the same expression as companionState() in voice-companion.ts', { skip }, () => {
  assert.equal(get('compClosed').State, 'SLEEPING');
  assert.equal(get('compWorkerExited').State, 'DISCONNECTED');
  assert.equal(get('compProposal').State, 'PERMISSION');
  assert.equal(get('compMuted').State, 'MUTED');
  assert.equal(get('compBothSpeaking').State, 'LISTENING_WHILE_SPEAKING');
  assert.equal(get('compSpeaking').State, 'SPEAKING');
  assert.equal(get('compHeld').State, 'HELD');
  assert.equal(get('compRecentBarge').State, 'INTERRUPTED');
  assert.equal(get('compStaleBarge').State, 'READY', 'a barge-in receipt older than 2.5 s no longer shows');
  assert.equal(get('compAdmitted').State, 'WAITING_FOR_RESPONSE');
  assert.equal(get('compThinking').State, 'THINKING');
  assert.equal(get('compSpeakingLevel').State, 'LISTENING');
  assert.equal(get('compIdle').State, 'READY');
});

test('companion display: Host offline or a stale voice poll shows DISCONNECTED; a fresh verified agent shows HAPPY; the Host state is used when sent', { skip }, () => {
  assert.equal(get('displayOffline').State, 'DISCONNECTED');
  assert.equal(get('displayStale').State, 'DISCONNECTED');
  assert.equal(get('displayHappy').State, 'HAPPY');
  assert.equal(get('displayHostState').State, 'THINKING');
  assert.equal(get('displayHostState').Reason, 'Host says so');
  assert.equal(get('displayClosedNotStale').State, 'SLEEPING', 'a closed session is not a stale poll');
  assert.equal(get('displayHappyWhileSpeaking').State, 'SPEAKING', 'celebration cannot hide worker-confirmed playback');
  assert.equal(get('displayHappyWhilePermission').State, 'PERMISSION', 'celebration cannot hide pending consent');
  assert.equal(get('displayHappyWhileMuted').State, 'MUTED');
  assert.equal(get('displayHappyWhileError').State, 'ERROR');
  assert.equal(get('displayUnknown').State, 'UNKNOWN', 'missing voice facts never claim a closed session or celebrate');
  assert.equal(get('displayHostHappyRefused').State, 'SPEAKING', 'only the client can originate a verified-result overlay');
  assert.equal(get('compFutureInterrupt').State, 'READY', 'a future receipt is not a current interruption');
  assert.equal(get('compRecentBeforeFutureInterrupt').State, 'INTERRUPTED', 'one future receipt cannot suppress the other valid receipt');
  assert.equal(get('compEndpointMuted').State, 'MUTED', 'endpoint mute is also authoritative');
});

test('weapon motion: planning loops, waiting slows, needs-you pulses amber and stops, verified and failed are one-shots', { skip }, () => {
  assert.equal(get('motionPlanning').Loop, 'base');
  assert.equal(get('motionPlanning').Task, 'planning');
  assert.equal(get('motionWaiting').Speed, 0.6);
  assert.equal(get('motionNeedsUser').Loop, 'static');
  assert.equal(get('motionNeedsUser').Ring, 'amber-pulse');
  assert.equal(get('motionVerified').OneShot, 'verified');
  assert.equal(get('motionVerified').Ring, 'green');
  assert.equal(get('motionFailed').OneShot, 'failed');
  assert.equal(get('motionFailed').Desaturate, true);
  assert.equal(get('motionPaused').Desaturate, true);
  assert.equal(get('motionUnknown').Loop, 'static', 'an unknown state never animates');
  assert.equal(get('motionUnknown').Ring, 'none');
  assert.equal(get('motionRecovering').Loop, 'dashed');
});

test('Personal Agent strip: bound active slots in slot order, at most four; unbound and inactive slots draw nothing', { skip }, () => {
  const strip = get('stripOrder');
  assert.deepEqual(strip.Slots.map((slot) => slot.slot), [1, 3]);
  assert.equal(strip.Unslotted, 2);
  assert.equal(get('stripCapFour').Slots.length, 4);
  assert.equal(get('stripNull').Slots.length, 0);
  assert.equal(get('stripNull').Unslotted, 0);
});

test('verified transitions: the first observation seeds and never celebrates; an observed move into VERIFIED fires once per slot', { skip }, () => {
  // An empty PowerShell array crosses the JSON boundary as an empty value, so an empty list is accepted in either shape.
  const empty = (value) => value == null || (Array.isArray(value) ? value.length === 0 : Object.keys(value).length === 0);
  assert.ok(empty(get('verifiedSeed')), 'the first observation fires nothing');
  // A single PowerShell output is a scalar, so a one-element list is normalised before the comparison.
  assert.deepEqual([].concat(get('verifiedObserved') ?? []), [1], 'slot 2 was already VERIFIED and does not fire again');
  assert.ok(empty(get('verifiedNewSlot')), 'a slot first seen as VERIFIED was not observed transitioning');
  assert.ok(empty(get('verifiedRebound')), 'rebinding to an already verified Agent is not new verification');
  assert.ok(empty(get('verifiedOffline')), 'offline retained state is not an observation');
  assert.deepEqual(get('settledTransitions').map(({ Slot, Kind }) => ({ Slot, Kind })), [{ Slot: 1, Kind: 'failed' }, { Slot: 2, Kind: 'completed' }], 'failed and unverified completion get their own cues; a verified downgrade never celebrates');
});

test('native real-level ring stops in reduced motion and rejects future or non-listening samples', () => {
  const source = readFileSync(companionPath, 'utf8');
  assert.match(source, /\$levelFresh = \[bool\]\(\$bunnyAnimate -and \$level -and \$levelAge -ge 0 -and \$levelAge -le 1000 -and \$state -in @\('ARMING', 'LISTENING', 'LISTENING_WHILE_SPEAKING'\)\)/);
  assert.match(source, /\$rms = if \(\$levelFresh\)/);
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(weapons, /\$script:bunnyWeaponPrevious = if \(\$bunnyOnline\) \{ @\{\} \} else \{ \$null \}/, 'an offline read clears transition memory before reconnect');
});

test('character art: the gada compact PNG is read at its real width from the header', { skip }, () => {
  assert.equal(get('pngWidth'), 34);
  assert.equal(get('pngWidthNotPng'), 0);
});

// ---- Static contracts over the sources and the packaged art ----------------------------------------------------------

const companionIds = ['bunny.sleeping', 'bunny.idle', 'bunny.listening', 'bunny.speaking', 'bunny.thinking', 'bunny.interrupted', 'bunny.processing', 'bunny.happy'];
const weaponIds = ['gada.compact', 'gada.hero', 'spear.compact', 'spear.hero', 'chakra.compact', 'chakra.hero', 'sword.compact', 'sword.hero'];

test('every character id the Island draws exists as a runtime PNG under public/bunny-a/characters', () => {
  for (const id of [...companionIds, ...weaponIds]) assert.ok(existsSync(join(artDir, id + '.png')), id);
  const characterSource = readFileSync(charactersPath, 'utf8');
  for (const id of companionIds) assert.match(characterSource, new RegExp("Id = '" + id.replace('.', '\\.') + "'"), `companion table maps ${id}`);
  assert.ok(readdirSync(artDir).filter((name) => name.endsWith('.png')).length >= 39, 'the board set ships whole');
});

test('the package lists every character PNG under characters\\ unconditionally, and the new Island modules', () => {
  const pack = readFileSync(packagePath, 'utf8');
  assert.match(pack, /Get-ChildItem -LiteralPath \$characterSource -Filter '\*\.png' -File/);
  assert.match(pack, /Add-PackageFile \$item\.FullName \('characters\/'\+\$item\.Name\)/);
  assert.match(pack, /throw 'Bunny character art is missing from the build\.'/);
  for (const name of ['Bunny-Island.Characters.ps1', 'Bunny-Island.Companion.ps1', 'Bunny-Island.Weapons.ps1']) assert.match(pack, new RegExp("'" + name.replace(/\./g, '\\.') + "'"), name);
});

test('the Island resolves art from the release folder first, then the development public folder', () => {
  const characters = readFileSync(charactersPath, 'utf8');
  assert.match(characters, /Join-Path \$PSScriptRoot 'characters'/);
  assert.match(characters, /public\\bunny-a\\characters/);
  assert.match(characters, /\$bitmap\.CacheOption = \[Windows\.Media\.Imaging\.BitmapCacheOption\]::OnLoad/);
  assert.match(characters, /\$bitmap\.Freeze\(\)/);
  assert.match(characters, /if \(\(Get-BunnyPngWidth \$path\) -gt \$Width\) \{ \$bitmap\.DecodePixelWidth = \$Width \}/);
});

test('motion in the strip and the companion uses transforms and opacity only: no layout property is animated', () => {
  for (const file of [weaponsPath, companionPath]) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /(WidthProperty|HeightProperty|MarginProperty|LeftProperty|TopProperty)/, file);
    assert.doesNotMatch(source, /DispatcherTimer/, file + ' has no timer-driven animation');
    assert.doesNotMatch(source, /Get-Random|System\.Random/, file);
  }
});

test('one-shots and loops only start on a state change: the strip keys each loop and never restarts it on a plain poll', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(weapons, /if \(\$key -ne \$tag\.Key\) \{ \$tag\.Key = \$key; Start-BunnyWeaponMotion \$Chip \$base \$motion \$skin \}/);
  // T13.3 Gate H: the key adds only the style, its intensity switch and amplitude, so a plain poll still never restarts a loop.
  assert.match(weapons, /\$key = \(@\(\$weapon, \$state, \$motion\.Loop, \$motion\.Task, \$motion\.Ring, \[string\]\$motion\.Speed, \[string\]\$bunnyAnimate, \$skin\.Style, \[string\]\$skin\.Animate, \[string\]\$skin\.Amplitude\) -join '\|'\)/);
  const companion = readFileSync(companionPath, 'utf8');
  assert.match(companion, /if \(\$key -ne \$script:bunnyCompanionKey\) \{ \$script:bunnyCompanionKey = \$key; Start-BunnyCompanionMotion \$state \}/);
  assert.match(weapons, /function Set-BunnyWeaponChip[\s\S]*?\$Offline/, 'offline is drawn from the Host state, not from a stale timer');
});

test('animations stop when motion is off or reduced, when the system disables animation, and when the strip is hidden', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(weapons, /if \(\$cells -eq 0\) \{ Stop-BunnyWeaponStrip; \$strip\.Visibility = 'Collapsed'; \$bunnyControls\.StripCapsule\.Visibility = 'Collapsed'; Set-BunnyJoin; return \}/);
  // T13 board polish: the strip and the Notch share one shape; the join is recomputed whenever the strip's visibility changes.
  const visual = readFileSync(join(install, 'Bunny-Island.Visual.ps1'), 'utf8');
  assert.match(visual, /function Set-BunnyJoin \{/);
  assert.match(weapons, /\$strip\.Visibility = 'Visible'; \$bunnyControls\.StripCapsule\.Visibility = 'Visible'; Set-BunnyJoin/);
  // T13.3 Gate H added the per-Agent intensity to the same guard; the Island-wide conditions are unchanged.
  assert.match(weapons, /if \(-not \$bunnyAnimate -or -not \$Base -or \(\$Skin -and -not \$Skin\.Animate\)\) \{ return \}/);
  const motion = readFileSync(join(install, 'Bunny-Island.Motion.ps1'), 'utf8');
  assert.match(motion, /\$script:bunnyAnimate=-not\$SmokeTest-and\[Windows\.SystemParameters\]::ClientAreaAnimation-and-not\[Windows\.SystemParameters\]::HighContrast-and\$bunnyPreferences\.motion-eq'full'/);
  assert.match(motion, /if\(-not\$bunnyWindow\.IsVisible-or\$bunnyWindow\.WindowState-eq'Minimized'\)\{\$script:bunnyAnimate=\$false\}/, 'a hidden or minimized native window has no animation permission');
  assert.match(visual, /\$bunnyWindow\.Add_StateChanged\(\{Sync-BunnyMotionVisibility\}\)/);
  assert.match(visual, /\$bunnyWindow\.Add_IsVisibleChanged\(\{Sync-BunnyMotionVisibility\}\)/);
});

test('the Ctrl+Alt+Arrow keyboard move and the drag share one edge rule, and the settings combo stays in sync', () => {
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /\$both=\[Windows\.Input\.ModifierKeys\]::Control-bor\[Windows\.Input\.ModifierKeys\]::Alt/);
  assert.match(visual, /function Set-BunnyDockEdge[\s\S]*?Sync-BunnyEdgeChoice/);
  assert.match(visual, /\$bunnyWindow\.Add_PreviewKeyDown\(\{if\(Test-BunnyDockKey \$_\)/);
  assert.match(visual, /Add_PreviewMouseLeftButtonDown/);
  assert.match(visual, /CaptureMouse\(\)/);
  assert.match(visual, /-le6\)/, 'the drag starts only past 6 DIP');
  assert.match(visual, /Get-BunnyNearestEdge -Point \$point -WorkArea \$work -Size \$size/);
  assert.match(visual, /\$bunnyPreferences\.monitor=@\{device=\[string\]\$screen\.DeviceName;fingerprint=\(Get-BunnyWorkAreaFingerprint \$work\)\}/);
  assert.match(visual, /function Set-BunnyPosition \{[\s\S]*?\$area=Get-BunnyTargetArea/);
});

test('accessibility: every weapon, the companion and the detail actions carry a name; the card is reachable by keyboard', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(weapons, /\[Windows\.Automation\.AutomationProperties\]::SetName\(\$Chip, \$name\)/);
  assert.match(weapons, /\$Chip\.ToolTip = \$name/);
  assert.match(weapons, /' ' \+ \[char\]0x2014 \+ ' ' \+ \[string\]\$Slot\.displayName \+ ', ' \+ \$label/, 'the name reads Weapon em-dash display name, state');
  assert.match(weapons, /\$chip\.Focusable = \$true|Focusable = \$true/);
  assert.match(weapons, /\$button = \[Windows\.Controls\.Button\]::new\(\)/, 'native Button exposes the standard UI Automation peer');
  assert.match(weapons, /\$button\.IsTabStop = \$true/);
  assert.match(weapons, /\$chip\.Add_Click\(\{ Show-BunnyWeaponDetail/);
  const visual = readFileSync(visualPath, 'utf8');
  for (const name of ['Pause this Agent', 'Resume this Agent', 'Stop this Agent', 'Open this Agent in the workspace', 'Back to the Notch', 'Bunny companion']) assert.ok(visual.includes(name) || readFileSync(companionPath, 'utf8').includes(name), name);
});

test('weapon chips never draw letters, provider marks or internal team members', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.doesNotMatch(weapons, /Substring\(0, 1\)|BunnyRoleLetter|Get-BunnyAgentChipFacts|\.Letter/);
  assert.doesNotMatch(weapons, /\$view\.Slots[^\n]*team/i);
  assert.match(weapons, /New-BunnyUnslottedChip/);
});

test('Ctrl+Alt docking and drag keep the four locked dock behaviours: the strip side and the expansion follow the edge', () => {
  const visual = readFileSync(visualPath, 'utf8');
  assert.match(visual, /function Test-BunnyVertical \{ return \(\(ConvertTo-BunnyEdge \$bunnyPreferences\.edge\) -in @\('left', 'right'\)\) \}/);
});

test('no function is defined twice in the Visual module (the slot-row opener had a duplicate)', () => {
  const visual = readFileSync(visualPath, 'utf8');
  const names = [...visual.matchAll(/^function ([A-Za-z-]+)/gm)].map((match) => match[1]);
  const duplicates = names.filter((name, index) => names.indexOf(name) !== index);
  assert.deepEqual([...new Set(duplicates)], [], 'duplicate function definitions');
});

test('offline data is labelled last known wherever a retained Agent state is shown: slot rows, the weapon card and chip names', () => {
  const visual = readFileSync(visualPath, 'utf8');
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(visual, /if \(\$bound -and -not \$bunnyOnline\) \{ \$label = 'Last known: ' \+ \$label \}/);
  assert.match(weapons, /\$c\.WeaponState\.Text = if \(\$bunnyOnline\) \{ \$stateText \} else \{ 'Last known: ' \+ \$stateText \+ ' \(Host offline\)' \}/);
  assert.match(weapons, /if \(\$Offline\) \{ \$label = 'last known, Host offline: ' \+ \$label \}/);
});

test('the Notch carries no "--" placeholder text and the header controls and weapon chips meet the 44 DIP target', () => {
  const visual = readFileSync(visualPath, 'utf8');
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.doesNotMatch(visual, /'--'/, 'no "--" placeholder');
  for (const name of ['ExtrasButton', 'SearchButton', 'VoiceButton']) assert.match(visual, new RegExp('x:Name="' + name + '" DockPanel\\.Dock="(Left|Right)" Width="44" Height="44"'), name);
  assert.match(weapons, /^\$script:bunnyWeaponCellWidth = 44$/m);
  assert.match(weapons, /^\$script:bunnyWeaponCellHeight = 46$/m);
});

test('weapon chips show keyboard focus, and the expanded slot rows do the same', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(weapons, /\$chip\.Add_GotKeyboardFocus\(\{ \$this\.SetResourceReference\(\[Windows\.Controls\.Control\]::BorderBrushProperty, 'BunnyAccent'\)/);
  assert.match(weapons, /\$chip\.Add_LostKeyboardFocus\(/);
  assert.match(readFileSync(visualPath, 'utf8'), /\$row\.Add_GotKeyboardFocus\(/);
});

test('a weapon command is never reported as sent while another command is still in flight', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  const guard = weapons.indexOf('if ($bunnyPending) { return }');
  const notice = weapons.indexOf("Notice.Text = 'Sent to the Host. Waiting for its answer.'");
  assert.ok(guard > 0 && notice > guard, 'the pending guard runs before the sent notice');
});

test('the harness evidence receipts, when present, record every notch check as passing', () => {
  const receipts = join(root, 'test-results', 'ma3', 't13', 'notch', 'notch-receipts.json');
  if (!existsSync(receipts)) return;
  const summary = JSON.parse(readFileSync(receipts, 'utf8').replace(/^\uFEFF/, ''));
  assert.ok(summary.runs.length >= 13 * 4, 'every edge and state ran');
  for (const run of summary.runs) for (const [key, value] of Object.entries(run.checks || {})) assert.equal(value, true, `${run.name} ${key}`);
});

test('T13.3 H native chips: all four weapons wear all five styles; pixel art is nearest-neighbour, the others keep the art smooth', { skip }, () => {
  for (const weapon of ['gada', 'spear', 'chakra', 'sword']) {
    for (const style of ['glossy', 'cel', 'arcade', 'comic', 'pixel']) {
      const skin = get(`skin_${weapon}_${style}`);
      assert.equal(skin.Style, style, `${weapon} wears ${style}`);
      assert.equal(skin.Animate, true);
      assert.equal(skin.Outline, false);
      if (style === 'pixel') {
        assert.equal(skin.Scaling, 'NearestNeighbor');
        assert.equal(skin.PixelGrid, 24, 'pixel art decodes to the web compact grid and scales without blur');
        assert.equal(skin.Steps, 4);
        assert.equal(skin.Effect, null);
      } else {
        assert.equal(skin.Scaling, 'HighQuality');
        assert.equal(skin.DecodeWidth, 96);
        assert.equal(skin.PixelGrid, 0);
        assert.ok(skin.Effect && skin.Effect.Kind, `${style} has a material effect`);
      }
    }
  }
});

test('T13.3 H native pixel art fits the longest side to 24 px like the web pixelSprite, never upscaled', { skip }, () => {
  const header = (weapon) => readFileSync(join(artDir, `${weapon}.compact.png`)).subarray(16, 24);
  const gada = header('gada');
  assert.equal(get('pngHeight'), gada.readUInt32BE(4));
  for (const weapon of ['gada', 'spear', 'chakra', 'sword']) {
    const bytes = header(weapon);
    const width = bytes.readUInt32BE(0);
    const height = bytes.readUInt32BE(4);
    const expected = Math.max(1, Math.round(width * Math.min(1, 24 / Math.max(width, height))));
    assert.equal(get(`pixelWidth_${weapon}`), expected, `${weapon} ${width}x${height}`);
    assert.ok(expected <= width && Math.max(expected, Math.round(height * expected / width)) <= 24);
  }
  assert.equal(get('pixelWidthBadId'), 24, 'an id that is not an art name never reaches the file system');
});

test('T13.3 H native chips: no style falls back to the signature; unknown values never pass through', { skip }, () => {
  assert.deepEqual(['gada', 'spear', 'chakra', 'sword'].map((weapon) => get(`skinSignature_${weapon}`).Style), ['glossy', 'cel', 'arcade', 'comic']);
  for (const weapon of ['gada', 'spear', 'chakra', 'sword']) assert.equal(get(`skinSignature_${weapon}`).Signature, true);
  const unknown = get('skinUnknownStyle');
  assert.equal(unknown.Style, 'comic', "an unknown style shows Sword's signature");
  assert.equal(unknown.Amplitude, 1);
  assert.equal(unknown.Outline, false, 'a non-boolean contrast flag is not true');
});

test('T13.3 H native chips: intensity, the Island animation switch and high contrast (per Agent or system) control the skin', { skip }, () => {
  const subtle = get('skinSubtle');
  assert.equal(subtle.Amplitude, 0.5); assert.equal(subtle.PeriodScale, 1.6); assert.equal(subtle.Animate, true);
  const off = get('skinOff');
  assert.equal(off.Animate, false); assert.equal(off.Amplitude, 0);
  assert.equal(get('skinIslandStill').Animate, false, 'reduced motion, Motion off or system animation off still win');
  for (const name of ['skinAgentContrast', 'skinSystemContrast']) {
    assert.equal(get(name).Effect, null, `${name}: no decorative effect`);
    assert.equal(get(name).Outline, true, `${name}: solid outline`);
  }
  assert.equal(get('appearanceRow').style, 'pixel');
  assert.equal(get('appearanceMissing'), null);
});

test('T13.3 H the Notch marks the active speaker apart from the Agents still working, from Host facts only', { skip }, () => {
  assert.deepEqual(get('roleGadaSpeaking'), { Speaking: true, Working: false });
  assert.deepEqual(get('roleSwordWorking'), { Speaking: false, Working: true });
  assert.deepEqual(get('roleBunnySpeaking'), { Speaking: false, Working: true });
  assert.deepEqual(get('roleNoContext'), { Speaking: false, Working: false });
  assert.deepEqual(get('roleVerifiedNotWorking'), { Speaking: false, Working: false }, 'a finished Agent is not shown as working');
});

test('T13.3 H the chip applies the skin from the snapshot, keeps motion gated by the Host state, and names the speaker', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(weapons, /Get-BunnyCharacterSkin \$weapon \(Get-BunnySlotAppearance \$bunnySnapshot\.characterAppearance/);
  assert.match(weapons, /\[Windows\.SystemParameters\]::HighContrast/);
  assert.match(weapons, /\$decodeWidth = if \(\$base -and \$skin\.PixelGrid\) \{ Get-BunnyPixelDecodeWidth \$base\.Compact \$skin\.PixelGrid \} else \{ \$skin\.DecodeWidth \}/);
  assert.match(weapons, /Get-BunnyCharacterSource \$base\.Compact \$decodeWidth/);
  assert.match(weapons, /if \(-not \$bunnyAnimate -or -not \$Base -or \(\$Skin -and -not \$Skin\.Animate\)\) \{ return \}/);
  assert.match(weapons, /if \(\$role\.Speaking\) \{ \$label = \$label \+ ', speaking now' \}/);
  // Offline: the retained foreground is not presented as a live speaker.
  assert.match(weapons, /\$\(if \(\$Offline -or -not \$bunnySnapshot\.personalAgentContext\) \{ \$null \}/);
  // A style change alone never fires a one-shot: cues still come only from Get-BunnyObservedTransitions.
  assert.equal((weapons.match(/Invoke-BunnyWeaponOneShot \$/g) || []).length, 1);
});

test('T13.3 H a material effect is cached at device scale, so a moving chip does not re-run the shader every frame', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  assert.match(weapons, /\$art = \[Windows\.Controls\.Border\]::new\(\); \$art\.Child = \$image/);
  assert.match(weapons, /\$tag\.Art\.CacheMode = if \(\$skin\.Effect\) \{/);
  assert.match(weapons, /\[Windows\.Media\.BitmapCache\]::new\(\); \$cache\.RenderAtScale = \[Math\]::Max\(1\.0, \[double\]\(Get-BunnyDeviceScale\)\.X\)/);
});

test('T13.3 H the native style evidence receipts, when present, record every check as passing', () => {
  const receipts = join(root, 'test-results', 'ma3', 't13-3', 'gate-h', 'notch', 'style-receipts.json');
  if (!existsSync(receipts)) return;
  const summary = JSON.parse(readFileSync(receipts, 'utf8').replace(/^\uFEFF/, ''));
  const names = summary.runs.map((run) => run.name);
  for (const edge of ['top', 'bottom', 'left', 'right']) assert.ok(names.includes(`edge-${edge}-gada-speaking`), `${edge} placement ran`);
  for (const style of ['glossy', 'cel', 'arcade', 'comic', 'pixel']) assert.ok(names.includes(`style-${style}-all-agents`) && names.includes(`perf-${style}`), `${style} ran and was measured`);
  for (const run of summary.runs) for (const [key, value] of Object.entries(run.checks || {})) assert.equal(value, true, `${run.name} ${key}`);
});
