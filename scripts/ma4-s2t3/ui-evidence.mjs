// MA4-S2-T3 user-experience evidence: the real dashboard, the real phone companion and the real WPF notch, rendered
// against a real, isolated Host whose goals, schedules and monitors are in known states. Nothing external: a recorded
// fake local model, a temporary project folder, and a synthetic HTTPS pairing fixture for the phone — a self-signed
// certificate and a local TLS relay that stands in for the configured secure tunnel (loopback peer, x-forwarded-proto).
//   node --experimental-strip-types scripts/ma4-s2t3/ui-evidence.mjs
// Output: docs/ma4-s2-t3/evidence/ui/
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer as tcp, connect } from 'node:net';
import { createServer as tls } from 'node:https';
import { request as httpRequest } from 'node:http';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHost } from '../../src/lib/bunny-host/http.server.ts';
import { localGenerate } from '../../src/lib/bunny-host/ma4/task-executors.server.ts';
import { localReview } from '../../src/lib/bunny-host/ma4/connected-workflow.server.ts';
import { fakeModel, MODEL, TEST_BASE } from '../../src/lib/bunny-host/ma4-s2t2-fixtures.ts';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/ma4-s2-t3/evidence/ui');
mkdirSync(out, { recursive: true }); mkdirSync(TEST_BASE, { recursive: true });
const free = () => new Promise(r => { const s = tcp(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const MIN = 60_000, DAY = 24 * 60 * MIN, PHONE_HOST = 'phone.bunny.test';
const data = mkdtempSync(join(tmpdir(), 'bunny-s2t3-ui-')), project = mkdtempSync(join(TEST_BASE, 'ui3-project-'));
mkdirSync(join(project, 'build'));
writeFileSync(join(project, 'STATUS.md'), 'Atlas status: two open issues (login timeout, onboarding copy); RC3 built.\n');
writeFileSync(join(project, 'build', 'status.json'), JSON.stringify({ status: 'PASS' }));
const [port, webPort, tlsPort] = [await free(), await free(), await free()];
// The Worker waits for the script, so a scheduled run can be captured while it is really working.
const base = fakeModel({ Worker: 'Atlas: two open issues; RC3 is built.' });
let gate = null;
const call = async (args) => { if (args.role === 'Worker' && gate) await gate.promise; return base.call(args); };
const clock = { offset: 0 }, now = () => Date.now() + clock.offset;
const options = { dataDirectory: data, root: project, port, adapters: [], sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: [] }),
  ptasks: { executors: [localGenerate, localReview], call, modelAvailable: async m => m === MODEL, now }, proactive: { now, maxSleepMs: 2_000 } };
const host = await startHost(options);
const cmd = async (action, d = {}) => { const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { connection: 'close', Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: d }) }); const b = await r.json(); if (r.status !== 200) throw new Error(`${action}: ${b.error}`); return b; };
const state = async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers: { connection: 'close', Authorization: `Bearer ${host.token}` } })).json();
const facts = async () => { const s = await state(); return { tasks: s.persistentTasks.tasks.map(t => ({ title: t.title, display: t.display })), proactive: { status: s.proactive.status, schedules: s.proactive.schedules.map(x => ({ title: x.title, state: x.state, running: !!x.runningTaskId })), monitors: s.proactive.monitors.map(x => ({ label: x.label, state: x.state, lastClass: x.lastClass })), goals: s.proactive.goals.map(x => ({ title: x.title, state: x.state, progress: x.progress })), notifications: s.proactive.notifications.map(n => n.category), away: s.proactive.away } }; };
const until = async (pick, ms = 30_000) => { const end = Date.now() + ms; for (;;) { const s = await state(); const v = pick(s); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 50)); } };
const jump = async to => { clock.offset = to - Date.now(); await cmd('proactive.list'); };
const env = (kinds, grants, extra = {}) => ({ capabilities: [...new Set(kinds)], providers: ['ollama'], localOnly: true, models: [MODEL], projectScopes: ['p1'], sideEffects: false, background: true, budgets: { maxModelCalls: 5, maxWallMs: 3_600_000 }, expiresAt: now() + 30 * DAY, grants, ...extra });
const hhmm = t => new Date(t).toISOString().slice(11, 16);
const summary = { type: 'task', spec: { title: 'Project summary', projectId: 'p1', acceptance: { requiredSteps: ['read', 'sum'] },
  steps: [{ id: 'read', kind: 'file.read', input: { root: 'atlas', path: 'STATUS.md' } }, { id: 'sum', kind: 'local.generate', input: { prompt: 'Summarize the status.', contextFrom: 'read' }, model: MODEL }] },
  envelope: env(['file.read', 'local.generate'], { files: [{ root: 'atlas', access: 'read' }] }) };
