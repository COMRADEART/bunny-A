# M-A-3 Gate T9R: Calculator Regression Repair and Secure Phone Re-acceptance

**Verdict: `BUNNY_MA3_T9R_PASS_WITH_LIMITATIONS`**

- Branch: `claude/ma3-t9-phone-remote`
- Final executable source: `395d1c0a246d8f2b0c85c236e11a9a0437ad6456`
- Accepted T9 source: `0a5988c`; accepted T8 ancestor: `987afea` (both verified ancestors)
- Evidence root: `test-results/ma3/t9r/` (index `INDEX.md`, seal `INDEX.sha256`)
- T10 was not started. Nothing was pushed. Production v26 was not installed over, restarted or migrated, and the public tunnel was never started.

## Why the verdict carries limitations

1. **No physical phone and no LAN or internet path were exercised.** No phone was attached or offered; the public tunnel is not authorized. Every remote result is protocol-level: a real Host and built gateway behind a loopback TLS adapter.
2. **One owner policy decision is open (F-01).** A paired phone may approve a Mission plan whose write-scoped model steps launch provider sessions with an unconfined shell. Two independent verifiers rated this HIGH against DEV-01's rationale. The accepted MA0R tests (`missions.test.ts:412`, `capabilities.test.ts:264`) explicitly require this phone right, and T9R may not weaken accepted tests. It is therefore recorded as an owner policy decision, not changed. The phone cannot create Missions; it can only approve the exact Host-computed scope, which states `writeIncludesShell: true`.

## 1. X53 root cause

On Windows 11 build 26300 with Microsoft Calculator 11.2607.0.0, minimizing the Calculator `ApplicationFrameWindow` keeps the HWND and its `ApplicationFrameHost.exe` frame process but **detaches the `CalculatorApp.exe` XAML content**. While minimized, `num0Button`, `num2Button`, `clearButton` and `CalculatorResults` are absent from the live UIA tree.

The original acquisition demanded those arithmetic controls before it restored the window, so a minimized owned window produced `Calculator arithmetic identity unavailable`. The defect was reproduced on the unchanged test (cold run passes, minimized run fails). The T8→T9 native paths are byte-identical, so this is a pre-existing native readiness defect exposed by workstation state, not a T9 security regression. Details: `root-cause-analysis.md`, `baseline-failure.md`.

## 2. Source files changed (`0a5988c` → `395d1c0`; 9 files, +768/−24)

`src/lib/bunny-missions/capabilities/computer.server.ts`, `src/lib/bunny-missions/commands.server.ts`, `src/lib/bunny-missions/manager.server.ts`, `src/lib/bunny-host/http.server.ts`, `src/lib/bunny-host/manager.server.ts`, `src/lib/bunny-host/device-authority.server.ts`, `package.json`; new tests `src/lib/bunny-missions/calculator-readiness.test.ts` (13) and `src/lib/bunny-host/remote-remediation.test.ts` (14). No existing test file or assertion changed. Per-commit rationale: `source-diff-analysis.md`.

## 3. Commits

| Commit | Content |
|---|---|
| `e895fdf` | Signed native frame identity, bounded condition-based readiness, admitted-only restoration; device `mission.respond` binding hardening |
| `341aeaa` | Restoration evidence preserved |
| `ea48c40` | Bounded semantic UIA focus with mandatory native foreground equality |
| `b345aa3` | First review fix set (F-01/T-01 later reverted: they broke accepted MA0R tests) |
| `0904132` | DEV-01 reroute guard; revocation ends device-approved Missions including failed ones; F-03 narrowed; `allow_batch` refusal classification |
| `395d1c0` | Device launch gate honours probed remote Ollama tags; marker ordering; sweep re-read |

## 4. Before/after UIA evidence (`calculator-uia-tree-safe.json`)

| State | Frame | Content process | Verified Calculator | Arithmetic controls |
|---|---|---|---|---|
| Owned window minimized (failure) | HWND 5111952, ApplicationFrameHost PID 10088 | `null` | `false` | none |
| After repaired acquisition | same HWND, same frame lifetime | PID 18388, same content lifetime | `true` | `num0Button`, `num2Button`, `clearButton`, `CalculatorResults` |

