
# M-A-2 Gate T9 — review packet

Builder verdict **BUNNY_MA2_T9_PASS**, staged only (2026-10-06). This packet prepares
independent review; it does not claim another reviewer has already signed off. The complete
required report is [MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md](MA2_T9_APPROVAL_BATCHING_ACCEPTANCE.md).
The hashed evidence index is `test-results/ma2-gate9/evidence/index.json`. T10 remains open;
no T10 work or full operational verdict is included.

## Claims to re-derive

| Claim | Reviewer check / evidence |
|---|---|
| Existing authority vocabulary preserved | Read current-approval-model.md against abe993a. Compare unchanged permission decision branches and Allow once/skill-run behavior with focused/full regression. |
| No title-only desktop authority | Read batches.server.ts eligibility/digests, Bus post-preflight canonical revalidation and Computer Runtime package/native handle/start-time/control checks. Foreign title/identity refusal must happen before mutation; test assertions check zero execution and zero budget use. |
| Predictable profile | Only Calculator arithmetic operations, no arbitrary text or controls. Inspect concrete parameter allowlists and exact step digests; operations absent from the grant fail closed. |
| Finite canonical admission | Re-derive v20-journal.json counts from batch rows and consumption events; consumed precedes exhausted. E/F test count and Host time; retries/preflight races remain bounded. |
| Genuine installed positive | v20-B-live.json has actual Windows Runtime runs, result Display is 5, seven mutations, one READ, one permission request. v20-A-live.json uses seven Allow once prompts. |
| Scope escape | Live C/D/S/H records show second-app, destructive/sensitive and concurrent-Mission pauses without broader effect. Adversarial adapter cases are explicitly SIMULATED, not falsely live. |
| Stop ownership | v20-G2-live.json captured a running invocation before Stop; it settled cancelled/failed, futureAdmissions 0, canonical count 3 and unrelated work survives. No process-name kill exists. |
| Restart semantics | v20-R0/R1/R-live.json corroborate killed staged process with live credential/instance/executable/entry identity and a new Host boot. Old grant ends host_restart; approval-paused input stays paused, no GUI replay. Existing T3 executing-step recovery test remains unchanged. |
| Paired-device authority | v20-J-live.json: actual paired device bearer, same limits, oversized request clamped, createdBy device actor, explicit batch revoke and revoked device 401. No public tunnel/physical phone claim. |
| Privacy beyond visible text | v20-privacy.json scans full renderer snapshot and 13 mission detail responses as well as requests/runs/events/batches. Manager.view redacts typed input; Host store retains original input for explicit execution. Original canonical private input is not misrepresented as absent. |
| UI truth | Screenshots/card desktop/mobile/dedicated companion plus v20-ui-live.json: conservative first button, exact bounds, no external effects, 2/6 after reload, Stop ends grant. Independent verification remains separate. |
| Exact immutable build | Recompute v20-candidate-package.json ZIP/manifest/dashboard hashes and sidecar; source-check against 445beeb and tooling 824a553. 158 packaged/installed files match, no dirty source. Earlier candidates retained. |
| Production not activated | final-production.json: v17-T6 healthy/selected, 156 intact files, identical install/deployment/marker/credential hashes, no T9 table, computer runs/permission requests remain zero. No production process stop/install/migration or DB rollback. |
| Complete regression | t9-v20-full-sequential.log: all 247 script + 340 app tests pass; t9-v20-ui.log: 37 pass; no skip/deletion. Review default-run EPERM honestly rather than treating those logs as passes. |

## Findings resolved before final candidate

The resumed source admitted title-selected operations and only discovered drift after touching
the foreign target. Exact operation digests and verified Runtime preflight now reject before
admission; post-run PID checks are additional evidence. Arbitrary typing/controls were also
too broad for a predictable profile and are now excluded. The first tightened dialog check
rejected ordinary UWP frame/content Window descendants; v18 therefore failed the positive
live trial. v19 recognizes only those normal nonmodal windows while retaining unexpected
window/password checks. Final privacy review found original typed input in renderer mission
snapshots despite safe visible activity; v20 adds projection redaction and a whole-response
assertion without changing canonical execution inputs.

## Retained failure trail and limits

- Original v17/v18 design/acceptance and failed runs are historical, superseded records.
  The earlier post-run-only application guarantee is not the accepted contract.
- Initial restart harness mixed Windows PowerShell module environments and blocking child
  handles, then incorrectly expected an interrupted marker on an already approval-paused
  step. The explicit launcher/recovery controller proves the real T3 contract; no product
  recovery behavior was changed to satisfy the incorrect harness.
- The initial in-flight Stop plan exceeded the existing 12-step ceiling. The Host refused it;
  the corrected test uses twelve steps and passes without increasing the limit.
- Two v20 default test-file runs hit Windows EPERM deleting a T4 temporary fixture after its
  ownership checks. The unchanged isolated fixture and complete unchanged sequential
  inventory pass. This low test-harness cleanup limitation is documented, not hidden.
- Generic preview had no installed Host bridge and diverged from dev text. Exact installed
  v20 dashboard QA is the authoritative build render, with zero console/page errors.
- Windows/UIA checks are repeated immediately before operations, not an atomic desktop lock.
  Physical phone/tunnel, localized/multi-monitor surfaces, real UAC/purchase/file-picker
  dialogs, privileged OS attacks and live provider/vision reroutes are NOT TESTED.
- Production activation is deferred until explicit authorization and fresh backup. Existing
  T8 rollback remains; no broad preference, OD-1/OCT-1 redesign or T10 feature/audit was begun.

## Candidate and verdict

Candidate Bunny-A-Windows-v20-T9, source `445beebf8c9d951066dd0bddb1b066820762a912`,
tooling `824a5531ff6c04936f9511ba63c1120e65695d42`; identities and full hashes are in the
acceptance report and v20-candidate-package.json. **BUNNY_MA2_T9_PASS**; no unresolved
BLOCKER/HIGH. Production stays **Bunny-A-Windows-v17-T6**. **NEXT = T10, not begun.**
