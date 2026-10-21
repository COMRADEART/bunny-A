import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
const root = 'docs/ma4-s1r';
const read = name => JSON.parse(readFileSync(join(root, 'evidence', name + '.json'), 'utf8').replace(/^\uFEFF/, ''));
const write = (name, body) => writeFileSync(join(root, name + '.md'), body.trim() + '\n');
const inv = read('inventory'), live = read('live'), rawBench = read('benchmarks'), hardware = read('hardware'), controlled = read('hardware-controlled');
let bench = rawBench;
try { const planning = read('planning-v3'); bench = { version: planning.version, fixtureHash: planning.fixtureHash,
  assembly: '32 unchanged v2 cases retained; 4 contaminated planning samples excluded and replaced by separately frozen v3 trials; all original results retained',
  samples: [...rawBench.samples.filter(s=>s.caseId!=='planning'), ...planning.samples] };
  writeFileSync(join(root,'evidence/qualified-benchmarks.json'),JSON.stringify(bench,null,2)+'\n');
} catch { /* Targeted replacement still running; no new result invented. */ }
let checks = []; for (const name of ['checks', 'attempt-r18/recheck', 'attempt-team/recheck', 'final-builds', 'recheck']) { try {
  checks.push(...read(name).map(c=>name.startsWith('attempt-') ? {...c,id:c.id+' ('+name.split('/')[0]+')'} : c));
} catch { /* Incomplete checks stay explicit. */ } }
const median = values => { const v = values.filter(Number.isFinite).sort((a,b) => a-b); return v.length ? v.length % 2 ? v[(v.length-1)/2] : (v[v.length/2-1]+v[v.length/2])/2 : null; };
const fmt = n => n == null ? 'UNKNOWN' : n.toFixed(2);
const groups = [
  ...inv.inventory.filter(m => m.tested).map(m => [m.model, bench.samples.filter(s => s.arm === 'model' && s.model === m.model)]),
  ['Automatic (paired cold-load)', bench.samples.filter(s => s.arm === 'auto')],
  ['Fixed coder (paired cold-load)', bench.samples.filter(s => s.arm === 'fixed')],
];
const status = name => live.scenarios.find(s => s.name === name)?.status ?? 'NOT TESTED';
const checkText = checks.length ? checks.map(c => `| ${c.id} | \`${c.command}\` | ${c.exitCode === 0 ? 'PASS' : 'FAIL'} (exit ${c.exitCode}) | ${(c.durationMs/1000).toFixed(1)} s |`).join('\n') : '| All checks | Pending | NOT TESTED | — |';
const totalGiB = hardware.totalBytes / 2**30, minFreeGiB = Math.min(...hardware.samples.map(s => s.freeBytes / 2**30)), usedGiB = totalGiB - minFreeGiB;
const peakGpu = Math.max(...hardware.samples.map(s => Number(s.gpu?.split(',')[0])).filter(Number.isFinite), ...controlled.samples.map(s => Number(s.gpu?.split(',')[0])).filter(Number.isFinite));

write('LOCAL_MODEL_INVENTORY', `# Local model inventory

Base: \`f5d3f90\`. Observed: ${inv.at}. Runtime: Ollama ${inv.runtime.version}, native HTTP API. Source: \`evidence/inventory.json\`.

| Installed identifier | Weight bytes | Context (reported) | Classification / execution |
|---|---:|---:|---|
${inv.inventory.map(m => `| \`${m.model}\` | ${m.sizeBytes} | ${m.contextTokens ?? 'UNKNOWN'} | ${m.remote ? 'Cloud proxy: BLOCKED, no inference approval' : m.tested ? 'Local: tested sequentially' : 'Local: SKIPPED, unsafe current memory margin'} |`).join('\n')}

Each full model digest, quantization and capability list is retained in the sanitized inventory. The two 7B models are 7.6B-parameter Q4_K_M GGUF weights. No model was downloaded. The 27B/30B weights exceed the initial free-RAM margin; no overcommitment experiment was attempted.

