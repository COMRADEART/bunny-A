
# M-A-2 Gate T9 — current staged acceptance

**BUNNY_MA2_T9_PASS (2026-10-06).** Full report:
[MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md](MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md).
Evidence: `test-results/ma2-gate9/evidence/index.json`. Production remains the accepted
**Bunny-A-Windows-v17-T6**; T9 is installed only in the disposable staged root. T10 remains
open and was not started. No full M-A-2 operational verdict is issued.

| T9 check | Result | Classification / evidence |
|---|---|---|
| Explicit Calculator workflow | Result 5; seven mutations + one free result read; prompts 7 → 1 | LIVE VERIFIED, v20-A/B-live.json |
| App/risk/sensitive boundary | Other application, destructive filesystem probe and typing ask; no broader mutation | LIVE VERIFIED, v20-C/D/S-live.json |
| Exact operations and pre-admission identity | Concrete step/digest, envelope and Microsoft Calculator package/window/process lifetime; no title-only authority | IMPLEMENTED + SIMULATED, 26 focused tests |
| Bounds | Two-slot test stops at two; one-second TTL expires on Host time | LIVE VERIFIED, v20-E/F-live.json |
| Task/Mission isolation | Concurrent unrelated mission does not inherit authority | LIVE VERIFIED, v20-H-live.json |
| Stop and restart | Running owned invocation aborted, no future admissions, unrelated mission survives; restart clears grant, no GUI replay; old approval refuses | LIVE VERIFIED, v20-G/G2/R-live.json |
| UI and companion | Allow once primary; exact bounds; canonical 2/6 after reload; UI Stop ends grant | LIVE VERIFIED, v20-ui-live.json and screenshots |
| Paired-device authority | Same envelope/limits; clamping, actor, explicit revoke and revoked-token refusal | LIVE VERIFIED over loopback, v20-J-live.json; physical phone/tunnel NOT TESTED |
| Privacy | Renderer/detail inputs redacted; journal/run/request/batch scans clear; private Host execution input preserved | LIVE VERIFIED + SIMULATED, v20-privacy.json |
| Regression | 624 = 247 script + 340 app + 37 UI pass, no skipped/deleted tests; typecheck/build/lint pass (11 existing lint warnings) | STATIC VERIFIED, t9-v20-full-sequential.log and related logs |
| Production preservation | 156/156 installed files; protected config/credential hashes identical; no T9 schema or desktop-approval writes; state/workspace outside Git unchanged | LIVE VERIFIED read-only, final-production.json |

Final candidate **Bunny-A-Windows-v20-T9**, source
`445beebf8c9d951066dd0bddb1b066820762a912`, tooling
`824a5531ff6c04936f9511ba63c1120e65695d42`. ZIP SHA-256
`3fdbad67b21ed9bccbabad514756f0d0cb9ca8363c00f38bb61850c29b922a44`;
manifest `92c60012cca09d95f1c85b7a2373caf52297fc7cc3a50c30a3d49b979e44148a`;
dashboard assets `93183a204a27a0ecec1f4f34444231039d9c1512efc7390f02271ca31ce95171`.
Exact committed archive and installed-copy verification are in v20-candidate-package.json.
All earlier candidates remain immutable.

Prompt reduction is 85.7%; observed automated elapsed time was 8,143 ms for Allow once
versus 15,836 ms for batching. Package/window checks add overhead; no speed gain is claimed.
Two default concurrent test runs hit an existing T4 temporary cleanup EPERM after ownership
assertions passed. Its unchanged isolated test and the unchanged complete sequential inventory
pass. No assertion was weakened. This low harness limitation is retained in the failure ledger.
No unresolved BLOCKER/HIGH. Activation, physical phone, real dialogs/vision/provider reroute
and broader desktop profiles are not claimed; activation requires separate authorization/backup.
