# M-A-3 Gate T9R-F02 — Authorization Edge Closure

- **Branch:** `claude/ma3-t9-phone-remote`
- **Builds on:** F01 (`BUNNY_MA3_T9R_F01_PASS`; source `aacf398`, evidence `01c4233`)
- **Source commit:** `02a3c1d`
- **Evidence:** `test-results/ma3/t9r-f02/` (sealed by `INDEX.sha256`)
- **Not done (as instructed):** no push, production deployment, migration, tunnel activation, production restart, credential change or T10 work.

## 1. What changed

| Decision | Implementation | Main files |
|---|---|---|
| **D1** Purpose-aware phone write classification | `classifyDeviceWrite()` has six classes. It judges verified path identity (canonical vs lexical path, links, hard links, 8.3 aliases, stream suffixes, invisible characters), folder roles, file type, new and existing content, and project **consumer files** (manifests, CI pipelines, tool configs and agent instruction files in the root and in every folder above the destination, plus the root CI/hook/editor/agent folders). Only `PHONE_SAFE_DOCUMENT` / `PHONE_SAFE_DATA` give a paired device write authority. Everything else is a `desktopRequired` ask. | `authorization.server.ts` |
| **D2** Host-owned inert staging and workstation promotion | A device-attributed Mission `filesystem.write` is written to `<Host data>/staging/<id>` (private Host state, refused by every Mission read, list and search, outside every project). It is never written to the project. The staging record includes: id, Agent, Mission, step, run, device, envelope, canonical destination, content SHA-256 and size, class, reasons, warnings, approval revision, Host generation, state and file identity. Promotion happens only on a **workstation** `allow_once` of the promotion request, after re-checking: Mission, envelope, Agent consent, device liveness, scope, re-classification, destination identity and hash, staged file identity and hash, and no live code execution. The write itself is temp file + fsync + atomic rename + read-back. The review shows the escaped preview, full SHA-256, size, class and warnings. Content over 8 KB needs a full inspection on the Host (`mission.staging.inspect`, escaped) before promotion. | `staging.server.ts`, `manager.server.ts`, `bus.server.ts`, `local.server.ts`, `paths.server.ts`, `store.server.ts`, `commands.server.ts`, `mission.tsx`, `use-island.ts`, `connection-model.ts` |
| **D3** Effective authority = Host ∩ Mission ∩ Agent ∩ device ∩ exact offer | A device answer on an Agent Mission requires the Agent consent to be ACTIVE, of the current generation, unexpired, at the same revision, and in scope for every parameter set it can reach. `reviewedFilesystemOnce` honours only workstation answers. One-time answers have a lifecycle (`CONSUMED`, `EXPIRED`, `WITHDRAWN`, `INVALIDATED_BY_SCOPE_CHANGE / SIGNOUT / DEVICE_REVOCATION / HOST_RESTART`); the first stamp wins and history is never rewritten. `liveOnce()` re-validates at every use, including skill runs. | `manager.server.ts`, `types.ts` |
| **D4** Workstation identity only from verified Host evidence | Strict `Bearer` parsing. Any `x-*` header outside the local allow-list means relayed. Body identity fields never become authority. | `http.server.ts`, `host-bridge.server.ts` |
| **D5** Sign-out and revocation | `device.revoke` (self sign-out or owner revocation) synchronously ends the device's: unused one-time answers, STAGED changes, batches, consents and device-granted envelopes. It then stops device-driven work. It keeps: history, completed effects, other devices and independent workstation approvals. Re-pairing creates a new identity, so nothing is revived. | `http.server.ts`, `manager.server.ts` |

## 2. Results

