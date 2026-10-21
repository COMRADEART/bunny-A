# Bunny A MA4-S1R architecture audit

Audit date: 2026-10-20. Base: `f5d3f9027228504e45fba9f204638778bd6b649e` on `ma4-s1-model-intelligence`. Qualification branch: `ma4-s1r-live-qualification`.

## Repository and evidence — verified PASS

`git rev-parse HEAD`, `git cat-file -t f5d3f90`, `git status --short --branch`, `git worktree list`, `git remote -v`, and the S1 report/audit/checks/logs were inspected. This is the existing Bunny A repository; the origin URL redirects from `COMRADEART/router_agent` to `COMRADEART/bunny-A`. No substitute app was created. A dedicated worktree based exactly on S1 isolates qualification from 32 modified MA3 evidence files and existing untracked user material. Those original files are not staged, restored, moved or deleted by this phase.

S1's `evidence/checks.json` and test logs substantiate its reported 18 MA4 passes / one skipped cloud-live test, 405 UI passes, build/typecheck successes, and historical regression groups 450 + 1,637 + 58 = 2,145. The historical regression command preceded the final S1 fixes: it is not final-commit regression evidence. S1 explicitly did not run local generation or real benchmarks. Physical-device and installed-release acceptance were also incomplete. Current results are recorded separately.

## Authority and execution

* `bunny-host/manager.server.ts` owns task approvals, connection consent, launch checks, sessions, Stop, events, verification and accounting.
* `routing.server.ts` filters hard requirements before scoring. Exact-model/provider constraints remain filters through fallback. Policy remains `routing-policy-ma4-s1-v1`; qualification does not tune ranks against these samples.
* `model-capability.server.ts` discovers real `/api/tags`, `/api/show`, `/api/ps` facts. Catalogue capabilities do not grant tool authority.
* `OllamaAdapter` uses the existing native streaming `orch/exec.server.ts`. Its contract is text generation without a tool interpreter. Native runtime tool proposals are a separate experiment, not product tool execution.
* MA4's `registry`, `store`, `adapter`, `transport`, `selection`, `analyzer`, `evaluation` modules add bounded provider transport, deny-by-default configuration, versioned metadata, persistent reservations and per-task/per-agent selection. The existing evaluation engine is OpenRouter-specific; S1R's local suite is separate and does not inject qualification answers or scores into it.
* `bunny-missions/MissionManager` owns dependency scheduling, scoped delegation and capability permissions. Real local workflow tests use this scheduler, not a replacement framework. No capability adapters are installed in the read-only experiment.
* DPAPI/connection permissions and paired-device projections remain in place. No external account is activated and no real external API credential is read for qualification.

## Reproduced defects and minimal corrections

1. Local generation reported success without a final completion message and accepted a served-model mismatch. Focused failures in `evidence/defect-reproduction.log` precede the fix. Streaming and nonstreaming now require a completed receipt matching the exact requested model. Invalid structured JSON also fails. Existing fixtures were updated to include genuine protocol fields, without weakening assertions.
2. Current Ollama returns context at `model_info[architecture + '.context_length']`. S1 read only a top-level field and reported UNKNOWN on the installed models. The fix reads the named architecture, validates a positive integer, and does not confuse loaded session context with training context. No model-name inference is used.
3. A real read-only agent step's mandatory prose-summary instruction conflicted with JSON-only and exact-format objectives. `agent-format-reproduction.log` captures the focused failure. Read-only steps now honor the requested response format; security rules and write-step change summaries remain mandatory. Correctness still requires independent checks.
4. The built routing graph dereferenced absent Codex/Claude rows on an Ollama-only Host and crashed before approval. Browser execution reproduced `Cannot read properties of undefined (reading 'id')` in ProviderMark. Graph nodes now require an actual provider row; a stale score cannot invent availability. Focused model tests cover local-only, empty, full and stale-score snapshots. Normal full-provider layout is preserved; no visual redesign was introduced.
5. The final S1 inherited R18 fixture expected hosted metadata advice for `localOnly:true`, contradicting S1's new privacy guard. The full run and isolated reproduction both failed at `assert.ok(advised)`. Production denial is retained. R18 now first asserts local-only advice is null with zero transport calls, then verifies provenance in the explicitly enabled mock metadata-sharing path with execution restricted to two local models. All 50 intelligence tests pass in isolation; the full regression is rerun after this correction.
6. Legacy MA3 team fixtures deliberately provided no model catalogue while requesting JSON-schema inference. S1 correctly rejects unverifiable schema-bound candidates, so the fake planner was refused and many tests waited for impossible transitions. `team-fixture-reproduction.json` captures this refusal before the correction. The fixture now supplies explicit simulated `test-local:7b` completion/context facts while preserving unknown/offline starts. `team-fixture-fixed.json` shows the planner reaches reviewed approval afterward. No production eligibility rule was relaxed. The identified obsolete test stage was stopped after repeated bounded refusals; its partial output is retained under `attempt-team/`, and final suites are rerun from the corrected fixture.

## Remaining qualification boundaries

The experiment allowlists the two installed sub-5-GB models and caps context/output/runtime. This is an explicit qualification resource restriction, not evidence that the unrestricted production router automatically measures RAM/VRAM or rejects oversized models. That broader resource-admission behavior remains unqualified. No new persistent model policy, permission grants, database service, visual redesign, installed production release, driver, system service, download, or MA4-S2 work is introduced.

The environment is Windows, not the generic AGENTS.md Linux sandbox description. Existing startup/branding/preview contracts are preserved. Verification uses isolated state and avoids restarting the running user preview or installed Host.
