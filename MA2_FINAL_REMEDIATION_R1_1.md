# M-A-2 Final Remediation R1.1

**BUNNY_MA2_FINAL_REMEDIATION_R1_1_PASS.** The narrow external Windows console-support classification repair allowed the already-authorized activation to proceed. Actual production now operates the exact unchanged **Bunny-A-Windows-v26-MA2-R1** candidate. Required production acceptance passed, original protected history/settings/devices and Phone are preserved, QA identities are revoked and cleanup leaves no unexplained Calculator or QA runtime. This is an implementer remediation result; a fresh independent reviewer/session must assess the deployed system before an operational verdict.

Evidence is under [test-results/ma2-final-remediation-r1-1](test-results/ma2-final-remediation-r1-1/). The hashed index is [evidence/index.json](test-results/ma2-final-remediation-r1-1/evidence/index.json). Classifications distinguish real production, real disposable Windows behavior, static exact-byte verification and simulated adversarial reuse/path/signer facts. No physical Phone interaction, dangerous real OS PID reuse, real rollback, sign-out or reboot is claimed.

## Exact candidate and correction boundary

| Identity | Value |
|---|---|
| Release | Bunny-A-Windows-v26-MA2-R1 |
| Version | 26.0.0-MA2-R1 |
| Runtime source | `8001d51d871f12c15b8de03005a40e9d4c3fd8c2` |
| Packaged tooling | `0d3f96db093b2106ebab90e0249ae7b1e711aee9` |
| Manifest SHA-256 | `06836b4847824edcbfa4c1628b4e0106c5ccded24a8d9361355003f467339e54` |
| ZIP SHA-256 | `3e68faed3e1d9ae75d1d3f2140c831e8843fc914ea7dc179e78c81445f7fbac3` |
| External classifier/preparatory commit | `1b5c9c3d6c90e04d09cc0a8dbb3da484d82f0962` |
| Previous authorized failed attempt | `4a4f41010828d0f1feca4aad40c2b8bc1b0ded65` |

The defect was in external promotion preflight, not candidate runtime or packaged installer. `console-ownership.ps1` and its consuming external promotion controller were corrected. No manifest-covered candidate byte changed, so no new package or identity was minted. All 160 covered files, 80 source/tooling Git blobs, installed bytes, ZIP identity and import closure verify. The original package audit records 161 ZIP files plus four directories. The one existing test-only change recognizes the already-pinned `-MA2-R1` release-name suffix; it retains numeric version and all security checks and is not packaged. See `controller-fix.json`, `package-validation.json` and `package-final-validation.json`.

The native root bootstrap remains SHA-256 `a2ac666fc9c3a32dc6918bc89b78dfe7c7a8d59eeff17616acf8d25ed41ee102`. Its generic assembly version is not the loaded release identity: the application reads current selection and reports the exact v26 Source/manifest in `production-identity.json` and `final-production.json`. Cloudflared remains `f096265ec2fcbe9bb6e2d64268db167ced3fcbb83d894bdb9e2fcdb26f2ea7e2`.

## Preserved failures and actual Windows lineage

The first R1 authorized activation correctly refused before Stop/selection. Its preflight refusal, diagnosis, ownership log, verdict, report and complete evidence root are retained unchanged. `previous-refusal-reference.json` records paths/hashes and the old commit. The earlier independent FAIL review also remains byte-identical, SHA-256 `2ac061dda6f07d86236c1c648ec738d363cb9b701e148b17c7755d5653f57d3a`. R1.1 does not erase either failure.

Before editing the classifier, `conhost-lineage.json` reconstructed all four actual refused lifetimes using fresh CIM and held native handles:

| Historical child | Corroborated role/parent | Birth delay | Current kernel association at reconstruction |
|---|---|---:|---|
| 46240 | Host / 35792 | 9.045 ms | held parent reports this console host |
| 16188 | Gateway / 17040 | 15.025 ms | held parent reports this console host |
| 24472 | Tunnel worker / 45724 | 12.594 ms | held parent reports this console host |
| 9152 | Cloudflared / 25956 | 19.240 ms | held parent reports this console host |

These numbers are historical evidence, never future Stop authority. Each child was exact System32 `conhost.exe`, Valid Microsoft Windows signer, same SID/session, after the freshly held parent, with current parent/child image and birth corroboration. Command lines, parent births, grandparent relation, owner/session and actual console query are recorded. The native GUI bootstrap has no console support; the four console clients launched hidden by the canonical launcher each have one. A hidden console differs from creation without a console. Primary references and the internal-query qualification are in [windows-console-model.md](test-results/ma2-final-remediation-r1-1/windows-console-model.md).

## Narrow rule, ownership and adversarial proof