The native frame AppUserModelID `Microsoft.WindowsCalculator_8wekyb3d8bbwe!App` matched the signed installed package (`native-minimized-frame-property.json`). Selectors stay semantic UIA throughout: no coordinates, no mock UIA.

## 5. Native Calculator execution proof (final complete regression, `x53-full-reacceptance.json`)

- Agent `da3d5004-dd77-4a84-91c3-5a3431fa13a7`, Mission `657bc8a8-ba23-45e8-9b18-3358e99f13b8`, state COMPLETED.
- Target: HWND 2427078, frame PID 10088 (start 639270365907246455), content PID 20148 (start 639271244360935433). Every computer action carries the same identity.
- `clearButton` invoke, then the Calculator itself reports `Display is 0`; `num2Button` invoke, then it reports `Display is 2`. Each reading is a verified artifact.
- One acquisition (no duplicate), 23/23 verified artifacts, `acceptance.txt` verified, 0 redundant prompts.

## 6. Full X53 workflow

The unchanged `cross-app-live.test.ts` ran the whole sequence: disposable Host → filesystem read → Git → bounded terminal (`node check.mjs`) → real Host recovery (fresh Host) → isolated browser navigate/read → Calculator acquire/reuse → focus → Clear/Enter invocations → result reads → verified artifact → Mission COMPLETED. It used the same Agent and Mission identity throughout (`x53-full-reacceptance.json`, `x53-final-run/`).

## 7. Stability (`x53-stability-matrix.json`)

On `395d1c0`: **10/10 consecutive clean** runs (3 cold launches, 5 warm exact-identity reuses, 2 minimized with admitted restoration), plus the X53 run in the complete regression. X53 also passed in this session's full regressions of `ea48c40`, `b345aa3` and `0904132`.

Every earlier failure is preserved with its root cause:

- Harness defects (attempts 1–2).
- A real `SetForegroundWindow` denial, which led to the `ea48c40` repair.
- Attempt 4 run 8: foreground taken by another window mid-sequence, which the adapter refused fail-closed by design.
- Two ownership-guard refusals before any run (attempts 5–6).

Only the exact ledgered, test-owned HWND was ever minimized or closed. There was no process-name termination.

## 8. Remote security (`remote-security-matrix.json`, `t9r-adversarial-matrix.json`)

| Scenario | Result | How |
|---|---|---|
| Cross-Agent / cross-Mission / cross-Project substitution | PASS | Real HTTP `/command` + Capability Bus replay of A's envelope at B |
| Cross-Project artifact | PASS | Device `project.artifact` refused across Projects; own read is location-free |
| Offline approval replay | PASS | Stale request refused after reissue; replayed op id never re-executes |
| Lost acknowledgment (respond, Pause, Stop) | PASS | Applied replay returns `replayed:true`; one write; no second pause/stop |
| Host replacement / stale epoch | PASS | `HOST_IDENTITY_CHANGED` / `HOST_EPOCH_CHANGED` on respond, pause, stop, mission.stop; nothing changes |
| Concurrent approvals (2-way and 4-way) | PASS | Exactly one winner, `resolvedBy` = winner, at most one effect |
| DEV-01 reroute escape (found in review) | FIXED + PASS | Reproduced on `b345aa3`; device-approved local task never reroutes to a tool-capable provider |
| Revocation ends device-approved Missions | FIXED + PASS | Active stopped; failed Mission's Retry refused at the canonical boundary |
| Plan binding after replan | FIXED + PASS | Unbound or stale device approval of a revised plan refused |
| Live gateway protocol (10 checks) | PASS | Independently paired client → trusted TLS → built gateway → disposable Host |

Four independent adversarial review rounds produced 231 findings: 147 blocked by canonical boundaries, 14 fixed, 5 policy/accepted-design, and the rest recorded LOW/INFO. **No unresolved HIGH/BLOCKER defect remains.** F-01 is an owner policy item (see above).

## 9. Device revocation

