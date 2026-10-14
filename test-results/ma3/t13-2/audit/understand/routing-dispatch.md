# routing-dispatch: Task dispatch path map (MA3 T13.2 prep)

Repo C:/Users/allam/Documents/new/bun-router, HEAD e449456 (source aa134f5). Read-only investigation; nothing edited.
User scope note (relayed request): consent must cover ALL providers, including ollama, opencode, cline, cursor, not only hosted subscription CLIs.

M = src/lib/bunny-host/manager.server.ts. MM = src/lib/bunny-missions/manager.server.ts.

---------------------------------------------------------------------------------------------------
## 0. The one router, in three layers

1. Legacy BunnyRouter: `bunnyRoute()` src/lib/bunny-host/router.ts:55. Provider-level. `eligibility()` router.ts:24 is the
   hard filter shared by EVERYTHING (availability ready|busy, installed, authenticated, missionAccess/codex, localOnly/offlineOnly,
   `providerAllowlist` :34, `providerDenylist` :35, filesystem/terminal/git/gpu caps). `inferredConstraints()` :5 adds regex-derived
   requirements. `runsLocally()` :16 (ollama cloud tags, `-cloud` suffix and `remoteModels` are NOT local).
2. T3 dynamic model router: src/lib/bunny-host/routing.server.ts (pure). `buildCandidates()` :408 -> `hardExclusions()` :176
   (calls `eligibility()`; adds `features.launch.supported`, local/cloud/privacy, tools/vision/context, modelExact/modelAllowlist,
   modelOverride) -> `scoreCandidate()` :225 -> `selectRoutingCandidate()` :298. `preLaunchRevalidate()` :318 (re-runs
   `eligibility()` + model still listed), `codexCompatibilityFresh()` :343, `classifyFailure()` :363, `planRecovery()` :393
   (RECOVERY_BOUNDS :386 = sameCandidateRetries 1, alternates 2, maxAttempts 4, verificationEscalations 1), `safeDecisionRecord()`
   :490, type `RoutingDecisionRecord` :472. `ADAPTER_TOOL_CONTRACTS` :80 (codex/claude true, ollama false). `PROVIDER_EFFORT_CONTRACTS` :99.
   `CandidateInput.layaGate` :121 is the existing per-candidate exclusion callback (applied :445-448).
3. Manager glue: M `routingPipeline()` :706 (one FILTER+SCORE pass; injects `layaGate` :729), `recordDecision()` :770,
   `revalidateCandidate()` :820, `rerouteFromDecision()` :845, `orderedByWindow()` :912, `bumpReroutes()` :925.

Executable adapters (src/lib/bunny-host/adapters.server.ts): `OllamaAdapter.launch` :172 (HTTP via `execute()` in
src/lib/orch/exec.server.ts), `CodexAdapter.launch` :471, `ClaudeAdapter.launch` :538 -> `spawnSession()` :212 (contained Windows
job on win32). `DetectOnlyAdapter` :581 (opencode/cline/cursor) always `availability="unavailable"`, `launch()` throws :614, and
`FEATURES[...].launch.supported` false -> excluded by `hardExclusions` "No execution adapter". `defaultAdapters()` :617.

---------------------------------------------------------------------------------------------------
## 1. Submission -> approval -> FINAL DISPATCH

### 1a. Submit (provider choice #1): M `submit()` :943
- Entry points: HTTP "submit" src/lib/bunny-host/http.server.ts:749-767 (`validateSubmit` :84; the user may pass `override`,
  `modelOverride`, `constraints.providerAllowlist/Denylist` validated by `validateConstraints` :67, max 6, known ids); voice
  http.server.ts:418 (localOnly+offlineOnly); Missions `launchModel()` MM:1436 (submit closure :1500-1517) and
  `launchTeamModel()` (submit at MM:1702).
- Flow: `inferredConstraints` -> project/cwd resolution (:960-1007) -> `bunnyRoute` (:1011) -> `routingPipeline` (:1030) ->
  `routed` = pipeline selection (:1036-1059) or legacy fact-less fallback (:1060-1081; throws if facts exist and nothing is eligible).