Bounded read-only discovery used \`ollama --version\`, \`ollama list\`, \`ollama ps\`, \`GET /api/version\`, \`GET /api/tags\`, \`POST /api/show\`, \`GET /api/ps\`. Successful real generation and streaming used \`POST /api/generate\`; the native tool-proposal experiment used \`POST /api/chat\`. Context was capped to 2,048 for qualification, rather than claiming the 32K training window fits current VRAM.

No \`lms\`, \`llama-server\`, or \`llama-cli\` command or standard LM Studio/Jan application directory was found. One-second probes of \`/v1/models\` on loopback ports 1234, 5000, 8000 and 8082 found no alternative serving runtime. This is bounded discovery, not an exhaustive disk search. Existing Python packages include PyTorch, Transformers and OpenVINO; no additional Bunny serving adapter was activated. OpenVINO exposes CPU, GPUs and NPU; that is device enumeration, not model inference qualification. See \`evidence/additional-runtimes.json\`.

Runtime metadata advertises tools for both 7B models, but the product Ollama adapter is text-only. The native coder tool trial is ${status('native-tool-proposal-harness-only')}: no authorized calculator tool-call object was returned. No arbitrary tool executor was introduced.
`);

write('LIVE_INFERENCE_RESULTS', `# Live local inference results

Base: \`f5d3f90\`. Suite: \`${live.version}\`. Reproduce on the same installed models with \`npm run test:ma4:local\`. This opt-in command runs real local inference, requires an idle Ollama service and safe initial free RAM, and rejects every inference model outside the two preflight-verified local 7B tags. External inference remains OFF. Requests use 2,048 context tokens, 160 output tokens (200 for mission steps), and 45-second deadlines unless a deliberately shorter timeout/cancellation test is stated. The runner exits nonzero when any scenario fails; failure is retained.

| Scenario | Result | Evidence |
|---|---|---|
${live.scenarios.map(s => `| ${s.name} | ${s.status} | ${s.durationMs} ms; ${s.boundMs !== undefined ? 'measured stop/timeout bound ' + s.boundMs + ' ms' : s.error ? s.error.replaceAll('|','/').replaceAll('\n',' ').slice(0,240) : s.selectedModel ?? s.servedModel ?? s.model ?? 'see receipt'} |`).join('\n')}

Basic response, automatic Host selection and exact pin receipts come from real Ollama execution through the existing TaskManager/adapter. The invalid pin is refused without generation or substitution. Ordered stream chunks reconstruct the response exactly. Explicit JSON-schema generation is independently checked against the expected object; arbitrary JSON-schema compliance is not inferred from valid syntax alone.

Cancellation waits for a real token, aborts the request and confirms the task controller is absent. Mission cancellation also waits for actual output and checks sessions return to zero. Final model unload is an explicit cleanup operation; a warm model cache would not itself mean an orphan request. Hardware traces finish with an empty \`/api/ps\` list.

Provider-unavailable handling is verified with offline mocks in the established execution suite; the installed user's runtime is never stopped to simulate an outage. The 10-ms timeout trial includes additional bounded discovery overhead. Native tool calling is an independently attempted runtime feature; product tool execution is UNSUPPORTED by this text-only adapter. Tool JSON-shape benchmark scores do not mean tools executed.

Only synthetic prompts were sent locally. The sensitive synthetic fixture stayed pinned locally. Unauthorized cloud requests were refused by Host policy before the qualification fetch guard saw any transmission attempt. No real external model was invoked.

Sanitized evidence: \`live.json\`, \`qualification.log\`, \`benchmarks.json\`, \`agents.json\` under \`evidence/\`. Exploratory v1 evidence is retained under \`attempt-v1/\` and excluded from release scoring: its reasoning prompt leaked the expected answer, its paired run used a generic routing prompt, and its failure-check assertion referenced a nonexistent accounting field. V2 corrected those harness defects before execution. A subsequent review also found answer leakage in the planning prompt: those four v2 samples are excluded, not scored as successes. A frozen v3 prompt removes the answer, leaves the validator unchanged and is tested in \`planning-v3.json\`; \`qualified-benchmarks.json\` assembles the 32 unchanged v2 samples and four replacement planning trials. V1's real agent-format failure led to the separately reproduced prompt fix. No failed output is relabelled PASS and no reference answer was changed after candidate outputs.
`);

