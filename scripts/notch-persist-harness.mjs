// MA5-S2 Sprint 2 notch persistence evidence driver. Fresh evidence, not cited from the T13 era.
// Against the committed disposable fixture host (test-results/ma3/t13/notch/fake-host.mjs, ports
// 43800-43899 only) it runs the real installed-shape WPF Island twice per saved edge, with a scratch
// preference file: run one docks the notch (synthetic release point invoking Invoke-BunnyDockRelease, or
// the keyboard chord body Set-BunnyDockEdge — the release-point contract used since the M-A-3 T13 drag
// receipt, not a physical press-drag gesture); run two is a cold restart that must restore the saved
// edge, along-edge offset and monitor before any input. Every verdict is recomputed HERE from the
// written receipts — a claim recorded inside the Island never passes by itself.
// Usage: node scripts/notch-persist-harness.mjs   (Windows only; the evidence run is manual, not a CI test)
import assert from 'node:assert/strict';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const wrapper = join(root, 'scripts', 'notch-persist-wrapper.ps1');
const hooks = {
  dock: join(root, 'scripts', 'notch-persist-hook-dock.ps1'),
  keyboard: join(root, 'scripts', 'notch-persist-hook-keyboard.ps1'),
  restore: join(root, 'scripts', 'notch-persist-hook-restore.ps1'),
};
const fakeHost = join(root, 'test-results', 'ma3', 't13', 'notch', 'fake-host.mjs');
const shots = join(root, 'screenshots');
const results = join(root, 'test-results');
const expand = { top: 'down', bottom: 'up', left: 'right', right: 'left' };
const token = 'notch-fake-token';

function pickPort() {
  // fake-host.mjs only accepts 43800-43899, so probe those ports directly instead of asking
  // for an ephemeral one: only ports this driver binds are ever used.
  return new Promise((done, reject) => {
    const probe = (port) => {
      if (port > 43899) {
        reject(new Error('no free port in the 43800-43899 fixture range'));
        return;
      }
      const srv = net.createServer();
      srv.once('error', () => {
        try { srv.close(); } catch { /* already closed */ }
        probe(port + 1);
      });
      srv.listen(port, '127.0.0.1', () => srv.close(() => done(port)));
    };
    probe(43800);
  });
}

function hostReady(port, deadline) {
  return new Promise((done, fail) => {
    const tick = () => {
      const req = http.get(
        { host: '127.0.0.1', port, path: '/state', headers: { Authorization: 'Bearer ' + token }, timeout: 2000 },
        (res) => {
          res.resume();
          if (res.statusCode === 200) done(true);
          else setTimeout(tick, 250);
        },
      );
      req.once('error', () => {
        if (Date.now() > deadline) fail(new Error('fixture host not ready on ' + port));
        else setTimeout(tick, 250);
      });
      req.once('timeout', () => {
        req.destroy();
        if (Date.now() > deadline) fail(new Error('fixture host not ready on ' + port));
        else setTimeout(tick, 250);
      });
    };
    tick();
  });
}

function workInside(receipt) {
  const wa = receipt.workArea;
  const w = receipt.window;
  const eps = 0.011;
  return (
    w.left >= wa.left - eps &&
    w.top >= wa.top - eps &&
    w.left + w.width <= wa.left + wa.width + eps &&
    w.top + w.height <= wa.top + wa.height + eps
  );
}

function runIsland(hook, env, logName) {
  const logPath = join(results, 'sprint2-notch-' + logName + '.log');
  const stream = [];
  return new Promise((resolve, reject) => {
    const child = spawn(
      'powershell.exe',
      ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', wrapper, '-HookFile', hook, '-Pref', prefPath, '-Shots', shots, '-Cred', credPath, '-Deploy', deployPath],
      { env: { ...process.env, ...env } },
    );
    const timer = setTimeout(() => {
      try { child.kill(); } catch { /* the timed-out run is already dying on its own */ }
      reject(new Error('island run ' + logName + ' did not exit within 120 s'));
    }, 120000);
    child.stdout.on('data', (d) => stream.push(String(d)));
    child.stderr.on('data', (d) => stream.push('ERR: ' + String(d)));
    child.once('error', (e) => { clearTimeout(timer); reject(e); });
    child.once('exit', (code) => {
      clearTimeout(timer);
      writeFileSync(logPath, stream.join(''));
      resolve(code);
    });
  });
}

