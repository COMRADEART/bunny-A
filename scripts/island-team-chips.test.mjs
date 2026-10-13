// M-A-3 T11, revised by M-A-3 T13: Bunny Bar / Notch agent tooltips. Windows only: Get-BunnyAgentChipFacts runs in Windows
// PowerShell 5.1 by dot-sourcing install/Bunny-Island.Placement.ps1 (JSON in, JSON out), the same way the placement rules are tested.
// T13: internal team members are never weapons and never lettered; they keep their role and task in the tooltip.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const placementPath = join(root, 'install', 'Bunny-Island.Placement.ps1');
const weaponsPath = join(root, 'install', 'Bunny-Island.Weapons.ps1');
const presentationPath = join(root, 'install', 'Bunny-Island.Presentation.ps1');
const skip = process.platform === 'win32' ? false : 'Island chips are a Windows PowerShell surface';

const agents = [
  { id: 'a1', name: 'Inventory team', state: 'RUNNING', missionId: 'm1', team: { role: 'coordinator', coordinatorId: null, missionId: 'm1' } },
  { id: 'a2', name: 'Inventory team - Researcher', state: 'RUNNING', missionId: 'm1', team: { role: 'researcher', coordinatorId: 'a1', missionId: 'm1' }, current: { kind: 'generate_json', state: 'running' } },
  { id: 'a3', name: 'Inventory team - Reviewer', state: 'WAITING_FOR_DEPENDENCY', missionId: 'm1', team: { role: 'reviewer', coordinatorId: 'a1', missionId: 'm1' }, current: { kind: 'review', state: 'pending' } },
  { id: 'a4', name: 'Inventory team - Tester', state: 'VERIFYING', missionId: 'm1', team: { role: 'tester', coordinatorId: 'a1', missionId: 'm1' }, current: { kind: 'verify_output', state: 'running' } },
  { id: 'a5', name: 'ledger', state: 'PAUSED', missionId: 'm2' },
  { id: 'a6', name: '', state: 'CREATED', missionId: 'm3' },
];

function run() {
  const dir = mkdtempSync(join(tmpdir(), 'island-chips-'));
  try {
    const input = join(dir, 'agents.json');
    const out = join(dir, 'out.json');
    const runner = join(dir, 'runner.ps1');
    writeFileSync(input, JSON.stringify(agents));
    writeFileSync(runner, `param([string]$Placement, [string]$In, [string]$Out)
. $Placement
$items = Get-Content -LiteralPath $In -Raw | ConvertFrom-Json
$results = foreach ($a in $items) {
      $f = Get-BunnyAgentChipFacts $a
      $row = @{ id = $a.id; tip = $f.ToolTip; role = $f.Role; mission = $f.MissionId }
      # The letter fact is projected only when the product actually produces it, so a reintroduced letter fails
      # these assertions instead of verifying the harness's own projection shape.
      if ($f.PSObject.Properties['Letter']) { $row.letter = $f.Letter }
      , [pscustomobject]$row
    }
[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject @($results) -Compress), [Text.UTF8Encoding]::new($false))
`);
    const result = spawnSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', runner, placementPath, input, out], { encoding: 'utf8', timeout: 60_000 });
    assert.equal(result.status, 0, result.stderr);
    return JSON.parse(readFileSync(out, 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

test('T13 chips: team members get no letter; their tooltip names role, state and their own task', { skip }, () => {
  const facts = Object.fromEntries(run().map((row) => [row.id, row]));
  assert.equal(facts.a1.letter, undefined, 'the coordinator is a user-facing Agent, but a tooltip fact carries no letter');
  assert.equal(facts.a2.letter, undefined, 'T13: no letter placeholder for a team member');
  assert.equal(facts.a3.letter, undefined, 'T13: Reviewer and Researcher are both unlettered, so they cannot collide');
  assert.equal(facts.a4.letter, undefined, 'T13: no letter placeholder for a team member');
  assert.equal(facts.a2.tip, 'Inventory team - Researcher - Researcher agent - running - building the dataset');
  assert.equal(facts.a3.tip, 'Inventory team - Reviewer - Reviewer agent - waiting for dependency - reviewing (advisory)');
  assert.equal(facts.a4.mission, 'm1');
  assert.equal(facts.a5.letter, undefined, 'T13: a single Agent is named by its tooltip, never by an initial');
  assert.equal(facts.a5.tip, 'ledger - paused');
  assert.equal(facts.a6.letter, undefined, 'T13: no "?" placeholder for an unnamed Agent');
});

test('T13 strip: the notch draws weapon characters from the slot contract, never letters or team members', () => {
  const weapons = readFileSync(weaponsPath, 'utf8');
  const presentation = readFileSync(presentationPath, 'utf8');
  const placement = readFileSync(placementPath, 'utf8');
  assert.match(weapons, /function Update-BunnyAgentStrip[\s\S]*?Get-BunnyPersonalAgentStrip \$snapshot/);
  assert.doesNotMatch(weapons + presentation + placement, /Substring\(0, 1\)|BunnyRoleLetter|Get-BunnyActiveAgents|New-BunnyAgentChip/);
  assert.ok([...readFileSync(placementPath, 'utf8')].every((character) => character.codePointAt(0) <= 0x7f), 'Placement.ps1 stays ASCII for Windows PowerShell 5.1');
});
