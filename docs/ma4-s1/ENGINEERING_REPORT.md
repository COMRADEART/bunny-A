# BUNNY A — MA4-S1 ENGINEERING REPORT

Repository: https://github.com/COMRADEART/router_agent.git

Branch: `ma4-s1-model-intelligence`

Base commit: `2f2c54c629d67746fb0eba34aecb69aeb8eb738b` (`ma3-t13-product`)

Final commit: `273c59791bee7c18679196dd0b7fd934a0d0a52f` — final implementation/test commit; the closing documentation/evidence commit follows it.

PR URL: Not created; branch has not been published.

Architecture audit: [AUDIT.md](AUDIT.md), delivered and committed as `e79bead` before production changes. No new dependency, agent framework, database service, UI workflow or authentication system was introduced. Actual environment: Windows, Node `v24.18.0`, TypeScript ESM.

Existing MA3 integration: BunnyRouter, TaskManager, ProviderRegistry, ModelCapabilityRegistry, ConnectionRegistry and MissionManager remain authoritative. Existing task states, graph scheduling, bounded retries, verification, Stop, event propagation, DPAPI credentials, voice interfaces and scoped Lotus prompt assembly are retained. MA4 reads no Lotus data directly. Existing team Missions remain local-only; cloud model steps use the ordinary bounded Mission path. Notch behavior and MA3 acceptance records were not changed by these commits.

Providers implemented: new OpenRouter inference adapter and replaceable OpenAI-compatible HTTP transport; existing native Ollama adapter reused; existing Codex and Claude adapters retained. Custom compatible endpoints are a trusted library extension seam, not an unvalidated public endpoint-setting API.

