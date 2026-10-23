# MA4-S1 operations and verification

MA4 extends BunnyRouter and the MA3 task/mission system. It adds no UI workflow, tool interpreter, shell access, agent identities, authentication system or external database. New local SQLite tables are created idempotently by their owner. Old settings load unchanged; absent/corrupt MA4 configuration disables external inference.

## Activation contract

All actions below use the existing authenticated Host command channel. Only the workstation owner may activate providers, approve upstream processors, manage keys, discover catalogues or run benchmarks. Paired clients cannot perform these actions. Owner snapshots expose `modelIntelligence`; paired snapshots omit it. Existing task snapshots identify the actual selected provider/model.

1. Use `ma4.discover` to refresh public metadata. This sends no prompts or credentials. Discovery does not enable newly found models. Metadata expires for dispatch after 24 hours; failed refreshes never extend its timestamp.
2. Review current model licenses, free/paid prices, capabilities and downstream retention terms. Choose exact model IDs and downstream provider slugs from current official information. Neither the discovery list nor the public catalogue grants permissions.
3. Save/check the OpenRouter key using the existing Connected Accounts controls. Storage uses the existing Windows CurrentUser DPAPI facility, separate from process environments and snapshots. A metadata check proves authentication only, not inference entitlement.
4. Apply `ma4.configure` with a complete version-1 `configuration`. Defaults are in `src/lib/bunny-host/ma4/registry.ts`. `enabled` is false, `allowPaid` is false and both USD ceilings are zero by default. `models` and `upstreams` are explicit allowlists, not model routers or automatically adopted discovery results. Model activation is independent of account/project consent. Existing API connection consent, billing opt-in and daily request limits still apply, including for selected free models.
5. Refresh discovery after configuration. Submit/approve tasks through the existing MA3 path. Missing capacity, evidence, quota or consent rejects the request. Local-only/sensitive tasks do not leave the workstation. No benchmark or paid call was activated by this implementation session.

Example configuration shape (IDs below are illustrative placeholders, not recommendations or verified availability):

```json
{
  "version": 1,
  "enabled": true,
  "models": ["vendor/model:free"],
  "upstreams": ["provider-slug"],
  "maxConcurrent": 1,
  "requestsPerMinute": 20,
  "requestsPerDay": 50,
  "tokensPerMinute": 10000,
  "maxOutputTokens": 1024,
  "allowPaid": false,
  "maxUsdPerRequest": 0,
  "maxUsdPerDay": 0,
  "evaluationsAllowed": false
}
```

The request/day ceilings are conservative account-wide safeguards within this Host, not a claim about remaining upstream quota. Other applications may consume the same account's limits. A provider's actual limits may be lower. Free variants require both `:free` and provider-reported zero input/output prices. Trial credits, promotions, unknown prices and arbitrary discovered providers are not activated automatically.

Premium inference needs current known prices, `allowPaid: true`, finite positive per-request/day ceilings AND existing account billing consent. UTF-8 bytes plus framing are reserved as a conservative token upper bound; output has a hard token cap. Failed/unknown attempts retain worst-case monetary reservations. Provider-reported token counts stay distinct from reservations; unknown counts remain null. Per-task `constraints.maxCostUsd` can tighten the request ceiling. Unknown-priced cloud CLI candidates cannot satisfy a strict monetary cap.

## Model selection and scheduling

* Ordinary tasks use automatic routing after capability, locality, allowlist and account gates. Valid measured benchmark evidence adds a bounded score component; it can never make an ineligible model eligible. Missing evidence is neutral.
* `override` and `modelOverride`, or `constraints.modelExact`, pin a task. A leading owner directive such as “Bunny, use Claude for this entire task.” is recognized. Pins also suppress hosted advisory routing. An unavailable pin returns a model-approval refusal rather than choosing an alternative. After an attempted pinned run fails, MA3 retains its existing failed-task lifecycle; a different model needs a new owner decision/approval.
* Missions accept `modelSelection: {task: {provider, model?}, agents: {roleOrStepKey: {provider, model?}}}`. Task pins constrain every model-backed step. Conflicting or missing roles reject planning. Choices persist with that mission and are reapplied on replan, never written as a global preference. Non-model capabilities retain their existing permissions.
* A hybrid directive is recognized on Mission creation. Ordinary single-task submission refuses a per-agent directive and directs it to bounded Missions; it never ignores the pin. Exact wording beyond the deliberately narrow leading-directive grammar should use typed selections.
* The existing MA3 scheduler owns dependencies, concurrency, cancellation, verification and deterministic terminal states. The new adapter adds its own abortable queue (32 waiting requests maximum; configured concurrency 1–4). A simple single-agent task remains one task. The tested three-step Mission overlaps two independent model steps and starts review after both finish.
* Existing T11 team Missions remain local-only under their accepted MA3 envelope. Cloud inference is available to explicitly selected tool-free read model steps through the ordinary Mission path. Tool-bearing steps keep the installed Codex/Claude adapters and existing sandbox/approval boundaries.

