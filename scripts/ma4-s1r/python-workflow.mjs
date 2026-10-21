// MA4-S1R G7 v2: Planner -> (Worker || Tester) -> Reviewer through the real MA3 MissionManager and OllamaAdapter.
// Pre-registered before any run (do not edit after seeing outputs):
//   * TRIALS independent trials, one pinned local model, no retries, no cherry-picking; G7 PASS needs >= 2/3.
//   * Extraction: exactly one fenced block -> its body; no fence -> whole reply; more than one block -> FAIL.
//   * Bunny never executes agent code (verification.server.ts). This HARNESS runs it only after a Python AST gate
//     (imports limited to re/unittest/typing/duration; no dunder/introspection/IO builtins) in a Bunny-owned
//     Windows job with a timeout, minimal environment and an isolated temporary folder.
//   * Success = hidden harness tests pass AND the Tester's own tests run (>0) and pass against the Worker module.
//     The Reviewer verdict is recorded only; a model's own claim is never verification.
// Amendment A1 (before any generation; 0 model requests had run): the first wording named a .py file and used
//   "write ... code/test", which MA3 inferredConstraints() maps to a filesystem requirement, so the text-only
//   local model was refused pre-dispatch. Objectives now request source text without those phrases. Hidden
//   tests, gate, extraction and trial count are unchanged. Failed setup evidence: evidence/attempt-python-setup/.
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, freemem } from 'node:os';
import { join, resolve } from 'node:path';
import { probeOllama } from '../../src/lib/orch/exec.server.ts';
import { OllamaAdapter } from '../../src/lib/bunny-host/adapters.server.ts';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { TaskManager } from '../../src/lib/bunny-host/manager.server.ts';
import { ModelCapabilityRegistry } from '../../src/lib/bunny-host/model-capability.server.ts';
import { MissionManager } from '../../src/lib/bunny-missions/manager.server.ts';
import { TestProtector } from '../../src/lib/bunny-host/jev-secrets.server.ts';
import { resolveInterpreter } from '../../src/lib/bunny-host/verification.server.ts';
import { runWindowsOwnedProcess } from '../../src/lib/bunny-host/owned-process-group.server.ts';

const VERSION = 'bunny-ma4-s1r-python-workflow-v2', TRIALS = 3, MODEL = 'qwen2.5-coder:7b';
const originalFetch = globalThis.fetch;
let denied = 0, generations = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'http://127.0.0.1:11434' || !['/api/tags', '/api/version', '/api/show', '/api/ps', '/api/generate'].includes(url.pathname)) { denied++; throw new Error('Qualification network allowlist refused the request.'); }
  if (url.pathname === '/api/generate') { const body = JSON.parse(String(init?.body)); assert.equal(body.model, MODEL); if (body.prompt !== undefined) generations++; }
  return originalFetch(input, init);
};
const out = resolve('docs/ma4-s1r/evidence'); mkdirSync(out, { recursive: true });
const hash = v => createHash('sha256').update(v).digest('hex');
const save = v => writeFileSync(join(out, 'python-workflow.json'), JSON.stringify(v, null, 2) + '\n');
const api = async (path, body) => (await originalFetch('http://127.0.0.1:11434' + path, { signal: AbortSignal.timeout(60000), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) })).json();

