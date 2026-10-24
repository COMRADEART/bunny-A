// MA4-S2-T3R creation UI, Approval Center and accessibility evidence: the real dashboard (Vite dev server -> Host
// bridge) in Chromium at 1280, 767 and 390 px, against a real isolated Host. Nothing external: a recorded fake local
// model behind a fixture Ollama listing (one local model, one cloud tag that must never be offered), the recorded
// synthetic workspace for the connected action, a temporary project folder.
//   node --experimental-strip-types scripts/ma4-s2t3r/ui-evidence.mjs
// Output: docs/ma4-s2t3r/evidence/ui/
import { spawn, spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHost } from '../../src/lib/bunny-host/http.server.ts';
import { providerBase } from '../../src/lib/bunny-host/adapters.server.ts';
import { localGenerate } from '../../src/lib/bunny-host/ma4/task-executors.server.ts';
import { localReview } from '../../src/lib/bunny-host/ma4/connected-workflow.server.ts';
import { fakeModel, MODEL, TEST_BASE, workspace } from '../../src/lib/bunny-host/ma4-s2t2-fixtures.ts';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/ma4-s2t3r/evidence/ui');
mkdirSync(out, { recursive: true }); mkdirSync(TEST_BASE, { recursive: true });
const free = () => new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
const DAY = 86_400_000, CLOUD = 'deepseek-v4.1-flash:cloud', ME = 'me@example.test';
const data = mkdtempSync(join(tmpdir(), 'bunny-s2t3r-ui-')), project = mkdtempSync(join(TEST_BASE, 'ui3r-project-'));
mkdirSync(join(project, 'build'));
writeFileSync(join(project, 'STATUS.md'), 'Atlas status: two open issues; RC3 built.\n');
writeFileSync(join(project, 'ISSUES.md'), '- [ ] Fix login timeout\n- [x] Ship v1.2\n');
writeFileSync(join(project, 'build', 'status.json'), JSON.stringify({ status: 'PASS' }));
const [port, webPort] = [await free(), await free()];
const model = fakeModel({ Worker: 'Status: v1.2 shipped. Open: login timeout.' });
const ollama = { id: 'ollama', detect: async () => ({ ...providerBase('ollama'), installed: true, authenticated: true, availability: 'ready', local_or_cloud: 'local', current_model: MODEL, models: [MODEL, CLOUD], remoteModels: [CLOUD] }), launch: () => { throw new Error('not used'); } };
const host = await startHost({ dataDirectory: data, root: project, port, adapters: [ollama],
  sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: [] }),
  ptasks: { executors: [localGenerate, localReview], call: model.call, modelAvailable: async m => m === MODEL }, connected: { allowLoopback: true, services: workspace() } });
