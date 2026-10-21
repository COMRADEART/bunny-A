import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir, freemem, totalmem, cpus, platform, release } from 'node:os';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { execute, probeOllama, stopTask } from '../../src/lib/orch/exec.server.ts';
import { OllamaAdapter } from '../../src/lib/bunny-host/adapters.server.ts';
import { HostDatabase } from '../../src/lib/bunny-host/persistence.server.ts';
import { TaskManager } from '../../src/lib/bunny-host/manager.server.ts';
import { ModelCapabilityRegistry } from '../../src/lib/bunny-host/model-capability.server.ts';
import { MissionManager } from '../../src/lib/bunny-missions/manager.server.ts';
import { TestProtector } from '../../src/lib/bunny-host/jev-secrets.server.ts';
import { fixtures, version } from './fixtures.mjs';

// No credentials, external inference, downloads, arbitrary endpoints or generated-code execution.
const originalFetch = globalThis.fetch;
let deniedNetwork = 0, generationRequests = 0;
globalThis.fetch = async (input, init) => {
  const url = new URL(String(input));
  if (url.origin !== 'http://127.0.0.1:11434' || !['/api/tags', '/api/version', '/api/show', '/api/ps', '/api/generate', '/api/chat'].includes(url.pathname)) {
    deniedNetwork++; throw new Error('Qualification network allowlist refused the request.');
  }
  if (['/api/generate', '/api/chat'].includes(url.pathname)) {
    const body = JSON.parse(String(init?.body));
    assert.ok(allowed.includes(body.model), 'Only preflight-verified local small models may execute.');
    generationRequests++;
  }
  return originalFetch(input, init);
};
const out = resolve('docs/ma4-s1r/evidence'); mkdirSync(out, { recursive: true });
const agentsOnly = process.argv.includes('--agents-only');
const hash = value => createHash('sha256').update(value).digest('hex');
const save = (name, value) => writeFileSync(join(out, name + '.json'), JSON.stringify(value, null, 2) + '\n');
const api = async (path, body) => {
  const r = await fetch('http://127.0.0.1:11434' + path, { signal: AbortSignal.timeout(60000), ...(body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}) });
  assert.ok(r.ok, 'Local runtime HTTP status ' + r.status); return r.json();
};
const allowed = ['qwen2.5-coder:7b', 'huihui_ai/qwen2.5-abliterate:7b'];
const tags = (await api('/api/tags')).models;
for (const model of allowed) {
  const tag = tags.find(t => t.name === model);
  assert.ok(tag && !tag.remote_host && !tag.remote_model && !/cloud/i.test(model) && tag.size < 5_000_000_000);
}
assert.ok(freemem() > 7 * 1024 ** 3, 'Insufficient free RAM; no model loading authorized at this margin.');
const initialPs = await api('/api/ps');
assert.equal(initialPs.models.length, 0, 'Do not displace another runtime user.');
const inventory = [];
for (const tag of tags) {
  const remote = !!(tag.remote_host || tag.remote_model || /cloud/i.test(tag.name));
  const show = remote ? null : await api('/api/show', { model: tag.name });
  const architecture = show?.model_info?.['general.architecture'];
  inventory.push({ model: tag.name, digest: tag.digest, sizeBytes: tag.size, remote,
    capabilities: show?.capabilities ?? tag.capabilities, contextTokens: show?.model_info?.[architecture + '.context_length'] ?? tag.details?.context_length ?? null,
    parameters: tag.details?.parameter_size, quantization: tag.details?.quantization_level,
    tested: allowed.includes(tag.name), exclusion: remote ? 'External inference not authorized' : allowed.includes(tag.name) ? null : 'Weight size exceeds safe current memory margin' });
}
save('inventory', { at: new Date().toISOString(), runtime: await api('/api/version'), inventory });

const hardware = { at: new Date().toISOString(), platform: platform(), release: release(), node: process.version,
  cpu: cpus()[0]?.model, logicalProcessors: cpus().length, totalBytes: totalmem(), initialFreeBytes: freemem(), initialPs, samples: [] };