const SPEC = "a Python 3 module called duration defining a function parse_duration(text) that converts a duration string into whole seconds. The string is one or more parts of the form <non-negative integer><unit>, units h (hours), m (minutes), s (seconds), appearing in that order, each unit at most once, with no spaces: '1h30m' -> 5400, '45s' -> 45, '2h5s' -> 7205. Any other string (empty, unknown unit, missing number, spaces, wrong order, repeated unit) must raise ValueError. Use only the Python standard library (re is allowed).";
const STEPS = [
  { role: 'Planner', objective: `Produce a short numbered implementation plan (at most 6 lines) for ${SPEC} Reply in prose only, without a source listing.`, executor: { kind: 'model' }, timeoutMs: 120000, maxRetries: 0 },
  { role: 'Worker', objective: `Implement ${SPEC} Follow the planner's plan. Reply with only the complete Python source text of the duration module.`, executor: { kind: 'model' }, dependsOn: [0], timeoutMs: 120000, maxRetries: 0 },
  { role: 'Tester', objective: `Produce a Python unittest module for ${SPEC} It must import: from duration import parse_duration. Cover valid inputs and ValueError cases. Reply with only the complete Python source text.`, executor: { kind: 'model' }, dependsOn: [0], timeoutMs: 120000, maxRetries: 0 },
  { role: 'Reviewer', objective: 'Review the Worker implementation and the Tester tests against the specification. Reply with APPROVE or REJECT on the first line, then at most five short lines of concrete issues.', executor: { kind: 'model' }, dependsOn: [1, 2], timeoutMs: 120000, maxRetries: 0 },
];
const HIDDEN = `import unittest
from duration import parse_duration
class Hidden(unittest.TestCase):
    def test_valid(self):
        for text, want in [('1h30m', 5400), ('45s', 45), ('2h5s', 7205), ('10m', 600), ('1h1m1s', 3661), ('0s', 0), ('100h', 360000)]:
            self.assertEqual(parse_duration(text), want, text)
    def test_invalid(self):
        for text in ['', 'abc', '5x', '30m1h', '1h1h', 'h', '1 h', '1h 30m', '-5s', '1.5h']:
            with self.assertRaises(ValueError, msg=text):
                parse_duration(text)
`;
const AST_GATE = `import ast, sys
ALLOWED = {'re', 'unittest', 'typing', 'duration'}
BANNED = {'open', 'exec', 'eval', 'compile', 'input', 'breakpoint', 'globals', 'locals', 'vars', 'getattr', 'setattr', 'delattr', 'memoryview'}
for path in sys.argv[1:]:
    tree = ast.parse(open(path, encoding='utf-8').read())
    for n in ast.walk(tree):
        if isinstance(n, ast.Import) and any(a.name.split('.')[0] not in ALLOWED for a in n.names): sys.exit('import refused')
        if isinstance(n, ast.ImportFrom) and (n.level or (n.module or '').split('.')[0] not in ALLOWED): sys.exit('import refused')
        if isinstance(n, ast.Name) and (n.id in BANNED or (n.id.startswith('__') and n.id != '__name__')): sys.exit('name refused: ' + n.id)
        if isinstance(n, ast.Attribute) and n.attr.startswith('__'): sys.exit('attribute refused')
print('AST_OK')
`;
const RUNNER = `import sys, unittest
suite = unittest.defaultTestLoader.discover(sys.argv[1], pattern=sys.argv[2], top_level_dir=sys.argv[1])
r = unittest.TextTestRunner(stream=sys.stdout, verbosity=0).run(suite)
print('RESULT', r.testsRun, len(r.failures), len(r.errors))
sys.exit(0 if r.wasSuccessful() and r.testsRun > 0 else 1)
`;
/** Pre-registered extraction contract; see header. */
export function extractSource(reply) {
  const blocks = [...reply.matchAll(/```[a-zA-Z0-9_-]*\r?\n([\s\S]*?)```/g)];
  if (blocks.length > 1) return null;
  const source = (blocks.length ? blocks[0][1] : reply).trim();
  return source ? source + '\n' : null;
}

