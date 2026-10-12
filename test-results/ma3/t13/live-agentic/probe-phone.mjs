// T13 probe: phone companion landscape (844x390) + portrait (390x844) layout on current source.
// Disposable Host 43864 + owned dev 8099. Browser simulation only, not physical-phone acceptance.
import { startHost, repo } from './host.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const DEV_PORT = 8099;
let host, dev, browser;
const out = (name, data) => writeFileSync(join(import.meta.dirname, name), data);
try {
  host = await startHost(43864, 'probe-phone');
  const api = async (action, data = {}) => {
    const r = await host.api(action, data);
    if (r.status !== 200) throw new Error(`${action}: ${r.status} ${JSON.stringify(r.body).slice(0, 200)}`);
    return r.body;
  };
  await api('mission.configure', { enabled: true });
  const created = await api('agent.create', { name: 'T13-PHONE', objective: 'phone probe', steps: [{ role: 'Read seed', objective: 'Read seed', access: 'read', dependsOn: [], executor: { kind: 'capability', action: 'filesystem.read', params: { path: 'seed.txt' } }, verification: [] }] });
  const agentId = created.snapshot.agents.agents.find(a => a.name === 'T13-PHONE').id;
  const st0 = await host.state();
  const slots = st0.personalAgents.slots.map(x => ({ slot: x.slot, weapon: x.weapon, displayName: x.displayName, description: x.description, purpose: x.purpose, style: x.style, responsibilities: x.responsibilities, agentId: x.slot === 1 ? agentId : x.agentId, active: x.active }));
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
  const measure = () => {
    const root = document.querySelector('.pc-root');
    if (!root) return { missing: true };
    const targets = [...document.querySelectorAll('.pc-root button, .pc-root a, .pc-root input, .pc-root textarea, .pc-root [role="button"]')]
      .map(el => { const r = el.getBoundingClientRect(); return { tag: el.tagName, cls: el.className?.toString().slice(0, 24), w: Math.round(r.width), h: Math.round(r.height), label: (el.getAttribute('aria-label') || el.textContent || '').trim().slice(0, 28) }; })
      .filter(t => t.w > 0 && t.h > 0);
    return {
      docOverflowX: document.documentElement.scrollWidth - innerWidth,
      rootOverflowX: root.scrollWidth - root.clientWidth,
      rootW: root.clientWidth,
      undersized: targets.filter(t => t.w < 44 || t.h < 44),
      targetCount: targets.length,
      text: document.body.innerText.replace(/\s+/g, ' ').slice(0, 300),
    };
  };
  const results = {};
  for (const [name, viewport] of [['landscape-844x390', { width: 844, height: 390 }], ['portrait-390x844', { width: 390, height: 844 }]]) {
    const context = await browser.newContext({ viewport, isMobile: true, hasTouch: true, deviceScaleFactor: 2, colorScheme: 'dark' });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    await page.goto(`http://127.0.0.1:${DEV_PORT}/?companion=1&theme=dark`, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForSelector('.pc-root', { timeout: 60000 });
    await sleep(2500);
    results[name + ' home'] = await page.evaluate(measure);
    await page.screenshot({ path: join(import.meta.dirname, `probe-phone-${name}-home.png`) });
    // Settings tab: last tab button.
    const tabs = page.locator('.pc-tab');
    await tabs.nth(4).click();
    await sleep(800);
    results[name + ' settings'] = await page.evaluate(measure);
    await page.screenshot({ path: join(import.meta.dirname, `probe-phone-${name}-settings.png`) });
    results[name + ' errors'] = errors;
    await context.close();
  }
  out('probe-phone-summary.json', JSON.stringify(results, null, 1) + '\n');
  console.log('PHONE_PROBE', JSON.stringify(Object.fromEntries(Object.entries(results).map(([k, v]) => [k, v.missing ? v : { docOverflowX: v.docOverflowX, rootOverflowX: v.rootOverflowX, rootW: v.rootW, undersized: v.undersized?.length, targets: v.targetCount, errors: Array.isArray(v) ? v.length : undefined }]))));
} finally {
  if (browser) await browser.close().catch(() => {});
  if (dev && dev.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { dev.kill(); } }
  if (host) await host.stop();
}
