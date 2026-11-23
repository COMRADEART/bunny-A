# M-A-3 T9 phone remote acceptance

**Acceptance: FAIL.** The implementation is committed and the Windows test package is built, but one required regression fails and several mandatory mobile scenarios lack live evidence. This is not a release approval.

## Source and scope

- Executable/source/tooling commit: **0a5988c5eef7e6beae3d1622529e2c638cca7788**.
- Branch: **claude/ma3-t9-phone-remote**.
- Accepted T8 executable ancestor: **987afeace77520b9f4ef49e27b137dd01fb3fee8**; initial evidence descendant: 98b71553d09909d06fcfa84ebff96a61d6b46321.
- 34 source files changed. Final evidence is a separate documentation commit; the package stays pinned to the executable commit.
- Existing user documents and memory are preserved. No push, install, production restart, tunnel, firewall or Startup change. T10 was not started.

## Delivered behavior

The existing responsive dashboard is an authenticated thin phone client. Agent/Mission/Task execution, routing, provider adapters, authority, Project paths, journal and verification stay in the Windows Host. The existing one-time pairing infrastructure is reused. Device credentials never confer owner authority.

A stable Host UUID and a per-process epoch bind commands to the observed Host. Device access expires after 365 days or 30 days idle, is rechecked at admission and event delivery, and is bounded by per-device command/read/stream limits. Device state and direct Host SSE are redacted before gateway delivery.

The phone can read canonical Agent, Mission, Project and verified artifact state; Pause, Resume, Stop; answer eligible exact Host offers; Deny or revoke; sign itself out; and use bounded local tool-free inference. Initial Agent delegation, roots/budgets, destructive/external/sensitive allowances, arbitrary tools/apps/shell, hosted/tool-capable providers and owner administration require the Windows Host. Unsupported Agent Talk and Redirect remain disabled.

Approval is bound to the actual request, Mission/Step, action, risk, resource fingerprint, authorization revision and Host generation. Pause/Resume reissues stale asks. The discovered cross-app one-time allowance bug was fixed without widening authority; independent checks still require their own admissible capability.

The client shows Live only after a stream ready/heartbeat plus a fresh snapshot. It falls back to bounded polling/backoff, labels stale data and disables actions offline or on an untrusted Host. Mutations carry per-principal operation IDs; an unknown acknowledgment stays uncertain until canonical reconciliation. There is no offline replay queue. Sign-out clears protected state and ignores already-admitted stale results.

## Authentication and delivery actually tested

The real disposable Windows Host and built gateway were exercised through an independently paired credential. Remote cookie access requires exact configured HTTPS origin and an actual loopback connector peer. Cookies are HttpOnly, Secure, SameSite Strict. Unknown/revoked/expired sessions, unauthorized Origin/CSRF, anonymous SSE, wrong Host/epoch, owner-header forgery and insecure gateway requests are refused. See pairing-contract.md, transport-security.md and device-role-matrix.json.

The browser used a **test-only HTTP loopback adapter** that seeded a real device cookie and translated its origin to the configured connector origin. Browser enrollment/transport is **SIMULATED**. A Node TLS client independently validated the fixture CA and failed without trust; no browser certificate warning was bypassed and OS trust was not modified. This does not prove physical-phone HTTPS pairing or a production network path.

## Integrated real Host result

A Project-bound Agent was locally delegated, then supervised by the paired browser. Phone Pause and Resume preserved canonical identity and reissued the exact write request at the current revision. One eligible Allow once completed a real filesystem write and an independent filesystem.compare check.

- Agent: **e75662c3-5697-4007-9ead-0d31ec91247c**.
- Mission: **f4f1d69c-6657-41de-9320-ce61ae27cbf7**.
- Canonical result: **COMPLETED**, with verified Project artifact.
- Browser receipt: result.txt contained `T9 phone approved receipt`; SHA-256 **84596b75dd0d3ffc35231b48e6458a77da29cd8f38e50a4b479ed82822f6fd19**.
- Desktop canonical state and paired browser converged on the same Agent/Mission.

