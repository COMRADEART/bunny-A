// Corrected, independent LIVE T13 verification. No model output, simulated Host state, native screenshots,
// production service, installed release, or existing dev server participates in this run.
import { startHost, evidence, repo } from './host.mjs';
import { mkdirSync, writeFileSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const out = join(evidence, 'final-live2');
mkdirSync(join(out, 'shots'), { recursive: true });
const beganAt = new Date().toISOString();
const DEV_PORT = 8097;
const checks = [], commands = [], timeline = [], snapshots = [], shots = [], browserErrors = [];
const ids = {};
let host, dev, browser, context, page, polling = false, pollPromise, lastState, fatal = null;
const check = (name, ok, detail = null) => { const c = { name, ok: !!ok, detail }; checks.push(c); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail).slice(0, 300)); };
const record = (s, label) => {
  const picked = { at: new Date().toISOString(), label, personalAgents: s.personalAgents, agents: s.agents, missions: s.missions };
  snapshots.push(picked);
  return picked;
};
const agent = (s, k) => s.agents.agents.find(a => a.id === ids[k]);
const mission = (s, k) => s.missions.missions.find(m => m.id === agent(s, k)?.missionId);
const slot = (s, n) => s.personalAgents.slots.find(x => x.slot === n);
const pending = (s, k) => (mission(s, k)?.requests ?? []).filter(r => r.resolution === null);
const start = async k => {
  const a = agent(await host.state(), k);
  return api('agent.start', { id: ids[k], ...(a.authorization ? { revision: a.authorization.revision } : {}) });
};
const api = async (action, data) => {
  const sentAt = Date.now(), r = await host.api(action, data), ackAt = Date.now();
  commands.push({ action, data, sentAt, ackAt, status: r.status, error: r.body.error ?? null });
  return { ...r, sentAt, ackAt };
};
const until = async (fn, label, timeout = 30000) => {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const s = await host.state(); lastState = s; if (fn(s)) return s; await sleep(100); }
  record(lastState, `TIMEOUT ${label}`); throw new Error(`Timed out: ${label}`);
};
const bind = async assignments => {
  const s = await host.state(), current = s.personalAgents;
  const slots = current.slots.map(x => ({ slot: x.slot, weapon: x.weapon, displayName: x.displayName, description: x.description, purpose: x.purpose, style: x.style, responsibilities: x.responsibilities, agentId: assignments[x.slot] ?? x.agentId, active: x.active }));
  const r = await api('personal_agents.configure', { slots, expectRevision: current.revision });
  check('Host accepts real slot bindings', r.status === 200, assignments);
};
const answerToRunning = async k => {
  const answered = [];
  for (let i = 0; i < 8; i++) {
    const s = await host.state();
    if (['RUNNING', 'VERIFYING', 'COMPLETED', 'FAILED'].includes(agent(s, k).state) && !pending(s, k).length) return { s, answered };
    const p = pending(s, k)[0];
    if (p) { const r = await api('mission.respond', { requestId: p.id, decision: 'allow_once' }); answered.push({ action: p.action, id: p.id, ...r }); check(`Explicit allow_once accepted for ${k} ${p.action}`, r.status === 200); }
    await sleep(350);
  }
  throw new Error(`Did not admit ${k}`);
};
const exists = path => ({ kind: 'capability', action: 'filesystem.exists', params: { path }, expect: { field: 'exists', equals: true } });
const compare = (path, content) => ({ kind: 'capability', action: 'filesystem.compare', params: { path, content }, expect: { field: 'matches', equals: true } });
const step = (role, action, params, access = 'read', dependsOn = [], verify = null) => ({ role, objective: role, access, dependsOn, executor: { kind: 'capability', action, params }, verification: verify ? [verify] : [] });
const testStep = (depends = []) => step('Run real Node tests', 'terminal.exec', { command: 'node', args: ['--test', 'live.test.mjs'] }, 'read', depends, exists('live.test.mjs'));
const facts = () => ({
  weapons: [...document.querySelectorAll('.wc-weapon')].map(e => ({ weapon: e.dataset.weapon, state: e.dataset.state, slot: e.dataset.slot ?? null, cue: e.dataset.cue ?? null, alt: e.querySelector('img')?.alt ?? null })),
  cues: window.__t13Cues ?? [], text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 2200),
  overflowX: document.documentElement.scrollWidth > innerWidth + 1,
  brokenImages: [...document.images].filter(i => !i.complete || !i.naturalWidth).map(i => i.getAttribute('src')),
});
const openPage = async () => {
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'dark' });
  await context.addInitScript(() => {
    window.__t13Cues = [];
    document.addEventListener('DOMContentLoaded', () => new MutationObserver(records => {
      for (const r of records) if (r.target.matches?.('.wc-weapon,.wc-companion')) window.__t13Cues.push({ at: Date.now(), kind: r.attributeName, weapon: r.target.dataset.weapon ?? null, state: r.target.dataset.state, cue: r.target.dataset.cue ?? null });
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-cue', 'data-state'] }));
  });
  page = await context.newPage();
  page.on('pageerror', e => browserErrors.push({ at: Date.now(), type: 'pageerror', error: e.message }));
  page.on('console', m => { if (m.type() === 'error') browserErrors.push({ at: Date.now(), type: 'console', error: m.text().slice(0, 300) }); });
  await page.goto(`http://127.0.0.1:${DEV_PORT}/?view=chat&theme=dark`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('.wc-weapon').length >= 4, null, { timeout: 60000 });
};
const capture = async name => {
  const s = await host.state(); record(s, name);
  const f = await page.evaluate(facts), file = join(out, 'shots', `${name}.png`);
  await page.screenshot({ path: file }); shots.push({ name, file, hostSlots: s.personalAgents.slots.map(x => ({ slot: x.slot, state: x.presentation.state })), ...f });
  console.log('CAPTURE', name);
  return f;
};

try {
  host = await startHost(43862, 'final-live2');
  console.log('OWNED_HOST', host.pid, host.parent);
  writeFileSync(join(out, 'processes.json'), JSON.stringify({ beganAt, hostPid: host.pid, hostPort: host.port, hostParent: host.parent }, null, 2));
  writeFileSync(join(host.workspace, 'seed.txt'), 'seed');
  writeFileSync(join(host.workspace, 'seed2.txt'), 'seed2');
  writeFileSync(join(host.workspace, 'live.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('T13 real test with time to observe admitted state', async () => { await new Promise(r => setTimeout(r, 20000)); assert.equal(1, 1); });\n");
  await api('mission.configure', { enabled: true });
  const specs = {
    A: [step('Read seed without verification', 'filesystem.read', { path: 'seed.txt' })],
    B: [step('Write and compare', 'filesystem.write', { path: 'out.txt', content: 'hello', overwrite: true }, 'write', [], compare('out.txt', 'hello'))],
    C: [testStep()],
    D: [step('Await deletion approval', 'filesystem.delete', { path: 'seed.txt' }, 'write')],
    E: [testStep(), step('Write after resume', 'filesystem.write', { path: 'after-resume.txt', content: 'resumed', overwrite: true }, 'write', [0], compare('after-resume.txt', 'resumed'))],
    F: [step('Await deletion for stop demo', 'filesystem.delete', { path: 'seed2.txt' }, 'write')],
    H: [testStep()],
  };
  for (const [k, steps] of Object.entries(specs)) {
    const r = await api('agent.create', { name: `T13-${k}`, objective: `Live independent ${k}`, steps });
    if (r.status !== 200) throw new Error(`create ${k}: ${r.body.error}`);
    ids[k] = r.body.snapshot.agents.agents.find(a => a.name === `T13-${k}`).id;
  }
  check('Seven durable user Agents created through real Host API', Object.keys(ids).length === 7);
  polling = true;
  pollPromise = (async () => {
    let prior = '';
    while (polling) {
      try {
        const s = await host.state(); lastState = s;
        const rows = s.personalAgents.slots.map(x => ({ slot: x.slot, weapon: x.weapon, agentId: x.agentId, agentState: x.agent?.state, presentation: x.presentation, progress: x.progress, result: x.result }));
        const signature = JSON.stringify(rows);
        if (signature !== prior) { prior = signature; timeline.push({ at: Date.now(), rows }); }
      } catch (e) { timeline.push({ at: Date.now(), pollError: e.message }); }
      await sleep(100);
    }
  })();
  await bind({ 1: ids.A, 2: ids.B, 3: ids.C, 4: ids.D });
  for (const k of ['A', 'B']) check(`agent.start ${k} accepted`, (await start(k)).status === 200);
  await until(s => agent(s, 'A').state === 'COMPLETED' && slot(s, 2).presentation.state === 'VERIFIED', 'read/write settled');
  check('agent.start D accepted', (await start('D')).status === 200);
  await until(s => pending(s, 'D').some(r => r.action === 'filesystem.delete'), 'delete awaits permission');
  await until(s => agent(s, 'A').state === 'COMPLETED' && slot(s, 2).presentation.state === 'VERIFIED' && agent(s, 'C').state === 'CREATED' && pending(s, 'D').some(r => r.action === 'filesystem.delete'), 'four Agents reach settled first phase');
  let s = await host.state();
  check('Unverified read settles COMPLETED without VERIFIED', slot(s, 1).presentation.state === 'COMPLETED' && slot(s, 1).result.unverifiedSteps > 0);
  check('Write and compare VERIFIED is derived from Mission result', slot(s, 2).presentation.state === 'VERIFIED' && slot(s, 2).result.verifiedSteps > 0 && slot(s, 2).result.unverifiedSteps === 0);
  check('Unstarted test remains IDLE and destructive delete requires explicit review', slot(s, 3).presentation.state === 'IDLE' && slot(s, 4).presentation.state === 'WAITING_FOR_USER');

  const devLog = [];
  dev = spawn(process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_PORT)], { cwd: repo, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: host.data, BUNNY_HOST_CREDENTIALS_FILE: host.credentials, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  dev.stdout.on('data', b => { devLog.push(String(b)); writeFileSync(join(out, 'dev.log'), devLog.join('')); });
  dev.stderr.on('data', b => { devLog.push(String(b)); writeFileSync(join(out, 'dev.log'), devLog.join('')); });
  console.log('OWNED_DEV', dev.pid);
  writeFileSync(join(out, 'processes.json'), JSON.stringify({ beganAt, hostPid: host.pid, hostPort: host.port, hostParent: host.parent, devPid: dev.pid, devPort: DEV_PORT }, null, 2));
  let ready = false;
  for (let i = 0; i < 120; i++) {
    if (dev.exitCode !== null) throw new Error(`dev exited ${dev.exitCode}`);
    if (devLog.some(line => /Local:\s+http:\/\/127\.0\.0\.1:8097\/|Local:\s+127\.0\.0\.1:8097/.test(line.replace(/\[[0-9;]*m/g, '')))) { ready = true; break; }
    await sleep(500);
  }
  if (!ready || dev.exitCode !== null) throw new Error('Owned dev server did not confirm readiness');
  browser = await chromium.launch({ headless: true });
  await openPage(); await sleep(1800);
  const first = await capture('01-first-load');
  check('First page shows real completed, idle and waiting Host states', first.weapons.some(w => w.weapon === 'spear' && w.state === 'VERIFIED') && first.weapons.some(w => w.weapon === 'chakra' && w.state === 'IDLE') && first.weapons.some(w => w.weapon === 'sword' && w.state === 'WAITING_FOR_USER'));
  check('Initial verified load does not celebrate', !first.cues.some(c => c.weapon === 'spear' && c.cue === 'verified') && first.weapons.filter(w => w.weapon === 'spear').every(w => w.cue === null));
  await sleep(1600); s = await host.state();
  check('No UI or Host action auto-starts test or grants pending delete', agent(s, 'C').state === 'CREATED' && agent(s, 'D').state === 'WAITING_FOR_USER');

  const c = await start('C');
  check('Explicit reviewed plan approval starts C', c.status === 200);
  s = await until(s => agent(s, 'C').state === 'RUNNING', 'C admitted');
  await sleep(200);
  const finalApprovalSentAt = c.sentAt;
  const cAdmission = timeline.find(x => x.at >= finalApprovalSentAt && x.rows?.some(r => r.agentId === ids.C && r.agentState === 'RUNNING'));
  check('Valid executable and argv run a real Node test', mission(s, 'C').steps.some(x => x.state === 'running' && x.executor.params.command === 'node' && x.executor.params.args[0] === '--test'));
  check('TESTING comes from valid terminal argv', slot(s, 3).presentation.state === 'TESTING', slot(s, 3).presentation);
  const cAck = c.ackAt;
  check('First admitted poll follows explicit approval acknowledgment', !!cAdmission && cAdmission.at >= cAck, { ackAt: cAck, admittedPollAt: cAdmission?.at });
  await sleep(1800); await capture('02-testing');
  await until(s => slot(s, 3).presentation.state === 'VERIFIED', 'C VERIFIED', 45000); await sleep(1500);
  const verified = await capture('03-verified-live');
  s = await host.state();
  check('Real Node test exits zero and Mission verifies it', slot(s, 3).presentation.state === 'VERIFIED', mission(s, 'C').result);
  check('A live verified transition triggers exactly one strip celebration', verified.cues.filter(c => c.kind === 'data-cue' && c.weapon === 'chakra' && c.cue === 'verified').length === 1, {chakra: verified.cues.filter(c => c.weapon === 'chakra' && c.kind === 'data-cue'), allCues: verified.cues});

  await bind({ 2: ids.E }); await start('E');
  s = await until(s => agent(s, 'E').state === 'RUNNING', 'E running');
  check('Pause demo starts from a genuinely running test', slot(s, 2).presentation.state === 'TESTING', slot(s, 2).presentation);
  check('Real Host accepts pause during admitted execution', (await api('agent.pause', { id: ids.E })).status === 200);
  await until(s => slot(s, 2).presentation.state === 'PAUSED', 'E PAUSED'); await sleep(1200);
  const paused = await capture('04-paused');
  check('Web weapon shows PAUSED from canonical Host state', paused.weapons.some(w => w.weapon === 'spear' && w.state === 'PAUSED'), {weapons: paused.weapons.map(x => ({weapon: x.weapon, state: x.state, cue: x.cue}))});
  await until(s => mission(s, 'E').steps[0].state === 'completed', 'admitted test finishes while paused', 45000); await sleep(700);
  s = await host.state();
  check('Pause holds new admissions while admitted step finishes', agent(s, 'E').state === 'PAUSED' && !existsSync(join(host.workspace, 'after-resume.txt')) && mission(s, 'E').steps[1].state === 'pending', mission(s, 'E').steps.map(x => ({ state: x.state, role: x.role })));
  check('Real Host accepts resume', (await api('agent.resume', { id: ids.E })).status === 200);
  await answerToRunning('E'); await until(s => slot(s, 2).presentation.state === 'VERIFIED', 'E VERIFIED', 45000);
  check('Resume admits final write and verifies both steps', readFileSync(join(host.workspace, 'after-resume.txt'), 'utf8') === 'resumed' && slot(await host.state(), 2).result.verifiedSteps === 2);
  await sleep(1200); await capture('05-resumed-verified');

  await bind({ 3: ids.H }); await capture('06-before-close');
  await context.close(); context = null; page = null;
  const closedAt = Date.now(); console.log('CLOSED_WEB_CONTEXT', closedAt);
  check('Host accepts explicit H plan approval while workspace is closed', (await start('H')).status === 200);
  s = await until(s => agent(s, 'H').state === 'COMPLETED', 'H completes without browser context', 45000);
  record(s, 'background-completed-with-web-closed');
  check('Closing workspace leaves Mission running to verified completion', context === null && slot(s, 3).presentation.state === 'VERIFIED', { closedAt, completedAt: Date.now(), hostPid: host.pid });
  await openPage(); await sleep(1500); const reopened = await capture('07-reopened-after-background');
  check('Reopened page restores real background result', reopened.weapons.some(w => w.weapon === 'chakra' && w.state === 'VERIFIED'));
  check('Reopened completed state does not replay celebration', !reopened.cues.some(c => c.weapon === 'chakra' && c.cue === 'verified'));

  s = await host.state(); const deleteAsk = pending(s, 'D')[0];
  check('Original delete ask remains pending throughout unrelated work', !!deleteAsk && slot(s, 4).presentation.state === 'WAITING_FOR_USER' && existsSync(join(host.workspace, 'seed.txt')));
  check('Explicit deny accepted', (await api('mission.respond', { requestId: deleteAsk.id, decision: 'deny' })).status === 200);
  await until(s => slot(s, 4).presentation.state === 'FAILED', 'D denied FAILED'); await sleep(1500); const denied = await capture('08-denied-failed');
  check('Deny yields FAILED and keeps file untouched', existsSync(join(host.workspace, 'seed.txt')) && denied.weapons.some(w => w.weapon === 'sword' && w.state === 'FAILED'));
  check('Observed FAILED transition gets one failure cue', denied.cues.filter(c => c.kind === 'data-cue' && c.weapon === 'sword' && c.cue === 'failed').length === 1, {swordCues: denied.cues.filter(x => x.weapon === 'sword' && x.kind === 'data-cue'), allCues: denied.cues});

  await bind({ 4: ids.F }); await start('F'); await until(s => pending(s, 'F').length, 'F approval');
  check('Explicit stop accepted', (await api('agent.stop', { id: ids.F })).status === 200);
  await until(s => slot(s, 4).presentation.state === 'STOPPED', 'F STOPPED'); await sleep(1400); const stopped = await capture('09-stopped');
  check('Stop projects STOPPED and never performs pending delete', stopped.weapons.some(w => w.weapon === 'sword' && w.state === 'STOPPED') && existsSync(join(host.workspace, 'seed2.txt')));

  for (const view of ['agents', 'missions', 'files']) {
    await page.goto(`http://127.0.0.1:${DEV_PORT}/?view=${view}&theme=dark`, { waitUntil: 'domcontentloaded' }); await sleep(2200);
    const f = await capture(`10-${view}`);
    check(`${view} renders real Host data without overflow/broken art`, f.text.length > 100 && !f.overflowX && !f.brokenImages.length, { weapons: f.weapons.length, overflowX: f.overflowX, brokenImages: f.brokenImages });
  }
  check('Real workspace has clean browser runtime console', browserErrors.length === 0, browserErrors);
  record(await host.state(), 'FINAL');
} catch (e) { fatal = e.stack ?? String(e); console.error('FATAL', fatal); }
finally {
  polling = false; if (pollPromise) await pollPromise;
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (dev && dev.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { dev.kill(); } }
  await sleep(250);
  if (host) { await host.stop(); writeFileSync(host.credentials, '{}\n'); writeFileSync(join(out, 'host.log'), host.log()); }
  const report = { classification: `LIVE: independent corrected run, disposable real Host 43862, real filesystem and shell-free terminal capabilities, genuine web UI on isolated dev ${DEV_PORT}. No model provider configured and no native UI automated.`, beganAt, finishedAt: new Date().toISOString(), fatal, summary: { passed: checks.filter(c => c.ok).length, failed: checks.filter(c => !c.ok).length, total: checks.length }, checks, commands, ids, shots, browserErrors, notTested: ['Native WPF window close/minimize continuity, docking, multi-monitor, taskbar, and native reduced motion: native computer APIs disabled in this session.', 'Live provider-reported CODING/PLANNING/RESEARCHING/VERIFYING animations: no provider configured in disposable Host; prior unit/state fixtures remain simulation evidence.', 'Physical phone, iOS safe areas, microphone, real voice speaker/input, and real remote tunnel/device approval: unavailable configurations.'], cleanup: { browserClosed: true, ownDevTreeStopped: !!dev && dev.exitCode !== null, hostStopped: !!host && host.child.exitCode !== null, credentialsCleared: true }, originalEvidencePreserved: ['results.json', 'timeline.json', 'scenario.mjs', 'capture.mjs', 'shots/', 'cp/'] };
  writeFileSync(join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  writeFileSync(join(out, 'timeline.json'), JSON.stringify(timeline, null, 2) + '\n');
  writeFileSync(join(out, 'snapshots.json'), JSON.stringify(snapshots, null, 2) + '\n');
  console.log('FINAL', JSON.stringify(report.summary), 'fatal', !!fatal);
}
process.exitCode = fatal || checks.some(c => !c.ok) ? 1 : 0;