const evidence = { captures: [], console: [], phoneRequests: [] };
const step = name => console.error(`[ui-evidence] ${new Date().toISOString()} ${name}`);
let vite = null, relay = null;
const island = async (edge, name) => {
  const prefs = join(data, `prefs-${edge}-${name}.json`), shots = join(data, `shots-${name}`);
  writeFileSync(prefs, JSON.stringify({ edge, edgeOffset: 0.5 }));
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', join(root, 'install/Bunny-Island.ps1'), '-SmokeTest', '-CollapsedView',
    '-CredentialPath', join(data, 'credentials.json'), '-DeploymentPath', join(data, 'no-deployment.json'), '-PreferencePath', prefs, '-ScreenshotDirectory', shots], { stdio: 'inherit' });
  await new Promise((r, reject) => ps.once('exit', code => code === 0 ? r() : reject(new Error(`Island exited ${code}`))));
  copyFileSync(join(shots, 'bunny-native-collapsed.png'), join(out, `${name}.png`));
  evidence.captures.push({ name, edge, facts: await facts() });
};
try {
  await state();
  await cmd('connector.roots.set', { roots: [{ id: 'atlas', label: 'Atlas project', path: project }] });
  // A goal with real progress, and a suggestion that waits for approval.
  const goal = (await cmd('goal.create', { spec: { title: 'Prepare Bunny A for beta', projectId: 'p1', successCriteria: [{ id: 'status', description: 'Status reviewed' }, { id: 'notes', description: 'Release notes drafted' }, { id: 'build', description: 'Installer built' }], expiresAt: now() + 30 * DAY } })).data;
  await cmd('goal.approve', { id: goal.id });
  const read = (await cmd('ptask.create', { spec: { title: 'Review status', projectId: 'p1', steps: [{ id: 'r', kind: 'file.read', input: { root: 'atlas', path: 'STATUS.md' } }], acceptance: { requiredSteps: ['r'] } }, envelope: env(['file.read'], { files: [{ root: 'atlas', access: 'read' }] }, { background: false }) })).data;
  await cmd('goal.link', { id: goal.id, criterionId: 'status', taskId: read.id });
  await cmd('goal.create', { spec: { title: 'Weekly dependency audit', projectId: 'p1', successCriteria: [{ id: 'audit', description: 'npm audit clean' }], expiresAt: now() + 30 * DAY }, suggested: true });
  // A build monitor that sees PASS, then FAIL.
  const mon = (await cmd('monitor.create', { spec: { title: 'Release check', label: 'Build status', projectId: 'p1', source: { kind: 'file', root: 'atlas', path: 'build/status.json', field: 'status' }, predicate: { type: 'transition', from: 'PASS', to: 'FAIL' }, intervalMs: MIN, expiresAt: now() + 7 * DAY } })).data;
  await cmd('monitor.approve', { id: mon.id });
  await until(s => s.proactive.monitors[0].lastCheckAt);
  writeFileSync(join(project, 'build', 'status.json'), JSON.stringify({ status: 'FAIL' }));
  await jump(now() + MIN + 1_000);
  await until(s => s.proactive.notifications.some(n => n.category === 'source_changed'));
  // Schedules: one active evening summary, one waiting for approval, one running now (its Worker is held).
  const slot = Math.ceil((now() + 5_000) / MIN) * MIN;
  await cmd('schedule.approve', { id: (await cmd('schedule.create', { spec: { title: 'Evening summary', projectId: 'p1', trigger: { type: 'daily', time: '18:00', timeZone: 'UTC' }, action: summary, expiresAt: now() + 7 * DAY } })).data.id });
  const waiting = (await cmd('schedule.create', { spec: { title: 'Morning reminder', projectId: 'p1', trigger: { type: 'daily', time: '08:30', timeZone: 'UTC' }, action: { type: 'remind', text: 'Review the beta checklist.' }, expiresAt: now() + 7 * DAY } })).data;
  const live = (await cmd('schedule.create', { spec: { title: 'Release-day summary', projectId: 'p1', trigger: { type: 'daily', time: hhmm(slot), timeZone: 'UTC' }, action: summary, expiresAt: now() + 7 * DAY } })).data;
  await cmd('schedule.approve', { id: live.id });
  let release; gate = { promise: new Promise(r => { release = r; }) };
  await jump(slot - 200);
  await until(s => s.proactive.schedules.find(x => x.id === live.id && x.runningTaskId));
  // The notch while a scheduled run works, a monitor watches and a schedule waits for approval.
  step('notch');
  for (const [edge, name] of [['top', 'notch-horizontal'], ['left', 'notch-side']]) await island(edge, name);

  // The dashboard (Tasks page): rendered, then the owner approves the waiting schedule with the panel's own button.
  vite = spawn(process.execPath, ['scripts/with-app-env.mjs', process.execPath, 'node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    { cwd: root, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: data, BUNNY_REMOTE_ORIGIN: `https://${PHONE_HOST}:${tlsPort}`, __VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS: PHONE_HOST }, stdio: 'ignore' });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/`, { headers: { connection: 'close' } })).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)); }
  const { chromium } = await import('playwright');
  let browser = null;
  for (const channel of [undefined, 'chrome', 'msedge']) { try { browser = await chromium.launch({ headless: true, args: [`--host-resolver-rules=MAP ${PHONE_HOST} 127.0.0.1`], ...(channel ? { channel } : {}) }); break; } catch { /* next */ } }
  if (!browser) throw new Error('No Chromium, Chrome or Edge.');
  const watch = (page, name) => { page.on('console', m => { if (m.type() === 'error') evidence.console.push({ name, text: m.text().slice(0, 300) }); }); page.on('pageerror', e => evidence.console.push({ name, text: `pageerror: ${String(e).slice(0, 300)}` })); };
  const debug = async (page, name, error) => { await page.screenshot({ path: join(out, `debug-${name}.png`), fullPage: true }); writeFileSync(join(out, `debug-${name}.txt`), `${await page.locator('body').innerText().catch(() => '')}\n\nconsole: ${JSON.stringify(evidence.console)}`); throw error; };
  for (const [name, viewport] of [['dashboard-desktop', { width: 1280, height: 900 }], ['dashboard-narrow', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    watch(page, name);
    await page.goto(`http://127.0.0.1:${webPort}/?view=tasks`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const section = page.getByTestId('proactive');
    try { await section.getByText('Waiting for approval').first().waitFor({ timeout: 60_000 }); } catch (error) { await debug(page, name, error); }
    await section.screenshot({ path: join(out, `${name}.png`) });
    evidence.captures.push({ name, overflowX: await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth) });
    if (name === 'dashboard-desktop') {
      await section.locator('li', { hasText: 'Morning reminder' }).getByRole('button', { name: 'Approve' }).click();
      await until(s => s.proactive.schedules.find(x => x.id === waiting.id && x.state === 'ACTIVE'));
      await section.locator('li', { hasText: 'Morning reminder' }).getByText(/Scheduled · next/).waitFor({ timeout: 30_000 });
      await section.screenshot({ path: join(out, 'dashboard-after-approval.png') });
      evidence.captures.push({ name: 'dashboard-after-approval', facts: await facts() });
    }
    await page.close();
  }

  // The phone through the synthetic HTTPS pairing fixture: real /api/bunny-pair, real device cookie, real device snapshot.
  step('phone: vite alive? ' + (await fetch(`http://127.0.0.1:${webPort}/`, { headers: { connection: 'close' }, signal: AbortSignal.timeout(10_000) }).then(r => r.status, e => String(e))));
  const certDir = mkdtempSync(join(tmpdir(), 'bunny-s2t3-cert-'));
  const gen = spawnSync('openssl', ['req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-days', '1', '-subj', `/CN=${PHONE_HOST}`, '-addext', `subjectAltName=DNS:${PHONE_HOST}`, '-keyout', join(certDir, 'key.pem'), '-out', join(certDir, 'cert.pem')], { encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] });
  step(`openssl exit ${gen.status}`);
  if (gen.status !== 0) throw new Error(`openssl: ${gen.stderr}`);
  relay = tls({ key: readFileSync(join(certDir, 'key.pem')), cert: readFileSync(join(certDir, 'cert.pem')) }, (req, res) => {
    evidence.phoneRequests.push(req.url.slice(0, 80));
    const up = httpRequest({ host: '127.0.0.1', port: webPort, method: req.method, path: req.url, headers: { ...req.headers, 'x-forwarded-proto': 'https' } }, r => { res.writeHead(r.statusCode ?? 502, r.headers); r.pipe(res); });
    up.on('error', () => { res.writeHead(502); res.end(); });
    req.pipe(up);
  });
  relay.on('upgrade', (req, socket, head) => {
    const up = connect(webPort, '127.0.0.1', () => { up.write(`${req.method} ${req.url} HTTP/1.1\r\n${Object.entries({ ...req.headers, 'x-forwarded-proto': 'https' }).map(([k, v]) => `${k}: ${v}`).join('\r\n')}\r\n\r\n`); up.write(head); socket.pipe(up).pipe(socket); });
    up.on('error', () => socket.destroy());
  });
  await new Promise(r => relay.listen(tlsPort, '127.0.0.1', r));
  const phoneOrigin = `https://${PHONE_HOST}:${tlsPort}`;
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ignoreHTTPSErrors: true, isMobile: true, hasTouch: true });
  const code = (await cmd('pairing.create')).pairCode;
  // Paired from inside the page (a same-origin fetch through the real browser), so the browser stores the device cookie.
  const phone = await context.newPage();
  watch(phone, 'phone');
  step('phone open');
  await phone.goto(`${phoneOrigin}/?companion=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  step('pairing');
  const paired = await phone.evaluate(async code => { const r = await fetch('/api/bunny-pair', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'S2-T3 phone fixture' }) }); return { status: r.status, body: await r.text() }; }, code);
  step(`paired ${paired.status}`);
  if (paired.status !== 200) throw new Error(`pairing failed: ${paired.status} ${paired.body}`);
  evidence.captures.push({ name: 'phone-paired', deviceCookieHttpOnly: (await context.cookies()).some(c => c.name === 'bunny_device' && c.httpOnly && c.secure) });
  await phone.goto(`${phoneOrigin}/?companion=1`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
  const ps = phone.getByTestId('proactive');
  try { await ps.getByText('Monitoring').first().waitFor({ timeout: 60_000 }); } catch (error) { await debug(phone, 'phone', error); }
  await ps.screenshot({ path: join(out, 'phone-live.png') });
  const phoneText = await ps.innerText();
  evidence.captures.push({ name: 'phone-live', approveButtons: await ps.getByRole('button', { name: 'Approve' }).count(), showsPath: phoneText.includes(project) || phoneText.includes('status.json'), overflowX: await phone.evaluate(() => document.documentElement.scrollWidth > window.innerWidth) });
  // A phone control that reduces authority reaches the Host: pause the evening summary.
  await ps.locator('li', { hasText: 'Evening summary' }).getByRole('button', { name: 'Pause' }).click();
  await until(s => s.proactive.schedules.find(x => x.title === 'Evening summary' && x.state === 'PAUSED'));
  await ps.locator('li', { hasText: 'Evening summary' }).getByText('Paused').first().waitFor({ timeout: 30_000 });
  await ps.screenshot({ path: join(out, 'phone-after-pause.png') });
  evidence.captures.push({ name: 'phone-after-pause', facts: await facts() });

  // The run finishes; the notch shows monitoring and schedules only (muted, not work) plus the away summary.
  step('release run');
  release(); gate = null;
  await until(s => !s.proactive.schedules.some(x => x.runningTaskId) && s.persistentTasks.tasks.some(t => t.title === 'Project summary' && t.state === 'COMPLETED'));
  // With nothing waiting and the away summary read, only monitoring and schedules remain: muted, never shown as work.
  for (const g of (await state()).proactive.goals.filter(x => x.state === 'AWAITING_APPROVAL')) await cmd('goal.cancel', { id: g.id });
  await cmd('proactive.away.ack');
  await island('top', 'notch-monitoring-only');

  // Disconnected: the Host stops; the phone keeps the last known state, labelled, with controls off.
  step('host stop');
  await host.close();
  try { await ps.getByText(/Last known/).first().waitFor({ timeout: 60_000 }); } catch (error) { await debug(phone, 'phone-offline', error); }
  await ps.screenshot({ path: join(out, 'phone-offline.png') });
  evidence.captures.push({ name: 'phone-offline', buttons: await ps.getByRole('button').count() });
  await browser.close();
  rmSync(certDir, { recursive: true, force: true });
  writeFileSync(join(out, 'ui-evidence.json'), JSON.stringify({ ...evidence, phoneRequests: evidence.phoneRequests.length, note: 'Real dashboard (Vite dev server + Host bridge), real phone companion through a synthetic HTTPS pairing fixture (self-signed certificate, local TLS relay in place of the tunnel), real WPF Island; isolated Host, recorded fake model.' }, null, 2) + '\n');
  console.log(JSON.stringify({ captures: evidence.captures.map(c => c.name), console: evidence.console }, null, 1));
} finally {
  relay?.close();
  if (vite?.pid) spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore' });
  await host.close().catch(() => undefined);
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); rmSync(project, { recursive: true, force: true, maxRetries: 10 });
}
