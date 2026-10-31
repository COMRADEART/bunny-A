// MA4-S2-T1: persistent task facts on the Notch. Windows only: Get-BunnyTaskStrip runs in Windows PowerShell 5.1 by
// dot-sourcing install/Bunny-Island.Placement.ps1 (JSON in, JSON out), like the other Island rule tests.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const placementPath = join(root, 'install', 'Bunny-Island.Placement.ps1');
const skip = process.platform === 'win32' ? false : 'The Island is a Windows PowerShell surface';
const task = (id, display, over = {}) => ({ id, title: `Task ${id}`, display, progress: { done: 1, total: 3 }, ...over });
const NEXT = Date.UTC(2026, 9, 24, 18, 0);
const sched = (state, over = {}) => ({ id: 's', title: 'Evening summary', state, nextAt: NEXT, runningTaskId: null, ...over });
const pro = (status) => ({ status: { monitoring: 0, scheduled: 0, working: 0, waiting: 0, attention: 0, nextRunAt: NEXT, ...status }, goals: [],
  schedules: [sched('ACTIVE')], monitors: [{ id: 'm', label: 'Build status', state: 'ACTIVE', lastCheckAt: NEXT }, { id: 'n', label: 'Docs', state: 'ACTIVE', lastCheckAt: null }], away: null });

const cases = {
  empty: { snapshot: null, online: true },
  finishedOnly: { snapshot: { tasks: [task('a', 'Completed'), task('b', 'Failed'), task('c', 'Cancelled')] }, online: true },
  working: { snapshot: { tasks: [task('a', 'Working'), task('b', 'Working'), task('c', 'Queued'), task('d', 'Completed')] }, online: true },
  urgentFirst: { snapshot: { tasks: [task('a', 'Working'), task('b', 'Needs attention'), task('c', 'Waiting for approval')] }, online: true },
  // A recovered task arrives twice in a merged view: it is still one entry, never two badges.
  recoveredOnce: { snapshot: { tasks: [task('r', 'Recovering'), task('r', 'Recovering')] }, online: true },
  offline: { snapshot: { tasks: [task('a', 'Working')] }, online: false },
  // MA4-S2-T2: connected steps report what they are doing; the tooltip says so, the cell and headline rules are unchanged.
  connected: { snapshot: { tasks: [task('f', 'Working', { activity: 'Reading files' }), task('e', 'Waiting for approval', { activity: 'Waiting for permission' }), task('g', 'Working', { activity: null })] }, online: true },
  // MA4-S2-T3: proactive facts. Monitoring and Scheduled are muted and rank below every task state; approvals outrank work.
  monitoringOnly: { snapshot: null, online: true, proactive: pro({ monitoring: 2, scheduled: 1 }) },
  scheduledOnly: { snapshot: { tasks: [] }, online: true, proactive: { ...pro({ scheduled: 1 }), monitors: [] } },
  approvalOverWork: { snapshot: { tasks: [task('a', 'Working')] }, online: true, proactive: { ...pro({ waiting: 1 }), schedules: [sched('AWAITING_APPROVAL')] } },
  workWithMonitor: { snapshot: { tasks: [task('a', 'Working')] }, online: true, proactive: pro({ monitoring: 1 }) },
  away: { snapshot: null, online: true, proactive: { ...pro({ monitoring: 1 }), away: { since: 0, text: '2 scheduled tasks completed' } } },
  proactiveOffline: { snapshot: null, online: false, proactive: { ...pro({ monitoring: 1 }), away: { since: 0, text: 'x' } } },
};

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'island-ptask-'));
  try {
    const input = join(dir, 'in.json'), out = join(dir, 'out.json'), runner = join(dir, 'runner.ps1');
    writeFileSync(input, JSON.stringify(cases));
    writeFileSync(runner, `param([string]$Placement, [string]$In, [string]$Out)
. $Placement
$all = Get-Content -LiteralPath $In -Raw | ConvertFrom-Json
$result = @{}
foreach ($p in $all.PSObject.Properties) { $result[$p.Name] = Get-BunnyTaskStrip $p.Value.snapshot ([bool]$p.Value.online) $p.Value.proactive }
$h = Get-BunnyPlacement -Edge 'top' -WorkArea @{ Left = 0; Top = 0; Width = 1920; Height = 1040 } -Size @{ Width = 360; Height = 76 }
$v = Get-BunnyPlacement -Edge 'left' -WorkArea @{ Left = 0; Top = 0; Width = 1920; Height = 1040 } -Size @{ Width = 360; Height = 76 }
$result['horizontal'] = Get-BunnyIndicatorLayout -Placement $h -AgentCount 3
$result['vertical'] = Get-BunnyIndicatorLayout -Placement $v -AgentCount 3
[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject $result -Depth 5 -Compress), [Text.UTF8Encoding]::new($false))
`);
    const r = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner, placementPath, input, out], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(r.status, 0, r.stderr);
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('S2-T1 notch: one cell for open tasks, urgent state first, one entry per task id, honest when offline', { skip }, () => {
  const f = run();
  assert.equal(f.empty.Count, 0); assert.equal(f.finishedOnly.Count, 0, 'finished tasks take no notch space');
  assert.equal(f.working.Count, 3); assert.equal(f.working.Headline, '2 working'); assert.equal(f.working.Tone, 'BunnyAccent');
  assert.match(f.working.ToolTip, /Task a - Working - step 2 of 3/, 'the current step, from Host progress');
  assert.equal(f.urgentFirst.Lead, 'Needs attention'); assert.equal(f.urgentFirst.Headline, 'Needs attention'); assert.equal(f.urgentFirst.Tone, 'BunnyWarning');
  assert.equal(f.recoveredOnce.Count, 1); assert.deepEqual(f.recoveredOnce.Ids, ['r']); assert.equal(f.recoveredOnce.Headline, 'Recovering');
  assert.equal(f.offline.Headline, 'Tasks: last known', 'a cached Working is not shown as current');
  assert.match(f.offline.ToolTip, /^Host unavailable\. Last known task states:/); assert.equal(f.offline.Tone, 'BunnyMuted');
  assert.match(f.connected.ToolTip, /Task f - Working - Reading files - step 2 of 3/);
  assert.match(f.connected.ToolTip, /Task e - Waiting for approval - Waiting for permission/);
  assert.match(f.connected.ToolTip, /Task g - Working - step 2 of 3/, 'an S2-T1 task keeps its line');
  assert.equal(f.connected.Headline, 'Waiting for approval');
  // The task cell lives in the agent strip, so the existing rule places it: left of a horizontal notch, above a side notch.
  assert.equal(f.horizontal.Side, 'left'); assert.equal(f.horizontal.Axis, 'row');
  assert.equal(f.vertical.Side, 'top'); assert.equal(f.vertical.Axis, 'column');
});