Remote denial persisted its device actor. A concurrent owner Allow once / phone Deny race produced exactly one canonical resolution and refused the losing request. Wrong-Project artifact access and deliberate hash tampering were refused; the original disposable file was restored.

Lost Stop acknowledgment was **simulated by discarding the real receipt**. operation.status confirmed applied; replaying the same ID returned a replay acknowledgment with no duplicate effect. No claim of real carrier packet-loss testing.

## Revocation, reconnect and restart

Self-sign-out and owner revocation refused subsequent state, commands and artifact reads. Direct device SSE closed on revocation; strengthened sequence assertions forbid even redacted future events. Other authorized streams remained valid. The browser cleared its cached protected view and open artifact after authenticated reconciliation, then showed Pairing required with no silent re-pair. Previously displayed content is not remotely erased before that bounded reconciliation.

Closing the disposable Host made the browser visibly Offline/stale with controls and artifact fetches disabled. A fresh Host process reconnected, retaining Host UUID and showing the new epoch. A different pinned Host required explicit trust.

A genuine fresh-process restart changed PID **29800 → 24032** and epoch, preserved Agent/Mission identity and completed artifacts, and invalidated previous grants. This was a controlled shutdown/boot over the same disposable database, not an abrupt power-loss test.

Active work continuing through a specific phone UI close or phone-only network loss remains **NOT TESTED**. The accepted A27 test proves Host execution completes with zero UI involvement, but is not substituted for those phone sequences.

## Browser and mobile evidence

Dev and production-output smoke passed on desktop 1280×800 and mobile 390×844: visible content, clean console, no horizontal overflow and no divergence after the same settled disposable snapshot was used. Both screenshot pairs were visually inspected. Earlier connecting/offline or divergent attempts are retained.

Paired browser layouts were measured at 320×740, 375×812, 390×844, 430×932, 844×390 and 768×1024 with no horizontal overflow. An earlier 40px landscape target was fixed; the final built dashboard recheck measured every shown control at least 44px. Keyboard Enter activated navigation and retained a visible 2px focus outline. Reduced-motion handling is source-reviewed only.

**Physical phone: NOT TESTED. LAN/separate network: NOT TESTED. Internet remote: NOT TESTED.** Mobile browser certificate trust, cookie persistence, background suspension, hardware touch and screen reader behavior are unproven. No public tunnel was authorized or activated.

## Adversarial acceptance

All F01–F65 entries are enumerated in adversarial-matrix.json with initial state, action, expected/observed behavior, evidence and classification. This is not a claim all were executed live. Dedicated cross-Agent/cross-Project approval substitution, real offline approval replay, active-phone close/network continuity, physical phone and separate network scenarios remain untested or limited; reduced motion is STATIC. See the matrix for exact boundaries.

## Regression and build gates

| Suite | Tests | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| scripts | 256 | 256 | 0 | 0 |
| library | 664 | 663 | 1 | 0 |
| Agent | 24 | 24 | 0 | 0 |
| UI | 99 | 99 | 0 | 0 |
| **Distinct total** | **1043** | **1042** | **1** | **0** |

The initial accepted floor was 1,008. Final 1,043 includes 14 new Host tests and 21 new UI tests. Focused repeats and ten protocol checks are not counted again. npm test stopped after the failing library suite, so Agent and UI suites were run separately with their own final receipts.

**Unresolved blocker:** the unchanged T6 X53 filesystem → Git → owned terminal → fresh Host → isolated browser → native Calculator → verified artifact regression fails at Calculator acquisition with **Calculator arithmetic identity unavailable**. Its earlier stages passed; a read-only UIA diagnostic found no arithmetic controls. The native test was not skipped, weakened, or forced through an unverified target. The initial takeover baseline passed; final repeated runs did not.

