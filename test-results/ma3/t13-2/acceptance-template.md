# Bunny A MA3 T13.2 — Unified Accounts Acceptance

Verdict: **BUNNY_MA3_T13_2_PASS_WITH_LIMITATIONS**, subject to the final gate data inserted below. Review date: 2026-10-13.

## Source and isolation

Starting checkout: `e449456090def0440c4f50bd882fb6d187968e4c` (accepted T13.1 evidence), descended from executable source `aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f`. Branch: `claude/ma3-t9-phone-remote`.

Final executable source: **`2ea9bd497830334190c20fa2867363368d965ce4`**. Its implementation parent is `bbbebd80f42578ddc55a2c8e3e0f2383dd25166a`; the final commits preserve exact voice expressions, strengthen native argv/account test contracts, and add account limits plus consistent owner/phone eligibility. No test was weakened. The evidence commit is separate and is identified in the final handoff; the sealed report cannot contain its own future Git hash.

The final source inventory in `test-results/ma3/t13-2/source-provenance.json` covers 39 source/package files. New surfaces: shared catalogue/gate, Host registry, retention, account settings/view model and focused security tests. Existing TaskManager/router/adapters, projections, voice intent and approval UI received bounded integration changes. No fifth Personal Agent, replacement router, native Notch redesign, auth route or live database migration was added.

The user's LOKAM logger changes, `.gitignore` additions, `package.json` session-evidence script, `.claude`, `docs/lokam`, `tests` and other initial untracked material remain outside the source/evidence commits. Recovered unused PKCE drafts remain untracked and outside the package; they are not an implemented OAuth integration. Full tests ran in an agent-created detached checkout of the exact final source, with the native runtime inputs already required by the accepted baseline.

No GitHub push, deployment, production upgrade/restart, tunnel, Startup modification, subscription purchase, billing enrollment, credential import or T14 work occurred. The development preview remains running.

## Implemented capability and billing boundaries

| Family | Implemented connection | Task surface | Billing / entitlement truth |
|---|---|---|---|
| ChatGPT / Codex | Provider-owned native login initiation, status/account discovery; separate encrypted API-key metadata check | Native Codex only | Native plan reported; no fresh inference entitlement verification. OpenAI API billed separately and disabled for Tasks |
| Claude / Claude Code | Provider-owned native login initiation/status; separate encrypted Anthropic API key metadata check | Native Claude Code only | Native plan reported; ambient API credentials/settings scrubbed; unexpected API billing trips the connection. API Tasks disabled |
| Ollama / Laya | Existing local runtime discovery and dispatch | Local models only | No account required; cloud-tagged Ollama dispatch disabled |
| Cursor | Installed-client detection/native sign-in initiation where available | Unavailable | Native adapter uncertified; no included-use claim |
| Cline / ClinePass | Native-workflow guidance and conservative discovery | Unavailable | No universal ClinePass bridge; no automatic tool execution |
| Grok / xAI | Native-workflow guidance; separate xAI API-key storage/check | Unavailable | Consumer subscription and API billing stay separate |
| OpenCode | Native detection/login initiation where installed | Unavailable | Inner-provider billing unknown; no Claude OAuth reuse |
| Gemini | Native-workflow guidance; separate API key storage/check | Unavailable | No Gemini Task adapter; metadata is not entitlement |
| Copilot | Identity/native-workflow guidance | Unavailable | GitHub identity does not grant Copilot inference; credits distinct |
| OpenRouter | Manual API key storage/key metadata check | Unavailable | Paid credits; browser OAuth unimplemented; no paid BYOK fallback initiated |

All dated official URLs and platform/terms limitations are in [provider-matrix.md](test-results/ma3/t13-2/provider-matrix.md) and the retained `audit/understand/research-*.md` files. The executable catalogue also stores per-mode sources reviewed on 2026-10-13. Native usage permission is limited to the provider's own installed client on the owner's profile, not extracted first-party tokens or an unofficial proxy.

**LIVE VERIFIED:** read-only provider-owned status/version discovery on this PC: Codex CLI 0.162.1, Claude Code 2.1.296, Ollama 0.40.3. Codex and Claude reported signed-in native accounts and plan metadata; the UI displays masked identifiers and labels entitlement `plan reported`. Cursor, Cline and OpenCode were unavailable on this Windows profile. No genuine login was completed by the agent and no live provider inference/entitlement request was made.

**SIMULATED:** native login launcher, native provider sessions in security scenarios, API metadata transport, Jev-enabled forged advice and account switch/revocation races. Windows DPAPI encryption/decryption of synthetic fixture keys and the packaged Host restart were real. No real key was requested or manufactured.

## UI and accessibility

