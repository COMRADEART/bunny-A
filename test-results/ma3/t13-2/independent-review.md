# T13.2 independent review

Review date: 2026-10-13 (America/New_York). Reviewer: independent Codex review agent.
Final reviewed source: `2ea9bd497830334190c20fa2867363368d965ce4`, independently confirmed as HEAD.
This pin includes the reviewed account-limit controls, shared owner/phone eligibility and redaction helpers,
actual phone HTTP regression assertion, and restored independent exact direct-argv vectors.
Prior reviewed pins: `62194f0c990af21c3cb7fedc4acc50574adacf7c` (baseline-test adaptation only) and
`60046c74a3dd903f026c9ac2b189524e5c732fe5` (prior executable recovery review).
Implementation commit: `bbbebd8`. The reviewer inspected `git diff bbbebd8..60046c7` for
`src/store/use-island.ts`: the final delta changes formatting and adds `prettier-ignore` for two
unchanged voice expressions; their behavior is unchanged.
Scope: T13.2 connection registry, dispatch authority, provider adapters, retention, Host/device projections,
account UI, and subsequent narrow local stale-pairing recovery, baseline-test and account-limit deltas.
The recovery pass examined
`clearStaleLocalPairing` in `src/lib/orch/host.ts`, `mayClearLocalPairing`, the DELETE pairing fallback,
`clearStalePairing` / `signOutDevice`, and the offline Settings recovery action.

## Independent verdict

All actionable implementation and test-assertion findings raised in this review are resolved in the final
reviewed source. No remaining demonstrated HIGH/BLOCKER or open reviewed code finding remains.
The final local pairing recovery delta preserves the existing Host privilege boundary. The final executable
pin is confirmed. Release acceptance still depends on mandatory same-source regression/package gates, sealed evidence,
and the production preservation proof recorded by the implementation owner.

The reviewer changed no implementation files, created no commits, performed no real sign-in or inference,
and took no installed-production action. This review artifact is the reviewer's only repository write.

## Findings and corrections rechecked

| Finding | Impact before correction | Rechecked correction |
| --- | --- | --- |
| Fresh-dispatch wrapper dropped Windows job containment | HIGH: stop and survivor verification could fall back to process samples rather than kernel job accounting | `spawnSession` now forwards dynamic containment, truthful pre-admission state, and input capability. |
| Direct Codex retained destination configuration; ordinary Claude settings could influence authentication | HIGH destination/billing boundary concern | All Codex dispatches exclude user configuration and extensions; ordinary Claude settings sources and hooks are excluded. API inference remains non-dispatching. |
| Permitted cross-vendor reroutes replaced the single account pin | HIGH: a return to an earlier vendor could adopt another account without an exact Task identity binding | `ApprovedRoute.destinationBindings` retain per-destination mode, fingerprint, epoch and consent revision; final dispatch compares the exact destination pin. The workstation approval card displays account/mode and alternate destinations. |
| Sign-in initiation and loss of verified native authentication did not invalidate active work | Authority revocation gap | Native sign-in emits revocation; loss of verified authentication increments epoch and emits revocation; transient unknown status preserves the earlier identity pin. |
| Async metadata/key operations could overwrite a later consent change | MEDIUM: a delayed check restored an earlier permission setting; current API modes have dispatch disabled | Epoch and consent revision are checked before outbound metadata use and before saving a result. Key-save also checks both. The reviewer reproduced the original stale-consent race using a memory-only database and fake transport, then verified that the corrected version preserves revoked consent. |
| Project-scoped routing omitted project IDs | Legitimately scoped connections could be excluded during candidate selection | Project IDs are propagated into routing pipeline calls. |
| `failover=ask` was displayed but ignored, then briefly applied to initial spawn | Recovery policy mismatch / initial-launch refusal | Recovery kinds enforce the policy; initial/final spawn checks use launch admission. |
| A native request counted against its own reservation | Request ceiling of one could refuse its first allowed request | Reservation occurs at fresh admission; the final environment check excludes only the exact pending reservation belonging to that Task. Independent memory-only probe: first admission allowed, own reservation allowed, competing admission denied. Ollama also uses the admission hook. |
| Sign-in used default discovery instead of the configured client path | Client/profile consistency gap | Connection registry receives the Host-owned configured discovery context. |
| OpenRouter catalog advertised an unavailable PKCE flow | Misleading capability description | API-key metadata support is described separately; OAuth is unsupported in this release. |

Relevant primary documentation checked for the configuration concerns:

- OpenAI configuration reference: https://learn.chatgpt.com/docs/config-file/config-reference
- Claude CLI reference: https://code.claude.com/docs/en/cli-reference
- Claude settings precedence/reload behavior: https://code.claude.com/docs/en/settings

## Final local stale-pairing recovery pass