test('S2-T3 notch: monitoring and schedules are shown truthfully, never as work; approvals lead; away summary', { skip }, () => {
  const f = run(), hhmm = new Date(NEXT).toTimeString().slice(0, 5);
  assert.equal(f.monitoringOnly.Lead, 'Monitoring'); assert.equal(f.monitoringOnly.Headline, 'Monitoring 2'); assert.equal(f.monitoringOnly.Tone, 'BunnyMuted');
  assert.equal(f.monitoringOnly.Count, 3); assert.deepEqual(f.monitoringOnly.Ids, [], 'no task ids for proactive lines');
  assert.match(f.monitoringOnly.ToolTip, new RegExp(`Monitor: Build status - Monitoring, checked ${hhmm}`));
  assert.match(f.monitoringOnly.ToolTip, new RegExp(`Schedule: Evening summary - Scheduled, next ${hhmm}`));
  assert.equal(f.scheduledOnly.Lead, 'Scheduled'); assert.equal(f.scheduledOnly.Headline, `Next run ${hhmm}`); assert.equal(f.scheduledOnly.Tone, 'BunnyMuted');
  assert.equal(f.approvalOverWork.Lead, 'Waiting for approval'); assert.equal(f.approvalOverWork.Tone, 'BunnyWarning');
  assert.match(f.approvalOverWork.ToolTip, /Schedule: Evening summary - Waiting for approval/);
  assert.equal(f.workWithMonitor.Lead, 'Working', 'real work outranks monitoring'); assert.equal(f.workWithMonitor.Headline, '1 working');
  assert.equal(f.away.Headline, 'While you were away'); assert.match(f.away.ToolTip, /While you were away: 2 scheduled tasks completed/);
  assert.equal(f.proactiveOffline.Headline, 'Tasks: last known'); assert.doesNotMatch(f.proactiveOffline.ToolTip, /While you were away/);
  assert.equal(f.empty.Count, 0, 'no proactive facts, no cell');
});

test('S2-T1 notch wiring: the strip counts the task cell and the idle status line shows the task headline', () => {
  const weapons = readFileSync(join(root, 'install', 'Bunny-Island.Weapons.ps1'), 'utf8');
  const voice = readFileSync(join(root, 'install', 'Bunny-Island.Voice.ps1'), 'utf8');
  assert.match(weapons, /function Get-BunnyStripCellCount \{[\s\S]*?Get-BunnyTaskStrip \$bunnySnapshot\.persistentTasks/);
  assert.match(weapons, /if \(\$tasks\.Count -gt 0\) \{ \$items \+= Get-BunnyTaskChip \$tasks \}/);
  assert.match(voice, /if \(\$TaskHeadline -and \$Headline -in @\('Ready', 'Voice is off'\)\) \{ return \$TaskHeadline \}/);
  // MA4-S2-T3: every strip call site passes the Host's proactive facts.
  for (const text of [weapons, voice]) assert.equal((text.match(/Get-BunnyTaskStrip \$bunnySnapshot\.persistentTasks \(\[bool\]\$bunnyOnline\) \$bunnySnapshot\.proactive/g) ?? []).length, text === weapons ? 2 : 1);
  // eslint-disable-next-line no-control-regex -- the assertion's subject is that the island scripts contain no non-ASCII bytes
  for (const text of [weapons, voice, readFileSync(join(root, 'install', 'Bunny-Island.Placement.ps1'), 'utf8')]) assert.equal(/[^\x00-\x7F]/.test(text), false, 'Island scripts stay ASCII for Windows PowerShell 5.1');
});