- T13.1 Jev advice (:1082-1114) runs only when `!delegated && routingMode==="auto"`. `applyDecisionAdvice()` (intelligence.ts:145) runs over
  `pipeline.selection.order` with traits {local, tools}. On "accept" with a different key it REWRITES `routed`,
  `decision.recommended_provider/model`, `effort`, sets `assistanceRecord.adopted` (:1097-1108). Guards in intelligence.ts:
  stale generation / >30 s (`ADVICE_MAX_AGE_MS` :119) :157, clarify :159, outside eligible set :162, confidence thresholds
  :164-165, local->hosted refused :168, tool-free->tools refused :169. There is NO vendor/account guard, so Claude->Codex is allowed (T13.1
  limitation 7, MA3_T13_1_LAYA_JEV_INTEGRATION_ACCEPTANCE.md section 15 item 7).
- Advice is fetched by `assistDecision()` M:685 (HTTP, local only; never device, never manual, never Mission).
- Task object built :1115-1152 (state "queued"), `db.write` "task.created", `routingStore.saveDecision` :1156, events
  routing.classified / routing.selected / routing.assisted, then "routing" -> "waiting_for_approval" (:1191-1201, event
  "approval.required").

### 1b. Before approval: retarget (provider choice #2, manual)
- M `retarget()` :1203 (only `waiting_for_approval`). Re-runs `bunnyRoute` + `routingPipeline` with `override=provider`;
  overwrites `provider/model/effort/decision`, sets `manual=true`, `routingMode="manual"`, and replaces the row under the SAME `routingDecisionId`
  (:1250). HTTP: http.server.ts:831 `missions.retargetTask` (MM:381, adds a codex mission check). UI: src/components/island/task.tsx:452.

### 1c. Approval entry points: all funnel into private M `launch()` :1408
- `approve(id, by)` :1355 (direct user; `by` "device:*" adds to the in-memory `deviceApproved` Set :91). HTTP "approve"
  http.server.ts:798-815 (a device is refused mission tasks and anything `!deviceMayLaunch`, device-authority.server.ts:35).
- `approveVoiceTurn(id)` :1328 (local tool-free concrete model only).
- `approveDelegated(id, {missionId, stepId, authorizationId, check})` :1377: Mission auto-approval under the envelope; `check` is
  `taskViolation()` (src/lib/bunny-missions/authorization.server.ts:494; checks `envelope.providers.allow`, localOnly, external
  budget, roots, `providerScopeViolation` :480, session budget). Called from MM:1633 (launchModel) and MM:1724 (team).
- Mission "provider.execute" permission answer -> `this.tasks.approve(step.taskId, by)` MM:4440.

### 1d. `launch()` M:1408-2032 sequence
1. :1415 `containment.assertAccepting`; :1416 state must be waiting_for_approval; :1418 `restartSurvivorRefusal`.
2. :1420-1436 project/cwd + mission `missionScopeCheck(task)` + executionScope sanity.
3. :1437-1447 `eligibility(preProvider, task.constraints)` + localOnly `runsLocally`. These refuse; they never reroute.
4. :1451-1504 **post-approval reroute #1** (pipeline-engaged tasks only, `decision.policy_version` set): if `revalidateCandidate`
   fails, MANUAL throws; AUTO calls `rerouteFromDecision(exclude current)` -> `bumpReroutes` + `update({provider, model, effort,
   routingRerouted:true, decision.recommended_*})`, event "routing.rerouted". The owner approved provider X; Y now launches.
5. :1505-1507 resolves `provider`/`adapter` from the FRESH `db.get(id).provider`; cwd realpath check.
6. :1510-1521 `final = db.get(id)`: mission `missionScopeCheck(final,"check")`, `missionAttemptAdmission(final,"action")`,
   `missionScopeCheck(final,"launch")` (spends a trusted-desktop grant). The comment at :1520 reads "Last refusal point before the session starts".
7. :1522 update -> "launching" (persists `approval` ONLY when `approval.kind==="mission"`, :1527).
8. :1745 **CHOKE POINT A (initial dispatch)**: `session = adapter.launch(adapterTask, adapterHooks)` with a frozen
   `structuredClone(launching)`.
9. :1647-1736 `startSession(target, options)` closure = **CHOKE POINT B (every relaunch)**: re-checks `eligibility`, localOnly,
   adapter exists, mission check/admission("retry"|"reroute")/launch; `update` provider/model/effort (+decision when rerouting),
   event "routing.retrying"; optional `bumpReroutes`; :1723 `targetAdapter.launch(adapterTask, adapterHooks)`. Returns null on
   refusal (the caller then exhausts).