- `src/lib/orch/host-bridge.server.ts`, `mayClearLocalPairing`: requires a `bunny_device` cookie, removes
  cookies from a cloned request, and calls the unchanged `authorizeBridge` using the actual request peer.
  Origin, cross-site, relay-header and loopback-peer checks still apply. The original cookie-bearing
  request remains refused for workstation access.
- `src/lib/orch/host.ts:62`, `clearStaleLocalPairing`: POST handler obtains its request in the server-function
  context, calls the same guard, and deletes only `bunny_device`. Its local HTTP expiration carries an empty
  value, `Path=/`, `HttpOnly`, `SameSite=Strict`, and `Max-Age=0`; it deliberately omits `Secure` so expiration
  works on the local HTTP browser. An explicit response header confirms expiration and `Cache-Control:
  no-store` is set. This issues no device credential and changes no remote credential cookie policy.
  A refusal returns `{ cleared: false }`. There is no Host credential lookup, Host request, device revocation,
  or command forwarding on this path.
- `src/routes/api/bunny-pair.ts`, DELETE fallback: the guarded local-cookie response returns before the
  existing credential lookup and device-revocation request. Its payload accurately reports
  `revoked: false` and `localPairingCleared: true`.
- `src/store/use-island.ts:1152`, `clearStalePairing`: clears the nonsecret local Host pin and reloads only
  after the server confirms `cleared`. Refused/error responses retain the pairing state.
- `src/store/use-island.ts:1114`, `signOutDevice`: returns on refused HTTP responses and transport failures,
  and now requires an explicit `signedOut` acknowledgment. Malformed JSON or an unacknowledged 2xx response
  cannot fabricate a successful sign-out transition. The earlier nonblocking robustness suggestion is resolved.
- `src/components/island/settings.tsx:87`: recovery button is shown only while offline on `127.0.0.1` or
  `localhost`; server-side checks remain the authority even if a caller invokes the function directly.

At the final executable pin, OpenRouter's mode explicitly describes manual API-key entry and non-inference
metadata checks; browser OAuth is unavailable and Task dispatch remains disabled
(`src/lib/bunny-host/connections.ts:602`). No privilege-boundary finding was identified in this final delta.

## Verification performed by this reviewer

| Check | Classification | Result |
| --- | --- | --- |
| Connection library and account view-model tests at the post-fix review snapshot | SIMULATED / STATIC VERIFIED | 26 tests passed. |
| Delayed metadata-consent response race | SIMULATED | Original race reproduced; corrected version retained `allowTasks: false`. Memory-only database, fake protector and fake response; no real credential or provider request. |
| Request reservation admission with ceiling one | SIMULATED | First admission and own pending reservation allowed; competing/new admission denied. |
| Initial independent Host HTTP test attempt | NOT TESTED in reviewer sandbox | Four tests stopped before assertions with loopback `connect EACCES`. This was an environment restriction, not an observed implementation assertion failure. The acceptance owner must supply successful authorized Host HTTP evidence. |
| Final `node --experimental-strip-types --test src/lib/orch/host-bridge.server.test.ts` at `60046c74a3dd903f026c9ac2b189524e5c732fe5` | SIMULATED / STATIC VERIFIED | 4 tests passed, 0 failed: local stale-cookie recovery, original-request denial, remote/unknown peer denial, wrong-origin denial, relayed-request denial, and existing bridge boundary checks. |
| New server-function cookie deletion and client transitions | STATIC VERIFIED | Guarded early return and acknowledgment-only state changes inspected. The reviewer did not independently operate the browser cookie recovery end to end. |

## Acceptance-owner status supplied during review

At the prior `60046c7` pin, the implementation owner reported passing typecheck, build and lint, 440 passing
script tests, passing exact-package DPAPI restart and 14 phone-denial checks, and preservation of 477
installed-production files. Library and Agent suites were still running at the time that status was supplied.
These are owner-reported results; the reviewer did not rerun the broader gates or independently recompute the
production comparison during this narrow follow-up. The final acceptance report and evidence seal must record
their completed results and source association.

At the final reviewed `2ea9bd497830334190c20fa2867363368d965ce4` pin, the owner reported the complete
account-security, actual Host HTTP and account-UI suite passing 41/41, alongside the earlier exact native
regression run passing 55/55. The final full suites and package gates are starting at this exact pin. These
owner-reported suite results close the reported focused-test follow-through; full release gates and the
reviewer's live/OS-level verification limitations remain separate and explicit.

## Baseline-test adaptation follow-up

The reviewer independently inspected `60046c7..62194f0`, which contains changes only to
`src/lib/bunny-host/execution-scope.test.ts`, `src/lib/bunny-host/codex-compatibility.test.ts`, and
`src/lib/bunny-missions/missions.test.ts`. No production implementation changed in this commit.

