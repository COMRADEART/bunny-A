// M-A-3 T10: Island voice client. Parse every Island PowerShell file (Windows PowerShell 5.1 parser) and check the
// static invariants of the native voice panel: contract conformance (voice-protocol.ts), truthful state (V46), no
// decorative motion (V51), accessible controls (V50), no agent or mission call on window close (V45), and the packaged
// file list. Behaviour is covered by the disposable fake-Host smoke runs recorded in test-results/ma3/t10/notch.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const installDir = join(root, 'install');
const voicePath = join(installDir, 'Bunny-Island.Voice.ps1');
const visualPath = join(installDir, 'Bunny-Island.Visual.ps1');
const motionPath = join(installDir, 'Bunny-Island.Motion.ps1');
const islandPath = join(installDir, 'Bunny-Island.ps1');
const packagePath = join(root, 'scripts', 'package-bunny-desktop.ps1');
const contractPath = join(root, 'src', 'lib', 'bunny-host', 'voice', 'voice-protocol.ts');
const skip = process.platform === 'win32' ? false : 'Island is a Windows PowerShell surface';

const read = (path) => readFileSync(path, 'utf8');
const islandFiles = readdirSync(installDir).filter((name) => /^Bunny-Island.*\.ps1$/.test(name));

test('every Bunny-Island PowerShell file parses with zero errors under the PowerShell 5.1 parser', { skip }, () => {
  const dir = mkdtempSync(join(tmpdir(), 'island-parse-'));
  try {
    const script = join(dir, 'parse.ps1');
    const out = join(dir, 'out.json');
    writeFileSync(script, `param([string]$Dir, [string]$Out)
$result = @()
Get-ChildItem -LiteralPath $Dir -Filter 'Bunny-Island*.ps1' | ForEach-Object {
  $errors = $null; $tokens = $null
  [void][System.Management.Automation.Language.Parser]::ParseFile($_.FullName, [ref]$tokens, [ref]$errors)
  $result += [pscustomobject]@{ file = $_.Name; errors = @($errors | ForEach-Object { $_.Message + ' @' + $_.Extent.StartLineNumber }) }
}
[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject @($result) -Depth 4 -Compress), [Text.UTF8Encoding]::new($false))
`, 'utf8');
    const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Dir', installDir, '-Out', out], { encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    const parsed = JSON.parse(read(out).replace(/^\uFEFF/, ''));
    assert.ok(parsed.some((entry) => entry.file === 'Bunny-Island.Voice.ps1'), 'voice file parsed');
    assert.ok(parsed.some((entry) => entry.file === 'Bunny-Island.Placement.ps1'), 'placement file parsed');
    for (const entry of parsed) assert.deepEqual(entry.errors, [], `${entry.file} parse errors`);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('island PowerShell sources are ASCII-only so PowerShell 5.1 reads them without a BOM', () => {
  for (const name of ['Bunny-Island.Voice.ps1', 'Bunny-Island.Placement.ps1', 'Bunny-Island.Visual.ps1', 'Bunny-Island.Motion.ps1']) {
    const text = read(join(installDir, name));
    assert.doesNotMatch(text, /[\u0080-\uFFFF]/, `${name} contains non-ASCII characters`);
  }
});

test('window title stays "Bunny Island" (the launcher keys readiness on it)', () => {
  assert.match(read(islandPath), /Title="Bunny Island"/);
});

test('new Island files are in the packaged install file list', () => {
  const pack = read(packagePath);
  assert.match(pack, /'Bunny-Island\.Placement\.ps1'/);
  assert.match(pack, /'Bunny-Island\.Voice\.ps1'/);
});

test('every voice action the panel sends is a workstation action in the shared contract', () => {
  const contract = read(contractPath);
  const block = contract.slice(contract.indexOf('export const VOICE_ACTIONS'), contract.indexOf(']);', contract.indexOf('export const VOICE_ACTIONS')));
  const allowed = new Set([...block.matchAll(/"(voice\.[a-z.]+)"/g)].map((m) => m[1]));
  assert.ok(allowed.size >= 10, 'contract action list parsed');
  const sent = new Set();
  for (const name of ['Bunny-Island.Voice.ps1', 'Bunny-Island.Visual.ps1']) {
    for (const m of read(join(installDir, name)).matchAll(/'(voice\.[a-z.]+)'/g)) sent.add(m[1]);
  }
  assert.ok(sent.size >= 8, 'panel sends voice actions');
  for (const action of sent) assert.ok(allowed.has(action), `${action} is not in VOICE_ACTIONS`);
});

test('V46: Listening requires worker capture AND a fresh poll; otherwise the panel says Reconnecting', () => {
  const voice = read(voicePath);
  const fn = voice.slice(voice.indexOf('function Get-BunnyVoiceLabel'), voice.indexOf('function Get-BunnyVoiceDeviceLine'));
  const fresh = fn.indexOf('if (-not $Fresh)');
  const capturing = fn.indexOf('if ($Snap.capturing) { return \'Listening\' }');
  assert.ok(fresh > 0 && capturing > fresh, 'freshness is checked before the Listening branch');
  assert.match(fn, /Reconnecting/);
});

test('V46: Speaking is shown only from snapshot.playing, and only one branch produces it', () => {
  const voice = read(voicePath);
  assert.equal([...voice.matchAll(/return 'Speaking'/g)].length, 1);
  assert.match(voice, /if \(\$Snap\.playing\) \{ return 'Speaking' \}/);
});

test('V46: the level meter is driven only by snapshot.level with a freshness check, never by a timer or random value', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$snap\.level -and \(\(\$now - \[double\]\$snap\.level\.at\) -lt \$bunnyVoiceFreshMs\)/);
  assert.doesNotMatch(voice, /Get-Random|System\.Random|\$rnd\b/);
});

test('V51: the voice layer adds no decorative animation (reduced motion and high contrast stay quiet)', () => {
  const voice = read(voicePath);
  assert.doesNotMatch(voice, /DoubleAnimation|BeginAnimation|Storyboard/);
  assert.match(read(motionPath), /ClientAreaAnimation-and-not\[Windows\.SystemParameters\]::HighContrast/);
});

test('V50: every voice control has an AutomationProperties.Name in the Visual XAML', () => {
  const visual = read(visualPath);
  const controls = [...visual.matchAll(/<(Button|CheckBox|TextBox)\b[^>]*x:Name="(Voice[A-Za-z]*)"[^>]*\/?>/g)];
  assert.ok(controls.length >= 10, 'voice controls found in XAML');
  for (const control of controls) assert.match(control[0], /AutomationProperties\.Name="/, `${control[2]} has no accessible name`);
});

test('V45: closing the Island releases voice (voice.session.close) and never calls agent.* or mission.*', () => {
  const visual = read(visualPath);
  const voice = read(voicePath);
  const closing = voice.slice(voice.indexOf('$bunnyWindow.Add_Closing'), voice.indexOf('$bunnyWindow.Add_Closed'));
  assert.match(closing, /Invoke-BunnyVoiceCloseNow/);
  const closeNow = voice.slice(voice.indexOf('function Invoke-BunnyVoiceCloseNow'), voice.indexOf('function Set-BunnyHandsFree'));
  assert.match(closeNow, /'voice\.session\.close'/);
  assert.doesNotMatch(closing + closeNow, /agent\.|mission\./);
  // Closed handlers in the Visual and Voice layers must not reach an agent or mission command either.
  for (const text of [visual, voice]) {
    for (const m of text.matchAll(/Add_Closed\(\{([\s\S]*?)\}\)\)?/g)) assert.doesNotMatch(m[1], /'(agent|mission)\./);
  }
});

test('the product hotkey is Ctrl+Alt+Space with MOD_NOREPEAT; the test chord is used only with -HotkeyTest; unregistered on close', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$bunnyVoiceChord = if \(\$HotkeyTest\) \{ @\(0x4007, 0x7B\) \} else \{ @\(0x4003, 0x20\) \}/);
  assert.match(voice, /RegisterHotKey\(\$hwnd, \$bunnyVoiceHotkeyId, \[uint32\]\$bunnyVoiceChord\[0\], \[uint32\]\$bunnyVoiceChord\[1\]\)/);
  const stop = voice.slice(voice.indexOf('function Stop-BunnyVoiceHotkey'), voice.indexOf('# ---- wiring'));
  assert.match(stop, /UnregisterHotKey\(\$script:bunnyVoiceHwnd/);
  const closing = voice.slice(voice.indexOf('$bunnyWindow.Add_Closing'), voice.indexOf('$bunnyWindow.Add_Closed'));
  assert.match(closing, /Stop-BunnyVoiceHotkey/);
});

test('a refused shortcut reports Shortcut unavailable and does not stop the Island', () => {
  assert.match(read(voicePath), /Shortcut unavailable \(in use\)/);
});

test('voice requests never run synchronously on the UI thread', () => {
  const voice = read(voicePath);
  assert.doesNotMatch(voice, /Invoke-Bunny\b|Invoke-RestMethod|UploadStringTaskAsync/);
  assert.match(voice, /SendAsync\(\$request\)/);
});

test('no raw audio, transcripts or credentials are written to logs or files by the voice layer', () => {
  const voice = read(voicePath);
  assert.doesNotMatch(voice, /WriteAllBytes|Out-File|Set-Content|Add-Content|Export-/);
  assert.doesNotMatch(voice, /Write-Host|Write-Output\s+\$snap/);
});

test('push-to-talk while SPEAKING sends voice.listen.start (no gate on playing) and the press never sends an interrupt', () => {
  const voice = read(voicePath);
  const pointer = voice.slice(voice.indexOf('function Start-BunnyVoicePointer'), voice.indexOf('function Stop-BunnyVoicePointer'));
  assert.match(pointer, /Start-BunnyVoiceListen 'push_to_talk'/);
  assert.doesNotMatch(pointer, /Test-BunnyVoicePlaying|Request-BunnyVoiceInterrupt/);
  const click = voice.slice(voice.indexOf('function Invoke-BunnyVoiceClick'), voice.indexOf('function Start-BunnyVoicePointer'));
  assert.match(click, /Start-BunnyVoiceListen 'button'/);
  assert.doesNotMatch(click, /Request-BunnyVoiceInterrupt/);
  // The hotkey starts the same listen path regardless of playback; the Host performs the barge-in.
  assert.match(voice, /function Start-BunnyHotkeyHold \{[\s\S]*?Start-BunnyVoiceListen 'hotkey'/);
});

test('the Interrupt control sends voice.interrupt and is the only control that cancels speech', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$bunnyControls\.VoiceInterrupt\.Add_Click\(\{ Request-BunnyVoiceInterrupt 'button' \}\)/);
  assert.match(voice, /function Request-BunnyVoiceInterrupt[\s\S]*?'voice\.interrupt'/);
});