10. :1784-2020 background recovery loop. For each failed attempt: `classifyFailure` -> `routingStore.saveAttempt` :1881 ->
    `planRecovery` :1915. MANUAL never reroutes (:1925). Then:
    - retry-same :1929 -> startSession(same provider/model): **post-approval re-dispatch #2** (same provider);
    - escalate-effort :1943 -> raised effort on the same provider, else `rerouteFromDecision(exclude tried)`: **#3 (may change provider)**;
    - reroute / reroute-larger-context :1967-1986 -> `rerouteFromDecision`: **#4 (changes provider)**, event "routing.rerouted".
11. `hooks.model` :1614: a provider-reported model rewrites `task.model` (same provider; identity drift only, not a dispatch).

There is no other `adapter.launch` call site in src/lib (grep confirmed: only M:1723 and M:1745).

### 1e. Host restart
- Constructor M:191-211: every task in launching/running/verifying/waiting_for_input/waiting_for_agent_approval is set to
  "failed" ("Host process restarted ... cannot reattach"). Running direct Tasks are NEVER relaunched automatically.
- `waiting_for_approval` tasks survive a restart with their old provider/model/routingDecisionId. Approving one later goes through
  `launch()`, where revalidation may reroute. The `deviceApproved` Set is in-memory and is lost (re-added on a device approve).
- `live()` M:476 marks providers "unknown" until probed this run, so eligibility refuses until the re-probe.
- Mission/Agent restart: AgentRuntime replay (src/lib/bunny-host/agent-runtime.server.ts ~976-1080, `classifyReplay`) ->
  `MissionManager.reconcileInterrupted()` MM:4767. Steps with `failure.category==="host_restart"` and no pending request /
  approvedOnce go back to "ready" ("requeue_once"/"resubmit"). The scheduler then calls `launchModel` again -> FRESH
  `tasks.submit` + `approveDelegated` under the SAME stored envelope, which may pick a different provider within
  `envelope.providers.allow`. So a "queued restart" is a new Task with new routing under the existing envelope.
- jev_usage: pending rows become 'unknown_restart' (typesafe-jev.server.ts:239).

### 1f. Agents / Missions
- agent-runtime.server.ts:22 states that it "never routes, launches, verifies, or grants". It drives MissionManager (approve :180/:424,
  schedule, reconcileInterrupted). All provider dispatch for Agents goes MM.launchModel/launchTeamModel -> TaskManager.submit
  (delegated) -> approveDelegated -> launch(). Constraints carry `missionAccess`, `providerAllowlist` = envelope.allow ∩ step.allow
  (MM:1450-1453, :1487), `providerDenylist` (step deny + independence producers + remote ceiling), and localOnly (envelope/step/budget).
- MissionManager installs hooks on TaskManager in its constructor: `missionScopeCheck` MM:155, `missionTaskAgent` :184,
  `missionAttemptAdmission` :328 (`admitAgenticProvider`), `missionAttemptRuntimeLimit` :329, `missionAttemptSettled` :340.
  Note: `missionScopeCheck` does NOT itself re-check `envelope.providers.allow`. Reroutes stay inside it only because
  `task.constraints.providerAllowlist` is re-checked by `eligibility()` inside `preLaunchRevalidate`/`startSession`.
- Personal-agent voice/chat: http.server.ts:418 submit + :430 approveVoiceTurn.

---------------------------------------------------------------------------------------------------
## 2. Every place the provider can change after (or around) owner approval

| # | Where | When | Provider change? | Who decides |
|---|---|---|---|---|
| P1 | M:1082-1114 Jev advice | submit, BEFORE the approval card | yes (cross-vendor hosted allowed) | Jev+BunnyRouter |
| P2 | M:1203 `retarget` | before approval | yes (explicit user) | user |
| P3 | M:1451-1504 launch revalidation reroute | AFTER the approve click, before dispatch | yes (AUTO only) | fallback_order |
| P4 | M:1929 retry-same | after a failed attempt | no (re-dispatch on the same provider) | planRecovery |
| P5 | M:1943-1966 escalate-effort | after a verification failure | maybe (alternate when there is no ladder) | planRecovery |
| P6 | M:1967-1986 reroute / larger-context | after a failure | yes | planRecovery+fallback_order |
| P7 | M:1614 hooks.model | during a run | model only | provider |
| P8 | MM:4767 reconcileInterrupted -> new submit | after a Host restart | yes (new Task) | envelope |
| P9 | MM:1520-1556 mission submit retries (outsideCeiling fallback, independence fallback) | at submit | yes (constraint relaxation) | MissionManager |
| P10 | waiting_for_approval Task that survived a restart, approved later -> P3 | after a restart | yes | fallback_order |

