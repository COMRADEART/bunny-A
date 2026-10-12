// T13 probe: reduced-motion effect layer (review S1 fix). OS prefers-reduced-motion and app Motion=off must both
// leave the Personal Agent characters with pose + ring + badge only: no frozen task-effect parts painted.
// Disposable Host 43884 + owned dev 8092. Browser simulation only.
import { startHost, repo } from '../live-agentic/host.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';
import { chromium } from 'playwright';

const DEV_PORT = 8092;
let host, dev, browser;
const results = { classification: 'LIVE: real disposable Host 43866, isolated dev 8092, real browser with emulated prefers-reduced-motion. Reduced-motion is emulated by Playwright (device emulation), not an OS profile.', checks: [], shots: {} };
const check = (name, ok, detail = null) => { results.checks.push({ name, ok: !!ok, detail }); console.log(ok ? 'PASS' : 'FAIL', name, JSON.stringify(detail)?.slice(0, 400)); };
const facts = () => ({
  fxNodes: [...document.querySelectorAll('.wc-fx')].length,
  fxVisibleParts: [...document.querySelectorAll('.wc-fx i, .wc-fx b, .wc-fx span, .wc-fx u')].filter((el) => {
    const style = getComputedStyle(el);
    return style.display !== 'none' && style.visibility !== 'hidden' && Number(style.opacity) !== 0;
  }).length,
  dataReduced: [...document.querySelectorAll('.wc-weapon')].map((el) => el.dataset.reduced ?? null),
});
try {
  host = await startHost(43866, 'probe-reduced');
  const devLog = [];
  dev = spawn(process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_PORT)], { cwd: repo, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: host.data, BUNNY_HOST_CREDENTIALS_FILE: host.credentials, FORCE_COLOR: '0', NO_COLOR: '1' }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  dev.stdout.on('data', b => devLog.push(String(b)));
  dev.stderr.on('data', b => devLog.push(String(b)));
  let webReady = false;
  for (let i = 0; i < 240; i++) { try { const r = await fetch(`http://127.0.0.1:${DEV_PORT}/`); if (r.ok) { webReady = true; break; } } catch {} await sleep(500); }
  if (!webReady) throw new Error('dev server never answered');
  await sleep(1500);
  browser = await chromium.launch({ headless: true });
  for (const mode of ['os-reduced', 'app-off']) {
    const context = await browser.newContext({ viewport: { width: 1366, height: 800 }, colorScheme: 'dark', reducedMotion: mode === 'os-reduced' ? 'reduce' : 'no-preference' });
    const page = await context.newPage();
    const url = `http://127.0.0.1:${DEV_PORT}/?view=${mode === 'app-off' ? 'settings' : 'missions'}&theme=dark`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
    await page.waitForFunction(() => document.querySelectorAll('button').length > 4, null, { timeout: 60000 });
    if (mode === 'app-off') {
      // Drive the real Settings control: the Off choice is a button labelled by value in the Motion row.
      await page.getByLabel('Motion').selectOption('off');
      await page.goto(url.replace('view=settings', 'view=missions'), { waitUntil: 'domcontentloaded', timeout: 120000 });
    }
    await page.waitForFunction(() => document.querySelectorAll('.wc-weapon').length >= 1, null, { timeout: 60000 });
    await sleep(1500);
    const f = await page.evaluate(facts);
    const shot = join(import.meta.dirname, `shots`, `reduced-${mode}.png`);
    await page.screenshot({ path: shot });
    results.shots[mode] = shot;
    check(`${mode}: every character reports the reduced flag`, f.dataReduced.length > 0 && f.dataReduced.every((v) => v === 'true'), { dataReduced: f.dataReduced });
    check(`${mode}: no frozen effect parts are painted`, f.fxVisibleParts === 0, { fxNodes: f.fxNodes, fxVisibleParts: f.fxVisibleParts });
    await context.close();
  }
} catch (e) {
  console.error('FATAL', String(e?.stack ?? e));
  results.fatal = String(e?.message ?? e);
} finally {
  try { if (browser) await browser.close(); } catch {}
  try { if (dev && dev.exitCode === null) execFileSync('taskkill.exe', ["/PID", String(dev.pid), "/T", "/F"], { stdio: 'ignore', windowsHide: true }); } catch {}
  try { if (host) { await host.stop(); } } catch {}
  writeFileSync(join(import.meta.dirname, 'probe-reduced-results.json'), JSON.stringify(results, null, 2) + '\n');
}
process.exitCode = results.fatal || results.checks.some((c) => !c.ok) ? 1 : 0;