The shared external classifier requires two full fresh process inventories; exact current parent/child PID and held birth/image; proven canonical parent role; child after parent within five seconds of the observed launch shape; same owner SID/session; exact System32 image; Valid exact Microsoft Windows signer; and the current `NtQueryInformationProcess(ProcessConsoleHostProcess, 49)` association obtained from the held parent. The internal diagnostic query is not a promised portable Win32 contract. Unavailable or changed query behavior fails closed, with no weaker fallback.

Any unknown child, deeper descendant, topology change, identity change or parent exit refuses the boundary. Support handles are observational and confer **no direct kill authority**. Only the separately proven canonical role lifetimes are stopped, after fresh identity inspection immediately before each held-handle Stop. Support must exit naturally before selection. The classifier contains no kill method, and the active runtime/controller/installer broad-kill audit has zero executable-name/console-special termination findings.

Focused tests cover all requested name/path/signer, foreign-parent, earlier-birth, parent/child reuse, inspection failure, session/SID and query negatives. **18 facts tests pass, zero skips/failures.** PID reuse and forged signer/path variations are faithful synthetic facts through the identical rule; an actual dangerous reuse event was not attempted.

The disposable Windows topology uses four actual hidden console Node role processes plus a real GUI-subsystem bootstrap fixture. The exact classifier accepts five roles and four real kernel-associated console hosts. Held fresh parent Stop causes natural support exit and preserves an unrelated sentinel. A real parent-exit race refuses historical reconstruction. An actual foreign Node descendant is refused and preserved, with sentinel survival. Service protocols are not implemented in this disposable topology; fresh production preflight separately validates the actual credential/health/application/transport anchors. See `positive-conhost-test.json`, `foreign-conhost-negative.json`, `parent-exit-race.json`, `pid-reuse-negative.json` and `stage-preflight.json`. These correction tests preceded production Stop; immutable R1 exact-candidate stage acceptance remains historical corroboration.

## Full regression

| Gate | Final executed result |
|---|---|
| Full npm scripts | 254 pass |
| Full app tests | 373 pass |
| UI tests | 37 pass |
| Combined full regression | **664 pass; zero failures, skips or cancellations** |
| R1.1 classifier facts | 18 pass; simulated adversarial facts |
| IR-H1 plus T4 ownership focus | 35 pass |
| Exact installed IR-H1 manager/native fixture | 10 pass |
| Typecheck | PASS |
| Lint | PASS; eleven existing warnings, zero errors |
| Normal build | PASS |
| Windows package/deployment tests | PASS within scripts suite; unchanged package verified independently |

Focused/installed counts are reruns and are not added to 664. No existing security tests were deleted, skipped or weakened. Final logs and exit files are indexed. The initial release-label regex failure is retained. No extra package rebuild was needed because candidate bytes were unchanged.

## Fresh authorized activation

The direct human authorization pins the exact candidate and bounded acceptance. R1.1 explicitly continues that authorization for the external preflight correction. `authorization.json` records both. No new authorization was required, no unrelated destructive action was introduced and Git was not used for runtime deployment.

Fresh installed canonical preflight verified idle Tasks/Missions/runs/grants, database integrity, protected history, original devices/Phone, original settings, Mission/Trigger configuration, Startup and current release. It created a private WAL-consistent backup with read-only SQLite `VACUUM INTO`: `before-activation-1791393044893.sqlite`, 1,060,864 bytes, SHA-256 `6a201c3881709f4f1708c0e34e1af0d67f70107c5c0696681ff0b8d77d15c516`, integrity `ok`. Raw databases stay outside Git/evidence in canonical private backup storage. Device secrets stayed in memory; evidence contains fingerprints only.

The corrected production controller freshly corroborated all five real roles and four support lifetimes, independently inspected the current tree, checked competing launcher/migration absence, and repeated canonical idle/topology inspection immediately before Stop. A held startup/selection inhibit prevented competing launch. Every canonical Stop used a fresh CIM comparison against the already-held lifetime. All four support processes exited naturally. The exact pinned installer staged/selected code according to the existing contract; final selection used the pinned canonical `Write-BunnyJson`/`File.Replace` writer. Canonical state, workspace, consent, tools metadata and root native startup were preserved. No historical bare-PID controller or manual-copy runtime deployment was used. `selection.json` and `activation-selection-boundary.json` preserve the raw successful selection boundary; `activation.json` records completed boot/acceptance.

