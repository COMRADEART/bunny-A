// T13 probe: does the dev bridge SSE deliver Host lifecycle events promptly, and how fast does a
// canonical /state read reflect a transition? Disposable Host 43862 + owned dev 8097 only.
import { startHost, repo } from './host.mjs';
import { writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { spawn, execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const DEV_PORT = 8097;
let host, dev;
const t0 = Date.now();
const stamp = () => Date.now() - t0;
try {
  host = await startHost(43862, 'probe-refresh');
  console.log('HOST', host.pid, 'at', stamp());
  writeFileSync(join(host.workspace, 'seed.txt'), 'seed');
  writeFileSync(join(host.workspace, 'live.test.mjs'), "import test from 'node:test';\nimport assert from 'node:assert/strict';\ntest('probe', async () => { await new Promise(r => setTimeout(r, 6000)); assert.equal(1, 1); });\n");
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
  console.log('BOUND at', stamp());

  const devLog = [];
  dev = spawn(process.execPath, [join(dirname(process.execPath), 'node_modules/npm/bin/npm-cli.js'), 'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(DEV_PORT)], { cwd: repo, env: { ...process.env, BUNNY_HOST_DATA_DIRECTORY: host.data, BUNNY_HOST_CREDENTIALS_FILE: host.credentials }, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
  dev.stdout.on('data', b => devLog.push(String(b)));
  dev.stderr.on('data', b => devLog.push(String(b)));
  let ready = false;
  const plain = () => devLog.join('').replace(/\u001b\[[0-9;]*m/g, '');
  for (let i = 0; i < 120 && !ready; i++) { if (plain().includes(`127.0.0.1:${DEV_PORT}/`)) ready = true; else await sleep(500); }
  if (!ready) throw new Error('dev not ready: ' + devLog.join('').slice(-800));
  console.log('DEV ready at', stamp());

  // Open the bridge SSE exactly like the client does (cursor 0) and log arrivals.
  const sse = await fetch(`http://127.0.0.1:${DEV_PORT}/api/bunny-events?after=0`);
  console.log('SSE status', sse.status, 'at', stamp());
  const reader = sse.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const sseLines = [];
  const pump = (async () => {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) { sseLines.push({ at: stamp(), line: 'DONE' }); return; }
      buf += decoder.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1); if (line) sseLines.push({ at: stamp(), line: line.slice(0, 120) }); }
    }
  })().catch(e => sseLines.push({ at: stamp(), line: 'ERR ' + e.message }));

  const a = st0.agents?.agents?.find?.(x => x.id === agentId);
  await api('agent.start', { id: agentId, ...(a?.authorization ? { revision: a.authorization.revision } : {}) });
  console.log('STARTED at', stamp());
  let hostVerifiedAt = null, hostTestingAt = null;
  for (let i = 0; i < 200; i++) {
    const s = await host.state();
    const slot = s.personalAgents.slots.find(x => x.slot === 3);
    if (slot.presentation.state === 'TESTING' && hostTestingAt === null) { hostTestingAt = Date.now(); console.log('HOST TESTING at', stamp()); }
    if (slot.presentation.state === 'VERIFIED') { hostVerifiedAt = Date.now(); console.log('HOST VERIFIED at', stamp()); break; }
    await sleep(100);
  }
  await sleep(3000);
  console.log('SSE lines after start:', JSON.stringify(sseLines.filter(l => l.at > 0).slice(-30), null, 1));
  reader.cancel().catch(() => {});
  await pump.catch(() => {});
  console.log(JSON.stringify({ hostTestingAt, hostVerifiedAt }));
} finally {
  if (dev && dev.exitCode === null) { try { execFileSync('taskkill.exe', ['/PID', String(dev.pid), '/T', '/F'], { stdio: 'ignore', windowsHide: true }); } catch { dev.kill(); } }
  if (host) await host.stop();
}
