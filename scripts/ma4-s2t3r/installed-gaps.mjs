// Installed-release scenarios the lifecycle run left open: cancelling a RUNNING pinned-model task (and its process
// tree), and duplicate tasks or notifications. Dedicated TEST install only; launched like installed-lifecycle.mjs
// (isolated profile and PATH, no notch, no remote). The Host is left running only with --keep.
//   node scripts/ma4-s2t3r/installed-gaps.mjs <TEST install> <evidence.json> [--keep]
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';

const [installArg, outputArg, keep] = process.argv.slice(2);
if (!installArg || !outputArg) throw new Error('usage: installed-gaps.mjs <TEST install> <evidence.json> [--keep]');
const install = resolve(installArg), config = JSON.parse(readFileSync(join(install, 'install.json'), 'utf8').replace(/^﻿/, ''));
if (!config.currentRelease.name.endsWith('-TEST') || config.hostPort !== 43191 || !install.includes('Bunny-S2T3R-Install')) throw new Error('Not the dedicated test installation.');
const MODEL = 'qwen2.5-coder:7b', base = `http://127.0.0.1:${config.hostPort}`;
const credentials = () => JSON.parse(readFileSync(join(config.stateRoot, 'credentials/credentials.json'), 'utf8'));
const cmd = async (action, data = {}) => {
  const r = await fetch(base + '/command', { method: 'POST', headers: { authorization: `Bearer ${credentials().token}`, 'content-type': 'application/json', connection: 'close' }, body: JSON.stringify({ action, data }) });
  const b = await r.json(); if (!r.ok) throw Error(`${action}: ${b.error}`); return b.data;
};
const sleep = ms => new Promise(r => setTimeout(r, ms));
const until = async (fn, ms = 30_000) => { const end = Date.now() + ms; while (Date.now() < end) { const v = await fn().catch(() => null); if (v) return v; await sleep(250); } return null; };
const checks = [], check = (name, pass, detail = null) => { checks.push({ name, pass: !!pass, detail }); console.log(JSON.stringify(checks.at(-1))); };
const health = async () => { try { return await (await fetch(base + '/health', { signal: AbortSignal.timeout(1_000) })).json(); } catch { return null; } };
// Every descendant of the Host, by the OS process table.
const tree = pid => JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-Command',
  `$all=Get-CimInstance Win32_Process|Select-Object ProcessId,ParentProcessId,Name;$q=@(${pid});$out=@();while($q.Count){$p=$q[0];$q=@($q|Select-Object -Skip 1);foreach($c in $all|Where-Object ParentProcessId -eq $p){$out+=$c;$q+=$c.ProcessId}};ConvertTo-Json -Compress @($out|ForEach-Object{@{pid=$_.ProcessId;name=$_.Name}})`], { encoding: 'utf8' }) || '[]');
const isolated = { ...process.env, PSModulePath: join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/Modules'), USERPROFILE: join(install, '../isolated-user'), APPDATA: join(install, '../isolated-user/Roaming'),
  LOCALAPPDATA: join(install, '../isolated-user/Local'), PATH: process.env.WINDIR + '\\System32;' + join(config.currentRelease.folder, 'runtime') };