`rerouteFromDecision` (M:845) starts from `record.assistance?.adopted ?? record.selected` and walks `record.fallback_order`
(persisted at submit; it includes every eligible candidate, all vendors). Device-approved tasks skip non-`deviceMayLaunch` entries
(:885). Nothing else restricts vendor or account.

---------------------------------------------------------------------------------------------------
## 3. Consent / approval data recorded today

On `OrchTask` (src/lib/orch/types.ts:200):
- `approval?: { kind: "user"|"mission"; at; authorizationId?; missionId?; stepId? }` :248. It is persisted only for the mission kind
  (M:1527). Direct user, device and voice approvals are evidenced ONLY by events: "approval.accepted" (M:1365), "approval.remote_device"
  (:1369), "approval.voice_tool_free" (:1350), "approval.delegated" (:1404).
- `manual`, `routingMode` :253, `routingDecisionId` :255, `routingRerouted` :257, `executionScope` :249 (immutable via `update()`
  M:396-405), `mission` (immutable), `projectId`, `cwd`, `constraints` (incl. providerAllowlist/Denylist, localOnly, cloudOnly,
  privacyLocal, modelExact/modelAllowlist), `projectContextRef`, `decision.decision_assistance` (types.ts:114).
- `Project.preferred: ProviderId|"auto"` (types.ts:189) is always "auto" (project-registry.server.ts:75/134/228) and is NEVER read by
  routing. It is a dead field: a possible home for a per-project consent default, but it has no semantics today.
- Missions: `AuthorizationEnvelope` src/lib/bunny-missions/types.ts:99 has `providers: { execution, allow: ProviderId[]|null,
  localOnly, sessions?: { steps[{stepId, scope}], maxSessions, writeIncludesShell } }`, `grantedBy`, `authority`, `expiresAt`,
  `revokedAt`, `budget.maxExternalModelCalls`, `projectRoots`. It is stored in `mission_authorizations(id, mission_id, granted_at,
  revoked_at, record)` (src/lib/bunny-missions/store.server.ts:44). The Agentic adjunct lives in AgenticStore (revision, admissions).
- Device approvals: in-memory `deviceApproved` Set only.
- There is no "cloud allowed" flag except the constraint booleans (`localOnly`, `offlineOnly`, `cloudOnly`, `privacyLocal`) and the
  envelope `localOnly`. There is no per-provider/account consent anywhere. ProviderLive carries no account identity beyond `authenticated`,
  `authenticatedState` and `detail` (claude `authMethod` is only folded into the detail string, adapters.server.ts:536).

Credential/env: `spawnSession` passes `{...process.env}` minus CLAUDECODE to codex/claude (adapters.server.ts:227 and :351). An
ambient ANTHROPIC_API_KEY (or OPENAI_API_KEY/CODEX_API_KEY) therefore reaches the CLI and can silently switch subscription work to
paid API billing. Nothing removes it today.

---------------------------------------------------------------------------------------------------
## 4. Persistence

- `tasks(id TEXT PRIMARY KEY, record TEXT NOT NULL)` holds the whole OrchTask as JSON (persistence.server.ts:22, get :40, write :58).
  New OrchTask fields need no migration.
- `events(sequence, at, type, task_id, detail)` (:24): the audit trail for approvals and reroutes.
- `outcomes(task_id, provider, task_type, completed, verified, duration_ms)` (:25): learning.
- RoutingDecisionStore (routing-store.server.ts:142, tables created in its constructor; additive, no user_version bump):
  `routing_decisions(id PK, task_id, mission_id, created_at, policy_version, decision JSON)` + idx task;
  `routing_attempts(id PK, decision_id, task_id, attempt_index, provider, model, effort, taxonomy, detail, created_at)` + idx task;
  `model_routing_profiles(provider, model, provenance, profile, updated_at, PK(provider,model))`.
  `saveDecision` is INSERT OR REPLACE (retarget and bumpReroutes overwrite the same id). `parse()` returns null on a policy_version
  mismatch (ROUTING_POLICY_VERSION "routing-policy-v1"), so bumping the version would orphan reroutes for in-flight tasks.
- `jev_usage(id AUTOINCREMENT, at, session_id, kind, answered_by, input_tokens, output_tokens, latency_ms, outcome)` + index
  `jev_usage_at` (typesafe-jev.server.ts:236-237). Reader: `usage()` :325 needs rows with `session_id = instanceId` (session
  count, all time for that session), rows with `at >= local midnight` (day ceilings), and the latest billable row (lastRequestAt). Writers:
  `reserve` :375, `settle` :381, `settleFailure` :391 (DELETE when unsent), `recordDiscovery` :399. Nothing prunes.
  Safe retention: delete rows with `at < now - N days AND session_id != current AND outcome != 'pending'` (keep today, the
  current session and the latest billable row); run it at JevService construction and daily.