const auth = { connection: 'close', Authorization: `Bearer ${host.token}` };
const cmd = async (action, d = {}) => { const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data: d }) }); const b = await r.json(); if (r.status !== 200) throw new Error(`${action}: ${b.error}`); return b.data; };
const state = async () => (await fetch(`http://127.0.0.1:${port}/state`, { headers: auth })).json();
const until = async (pick, ms = 30_000) => { const end = Date.now() + ms; for (;;) { const v = pick(await state()); if (v) return v; if (Date.now() > end) throw new Error('timed out'); await new Promise(r => setTimeout(r, 100)); } };
const evidence = { checks: [], console: [] };
const check = (name, pass, detail = null) => { evidence.checks.push({ name, pass: !!pass, detail }); console.error(`[ui] ${pass ? 'PASS' : 'FAIL'} ${name}${detail ? ` ${JSON.stringify(detail)}` : ''}`); };
let vite = null;
try {
  await state();
  await cmd('connector.roots.set', { roots: [{ id: 'atlas', label: 'Atlas project', path: project }] });
  vite = spawn(process.execPath, ['scripts/with-app-env.mjs', process.execPath, 'node_modules/vite/bin/vite.js', 'dev', '--host', '127.0.0.1', '--port', String(webPort), '--strictPort'],
    { cwd: root, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: data }, stdio: 'ignore' });
  for (let i = 0; i < 240; i++) { try { if ((await fetch(`http://127.0.0.1:${webPort}/`, { headers: { connection: 'close' } })).ok) break; } catch { /* starting */ } await new Promise(r => setTimeout(r, 500)); }
  const { chromium } = await import('playwright');
  let browser = null;
  for (const channel of [undefined, 'chrome', 'msedge']) { try { browser = await chromium.launch({ headless: true, ...(channel ? { channel } : {}) }); break; } catch { /* next */ } }
  if (!browser) throw new Error('No Chromium, Chrome or Edge.');

  const open = async (name, viewport) => {
    const page = await browser.newPage({ viewport });
    page.on('console', m => { if (m.type() === 'error') evidence.console.push({ name, text: m.text().slice(0, 300) }); });
    page.on('pageerror', e => evidence.console.push({ name, text: `pageerror: ${String(e).slice(0, 300)}` }));
    await page.goto(`http://127.0.0.1:${webPort}/?view=tasks`, { waitUntil: 'domcontentloaded', timeout: 120_000 });
    await page.getByTestId('proactive-create').waitFor({ timeout: 90_000 });
    return page;
  };
  const overflow = page => page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
  // Every input, select and textarea in the form has a programmatic label.
  const unlabeled = form => form.evaluate(f => [...f.querySelectorAll('input, select, textarea')].filter(e => !e.labels?.length && !e.getAttribute('aria-label')).map(e => e.outerHTML.slice(0, 80)));

  for (const [w, h] of [[1280, 900], [767, 1024], [390, 844]]) {
    const page = await open(`w${w}`, { width: w, height: h });
    const create = page.getByTestId('proactive-create');
    await create.getByRole('button', { name: 'New schedule' }).click();
    const form = page.locator('form.proactive-form');
    // Empty submission: an announced summary, the first invalid field focused and described.
    await form.getByRole('button', { name: 'Review', exact: true }).click();
    await page.waitForFunction(() => document.activeElement?.getAttribute('aria-invalid') === 'true');
    const focus = await page.evaluate(() => { const e = document.activeElement; const ids = (e.getAttribute('aria-describedby') ?? '').split(' ').filter(Boolean); return { label: e.labels?.[0]?.textContent, described: ids.map(id => document.getElementById(id)?.textContent) }; });
    check(`w${w} empty form: focus on first invalid field, message attached`, focus.label === 'Name' && focus.described.includes('Name the schedule.'), focus);
    check(`w${w} error summary is an alert`, await form.getByRole('alert').first().isVisible());
    check(`w${w} schedule form: every control labelled`, !(await unlabeled(form)).length, await unlabeled(form));
    const models = await form.getByLabel('Local model').locator('option').allTextContents();
    check(`w${w} only local models are offered`, models.includes(MODEL) && !models.some(m => m.includes(':cloud')), models);
    await form.screenshot({ path: join(out, `schedule-errors-${w}.png`) });
    check(`w${w} no horizontal overflow (errors)`, !(await overflow(page)));
    await form.getByLabel('Name').fill(`Evening summary ${w}`);
    await form.getByLabel(/Files in that folder/).fill('STATUS.md');
    await form.getByRole('button', { name: 'Review', exact: true }).click();
    const preview = form.locator('dl.proactive-preview');
    await preview.waitFor({ timeout: 30_000 });
    const text = await preview.innerText();
    check(`w${w} preview: next runs, actions, reads, model, approvals, expiry`, ['Next runs', 'What Bunny-A will do', 'Information it reads', 'Local model', MODEL, 'Further approval', 'Ends', 'Your approval lasts until'].every(t => text.includes(t)), text.slice(0, 400));
    check(`w${w} preview does not create`, !(await state()).proactive.schedules.some(s => s.title === `Evening summary ${w}`));
    await form.screenshot({ path: join(out, `schedule-preview-${w}.png`) });
    check(`w${w} no horizontal overflow (preview)`, !(await overflow(page)));
    await form.getByRole('button', { name: 'Approve and start' }).click();
    const made = await until(s => s.proactive.schedules.find(x => x.title === `Evening summary ${w}`));
    check(`w${w} approve creates an ACTIVE schedule`, made.state === 'ACTIVE', { state: made.state, trigger: made.trigger });

    if (w === 1280) {
      // DST: a once-only 01:30 on the New York fall-back day says it runs once, at the first.
      await create.getByRole('button', { name: 'New schedule' }).click();
      await form.getByLabel('Name').fill('DST check');
      await form.getByRole('button', { name: 'Remind me' }).click();
      await form.getByLabel('Reminder').fill('Daylight-saving check');
      await form.getByRole('button', { name: 'Once', exact: true }).click();
      await form.getByLabel('Date').fill('2026-11-01'); await form.getByLabel('Time', { exact: true }).fill('01:30');
      await form.getByLabel('Time zone').selectOption('America/New_York');
      await form.getByRole('button', { name: 'Review', exact: true }).click();
      await preview.waitFor();
      const dst = await preview.innerText();
      check('DST: preview explains the repeated local time', /01:30 happens twice on 2026-11-01/.test(dst), dst.slice(0, 300));
      await form.screenshot({ path: join(out, 'schedule-dst-preview.png') });
      await form.getByRole('button', { name: 'Back to edit' }).click();
      check('Back keeps what was typed', await form.getByLabel('Reminder').inputValue() === 'Daylight-saving check');
      await form.getByRole('button', { name: 'Close' }).click();

      // Monitor: keyboard-only entry, approve, then the row shows last check, last change and next check.
      await create.getByRole('button', { name: 'New monitor' }).click();
      check('monitor form: every control labelled', !(await unlabeled(form)).length, await unlabeled(form));
      await form.getByLabel('Name').focus();
      const order = [];
      for (let i = 0; i < 40; i++) {
        order.push(await page.evaluate(() => { const e = document.activeElement; return e?.closest('form') ? (e.labels?.[0]?.textContent ?? e.textContent?.trim() ?? e.tagName) : null; }));
        await page.keyboard.press('Tab');
      }
      // A native date input gives each part (day, month, year) its own Tab stop: count the control once.
      const inForm = order.filter((v, i) => v && v !== order[i - 1]);
      const dom = await form.evaluate(f => [...f.querySelectorAll('input, select, textarea, button')].filter(e => !e.disabled && e.getBoundingClientRect().width > 0).map(e => e.labels?.[0]?.textContent ?? e.textContent?.trim() ?? e.tagName));
      const from = dom.indexOf('Name');
      check('keyboard: Tab visits the monitor form controls in reading order', JSON.stringify(inForm.slice(0, dom.length - from)) === JSON.stringify(dom.slice(from)), { tab: inForm.slice(0, dom.length - from), dom: dom.slice(from) });
      await form.getByLabel('Name').fill('Release check');
      await form.getByLabel(/Short label/).fill('Build status');
      await form.getByLabel('File inside that folder').fill('build/status.json');
      await form.getByRole('button', { name: 'Review', exact: true }).click();
      await preview.waitFor();
      const mtext = await preview.innerText();
      check('monitor preview: no model, check rate, first check', mtext.includes('No model runs for checks') && /Every \d+ min/.test(mtext), mtext.slice(0, 300));
      await form.screenshot({ path: join(out, 'monitor-preview.png') });
      await form.getByRole('button', { name: 'Approve and start' }).click();
      await until(s => s.proactive.monitors.find(m => m.title === 'Release check' && m.lastCheckAt));
      const section = page.getByTestId('proactive');
      const row = section.locator('li', { hasText: 'Release check' });
      await row.getByText(/· checked .* next check/).waitFor({ timeout: 30_000 });
      check('monitor row: last check, last change and next check shown', /· checked .*no change seen yet · next check/.test(await row.innerText()), await row.innerText());
      const anim = await row.evaluate(li => document.getAnimations().filter(a => li.contains(a.effect?.target ?? null)).length);
      check('monitoring is not animated as work', anim === 0, { animations: anim });

      // Goal: saved for later, then shown as waiting with Approve and Reject.
      await create.getByRole('button', { name: 'New goal' }).click();
      await form.getByLabel('Goal').fill('Prepare Bunny A for beta');
      await form.getByLabel(/Success criteria/).fill('Regression suite green\nRelease notes drafted');
      await form.getByRole('button', { name: 'Review', exact: true }).click();
      await preview.waitFor();
      check('goal preview: criteria, progress rule, activation', /Success criteria[\s\S]*How progress counts[\s\S]*Activation/.test(await preview.innerText()));
      await form.getByRole('button', { name: 'Save for later approval' }).click();
      const grow = section.locator('li', { hasText: 'Prepare Bunny A for beta' });
      await grow.getByText('Waiting for approval').waitFor({ timeout: 30_000 });
      check('saved goal waits; offers Approve and Reject', await grow.getByRole('button', { name: 'Approve', exact: true }).isVisible() && await grow.getByRole('button', { name: 'Reject' }).isVisible());
      await section.screenshot({ path: join(out, 'proactive-rows.png') });
      await grow.getByRole('button', { name: 'Reject' }).click();
      await until(s => s.proactive.goals.find(g => g.title === 'Prepare Bunny A for beta' && g.state === 'CANCELLED'));
      check('Reject cancels the suggested goal at the Host', true);

      // Reduced motion and forced colours: the form still works and nothing in the panel animates.
      await page.emulateMedia({ reducedMotion: 'reduce' });
      await create.getByRole('button', { name: 'New schedule' }).click();
      check('reduced motion: no running animations in the panel', await section.evaluate(s => document.getAnimations().filter(a => s.contains(a.effect?.target ?? null)).length) === 0);
      await page.emulateMedia({ forcedColors: 'active' });
      await form.getByRole('button', { name: 'Review', exact: true }).click();
      await form.screenshot({ path: join(out, 'forced-colors-errors.png') });
      check('forced colours: errors still say what is wrong in text', (await form.innerText()).includes('Name the schedule.'));
      await page.emulateMedia({ forcedColors: 'none', reducedMotion: 'no-preference' });
      await form.getByRole('button', { name: 'Close' }).click();

      // Approval Center: a connected email waits; the inspect view names who, what, where and recovery; cancel the task.
      const env = { capabilities: ['file.read', 'local.generate', 'email.send'], providers: ['ollama'], localOnly: true, models: [MODEL], projectScopes: ['p1'], sideEffects: true, background: false,
        budgets: { maxModelCalls: 5, maxWallMs: 3_600_000 }, expiresAt: Date.now() + DAY, grants: { files: [{ root: 'atlas', access: 'read' }], services: [{ connector: 'email', account: ME, access: 'send', recipients: ['lead@example.test'] }] } };
      const steps = [{ id: 'issues', kind: 'file.read', input: { root: 'atlas', path: 'ISSUES.md' } }, { id: 'summary', kind: 'local.generate', input: { prompt: 'Write a status email body.', contextFrom: 'issues' }, model: MODEL },
        { id: 'send', kind: 'email.send', input: { account: ME, to: 'lead@example.test', subject: 'Atlas status', bodyFrom: 'summary' } }];
      const email = await cmd('ptask.create', { spec: { title: 'Atlas status email', projectId: 'p1', steps, acceptance: { requiredSteps: steps.map(s => s.id) } }, envelope: env });
      await cmd('ptask.approve', { id: email.id });
      await until(s => s.persistentTasks.tasks.find(t => t.id === email.id && t.pendingAction));
      const tasks = page.getByTestId('persistent-tasks'), trow = tasks.locator('li', { hasText: 'Atlas status email' });
      await trow.getByRole('button', { name: 'Inspect details' }).click();
      const region = trow.getByRole('region', { name: 'Action details' });
      await region.getByText('Requested by').waitFor({ timeout: 30_000 });
      const rtext = await region.innerText();
      check('Approval Center: requester, task, operation, effect, scope, outcome, recovery, expiry', ['Requested by', 'Worker agent', 'Task', 'Operation', 'Kind of effect', 'Exact scope', 'lead@example.test', 'Expected outcome', 'If it goes wrong', 'This approval expires'].every(t => rtext.includes(t)), rtext.slice(0, 600));
      check('Approval Center: no local path shown', !rtext.includes(project));
      check('Approval Center: approve exact, deny, cancel task offered', await trow.getByRole('button', { name: 'Approve this action' }).isVisible() && await trow.getByRole('button', { name: 'Deny' }).isVisible() && await region.getByRole('button', { name: 'Cancel the whole task' }).isVisible());
      await trow.screenshot({ path: join(out, 'approval-center.png') });
      await region.getByRole('button', { name: 'Cancel the whole task' }).click();
      const after = await until(s => { const t = s.persistentTasks.tasks.find(x => x.id === email.id); return t?.state === 'CANCELLED' && t; });
      check('Cancel task ends it; the stale action is no longer offered', !after.pendingAction && !(await trow.getByRole('button', { name: 'Approve this action' }).count()), { state: after.state });
    }

    await page.close();
  }
  // Reflow (WCAG 1.4.10): 320 CSS px wide is what 1280 px looks like at 400 % zoom. The styles size text in px, so
  // scaling the root font would prove nothing; zoom changes the layout width, which is what this exercises.
  const reflow = await open('w320', { width: 320, height: 720 });
  await reflow.getByTestId('proactive-create').getByRole('button', { name: 'New schedule' }).click();
  await reflow.locator('form.proactive-form').getByRole('button', { name: 'Review', exact: true }).click();
  await reflow.locator('form.proactive-form').screenshot({ path: join(out, 'reflow-320.png') });
  check('reflow at 320 px (400 % zoom): no horizontal overflow', !(await overflow(reflow)));
  await reflow.close();
  await browser.close();
  const failed = evidence.checks.filter(c => !c.pass).length;
  writeFileSync(join(out, 'ui-evidence.json'), JSON.stringify({ ...evidence, failed, note: 'Real dashboard (Vite dev + Host bridge) in headless Chromium; isolated Host; recorded fake model; fixture Ollama listing; synthetic workspace. Screen readers not exercised: labels, roles and focus checked through the DOM.' }, null, 2) + '\n');
  console.log(JSON.stringify({ checks: evidence.checks.length, failed, console: evidence.console }, null, 1));
  process.exitCode = failed || evidence.console.length ? 1 : 0;
} finally {
  if (vite?.pid) spawnSync('taskkill', ['/pid', String(vite.pid), '/t', '/f'], { stdio: 'ignore' });
  await host.close().catch(() => undefined);
  rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); rmSync(project, { recursive: true, force: true, maxRetries: 10 });
}
