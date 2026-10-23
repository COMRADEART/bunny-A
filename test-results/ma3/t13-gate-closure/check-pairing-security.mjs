// Supplementary software evidence only. This never substitutes for physical Android acceptance.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve, relative } from 'node:path';
import { tmpdir } from 'node:os';
import { createServer } from 'node:net';
import { pathToFileURL } from 'node:url';
const evidence = import.meta.dirname;
const source = join(evidence, 'validation-checkout');
const { startHost } = await import(pathToFileURL(join(source, 'src/lib/bunny-host/http.server.ts')).href);
const directory = mkdtempSync(join(tmpdir(), 'bunny-t13-gc-security-'));
const workspace = join(directory, 'project');
mkdirSync(workspace);
const socket = createServer();
await new Promise(done => socket.listen(0, '127.0.0.1', done));
const port = socket.address().port;
await new Promise(done => socket.close(done));
const host = await startHost({ dataDirectory: directory, root: workspace, port, adapters: [], sample: async () => ({ at: Date.now(), cpu: { utilization: null, clockMhz: null, temperatureC: null }, memory: { usedBytes: 0, availableBytes: 1, totalBytes: 1 }, gpus: [], notes: ['Disposable T13 gate software security validation'] }) });
const results = [];
const originalNow = Date.now;
const command = async (action, data = {}, token = host.token, extraHeaders = {}) => {
  const response = await fetch(`http://127.0.0.1:${port}/command`, { method: 'POST', headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify({ action, data }) });
  return { status: response.status, body: await response.json() };
};
const pair = async code => {
  const response = await fetch(`http://127.0.0.1:${port}/pair`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ code, name: 'Disposable T13 software client' }) });
  return { status: response.status, body: await response.json() };
};
try {
  const anonymous = await fetch(`http://127.0.0.1:${port}/state`);
  assert.equal(anonymous.status, 401);
  results.push({ check: 'anonymous Host state rejected', status: anonymous.status, passed: true });
  const issued = await command('pairing.create');
  assert.equal(issued.status, 200);
  assert.match(issued.body.pairCode, /^[A-Za-z0-9_-]{16}$/);
  results.push({ check: 'workstation issues cryptographically shaped pairing code', status: issued.status, passed: true, codeRetained: false });
  const accepted = await pair(issued.body.pairCode);
  assert.equal(accepted.status, 200);
  const state = await fetch(`http://127.0.0.1:${port}/state`, { headers: { authorization: `Bearer ${accepted.body.token}` } });
  assert.equal(state.status, 200);
  results.push({ check: 'new paired software credential authenticates', status: state.status, passed: true });
  const ownerState = await (await fetch(`http://127.0.0.1:${port}/state`, { headers: { authorization: `Bearer ${host.token}` } })).json();
  assert.ok(ownerState.devices.some(row => row.id === accepted.body.deviceId));
  results.push({ check: 'workstation lists paired software principal', passed: true });
  const replay = await pair(issued.body.pairCode);
  assert.equal(replay.status, 403);
  results.push({ check: 'reused pairing code rejected', status: replay.status, passed: true });
  const forged = await command('pairing.create', {}, accepted.body.token, { 'x-bunny-actor': 'workstation', 'x-forwarded-for': '127.0.0.1' });
  assert.equal(forged.status, 400);
  results.push({ check: 'paired device cannot issue codes by forging owner headers', status: forged.status, passed: true });
  const expiring = await command('pairing.create');
  assert.equal(expiring.status, 200);
  const future = originalNow() + 600001;
  Date.now = () => future;
  let expired;
  try { expired = await pair(expiring.body.pairCode); } finally { Date.now = originalNow; }
  assert.equal(expired.status, 403);
  results.push({ check: 'expired pairing code rejected', status: expired.status, passed: true, clock: 'SIMULATED +600001 ms in this disposable process; actual Host HTTP path' });
  assert.equal((await command('device.revoke', { id: accepted.body.deviceId })).status, 200);
  const revoked = await fetch(`http://127.0.0.1:${port}/state`, { headers: { authorization: `Bearer ${accepted.body.token}` } });
  assert.equal(revoked.status, 401);
  results.push({ check: 'revoked credential cannot read Host state', status: revoked.status, passed: true });
  writeFileSync(join(evidence, 'pairing-security.json'), JSON.stringify({ command: 'node --experimental-strip-types test-results/ma3/t13-gate-closure/check-pairing-security.mjs', checkedAt: new Date().toISOString(), sourceSha: 'b23005136c48036968036475e841dcf67a38a794', classification: 'LIVE disposable Host HTTP; software client; expiry clock explicitly simulated', physicalAndroid: false, results, passed: results.every(row => row.passed) }, null, 2) + '\n');
  console.log('Eight disposable Host pairing-security checks passed. Physical Android remains untested.');
} finally {
  Date.now = originalNow;
  await host.close();
  const withinTemp = relative(resolve(tmpdir()), resolve(directory));
  if (!withinTemp.startsWith('bunny-t13-gc-security-') || withinTemp.includes('..')) throw new Error('Refusing cleanup outside the generated disposable directory.');
  rmSync(directory, { recursive: true, force: true, maxRetries: 20, retryDelay: 50 });
}