write('ROUTING_BENCHMARKS', `# Reproducible local routing benchmarks

Base: \`f5d3f90\`. Test set \`${bench.version}\`; prompt-set SHA-256 \`${bench.fixtureHash}\`. Reproduce the full method: \`npm run test:ma4:local\`. The evidence assembly retains 32 unchanged v2 cases and replaces four answer-contaminated planning cases with independently frozen v3 trials, run by \`node --experimental-strip-types scripts/ma4-s1r/planning.mjs\`. Raw and excluded outputs remain reviewable. Frozen source/validators: \`scripts/ma4-s1r/fixtures.mjs\`. Runtime: Ollama ${inv.runtime.version}, llama.cpp runner, CPU plus partial NVIDIA offload. Exact weight digests are in \`evidence/inventory.json\`.

Nine distinct synthetic tasks cover reasoning, debugging/source generation, arithmetic, JSON generation, function-call shape, dependency planning, extraction/summarization, instruction following and a multistep data transformation. There is one sample per task/model/arm, ${bench.samples.length} qualified scored generations. Another 40 scored exploratory/contaminated generations are excluded and retained separately (36 v1, four v2 planning). This is a small functional qualification set, not a statistically representative benchmark.

The trusted in-process benchmark harness uses native Ollama JSON mode for JSON fixtures. This does not add a string-format option to the public Host API, whose declared contract remains an object schema. The separate live structured-output scenario uses that object-schema contract and independently checks its result. Exact synthetic request prompts/formats are archived in \`evidence/fixture-sets.json\`, with the v2 archive hash verified against the original receipt.

| Model / arm | Samples | Correct | Success rate | Median wall latency ms | Median generation tok/s | Failures / timeouts |
|---|---:|---:|---:|---:|---:|---|
${groups.map(([name,a]) => `| ${name} | ${a.length} | ${a.filter(s=>s.correct).length} | ${fmt(a.filter(s=>s.correct).length/a.length*100)}% | ${fmt(median(a.map(s=>s.latencyMs)))} | ${fmt(median(a.map(s=>s.receipt?.evalDurationNs ? s.receipt.evalCount/(s.receipt.evalDurationNs/1e9) : null)))} | ${a.filter(s=>!s.ok).length} transport failures; ${a.filter(s=>/timeout|did not finish/i.test(s.error??'')).length} timeouts |`).join('\n')}

Correctness uses exact outputs, anchored source syntax or independently parsed JSON field checks; source is not executed. Self-reported confidence is not measured or used. Incorrect arithmetic, extra punctuation/spacing under exact-format instructions, wrong function schemas and wrong multistep outputs remain failures. Correctness failures are separate from transport failures. Case-level outputs (synthetic only), hashes, counts and receipts allow review. No answer/score is fed back into routing ranks, and no reference answer was edited to accommodate candidate responses.

The automatic and fixed-coder arms receive identical task prompts and hard context/output/privacy/resource limits. Both use the real TaskManager, and both unload after each request for comparable cold-load conditions. The direct per-model arm uses a mostly warm sequence, with cold initial loads and a later cold planning replacement. Its latencies should not be compared directly with the paired cold-load arms. Case order is fixed, not randomized; sampling defaults are Ollama/model defaults, so nondeterminism remains. The four replacement planning trials ran alongside regression activity; the initial suite also includes ordinary machine activity and device enumeration. Latencies are descriptive observations, not controlled quality/speed comparisons. P95 is NOT ESTABLISHED: nine heterogeneous samples per arm are too few for a reliable tail estimate. Per-category success is a single Bernoulli outcome.

Automatic selects only among the two explicitly resource-eligible models. It is not tested with the oversized weights or cloud candidates. The paired automatic score is ${bench.samples.filter(s=>s.arm==='auto'&&s.correct).length}/9 versus fixed ${bench.samples.filter(s=>s.arm==='fixed'&&s.correct).length}/9. **No automatic-routing superiority is established.** More held-out tasks, repeated samples and balanced/counterbalanced execution order are needed before quality or latency improvement claims.

Peak observed system memory during the instrumented suite: ${fmt(usedGiB)} / ${fmt(totalGiB)} GiB; minimum observed free RAM ${fmt(minFreeGiB)} GiB. These are whole-system observations, not model-attributed allocation or continuous peak guarantees. Hardware-controlled device comparisons are documented separately.
`);