async function python(dir, args) {
  const interpreter = resolveInterpreter('python', dir); assert.ok(interpreter, 'Python interpreter not found outside the trial folder.');
  const env = { SystemRoot: process.env.SystemRoot, PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0' };
  const r = await runWindowsOwnedProcess(interpreter, ['-I', '-S', ...args], { cwd: dir, signal: new AbortController().signal, timeoutMs: 20000, maxOutput: 20000, env, owner: { action: 'ma4-s1r.python-workflow' } });
  return { exitCode: r.exitCode, timedOut: r.timedOut, stdout: r.stdout.slice(-2000), stderr: r.stderr.slice(-2000) };
}

assert.ok(freemem() > 6 * 1024 ** 3, 'Insufficient free RAM for a 7B local model at a safe margin.');
const tag = (await api('/api/tags')).models.find(t => t.name === MODEL);
assert.ok(tag && !tag.remote_host && !tag.remote_model && tag.size < 5_000_000_000, 'Pinned model must be an installed local weight.');
const evidence = { version: VERSION, model: MODEL, modelDigest: tag.digest, trials: TRIALS, gate: '>=2 of 3 trials pass hidden and generated tests', hiddenTestsSha256: hash(HIDDEN), astGateSha256: hash(AST_GATE), runs: [], startedAt: new Date().toISOString() };
const temp = mkdtempSync(join(tmpdir(), 'bunny-s1r-py-'));
const db = new HostDatabase(':memory:');
const registry = new ModelCapabilityRegistry(db, { availableProviders: () => ['ollama'], ollamaProbe: async () => { const p = await probeOllama(); return { ...p, models: p.models.filter(m => m === MODEL) }; } });
const root = join(temp, 'project'); mkdirSync(root);
const manager = new TaskManager(db, root, [new OllamaAdapter()], { modelRegistry: registry, connections: { protector: new TestProtector(), fetch: async () => { throw new Error('External connection checks disabled.'); } } });
await manager.discover();
assert.equal(manager.ma4.configuration().enabled, false, 'External inference must remain disabled.');
const adapter = manager.adapters[0], launch = adapter.launch.bind(adapter);
adapter.launch = (task, hooks) => launch({ ...task, constraints: { ...task.constraints, contextTokens: 4096, outputTokens: 900 } }, hooks);
const missions = new MissionManager(manager, { dataDirectory: temp, adapters: [] });
missions.configure({ enabled: true, limits: { maxConcurrentAgents: 2, maxRetriesPerStep: 0, maxReplans: 0 } }, 'workstation');
const waitFor = async (fn, timeout) => { const end = Date.now() + timeout; while (!fn()) { assert.ok(Date.now() < end, 'Bounded wait expired.'); await new Promise(r => setTimeout(r, 50)); } };
try {
  for (let trial = 1; trial <= TRIALS; trial++) {
    const run = { trial, at: new Date().toISOString() };
    try {
      const m = missions.create({ objective: `Design, implement, check and review ${SPEC}`, mode: 'fast', localOnly: true, origin: 'workstation',
        modelSelection: { task: { provider: 'ollama', model: MODEL }, agents: {} }, steps: STEPS });
      missions.approve(m.id, 'workstation');
      await waitFor(() => ['completed', 'failed', 'waiting_for_user', 'stopped'].includes(missions.mission(m.id).state), 600000);
      const v = missions.view(missions.mission(m.id));
      const tasks = v.steps.map(s => s.taskId ? db.get(s.taskId) : null);
      run.mission = { state: v.state, steps: v.steps.map((s, i) => ({ role: s.role, state: s.state, startedAt: s.startedAt, finishedAt: s.finishedAt, model: s.accounting?.model ?? null, provider: s.accounting?.provider ?? null, failure: s.failure ? { category: s.failure.category, detail: String(s.failure.detail).slice(0, 400) } : null,
        outputTokens: tasks[i]?.usage?.outputTokens ?? null, outputSha256: tasks[i] ? hash(tasks[i].output) : null })),
        events: db.events(0).filter(e => e.missionId === m.id).map(e => e.type) };
      const [planner, worker, tester, reviewer] = v.steps;
      run.checks = {
        missionCompleted: v.state === 'completed',
        allPinned: v.steps.every(s => s.accounting?.model === MODEL && s.accounting?.provider === 'ollama'),
        dependenciesRespected: worker.startedAt >= planner.finishedAt && tester.startedAt >= planner.finishedAt && reviewer.startedAt >= Math.max(worker.finishedAt, tester.finishedAt),
        workerTesterOverlapped: worker.startedAt < tester.finishedAt && tester.startedAt < worker.finishedAt,
      };
      run.reviewerFirstLine = (tasks[3]?.output ?? '').trim().split('\n')[0].slice(0, 40);
      const dir = join(temp, `trial-${trial}`); mkdirSync(dir);
      const code = extractSource(tasks[1]?.output ?? ''), tests = extractSource(tasks[2]?.output ?? '');
      run.checks.extracted = !!code && !!tests;
      run.artifacts = { workerSource: code, testerSource: tests };
      if (run.checks.extracted) {
        writeFileSync(join(dir, 'duration.py'), code); writeFileSync(join(dir, 'test_model_duration.py'), tests);
        writeFileSync(join(dir, 'test_hidden_duration.py'), HIDDEN); writeFileSync(join(dir, 'ast_gate.py'), AST_GATE); writeFileSync(join(dir, 'runner.py'), RUNNER);
        run.astGate = await python(dir, ['ast_gate.py', 'duration.py', 'test_model_duration.py']);
        run.checks.astGate = run.astGate.exitCode === 0 && run.astGate.stdout.includes('AST_OK');
        if (run.checks.astGate) {
          run.hidden = await python(dir, ['runner.py', dir, 'test_hidden_*.py']);
          run.generated = await python(dir, ['runner.py', dir, 'test_model_*.py']);
          run.checks.hiddenTestsPass = run.hidden.exitCode === 0;
          run.checks.generatedTestsPass = run.generated.exitCode === 0;
        }
      }
    } catch (e) { run.error = String(e?.message ?? e).replaceAll(temp, '<temp>'); }
    const c = run.checks ?? {};
    run.pass = !!(c.missionCompleted && c.allPinned && c.dependenciesRespected && c.extracted && c.astGate && c.hiddenTestsPass && c.generatedTestsPass);
    for (const k of ['astGate', 'hidden', 'generated']) if (run[k]) for (const f of ['stdout', 'stderr']) run[k][f] = run[k][f].replaceAll(temp, '<temp>');
    evidence.runs.push(run); save(evidence);
    console.log(`trial ${trial}: ${run.pass ? 'PASS' : 'FAIL'} ${JSON.stringify(run.checks ?? run.error)}`);
  }
} finally {
  await missions.close();
  await Promise.all([...manager.sessions.keys()].map(id => manager.stop(id, 'Qualification cleanup')));
  evidence.sessionsRemaining = manager.sessions.size;
  manager.dispose(); db.close();
  if (resolve(temp).startsWith(resolve(tmpdir()) + '\\')) rmSync(temp, { recursive: true, force: true });
  await api('/api/generate', { model: MODEL, keep_alive: 0 }).catch(() => {});
  evidence.finishedAt = new Date().toISOString(); evidence.generationRequests = generations; evidence.networkDenied = denied; evidence.externalInference = false;
  evidence.passed = evidence.runs.filter(r => r.pass).length; evidence.g7 = evidence.passed >= 2 ? 'PASS' : 'FAIL';
  save(evidence); globalThis.fetch = originalFetch;
  console.log(`G7 v2: ${evidence.passed}/${TRIALS} -> ${evidence.g7}`);
}