test('the mic glyph carries Listening and Speaking as an accent, and a fault as a warning (collapsed notch has no status line)', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$label -eq 'Listening' -or \$label -eq 'Listening and speaking' -or \$label -eq 'Speaking' -or \$label -eq 'Paused for you'\) \{ 'BunnyAccent' \}/);
  assert.match(voice, /\$label -like 'Voice needs\*' -or \$label -like 'Host offline\*'\) \{ 'BunnyWarning' \}/);
});

test('-HotkeyTest is the only way the alternate test chord is selected, and blur is opt-in (default off)', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$bunnyVoiceChord = if \(\$HotkeyTest\)/);
  const island = read(islandPath);
  assert.match(island, /\[switch\]\$HotkeyTest/);
  const visual = read(visualPath);
  assert.match(visual, /edgeOffset=0\.5; blur='off' \}/);
  assert.match(visual, /if\(\$bunnyPreferences\.blur-eq'acrylic'\)\{\[void\]\(Enable-BunnyBlur\)\}/);
});

// Round-1 review fixes (M-A-3 T10). Each check pins a Host contract key or a truthful-state ordering.
const storePath = join(root, 'src', 'store', 'use-island.ts');
const modelPath = join(root, 'src', 'components', 'island', 'voice-model.ts');
const hostHttpPath = join(root, 'src', 'lib', 'bunny-host', 'http.server.ts');

test('R1-races#1 R1-truth#0 the on-screen Confirm and Mute send the keys the Host reads (proposalId, on)', () => {
  const host = read(hostHttpPath);
  assert.match(host, /typeof data\.proposalId === "string" \? data\.proposalId : ""/);
  assert.match(host, /"voice\.mute":[\s\S]{0,240}?return voice\.mute\(data\.muted === true \|\| data\.on === true\)/);
  const model = read(modelPath);
  assert.match(model, /confirm: \(proposalId: string\): \{ proposalId: string \} => \(\{ proposalId \}\)/);
  assert.match(model, /mute: \(on: boolean\): \{ on: boolean \} => \(\{ on \}\)/);
  const store = read(storePath);
  assert.match(store, /voiceCall\("voice\.control\.confirm", voiceRequest\.confirm\(id\)\)/);
  assert.match(store, /voiceCall\("voice\.mute", voiceRequest\.mute\(on\)\)/);
  assert.doesNotMatch(store, /"voice\.control\.confirm", \{ id \}/);
});

