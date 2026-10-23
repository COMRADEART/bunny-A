# Bunny A MA4-S1.0 architecture and dependency audit

Recorded 2026-10-20, before MA4 production changes.

Repository: https://github.com/COMRADEART/router_agent.git
Initial branch: `ma3-t13-product`; base: `2f2c54c629d67746fb0eba34aecb69aeb8eb738b`.
Implementation branch: `ma4-s1-model-intelligence`.
The working tree contains 32 pre-existing modified MA3 evidence files and untracked user material. These are excluded from MA4 commits and must remain unchanged.

## Existing architecture

* TypeScript ESM, Node v24.18.0 observed on Windows, React 19 / TanStack Start / Vite 8. Node's native test runner and strip-types run host tests. No new dependency is necessary.
* `orch/router-requirements.ts` provides deterministic task analysis; `bunny-host/routing.server.ts` filters before scoring and owns bounded recovery. Extend these, never replace them.
* `bunny-host/manager.server.ts` owns tasks, approval, session lifetime, cancellation, connection reservations, verification and events. `contracts.ts` defines the existing adapter interface. CLI adapters provide tool execution; inference adapters must remain tool-free.
* `bunny-missions/manager.server.ts`, `machine.ts`, `team-coordination.server.ts` own dependency graphs, concurrency, scoped authorization, output validation and agent identities. Reuse this scheduler; no new agent framework.
* `connections.ts` and `connections.server.ts` own vendor consent, account/project bindings, budgets, revocation and DPAPI-encrypted credentials. OpenRouter already has a key-management/metadata-check entry but is detect-only. Enabling inference must NOT enable consent by default.
* `model-capability.server.ts` has per-model probe facts; `provider-usage.server.ts` keeps measured usage distinct from estimates; `routing-store.server.ts` persists decisions. Extend them additively.
* `jev-secrets.server.ts` supplies Windows CurrentUser DPAPI; `failure.server.ts` supplies diagnostic secret registration/redaction. No plaintext key configuration, environment files or browser credentials.
* `voice/`, host output listeners and typed shared snapshots already propagate task/model status. UI and movable-notch components stay intact, except exhaustive provider-name mappings if required by the added provider identifier.
* `lotus.server.ts` provides scoped memories and revision boundaries. MA4 must not read them directly or publish them as benchmark inputs. Existing host prompt/context assembly remains authoritative.

## Reference and provider verification

Discovery source reviewed: https://github.com/mnfst/awesome-free-llm-apis . Its permanent-free title is not a guarantee; it includes trial-labelled access and privacy restrictions. It is documentation only, never a dependency or executable input.

| Provider | Authentication / compatibility | Tier classification and limitations | Verification |
|---|---|---|---|
| OpenRouter | Bearer API key; OpenAI-style chat completions | `:free` variants are rate-limited free access; account-dependent daily limits; no promise of permanence. Paid models require separate consent and bounded pricing. Upstream provider routing needs explicit restrictions. | Official limits, free-variant, provider-routing and models docs reviewed 2026-10-20 |
| Groq | API key; mostly OpenAI-compatible, unsupported fields exist | Free plan is rate-limited, model/account-dependent; paid plan distinct | https://console.groq.com/docs/openai , /docs/rate-limits , /docs/models reviewed 2026-10-20 |
| Ollama | Local runtime needs no key; native API / OpenAI compatibility | Local inference has hardware/model-license costs, no cloud API quota. Local service can proxy cloud models; those must not be classified local. | https://docs.ollama.com/api/introduction reviewed 2026-10-20 |
| Gemini, Cohere, NVIDIA, other reference entries | Different authentication, API and data-use terms | Reference claims remain unverified unless separately checked. Cohere is trial-labelled; time-limited promotional/trial credits are not permanent free tiers. | Discovery-only; disabled; no adapters auto-installed |

Official OpenRouter references: https://openrouter.ai/docs/api/reference/limits , https://openrouter.ai/docs/guides/routing/model-variants/free , https://openrouter.ai/docs/guides/routing/provider-selection . Limits and availability must be rechecked at activation; documentation verification is not connectivity or benchmark evidence.

## Implementation contract

1. Add versioned, validated metadata/configuration and synthetic benchmark evidence under `bunny-host/ma4/`. Unknown models remain disabled until explicitly allowlisted. Keep documented, provider-reported and measured evidence distinct.
2. Add a replaceable HTTP inference transport with bounded response parsing, timeout/cancel, redaction and explicit streaming support. Wire OpenRouter through the existing ProviderAdapter contract; retain Ollama's already working native adapter.
3. Extend the existing router for context/output, structured output, language/audio requirements and sensitive-data constraints. Exact task/model and agent pins remain hard filters. Never infer tool execution rights from model metadata.
4. Reuse MA3 scheduling and task states. Existing mission model constraints provide per-agent scope; whole-task pins must constrain every model step. Keep MA3 local-only team acceptance restrictions rather than silently widening them.
5. Add provider concurrency, conservative usage reservations and quota cooldown. MA3 owns retries/fallback; avoid multiplying inner and outer retries. Honor Retry-After without shortening it. No prompt cache by default.
6. Versioned synthetic evaluation cases keep expected answers host-side, run only on explicit permission, store aggregates without private prompts and feed bounded evidence into existing scoring.
7. Mocked acceptance tests, existing regression suite, typecheck/build, Windows run and shared client checks. No live paid calls. Report external/live, hardware and production-release coverage separately.

## Constraints and baseline checks

The supplied App Builder Linux environment description does not match this Windows checkout. Do not recreate the app, replace startup tooling or start/stop the installed production host. MA3 acceptance documents remain immutable. Existing Android hardware/transport blockers remain inherited, not resolved by MA4.

Baseline commands: `git status --porcelain --untracked-files=no`, `git branch --show-current`, `git rev-parse HEAD`, `node --version`, `npm run typecheck`, `npm test`, `npm run test:ui`, `npm run build`. Results are recorded separately; no pass is assumed.
