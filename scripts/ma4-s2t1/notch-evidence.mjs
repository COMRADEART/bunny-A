// MA4-S2-T1 Windows notch evidence: the real WPF Island (-SmokeTest -CollapsedView) rendered against a real Host whose
// persistent tasks are in known states, on a horizontal (top) and a side (left) notch, then again after a Host restart.
//   node --experimental-strip-types scripts/ma4-s2t1/notch-evidence.mjs
// Executors are recorded fakes (no model, nothing external). Output: docs/ma4-s2-t1/evidence/notch/.
import { spawn } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { startHost } from '../../src/lib/bunny-host/http.server.ts';

const root = resolve(import.meta.dirname, '../..');
const out = join(root, 'docs/ma4-s2-t1/evidence/notch');
mkdirSync(out, { recursive: true });
const data = mkdtempSync(join(tmpdir(), 'bunny-s2t1-notch-'));
const port = await new Promise(r => { const s = createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => r(p)); }); });
let release;
const executors = [
  { kind: 'local.read', category: 'read_only', gpu: false, sideEffect: false, timeoutMs: 600_000,
    async run(input, ctx) { if (input.hold) await new Promise(r => { release = r; ctx.signal.addEventListener('abort', r, { once: true }); }); return ctx.signal.aborted ? { ok: false, error: 'stopped', dispatched: true, definite: false } : { ok: true, output: 'ok' }; } },
  { kind: 'fake.send', category: 'irreversible', gpu: false, sideEffect: true, timeoutMs: 600_000,
    async run() { return { ok: false, error: 'The connection dropped after sending.', dispatched: true, definite: false }; } },
];
const options = { dataDirectory: data, root, port, adapters: [], ptasks: { executors, call: async () => ({ ok: false, error: 'none', durationMs: 0 }), modelAvailable: async () => false } };
const envelope = (over = {}) => ({ capabilities: ['local.read', 'fake.send'], providers: ['ollama'], localOnly: true, models: [], projectScopes: ['p1'], sideEffects: true, background: false, budgets: { maxModelCalls: 0, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000, ...over });
const spec = (title, steps) => ({ title, projectId: 'p1', steps, acceptance: { requiredSteps: steps.map(s => s.id) } });
let host = await startHost(options);
const cmd = async (action, data) => { const r = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { Authorization: `Bearer ${host.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ action, data }) }); const b = await r.json(); if (r.status !== 200) throw new Error(`${action}: ${b.error}`); return b.data; };
const facts = async () => (await (await fetch(`http://127.0.0.1:${port}/state`, { headers: { Authorization: `Bearer ${host.token}` } })).json()).persistentTasks.tasks.map(t => ({ title: t.title, state: t.state, display: t.display }));
// Async on purpose: the Host lives in this process, so a synchronous spawn would stall its event loop.
const island = async (edge, name) => {
  const prefs = join(data, `prefs-${edge}.json`);
  writeFileSync(prefs, JSON.stringify({ edge, edgeOffset: 0.5 }));
  const shots = join(data, `shots-${name}`);
  const ps = spawn('powershell.exe', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-STA', '-File', join(root, 'install/Bunny-Island.ps1'), '-SmokeTest', '-CollapsedView',
    '-CredentialPath', join(data, 'credentials.json'), '-DeploymentPath', join(data, 'no-deployment.json'), '-PreferencePath', prefs, '-ScreenshotDirectory', shots], { stdio: 'inherit' });
  await new Promise((r, reject) => ps.once('exit', code => code === 0 ? r() : reject(new Error(`Island exited ${code}`))));
  copyFileSync(join(shots, 'bunny-native-collapsed.png'), join(out, `${name}.png`));
};
const evidence = { captures: [] };
try {
  await fetch(`http://127.0.0.1:${port}/state`, { headers: { Authorization: `Bearer ${host.token}` } });
  await cmd('ptask.create', { spec: spec('Weekly digest', [{ id: 'a', kind: 'local.read', input: { hold: true } }, { id: 'b', kind: 'local.read', input: {} }]), envelope: envelope({ sideEffects: false }) });
  await cmd('ptask.create', { spec: spec('Publish notes', [{ id: 's', kind: 'fake.send', input: {} }]), envelope: envelope() });
  const sent = await cmd('ptask.create', { spec: spec('Send summary', [{ id: 's', kind: 'fake.send', input: {} }]), envelope: envelope() });
  await cmd('ptask.approve', { id: sent.id });
  for (let i = 0; i < 100 && !(await facts()).some(t => t.state === 'UNCERTAIN'); i++) await new Promise(r => setTimeout(r, 50));
  for (const [edge, name] of [['top', 'horizontal-live'], ['left', 'side-live']]) { await island(edge, name); evidence.captures.push({ name, edge, tasks: await facts() }); }
  await host.close();
  host = await startHost(options); // reconnect: same tasks, recovered by the Host's own startup policy
  for (const [edge, name] of [['top', 'horizontal-after-restart'], ['left', 'side-after-restart']]) { await island(edge, name); evidence.captures.push({ name, edge, tasks: await facts() }); }
  writeFileSync(join(out, 'notch-evidence.json'), JSON.stringify({ ...evidence, note: 'Real WPF Island against a real Host; recorded fake executors. The strip shows one task cell (count of open tasks, colour of the most urgent state); the status line shows the task headline.' }, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 1));
} finally { release?.(); await host.close(); rmSync(data, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 }); }
