// MA4-S2-T1 real-process crash fixture: a stand-in Host process that owns the real store and runtime, starts one step and
// then waits to be killed (taskkill /F, no /T — its children are orphaned exactly as after a real Host crash).
//   node --experimental-strip-types scripts/ma4-s2t1/crash-runner.mjs <db> <dir> <mode: read|send> <taskId> [detached]
// A normal child is in libuv's kill-on-close Job and dies with its Host; "detached" breaks away (an escaped child).
import { spawn } from 'node:child_process';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { TaskStore } from '../../src/lib/bunny-host/ma4/task-store.server.ts';
import { PersistentTaskRuntime } from '../../src/lib/bunny-host/ma4/task-runtime.server.ts';
import { processIdentity } from '../../src/lib/bunny-host/ma4/task-executors.server.ts';

const [dbPath, dir, mode, taskId, detached] = process.argv.slice(2);
const forever = signal => new Promise(resolve => signal.addEventListener('abort', resolve, { once: true }));
const executors = [
  { kind: 'proc.read', category: 'read_only', gpu: false, sideEffect: false, timeoutMs: 600_000,
    async run(_input, ctx) {
      const child = spawn(process.execPath, ['-e', 'setInterval(()=>{},1000)'], { stdio: 'ignore', detached: detached === 'detached' });
      ctx.track(child);
      // Wait until the identity is durable, then tell the test the step is in flight.
      for (let i = 0; i < 200 && !store.processes().length; i++) await new Promise(r => setTimeout(r, 50));
      writeFileSync(join(dir, 'in-flight'), JSON.stringify({ child: child.pid }));
      await forever(ctx.signal);
      return { ok: false, error: 'stopped', dispatched: true, definite: false };
    } },
  { kind: 'proc.send', category: 'irreversible', gpu: false, sideEffect: true, timeoutMs: 600_000,
    async run(_input, ctx) {
      appendFileSync(join(dir, 'external-ledger.txt'), `${ctx.idempotencyKey}\n`); // the fake external service received it
      writeFileSync(join(dir, 'in-flight'), JSON.stringify({ sent: true }));
      await forever(ctx.signal); // the reply never arrives before the crash
      return { ok: false, error: 'lost', dispatched: true, definite: false };
    } },
];
const db = new HostDatabase(dbPath), store = new TaskStore(db);
const rt = new PersistentTaskRuntime({ store, executors, call: async () => ({ ok: false, error: 'none', durationMs: 0 }), modelAvailable: async () => true, uiAttached: () => true, identify: processIdentity, instanceId: `runner-${process.pid}` });
const kind = mode === 'send' ? 'proc.send' : 'proc.read';
rt.create({ id: taskId, spec: { title: `crash ${mode}`, projectId: 'p1', steps: [{ id: 's', kind, input: {} }], acceptance: { requiredSteps: ['s'] } },
  envelope: { capabilities: [kind], providers: ['ollama'], localOnly: true, models: [], projectScopes: ['p1'], sideEffects: mode === 'send', background: false, budgets: { maxModelCalls: 0, maxWallMs: 3_600_000 }, expiresAt: Date.now() + 86_400_000 } }, 'workstation');
if (mode === 'send') rt.approve(taskId, 'workstation');
await rt.tick();
setInterval(() => {}, 1000);