test('R1-truth#1 the WPF Mute button sends voice.mute with the Host key on (not muted) and reflects snapshot.muted', () => {
  const voice = read(voicePath);
  assert.match(voice, /Add-BunnyVoiceRequest 'voice\.mute' @\{ on = \(-not \[bool\]\$snap\.muted\) \} \$true/);
  assert.doesNotMatch(voice, /'voice\.mute' @\{ muted/);
  assert.match(voice, /\$bunnyControls\.VoiceMute\.Content = if \(\$snap -and \$snap\.muted\) \{ 'Unmute' \} else \{ 'Mute' \}/);
});

test('R1-truth#2 a quick WPF tap latches tap-to-talk: a visible finish state, a second tap ends it, and a deadline bounds it', () => {
  const voice = read(voicePath);
  const pointerDown = voice.slice(voice.indexOf('function Start-BunnyVoicePointer'), voice.indexOf('function Stop-BunnyVoicePointer'));
  assert.match(pointerDown, /if \(\$script:bunnyVoiceTapLatched\) \{ Stop-BunnyVoiceListen; return \}/);
  const pointerUp = voice.slice(voice.indexOf('function Stop-BunnyVoicePointer'), voice.indexOf('function Set-BunnyHandsFree'));
  assert.match(pointerUp, /\$script:bunnyVoiceTapLatched = \$true/);
  assert.match(voice, /\$headline = 'Listening - tap to finish'/);
  assert.match(voice, /\$bunnyVoiceTapLatchMs = \d+/);
  assert.match(voice, /if \(\$script:bunnyVoiceTapLatched -and \(\$now - \[double\]\$script:bunnyVoiceTapAt\) -gt \$bunnyVoiceTapLatchMs\) \{ Stop-BunnyVoiceListen \}/);
  const stop = voice.slice(voice.indexOf('function Stop-BunnyVoiceListen'), voice.indexOf('function Request-BunnyVoiceInterrupt'));
  assert.match(stop, /\$script:bunnyVoiceTapLatched = \$false/);
  // The corrected comment: a tap is not left to voice activity detection on the push_to_talk path.
  assert.doesNotMatch(voice, /a quick tap leaves the turn to voice activity detection/);
});

test('R1-truth#8 the WPF uiIntent seq is scoped to the Host epoch: a new epoch resets the floor and never replays an old seq', () => {
  const voice = read(voicePath);
  const intent = voice.slice(voice.indexOf('function Invoke-BunnyVoiceIntent'), voice.indexOf('function Set-BunnyVoiceSnapshot'));
  assert.match(intent, /\$script:bunnyVoiceUiEpoch -ne \$epoch/);
  assert.match(intent, /\$script:bunnyVoiceUiSeen = 0\.0/);
  assert.match(voice, /\$script:bunnyVoiceUiEpoch = \$null/);
});

test('R1-truth#6 the WPF Interrupt control is enabled only from a fresh snapshot, like the Speaking label', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$bunnyControls\.VoiceInterrupt\.IsEnabled = \$online -and \$open -and \$fresh -and \(\[bool\]\$snap\.playing -or \[bool\]\$snap\.outputHeld -or \$state -eq 'PROCESSING'\)/);
  assert.match(voice, /if \(-not \$Fresh\) \{ return 'Reconnecting'/);
});

test('R1-races#2 acceptVoice drops a stale answer before any press reset or polling stop', () => {
  const store = read(storePath);
  const body = store.slice(store.indexOf('const acceptVoice = (next'), store.indexOf('let pressTurn'));
  const gate = body.indexOf('if (!acceptVoiceSnapshot(current, next)) return;');
  assert.ok(gate > 0, 'stale gate present');
  assert.ok(gate < body.indexOf('press = pressReset();'), 'stale gate runs before the press reset');
  assert.ok(gate < body.indexOf('stopVoicePolling();'), 'stale gate runs before polling stops');
});

test('R1-truth#5 the desktop level meter and the WPF level meter both read snapshot.level.at against the local clock', () => {
  const model = read(modelPath);
  assert.match(model, /now - level\.at >= VOICE_FRESH_MS/);
  const voice = read(voicePath);
  assert.match(voice, /\(\$now - \[double\]\$snap\.level\.at\) -lt \$bunnyVoiceFreshMs/);
});

// Round-2 review fixes (M-A-3 T10). The behaviour checks run the real WPF functions, extracted by name from the Voice
// file, under Windows PowerShell 5.1 with a fake clock and a fake HttpClient. The Host is never contacted.
function extractPsFunction(text, name) {
  const marker = text.includes(`function ${name} `) ? `function ${name} ` : `function ${name}(`;
  const start = text.indexOf(marker);
  assert.ok(start >= 0, `${name} exists`);
  // Skip the parameter list by matching its parentheses (defaults such as @{} sit inside it); the body opens at the next brace.
  let cursor = start + `function ${name}`.length;
  while (text[cursor] === ' ') cursor += 1;
  if (text[cursor] === '(') {
    let parens = 0;
    for (; cursor < text.length; cursor += 1) {
      if (text[cursor] === '(') parens += 1;
      else if (text[cursor] === ')') {
        parens -= 1;
        if (parens === 0) break;
      }
    }
  }
  const open = text.indexOf('{', cursor);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '{') depth += 1;
    else if (text[i] === '}') {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  throw new Error(`${name} is not closed`);
}

const HARNESS_FUNCTIONS = [
  'Add-BunnyVoiceRequest', 'Start-BunnyVoiceFlight', 'Set-BunnyVoiceStartOutcome', 'Set-BunnyVoiceFlightLost',
  'Complete-BunnyVoiceResponse', 'Invoke-BunnyVoicePump', 'Invoke-BunnyVoicePumpCore', 'Get-BunnyVoiceSource',
  'Invoke-BunnyVoiceIntent', 'Set-BunnyVoiceSnapshot', 'Test-BunnyVoiceQueued', 'Start-BunnyVoiceListen',
  'Stop-BunnyVoiceListen', 'Invoke-BunnyVoiceClick', 'Start-BunnyVoicePointer', 'Stop-BunnyVoicePointer',
  'Clear-BunnyVoiceOpening', 'Invoke-BunnyVoiceCloseNow', 'Get-BunnyVoiceLiveProposal', 'Get-BunnyVoiceLabel',
  'Get-BunnyHandsFreeRow', 'Get-BunnyBargeInNote', 'Set-BunnyHandsFree', 'Start-BunnyHandsFreeListen', 'Finish-BunnyVoiceTurn',
  'Start-BunnyHotkeyHold',
];