let sampling = false;
async function sample() {
  if (sampling) return; sampling = true;
  try {
    let gpu = null;
    try { gpu = execFileSync('nvidia-smi', ['--query-gpu=memory.used,utilization.gpu', '--format=csv,noheader,nounits'], { timeout: 2500, windowsHide: true, encoding: 'utf8' }).trim(); } catch { /* Unknown, not zero. */ }
    hardware.samples.push({ at: Date.now(), freeBytes: freemem(), nodeRss: process.memoryUsage().rss, gpu, ps: await api('/api/ps') });
  } finally { sampling = false; }
}
const timer = setInterval(() => { void sample().catch(() => {}); }, 1500);
const scenarios = [], bench = [], missionsEvidence = [];
const scenario = async (name, fn) => {
  const at = Date.now();
  try { const evidence = await fn(); scenarios.push({ name, status: 'PASS', at, durationMs: Date.now() - at, ...evidence }); }
  catch (e) { scenarios.push({ name, status: 'FAIL', at, durationMs: Date.now() - at, error: String(e.message).replaceAll(process.cwd(), '<workspace>') }); }
  save(agentsOnly ? 'agent-live' : 'live', { version, scenarios }); console.log(name + ': ' + scenarios.at(-1).status);
};
let serial = 0;
async function generate(model, prompt, extra = {}) {
  const chunks = [], start = Date.now();
  const result = await execute({ taskId: 's1r-' + (++serial), provider: 'ollama', model, prompt, localOnly: true, numCtx: 2048, numPredict: 160, ...extra }, { stream: text => chunks.push({ at: Date.now(), text }), timeoutMs: 45000 });
  return { result, chunks, latencyMs: Date.now() - start };
}
const receipt = run => ({ ok: run.result.ok, servedModel: run.result.receipt?.model ?? null, latencyMs: run.latencyMs,
  outputHash: hash(run.result.output ?? ''), syntheticOutput: (run.result.output ?? '').slice(0, 1200), chunkCount: run.chunks.length, receipt: run.result.receipt ?? null, error: run.result.error ?? null });
