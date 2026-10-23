// MA4-S2-T2 user-experience evidence: the real dashboard (Vite dev server -> Host bridge) and the real WPF notch, both
// rendered against a real, isolated Host whose connected tasks are in known states. Nothing external: a recorded fake
// local model, the recorded synthetic workspace, a temporary project folder.
//   node --experimental-strip-types scripts/ma4-s2t2/ui-evidence.mjs
// Output: docs/ma4-s2-t2/evidence/ui/
import { spawn, spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHost } from '../../src/lib/bunny-host/http.server.ts';
import { localGenerate } from '../../src/lib/bunny-host/ma4/task-executors.server.ts';
import { localReview } from '../../src/lib/bunny-host/ma4/connected-workflow.server.ts';
import { fakeModel, MODEL, TEST_BASE, workspace } from '../../src/lib/bunny-host/ma4-s2t2-fixtures.ts';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/ma4-s2-t2/evidence/ui');
mkdirSync(out, { recursive: true }); mkdirSync(TEST_BASE, { recursive: true });
const free = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const data = mkdtempSync(join(tmpdir(), 'bunny-s2t2-ui-')), project = mkdtempSync(join(TEST_BASE, 'ui-project-'));
writeFileSync(join(project, 'ISSUES.md'), '- [ ] Fix login timeout\n- [ ] Update the onboarding copy\n- [x] Ship v1.2\n');
const [port, webPort] = [await free(), await free()];
const w = workspace();
let release;
const list = w.mail.list;
w.mail.list = async (...a) => { await new Promise(r => { release = r; }); return list(...a); };
const model = fakeModel({ Worker: 'Status: v1.2 shipped. Open: login timeout, onboarding copy.' });
const options = { dataDirectory: data, root: project, port, adapters: [], sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: [] }),
  ptasks: { executors: [localGenerate, localReview], call: model.call, modelAvailable: async m => m === MODEL }, connected: { allowLoopback: true, services: w } };