// Test doubles: the clock, the Host (a fake HttpClient that answers every request with a new turn for listen.start),
// and the Island's UI hooks. They are defined after the extracted functions, so they replace nothing real.
const HARNESS_DOUBLES = `
function Get-BunnyNowMs { [double]$script:fakeNow }
function Open-BunnyDashboard([string]$Query) { [void]$script:dashboardCalls.Add($Query) }
function Set-BunnyView([string]$View) { }
function Resize-Bunny { }
function New-BunnyVoiceRequestMessage([string]$Action, $Data) { [pscustomobject]@{ action = $Action; data = $Data } }
function Get-BunnyVoiceClient { $script:client }
function New-FakeTask([bool]$Done, [bool]$Faulted, $Result) {
  $task = [pscustomobject]@{ IsCompleted = $Done; IsFaulted = $Faulted; IsCanceled = $false; Result = $Result }
  $task | Add-Member -MemberType ScriptMethod -Name Wait -Value { param($ms) $true }
  return $task
}
$script:client = [pscustomobject]@{}
$script:client | Add-Member -MemberType ScriptMethod -Name SendAsync -Value {
  param($req)
  [void]$script:wire.Add($req)
  if ($script:loseNext) { $script:loseNext = $false; return New-FakeTask $false $false $null }
  if ($req.action -eq 'voice.listen.start') { $script:turnN++; $script:curTurn = 'T' + [string]$script:turnN }
  $script:lastBody = '{"data":{"protocol":"bunny-voice/1","open":true,"turnId":"' + $script:curTurn + '","hostEpoch":"e1","state":"LISTENING","devices":{}}}'
  $content = [pscustomobject]@{}
  $content | Add-Member -MemberType ScriptMethod -Name ReadAsStringAsync -Value { New-FakeTask $true $false $script:lastBody }
  return New-FakeTask $true $false ([pscustomobject]@{ StatusCode = 200; Content = $content })
}
# The shortcut hold timer: a fake that counts starts, so a hands-free press that must not start a hold is observable.
$script:bunnyVoiceHotkeyTimer = [pscustomobject]@{ Starts = 0 }
$script:bunnyVoiceHotkeyTimer | Add-Member -MemberType ScriptMethod -Name Start -Value { $this.Starts++ }
$script:bunnyVoiceHotkeyTimer | Add-Member -MemberType ScriptMethod -Name Stop -Value { }
$bunnyOnline = $true
$bunnyEllipsis = '...'
$bunnyDot = '-'
$bunnySnapshot = $null
function Reset-Harness {
  $script:fakeNow = 1000000
  $script:wire = New-Object System.Collections.ArrayList
  $script:dashboardCalls = New-Object System.Collections.ArrayList
  $script:loseNext = $false
  $script:turnN = 0
  $script:curTurn = 'T0'
  $script:bunnyVoiceQueue = New-Object System.Collections.ArrayList
  $script:bunnyVoiceFlight = $null
  $script:bunnyVoiceSnapshot = $null
  $script:bunnyVoiceListening = $false
  $script:bunnyVoiceHeld = $false
  $script:bunnyVoiceHotkeyTimer.Starts = 0
  $script:bunnyVoiceTapLatched = $false
  $script:bunnyVoiceOpenSent = $false
  $script:bunnyVoicePointerClick = $false
  $script:bunnyVoicePointerUpAt = 0
  $script:bunnyVoiceStartState = 'none'
  $script:bunnyVoiceStartTurn = $null
  $script:bunnyVoiceUiSeen = $null
  $script:bunnyVoiceUiEpoch = $null
  $script:bunnyVoiceError = $null
  $script:bunnyVoiceOkAt = 0
  $script:bunnyVoiceMouseAt = 0
  $script:bunnyVoiceListenAt = 0
  $script:bunnyVoiceLastPoll = 0
}
function Drain { for ($i = 0; $i -lt 40; $i++) { Invoke-BunnyVoicePump } }
function Wire-Lines {
  @($script:wire | ForEach-Object {
    $line = [string]$_.action
    if ($_.data -and $_.data.source) { $line += ':' + [string]$_.data.source }
    if ($_.data -and $_.data.turnId) { $line += '@' + [string]$_.data.turnId }
    $line
  })
}
function Intent($seq, $kind) {
  $intent = $null
  if ($null -ne $seq) { $intent = [pscustomobject]@{ seq = $seq; kind = $kind; agentId = $null } }
  [pscustomobject]@{ hostEpoch = 'e1'; uiIntent = $intent }
}
`;