async function unload(model) { await api('/api/generate', { model, keep_alive: 0 }); }
let manager, db, missions, temp;
try {
  if (!agentsOnly) {
  await scenario('basic-streaming-pin', async () => {
    const run = await generate(allowed[0], 'Reply with exactly READY');
    assert.equal(run.result.ok, true); assert.equal(run.result.output.trim(), 'READY');
    assert.equal(run.result.receipt.model, allowed[0]); assert.ok(run.chunks.length > 0);
    assert.equal(run.chunks.map(c => c.text).join(''), run.result.output);
    assert.ok(run.chunks.every((c, i) => !i || c.at >= run.chunks[i - 1].at));
    return receipt(run);
  });
  await scenario('invalid-pin', async () => {
    const run = await generate('bunny-qualification-nonexistent:missing', 'Synthetic');
    assert.equal(run.result.ok, false); assert.match(run.result.error, /no longer available/); return receipt(run);
  });
  await scenario('structured-output', async () => {
    const run = await generate(allowed[0], 'Return only JSON {"ok":true,"count":3}.', { format: { type: 'object', properties: { ok: { const: true }, count: { const: 3 } }, required: ['ok', 'count'], additionalProperties: false } });
    assert.equal(run.result.ok, true); assert.deepEqual(JSON.parse(run.result.output), { ok: true, count: 3 }); return receipt(run);
  });
  await scenario('cancellation', async () => {
    const controller = new AbortController(); let cancelledAt;
    const promise = execute({ taskId: 's1r-cancel', provider: 'ollama', model: allowed[0], prompt: 'List integers from 1 to 10000, one per line.', localOnly: true, numCtx: 2048, numPredict: 256 },
      { signal: controller.signal, timeoutMs: 30000, stream: () => { if (!cancelledAt) { cancelledAt = Date.now(); controller.abort(); } } });
    const result = await promise; const boundMs = Date.now() - cancelledAt;
    assert.ok(cancelledAt); assert.equal(result.stopped, true); assert.ok(boundMs < 3000);
    assert.deepEqual(await stopTask('s1r-cancel'), { stopped: false }); return { boundMs, controllerReleased: true };
  });
  await scenario('model-timeout', async () => {
    const start = Date.now();
    const r = await execute({ taskId: 's1r-timeout', provider: 'ollama', model: allowed[0], prompt: 'List all integers from 1 to 10000.', numPredict: 256, numCtx: 2048, localOnly: true }, { stream: () => {}, timeoutMs: 10 });
    assert.equal(r.ok, false); assert.match(r.error, /did not finish/); assert.ok(Date.now() - start < 3000);
    assert.deepEqual(await stopTask('s1r-timeout'), { stopped: false }); return { boundMs: Date.now() - start };
  });
  await scenario('native-tool-proposal-harness-only', async () => {
    const start = Date.now();
    const r = await api('/api/chat', { model: allowed[0], stream: false, keep_alive: 0, options: { num_ctx: 2048, num_predict: 128, temperature: 0 },
      messages: [{ role: 'user', content: 'Use the calculator to add 2 and 3. Do not guess the answer.' }],
      tools: [{ type: 'function', function: { name: 'calculator', description: 'Add two integers', parameters: { type: 'object', properties: { a: { type: 'integer' }, b: { type: 'integer' } }, required: ['a', 'b'] } } }] });
    assert.equal(r.model, allowed[0]); const calls = r.message?.tool_calls;
    assert.equal(calls?.length, 1); assert.equal(calls[0].function.name, 'calculator');
    assert.deepEqual(calls[0].function.arguments, { a: 2, b: 3 });
    const toolResult = calls[0].function.arguments.a + calls[0].function.arguments.b;
    assert.equal(toolResult, 5); return { model: r.model, durationMs: Date.now() - start, permittedTool: 'pure integer addition', toolResult, productToolExecution: 'UNSUPPORTED (text-only adapter)' };
  });
  for (const model of allowed) {
    for (const fixture of fixtures) {
      assert.ok(freemem() > 3 * 1024 ** 3, 'Memory margin exhausted; stop qualification.');
      const run = await generate(model, fixture.prompt, { ...(fixture.format ? { format: fixture.format } : {}) });
      bench.push({ arm: 'model', model, caseId: fixture.id, correct: run.result.ok && fixture.valid(run.result.output), ...receipt(run) });
      save('benchmarks', { version, fixtureHash: hash(JSON.stringify(fixtures.map(({ id, prompt, format }) => ({ id, prompt, format })))), samples: bench });
      console.log('benchmark ' + model + ' ' + fixture.id + ': ' + bench.at(-1).correct);
    }
    await unload(model);
  }
  }
  temp = mkdtempSync(join(tmpdir(), 'bunny-s1r-')); const root = join(temp, 'project'); mkdirSync(root);
  db = new HostDatabase(':memory:');
  // Real probes, narrowed explicitly to the two resource-eligible models for this experiment.
  const registry = new ModelCapabilityRegistry(db, { availableProviders: () => ['ollama'], ollamaProbe: async () => {
    const p = await probeOllama(); return { ...p, models: p.models.filter(m => allowed.includes(m)), remote: p.remote };
  } });
  manager = new TaskManager(db, root, [new OllamaAdapter()], { modelRegistry: registry, connections: { protector: new TestProtector(), fetch: async () => { throw new Error('External connection checks disabled.'); } } });
  await manager.discover();
  assert.equal(manager.ma4.configuration().enabled, false);
  async function waitFor(fn, timeout = 60000) {
    const end = Date.now() + timeout;
    while (!fn()) { assert.ok(Date.now() < end, 'Bounded Host wait expired.'); await new Promise(r => setTimeout(r, 25)); }
  }
  async function hostTask(prompt, constraints = {}, modelOverride = null) {
    const t = manager.submit({ prompt, mode: 'fast', override: 'auto', modelOverride,
      executionScope: { access: 'read' }, constraints: { localOnly: true, providerAllowlist: ['ollama'], modelAllowlist: allowed, contextTokens: 2048, outputTokens: 160, maxRuntimeMs: 45000, ...constraints } });
    manager.approve(t.id); await waitFor(() => ['completed', 'failed', 'stopped'].includes(db.get(t.id).state)); return db.get(t.id);
  }
  if (!agentsOnly) {
  await scenario('automatic-routing-host', async () => {
    const t = await hostTask('Reply only LOCAL_OK'); assert.equal(t.state, 'completed', t.error); assert.ok(allowed.includes(t.model));
    assert.equal(t.output.trim(), 'LOCAL_OK'); return { state: t.state, selectedModel: t.model, provider: t.provider };
  });
  await scenario('sensitive-host-and-pin', async () => {
    const t = await hostTask('Synthetic patient fixture. Reply only LOCAL_SAFE. Do not request external providers.', { sensitive: true, privacyLocal: true }, allowed[0]);
    assert.equal(t.state, 'completed', t.error); assert.equal(t.model, allowed[0]); assert.equal(t.provider, 'ollama'); return { model: t.model, state: t.state };
  });
  await scenario('unapproved-external-before-network', async () => {
    const before = deniedNetwork;
    assert.throws(() => manager.submit({ prompt: 'Synthetic', mode: 'fast', override: 'openrouter', modelOverride: 'unapproved:free' }));
    assert.throws(() => manager.submit({ prompt: 'Synthetic', mode: 'fast', override: 'ollama', modelOverride: 'deepseek-v4.1-flash:cloud', constraints: { localOnly: true } }));
    assert.equal(deniedNetwork, before); return { deniedAtHostBeforeFetch: true };
  });
  for (const fixture of fixtures) {
    for (const arm of ['auto', 'fixed']) {
      const start = Date.now(); const t = await hostTask(fixture.prompt, fixture.format ? { responseFormat: fixture.format } : {}, arm === 'fixed' ? allowed[0] : null);
      bench.push({ arm, model: t.model, caseId: fixture.id, correct: t.state === 'completed' && fixture.valid(t.output), ok: t.state === 'completed', latencyMs: Date.now() - start,
        outputHash: hash(t.output), syntheticOutput: t.output.slice(0, 1200), inputTokens: t.usage?.inputTokens ?? null, outputTokens: t.usage?.outputTokens ?? null });
      save('benchmarks', { version, samples: bench });
      console.log('benchmark ' + arm + ' ' + fixture.id + ': ' + bench.at(-1).correct);
      await unload(t.model); // Controlled, identical cold-load condition in both paired arms.
    }
  }
  }
  missions = new MissionManager(manager, { dataDirectory: temp, adapters: [] });
  missions.configure({ enabled: true, limits: { maxConcurrentAgents: 1, maxRetriesPerStep: 0, maxReplans: 0 } }, 'workstation');
  // A strict wrapper bounds output/context without changing routing, pins, tools or the production scheduler.
  const adapter = manager.adapters[0], launch = adapter.launch.bind(adapter);
  adapter.launch = (task, hooks) => launch({ ...task, maxRuntimeMs: 45000, constraints: { ...task.constraints, contextTokens: 2048, outputTokens: 200 } }, hooks);
  const recordMission = m => {
    const v = missions.view(missions.mission(m.id));
    const record = { state: v.state, steps: v.steps.map(s => ({ role: s.role, state: s.state, startedAt: s.startedAt, finishedAt: s.finishedAt, modelConstraint: s.modelConstraint, accounting: s.accounting, dependsOn: s.dependsOn.length })),
      events: db.events(0).filter(e => e.missionId === m.id).map(e => ({ at: e.at, type: e.type })) };
    missionsEvidence.push(record); save('agents', { invocations: missionsEvidence, generatedCodeExecuted: false, capabilityAdapters: [] }); return v;
  };
  await scenario('planner-worker-reviewer', async () => {
    const m = missions.create({ objective: 'Solve and independently check a small arithmetic data pipeline using read-only text agents.', mode: 'fast', localOnly: true, origin: 'workstation',
      modelSelection: { task: { provider: 'ollama', model: allowed[0] }, agents: {} }, steps: [
        { role: 'Planner', objective: 'For input [9,1,5], propose the order: sort ascending, then sum. Reply exactly sort,sum.', executor: { kind: 'model' }, timeoutMs: 45000, maxRetries: 0 },
        { role: 'Worker', objective: 'Compute the ascending sorted array and sum for [9,1,5] following the planner. Reply only one JSON object with properties sorted (array) and sum (integer).', executor: { kind: 'model' }, dependsOn: [0], timeoutMs: 45000, maxRetries: 0 },
        { role: 'Reviewer', objective: 'Independently compute the sorted array and sum for [9,1,5], compare with the worker, and reply only VERIFIED if correct or REJECTED if wrong.', executor: { kind: 'model' }, dependsOn: [1], timeoutMs: 45000, maxRetries: 0 },
      ] });
    missions.approve(m.id, 'workstation');
    await waitFor(() => ['completed', 'failed', 'waiting_for_user'].includes(missions.mission(m.id).state), 180000);
    const v = recordMission(m); assert.equal(v.state, 'completed');
    const tasks = v.steps.map(s => db.get(s.taskId));
    assert.equal(tasks[0].output.trim(), 'sort,sum'); assert.deepEqual(JSON.parse(tasks[1].output), { sorted: [1,5,9], sum: 15 }); assert.equal(tasks[2].output.trim(), 'VERIFIED');
    assert.ok(v.steps.every(s => s.accounting.model === allowed[0]));
    assert.ok(v.steps.slice(1).every((s, i) => s.startedAt >= v.steps[i].finishedAt));
    return { agents: 3, distinctModels: 1, dependencyChecks: 2, objectiveChecks: 3, scheduler: 'MA3 MissionManager', tools: 'No capability adapters installed' };
  });
  await scenario('controlled-agent-failure', async () => {
    const requestsBefore = generationRequests;
    const m = missions.create({ objective: 'Controlled missing-pin refusal.', mode: 'fast', localOnly: true, origin: 'workstation', modelSelection: { task: { provider: 'ollama', model: 'missing:qualification' }, agents: {} },
      steps: [{ role: 'Worker', objective: 'Reply only unreachable', executor: { kind: 'model' }, maxRetries: 0 }] });
    missions.approve(m.id, 'workstation'); await waitFor(() => ['failed', 'waiting_for_user'].includes(missions.mission(m.id).state));
    const v = recordMission(m); assert.ok(['failed', 'waiting_for_user'].includes(v.state)); assert.equal(v.steps[0].accounting.provider, null);
    assert.equal(generationRequests, requestsBefore, 'Missing exact pin must fail before generation.');
    await missions.stop(m.id, 'workstation'); return { state: v.state, substitutedCalls: 0 };
  });
  await scenario('mission-cancellation-resource-release', async () => {
    const m = missions.create({ objective: 'Cancellation fixture.', mode: 'fast', localOnly: true, origin: 'workstation', modelSelection: { task: { provider: 'ollama', model: allowed[0] }, agents: {} },
      steps: [{ role: 'Worker', objective: 'List integers from 1 to 10000.', executor: { kind: 'model' }, timeoutMs: 45000, maxRetries: 0 }] });
    missions.approve(m.id, 'workstation'); await waitFor(() => db.events(0).some(e => e.missionId === m.id && e.type === 'agent.output')); const start = Date.now();
    await missions.stop(m.id, 'workstation'); await waitFor(() => manager.sessions.size === 0, 5000); recordMission(m);
    assert.ok(Date.now() - start < 5000); return { boundMs: Date.now() - start, sessionsRemaining: manager.sessions.size };
  });
} finally {
  clearInterval(timer);
  if (missions) await missions.close();
  if (manager) { await Promise.all([...manager.sessions.keys()].map(id => manager.stop(id, 'Qualification cleanup'))); manager.dispose(); }
  db?.close();
  if (temp && resolve(temp).startsWith(resolve(tmpdir()) + '\\')) rmSync(temp, { recursive: true, force: true });
  for (const model of allowed) await unload(model).catch(() => {});
  hardware.finalPs = await api('/api/ps'); hardware.finalFreeBytes = freemem(); save(agentsOnly ? 'agent-hardware' : 'hardware', hardware);
  save(agentsOnly ? 'agent-live' : 'live', { version, externalInference: false, networkDeniedAttempts: deniedNetwork, scenarios });
  if (!agentsOnly) save('benchmarks', { version, fixtureHash: hash(JSON.stringify(fixtures.map(({ id, prompt, format }) => ({ id, prompt, format })))), samples: bench });
  globalThis.fetch = originalFetch;
}
if (scenarios.some(s => s.status !== 'PASS')) process.exitCode = 1;