let policy = null;
try {
  if (!(await health())) {
    const launcher = spawn(join(process.env.WINDIR, 'System32/WindowsPowerShell/v1.0/powershell.exe'), ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(config.currentRelease.folder, 'Start-Bunny-Release.ps1'), '-InstallConfig', join(install, 'install.json'), '-NoIsland', '-NoRemote'],
      { stdio: 'ignore', windowsHide: true, env: isolated });
    launcher.unref();
    check('installed launcher starts Host and gateway', await until(async () => (await health()) && (await fetch('http://127.0.0.1:8084/bunny-health')).ok, 120_000));
  }
  const host = await health();
  policy = (await cmd('ptask.list')).policy;
  await cmd('ptask.policy', { policy: { ...policy, background: true, resumeOnStart: false } });

  // 14/15: cancel a running pinned-model task; nothing it started outlives it.
  const childrenBefore = tree(host.pid);
  const env = { capabilities: ['file.read', 'local.generate'], providers: ['ollama'], localOnly: true, models: [MODEL], projectScopes: ['personal'], sideEffects: false, background: true, budgets: { maxModelCalls: 2, maxWallMs: 900_000 }, expiresAt: Date.now() + 3_600_000, grants: { files: [{ root: 'atlas', access: 'read' }] } };
  const steps = [{ id: 'read', kind: 'file.read', input: { root: 'atlas', path: 'STATUS.md' } }, { id: 'draft', kind: 'local.generate', input: { prompt: 'Write a detailed 900-word plan from this status, section by section.', contextFrom: 'read' }, model: MODEL }];
  const task = await cmd('ptask.create', { spec: { title: 'Installed running-model cancel', projectId: 'personal', steps, acceptance: { requiredSteps: ['read', 'draft'] } }, envelope: env });
  await cmd('ptask.approve', { id: task.id });
  const running = await until(async () => { const t = await cmd('ptask.get', { id: task.id }); return t.state === 'RUNNING' && t.progress.current === 'draft' && t; }, 120_000);
  await sleep(3_000); // inside the generation, not at its boundary
  const childrenRunning = tree(host.pid), t0 = Date.now();
  await cmd('ptask.cancel', { id: task.id });
  const cancelled = await until(async () => { const t = await cmd('ptask.get', { id: task.id }); return t.state === 'CANCELLED' && t; }, 60_000);
  await sleep(2_000);
  const childrenAfter = tree(host.pid);
  check('cancel stops a running pinned-model task', !!running && !!cancelled && !cancelled.evidence.some(e => e.stepId === 'draft'), { reachedRunning: !!running, ms: Date.now() - t0, state: cancelled?.state, evidence: cancelled?.evidence.map(e => e.stepId) });
  check('no process started for the task outlives it', childrenAfter.length <= childrenBefore.length, { before: childrenBefore.map(c => c.name), running: childrenRunning.map(c => c.name), after: childrenAfter.map(c => c.name) });
  check('Host still healthy after cancel', (await health())?.pid === host.pid);

  // 17: duplicates, from the installed database itself (read-only).
  const db = new DatabaseSync(join(config.stateRoot, 'host.sqlite'), { readOnly: true });
  const one = (sql) => db.prepare(sql).all();
  const dupOcc = one('SELECT task_id, COUNT(*) n FROM ma4_occurrences WHERE task_id IS NOT NULL GROUP BY task_id HAVING n > 1');
  // Separate deliberate runs reuse fixture titles; a duplicate is the same title created within the same 5 s.
  const titles = one("SELECT json_extract(record,'$.spec.title') t, created_at / 5000 w, COUNT(*) n FROM ma4_tasks GROUP BY t, w HAVING n > 1");
  const notes = one("SELECT category, source_id, reason, COUNT(*) n FROM ma4_proactive_notifications GROUP BY category, source_id, reason HAVING n > 1");
  db.close();
  check('no occurrence started two tasks', !dupOcc.length, dupOcc);
  check('no task created twice', !titles.length, titles);
  check('no semantic duplicate notification', !notes.length, notes);
} catch (e) { check('gap driver completed', false, String(e.message)); }
finally {
  if (policy) await cmd('ptask.policy', { policy: { ...policy, background: false, resumeOnStart: false } }).catch(() => undefined);
  if (keep !== '--keep') { const h = await health(); if (h) { try { process.kill(h.pid); } catch { /* gone */ } } }
  writeFileSync(outputArg, JSON.stringify({ at: new Date().toISOString(), sourceCommit: config.currentRelease.sourceCommit, package: config.currentRelease.name, checks, failed: checks.filter(c => !c.pass).length }, null, 2) + '\n');
}