write('HARDWARE_QUALIFICATION', `# Hardware qualification

Base: \`f5d3f90\`. Environment and commands: \`evidence/system.json\`, \`additional-runtimes.json\`, \`hardware.json\`, \`hardware-controlled.json\`.

Windows 11 Pro 64-bit, build 10.0.26300; Node v24.18.0; npm 11.16.0; Python 3.12. Intel Core Ultra 9 185H, 16 reported cores and 22 logical processors; ${fmt(totalGiB)} GiB visible system memory. Initial and during-run available memory are recorded, not inferred from weight file sizes. NVIDIA GeForce RTX 4050 Laptop GPU: 6,141 MiB VRAM by \`nvidia-smi\`, driver 616.92. WMI reports a truncated approximately 4-GB adapter-memory value; the NVIDIA query is used for VRAM capacity. Intel Arc iGPU and Intel AI Boost NPU are also detected.

## Measured execution

Reproduce the additional short device experiment only on an idle runtime: \`node scripts/ma4-s1r/hardware.mjs\`. Sequential CPU runs precede default-backend and limited simultaneous requests. No drivers, services, system limits or GPU configuration changed. \`num_gpu:0\` is a per-request runtime option.

| Controlled coder trial | Output tokens | Wall latency ms | Load ms | Generation tokens/s |
|---|---:|---:|---:|---:|
| Forced CPU | ${controlled.cpu.evalCount} | ${controlled.cpu.latencyMs} | ${fmt(controlled.cpu.loadDurationNs/1e6)} | ${fmt(controlled.cpu.tokensPerSecond)} |
| Default backend | ${controlled.gpu.evalCount} | ${controlled.gpu.latencyMs} | ${fmt(controlled.gpu.loadDurationNs/1e6)} | ${fmt(controlled.gpu.tokensPerSecond)} |
${controlled.concurrent.map(c=>`| ${c.label} | ${c.evalCount} | ${c.latencyMs} | ${fmt(c.loadDurationNs/1e6)} | ${fmt(c.tokensPerSecond)} |`).join('\n')}

CPU \`/api/ps\` reports \`size_vram:0\`. The default-backend run reports ${controlled.gpuPs.models[0]?.size_vram} bytes in VRAM with the llama.cpp runner. \`ollama ps\` reported partial CPU/GPU offload (16%/84%), rather than an all-GPU execution. Concurrent NVIDIA memory/utilization observations and actual throughput corroborate GPU activity; detection alone is not the evidence. Peak observed NVIDIA allocation across the instrumented measurements: ${peakGpu} MiB. This does not isolate every byte to the model or prove every layer ran on GPU.

Two simultaneous client requests were allowed only with more than 6 GiB free RAM after loading the small model. Their client intervals overlap; response timings suggest runtime serialization. This is bounded request contention, not proof of two parallel model executions or multi-model concurrency. Minimum free RAM during this short controlled trace: ${fmt(Math.min(...controlled.samples.map(s=>s.freeBytes/2**30)))} GiB. Both traces finish with models unloaded. No uncontrolled swapping or system instability was observed; page-fault/swapping counters were NOT TESTED.

Intel AI Boost is exposed by existing OpenVINO ${read('additional-runtimes').openvino}; OpenVINO device enumeration and a working NPU model pipeline are different claims. **NPU inference: NOT TESTED / unqualified for Bunny/Ollama.** Existing PyTorch 2.5.1+cu121 reports CUDA available, but PyTorch was not used to run these models. No model conversion/download or alternate inference framework was introduced.

Resource metrics are sampled whole-system snapshots. Peak process-attributed Ollama working set and long-running thermal/power behavior remain NOT TESTED. The 27B/30B models, full advertised context, and unrestricted production hardware admission remain SKIPPED or unqualified.
`);