Native Startup boot loaded actual v26 app/gateway/Host Source, then the installed launcher brought up the consented production tunnel. Immediate identity validates exact release/version/source/tooling/manifest, current Host birth/instance, all five roles, four narrowly proven support descendants and native Startup. The controlled restart later changed only Host instance. At final identity the healthy Host is PID **41876**, instance **63418ecd-1aa9-40f1-ad79-e56c995f38bf**; all current births, executable paths, role identities and transport are in `final-production.json`. These are timestamped observations and must never be reused as future termination authority. Startup targets root `Bunny-A.exe` with empty arguments and canonical working directory, SHA-256 `2623a0b2371456981009cec369eeb9145d1a47ab9d33c2437c41fef3ded34ca8`.

## Production acceptance

| Required behavior | Actual production result | Evidence |
|---|---|---|
| SSE revocation | Dedicated authorized stream opened; revocation closed it; later harmless protected event delivered zero future protected bytes; protected read/command/reconnect return 401; workstation positive survives | `production-sse.json` |
| Canonical rollback guard | Installed tooling refuses actual active canonical Mission/grant even while Missions/Triggers OFF; production and private selection fixture/Host unchanged | `production-rollback-guard.json`, `rollback-guard-census.json` |
| Restart invalidation | Fresh held Host Stop with natural console exit; installed restart; old batch absent and old request IDs denied; waiting user recovery; run count remains 1 → 1; no GUI replay | `production-restart-approval.json` |
| T9 bounded batch | Explicit small batch, finite budget/expiry, exhausted budget requires fresh approval, expiry requires retry/approval, Stop prevents future admission and preserves unrelated Mission | `production-t9.json`, `finite-time-stage.json` |
| Scope boundaries | Computer batch cannot approve browser mutation; PowerShell acquisition is separate, never executed; remote QA revoke denies fresh remote authority | `browser-scope.json`, `native-matrix-v26.json` |
| T9R lifecycle | Five repeat acquires, concurrent same-Mission acquires, actual postcondition retry, focus loss, explicit approval refresh and real UI reload preserve sole target/value with zero extra launches | `production-t9r.json` |
| IR-H1 installed bytes/Stop | Ten tests target exact installed manager/native implementation; real harmless owned Stop positive, adversarial reuse intercepted/simulated, stale/unavailable identity reduces authority | `production-ir-h1.json`, `installed-irh1.log` |

Rollback acceptance is safe no-mutation testing: disposable selection/Startup metadata points to actual canonical production authority. A bug would affect only the private selection fixture. The guard refused before either selection changed; this is not an actual rollback or a certification of old native-bootstrap rollback metadata. Restart authority census proved zero active Tasks/in-flight runs and exactly one owned waiting approval fixture before held Host Stop. Other production roles and unrelated development processes were not stopped.

T9 shell qualification is explicit: live out-of-scope PowerShell application acquisition and browser mutation require separate unapproved requests; no shell command or browser mutation was executed. Exact installed batch-family isolation is also covered by the full regression. The sole Calculator fixture was newly acquired after initial inventory zero and has explicit capability-run provenance. Follow-up workflows treat it as pre-existing, preserve its native frame/content lifetimes and value, and create zero additional targets. Focus recovery requires explicit fresh approval; no forced foreground attachment was used.

The real installed dashboard renders visible content at desktop and 390×844 mobile with no console/runtime errors or horizontal overflow. Actual Edge reload preserves run count, grant ID/used count and target identity. Four screenshots were visually inspected and copied into evidence. Repository agent-browser had failed in both retained R1 attempts; CUA/native kernels were unavailable. Repository-permitted Playwright fallback used installed Microsoft Edge because bundled Chromium is absent. No screenshot exposes a token, cookie, pairing code or provider key. Existing plain dashboard branding produces an informational placeholder note, not a new UI/product change.

## State and Phone preservation

Immediate comparison has zero missing/changed protected historical rows and only three appended telemetry events plus the new empty approval-batch table. Final comparison again has **zero missing/changed historical protected rows**, all **16 original device rows byte-digest identical**, all original settings identical and the sole active **Phone companion preserved**. Two new QA devices are revoked; there are 18 device records total, one original Phone active and seventeen revoked. Physical Phone interaction is not claimed.

Final snapshot enumerates 1,624 appended rows: 43 capability runs, two devices, 1,246 events, 110 inbox events, one migration, 18 Mission authorizations, 34 dependencies, 50 Mission memory rows, 52 steps, 16 Missions, 34 permission requests, 17 settings and one stopped harmless Task. The new approval-batch table contains 19 acceptance records. All 17 new setting keys are Calculator execution identities for the exact owned target, correlated to explicit Mission/run provenance; they are never grants. They remain as auditable acceptance history. Original `active_policy` and `missions_config` hashes match exactly. `workspace_locks` and documented provider/secret volatile fields use the established protected-row digest exclusions; no blanket exclusion of historical settings/device/history rows was introduced.