Settings → AI & Models → Connected Accounts shows ten provider families, selectable documented modes, masked account/workspace, last verification, runtime health, plan source, separate sign-in/entitlement/eligibility facts, billing label and limitations. Provider-owned sign-in, status check, pause/resume, disconnection, key save/remove, Project scope and management links are available according to the mode. Disconnect only removes Bunny access; provider-native login remains under user control.

Routing & Privacy shows specific cloud switch allowances (off by default), same-provider/local failover vs owner review, detailed retention policy and nonsecret account audit. Existing model preferences, usage limits and Local & advice settings remain available. The typed request “Bunny, connect my Claude account” opens the Claude card; it does not authenticate, collect credentials or launch inference. Voice intent follows the same permission boundary.

Browser QA used the supported CUA interface for actions. Confirmed: keyboard Enter changes account tabs; labelled password fields with `autocomplete=new-password`; API mode has unavailable Task permission and explicit separate billing; ten cards render; desktop/mobile have no horizontal overflow; both themes and reduced-motion preference render; no captured console error. Screenshots are under `test-results/ma3/t13-2/ui/`. The required repository smoke audit also checks desktop/mobile against dev and both built outputs, with screenshots inspected in pairs.

A stale paired-cookie browser on the workstation correctly failed closed. The explicit recovery path clears only `bunny_device` after the same actual-peer, loopback, same-origin and no-relay checks; it never reads a Host credential or forwards a command. Its denial guard is tested. The persistent in-app test cookie did not clear reliably during this run; a separate clean workstation origin and fresh smoke browser rendered Online. This is not a claim of verified remote cookie revocation. Refused sign-out/recovery retains state, and sign-out requires an explicit acknowledgment.

Automatic approval review rejected a custom headless interaction diagnostic because browser actions must use CUA. That diagnostic was not executed or bypassed; CUA completed interactive QA, and the explicitly required repository smoke script was approved separately.

## Threat model and credential lifecycle

The trusted owner is the authenticated Windows Host workstation principal. Browser-local status cannot authorize a Task. A paired phone is supervisory; an Agent is an execution principal without credential authority. API secrets exist only inside Host protection code and approved metadata transports. All projections omit ciphertext and vault handles. State carries only presence/protection metadata, salted account fingerprints and masked identities. Email hints are ephemeral and never identity proof.

Connection keys use Windows DPAPI for the current user, with provider/mode-specific entropy and opaque random handles in SQLite. Fixed HTTPS metadata checks enforce certificate verification, redirect refusal, timeout and capped reads; raw diagnostic response contents are not retained. Epoch/revision checks before outbound I/O and after awaited results prevent a stale save/check from reconnecting a revoked account. No password, OTP, browser cookie, recovery code, copied auth cache or refresh token is collected.

Native children strip ambient billing keys, custom credential homes, NODE_OPTIONS and other injection variables case-insensitively. Codex is pinned to OpenAI and user config/rules are disabled; Claude disables hooks/settings sources and strict MCP applies. Unexpected Claude API-key provenance trips the connection. Existing execution scope and Windows owned-job containment remain intact through the fresh-dispatch wrapper. This does not constitute independent Authenticode, managed-policy or same-profile process-isolation certification.

## Final dispatch and billing consent

Individual Task approval captures exact provider/account/mode/epoch/revision and destination account bindings. Final launch, retries, reroutes, escalation and Jev recommendations revalidate Project scope and authority; revoked or switched accounts cannot survive queued work or a restart. A global cloud allowance or cached recommendation cannot adopt a new destination account after proposal. Switching back also checks the original account pin. `ask` failover permits first approved dispatch and refuses automated recovery. A capped first Task excludes only its own pending reservation during the final synchronous admission check.

Actual Host HTTP tests enable Jev through a fake transport that recommends Codex for a Claude Task; the final Host retains/refuses the unauthorized route and dispatches no content to Codex. Forged client advice/bindings are ignored. A separately simulated positive destination-allowance test permits only the exact captured connection. Agents receive neither route bindings nor vault handles. Revocation cancels bound active work; remote/provider cancellation remains uncertain where a native client cannot prove it.

No chargeable API inference adapter is enabled. Model-list/key metadata checks confer no inference entitlement. Unknown pricing/usage makes strict monetary ceilings fail closed. Native clients may use extra usage already enabled on the provider account; Bunny does not purchase credits or alter those settings and cannot promise that every native request is zero-cost. Per-connection daily Task-start caps and native strict USD ceilings are exposed in Settings and enforced by the Host contract. Connected identity remains separate from Budget blocked eligibility. Task starts count Bunny dispatches, not every internal native-client model request. Multiple-slot selectors remain unsupported.