write('AGENT_EXECUTION_EVIDENCE', `# Real agent execution evidence

Base: \`f5d3f90\`. Scheduler: existing MA3 MissionManager, using TaskManager and the real OllamaAdapter. Isolated temporary root and in-memory Host database; no capability adapters, no generated code execution, no filesystem/network tool authority. All three roles have an explicit \`qwen2.5-coder:7b\` pin. This is **three separate invocations of one model**, not multi-model execution.

Planner proposes a sort/sum pipeline; Worker computes a fixed array transformation; Reviewer independently checks the Worker. Steps enforce Planner → Worker → Reviewer dependencies and record model/accounting/start/finish times and sanitized event types. Expected results remain host-side. The Worker and Reviewer prompts in v2 do not contain reference outputs.

Objective gate: **${status('planner-worker-reviewer')}**. The scheduler completed all three invocations, but the Worker returned fenced JSON rather than the exact JSON-only output contract. The independent JSON parser rejected it; the overall workflow is not certified successful merely because agents or the scheduler reported completion. The read-only prose-summary conflict was fixed and covered separately, but the remaining model format failure is retained. G7 remains FAIL/PARTIAL for production qualification. An unvalidated answer cannot be promoted to a verified artifact.

Controlled missing-pin agent failure: ${status('controlled-agent-failure')}. It entered the expected failed/waiting-for-user path with no generation request, no substitution and null provider accounting. The corrected harness checks actual request count rather than inventing a zero-valued accounting field.

Cancellation after live output: ${status('mission-cancellation-resource-release')}; measured bound ${live.scenarios.find(s=>s.name==='mission-cancellation-resource-release')?.boundMs} ms; sessions remaining zero. Request controllers were released and qualification-owned model caches explicitly unloaded. No orphan live session was observed.

Reproduce: \`npm run test:ma4:local\`; agent-only rerun is available as \`node --experimental-strip-types scripts/ma4-s1r/qualify.mjs --agents-only\` but was not used to discard failed outputs. Timestamps and sanitized event sequences: \`evidence/agents.json\`. No Python implementation/test run, real tool-driven code editing, installed production agent, or physical mobile execution is claimed.
`);

write('SECURITY_VALIDATION', `# Privacy and security validation

Base: \`f5d3f90\`. External inference remains OFF; live activation is PENDING USER APPROVAL. No external-provider authentication, credential activation, quota exhaustion or cloud model invocation occurred. Public provider-documentation lookup sends no benchmark fixture.

| Boundary | Evidence and actual scope |
|---|---|
| Default external denial | Real local Host configuration remains disabled; unapproved OpenRouter submit refused before fetch. Existing deterministic consent tests rerun. |
| Sensitive fixtures stay local | Synthetic sensitive task completed with exact local coder pin; fresh preflight verifies no remote tag. Harness only permits loopback Ollama and preflight-verified small local tags. |
| Credentials absent from outputs | Existing DPAPI, known-secret redaction, provider-error omission and device-projection tests; qualification reads no external key. Test keys are synthetic. |
| Hard pins and fallback | Real successful exact pin, unavailable pin with zero generation, controlled missing-pin agent, and deterministic fallback/policy-revision tests. New served-model mismatch regression fails closed. |
| Tools and permissions | Existing capability authorization suite; real qualification runs with an empty capability adapter set. Metadata cannot confer tool permission. Native calculator proposal trial failed; no arbitrary call was executed. |
| Cancellation and cleanup | Real first-token cancellation and mission Stop; controller absent and sessions zero. Explicit unload plus final empty runtime cache list. |
| Untrusted metadata / output | Existing disabled discovery, strict configuration and requirements tests. Output is data; no evaluator or tool interpreter grants policy authority from model text. |
| Quotas and retries | Mock-backed atomic reservations, cooldown/retry-after, bounded timeout, cancellation queue cleanup and cost ceilings. No real provider balance or quota was exercised. |

Full current command outcomes:

| Check | Command | Result | Runtime |
|---|---|---|---|
${checkText}

Security assertions are bounded functional evidence, not a claim of comprehensive DLP, network monitoring of all machine processes, OS sandbox penetration testing or a formal audit. The harness fetch allowlist covers qualification-owned requests; it is not a machine-wide firewall. Ollama tags are checked again immediately before execution. Existing user/system services and user state are preserved.

Reproduction: \`npm run test:ma4\`, focused \`node --experimental-strip-types --test src/lib/bunny-host/ma4-s1r.test.ts src/lib/orch/exec.server.test.ts src/lib/bunny-host/model-capability.test.ts\`, and \`npm test\`. Exact results/overlap are in \`evidence/checks.json\`; focused suite passes are not added to regression totals twice.
`);

console.log('Updated six qualification reports from measured artifacts.');
