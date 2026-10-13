# T5 baseline authorization audit (before implementation)

Source: 70fead3618aa5948f1cc3c8c6a73914f32dec654. Classification: STATIC VERIFIED.

The canonical capability policy is `bunny-missions/authorization.server.ts:decide`.
CapabilityBus resolves executable identity, consults that policy, applies T9 only to an
ordinary ask, probes native targets asynchronously, rereads current authority, and
atomically consumes a T9 mutation allowance immediately before dispatch. MissionManager
owns planned scopes, consent, permission requests, deterministic steps, child approval,
verification and recovery. TaskManager owns provider launches and T3 reroutes. AgentRuntime
owns only identity, checkpoints and continuity.

Reusable contracts:

* MA0 Mission consent is persisted as an AuthorizationEnvelope. Children bind Mission,
  step, root and immutable read/write scope. Provider selection is separate authority.
* `TaskManager.approve` remains a single waiting Task approval. `approveDelegated` is
  an in-process MissionManager call, never client-supplied delegation.
* Capability manifests and escalation-aware risk already distinguish READ, WRITE,
  EXECUTE, EXTERNAL_SIDE_EFFECT and DESTRUCTIVE. Sensitive and hard-approval operations
  ask separately. Standing never-allow/read-only/ask-every-time rules outrank delegation.
* Canonical filesystem checks resolve junctions/symlinks and reject root escape.
* T9 batches bind a concrete Mission, step set, Calculator operation, application package,
  fresh native target, executable generation, TTL, risk ceiling and atomic action count.
  Calculator scope cannot authorize arbitrary shells or applications.
* Existing Host HTTP authentication establishes workstation vs paired-device provenance.
  T9 offers are Host-computed; remote input only shrinks offered TTL/count. Device
  revocation is checked during protected SSE delivery.
* Host recovery ends every active T9 batch, invalidates pending request IDs and queued
  allow-once decisions. T4 classifies read replay vs ambiguous mutations and checkpoints.
* Stop latches before awaits, cancels owned children and ends T9 authority; completed
  capability results and audit evidence are retained. Closing SSE/UI is not Stop.

Extensions required:

* A revisioned, integrity-checked record of explicit Agent/Mission/project delegation,
  with finite action/time/concurrency bounds and safe public projection.
* Exact terminal argv/cwd/environment and executable/script identity. Existing command
  basename/executable binding alone does not constrain `node -e` or wrapper arguments.
* Resource identities pinned at consent, so replacing an approved root cannot rebind
  authority. Browser exact origin + operation; desktop continues to require T9/T9R.
* Atomic shared accounting for all deterministic actions and every provider attempt,
  including retries/reroutes; no budget reset on provider change.
* Current Agent flags, revision, Mission/step, generation and canonical authorization
  must be checked at actual dispatch, including after asynchronous target validation.
* Persist scope-denial fingerprints to prevent identical denied requests on retry/replan.
* Conservatively invalidate executable authority on restart: historical intent survives,
  interrupted admissions become UNKNOWN, Agent waits for fresh reviewed user consent.

Unchanged: canonical allow/deny rules, legacy single-Task approval, MA0 graph authority,
T9/T9R target validation and restart invalidation, T3 provider eligibility/routing,
IR-H1 ownership, device revocation, isolated browser/SSRF fence, installed production,
the four protected reports, memory/, and remote Git state. No global permission modes.

Safety constraint: a general provider workspace session cannot enforce exact terminal
families or all per-operation resource bounds. T5 delegation therefore admits only
tool-free model inference through the known Ollama adapter; workspace CLI providers
require separately reviewed legacy Task authority and cannot bypass the T5 envelope.
This restriction must be visible in the proposal and acceptance limitations.