All existing Tasks, projects, skills, Missions, steps, authorizations, capabilities, Triggers and their protected rows were compared through the table ledger. Canonical external state root, workspace and Host port are preserved. Test barrier files were removed only with matching authored content/provenance. Consistent private immediate/final backups and full appended-row fingerprints are in `production-preservation-immediate.json` and `production-preservation-final.json`; `production-preservation.json` summarizes them. Normal telemetry can continue after a snapshot.

## Operational pointer and cleanup

Canonical `%LOCALAPPDATA%\Bunny-A\state\operations\current.json` now identifies the exact installed guarded installer/preflight/IR-H1 modules and exported external R1.1 classifier plus read-only identity controller/procedure. All export/installed hashes and every retained historical guide hash verify. The exported controller was actually executed against healthy exact production. Code export and pointer use ordinary file artifacts plus canonical atomic writer, not Git deployment.

The old gate8 bare-PID/manual-copy controller and every retained rollback guide, including the new installer-generated rollback guide, are explicitly classified **HISTORICAL — NOT VALID FOR CURRENT PROMOTION/ROLLBACK ACCEPTANCE** in the pointer/procedure. Their bytes are retained. The R1.1 successful v17→v26 promotion script is a bounded historical transaction with the old-release gate intact, not a generic future controller. Current identity output is evidence only; future Stop requires entirely fresh held authority. Real rollback needs separate authorization and validated compatible prior selection/Startup, canonical idle and backups; old native-bootstrap shortcut metadata is not claimed to satisfy the installed PowerShell-shortcut guard.

Final cleanup proves zero stage Host/QA gateway listeners, zero temporary fixture/cloudflared processes, zero active QA Mission/grant/pending approval and all QA identities revoked. Exactly one explicitly owned Calculator window was closed through its freshly verified UI Automation window pattern, trusted package, frame/content birth and held handles. Content exited naturally; shared ApplicationFrameHost survived. Final Calculator inventory is **zero**. Original Missions and Triggers are OFF again via canonical API, and the installed final canonical preflight confirms idle.

The original separate source development Host on port 43139 remains healthy with original instance `86a8abb0-f9c1-40a9-9f2d-90a1289f150a`; fresh owner/session/image/birth and credential/health corroboration are recorded in `development-host.json`. Its original human intent/exact running cwd remain qualified. It was not treated as stale QA or a second production singleton.

## Retained harness limitations and seal

`failure-ledger.json` retains resolved failures: decimal-vs-lexical birth comparison, nested PowerShell support-array output, immutable release-label test regex, native output-EOF outer shell waits during boot/restart, missing bundled Chromium, changed planned focus offer, one-action batch assumption, appended target settings and two wrong external pointer module paths. Each has raw evidence and a concrete passing correction. No production guard was disabled, no old PID substituted and no dangerous OS reuse attempted. Both completed outer harness shells were individually freshly held and stopped only after launcher completion/current healthy production were proven; no tree termination or production role Stop was added. Restart verification ran separately afterward.

The secret audit scans all R1.1 evidence and four reports against current known Host/environment credentials plus literal bearer/cookie/private-key/provider-key patterns and credential-bearing JSON. Raw SQLite and credential stores are excluded. Binary fixture and screenshots have explicit classifications; screenshots were visually inspected. The index records every evidence file's relative path, size, SHA-256, classification and timestamp plus external report and immutable history hashes. Committed and working bytes, candidate bytes/import closure, exported operational bytes and prior history are verified. No unresolved BLOCKER/HIGH remains in this implementer record.

An additional read-only exported-controller check refused an unmodelled transient descendant. No Stop, selection or ownership expansion followed. It had disappeared before immediate fresh diagnosis, so its exact earlier identity remains unclassified and is never reconstructed into authority. The diagnostic and subsequent unchanged exported controller passed fresh five-role/four-support topology with no unknown descendants; final installed canonical idle also passed. The raw refusal and post-refusal topology are retained. A separate verifier harness mistake read stale `LASTEXITCODE` from the canonical Git-containment check after successful PowerShell inspection; it now checks actual script success and a newly timestamped exact identity record. These findings do not permit ignoring future transient or unknown children: future Stop must still refuse until its entirely fresh boundary is proven.

## Fresh independent review required

Use `MA2_INDEPENDENT_REVIEW_PACKET.md`, this report and the R1.1 index to re-review the **actually operating v26 release**, active guarded tooling, canonical preservation, approval lifecycle and cleanup in a fresh independent session. Do not substitute historical staged acceptance for current production identity or treat this implementer result as an independent operational approval. The original independent FAIL and failed R1 activation remain auditable history.
