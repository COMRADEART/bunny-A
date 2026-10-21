# Live local inference results

Base: `f5d3f90`. Suite: `bunny-ma4-s1r-local-v2`. Reproduce on the same installed models with `npm run test:ma4:local`. This opt-in command runs real local inference, requires an idle Ollama service and safe initial free RAM, and rejects every inference model outside the two preflight-verified local 7B tags. External inference remains OFF. Requests use 2,048 context tokens, 160 output tokens (200 for mission steps), and 45-second deadlines unless a deliberately shorter timeout/cancellation test is stated. The runner exits nonzero when any scenario fails; failure is retained.

| Scenario | Result | Evidence |
|---|---|---|
| basic-streaming-pin | PASS | 5015 ms; qwen2.5-coder:7b |
| invalid-pin | PASS | 53 ms; Model bunny-qualification-nonexistent:missing is no longer available. Route the task again. |
| structured-output | PASS | 506 ms; qwen2.5-coder:7b |
| cancellation | PASS | 207 ms; measured stop/timeout bound 4 ms |
| model-timeout | PASS | 67 ms; measured stop/timeout bound 66 ms |
| native-tool-proposal-harness-only | FAIL | 984 ms; Expected values to be strictly equal:  undefined !== 1  |
| automatic-routing-host | PASS | 5639 ms; huihui_ai/qwen2.5-abliterate:7b |
| sensitive-host-and-pin | PASS | 5934 ms; qwen2.5-coder:7b |
| unapproved-external-before-network | PASS | 4 ms; see receipt |
| planner-worker-reviewer | FAIL | 8564 ms; Unexpected token '`', "```json { "... is not valid JSON |
| controlled-agent-failure | PASS | 49 ms; see receipt |
| mission-cancellation-resource-release | PASS | 1220 ms; measured stop/timeout bound 8 ms |

Basic response, automatic Host selection and exact pin receipts come from real Ollama execution through the existing TaskManager/adapter. The invalid pin is refused without generation or substitution. Ordered stream chunks reconstruct the response exactly. Explicit JSON-schema generation is independently checked against the expected object; arbitrary JSON-schema compliance is not inferred from valid syntax alone.

Cancellation waits for a real token, aborts the request and confirms the task controller is absent. Mission cancellation also waits for actual output and checks sessions return to zero. Final model unload is an explicit cleanup operation; a warm model cache would not itself mean an orphan request. Hardware traces finish with an empty `/api/ps` list.

Provider-unavailable handling is verified with offline mocks in the established execution suite; the installed user's runtime is never stopped to simulate an outage. The 10-ms timeout trial includes additional bounded discovery overhead. Native tool calling is an independently attempted runtime feature; product tool execution is UNSUPPORTED by this text-only adapter. Tool JSON-shape benchmark scores do not mean tools executed.

Only synthetic prompts were sent locally. The sensitive synthetic fixture stayed pinned locally. Unauthorized cloud requests were refused by Host policy before the qualification fetch guard saw any transmission attempt. No real external model was invoked.

Sanitized evidence: `live.json`, `qualification.log`, `benchmarks.json`, `agents.json` under `evidence/`. Exploratory v1 evidence is retained under `attempt-v1/` and excluded from release scoring: its reasoning prompt leaked the expected answer, its paired run used a generic routing prompt, and its failure-check assertion referenced a nonexistent accounting field. V2 corrected those harness defects before execution. A subsequent review also found answer leakage in the planning prompt: those four v2 samples are excluded, not scored as successes. A frozen v3 prompt removes the answer, leaves the validator unchanged and is tested in `planning-v3.json`; `qualified-benchmarks.json` assembles the 32 unchanged v2 samples and four replacement planning trials. V1's real agent-format failure led to the separately reproduced prompt fix. No failed output is relabelled PASS and no reference answer was changed after candidate outputs.