- settings table: `provider_paths`, `thermal_policy`, PERSONAL_AGENTS_SETTING, Jev POLICY_KEY/LAST_TEST_KEY.

---------------------------------------------------------------------------------------------------
## 5. Tests pinning this behaviour, and how they build a Manager

Fixtures: there is no shared helper module (src/lib/bunny-host/testing/ holds only codex.test.ts; fixtures/ is empty). Each file
defines its own:
- t3-manager.test.ts: `fixtureProfile` :25, `fixtureLive` :53, `scripted(id)` :72 (an adapter with mutable `state` and `launched[]`
  rows exposing `finish(result)`), `t3Fixture(providers, factLess)` :93 -> `new HostDatabase(tmp/host.sqlite)`, fake
  `ModelCapabilityRegistry` probes, `new TaskManager(db, directory, adapters, { modelRegistry })` :111, `await tasks.discover()`.
  Tests: :128 launched==selected, :175 fact-less parity, :206 manual override/retarget, :238 manual exact model, :265 impossible
  manual, :276 manual model disappears (no reroute), :298 AUTO codex stale -> launch reroute (P3), :331 quota reroute (P6), :363
  verification escalation (P5), :399 manual retries once and never reroutes (P4).
- intelligence.test.ts: `managerFixture()` :172 (same pattern + `intelligence: { jevFetch, jevProtector: TestProtector,
  layaRuntime }`), `advice()` helper, `enableJev()` :205. R05 :665 (outside the set), R06 :679 (pure applyDecisionAdvice locality/tools
  guards; the "narrowing" claude->ollama case is accepted), R07 :700 (approval still required, authority unchanged), R14 :818 (Missions never
  take advice), R18 :880 (provenance `adopted`), R19 :915, R20 :935 (a restart keeps the config). K* tests cover jev_usage accounting;
  RV-B3 :995 (pending -> unknown on restart).
- intelligence-host.test.ts: `boot(port, adapters)` :45 is a real HTTP host with the `neverLaunches()` adapter :21. R07/R16 :135: a forged
  decisionAssistance is ignored. RV-S2 :148: a device submit never spends the allowance. K05/K06 :79: the phone is refused.
- routing-matrix.test.ts: pure `candidates()` :72 helper; R01-R36 (R16 :395 unavailable rerouted, R17 :407, R19 :437 override,
  R28 :559 a model switch never widens the envelope, R30 :594, R31 :611 auto reroute from the fallback order, R35 :689 selected==launch,
  R36 :709 bounded). R12 :317 builds a HostDatabase. :734 writes the routing-matrix.json/routing-policy.json artifacts.
- routing.test.ts: pure section tests (:233 local/cloud, :270 unavailable excluded, :432 revalidation, :514 recovery bounds, :551 safe
  record).
- routing-store.test.ts: table idempotence :73, round-trip :93, foreign policy fails closed :112, attempts :128.
- Other managers: 23 files call `new TaskManager(` (bunny-host: agent-recovery, agent-runtime, agent-team.fixture.ts:120,
  codex-compatibility, execution-scope, failure, host, intelligence, m2, project-workspace, provider-containment,
  remote-remediation, t3-manager; bunny-missions: agentic-authorization, approval-batches, cross-app, f02-scope, f02-staging,
  f03-hardening, git-merge, missions, remote-authority), plus production http.server.ts:313. A default-deny gate breaks all of them
  unless they are given a test default.

---------------------------------------------------------------------------------------------------
## 6. Recommendation: dispatch-time ConnectionConsent gate

Goal: one Host-owned predicate, evaluated against the EXACT (provider, model, connection mode/account, project, task origin)
that will start, at every session start. It fails closed and covers all six ProviderIds (ollama local AND ollama cloud tags,
plus opencode/cline/cursor even though they are detect-only today).

### 6a. Primary insertion (covers launch, retries, reroutes, escalations, restarts)
Add one private method on TaskManager, e.g.
`private dispatchConsent(task: OrchTask, kind: "launch"|"retry"|"reroute"): string | null`,
backed by an injected `ConnectionRegistry` (a ManagerOptions seam, like `modelRegistry`/`intelligence`). Call it in exactly two places:
1. In `launch()`, immediately after `final = this.db.get(id)` (M:1510), before `missionAttemptAdmission` and before
   `missionScopeCheck(final,"launch")`, so a refusal never spends a single-use desktop grant. Throw `Error("Outside connection
   consent: ...")`; the caller (approve/approveDelegated) surfaces it. The state stays waiting_for_approval because no state change has
   happened yet (the "launching" update is at :1522).