- Execution-scope assertions retain the original read-only/workspace-write distinctions, exact workspace,
  model and stdin tail, Windows sandbox configuration, prohibition of unsafe bypass flags, and an independent
  literal list of disabled tool-adding features. They add `model_provider="openai"` and apply configuration/
  extension isolation to direct Tasks as well as scoped Tasks. The exact scoped read/write vectors still
  independently constrain their complete argv.
- Compatibility coverage still verifies that an unscoped direct Task retains workspace-write authority even
  without a validated Mission compatibility profile; it now also checks provider pinning and configuration
  isolation while observing the disposable executable's actual argv.
- Mission assertions resolve the sandbox flag by its position instead of a stale absolute array index.
  Explicit `approval.kind === "user"` plus the provider binding strengthen the user-versus-delegated approval
  distinction, while existing approval journal, scope and Mission assertions remain in place.
- `fixture-codex@example.invalid` occurs only in the execution-scope test's disposable `missionFixture`.
  That fixture creates a local adapter instance targeting a temporary Node argv stand-in and overrides its
  detection/health/usage methods. The synthetic identity supplies the simulated principal needed by the real
  final binding gate. No production source imports this test or its fixture identity. It is SIMULATED evidence,
  with no real provider authentication or entitlement claim.
- Each of the four renamed tests in `baseline-retention-map.json` occurs exactly once under its old name in
  baseline `e449456` and exactly once under its new name in the current three source files. The rename mapping
  is one-to-one and the affected baseline cases are retained.

Resolved qualification: the first adaptation replaced exact independent direct-task vector equality with
selected semantic checks and the exact tail. The reviewer requested preservation of the closed argument
contract so an unexpected direct-only flag could not pass. The subsequent narrow diff independently restores
complete literal equality in both execution-scope and compatibility tests, alongside the strengthened
provider/configuration assertions. That regression-coverage qualification is resolved. The implementation
owner reported 55 targeted tests passing for the restored vectors; the reviewer inspected the complete
literals without repeating that broader targeted run.

Independent targeted rerun at `62194f0`:

```text
node --experimental-strip-types --test --test-concurrency=1 \
  src/lib/bunny-host/execution-scope.test.ts \
  src/lib/bunny-host/codex-compatibility.test.ts \
  src/lib/bunny-missions/missions.test.ts
100 tests; 94 passed; 6 failed in the reviewer's restricted Windows sandbox.
```

All revised/renamed cases passed. The six failures were unchanged baseline cases: four diagnostics explicitly
reported `EPERM` on temporary-file rename/symlink operations; two skill/capability completion cases timed out
in the same restricted run. Those timeouts were not independently resolved by the reviewer. The implementation
owner separately reported 100/100 passing for these complete files in its authorized test environment. The
reviewer preserves that distinction and does not label the restricted rerun fully passing. New complete
regression and package gates must be tied to the subsequent accepted test-source pin.

## Latest narrow account-limits review

The reviewer inspected the working-tree addition of native/local daily Task-start caps, native strict USD
ceilings, current-usage budget status, reconnect labels and account view-model coverage. Numeric inputs save
on blur only after browser validity and bounded numeric checks; the existing Host consent validator and final
dispatch gate remain authoritative. Blank values remove an optional ceiling. Reconnect/another-account labels
use the same provider-controlled sign-in action. The 3 account-model tests passed independently.

One MEDIUM projection consistency issue was identified and is resolved at final source `2ea9bd4`.
Initially, registry `deviceView` refused blocked eligibility while the actual paired-phone HTTP path's
manual mapping still projected `{ status: "budget_blocked", usableForTasks: true }`. The reviewer reproduced
that divergence through `deviceSnapshot` using a memory-only fixture and requested one shared predicate.

The correction exports pure `connectionDisplayEligibility` and an explicit `connectionDeviceView` redaction
from `connections.ts`. Registry/voice, actual `deviceSnapshot` and the account UI now use the same eligibility
rule. It refuses blocked display statuses, all unusable entitlement states including `billing_problem` and
`not_entitled`, missing cloud principal, invalid lifecycle/session and unavailable runtime. The device view
copies only catalog/name/mode/label/status/eligibility/billing/check-time fields; identity, workspace, credentials,
handles and authority bindings remain absent. Actual dispatch continues to require the separate Host gate.

The reviewer independently re-ran the actual `deviceSnapshot` function: budget-blocked rows now project
`usableForTasks: false`; `not_entitled`, `billing_problem`, `exhausted` and `rate_limited` also project false even
with a `connected` display status. The redaction check passed and an otherwise eligible native fixture still
projects true. All 3 account-model tests passed again. These are SIMULATED checks without network/provider use.
The updated Host HTTP test was inspected: it sets the owner's native cap to zero and asserts the paired-token
HTTP state reports both `budget_blocked` and false eligibility. The owner now reports its complete focused
HTTP/account/UI suite passing 41/41. No remaining issue was identified in this narrow projection correction;
the final reviewed source includes it, and package/full-regression results must be tied to that exact source.