| Check | Result | Evidence |
|---|---|---|
| Full regression (`npm test`, `test:ui`) | **1,235 / 1,235 pass**, 0 fail, 0 skipped, 0 cancelled: scripts 256, lib 856, agent 24, UI 99. Floor 1,148 met. | `full-test-results.log`, `regression-inventory.json` |
| Typecheck / lint / build | pass / 0 errors (22 pre-existing warnings) / pass (`db:migrate` skipped: no `DATABASE_URL`) | `typecheck.log`, `lint.log`, `build.log` |
| §18 live acceptance on a real disposable Host (real HTTP, pairing, SQLite, Agent consent, `fs.watch`) | **17 / 17 steps PASS** | `live-staging-acceptance.json`, `live/` |
| Adversarial matrix E01–E55 | **55 / 55 PASS**. Each row records initial conditions, operation, expected, observed, evidence type (in-process Host integration, real HTTP disposable Host, LIVE disposable Host, LIVE Windows UIA, read-only production) and the supporting tests. Observed results are derived from the test log, never hand-written. | `adversarial-matrix.json` |
| T6 Calculator X53 (live Windows UIA) | **10 / 10 consecutive clean** on `02a3c1d`, 0 failed attempts (cold, warm and minimized) | `x53/` |
| Windows package build + packaged-Host boot | **PASS**: package built from `02a3c1d`, with manifest, import closure and source checks. The bundled `node.exe` booted the packaged Host in fresh disposable state; release identity was verified, it closed gracefully, and the manifest was unchanged afterwards. The packaged gateway was NOT TESTED because production holds port 8084, which is protected. | `windows-package-results.json` |
| Production v26 | unchanged: release, manifest `81f83786…` (161 files), `install.json`, listeners (PIDs 23016 / 13672) | `production-before.json`, `production-final.json` |
| Secret scan of the evidence | **0 findings** in 125 text files | `secret-scan.json` |

**Changed legacy assertions.** No test was deleted or skipped, and no assertion was inverted. Each change is recorded with its original requirement, before, after and authorization rationale in `changed-assertions-ledger.json` and `one-time-approval-regression.json`:
- the nine T9/T9R narrowed-consent tests, rewritten to in-scope answers plus workstation promotion, with added negative regressions;
- 23 F01 assertions;
- three T4 actor strings.

## 3. Independent re-review (§19)

There were five review rounds. Each used independent reviewer lenses, and each MEDIUM+ finding was sent to two refuting skeptics (`independent-review.md` / `.json`).
- Rounds 1–4: every confirmed finding was repaired with a regression test (F02-R1-* … F02-R4-*), including round 4's two HIGH classifier gaps.
- F01 round-13 MEDIUMs: see `previous-review-findings.md`.
- **Unresolved BLOCKER / HIGH: none.**

**Round 5 was cut short.** The skeptic votes and the repair-verification lens did not run because of an agent session limit. The user then directed that no further security work be done. Its reviewer-reproduced findings are **not repaired** and are disclosed below.

## 4. Limitations (explicitly dispositioned)

1. **No physical phone, LAN or internet acceptance.** All device evidence uses real HTTP, pairing and bearer tokens on a disposable loopback Host.
2. **Open MEDIUMs (round 5, not repaired at the user's direction). The D1 consumer scan is heuristic.** These are not detected as consumers:
   - glob, quoted or variable spellings of a path (`docs/*.txt`, `docs/'x.txt'`, `$D/x.txt`);
   - folder-level tool settings (pytest `testpaths`, a Sphinx/MyST `docs/conf.py`);
   - consumer names outside the lists (`Dockerfile.dev`, compose override files, `Procfile`, `.cirrus.yml`, `.semaphore/`);
   - UTF-16 consumer files.
   
   Such a file can therefore be staged with a phone-safe label. **Impact is bounded by D2:** the change stays inert in Host staging and reaches the project only if the Windows Host owner promotes the exact reviewed bytes.
3. **Open LOWs (round 5):**
   - promotion re-classifies without the staged content;
   - Retry revokes trusted-desktop grants before its envelope check (fails closed);
   - Replan does not stamp `WITHDRAWN` on replaced steps' answers (audit only).
4. **Survivor-lineage MEDIUM** (F01 §7.4 residual; `previous-review-findings.md`). Its impact is reduced: device writes never land while code runs, and promotion refuses while Bunny-tracked code runs.
5. **Accepted by design:**
   - PHONE_SAFE is an inertness claim for the destination itself. Arbitrary programs can read promoted files.
   - Consumers in sibling folders that use `../` are not scanned.
   - A one-time answer covers one run of a skill step. `CONSUMED` records its first admission.
6. **Carried from F01:** Git filters on remote Git reads; survivor tracking is in memory.

## 5. Evidence index

See `test-results/ma3/t9r-f02/INDEX.md`, sealed by `INDEX.sha256`.
