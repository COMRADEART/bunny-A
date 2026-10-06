import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { execFileSync, spawn } from 'node:child_process';
import { chain, capStep, cmd, createMission, getMission, getState, health, openRequests, approveMission, respond, saveRecord, STAGE_STATE, until, wait, waitOpenRequest, waitMissionState, BASE, bearer } from './live-shared.ts';

const release = JSON.parse(readFileSync('install/release-pin.json', 'utf8')).release as string;
const series = release.match(/v([0-9]+)-T9/)[0].split('-')[0];
const stamp = () => new Date().toISOString();
const launch = () => capStep('Launcher', 'computer.open_app', { app: 'calculator' }, 'Open Calculator');
const focus = (title = 'Calculator') => capStep('Window', 'computer.focus_window', { title }, 'Focus the requested application');
const press = (automationId: string) => capStep('Arithmetic', 'computer.invoke_control', { title: 'Calculator', automationId }, 'Press a known Calculator arithmetic control');
const result = () => capStep('Result', 'computer.read_calculator', { title: 'Calculator' }, 'Read the calculation result');
const blocker = () => capStep('Sensitive', 'computer.type', { title: 'Calculator', name: 'Password field', text: 'T9_REDACTION_PROBE' }, 'Sensitive input requires its own approval');
const arithmetic = () => [launch(), focus(), ...['clearButton', 'num2Button', 'plusButton', 'num3Button', 'equalButton'].map(press), result()];
async function create(name: string, entries = arithmetic()) {
  const mission = await createMission({ title: `T9 v18 ${name}`, objective: 'Disposable T9 acceptance; explicit deterministic desktop operations, no provider work.', steps: chain(entries) });
  await approveMission(mission.id); return mission;
}
function row(id: string) {
  const db = new DatabaseSync(STAGE_STATE + '/host.sqlite', { readOnly: true });
  try { const found = db.prepare('SELECT record FROM approval_batches WHERE mission_id=? ORDER BY created_at DESC LIMIT 1').get(id) as { record: string } | undefined; return found ? JSON.parse(found.record) : null; }
  finally { db.close(); }
}
async function batch(id: string, options = {}) {
  const ask = await waitOpenRequest(id, { timeoutMs: 30_000 }); assert.ok(ask.batchOffer);
  const response = await respond(ask.id, 'allow_batch', options); assert.equal(response.status, 200);
  return { ask, response };
}
async function halt(id: string) { assert.equal((await cmd('mission.stop', { id })).status, 200); }
async function done(id: string) { return waitMissionState(id, ['completed', 'failed', 'stopped'], { timeoutMs: 90_000 }); }
const runners: Record<string, () => Promise<unknown>> = {
  async R0() {
    const mission = await create('restart explicit controller', [launch(), focus(), blocker(), press('num2Button')]); await batch(mission.id);
    await waitOpenRequest(mission.id, { timeoutMs: 45_000, action: 'computer.type' }); const before = await health();
    const credential = JSON.parse(readFileSync(STAGE_STATE + '/credentials/credentials.json', 'utf8'));
    assert.equal(before.pid, credential.pid); assert.equal(before.instanceId, credential.instanceId);
    const owner = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${before.pid}' | Select-Object ExecutablePath,CommandLine) | ConvertTo-Json -Compress`], { windowsHide: true }).toString());
    assert.ok(owner.ExecutablePath.includes('Bunny-A-T9-stage\\releases\\' + release)); assert.ok(owner.CommandLine.includes('Bunny-Host.mjs'));
    assert.equal(row(mission.id).status, 'active');
    const evidence = { missionId: mission.id, before, batchBefore: row(mission.id), processIdentityCorroborated: true };
    saveRecord(series + '-restart-before.json', evidence);
    execFileSync('taskkill.exe', ['/PID', String(before.pid), '/F'], { windowsHide: true });
    return evidence;
  },
  async R1() {
    const before = JSON.parse(readFileSync('test-results/ma2-gate9/' + series + '-restart-before.json', 'utf8'));
    const after = await health(); assert.notEqual(after.instanceId, before.before.instanceId); assert.notEqual(after.pid, before.before.pid); assert.equal(after.operationalState, 'healthy');
    const data = await getMission(before.missionId); assert.equal(data.mission.batch, null); assert.equal(row(before.missionId).endReason, 'host_restart');
    assert.equal(data.mission.state, 'waiting_for_user'); assert.equal(data.runs.filter((run) => run.action === 'computer.type').length, 0);
    // T3 only interrupts executing steps. A permission-paused step stays paused;
    // recovery must not execute it or manufacture a failure/completion.
    const request = data.mission.requests.find((request) => request.resolvedAt === null)!;
    assert.ok(request); assert.equal(request.action, 'computer.type');
    assert.ok(data.mission.steps.some((step) => step.id === request.stepId && step.state === 'waiting_for_approval'));
    const answered = data.mission.requests.find((request) => request.resolution === 'allow_batch')!; assert.ok(answered);
    assert.ok((await respond(answered.id, 'allow_batch')).status >= 400);
    assert.ok((await respond(request.id, 'allow_batch')).status >= 400);
    const evidence = { ...before, after, batchAfter: row(before.missionId), pendingMutationReplayed: false, pausedStepPreserved: true, oldApprovalRefused: true, events: data.events };
    await halt(before.missionId); saveRecord(series + '-R-live.json', { release, recordedAt: stamp(), ok: true, evidence }); return evidence;
  },
  async B() {
    const mission = await create('positive batch'); const begin = Date.now(); const { ask } = await batch(mission.id);
    const finished = await done(mission.id); const evidence = await getMission(mission.id);
    assert.equal(finished.state, 'completed', JSON.stringify(finished.steps.map((s) => s.failure)));
    assert.equal(evidence.mission.requests.length, 1);
    assert.equal(row(mission.id).usedCount, 7);
    assert.ok(evidence.runs.find((run) => run.action === 'computer.read_calculator' && /5/.test(run.summary ?? '')));
    return { missionId: mission.id, prompts: 1, mutations: 7, readActions: 1, offer: ask.batchOffer, batch: row(mission.id), timeMs: Date.now() - begin, runs: evidence.runs, events: evidence.events };
  },
  async A() {
    const mission = await create('single action baseline'); const begin = Date.now(); let prompts = 0;
    const finished = await until(async () => {
      const evidence = await getMission(mission.id); const ask = openRequests(evidence.mission)[0];
      if (ask) { prompts++; assert.equal((await respond(ask.id, 'allow_once')).status, 200); }
      return ['completed', 'failed', 'stopped'].includes(evidence.mission.state) ? evidence : null;
    }, 'allow-once sequence', { timeoutMs: 90_000 });
    assert.equal(finished!.mission.state, 'completed'); assert.equal(prompts, 7); assert.equal(row(mission.id), null);
    return { missionId: mission.id, prompts, mutations: 7, readActions: 1, timeMs: Date.now() - begin, runs: finished!.runs };
  },
  async C() {
    const mission = await create('application boundary', [launch(), focus(), focus('Notepad'), press('num2Button')]); await batch(mission.id);
    const ask = await waitOpenRequest(mission.id, { timeoutMs: 45_000, action: 'computer.focus_window' });
    const data = await getMission(mission.id); assert.equal(data.runs.length, 2); assert.equal(ask.batchOffer, null); assert.equal(row(mission.id).usedCount, 2);
    await halt(mission.id); return { missionId: mission.id, ask, foreignMutations: 0, batch: row(mission.id) };
  },
  async D() {
    const mission = await create('risk boundary', [launch(), focus(), capStep('Destructive probe', 'filesystem.delete', { path: 'T9_NONEXISTENT_DO_NOT_DELETE.txt' }, 'Never approve this destructive probe'), press('num2Button')]); await batch(mission.id);
    const ask = await waitOpenRequest(mission.id, { timeoutMs: 45_000, action: 'filesystem.delete' });
    assert.equal(ask.risk, 'DESTRUCTIVE'); assert.equal(ask.batchOffer, null); assert.equal((await getMission(mission.id)).runs.length, 2);
    await halt(mission.id); return { missionId: mission.id, ask, destructiveMutations: 0, batch: row(mission.id) };
  },
  async E() {
    const mission = await create('budget'); await batch(mission.id, { maxActions: 2 });
    const ask = await waitOpenRequest(mission.id, { timeoutMs: 45_000, action: 'computer.invoke_control' });
    assert.equal(row(mission.id).usedCount, 2); assert.equal(row(mission.id).endReason, 'exhausted'); assert.equal((await getMission(mission.id)).runs.length, 2);
    await halt(mission.id); return { missionId: mission.id, ask, batch: row(mission.id), maxPlusOneAdmitted: false };
  },
  async F() {
    const mission = await create('expiry'); await batch(mission.id, { ttlMs: 1000 });
    const ask = await waitOpenRequest(mission.id, { timeoutMs: 45_000 });
    assert.ok(row(mission.id).expiresAt <= Date.now()); assert.equal(row(mission.id).endReason, 'expired');
    const data = await getMission(mission.id); assert.ok(data.events.some((event) => event.type === 'approval.batch_expired'));
    await halt(mission.id); return { missionId: mission.id, ask, batch: row(mission.id), runs: data.runs };
  },
  async G() {
    const a = await create('stop', [launch(), focus(), blocker(), press('num2Button')]); await batch(a.id);
    await waitOpenRequest(a.id, { timeoutMs: 45_000, action: 'computer.type' });
    const b = await create('unrelated task waits', [launch(), focus()]);
    await waitOpenRequest(b.id); await halt(a.id); const before = (await getMission(a.id)).runs.length; await wait(1500);
    assert.equal((await getMission(a.id)).runs.length, before); assert.equal(row(a.id).endReason, 'mission_ended');
    assert.equal((await getMission(b.id)).mission.state, 'waiting_for_user');
    const oldRequest = (await getMission(a.id)).mission.requests[0]; assert.ok((await respond(oldRequest.id, 'allow_batch')).status >= 400);
    await halt(b.id); return { missionId: a.id, unrelatedMissionId: b.id, mutationsAtStop: before, afterStopMutations: 0, batch: row(a.id) };
  },
  async H() {
    const a = await create('Task A', [launch(), focus(), blocker(), press('num2Button')]); await batch(a.id);
    await waitOpenRequest(a.id, { timeoutMs: 45_000, action: 'computer.type' });
    const b = await create('Task B'); const ask = await waitOpenRequest(b.id);
    assert.ok(ask.batchOffer); assert.equal((await getMission(b.id)).runs.length, 0); assert.equal(row(a.id).usedCount, 2);
    await halt(a.id); await halt(b.id); return { missionA: a.id, missionB: b.id, requestB: ask, inheritedMutations: 0, delegatedTasksCovered: false };
  },
  async G2() {
    const a = await create('stop in flight', [launch(), focus(), ...Array.from({ length: 10 }, () => press('num2Button'))]);
    const b = await create('unrelated pending task', [launch(), focus()]); await waitOpenRequest(b.id);
    await batch(a.id);
    const inFlight = await until(async () => { const data = await getMission(a.id); return data.runs.find((run) => run.status === 'running' && run.action === 'computer.invoke_control') ?? null; }, 'owned mutation in flight', { timeoutMs: 45_000 });
    await halt(a.id); const after = await getMission(a.id); const used = row(a.id).usedCount; await wait(1500);
    const settled = await getMission(a.id); assert.equal(row(a.id).usedCount, used); assert.equal(settled.runs.length, after.runs.length); assert.ok(settled.runs.every((run) => run.status !== 'running'));
    assert.equal(settled.mission.state, 'stopped'); assert.equal(row(a.id).endReason, 'mission_ended'); assert.equal((await getMission(b.id)).mission.state, 'waiting_for_user');
    await halt(b.id); return { missionId: a.id, unrelatedMissionId: b.id, inFlightAction: inFlight!.action, canonicalUsedAtStop: used, futureAdmissions: 0, settledRuns: settled.runs };
  },
  async S() {
    const mission = await create('sensitive input', [launch(), focus(), blocker(), press('num2Button')]); await batch(mission.id);
    const ask = await waitOpenRequest(mission.id, { timeoutMs: 45_000, action: 'computer.type' });
    assert.equal(ask.batchOffer, null); assert.equal((await getMission(mission.id)).runs.filter((run) => run.action === 'computer.type').length, 0);
    await halt(mission.id); return { missionId: mission.id, ask, sensitiveInputExecuted: false };
  },
  async R() {
    const mission = await create('restart', [launch(), focus(), blocker(), press('num2Button')]); await batch(mission.id);
    await waitOpenRequest(mission.id, { timeoutMs: 45_000, action: 'computer.type' }); const before = await health();
    const credential = JSON.parse(readFileSync(STAGE_STATE + '/credentials/credentials.json', 'utf8'));
    assert.equal(before.pid, credential.pid); assert.equal(before.instanceId, credential.instanceId);
    const processInfo = JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `(Get-CimInstance Win32_Process -Filter 'ProcessId = ${before.pid}' | Select-Object ExecutablePath,CommandLine) | ConvertTo-Json -Compress`], { windowsHide: true }).toString());
    assert.ok(processInfo.ExecutablePath.includes('Bunny-A-T9-stage\\releases\\' + release)); assert.ok(processInfo.CommandLine.includes('Bunny-Host.mjs'));
    // Disposable Host crash, corroborated against its live credentials, instance and executable.
    execFileSync('taskkill.exe', ['/PID', String(before.pid), '/F'], { windowsHide: true }); await wait(500);
    const launcher = 'C:/Users/allam/AppData/Local/Bunny-A-T9-stage/releases/' + release + '/Start-Bunny-Release.ps1';
    const bootEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => key.toLowerCase() !== 'psmodulepath'));
    bootEnv.PSModulePath = (process.env.WINDIR ?? 'C:/Windows') + '/System32/WindowsPowerShell/v1.0/Modules';
    const bootstrap = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', launcher, '-NoIsland', '-NoGateway', '-NoRemote'], { windowsHide: true, detached: true, stdio: 'ignore', env: bootEnv });
    bootstrap.unref();
    const after = await until(async () => { try { const value = await health(); return value.operationalState === 'healthy' && value.instanceId !== before.instanceId ? value : null; } catch { return null; } }, 'new staged Host boot', { timeoutMs: 45_000 });
    assert.notEqual(after!.instanceId, before.instanceId); assert.equal(after!.operationalState, 'healthy');
    const data = await getMission(mission.id); assert.equal(data.mission.batch, null); assert.equal(row(mission.id).endReason, 'host_restart');
    assert.equal(data.runs.filter((run) => run.action === 'computer.type').length, 0); assert.equal(data.mission.state, 'waiting_for_user');
    const pending = data.mission.requests.find((request) => request.resolvedAt === null)!; assert.ok((await respond(pending.id, 'allow_batch')).status >= 400);
    await halt(mission.id); return { missionId: mission.id, before, after, batch: row(mission.id), pendingMutationReplayed: false, events: data.events };
  },
  async J() {
    const pair = await cmd('pairing.create', {}); assert.equal(pair.status, 200);
    const response = await fetch(BASE + '/pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code: pair.body.pairCode, name: 'T9 disposable test device' }) });
    const device = await response.json() as { token: string; deviceId: string }; assert.equal(response.status, 200);
    const send = async (action: string, data: unknown) => {
      const response = await fetch(BASE + '/command', { method: 'POST', headers: { authorization: 'Bearer ' + device.token, 'content-type': 'application/json' }, body: JSON.stringify({ action, data }) });
      return { status: response.status, body: await response.json() };
    };
    const mission = await create('remote approval', [launch(), focus(), blocker(), press('num2Button')]); const ask = await waitOpenRequest(mission.id);
    const granted = await send('mission.respond', { requestId: ask.id, decision: 'allow_batch', maxActions: 9999, ttlMs: 999999 }); assert.equal(granted.status, 200);
    await waitOpenRequest(mission.id, { timeoutMs: 45_000, action: 'computer.type' });
    const batchRow = row(mission.id); assert.equal(batchRow.maxActions, ask.batchOffer!.maxActions); assert.equal(batchRow.expiresAt - batchRow.createdAt, ask.batchOffer!.ttlMs); assert.equal(batchRow.createdBy, 'device:' + device.deviceId);
    assert.equal((await send('mission.revoke_batch', { missionId: mission.id, batchId: batchRow.id })).status, 200);
    assert.equal((await getMission(mission.id)).mission.batch, null);
    const revoke = await cmd('device.revoke', { id: device.deviceId }); assert.equal(revoke.status, 200);
    const denied = await send('mission.respond', { requestId: (await getMission(mission.id)).mission.requests[0].id, decision: 'allow_once' }); assert.equal(denied.status, 401);
    await halt(mission.id); return { missionId: mission.id, deviceId: device.deviceId, envelopeSame: true, batch: row(mission.id), revokedDeviceResponse: denied.status, publicTunnelUsed: false, physicalPhoneTested: false };
  },
  async I() {
    const mission = await create('UI scope', [launch(), focus(), blocker(), press('num2Button')]); const ask = await waitOpenRequest(mission.id);
    return { missionId: mission.id, requestId: ask.id, offer: ask.batchOffer, awaitUi: true };
  },
};

const phases = process.argv.slice(2); if (!phases.length) phases.push('B', 'A', 'C', 'D', 'E', 'F', 'G', 'H', 'S', 'R', 'J');
for (const phase of phases) {
  console.log('T9 v18 phase ' + phase + ' starting');
  const recordedAt = stamp();
  try {
    const config = JSON.parse(readFileSync('C:/Users/allam/AppData/Local/Bunny-A-T9-stage/install.json', 'utf8'));
    assert.equal(config.currentRelease.name, release);
    assert.equal((await health()).operationalState, 'healthy');
    if (phase !== 'R1') for (const stray of (await getState()).missions!.missions.filter((mission) => !['completed', 'failed', 'stopped'].includes(mission.state))) await halt(stray.id);
    const evidence = await runners[phase](); saveRecord(series + '-' + phase + '-live.json', { gate: 'M-A-2 T9', release, recordedAt, ok: true, evidence });
    console.log('T9 v18 phase ' + phase + ' PASS');
  } catch (error) {
    saveRecord(series + '-' + phase + '-live.json', { gate: 'M-A-2 T9', release, recordedAt, ok: false, error: error instanceof Error ? error.message : String(error) }); throw error;
  }
}