const HARNESS_SCENARIOS = `
Reset-Harness
Start-BunnyVoicePointer; $script:fakeNow += 600; Stop-BunnyVoicePointer; Invoke-BunnyVoiceClick; Drain
$r['hold600'] = Wire-Lines

Reset-Harness
Start-BunnyVoicePointer; $script:fakeNow += 100; Stop-BunnyVoicePointer; Invoke-BunnyVoiceClick; Drain
$script:fakeNow += 2000
Start-BunnyVoicePointer; $script:fakeNow += 600; Stop-BunnyVoicePointer; Invoke-BunnyVoiceClick; Drain
$r['tapThenHeldSecondTap'] = Wire-Lines
$r['tapLatched'] = [bool]$script:bunnyVoiceTapLatched

Reset-Harness
Invoke-BunnyVoiceClick; Drain; Invoke-BunnyVoiceClick; Drain
$r['keyboardToggle'] = Wire-Lines

Reset-Harness
Start-BunnyVoiceListen 'push_to_talk'; Stop-BunnyVoiceListen; Drain
$r['releaseQueuedBeforeAck'] = Wire-Lines

Reset-Harness
Start-BunnyVoiceListen 'push_to_talk'; Drain
Stop-BunnyVoiceListen; Drain
$script:loseNext = $true
Start-BunnyVoiceListen 'push_to_talk'; Drain
$script:fakeNow += 13000; Drain
$r['lostStartStateBeforeRelease'] = [string]$script:bunnyVoiceStartState
Stop-BunnyVoiceListen; Drain
$r['lostStartRelease'] = Wire-Lines

Reset-Harness
$script:loseNext = $true
Start-BunnyVoiceListen 'hotkey'
Invoke-BunnyVoiceCloseNow
$r['closeOrdering'] = Wire-Lines
$r['closeQueueLeft'] = @($script:bunnyVoiceQueue | ForEach-Object { [string]$_.action })
$r['closeOpenSent'] = [bool]$script:bunnyVoiceOpenSent

Reset-Harness
Invoke-BunnyVoiceIntent (Intent $null $null)
Invoke-BunnyVoiceIntent (Intent 1 'open_workspace')
Invoke-BunnyVoiceIntent (Intent 1 'open_workspace')
$r['intentFirstNull'] = @($script:dashboardCalls | ForEach-Object { [string]$_ })

Reset-Harness
Invoke-BunnyVoiceIntent (Intent 4 'open_workspace')
Invoke-BunnyVoiceIntent (Intent 4 'open_workspace')
$r['intentPreexisting'] = @($script:dashboardCalls | ForEach-Object { [string]$_ })

Reset-Harness
$now = [double]$script:fakeNow
$expired = [pscustomobject]@{ open = $true; muted = $false; capturing = $false; playing = $false; state = 'LISTENING'; proposal = [pscustomobject]@{ agentName = 'Alpha'; expiresAt = ($now - 1) } }
$live = [pscustomobject]@{ open = $true; muted = $false; capturing = $false; playing = $false; state = 'LISTENING'; proposal = [pscustomobject]@{ agentName = 'Alpha'; expiresAt = ($now + 30000) } }
$pExpired = Get-BunnyVoiceLiveProposal $expired $now
$pLive = Get-BunnyVoiceLiveProposal $live $now
$r['expiredProposalIsNull'] = ($null -eq $pExpired)
$r['expiredLabel'] = [string](Get-BunnyVoiceLabel $expired $true $true 'LISTENING' @() ([bool]$pExpired))
$r['liveLabel'] = [string](Get-BunnyVoiceLabel $live $true $true 'LISTENING' @() ([bool]$pLive))

Reset-Harness
function NewSnap([string]$Mode, $Duplex, [bool]$Muted, [bool]$Held, [bool]$Capturing, [bool]$Playing, $Fault, $Barge, $TurnId, [bool]$Open = $true) {
  [pscustomobject]@{ open = $Open; mode = $Mode; muted = $Muted; state = 'LISTENING'; capturing = $Capturing; playing = $Playing; outputHeld = $Held; duplex = $Duplex; error = $Fault; lastBargeIn = $Barge; inputTurnId = $TurnId; devices = $null }
}
function Dx([bool]$Active, [bool]$Starting, [bool]$Releasing, [bool]$Available, $Stopped) {
  [pscustomobject]@{ available = $Available; active = $Active; starting = $Starting; releasing = $Releasing; stopped = $Stopped }
}
$r['rowPttIsEmpty'] = [string](Get-BunnyHandsFreeRow (NewSnap 'push_to_talk' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null))
$r['rowStarting'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $false $true $false $true $null) $false $false $false $false $null $null $null))
$r['rowActive'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $true $false $false $true $null) $false $false $true $false $null $null $null))
$r['rowHeld'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $true $false $false $true $null) $false $true $true $false $null $null $null))
$r['rowReleasing'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $true $false $true $true $null) $false $false $true $false $null $null $null))
$r['rowMuted'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $false $false $false $true $null) $true $false $false $false $null $null $null))
$r['rowAec'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $false $false $false $false $null) $false $false $false $false $null $null $null))
$r['rowIdle'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $false $false $false $true ([pscustomobject]@{ reason = 'idle' })) $false $false $false $false $null $null $null))
$r['rowLifetime'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $false $false $false $true ([pscustomobject]@{ reason = 'lifetime' })) $false $false $false $false $null $null $null))
$r['rowOff'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null))
$r['labelBoth'] = [string](Get-BunnyVoiceLabel (NewSnap 'push_to_talk' $null $false $false $true $true $null $null $null) $true $true 'SPEAKING' @() $false)
$r['labelSpeakOnly'] = [string](Get-BunnyVoiceLabel (NewSnap 'push_to_talk' $null $false $false $false $true $null $null $null) $true $true 'SPEAKING' @() $false)
$r['labelListenOnly'] = [string](Get-BunnyVoiceLabel (NewSnap 'push_to_talk' $null $false $false $true $false $null $null $null) $true $true 'LISTENING' @() $false)
$r['labelHeld'] = [string](Get-BunnyVoiceLabel (NewSnap 'hands_free' $null $false $true $false $false $null $null $null) $true $true 'SPEAKING' @() $false)
$r['labelNotCapturing'] = [string](Get-BunnyVoiceLabel (NewSnap 'push_to_talk' $null $false $false $false $false $null $null $null) $true $true 'LISTENING' @() $false)
$r['bargeNote'] = [string](Get-BunnyBargeInNote (NewSnap 'push_to_talk' $null $false $false $false $false $null ([pscustomobject]@{ detectionToSilenceMs = 180.4 }) $null))
$r['bargeNone'] = [string](Get-BunnyBargeInNote (NewSnap 'push_to_talk' $null $false $false $false $false $null ([pscustomobject]@{ detectionToSilenceMs = $null }) $null))
$r['rowClosed'] = [string](Get-BunnyHandsFreeRow (NewSnap 'hands_free' (Dx $false $false $false $true ([pscustomobject]@{ reason = 'idle' })) $false $false $false $false $null $null $null $false))
$r['bargeClosed'] = [string](Get-BunnyBargeInNote (NewSnap 'hands_free' $null $false $false $false $false $null ([pscustomobject]@{ detectionToSilenceMs = 180.4 }) $null $false))

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'hands_free' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null
Start-BunnyVoiceListen 'push_to_talk'; Drain
$r['pttInHandsFreeWire'] = (Wire-Lines) -join ','
$r['pttInHandsFreeListening'] = [bool]$script:bunnyVoiceListening

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'hands_free' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null
Start-BunnyHotkeyHold; Drain
$r['hotkeyHandsFreeWire'] = (Wire-Lines) -join ','
$r['hotkeyHandsFreeHeld'] = [bool]$script:bunnyVoiceHeld
$r['hotkeyHandsFreeTimer'] = [int]$script:bunnyVoiceHotkeyTimer.Starts

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'hands_free' (Dx $true $false $false $true $null) $false $false $true $false $null $null 'I1'
Start-BunnyHotkeyHold; Drain
$r['hotkeyLiveWire'] = (Wire-Lines) -join ','
$r['hotkeyLiveTimer'] = [int]$script:bunnyVoiceHotkeyTimer.Starts

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'push_to_talk' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null
Start-BunnyHotkeyHold; Drain
$r['hotkeyPttWire'] = (Wire-Lines) -join ','
$r['hotkeyPttTimer'] = [int]$script:bunnyVoiceHotkeyTimer.Starts

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'push_to_talk' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null
Start-BunnyVoiceListen 'push_to_talk'; Drain
Set-BunnyHandsFree $true; Drain
$r['switchWhileListeningWire'] = (Wire-Lines) -join ','
$r['switchWhileListeningListening'] = [bool]$script:bunnyVoiceListening

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'hands_free' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null
Start-BunnyHandsFreeListen; Drain
$r['startHandsFreeWire'] = (Wire-Lines) -join ','

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'hands_free' (Dx $true $false $false $true $null) $false $false $true $false $null $null 'I1'
Finish-BunnyVoiceTurn; Drain
$r['finishWire'] = (Wire-Lines) -join ','

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'hands_free' (Dx $true $false $false $true $null) $false $false $true $false $null $null $null
Finish-BunnyVoiceTurn; Drain
$r['finishNoTurnWire'] = (Wire-Lines) -join ','

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'push_to_talk' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null
Set-BunnyHandsFree $true; Drain
$r['toggleOnSendsOnlyOpen'] = (Wire-Lines) -join ','

Reset-Harness
$script:bunnyVoiceSnapshot = NewSnap 'hands_free' (Dx $false $false $false $true $null) $false $false $false $false $null $null $null
Set-BunnyHandsFree $true; Drain
$r['toggleAlreadyOnSendsNothing'] = (Wire-Lines) -join ','
`;