function loadReceipt(file) {
  assert.ok(existsSync(file), 'receipt missing: ' + file);
  return JSON.parse(readFileSync(file, 'utf8'));
}

function checkDockStage(r, target) {
  const vertical = target === 'left' || target === 'right';
  return [
    [r.stage === 'dock', 'stage is dock'],
    [r.edge === target, 'saved edge is ' + target],
    [r.edgeOffset >= 0 && r.edgeOffset <= 1, 'offset is clamped 0..1'],
    [r.position === 'center', 'position re-centred'],
    [r.editChoice === target, 'Settings edge dropdown follows the save'],
    [!!r.monitor && typeof r.monitor.device === 'string' && r.monitor.device.length > 0, 'monitor device recorded'],
    [!!r.monitor && typeof r.monitor.fingerprint === 'string' && r.monitor.fingerprint.length > 0, 'monitor work-area fingerprint recorded'],
    [r.orientation === (vertical ? 'vertical' : 'horizontal'), 'orientation follows the edge'],
    [r.indicatorSide === (vertical ? 'top' : 'left'), 'indicator side follows the orientation'],
    [r.expandDirection === expand[target], 'expansion anchored to the dock edge'],
    [workInside(r), 'window fully inside the work area (taskbar-safe)'],
    [existsSync(join(shots, 'sprint2-dock-' + target + '.png')), 'dock screenshot saved'],
  ];
}

function checkKeyboardStage(r, target) {
  return [
    [r.stage === 'keyboard', 'stage is keyboard'],
    [r.edge === target, 'saved edge is ' + target],
    [r.position === 'center', 'position re-centred'],
    [r.editChoice === target, 'Settings edge dropdown follows the save'],
    [r.expandDirection === expand[target], 'expansion anchored to the dock edge'],
    [workInside(r), 'window fully inside the work area (taskbar-safe)'],
    [existsSync(join(shots, 'sprint2-keyboard-' + target + '.png')), 'keyboard screenshot saved'],
  ];
}

function checkRestoreStage(r, dock) {
  const target = dock.target;
  const vertical = target === 'left' || target === 'right';
  return [
    [r.stage === 'restore', 'stage is restore'],
    [r.expectedEdge === target, 'expected edge is the saved one'],
    [r.edge === target, 'cold start restored the saved edge'],
    [Math.abs(r.edgeOffset - dock.edgeOffset) < 1e-6, 'along-edge offset restored exactly'],
    [r.position === dock.position, 'position restored'],
    [JSON.stringify(r.monitor) === JSON.stringify(dock.monitor), 'monitor device + fingerprint restored'],
    [r.orientation === (vertical ? 'vertical' : 'horizontal'), 'orientation restored'],
    [r.indicatorSide === (vertical ? 'top' : 'left'), 'indicator side restored'],
    [r.expandDirection === expand[target], 'expansion direction restored'],
    [workInside(r), 'restored window fully inside the work area (taskbar-safe)'],
    [existsSync(join(shots, 'sprint2-restore-' + target + '.png')), 'restore screenshot saved'],
  ];
}

const work = mkdtempSync(join(tmpdir(), 'notch-persist-'));
const prefPath = join(work, 'pref.json');
const credPath = join(work, 'cred.json');
const deployPath = join(work, 'no-deploy');
mkdirSync(deployPath, { recursive: true });
mkdirSync(shots, { recursive: true });
mkdirSync(results, { recursive: true });
// Initial preferences exactly as the Island writes them on first run (defaults, pristine file).
writeFileSync(prefPath, JSON.stringify({ size: 'compact', position: 'center', idle: 'providers', glass: 'medium', motion: 'full', collapse: 10, theme: 'dark', primary: ['codex', 'claude', 'ollama'], edge: 'top', edgeOffset: 0.5, blur: 'off', monitor: null }));

const host = await (async () => {
  const port = await pickPort();
  const child = spawn(process.execPath, [fakeHost, String(port), 'idle', join(work, 'commands.jsonl'), 'none'], { stdio: ['ignore', 'pipe', 'pipe'] });
  await hostReady(port, Date.now() + 30000);
  return { child, port };
})();
// The credential file the Island's presence poll reads: fixture token + the fixture port only.
// Written before the first island run; the hooks themselves never touch it.
writeFileSync(credPath, JSON.stringify({ token, port: host.port }));

const runs = [];
const failures = [];