2. In `startSession()`, after `targetTask` is built (M:1667) and BEFORE the mission checks, so it also runs for direct tasks (today they
   have NO per-relaunch authority check beyond eligibility). On refusal: emit `routing.consent_denied`, follow the
   `missionAttemptSettled?.(...,false)` pattern already in the catch, and return null. The loop then calls `exhaustNow(...)` with a truthful note.
Every relaunch (P4/P5/P6) and every restart path (P8 new Task, P10 old waiting task) passes through one of these two
sites, and there are no other `adapter.launch` call sites. These two calls are therefore sufficient.

### 6b. Make reroute selection consent-aware (avoids wasted attempts, keeps the fallback honest)
In `rerouteFromDecision()` M:881-909, skip entries the gate would refuse (same predicate, "reroute" kind). This mirrors the existing
`deviceApproved` skip at :885. It is optional, but it stops refused targets from burning the `alternates` budget.

### 6c. Close limitation 7 at routing time too (defence in depth, not a replacement)
- Option 1: extend `CandidateTraits` (intelligence.ts:137) with `vendor`/`connectionId`, and refuse in `applyDecisionAdvice` when the target
  vendor/connection differs from the router's pick unless consent says "cross-vendor allowed" for that account/project. The
  `eligible` list built at M:1090 must then carry these fields. A simpler alternative: filter `pipeline.selection.order` by consent before
  `applyDecisionAdvice` and before `safeDecisionRecord`, so `fallback_order` never contains candidates without consent.
- Best: add a consent exclusion inside `buildCandidates` through a gate callback exactly like `layaGate` (routing.server.ts:121,
  :445-448; wired at M:729). The candidate record then shows "No consent for <provider> account in this project" as an
  exclusion reason (visible in the audit, R34-safe), and neither Jev nor the fallback order can ever see that candidate. Keep 6a anyway: consent can be revoked between
  submit and dispatch, and waiting tasks survive restarts.

### 6d. Record consent on the Task (also fixes the missing direct-approval record)
At M:1522, persist `approval` for ALL kinds (today only mission), plus a `consent: { connectionId, mode, provider, projectId,
grantedAt, revision }` snapshot of what was approved. At dispatch, compare the current provider/connection to it. A reroute to a
provider/connection the approved consent does NOT cover must either be covered by stored consent or be refused / sent back to
waiting_for_approval to ask again. Store the snapshot in the task JSON (no migration) and keep a `connection_consents` table owned
by the registry (additive CREATE TABLE IF NOT EXISTS, same recipe as RoutingDecisionStore).

### 6e. Ambient API key
Remove the key at the two env construction points, adapters.server.ts:227 and :351 (`delete env.ANTHROPIC_API_KEY` etc.), unless the
connection mode for that provider is "api_key" with explicit consent. Drive this from the frozen `adapterTask` (e.g. a
`connectionMode` field on the task snapshot, never a credential handle). Also detect the key in `ClaudeAdapter.detect` (authMethod)
so the registry can show "API key present in environment" as view-only.

### 6f. Test impact / migration
- Inject the gate through ManagerOptions. Give it a permissive default ONLY in tests (via the existing per-file fixtures), or seed
  consent in the fixtures. The production default must fail closed per provider. Decide the migration for existing owners (e.g. a one-time
  "Connected Accounts" review, or grandfathering providers that already have outcomes rows). All 23 TaskManager constructions are affected.
- New tests to add next to t3-manager.test.ts (`t3Fixture`/`scripted` pattern):
  - consent revoked between submit and approve -> refused at launch;
  - P3 launch reroute to a vendor without consent -> refused;
  - P6 recovery reroute skips or refuses;
  - retry-same is re-checked;
  - Jev accepting Claude->Codex without cross-vendor consent -> refused;
  - a waiting task across a restart (reuse the directory with a new TaskManager, as intelligence R20 does) is still gated;
  - a Mission reconcileInterrupted resubmit is gated;
  - a device/phone can only read redacted status (intelligence-host.test.ts `boot` pattern);
  - an ambient ANTHROPIC_API_KEY is not passed on (assert on the `env` given to a stubbed spawn; `spawnSession` has a `spawnChild` test seam :209-213).