function buildVoiceHarness(text) {
  const constantsStart = text.indexOf('$bunnyVoicePollMs = 200');
  const constantsEnd = text.indexOf('$bunnyNativeKeysDefinition');
  const stateStart = text.indexOf('$script:bunnyVoiceSnapshot = $null');
  const stateEnd = text.indexOf('function Get-BunnyNowMs');
  assert.ok(constantsStart > 0 && constantsEnd > constantsStart && stateStart > 0 && stateEnd > stateStart, 'harness anchors');
  const functions = HARNESS_FUNCTIONS.map((name) => extractPsFunction(text, name)).join('\n\n');
  return [
    'param([string]$Out)',
    "$ErrorActionPreference = 'Stop'",
    '$script:fakeNow = 1000000',
    text.slice(constantsStart, constantsEnd),
    text.slice(stateStart, stateEnd),
    functions,
    HARNESS_DOUBLES,
    '$r = [ordered]@{}',
    HARNESS_SCENARIOS,
    '[IO.File]::WriteAllText($Out, (ConvertTo-Json -InputObject $r -Depth 5), (New-Object Text.UTF8Encoding $false))',
    '',
  ].join('\n');
}

let voiceHarnessResult = null;
function runVoiceHarness() {
  if (voiceHarnessResult) return voiceHarnessResult;
  const dir = mkdtempSync(join(tmpdir(), 'island-voice-r2-'));
  try {
    const script = join(dir, 'harness.ps1');
    const out = join(dir, 'out.json');
    writeFileSync(script, buildVoiceHarness(read(voicePath)), 'utf8');
    const run = spawnSync('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', script, '-Out', out], { encoding: 'utf8', timeout: 120000 });
    assert.equal(run.status, 0, run.stderr || run.stdout);
    voiceHarnessResult = JSON.parse(read(out).replace(/^\uFEFF/, ''));
    return voiceHarnessResult;
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('R2-races#0 holding the mic 600 ms sends one listen.start and one listen.end, and the release Click restarts nothing', { skip }, () => {
  assert.deepEqual(runVoiceHarness().hold600, ['voice.session.open', 'voice.listen.start:push_to_talk', 'voice.listen.end@T1']);
});

test('R2-races#0 a second tap held 600 ms ends the latched turn and its release Click starts nothing new', { skip }, () => {
  const r = runVoiceHarness();
  assert.deepEqual(r.tapThenHeldSecondTap, ['voice.session.open', 'voice.listen.start:push_to_talk', 'voice.listen.end@T1']);
  assert.equal(r.tapLatched, false);
});

test('R2-races#0 keyboard activation still toggles (no pointer Click pending)', { skip }, () => {
  assert.deepEqual(runVoiceHarness().keyboardToggle, ['voice.session.open', 'voice.listen.start:button', 'voice.listen.end@T1']);
});

test('R2-races#0 static: the pointer Click is consumed by a flag set on release, not by the mouse-down timestamp', () => {
  const voice = read(voicePath);
  const click = voice.slice(voice.indexOf('function Invoke-BunnyVoiceClick'), voice.indexOf('function Start-BunnyVoicePointer'));
  assert.match(click, /\$script:bunnyVoicePointerClick = \$false/);
  assert.doesNotMatch(click, /bunnyVoiceMouseAt/);
  const up = voice.slice(voice.indexOf('function Stop-BunnyVoicePointer'), voice.indexOf('# Opens and listens that were queued'));
  assert.match(up, /\$script:bunnyVoicePointerClick = \$true/);
});

test('R2-races#1 a release queued before the listen.start is acknowledged binds to that start turn', { skip }, () => {
  assert.deepEqual(runVoiceHarness().releaseQueuedBeforeAck, ['voice.session.open', 'voice.listen.start:push_to_talk', 'voice.listen.end@T1']);
});

test('R2-races#1 a lost listen.start leaves the later release unbound, so it ends whatever capture the Host holds', { skip }, () => {
  const r = runVoiceHarness();
  assert.equal(r.lostStartStateBeforeRelease, 'unknown');
  assert.deepEqual(r.lostStartRelease, [
    'voice.session.open',
    'voice.listen.start:push_to_talk',
    'voice.listen.end@T1',
    'voice.listen.start:push_to_talk',
    'voice.listen.end',
  ]);
});

test('R2-races#5 closing sends no queued-but-unsent open or listen, and the close lands after the open in flight', { skip }, () => {
  const r = runVoiceHarness();
  assert.deepEqual(r.closeOrdering, ['voice.session.open', 'voice.session.close:island_exit'], 'the exit close names its source');
  assert.deepEqual(r.closeQueueLeft, []);
  assert.equal(r.closeOpenSent, false);
});

test('R2-races#5 static: the window close sends the session close whenever an open or listen was sent or queued', () => {
  const voice = read(voicePath);
  const closing = voice.slice(voice.indexOf('$bunnyWindow.Add_Closing'), voice.indexOf('$bunnyWindow.Add_Closed'));
  assert.match(closing, /if \(\$script:bunnyVoiceOpenPolling -or \$script:bunnyVoiceOpenSent\)/);
});

test('R2-truth#0 the first snapshot without an intent seeds the floor, so the first intent after start opens the workspace once', { skip }, () => {
  const r = runVoiceHarness();
  assert.deepEqual(r.intentFirstNull, ['?view=agentic']);
  assert.deepEqual(r.intentPreexisting, [], 'an intent already present when the Island starts is not replayed');
});

test('R2-truth#1 an expired proposal shows neither Needs approval nor a Confirm target', { skip }, () => {
  const r = runVoiceHarness();
  assert.equal(r.expiredProposalIsNull, true);
  assert.equal(r.expiredLabel, 'Ready');
  assert.equal(r.liveLabel, 'Needs approval');
  const voice = read(voicePath);
  assert.match(voice, /\$proposal = Get-BunnyVoiceLiveProposal \$snap \$now/);
  assert.match(voice, /\$bunnyControls\.VoiceConfirm\.IsEnabled = \$online -and \[bool\]\$proposal/);
});

test('R2-fixcheck#1 the desktop hold-to-talk listen.start sends source push_to_talk through the store', () => {
  const store = read(storePath);
  assert.match(store, /voiceCallOutcome\("voice\.listen\.start", pressListenPayload\(\)\)/);
  assert.doesNotMatch(store, /voiceCall\("voice\.listen\.start"\)/);
});

test('R2-races#2 the desktop press maps a transport failure to unknown (defensive end) and a Host refusal to refused', () => {
  const store = read(storePath);
  assert.match(store, /outcome: "unknown",\r?\n\s+code: "HOST_UNREACHABLE"/);
  assert.match(store, /const started: StartOutcome = snapshot \? "started" : outcome === "refused" \? "refused" : "unknown";/);
  assert.match(store, /await runPress\(pressEnded\(press\)\)/);
});

// T12 UI lane. The hands-free surface is mode-only on the toggle, starts only by an explicit control, and never reopens the
// microphone on unmute. The static checks pin the controls and copy; the harness scenarios above run the real functions.
test('T12 UI-07 the WPF hands-free notice and the AEC copy are the same strings as voice-model.ts', () => {
  const voice = read(voicePath);
  const model = read(modelPath);
  const notice = 'Hands-free keeps the microphone on while Bunny speaks, using Windows echo cancellation on the default speaker. It turns off after 2 minutes of silence and after 30 minutes.';
  const aec = 'Echo-cancelled hands-free audio is unavailable. Use push-to-talk.';
  assert.ok(model.includes(notice), 'shared notice copy in voice-model.ts');
  assert.ok(voice.includes(notice), 'WPF notice copy');
  assert.ok(model.includes(aec), 'shared AEC copy in voice-model.ts');
  assert.ok(voice.includes(aec), 'WPF AEC copy');
  assert.doesNotMatch(voice, /echo cancellation on the default speaker\.\s*Sessions|30 minutes\.\s*Hands-free listens continuously/);
});

test('T12 UI-01 the hands-free toggle is mode-only in WPF, and a mode switch never sends listen.start', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$bunnyControls\.VoiceHandsFree\.IsChecked = \$handsFreeMode/);
  const setter = voice.slice(voice.indexOf('function Set-BunnyHandsFree'), voice.indexOf('# A proposal the Host has not expired yet'));
  assert.doesNotMatch(setter, /voice\.listen\.start/);
  assert.match(setter, /if \(\[string\]\$snap\.mode -eq \$mode\) \{ return \}/);
});

