// T13 probe (browser level): measure Host->web state lag on the chat view and log snapshot-read requests.
// Disposable Host 43863 + owned dev 8098 only. No production, no native UI.
import { startHost, repo } from './host.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const DEV_PORT = 8099;
let host, dev, browser, context;
try {
  host = await startHost(43863, 'probe-web');
  writeFileSync(join(host.workspace, 'live.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('probe', async () => { await new Promise(r => setTimeout(r, 8000)); assert.equal(1, 1); });\n");
  const api = async (action, data = {}) => {
    const r = await host.api(action, data);
    if (r.status !== 200) throw new Error(`${action}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  await api('mission.configure', { enabled: true });
  const created = await api('agent.create', { name: 'T13-PROBE', objective: 'probe', steps: [{ role: 'Run tests', objective: 'Run tests', access: 'read', dependsOn: [], executor: { kind: 'capability', action: 'terminal.exec', params: { command: 'node', args: ['--test', 'live.test.mjs'] } }, verification: [{ kind: 'capability', action: 'filesystem.exists', params: { path: 'live.test.mjs' }, expect: { field: 'exists', equals: true } }] }] });
  const agentId = created.snapshot.agents.agents.find(a => a.name === 'T13-PROBE').id;
  const st0 = await host.state();
  const slots = st0.personalAgents.slots.map(x => ({ slot: x.slot, weapon: x.weapon, displayName: x.displayName, description: x.description, purpose: x.purpose, style: x.style, responsibilities: x.responsibilities, agentId: x.slot === 3 ? agentId : x.agentId, active: x.active }));
  await api('personal_agents.configure', { slots, expectRevision: st0.personalAgents.revision });

  const devLog = [];
  dev = spawn(process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_PORT)], { cwd: repo, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: host.data, BUNNY_HOST_CREDENTIALS_FILE: host.credentials }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  dev.stdout.on('data', b => devLog.push(String(b)));
  dev.stderr.on('data', b => devLog.push(String(b)));
  const plain = () => devLog.join('').replace(/\u001b\[[0-9;]*m/g, '');
  let ready = false;
  for (let i = 0; i < 120 && !ready; i++) { if (plain().includes(`127.0.0.1:${DEV_PORT}/`)) ready = true; else await sleep(500); }
  if (!ready) throw new Error('dev not ready: ' + plain().slice(-600));

  browser = await chromium.launch({ headless: true });
  context = await browser.newContext({ viewport: { width: 1366, height: 768 }, colorScheme: 'dark' });
  await context.addInitScript(() => {
    window.__probe = [];
    document.addEventListener('DOMContentLoaded', () => new MutationObserver(records => {
      for (const r of records) if (r.target.matches?.('.wc-weapon') && r.target.dataset.weapon === 'chakra') window.__probe.push({ at: Date.now(), kind: r.attributeName, state: r.target.dataset.state, cue: r.target.dataset.cue ?? null });
    }).observe(document.documentElement, { subtree: true, attributes: true, attributeFilter: ['data-cue', 'data-state'] }));
  });
  const page = await context.newPage();
  const reqs = [];
  page.on('request', r => { const u = r.url(); if (u.includes('bunny') || u.includes('_serverFn') || u.includes('serverFn')) reqs.push({ at: Date.now(), url: u.slice(0, 110) }); });
  page.on('console', m => { if (m.type() === 'error') console.log('PAGE-ERR', m.text().slice(0, 160)); });
  await page.goto(`http://127.0.0.1:${DEV_PORT}/?view=chat&theme=dark`, { waitUntil: 'domcontentloaded', timeout: 120000 });
  await page.waitForFunction(() => document.querySelectorAll('.wc-weapon').length >= 1, null, { timeout: 60000 });
  await sleep(1500);

  const a = (await host.state()).agents.agents.find(x => x.id === agentId);
  await api('agent.start', { id: agentId, ...(a?.authorization ? { revision: a.authorization.revision } : {}) });
  const startedAt = Date.now();
  let hostTestingAt = null, hostVerifiedAt = null;
  for (let i = 0; i < 300; i++) {
    const s = await host.state();
    const slot = s.personalAgents.slots.find(x => x.slot === 3);
    if (slot.presentation.state === 'TESTING' && hostTestingAt === null) hostTestingAt = Date.now();
    if (slot.presentation.state === 'VERIFIED') { hostVerifiedAt = Date.now(); break; }
    await sleep(100);
  }
  await sleep(4000);
  const probe = await page.evaluate(() => window.__probe);
  const webTesting = probe.find(p => p.kind === 'data-state' && p.state === 'TESTING');
  const webVerified = probe.find(p => p.kind === 'data-state' && p.state === 'VERIFIED');
  const summary = {
    startedAt, hostTestingAt, hostVerifiedAt,
    webTestingAt: webTesting?.at ?? null, webVerifiedAt: webVerified?.at ?? null,
    lagTestingMs: webTesting && hostTestingAt ? webTesting.at - hostTestingAt : null,
    lagVerifiedMs: webVerified && hostVerifiedAt ? webVerified.at - hostVerifiedAt : null,
    cues: probe.filter(p => p.kind === 'data-cue'),
    snapshotReads: reqs.filter(r => r.at >= startedAt - 2000).map(r => ({ relMs: r.at - startedAt, url: r.url })),
  };
  writeFileSync(join(import.meta.dirname, 'probe-web-summary.json'), JSON.stringify(summary, null, 1) + '\n');
  console.log('PROBE_SUMMARY', JSON.stringify({ lagTestingMs: summary.lagTestingMs, lagVerifiedMs: summary.lagVerifiedMs, cueRecords: summary.cues.length, cues: summary.cues }));
} finally {
  if (context) await context.close().catch(() => {});
  if (browser) await browser.close().catch(() => {});
  if (dev && dev.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { dev.kill(); } }
  if (host) await host.stop();
}