The three existing SSE tests were updated because raw detail sentinels are intentionally removed from device projections. They now positively match exact canonical sequence, require payload redaction and stream closure, and forbid any post-revocation sequence. This strengthens the old authority assertions. All other pre-existing test files match their takeover hashes.

- Typecheck: PASS.
- Lint: PASS, 0 errors / 22 warnings.
- Build: PASS.
- Dev/built render smoke: PASS, clean console and nondiverging final baseline.
- Focused Host remote tests: 14/14 PASS.
- Focused original stream revocation tests: 3/3 PASS.
- Built gateway protocol checks: 10/10 PASS within labeled fixture.

## Windows test package

**Bunny-A-Windows-MA3-T9-TEST**, version **1.0.0-MA3-T9-TEST**, source and tooling pinned to 0a5988c5eef7e6beae3d1622529e2c638cca7788. The package build passed; all **357** manifest entries verified, import closure passed, and **103** source/tooling entries match their Git blobs. Bundled Node, native ownership helper, Playwright runtime and licenses are part of the manifest/closure evidence.

The local package is under test-results/ma3/t9/windows-package. It is not installed, archived, published or committed as binary evidence. Packaged runtime boot is NOT TESTED. Production release pins were not changed. See windows-package-results.json and windows-package.log.

## Production preservation and audit limitation

The installed v26 release's **160** manifest files verified unchanged. Original installed Host/gateway process identities and creation times remained unchanged across the Codex takeover. install.json, credentials file, all 18 device rows, settings, schema, table counts, workspace startup.sh and Windows Startup files matched over the **corrected final installed-state audit window**. User documents and memory hashes also match. All installed-state access was read-only.

The first production audit incorrectly selected development/host.sqlite. It is retained as a failed evidence boundary, not presented as installed-state proof. The correct installed path was later resolved from install.json to state/host.sqlite. **Whole-task installed database/device equality is NOT TESTED**, even though the final short-window audit is equal and no production mutation command was issued.

## Changed source files

- install/Bunny-Server.mjs
- package.json
- scripts/package-bunny-desktop.ps1
- src/components/island/agent.tsx
- src/components/island/agentic.tsx
- src/components/island/connection-model.test.ts
- src/components/island/connection-model.ts
- src/components/island/host-stream.ts
- src/components/island/mission.tsx
- src/components/island/phone.tsx
- src/components/island/premium.css
- src/components/island/premium.tsx
- src/components/island/remote-view-model.test.ts
- src/components/island/remote-view-model.ts
- src/components/island/task.tsx
- src/lib/bunny-host/agent-runtime.server.ts
- src/lib/bunny-host/contracts.ts
- src/lib/bunny-host/device-authority.server.ts
- src/lib/bunny-host/event-signal.ts
- src/lib/bunny-host/http.server.ts
- src/lib/bunny-host/ma2-t10.test.ts
- src/lib/bunny-host/presentation.ts
- src/lib/bunny-host/remote-device.test.ts
- src/lib/bunny-missions/agentic-store.server.ts
- src/lib/bunny-missions/agentic-types.ts
- src/lib/bunny-missions/commands.server.ts
- src/lib/bunny-missions/manager.server.ts
- src/lib/bunny-missions/types.ts
- src/lib/orch/host-bridge.server.ts
- src/lib/orch/host.ts
- src/routes/__root.tsx
- src/routes/api/bunny-events.ts
- src/routes/api/bunny-pair.ts
- src/store/use-island.ts

## Evidence

Evidence root: test-results/ma3/t9/. INDEX.md maps receipts, INDEX.sha256 seals retained evidence and screenshots, and finalize-evidence.mjs records how this report/matrices were derived. Earlier failures and historical reruns are retained. One expired pairing code was redacted; no active credential values are published. Test package binaries stay local and are covered by their own release manifest.

The implementation is ready for review, with acceptance blocked by the native regression and explicit missing live mobile scenarios. Production was not upgraded and T10 was not started.

BUNNY_MA3_T9_FAIL