## Limitations and evidence follow-through

1. Native provider sign-in, live inference entitlement, actual DPAPI restart behavior, WSL/profile boundaries,
   real device coverage and managed/custom-gateway setups were not live-tested by this reviewer. Keep these
   classifications explicit in the acceptance report.
2. OAuth/delegated flows, API inference and detect-only provider modes must retain their unsupported or
   non-dispatching descriptions. Successful metadata authentication does not establish inference entitlement.
3. Earlier review requested mandatory R07 evidence through the Jev-enabled actual Host advice path, rather
   than only forged request-body fields with Jev disabled. It also requested connection-usage retention,
   transactional rollback, persistence/restart, delayed credential-operation races, initial launch with
   `failover=ask`, and request-ceiling tests through the adapter admission wrapper. This final narrow pass
   does not independently attest the implementation owner's later additions or full-suite results.
4. A09 handler denial and redacted adapter snapshots do not by themselves prove that a same-profile native
   provider shell cannot read Host state and invoke CurrentUser DPAPI. DPAPI supplies at-rest/profile
   protection. OS-level process/filesystem isolation against that threat needs separate evidence or an
   explicit NOT TESTED limitation; no extraction attempt was performed.
5. Final source/evidence pins, full distinct regression count and retention mapping, exact-source Windows
   package/import closure, accessibility/browser evidence, evidence hashes and installed-production
   preservation are release evidence owned by the acceptance report. This review does not substitute for
   those gates.

## Final read-only evidence follow-through

Final source remains `2ea9bd497830334190c20fa2867363368d965ce4` (HEAD independently confirmed).
The reviewer read the final regression summary/inventory/retention map, original T13.1 inventory,
R4 package results/manifest, production-preservation record and final-source dev/built smoke logs.
No executable source changed and no Host, provider or installed-production action was launched.

- **Independent inventory reconciliation:** 2,364 unique suite/name keys, all recorded PASS. All 2,322
  baseline keys from `aa134f5efb6748f21ec9a5fe4eae83f4c2d8d86f` are present after the four previously
  reviewed one-to-one rename mappings; exactly 42 keys are new, matching the summary's new-case list.
  Recorded parts total 440 scripts + 1,501 library + 58 Agent + 365 UI = 2,364, with no missing baseline,
  skipped, cancelled or todo cases.
- **Recorded same-source gates:** final source/run marker and exits identify this pin and a clean tracked
  checkout at run start. Pretest, build, lint, typecheck and every suite exit zero. The preserved first library
  run records 1,500/1,501 passing with the single unchanged Chromium-network test failing in its `rmSync`
  teardown on a Windows temporary-directory cleanup lock. The complete library suite was rerun at the same
  pin and records 1,501/1,501 passing. No test assertion was removed or source change made for that retry.
- **R4 package:** `Bunny-A-Windows-MA3-T13-2-R4-TEST` manifest and tooling/source/dashboard provenance all
  name the final pin. The manifest has 485 files. The 175 Git comparisons comprise **167 source + 8 tooling**
  files. Results record no extra, missing, changed or mismatched files and a complete import closure.
  The reviewer independently recomputed the archive's size (180,755,442 bytes) and SHA-256, matching
  `ba0b0fd15102a2e32b356c2be7751c891da264d3b64be5f3b01d390189ef79d0`.
  Packaged disposable-Host evidence records 13/13 passing checks, zero provider inference/metadata/TypeSafe
  calls, and `installed: false` / `published: false`.
- **Preservation record:** before/after install, release-manifest and Startup hashes match. The recorded
  installed release is `Bunny-A-Windows-MA3-T13-FINAL-TEST`; its 477 files show no extra, missing or changed
  files, with `unchanged: true` and `installedOrRestarted: false`. The reviewer independently compared the
  recorded hashes, and did not recompute hashes from installed production itself.
- **Recorded final-source browser smoke:** dev and built output both report visible desktop/mobile content,
  HTTP 200, zero console/page errors, no horizontal overflow, and no auth/brand warnings. Built output reports
  `divergesFromBaseline: false` with no baseline reasons. The reviewer read these verdict logs and did not
  rerun browser operation or visual inspection during this evidence-only follow-through.

Evidence is internally consistent with the final reviewed source and retained baseline. This follow-through
independently verifies recorded counts, mappings, provenance fields and archive integrity; full-suite,
packaged-Host, browser and installed-preservation execution remain acceptance-owner gate evidence. The earlier
reviewer's restricted-run failures and live/OS-level NOT TESTED limitations remain documented, and no real
provider authentication or entitlement is inferred from these offline gates. All reviewed actionable findings
remain resolved. The review report is stable for evidence sealing.