test('T12 UI-01 the explicit Start hands-free is the only WPF path that sends a hands-free listen.start, and it is named', () => {
  const voice = read(voicePath);
  const starts = [...voice.matchAll(/'voice\.listen\.start' @\{ source = 'hands_free' \}/g)];
  assert.equal(starts.length, 1, 'exactly one hands-free listen.start site');
  const fn = voice.slice(voice.indexOf('function Start-BunnyHandsFreeListen'), voice.indexOf('function Finish-BunnyVoiceTurn'));
  assert.match(fn, /\$snap\.mode\) -eq 'hands_free'|\[string\]\$snap\.mode -eq 'hands_free'/);
  assert.match(voice, /'Start hands-free'/);
  assert.match(voice, /AutomationProperties\]::SetName\(\$script:bunnyVoiceStart, 'Start hands-free listening'\)/);
});

test('T12 P7 unmute never reopens the microphone in WPF: the Mute handler sends voice.mute only', () => {
  const voice = read(voicePath);
  const mute = voice.slice(voice.indexOf('$bunnyControls.VoiceMute.Add_Click'), voice.indexOf('$bunnyControls.VoiceClose.Add_Click'));
  assert.match(mute, /'voice\.mute'/);
  assert.doesNotMatch(mute, /voice\.listen\.start|Start-BunnyVoiceListen|Start-BunnyHandsFreeListen/);
});

test('T12 UI-02 the WPF Finish my turn control ends the live input by its input id and is named', () => {
  const voice = read(voicePath);
  const fn = voice.slice(voice.indexOf('function Finish-BunnyVoiceTurn'), voice.indexOf('# ---- wiring'));
  assert.match(fn, /\$snap\.duplex\.active/);
  assert.match(fn, /'voice\.listen\.end' @\{ turnId = \[string\]\$snap\.inputTurnId \}/);
  assert.match(voice, /'Finish my turn'/);
  assert.match(voice, /SetName\(\$script:bunnyVoiceFinish, 'Finish my turn'\)/);
});

test('T12 UI-02 the WPF talk button is disabled in hands-free, so no release caption can sit on a disabled control', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$bunnyControls\.VoiceMic\.IsEnabled = \$online -and -not \$handsFreeMode/);
  assert.match(voice, /\$bunnyControls\.VoiceButton\.IsEnabled = \$online -and -not \$handsFreeMode/);
});

test('T12 UI-04 WPF interrupt enablement matches React: playing, thinking or holding a reply, from a fresh snapshot', () => {
  const voice = read(voicePath);
  assert.match(voice, /\$bunnyControls\.VoiceInterrupt\.IsEnabled = \$online -and \$open -and \$fresh -and \(\[bool\]\$snap\.playing -or \[bool\]\$snap\.outputHeld -or \$state -eq 'PROCESSING'\)/);
});

test('T12 UI-04 WPF proposal sentence for a Mission stop is "Stop the Mission <title>" and never offers voice confirmation', () => {
  const voice = read(voicePath);
  assert.match(voice, /'mission\.stop' \{ 'Stop' \}/);
  assert.match(voice, /\$subjectWord = if \(\$isMission\) \{ 'the Mission ' \} else \{ '' \}/);
  assert.match(voice, /\$sayConfirm = \[string\]\$proposal\.confirmVia -eq 'voice_or_screen' -and -not \$isMission/);
});

test('T12 UI-09 the WPF composite label order: releasing, then both halves, then speaking only from playing, then held', () => {
  const voice = read(voicePath);
  const fn = voice.slice(voice.indexOf('function Get-BunnyVoiceLabel'), voice.indexOf('function Get-BunnyVoiceDeviceLine'));
  const at = (text) => fn.indexOf(text);
  assert.ok(at("'Releasing microphone'") > 0 && at("'Listening and speaking'") > at("'Releasing microphone'"));
  assert.ok(at("'Speaking'") > at("'Listening and speaking'"));
  assert.ok(at("'Paused for you'") > at("'Speaking'"));
  assert.ok(at("'Listening'") > at("'Paused for you'"));
});

test('T12 UI-03 WPF status row and barge-in receipt are data-only, derived from snapshot.duplex and lastBargeIn, never animated', () => {
  const voice = read(voicePath);
  assert.doesNotMatch(voice, /DoubleAnimation|BeginAnimation|Storyboard|Get-Random|System\.Random/);
  assert.match(voice, /\[Math\]::Round\(\$ms\) \+ ' ms'|\[string\]\[Math\]::Round\(\$ms\)/);
  assert.match(voice, /\$script:bunnyVoiceRow\.Text = \$handsFreeRow/);
  assert.match(voice, /\$script:bunnyVoiceReceipt\.Text = \$receipt/);
});

