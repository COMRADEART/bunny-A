import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** T8 recovery preflight: read-only; pending work and live authority must be quiescent before code switches. */
export async function idleCheck(port, token, stateRoot) {
  if (!stateRoot) throw new Error('idleCheckRefused:canonical-state-required');
  const response = await fetch('http://127.0.0.1:' + port + '/state', { headers: { authorization: 'Bearer ' + token }, signal: AbortSignal.timeout(15000) });
  if (response.status !== 200) throw new Error('idleCheckRefused:state-unavailable');
  const state = await response.json();
  const db = new DatabaseSync(join(stateRoot, 'host.sqlite'), { readOnly: true });
  try {
    const exists = table => !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table);
    const rows = table => exists(table) ? db.prepare('SELECT record FROM ' + table).all().map(row => JSON.parse(row.record)) : [];
    const terminal = new Set(['completed', 'failed', 'stopped', 'cancelled', 'rejected']);
    const activeTasks = rows('tasks').filter(task => !terminal.has(task.state));
    const activeMissions = rows('missions').filter(mission => !terminal.has(mission.state) && mission.state !== 'draft');
    const inFlightRuns = rows('capability_runs').filter(run => ['running', 'in_flight', 'started'].includes(run.status));
    const activeBatches = rows('approval_batches').filter(batch => batch.status === 'active' && batch.expiresAt > Date.now());
    const flags = db.prepare("SELECT value FROM settings WHERE key='missions_config'").get();
    const config = flags ? JSON.parse(flags.value) : {};
    if (activeTasks.length || activeMissions.length || inFlightRuns.length || activeBatches.length || config.enabled || config.triggersEnabled)
      throw new Error('idleCheckRefused:active-work ' + JSON.stringify({ tasks: activeTasks.length, missions: activeMissions.length, runs: inFlightRuns.length, grants: activeBatches.length, missionsEnabled: config.enabled === true, triggersEnabled: config.triggersEnabled === true }));
    if (state.missions?.enabled || state.missions?.config?.triggersEnabled) throw new Error('idleCheckRefused:live-policy-not-quiescent');
    return { idle: true, activeTasks: [], activeMissions: [], inFlightRuns: [], activeBatches: [], missionsEnabled: false, triggersEnabled: false, databaseCheckedReadOnly: true };
  } finally { db.close(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const read = path => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, ''));
    const config = read(process.argv[2]);
    const credentials = read(join(config.stateRoot, 'credentials/credentials.json'));
    const result = await idleCheck(config.hostPort, credentials.token, config.stateRoot);
    console.log(JSON.stringify(result));
  } catch (error) {
    // Only a stable refusal class and counts reach release tooling output.
    console.error(String(error?.message).startsWith('idleCheckRefused:') ? error.message : 'idleCheckRefused:validation-unavailable');
    process.exitCode = 1;
  }
}