const host = await startHost(options);
const cmd = async (action, d) => { const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { connection: 'close', Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: d }) }); const b = await r.json(); if (r.status !== 200) throw new Error(`${action}: ${b.error}`); return b.data; };
const facts = async () => (await (await fetch(`http://127.0.0.1:${port}/state`, { headers: { connection: 'close', Authorization: `Bearer ${host.token}` } })).json()).persistentTasks.tasks.map(t => ({ title: t.title, state: t.state, display: t.display, activity: t.activity, pending: t.pendingAction?.kind ?? null }));
const env = (kinds, grants, extra = {}) => ({ capabilities: [...new Set(kinds)], providers: ['ollama'], localOnly: true, models: [MODEL], projectScopes: ['p1'], sideEffects: false, background: false, budgets: { maxModelCalls: 5, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000, grants, ...extra });
const ME = 'me@example.test';
const evidence = { captures: [], console: [] };
let vite = null;
const island = async (edge, name) => {
  const prefs = join(data, `prefs-${edge}.json`), shots = join(data, `shots-${name}`);
  writeFileSync(prefs, JSON.stringify({ edge, edgeOffset: 0.5 }));
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', join(root, 'install/Bunny-Island.ps1'), '-SmokeTest', '-CollapsedView',
    '-CredentialPath', join(data, 'credentials.json'), '-DeploymentPath', join(data, 'no-deployment.json'), '-PreferencePath', prefs, '-ScreenshotDirectory', shots], { stdio: 'inherit' });
  await new Promise((r, reject) => ps.once('exit', code => code === 0 ? r() : reject(new Error(`Island exited ${code}`))));
  copyFileSync(join(shots, 'bunny-native-collapsed.png'), join(out, `${name}.png`));
};
try {
  await fetch(`http://127.0.0.1:${port}/state`, { headers: { connection: 'close', Authorization: `Bearer ${host.token}` } });
  await cmd('connector.roots.set', { roots: [{ id: 'atlas', label: 'Atlas project', path: project }] });
  const done = await cmd('ptask.create', { spec: { title: 'Atlas changes', projectId: 'p1', steps: [{ id: 'r', kind: 'file.read', input: { root: 'atlas', path: 'ISSUES.md' } }], acceptance: { requiredSteps: ['r'] } }, envelope: env(['file.read'], { files: [{ root: 'atlas', access: 'read' }] }) });
  const steps = [{ id: 'issues', kind: 'file.read', input: { root: 'atlas', path: 'ISSUES.md' } }, { id: 'summary', kind: 'local.generate', input: { prompt: 'Write a status email body.', contextFrom: 'issues' }, model: MODEL },
    { id: 'send', kind: 'email.send', input: { account: ME, to: 'lead@example.test', subject: 'Atlas status', bodyFrom: 'summary' } }];
  const email = await cmd('ptask.create', { spec: { title: 'Atlas status email', projectId: 'p1', steps, acceptance: { requiredSteps: steps.map(s => s.id) } },
    envelope: env(steps.map(s => s.kind), { files: [{ root: 'atlas', access: 'read' }], services: [{ connector: 'email', account: ME, access: 'send', recipients: ['lead@example.test'] }] }, { sideEffects: true }) });
  await cmd('ptask.approve', { id: email.id });
  await cmd('ptask.create', { spec: { title: 'Inbox scan', projectId: 'p1', steps: [{ id: 'ls', kind: 'email.list', input: { account: ME } }], acceptance: { requiredSteps: ['ls'] } }, envelope: env(['email.list'], { services: [{ connector: 'email', account: ME, access: 'read' }] }) });
  for (let i = 0; i < 200; i++) { const f = await facts(); if (f.some(t => t.pending) && f.some(t => t.activity === 'Reading files') && f.some(t => t.state === 'COMPLETED')) break; await new Promise(r => setTimeout(r, 50)); }
  evidence.captures.push({ name: 'host-facts', tasks: await facts(), doneTask: done.id });
  // The notch while one connected task reads and one waits for permission.
  for (const [edge, name] of [['top', 'notch-horizontal'], ['left', 'notch-side']]) { await island(edge, name); evidence.captures.push({ name, edge, tasks: await facts() }); }

  vite = spawn(process.execPath, ['scripts/with-app-env.mjs', process.execPath, 'node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    { cwd: root, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: data }, stdio: 'ignore' });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/`, { headers: { connection: 'close' } })).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)); }
  const { chromium } = await import('playwright');
  let browser = null;
  for (const channel of [undefined, 'chrome', 'msedge']) { try { browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) }); break; } catch { /* next */ } }
  if (!browser) throw new Error('No Chromium, Chrome or Edge.');
  for (const [name, viewport] of [['dashboard-desktop', { width: 1280, height: 900 }], ['dashboard-narrow', { width: 390, height: 844 }]]) {
    const page = await browser.newPage({ viewport });
    page.on('console', m => { if (m.type() === 'error') evidence.console.push({ name, text: m.text().slice(0, 300) }); });
    page.on('pageerror', e => evidence.console.push({ name, text: `pageerror: ${String(e).slice(0, 300)}` }));
    // Background tasks and the Approval Center live on the Tasks page (deep link).
    await page.goto(`http://127.0.0.1:${webPort}/?view=tasks`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    const section = page.getByTestId('persistent-tasks');
    try { await section.getByText('Waiting for permission').first().waitFor({ timeout: 60_000 }); }
    catch (error) { await page.screenshot({ path: join(out, `debug-${name}.png`), fullPage: true }); writeFileSync(join(out, `debug-${name}.txt`), `${await page.locator('body').innerText().catch(() => '')}

console: ${JSON.stringify(evidence.console)}`); throw error; }
    await section.screenshot({ path: join(out, `${name}.png`) });
    if (name === 'dashboard-desktop') {
      await section.getByRole('button', { name: 'Inspect details' }).click();
      try { await section.getByRole('region', { name: 'Action details' }).waitFor({ timeout: 30_000 }); }
      catch (error) { writeFileSync(join(out, 'debug-inspect.txt'), JSON.stringify(evidence.console, null, 1)); throw error; }
      await section.screenshot({ path: join(out, 'approval-center-inspect.png') });
      evidence.captures.push({ name: 'approval-center-inspect', preview: await section.locator('pre').first().innerText() });
      await section.getByRole('button', { name: 'Approve this action' }).click();
      for (let i = 0; i < 200 && !(await facts()).some(t => t.title === 'Atlas status email' && t.state === 'COMPLETED'); i++) await new Promise(r => setTimeout(r, 50));
      await section.getByText('All 3 steps completed').waitFor({ timeout: 30_000 });
      await section.screenshot({ path: join(out, 'after-approval.png') });
      evidence.captures.push({ name: 'after-approval', tasks: await facts(), syntheticSent: w.sent.map(m => ({ to: m.to, subject: m.subject })) });
    }
    await page.close();
  }
  await browser.close();
  writeFileSync(join(out, 'ui-evidence.json'), JSON.stringify({ ...evidence, note: 'Real dashboard via the Vite dev server and Host bridge; real WPF Island; isolated Host with recorded fake model and synthetic workspace.' }, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 1));
} finally {
  release?.();
  if (vite?.pid) spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore' });
  await host.close();
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); rmSync(project, { recursive: true, force: true, maxRetries: 10 });
}