## Mandatory test matrix

| Cases | Evidence / classification |
|---|---|
| A01 email hint; A04 secret rejection/masking | SIMULATED intent parser and provider-owned launcher; STATIC VERIFIED no auth cache/password extraction |
| A02 provider verification | SIMULATED launcher/status distinction; LIVE VERIFIED read-only native status; real login NOT TESTED |
| A03 PKCE/state/nonce/redirect | NOT TESTED / no implemented OAuth path or registered client; no callback claim |
| A05 invalid/expired/revoked state | SIMULATED unknown authorization, transient loss, delayed response and lifecycle gates |
| A06 account/workspace isolation | SIMULATED account switch, exact pins and key slots; different OS/WSL profiles NOT TESTED |
| A07 encrypted restart/redaction | LIVE VERIFIED Windows DPAPI with synthetic key and packaged Host restart; API transport SIMULATED |
| A08 phone authorization | SIMULATED actual HTTP fixture phone matrix; LIVE VERIFIED packaged Host denies 14 owner actions, redacts status and allows review only |
| A09 Agent authority | STATIC VERIFIED adapter input stripping/storage boundary; SIMULATED nonowner mutation denial |
| A10 disconnect/revocation | SIMULATED active cancellation, queued refusal, stale-result rejection; provider-native logout remains user-owned |
| R01/R02/R03/R10 | STATIC VERIFIED unsupported/identity/API modes cannot dispatch; SIMULATED metadata cannot confer entitlement; fresh live inference NOT TESTED |
| R04 no paid fallback | SIMULATED ambient-key stripping and API billing tripwire; STATIC VERIFIED API/cloud dispatch off |
| R05/R06/R08 | SIMULATED final actual spawn wrapper, scope/revision/epoch/account stickiness, retries and destination pins |
| R07 Jev-on/forged advice | SIMULATED real Host handler with enabled Jev fake transport and forged HTTP request fields |
| R09/R11/R12 | SIMULATED local-only availability, capped admission/unknown money fail-closed, retained Laya/Jev behavior |
| N01 native detection | LIVE VERIFIED official status/version commands; signature validation NOT TESTED |
| N02/N03/N04 | STATIC VERIFIED sanitized environment/config/execution scope; LIVE VERIFIED native containment fixture processes; no fabricated outcomes |
| N05/N06 | Retained full Personal Agent/Notch/voice/phone regression; physical device/microphone NOT TESTED |
| N07 retention | SIMULATED bounded rollups, pending/current quota protection, exact Jev budget parity, transactional rollback and restart unknown reservations |
| N08 release checks | Exact-source regression/typecheck/lint/build, Windows manifest/import/source checks, packaged Host, dev/built browser and production preservation below |

## Retention and audit

Old connection and Jev request details roll into UTC-day aggregates transactionally, at most 5,000 records per batch. Retention defaults to 30 days and is owner-configurable. Current local-day quotas, pending work, current Jev session and the latest historic Jev request survive. Monetary unknowns are preserved in rollups rather than converted to zero. Failure rolls back both deletion and aggregate updates. Repeated cleanup is idempotent. Prompt contents and secrets are not written to connection usage/audit records.

## Final gate data

{{FINAL_GATE_DATA}}

Earlier exploratory logs, including interrupted/superseded runs and initial source-format failures, are retained for transparency. Only `regression-final/` and the final package/smoke results count toward acceptance. Their source pin and exact test-name inventory prove retention; totals are not obtained by adding repeated runs.

## Independent review and remaining limits

[independent-review.md](test-results/ma3/t13-2/independent-review.md) records the independent review agent's findings and verified fixes: preservation of owned-job control, native backend/settings pinning, exact destination pins, sign-in/auth-loss revocation, async metadata race prevention, reservation accounting, first-launch `ask` semantics, Project scope propagation, configured executable selection and approval disclosure. No demonstrated HIGH/BLOCKER remains in the reviewed changes.

Remaining NOT TESTED: live fresh provider login and inference entitlement, genuine OAuth/delegated grants, real paid API requests, multiple real accounts/SSO organizations, WSL isolation, managed/custom gateways, native binary signatures, vendor-controlled extra usage, same-profile shell access to DPAPI/SQLite, physical phone/microphone and new Laya live inference. DPAPI protects against another Windows profile; it is not a same-user process ACL. Unsupported providers stay view-only/detect-only. API/cloud dispatch remains disabled. Native simultaneous account profiles and multiple-slot UI are unsupported, not advertised capabilities.

The result is a complete offline-tested account and consent architecture with explicitly limited integrations. T14 requires a separate user instruction.

BUNNY_MA3_T13_2_PASS_WITH_LIMITATIONS
