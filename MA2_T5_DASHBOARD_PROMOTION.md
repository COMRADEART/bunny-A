# M-A-2 Gate T5

**BUNNY_MA2_T5_PASS.** The proper Windows application now serves the current T5
dashboard and Host from the same pinned source. Activation followed candidate acceptance,
a verified backup, and the user's explicit instruction: “Activate after all required
checks pass.” T6–T10 remain open; this report issues only a T5 verdict.

Starting branch: `ma2-operational-hardening`. Starting HEAD:
`53120f3f81bf762f45f242f05838ff8262087988`. Status, branch, HEAD and the preceding
25 commits are preserved in `test-results/ma2-gate5/baseline-*.txt`.
Accepted T4 source: `21684ff60ee53e07937194838f1356a18ac158f5`; tooling:
`2e8a21cb3168d08ed1adb08544149d3f33ed05af`. Its actual floor was **547 tests**
(240 script, 286 application, 21 UI). T5 passes **585** (240 + 311 + 34), adding 38.

## IMPLEMENTED

The Host remains authoritative. A shared read-only presentation module projects the
existing journal, capability records and canonical snapshots; there is no second activity
store, scheduler or authorization system. Provider turn, Task, capability, Mission step
and independent verification have distinct states. Provider completion cannot fabricate
verification. Produced artifacts remain separate from verified artifacts. Completed Tasks
retain their historical timeline without a stale active “Bunny verifying” ribbon.

Capability requests and runs share stable logical activity IDs where appropriate.
Journal sequence deduplication, snapshot revisions and Host instance IDs reject stale
updates. Reconnect and retention gaps refresh canonical state and reconcile capability
rows. Logical worker roles survive provider rerouting. The compact Mission strip shows
three roles plus overflow, and completion collapses. Task and Mission composer modes
remain available. Progress uses known finite steps only.

Dashboard, phone and native Island show safe status summaries. Public projection defaults
to allowlisted labels; private reasoning, provider transcripts, typed credentials, cookies,
tokens, raw capability parameters, secret-bearing commands and internal diagnostic errors
are withheld. Approval cards show existing scope and risk; authorization still uses the
existing authenticated Host command. Codex details distinguish installed, authenticated,
direct-task ready and Mission validated/restricted. Degraded Host and interrupted recovery
states are visible; a fresh retry does not claim the old session resumed.

The package binds Host source, dashboard source, build timestamp, manifest and asset
inventory. Gateway health and Settings expose installed provenance. Production serves
immutable installed assets rather than the development checkout. Native Island changes
are limited to safe presentation and status; existing themes, motion and visual language
remain in place.

## LIVE VERIFIED

Evidence is preserved under `test-results/ma2-gate5/`. The final immutable package passed
manifest, import-closure and source-blob verification before activation. A disposable
production DB snapshot, separate workspace, token, Host and gateway exercised the packaged
runtime. Test Hosts were closed after testing; production was not used for Git/crash tests.