- Already-open device SSE streams close on revocation and post-revocation sequences are not delivered (`ma2-t10.test.ts` T10-T6-04, both variants).
- A delayed body cannot keep pre-revocation authority (T9 revocation race).
- Self sign-out removes control and artifact authority (live gateway F03/F44/F46/F47).
- Workstation revocation now also revokes and stops the plain Missions the lost device approved (T9R F-02).

## 10. Host restart

- **OS-process restart** (live gateway): PID 30952 → 26220; Host UUID stable; epoch `11c18a40…` → `a28b6c5e…`; pre-restart command `HOST_EPOCH_CHANGED`; completed Agent and verified receipt preserved; no non-terminal authorization left ACTIVE.
- **In-process restart over the same SQLite** (T9R test): same Agent and Mission IDs; the paired device credential survives; the held approval is refused; no duplicate Task and no side effect.

## 11. Physical phone

**NOT TESTED** (`physical-phone-results.json`, `device-inventory.json`). The phone-UI-closure and phone-only network-loss tests use a test client, not a phone.

## 12. LAN / internet

- **Loopback trusted-TLS: LIVE VERIFIED.** This includes certificate trust failing closed, transport downgrade refused, and phone-only network loss: client transport closed mid-write, exactly one Host effect, same Host identity, authenticated reconnect.
- **LAN: NOT TESTED.**
- **Internet: NOT TESTED** (tunnel not authorized) (`network-validation.json`).

## 13. Full regression (final committed source `395d1c0`)

| Suite | Tests | Pass | Fail | Skipped |
|---|---:|---:|---:|---:|
| Scripts | 256 | 256 | 0 | 0 |
| Library | 691 | 691 | 0 | 0 |
| Agent | 24 | 24 | 0 | 0 |
| UI | 99 | 99 | 0 | 0 |
| **Total** | **1,070** | **1,070** | **0** | **0** |

The total is 1,043 accepted + 27 new T9R tests. No prior test name is missing (`complete-test-inventory.json`).

- Typecheck: exit 0.
- ESLint: 0 errors (the 22 warnings match the baseline).
- Production build: exit 0.

## 14. Package validation (`windows-package-results.json`)

Disposable `Bunny-A-Windows-MA3-T9R-TEST` `1.0.0-MA3-T9R-TEST` was pinned to `395d1c0` for both source and tooling.

| Check | Result |
|---|---|
| Manifest | 357 entries, no extra/missing/changed |
| Import closure | OK |
| Source pin | 103 files match the commit |
| Packaged Host boot (bundled node.exe, fresh installed-layout disposable state) | Correct release identity, graceful close |
| Installation | None performed |
| Packaged gateway boot | NOT TESTED: port 8084 is held by protected production |

## 15. Production preservation (`production-final.json`)

The installed state was resolved through `install.json` and opened read-only. Observation window: 2026-10-09T03:35:47Z → 07:29:14Z.

Unchanged:

- Production processes: same PIDs and creation times.
- Credentials file.
- Install configuration.
- `startup.sh` and Windows Startup entries.
- Protected untracked reports and `memory/`.
- Installed v26 manifest (160/160).

Database delta: four `provider.status_changed` events and `providers.probed_at` refreshes. These are the live production Host's own Ollama health polling (`production-change-attribution.txt`). No device, task, Mission or approval row changed. This proves the stated window only, not whole-task byte equality.

## 16. Remaining limitations

See `limitations.md`:

- Physical phone, LAN and internet transport not tested.
- Packaged gateway boot not tested (production holds its port).
- Owner policy items F-01, F-04, Mission roots visible to the owner device, and self sign-out semantics.
- Residual LOW findings: remote-tag snapshot window, a pre-existing `hidePaths` spaced-path tail, CAL-18 substring titles on the non-cross-app path, untested wiring assertions.
- Foreground theft by other applications can make X53 fail closed.

## 17. Evidence

`test-results/ma3/t9r/INDEX.md` lists every required file. `INDEX.sha256` seals them. The secret scan covered 681 text files with 0 findings and checked production credential values without printing them.

`BUNNY_MA3_T9R_PASS_WITH_LIMITATIONS`