async function cycle(hook, stage, target, label) {
  label = label || stage + '-' + target;
  const receiptFile = join(work, label + '.receipt.json');
  const code = await runIsland(hook, { NOTCH_TARGET: target, NOTCH_EXPECT: target, NOTCH_RECEIPT_PATH: receiptFile }, label);
  if (code !== 0) { failures.push(label + ': island run exited ' + code); return null; }
  const receipt = loadReceipt(receiptFile);
  const checks = stage === 'dock' ? checkDockStage(receipt, target) : stage === 'keyboard' ? checkKeyboardStage(receipt, target) : [];
  for (const [ok, rule] of checks) {
    if (!ok) failures.push(label + ': ' + rule);
    runs.push({ name: label, rule, result: ok ? 'PASS' : 'FAIL' });
  }
  runs.push({ name: label, rule: 'stage completed', result: 'PASS' });
  return receipt;
}

try {
  for (const edge of ['top', 'bottom', 'left', 'right']) {
    const dock = await cycle(hooks.dock, 'dock', edge);
    if (!dock) continue;
    // Strongest save-side fact read back from the file the Island itself wrote:
    const saved = JSON.parse(readFileSync(prefPath, 'utf8').replace(/^\uFEFF/, ''));
    const fileChecks = [
      [saved.edge === edge, 'Island preference file records edge ' + edge],
      [typeof saved.edgeOffset === 'number', 'Island preference file records a numeric edgeOffset'],
      [!!saved.monitor && typeof saved.monitor.device === 'string', 'Island preference file records the monitor binding'],
    ];
    for (const [ok, rule] of fileChecks) {
      if (!ok) failures.push('dock-' + edge + ': ' + rule);
      runs.push({ name: 'dock-' + edge, rule, result: ok ? 'PASS' : 'FAIL' });
    }
    const restore = await cycle(hooks.restore, 'restore', edge);
    if (!restore) continue;
    for (const [ok, rule] of checkRestoreStage(restore, dock)) {
      if (!ok) failures.push('restore-' + edge + ': ' + rule);
      runs.push({ name: 'restore-' + edge, rule, result: ok ? 'PASS' : 'FAIL' });
    }
  }
  const keyboard = await cycle(hooks.keyboard, 'keyboard', 'top');
  if (keyboard) {
    const restore = await cycle(hooks.restore, 'restore', 'top', 'restore-top-keyboard');
    if (restore) {
      for (const [ok, rule] of checkRestoreStage(restore, keyboard)) {
        if (!ok) failures.push('restore-top(keyboard): ' + rule);
        runs.push({ name: 'restore-top-keyboard', rule, result: ok ? 'PASS' : 'FAIL' });
      }
    }
  }
} finally {
  if (host && host.child && !host.child.killed) host.child.kill();
}

const summary = {
  milestone: 'MA5-S2 Sprint 2 — native notch persistence (dock + cold-restart restore)',
  purpose: 'Fresh per-edge evidence that a synthetic pointer release (or the keyboard chord body) saves edge, along-edge offset and monitor fingerprint into the Island preference file, and that a cold restart restores that placement before any input, with the window fully inside the primary work area.',
  coverage: 'Synthetic release coordinates and the chord body only: native snap/release-path and save/restore coverage, not a physical press-drag gesture and not physical keyboard chords (those stay owner-live).',
  fixture: 'Disposable fixture host ' + fakeHost + ' on 127.0.0.1:' + host.port + ' only. No production Host, no 43119, no 8084.',
  environmentBound: 'Screens, scale factor and monitor enumeration are this machine\'s; the restore-rules matrix for monitors/DPI changes is locked separately at unit level (Select-BunnyMonitor).',
  generatedAt: new Date().toISOString(),
  machine: { hostname: os.hostname(), release: os.release(), platform: process.platform },
  runs,
  failures,
};
writeFileSync(join(results, 'sprint2-notch-persist-receipts.json'), JSON.stringify(summary, null, 2));
const passed = runs.filter((r) => r.result === 'PASS').length;
console.log('checks recorded: ' + passed + ' pass, ' + failures.length + ' fail');
console.log(failures.length === 0 ? 'sprint2 notch persistence evidence: ALL PASS' : 'sprint2 notch persistence evidence: FAILURES (' + failures.length + ')');
for (const f of failures) console.log('  - ' + f);
process.exitCode = failures.length === 0 ? 0 : 1;
rmSync(work, { recursive: true, force: true });