| Check | Actual evidence |
| --- | --- |
| Regression and builds | `full-tests-final.log`, `ui-tests-final.log`: 585 passed, none removed; `typecheck-task-ribbon-final.log`, `lint-final.log` (0 errors, 10 existing warnings), `normal-build-final.log`, `windows-desktop-build-promotion.log` passed |
| Real direct Task | `ui-live-proof.json`: Task `173b37d5-4401-4e01-b0b4-138e67d0fc30` completed with independent file verification using a harmless local Node adapter |
| Real Mission and approval | Mission `e3dc8673-719b-4be2-a31e-39a9cf9c6b79` approved through the UI and completed 6/6 deterministic read steps; UI reports 0 independently verified steps |
| Phone Stop | `ui-stop-action.json`, `ui-live-proof.json`: UI Stop produced canonical stopped Task `00c51e3b-c88a-4543-a793-cfe375e826a9` |
| Packaged browser views | `screenshots/promotion-dark.json`, `promotion-light.json` and four PNGs: desktop 1280×800 and mobile 390×844, no console/page errors or horizontal overflow; inspected contrast, worker strip, navigation and approval presentation |
| Accessibility, motion and terminal state | `ui-accessibility-motion.json`, `ui-task-terminal-proof.json`: visible keyboard focus, Task/Mission switch, full/reduced/off preferences, completed verified Task without an active ribbon |
| Privacy and health | `ui-privacy-health.json`: rendered secret fixtures hidden, verification failure distinct, actual disposable Host browser degradation visible |
| Codex compatibility | `ui-provider-compatibility.json`: actual 0.153.4 profile visible; simulated future 99.0.0 restricted for Missions with direct readiness and reason shown |
| Native Island | `native-*-promotion.json` and `screenshots/native/`: real packaged WPF renders for idle, Task running, Mission/Task approval, verifying, completed, failed, verification failed, interrupted and degraded states; terminal light theme inspected |
| T3 preservation | `candidate-fatal.json`: exact packaged Host controlled fatal exit 70 in 3022 ms, owned tree terminated, unrelated process preserved, honest interruption after restart |
| T4 preservation | `t4-preservation/packaged/result.json`: all 18 live Windows gates passed, including alternate launchers, hooks/detached attempts, Stop isolation, timeout/output, merge cleanup, pre-existing merge and hard/fatal Host crashes |
| Production promotion | `laptop-activation.json`: authorized activation at 2026-10-04T22:28:52.7183939Z after candidate acceptance and backup |
| Live production identity | `production-smoke.json`: installed Host/dashboard source and manifest match, 10 served JS/CSS hashes match the manifest, full 21-file dashboard inventory verified |
| Live production UI and Island | `production-ui-identity.json`, `screenshots/production-identity.png`, four production dark/light desktop/mobile PNGs and JSON verdicts; `native-installed.json` verifies proper EXE readiness and installed-script WPF render against the real Host |

Production remains healthy with **54 Tasks, 13 projects and 9 historical devices**.
All pre-existing Task, Mission, project, device, approval and other protected rows remain
unchanged. Only normal Host journal/discovery telemetry advances. Missions and triggers
remain OFF. State remains `%LOCALAPPDATA%/Bunny-A/state`, SQLite schema 3, outside Git;
workspace remains `C:/Users/allam/Bunny-Workspace`. T1 migration journal/report/cutover
hashes, cloudflared location/hash and the proper native EXE hash remain unchanged.
No public tunnel was started and no paid provider turn was used.

Windows independently restarted after activation. `post-activation-restart.json` records
the later boot and fresh executable paths, creation times and parentage. The final live
application/Host/gateway are PIDs 21224/22184/22060, Host instance
`046c323b-5e58-45e9-9922-bdc53d2d0c78`; these are observations, not durable kill authority.
The original activation record remains historical and is not rewritten as a new activation.

The personal Codex configuration checksum changed after activation and the later boot
(last write 2026-10-05T01:52:47.3629616Z). It was left as found. T5 did not write that
file. `codex-config-observation.json` records safe keys and hashes; `production-smoke.json`
confirms unchanged Mission isolation using `--ignore-user-config`/`--ignore-rules` and
the actual CLI 0.153.4 still validated under `ma1-windows-0.153.4-policy1`. This is not
reported as an unchanged personal configuration checksum.

## SIMULATED

Unit fixtures test provider completion before verification, verification failure after
completion, capability correlation/denial, interruption, provider reroute, duplicate and
late events, retention gap/resync, secret-bearing fields, private reasoning, artifacts,
unknown Codex versions and no fake progress. Tests inspect actual exported public
projection objects, not only generic key-name redaction.

Additional canonical DB fixtures render approval, verifying, failed, unverified completion
and interrupted states in the real packaged browser/WPF runtime. Future Codex metadata is
simulated; the installed CLI was not replaced. The local Node adapter exercises real
Task execution and independent verification without making a paid model request.
Screenshot acceptance is the implementing agent's visual review, not independent review.

## STATIC VERIFIED

TaskManager, MissionManager, provider compatibility policy, T3 failure containment and T4
ownership/native source match the accepted starting line. The unchanged packaged T4 helper
SHA-256 is `1f1e8e28d80ed346602d0d0e227bf465187750eea6c6513f077634e013761e2b`.
`candidate-acceptance.json` records preserved source hashes and all prerequisite checks;
`production-smoke.json` verifies 156 installed manifest entries and 76 source blobs.
Rollback backup inventory and both existing Windows shortcut targets are verified.
`rollback-laptop.ps1` parses and requires fresh live process identity before a scoped stop.

