# Reproducible local routing benchmarks

Base: `f5d3f90`. Test set `bunny-ma4-s1r-local-v3`; prompt-set SHA-256 `381416f2354c2c859ffb80d1749d0ab6a03a5f453273071899ae169f73e416f2`. Reproduce the full method: `npm run test:ma4:local`. The evidence assembly retains 32 unchanged v2 cases and replaces four answer-contaminated planning cases with independently frozen v3 trials, run by `node --experimental-strip-types scripts/ma4-s1r/planning.mjs`. Raw and excluded outputs remain reviewable. Frozen source/validators: `scripts/ma4-s1r/fixtures.mjs`. Runtime: Ollama 0.40.6, llama.cpp runner, CPU plus partial NVIDIA offload. Exact weight digests are in `evidence/inventory.json`.

Nine distinct synthetic tasks cover reasoning, debugging/source generation, arithmetic, JSON generation, function-call shape, dependency planning, extraction/summarization, instruction following and a multistep data transformation. There is one sample per task/model/arm, 36 total scored generations. This is a small functional qualification set, not a statistically representative benchmark.

The trusted in-process benchmark harness uses native Ollama JSON mode for JSON fixtures. This does not add a string-format option to the public Host API, whose declared contract remains an object schema. The separate live structured-output scenario uses that object-schema contract and independently checks its result. Exact synthetic request prompts/formats are archived in `evidence/fixture-sets.json`, with the v2 archive hash verified against the original receipt.

| Model / arm | Samples | Correct | Success rate | Median wall latency ms | Median generation tok/s | Failures / timeouts |
|---|---:|---:|---:|---:|---:|---|
| huihui_ai/qwen2.5-abliterate:7b | 9 | 7 | 77.78% | 752.00 | 32.67 | 0 transport failures; 0 timeouts |
| qwen2.5-coder:7b | 9 | 5 | 55.56% | 751.00 | 32.45 | 0 transport failures; 0 timeouts |
| Automatic (paired cold-load) | 9 | 4 | 44.44% | 6608.00 | UNKNOWN | 0 transport failures; 0 timeouts |
| Fixed coder (paired cold-load) | 9 | 6 | 66.67% | 5990.00 | UNKNOWN | 0 transport failures; 0 timeouts |

Correctness uses exact outputs, anchored source syntax or independently parsed JSON field checks; source is not executed. Self-reported confidence is not measured or used. Incorrect arithmetic, extra punctuation/spacing under exact-format instructions, wrong function schemas and wrong multistep outputs remain failures. Correctness failures are separate from transport failures. Case-level outputs (synthetic only), hashes, counts and receipts allow review. No answer/score is fed back into routing ranks, and no reference answer was edited to accommodate candidate responses.

The automatic and fixed-coder arms receive identical task prompts and hard context/output/privacy/resource limits. Both use the real TaskManager, and both unload after each request for comparable cold-load conditions. The direct per-model arm uses a mostly warm sequence, with cold initial loads and a later cold planning replacement. Its latencies should not be compared directly with the paired cold-load arms. Case order is fixed, not randomized; sampling defaults are Ollama/model defaults, so nondeterminism remains. The four replacement planning trials ran alongside regression activity; the initial suite also includes ordinary machine activity and device enumeration. Latencies are descriptive observations, not controlled quality/speed comparisons. P95 is NOT ESTABLISHED: nine heterogeneous samples per arm are too few for a reliable tail estimate. Per-category success is a single Bernoulli outcome.

Automatic selects only among the two explicitly resource-eligible models. It is not tested with the oversized weights or cloud candidates. The paired automatic score is 4/9 versus fixed 6/9. **No automatic-routing superiority is established.** More held-out tasks, repeated samples and balanced/counterbalanced execution order are needed before quality or latency improvement claims.

Peak observed system memory during the instrumented suite: 20.88 / 31.61 GiB; minimum observed free RAM 10.74 GiB. These are whole-system observations, not model-attributed allocation or continuous peak guarantees. Hardware-controlled device comparisons are documented separately.