Providers verified: OpenRouter free variants, account limits, model metadata and downstream-routing controls checked against official documentation; Ollama local/cloud distinction and Groq compatibility documentation reviewed. Documentation verification is not an inference-connectivity result. The discovery repository is neither an executable dependency nor trusted configuration authority. Sources: [OpenRouter limits](https://openrouter.ai/docs/api/reference/limits), [free variants](https://openrouter.ai/docs/guides/routing/model-variants/free), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [model metadata](https://openrouter.ai/docs/api/api-reference/models/get-models), [Ollama API](https://docs.ollama.com/api/introduction), [Groq compatibility](https://console.groq.com/docs/openai).

Local model support: existing Ollama discovery, native streaming, local-model selection and cancellation retained. A bounded live metadata probe reached `/api/tags` and found **five installed models**. No local generation/benchmark was run.

Free API support: exact OpenRouter `:free` models with currently reported zero prices, owner-approved model and downstream allowlists, current metadata and account/project consent. New discovery remains disabled until approved. Trial credits, promotions and unknown prices are not treated as permanent free access. External inference remains off by default; no real cloud generation was sent during this session.

Automatic routing: existing eligibility-first scoring extended with validated task analysis, explicit capability/privacy/cost constraints and bounded versioned evaluation evidence. Neutral priors and unknown evidence remain distinguishable from measurements. Policy version: `routing-policy-ma4-s1-v1`.

Manual model override: provider and exact-model pins are hard constraints. Unavailable pins produce an approval refusal without selecting an alternative. Exact pins are also protected when discovery has no model facts; the legacy provider fallback cannot silently substitute a default model.

Agent-level routing: mission-scoped whole-task and per-role/step-key selections persist through planning/replan. Conflicting/missing pinned roles fail planning. Tests exercise two concurrent model steps and a review dependent on both, using the existing MA3 scheduler. Single-step work remains one step. Narrow leading natural-language directives are recognized; hybrid instructions use bounded Missions rather than being ignored by single-task submission.

Provider fallback: existing MA3 bounded recovery only, subject to destination consent and explicit pin constraints. The HTTP transport retries zero times. Persisted cooldowns enforce Retry-After, bounded exponential backoff/jitter and quota exhaustion. A provider cannot choose another model or unapproved downstream processor silently.

Privacy enforcement: local-only handling for declared/detected sensitive data, including the legacy no-facts path; deny-by-default external dispatch; account/project approval, upstream allowlist and queued-policy fingerprint; pinned/sensitive tasks skip hosted decision assistance. Credentials use existing DPAPI storage and never enter shared snapshots or child tool environments. Provider error bodies are omitted; known secrets are redacted before model output reaches Host listeners. Paired clients cannot configure/discover/evaluate models and receive no owner model-policy snapshot.

Rate-limit enforcement: atomic persistent request/token/cost reservations, conservative 20-RPM/50-daily request ceilings, configured token budget, bounded queue/concurrency, hard output caps and provider cooldown. Failed or unknown attempts retain worst-case cost reservations. Reported token counts remain distinct from reservations. Paid inference needs both account consent and finite explicit per-request/day budgets; per-task caps may tighten them.

Model evaluation: permission-controlled, versioned five-case synthetic engine, timestamped sample/outcome/error/timeout/latency/token evidence, bounded ranking influence and stale/invalid evidence rejection. Benchmark answers and private interactions do not enter routing evidence. **No real model benchmark scores were created.** The current fixtures cover elementary reasoning/arithmetic, a narrow known-correct addition function, JSON validity and a proposed tool-call JSON shape. Actual tool-execution reliability and broader capability qualification are not established.

Files created: seven modules under `src/lib/bunny-host/ma4/`; `ma4.test.ts`, `ma4.live.test.ts`; audit, operations/report documents and reproducible logs/verdicts under this directory; desktop/mobile QA screenshots under `screenshots/ma4-*`. See the [exact source-change manifest](evidence/files.txt).

Files modified: existing Host adapters, task/model/provider/connection registries, router, device projection, shared contracts/types, mission planning/authorization, test entrypoints and exhaustive provider-name maps. The two TSX edits add the provider display name only; no layout or interaction changed. The source manifest identifies every changed path. The 32 pre-existing modified MA3 evidence paths remain outside these commits; untracked user material was not added.

Build results: **PASS** for `npm run typecheck`, default `npm run build`, and `JEV_DESKTOP_BUILD=1 npm run build`. Both builds skipped external database migration because `DATABASE_URL` was unset. No database or auth was activated.

Unit tests: `npm run test:ma4` — **18 passed, 0 failed, 1 live-service test skipped**. All fourteen requested acceptance scenarios are covered by deterministic fixtures, including unavailable exact pins, quotas/timeouts, secret output, rejected capabilities, untrusted discovery, measured rankings and failed output validation.

Integration tests: actual disposable Host HTTP authority tests, Windows DPAPI round trip, real MA3 scheduler with mocked inference, concurrent/dependent steps, usage/events, policy changes, cancellation and strict paid budgets passed. Final affected-area command: **135 passed, 0 failed, 1 opt-in live test skipped**. This overlaps other suites and is not an additional distinct-test total.

Regression tests: existing `npm test` run — **2,145 passed / 0 failed / 0 skipped** (groups 450 + 1,637 + 58). The command started before `test:ma4` was appended to the npm script. Later source changes were validated with the final affected-area suite, MA4 suite, UI suite, typecheck and builds. The full historical suite was not represented as a clean-checkout test of the final commit. `npm run test:ui` was rerun and passed **405 / 405**.

Windows validation: real DPAPI encryption/decryption and existing native process-containment/voice-worker regression tests passed on Windows. Final desktop-target build renders and connects to a disposable local Host. No installed production release was switched, no new Windows package was installed, and no physical microphone/Notch acceptance was performed.

Mobile compatibility: dev and built Windows-target browser checks at 390×844 show visible content, no horizontal overflow, no console/page errors and no auth/brand warnings. Screenshots were visually inspected. Built desktop-target verdict reports `divergesFromBaseline: false`. Existing mobile/shared-client UI tests and paired-client authority tests pass; Android hardware was not retested.

## Commands and evidence

```text
npm test
  tests/pass/fail/skip: 450/450/0/0 + 1637/1637/0/0 + 58/58/0/0
npm run test:ma4
  tests/pass/fail/skip: 19/18/0/1
npm run test:ui
  tests/pass/fail/skip: 405/405/0/0
npm run typecheck
  exit 0
npm run build
  exit 0; [migrate] DATABASE_URL not set — skipping
$env:JEV_DESKTOP_BUILD='1'; npm run build
  exit 0
node scripts/browser-smoke.mjs http://127.0.0.1:8080/ screenshots/ma4-dev.png
  exit 0; desktop and mobile content; no console/page errors or overflow
npm run preview:restart
node scripts/browser-smoke.mjs http://127.0.0.1:8081/ screenshots/ma4-desktop-built.png --baseline screenshots/ma4-dev.json
  exit 0; divergesFromBaseline: false
```

The exact final affected-area command, environment and results are in [checks.json](evidence/checks.json). Logs: [regression](evidence/regression.log), [MA4](evidence/ma4-tests.log), [affected areas](evidence/focused.log), [UI](evidence/ui-tests.log), [typecheck](evidence/typecheck.log), [web build](evidence/build-web.log), [Windows build](evidence/build-desktop.log), [Windows built smoke](evidence/smoke-desktop-built.log).

Known limitations: new cloud transport is bounded, non-streaming, text-only and tool-free. Provider model metadata may claim capabilities the execution adapter does not expose; those requests are rejected. Exact served-model aliases need live API contract verification. Language evidence remains unknown unless explicitly established. Synthetic benchmarks are narrow; actual tool calls and broad coding/reasoning quality are not qualified. Generic compatible provider activation and additional provider-specific adapters remain disabled extension work. Strict budgets use conservative reservations rather than assuming unknown charges are zero.

The default Vercel-target browser preview renders correctly but remains disconnected from the local Host, and therefore differs from the connected dev snapshot. That fail-closed bridge behavior was not weakened to make a screenshot match. The existing Windows `node-middleware` build target connects to the disposable Host and matches the dev baseline. Web-preview connectivity is not claimed as verified.

Security considerations: sensitive-data pattern detection is not comprehensive DLP; trusted callers should label known sensitive tasks. API account consent also remains required for free models. Upstream terms/licenses/retention require review at activation. The compatible endpoint seam is trusted server code; arbitrary discovered endpoints cannot self-activate. No private conversation training, unrestricted tools, remote policy editing, account rotation, provider installation or automatic executable-policy modification was introduced.

Outstanding blockers: no explicitly approved live cloud inference qualification or real quota-exhaustion run; local generation and real-model benchmarking unperformed; broader/tool-call capability evaluation and inherited hardware acceptance unverified. These do not invalidate the passing mocked checks, but they prevent a production-completeness claim.

**FINAL STATUS: PARTIAL** — MA4-S1 implementation and mocked integration are reviewable and passing; operational/live and broader capability acceptance remain open. No later MA4 milestone was started. Development preview is left running.

**NEXT RECOMMENDED STEP:** review the branch and the [activation/operations contract](OPERATIONS.md), then complete explicitly authorized free/local live qualification and expand reproducible capability benchmarks within MA4-S1 before production acceptance.