## NOT TESTED

Physical phone/public tunnel transport acceptance belongs to T6. Local phone rendering
does not establish remote connectivity; UI reports Remote unavailable. Paid provider
model turns, production Git/crash testing, physical OS reduced-motion toggling and
non-Windows native Island rendering were not performed. Production rollback has not
been executed; preparation and integrity checks are verified.

The normal Vercel/Nitro build succeeds and renders, but its existing request adapter does
not retain the trusted TCP peer needed for workstation authentication. It truthfully shows
Offline rather than weakening authentication. This adapter is not used by the installed
Windows gateway, which passes the trusted peer and passes live online dashboard tests.
T5 does not accept that adapter as a production remote transport.

## BLOCKED

None within the completed Windows T5 scope. No unresolved BLOCKER/HIGH remains in that
scope. Candidate staging, activation and live production verification are complete.

## DEFERRED

T6–T10 and the full independent operational review remain open. No takeover/handback,
persistent agent computer, new unattended authority, approval batching or skill-publication
claims were added. No full M-A-2 operational verdict is issued.

## OD-1 presentation lessons used

Used only stable activity identity, clearer tool/capability states, provider turn versus
Task versus verification distinction, reconnect/resync discipline and privacy-safe
projection. Bunny's Host events remain canonical.

Not implemented: AgentWorkspace, persistent per-agent browser/workspace, derived
credentials, takeover/handback, capability revocation revisions, published-skill lifecycle,
Slack/calls or AG-UI core protocol. OpenDots, OpenBot and CopilotKit were not imported.

## Rollback state

The measured pre-T5 installation was **Bunny-A-Windows-v17-T3**, not v10; its source is
`d2088ae9e9121310c54aa58d231a8804075fc41f`. T4 had been accepted as a staged candidate.
Both the v10 directory and immutable pre-T5 T3 release remain available. T5 now serves its
own current dashboard; production no longer depends on either older dashboard directory.

Before activation, a consistent SQLite backup (integrity OK, schema 3), configuration,
state and both existing Start Menu/Startup EXE shortcuts were saved with a 67-file
hash inventory in:

`C:/Users/allam/AppData/Local/Bunny-A/backups/t5-dashboard-promotion-2026-10-04T22-28-04-212Z-401a7f75`

Use the prepared `test-results/ma2-gate5/rollback-laptop.ps1` only for an explicitly
requested rollback. It checks the exact current T5 manifest, backup hashes, old manifest,
idle work and fresh process identities, then restores prior configuration/shortcuts and
starts the proper EXE. It never reconstructs authority from saved PIDs, kills by executable
name, uses Git checkout, or automatically overwrites the live database. The database
snapshot is retained for explicit recovery if necessary. No Desktop shortcut existed at
baseline, so none was invented.

## Candidate identity

| Field | Final immutable value |
| --- | --- |
| Release / version | `Bunny-A-Windows-v17-T5` / `17.0.0-T5` |
| Host and dashboard source SHA | `eb96c053c238ec0bd385187e0f4dad6777a0a4bc` |
| Build tooling SHA | `ec81f9b9dbab4236b735f917a89cf3e8393024f4` |
| Dashboard build UTC | `2026-10-04T22:10:56.3809357Z` |
| Package SHA-256 | `fe07fd6f8c3415d38e202a73b3c2ebbed8022f1e48cc1c813c92ab15c83cadb1` |
| Manifest SHA-256 | `f0531f8d2a02ed3302c3b4ade5e28859e39ec1dba380cf3f8596866ac4a18a4e` |
| Dashboard asset inventory SHA-256 | `c78fc00a559726ed8f2c513319f28df541f260883b41959fcda055210312656d` |
| Dashboard inventory | 21 files; 10 served JS/CSS assets also checked over HTTP |
| Installed release | `C:/Users/allam/AppData/Local/Bunny-A/releases/Bunny-A-Windows-v17-T5` |
| Preserved package | `test-results/ma2-gate5/candidate-promotion/Bunny-A-Windows-v17-T5.zip` |

`candidate-acceptance.json` records the accepted staged state before activation.
`laptop-activation.json` records the actual promotion. `result.json` and
`production-smoke.json` record the completed gate and live production state. A later
documentation-only commit does not alter these immutable package identities.