## Failure, privacy and credentials

OpenRouter requests name one exact model, an explicit `provider.only` list, `allow_fallbacks: false`, `require_parameters: true`, `data_collection: "deny"`, and per-token `max_price`. No model-list fallback or paid router slug is sent. These controls do not replace review of upstream retention/terms. Sensitive data is local-only, including when the legacy fact-less router path is used. Sensitivity inference is conservative pattern matching, not a comprehensive data-loss prevention system; callers should set `sensitive` for known sensitive data.

MA3 alone owns retries and cross-provider fallback. The transport does not retry. HTTP 429/402/transient failures persist provider cooldowns; exponential backoff has bounded jitter and respects Retry-After as a minimum. Same-provider recovery cannot dispatch during cooldown. Ordinary bounded MA3 fallback still requires account/project consent, destination allowlists and unpinned selection. No credential/account rotation or quota circumvention exists.

Changing downstream/model policy is refused during active sessions. A policy fingerprint binds queued inference; changing policy invalidates that task's old inference approval. Account credential/consent changes use existing epochs and revocation stops. Requests do not follow redirects. Responses have byte/time bounds, exact served-model checks and JSON validation when requested. Partial, truncated, malformed and mismatched output fails the task. Credentials and provider diagnostic bodies never enter the new logs/events; known credentials are redacted before output reaches Host listeners.

The compatible transport is a trusted library seam for HTTPS APIs and explicitly configured loopback runtimes. Arbitrary endpoints are not accepted over the Host HTTP API. Its contract explicitly reports streaming unsupported; it does not pretend an unstreamed response is a token stream. Ollama retains its existing native streaming adapter. The new inference adapter exposes no tools, images or audio; requirements it cannot execute are rejected even if upstream model metadata advertises them.

## Evaluation evidence

`ma4.evaluate` requires workstation authority, `confirm: true`, an approved model, and `evaluationsAllowed: true`. Each of five synthetic cases runs as an ordinary bounded MA3 task. Stop, disconnect, account consent, request/token budgets and output verification still apply. No user conversation or Lotus memory becomes benchmark data. Aggregate records contain model/provider, timestamp, benchmark version, five samples, outcomes, errors/timeouts, total latency and nullable token usage; expected answers and response bodies are not stored there. The router never receives benchmark answers.

Version `bunny-ma4-s1-synthetic-v1` tests elementary reasoning, arithmetic, a narrow known-correct addition function, JSON validity and a proposed tool-call JSON shape. This is a reproducible smoke benchmark, not a general coding-quality or tool-execution evaluation. Actual tool-call reliability, broad coding/reasoning benchmarks, statistical confidence and hardware-normalized latency rankings remain future evaluation work. OpenRouter benchmark evidence does not transfer to another provider with the same model name. No measured live scores were created by this session.

## Reproduction

```text
npm run test:ma4
npm test
npm run test:ui
npm run typecheck
npm run build
node scripts/browser-smoke.mjs http://127.0.0.1:8080/ screenshots/ma4-dev.png
npm run preview:restart
node scripts/browser-smoke.mjs http://127.0.0.1:8081/ screenshots/ma4-built.png --baseline screenshots/ma4-dev.json
```

All default tests use mocked model responses. `ma4.live.test.ts` is skipped unless `BUNNY_MA4_LIVE=1` is explicitly set with an already approved local Host URL/token and `BUNNY_MA4_FREE_MODEL` naming an approved `:free` model. It uses a fixed synthetic prompt and refuses paid IDs. No keys are imported from environment/discovery repositories. Tests must use a disposable Host state; the installed production Host and its permissions are not test fixtures.

## Scope and release boundaries

No production deployment, installed-release switch, unrestricted autonomous operation, model training, provider installation or MA3 acceptance-record modification is part of this milestone. MA3 voice, Lotus, agent identities and movable Notch remain owned by their existing implementations. MA4 uses their task/event boundaries; it adds no direct Lotus integration or memory export. Inherited Android/human hardware acceptance limits remain recorded by MA3. Provider availability, exact live alias behavior and real inference have to be checked through explicit opt-in before operational acceptance.