test('T12 UI-01 the WPF hands-free status row is derived from snapshot.duplex, empty outside hands-free, and never claims more than the Host reports', { skip }, () => {
  const r = runVoiceHarness();
  assert.equal(r.rowPttIsEmpty, '', 'push-to-talk shows no hands-free row');
  assert.equal(r.rowStarting, 'Starting...');
  assert.equal(r.rowActive, 'Listening while Bunny speaks (echo-cancelled)');
  assert.equal(r.rowHeld, 'Paused for you');
  assert.equal(r.rowReleasing, 'Releasing microphone...');
  assert.equal(r.rowMuted, 'Muted');
  assert.equal(r.rowAec, 'Echo-cancelled hands-free audio is unavailable. Use push-to-talk.');
  assert.equal(r.rowIdle, 'Stopped after 2 minutes of silence');
  assert.equal(r.rowLifetime, 'Stopped after 30 minutes');
  assert.equal(r.rowOff, 'Off. Press Start hands-free to listen.');
});

test('T12 composite truth in WPF: Listening and speaking only with capture and playback, Speaking only from playback, Paused for a held reply', { skip }, () => {
  const r = runVoiceHarness();
  assert.equal(r.labelBoth, 'Listening and speaking');
  assert.equal(r.labelSpeakOnly, 'Speaking');
  assert.equal(r.labelListenOnly, 'Listening');
  assert.equal(r.labelHeld, 'Paused for you');
  assert.notEqual(r.labelNotCapturing, 'Listening', 'no capture confirmed means no Listening claim');
});

test('T12 UI-03 the WPF barge-in receipt shows the measured time and nothing when unmeasured', { skip }, () => {
  const r = runVoiceHarness();
  assert.equal(r.bargeNote, 'Stopped speaking in 180 ms');
  assert.equal(r.bargeNone, '');
});

test('T12 UI-01/P7 WPF: Start hands-free sends the one explicit grant, Finish my turn ends the input by id, and a toggle never starts listening', { skip }, () => {
  const r = runVoiceHarness();
  // Each list is joined with commas in the harness (PowerShell unrolls one-element arrays), so an empty list is an empty string.
  const list = (value) => (value ? String(value).split(',') : []);
  assert.deepEqual(list(r.startHandsFreeWire), ['voice.listen.start:hands_free']);
  assert.deepEqual(list(r.finishWire), ['voice.listen.end@I1']);
  assert.deepEqual(list(r.finishNoTurnWire), [], 'no input turn id means no release is sent');
  assert.deepEqual(list(r.toggleOnSendsOnlyOpen), ['voice.session.open'], 'turning hands-free on opens the session only');
  assert.deepEqual(list(r.toggleAlreadyOnSendsNothing), [], 'the toggle reflects mode and sends nothing when the mode already matches');
});

test('T12 lane2 the WPF shortcut press in hands-free is the explicit hands-free start: no hold, no release, no duplex restart', { skip }, () => {
  const r = runVoiceHarness();
  const list = (value) => (value ? String(value).split(',') : []);
  assert.deepEqual(list(r.hotkeyHandsFreeWire), ['voice.listen.start:hands_free'], 'one hands-free start, as the Start control sends');
  assert.equal(r.hotkeyHandsFreeHeld, false, 'no hold is recorded, so no release can end the duplex input');
  assert.equal(r.hotkeyHandsFreeTimer, 0, 'the release poll never starts');
  assert.deepEqual(list(r.hotkeyLiveWire), [], 'a press while the duplex lane is live sends nothing');
  assert.equal(r.hotkeyLiveTimer, 0);
  assert.deepEqual(list(r.hotkeyPttWire), ['voice.listen.start:hotkey'], 'the shortcut in push-to-talk keeps its hold');
  assert.equal(r.hotkeyPttTimer, 1);
});

test('T12 lane2 the WPF push-to-talk start is refused in hands-free: no listen.start and no capture intent', { skip }, () => {
  const r = runVoiceHarness();
  assert.equal(r.pttInHandsFreeWire, '', 'nothing reaches the Host');
  assert.equal(r.pttInHandsFreeListening, false);
});

test('T12 lane2 the WPF mode switch ends a held press before the mode changes', { skip }, () => {
  const r = runVoiceHarness();
  const list = (value) => (value ? String(value).split(',') : []);
  assert.deepEqual(list(r.switchWhileListeningWire), ['voice.listen.start:push_to_talk', 'voice.listen.end@T1', 'voice.session.open'], 'the release is queued ahead of the mode open');
  assert.equal(r.switchWhileListeningListening, false);
});

test('T12 lane2 the WPF status row and barge-in receipt are empty while no session is open, even if the Host kept mode and the last receipt', { skip }, () => {
  const r = runVoiceHarness();
  assert.equal(r.rowClosed, '', 'a closed session shows no hands-free row');
  assert.equal(r.bargeClosed, '', 'a closed session shows no barge-in receipt');
});

test('T12 lane2 static: the shortcut branches to the hands-free start before any hold, and push-to-talk never starts in hands-free', () => {
  const voice = read(voicePath);
  const hold = voice.slice(voice.indexOf('function Start-BunnyHotkeyHold'), voice.indexOf('function Invoke-BunnyHotkeyPoll'));
  assert.ok(hold.indexOf('Start-BunnyHandsFreeListen') > 0, 'the hands-free branch exists');
  assert.ok(hold.indexOf('Start-BunnyHandsFreeListen') < hold.indexOf("Start-BunnyVoiceListen 'hotkey'"), 'the branch returns before the hold');
  assert.match(hold, /Start-BunnyHandsFreeListen; return/);
  const listen = voice.slice(voice.indexOf('function Start-BunnyVoiceListen'), voice.indexOf('function Stop-BunnyVoiceListen'));
  assert.match(listen, /-eq 'hands_free'\) \{ return \}/);
  const setter = voice.slice(voice.indexOf('function Set-BunnyHandsFree'), voice.indexOf('# A proposal the Host has not expired yet'));
  assert.ok(setter.indexOf('Stop-BunnyVoiceListen') < setter.indexOf("'voice.session.open'"), 'a held press ends before the mode open is queued');
});

test('T12 lane2 static: the hands-free start is refused unless the session is open in hands_free and the duplex is idle', () => {
  const voice = read(voicePath);
  const fn = voice.slice(voice.indexOf('function Start-BunnyHandsFreeListen'), voice.indexOf('function Finish-BunnyVoiceTurn'));
  assert.match(fn, /-not \(\$snap -and \$snap\.open -and \[string\]\$snap\.mode -eq 'hands_free'\)\) \{ return \}/);
  assert.match(fn, /\$snap\.duplex\.active -or \$snap\.duplex\.starting -or \$snap\.duplex\.releasing/);
});
