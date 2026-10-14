# MA3 T13.3 acceptance: independent Personal Agents and character styles

**Verdict: `BUNNY_MA3_T13_3_PASS_WITH_LIMITATIONS`**

Every gate's contract is implemented and proven by tests on real Hosts. The full regression passes at the final source in a clean checkout. The Windows test package verifies and passes the packaged end-to-end run. Production is untouched.

**Gate J (2026-10-14) re-seals this milestone at source `fc915a0`.**

- It repairs every review finding Gate I left open: F4, F6, F11 and F12.
- It hardens F7, and F2 gets its `mission.respond` test.
- A second independent review of those repairs found two HIGH, two MEDIUM, three LOW and four INFO items.
- A read-only confirmation pass found one more HIGH (N-B), one MEDIUM, three LOW and one INFO.
- Every HIGH is repaired with a test.
- One MEDIUM (N-C) and three LOW/INFO items stay documented.

The complete regression, native Notch receipts, the Windows package and the production proof were all re-run at `fc915a0`. See `T13_3_REVIEW_2.md` and the Gate J rows below.

The verdict is not a plain PASS for two reasons:

- No live provider inference, real quota exhaustion or hardware voice was exercised.
- The packaged runtime cannot run npm-based worker abilities.

Both are listed under item 19.

Evidence lives in `test-results/ma3/t13-3/` (one folder per gate). Gate I evidence is in `test-results/ma3/t13-3/gate-i/`, and Gate J evidence is in `test-results/ma3/t13-3/gate-j/`.

## Final delivery report

### 1. Exact starting source

`08e53df`, the sealed T13.2 evidence commit. Its accepted totals were 2,364 distinct tests: scripts 440, library 1,501, Agent runtime 58, UI 365.

### 2. Final executable commit

**`fc915a0`** (Gate J), "M-A-3 T13.3 Gate J: repair confirmation-review findings N-B, N-A, N-D, N-E". Gate I's final source was `fd54c2b`. Source commits per gate:

| Gate | Source | Evidence |
|---|---|---|
| A, B | `498822e` | `72cfeb4` |
| C | `9fb179c` | `4852b0a` |
| D | `6d7c60e` | `446f850` |
| E | `e836781` | `c2f4528` |
| F | `e00f6bf` | `8670b77` |
| G | `a8d3787` | `2b833fb` |
| H | `88c3413` | `4d2401b` |
| I | `fd54c2b` | `a4a2a60` |
| J | `906589b`, `94a08e5`, `fc915a0` | the commit that adds the Gate J evidence |

### 3. Evidence commit

The Gate I evidence commit is `a4a2a60`. The Gate J evidence commit is the one that adds `T13_3_REVIEW_2.md` and `test-results/ma3/t13-3/gate-j/`, and updates this document and the Gate C, D and F docs. Both hold evidence and documentation only, with no executable source changes. Nothing was pushed.

### 4. Four-Agent identity verification

Gada, Spear, Vishnu Chakra and Sword are four Host-owned slots with durable ownership, profile, conversation and appearance. None of them has a hard-coded specialty.

- `personal-agents-host.test.ts` and `personal-agent-context-host.test.ts` prove the identities on a real Host:
  - delegate goes through `agent.create`;
  - one Agent owns several Missions;
  - switching the foreground speaker never pauses or transfers work;
  - each Agent answers from its own Missions only;
  - a rebind is an explicit transfer.
- End-to-end E02, E04 and E05, on both the repository and the package: four slots in weapon order, foreground ownership, and a reply built from Host facts that never claims completion.

### 5. Per-Agent persistent context

The profile, conversation turns, ownership, foreground identity and appearance survive a Host restart: `personal-agent-context-host.test.ts`, and end-to-end E15. A restart never marks unfinished work complete (E16).

### 6. Lotus memory

- Unit tests: `lotus.test.ts`, 8 tests. They cover credential refusal, scope rules, trust ceilings, steering held as an untrusted bud, user-only promotion, ranking, correction history, summary trust, compaction and retention. They also cover the new atomic `writeAll`.
- Gate J adds four more tests:
  - the `writeAll` rollback after a mid-batch write failure;
  - the steering check during compaction;
  - the wider steering phrasings;
  - a Host test that a short reply quoting outside text from memory is folded without it, at host trust (F6).
- Host tests: `lotus-host.test.ts`, 3 tests. Agent memory is private, Projects are shared boundaries, and sharing is explicit. Poisoning, correction, export, forget and restart are covered, and a paired device cannot read, write, share or export.
- End-to-end E06 checks private recall per slot and refuses a credential-shaped value. E18 confirms that value reached no state file or log.

### 7. Child worker orchestration

- `workers-host.test.ts`, 5 tests. Workers run as real child Missions and are VERIFIED only by Host checks. A failing worker is REJECTED. Ownership, recursion, Project, tool and limit refusals are covered, as are cancellation from the parent and restart survival. Described abilities wait for review.
- Also new in Gate I: a model worker's Project memory reaches only its model prompt, and a device can neither read it nor release the worker.
- New in Gate J:
  - the memory has its own prompt heading, never "Verified facts";
  - a phone answering a worker's request is refused;
  - a paused Agent holds its workers (N1);
  - open workers follow every ownership change, within the open-worker cap and net of swaps (F12, N3, N4, N-A).
- End-to-end, repository at `fd54c2b` and again at `fc915a0`: E07 runs PROPOSED, ELIGIBILITY_CHECK, ADMITTED, RUNNING, RESULT_REPORTED, VERIFIED and CLOSED, with no provider.
- End-to-end, package: E07 fails closed (see L-PKG-NPM in item 19). E12 shows that the phone's `/state` and the worker's `mission.get` carry no Project memory, and that phone approval returns `WORKSTATION_REQUIRED`.

### 8. Harness inventory and certified dispatch modes

There are nine harnesses (`HARNESS_COMPATIBILITY_MATRIX.md`). Only three routes can dispatch Tasks, and they are unchanged from T13.2:

- the ChatGPT plan through Codex CLI;
- the Claude subscription through Claude Code;
- local models through Ollama.

Cursor, Cline, Grok, OpenCode, Gemini and Copilot stay detect-only. Install is guided only (the owner's decision): Bunny shows the pinned command and never runs an installer. No harness ran a model in this milestone. The verdict ladder reached `runs` live; `task_completed` is shown only with fixture adapters.

### 9. Local and free routing observations

The owner priority `local_only` is honoured before any work (end-to-end E03 and E09). Hard exclusions run before any score, so a cloud route can never be chosen under `local_only`. **No live local model inference was run in this milestone.** Local and free routing is evidenced by the routing, scheduler and T3 manager tests with fixture providers.

### 10. Session ledger and quota-switch receipts

- The session ledger is proven by `session-ledger-host.test.ts` (2 tests) and `scheduler.test.ts` (6 tests).
- A write step that hits a quota pauses for the owner (`QUOTA_PAUSE`). A read step reroutes within bounds.
- Gate J (owner decision): only work that **declares** read access reroutes on quota. A direct Chat or `/submit` task with no declared scope counts as write and pauses. Write work also pauses instead of switching providers after a persistent transport failure (`WRITE_PAUSE`). This holds on the direct path and on the Mission path (`provider_write_paused`).
- The live ledger in every end-to-end run is 0 sessions, 0 connection uses, 0 Jev uses and 0 provider tasks (E17).
- **No real provider quota was exhausted. All quota receipts come from fixtures.**

### 11. Cross-provider consent verification

Every reroute still passes the T13.2 cross-vendor switch rule (`CROSS_VENDOR_SWITCH`, `switchAllowlist`) and the exact destination account's consent. This is covered by `connections.test.ts` R05 and R06, `connections-host.test.ts` R07, and the T3 quota-reroute test (which opts in to both vendors explicitly). T13.3 widened no consent rule. A routing-improvement policy cannot widen eligibility either (`ADAPTIVE_FEEDBACK.md`).

### 12. Laya and Jev decision behaviour

Laya and Jev stay advisory only, unchanged from T13.1 (`intelligence.test.ts`, `intelligence-host.test.ts`). They never grant permission or change the authority fields of a Task. Gate G's routing improvement is evaluation-gated on top of them:

- with 0 verified decisions, Propose refuses honestly (end-to-end E10);
- every lifecycle step is tested in `routing-learning.test.ts`.

**Not implemented:** Laya and Jev advice for worker plans, plan revisions and replan triggers (Part F planning additions). See item 19.

### 13. Voice conversation results

- `voice-session.test.ts` and `voice-personalization.test.ts` cover per-speaker voice and identity, switching between Personal Agents (Gada to Sword), answer length, reply language, notification frequency and text-free feedback.
- The Gate B voice test covers foreground addressing.
- End-to-end E10 saves a voice preference and restores it.
- **Microphone capture, speaker playback, human barge-in and a live model's adherence to an Agent's personality were NOT TESTED.**

### 14. Five character-style screenshots

These are in `test-results/ma3/t13-3/gate-h/screenshots/`:

- the five styles: `t13-3-h-appearance-glossy.png`, `-cel.png`, `-arcade.png`, `-comic.png`, `-pixel.png`;
- the accessibility variants: high contrast, reduced motion and forced colours;
- the desktop and mobile Studio;
- the 20-cell design-preview gallery;
- the Notch on four edges.

The native Notch has 23 captures in `gate-h/notch/shots/`. Styles are presentation only (end-to-end E11).

### 15. Performance measurements

Gate H, on one machine (RTX 4050 Laptop and Intel Arc, AC power):

- **Native Notch, with the art-container cache.** Every style costs 19–22.5% of one core, runs at 75 fps with a p95 frame time of 13.33 ms, and uses about 5–5.7% GPU 3D, the same as the T13 chips. Before the cache, material styles cost 34–43% CPU and 20–24% GPU (runs retained).
- **Web.** 60 fps, p95 16.8 ms, renderer CPU 17–19%.
- **Battery: NOT MEASURED** (the machine was on AC power).

**Gate J native Notch re-run** (`gate-j/notch/`, the Gate H driver copied unchanged).

- 23 of 23 receipts, 0 failing checks: four edges, five styles, high contrast, intensity off and subtle, reduced motion, Bunny speaking, and the perf runs.
- The display ran at 60 Hz this time, versus 75 Hz at Gate H. Every animated run held 60 fps with a p95 frame time of 16.67 ms.
- CPU per style was 22.5–27.5% of one core, against 25.7% for the plain T13 chip in the same session. GPU 3D was 4.4–4.7%.
- So the styles still cost about the same as the T13 chips. The absolute CPU figures are higher than Gate H's because of the different display mode and machine state. They are not comparable run to run.
- Gate J changed no Notch, Island, UI or packaging file (`git diff a4a2a60..fc915a0` touches only `src/lib`, tests and docs).

### 16. Full distinct regression counts

The final source `fd54c2b` was run in a clean detached checkout (`gate-i/regression-final/`):

| Suite | T13.2 | T13.3 final |
|---|---|---|
| `npm test`, scripts | 440 | 448 / 448 |
| `npm test`, library | 1,501 | 1,565 / 1,565 |
| `npm test`, Agent runtime | 58 | 58 / 58 |
| `npm run test:ui` | 365 | 379 / 379 |
| **Distinct total** | **2,364** | **2,450 (+86)** |
| typecheck, build | exit 0 | exit 0 |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings |

Each count is one run of each suite; no focused run is counted. No baseline test was weakened. One reviewer suggestion (F4) was rejected precisely because it would have broken baseline T3 R22.

**Gate J final source `fc915a0`, clean detached checkout (`gate-j/regression-final/`):**

| Suite | Gate I | Gate J final |
|---|---|---|
| `npm test`, scripts | 448 | 448 / 448 |
| `npm test`, library | 1,565 | 1,575 / 1,575 |
| `npm test`, Agent runtime | 58 | 58 / 58 |
| `npm run test:ui` | 379 | 379 / 379 |
| **Distinct total** | **2,450** | **2,460 (+10)** |
| typecheck, build | exit 0 | exit 0 |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings |

**Changed baseline assertions (owner decision 2026-10-14, F4).** Two baseline tests changed: T3 R22 in `t3-manager.test.ts` and T9R DEV-01's positive control in `remote-remediation.test.ts`. Each now submits a declared read scope, because unscoped direct work now pauses on quota instead of rerouting. Both still prove that read work reroutes. Removing assertions is not the issue here: the T3 and T9R contract changed on purpose, and new tests pin the unscoped case.

**Retained:** `gate-j/regression-94a08e5-superseded/` is a full green run of the intermediate source `94a08e5` (2,458), superseded by the confirmation-pass repairs. The run rewrote the same three tracked files in the throwaway checkout as at Gate I, and nothing changed in the working tree.

**Retained attempt.** `gate-i/regression-attempt-1/`, at the same commit:

- The scripts suite ran 447/448. The packaging test needs the Node runtime license notice, a gitignored local file that the clean checkout lacked.
- Because `npm test` chains its suites with `&&`, the library and Agent suites never ran in that attempt.
- The runner now copies that notice in, alongside the `node_modules` and `native/voice/vendor` junctions, and runs each suite as its own step, as in T13.2.

**Source files rewritten by the run.** The run rewrote three tracked files in the throwaway checkout: `native/voice/bunny-voice-worker.exe` and `.json` (pretest rebuilds them) and `src/routeTree.gen.ts`. Nothing in the working tree changed.

### 17. Windows package hashes and import closure

Gate I values below. **Gate J re-built the package from `git archive` of `fc915a0`** (`gate-j/windows-package/`):

| Field | Gate J value |
|---|---|
| Version | `0.0.0-ma3-t13.3.2` |
| Source and tooling commit | `fc915a0a0a8ecfde6cde7ce48195f1f28d7bb3f1` |
| Archive | 179,826,013 bytes, SHA-256 `32f42a9d48bb2cb9484cb86426a5f21800e75dd55bdc209ad9a747ef753bb078` (matches the `.sha256` file) |
| File verification | 501 manifest files, 0 extra, 0 missing, 0 changed |
| Import closure | 145 files, 0 missing, 0 outside the package; optional package: `playwright` |
| Source check | 191 files, 0 mismatched against the commit |
| Packaged end-to-end | 18/18 PASS with the package's own `runtime\node.exe` (v24.18.0), port 43894 |
| Repository end-to-end | 18/18 PASS at the working tree of `fc915a0`, port 43895; E07 runs the worker to VERIFIED |
| Installed / published | No / No |

Gate I:

| Field | Value |
|---|---|
| Package | `Bunny-A-Windows-MA3-T13-3-TEST`, version `0.0.0-ma3-t13.3.1` |
| Source and tooling commit | `fd54c2b03c5beb9bba16c8992137f95a95fc2d6c` (built from `git archive` of that commit) |
| Archive | `Bunny-A-Windows-MA3-T13-3-TEST.zip`, 179,824,570 bytes |
| Archive SHA-256 | `969cc76fc9a2e15643abf2986d2f964b547a93f686033071d2d4480cd0f0c6ab` (matches the `.sha256` file) |
| File verification | 501 manifest files, 0 extra, 0 missing, 0 changed |
| Import closure | 145 files, 0 missing, 0 outside the package; optional package: `playwright` |
| Source check | 191 files, 0 mismatched against the commit |
| Packaged end-to-end | 18/18 PASS with the package's own `runtime\node.exe` (v24.18.0) on a disposable Host |
| Installed / published | No / No |

The results are in `gate-i/windows-package/package-results.json` and `release-manifest.json`. The end-to-end receipts are `gate-i/e2e/package-e2e.json` and `repository-final.json`.

**Retained end-to-end attempts:**

- Rehearsals 1–3 ran before the fixes. Attempts 1 and 2 were a too-broad "done" regex and a stale file read.
- Packaged attempt 1 timed out on the worker.
- Packaged attempt 2 is a diagnostic run that found L-PKG-NPM.

### 18. Independent review findings

See `T13_3_INDEPENDENT_REVIEW.md`. A separate reviewer agent found:

- 1 blocker: F1, a worker's Project memory visible to a phone;
- 3 medium: F2, phone approval of a worker; F3, a Studio save undoing assign; F4, quota pause on unscoped tasks;
- 6 low: F5–F10;
- 2 info: F11, F12.

How they were resolved:

- **Fixed with tests:** F1, F2, F3, F5, F7. Mutation checks caught 6 of 7 mutations. The survivor, F3-M1, is defence in depth.
- **Fixed:** F8, F9, F10.
- **Resolved by analysis:** F4. Mission work always declares a scope, and direct tasks keep T3 R22.
- **Documented:** F6, F11, F12.

This was not an external, independent release audit.

**Gate J** (`T13_3_REVIEW_2.md`) repaired F4 (by owner decision), F6, F11 and F12, hardened F7, and added F2's `mission.respond` test.

The second review found:

- N1 HIGH: a paused Agent's workers kept running.
- N2 HIGH: the F4 change broke T9R DEV-01's positive control.
- N3 and N4 MEDIUM: worker attribution and the open-worker cap.
- N5 MEDIUM: a transport reroute of write work.
- N6, N7, N8 LOW and four INFO items.

The confirmation pass found N-B HIGH (a Mission write step still switched providers), N-C MEDIUM, and N-A, N-D, N-E LOW.

Resolution:

- Every HIGH is fixed with a test.
- N3, N4, N5, N6, N7, N9, N-A, N-D and N-E are fixed.
- N8, N-C and N-F are documented below.
- Mutation checks at `fc915a0` caught 25 of 26. F3-M1 survives as defence in depth. Every earlier attempt is retained.

The reviewer did not run the final gates; this document records them.

### 19. Remaining limitations

- **L-LIVE: no live inference.** No provider model ran: no live local model, no cloud model and no model-backed worker against a real provider. Quota exhaustion, failover and routing improvement are proven with fixtures and real Hosts only.
- **L-PKG-NPM: the package has no npm.** The packaged runtime ships `node.exe` without the npm CLI, as every earlier package did, T13.2 FINAL included. So in the packaged build, `terminal.exec npm …` cannot resolve, and the built-in `test`, `typecheck` and `lint` worker abilities wait for a permission that cannot be granted. They fail closed: never VERIFIED, closed as INDETERMINATE on cancel. They work from the repository source. Fixing this means either shipping npm in the package or changing `terminal.exec` executable identity, which is a packaging and security decision for a later milestone.
- **~~L-QUOTA-DIRECT~~: closed in Gate J** (owner decision). Unscoped direct work counts as write and pauses on quota. This is a visible Chat and voice change: such a task now stops and asks instead of switching providers.
- **L-RETRY-SAME (review N-C): the same-candidate retry re-runs write work.** The T3 §22 baseline allows one bounded same-candidate retry after a transport failure. For write work that re-runs the step on the same provider. Removing it is a T3 contract change for the owner to decide, as F4 was. Cross-provider switching of write work is closed (N5, N-B).
- **L-RETRY-ACCESS (review N8): an undefined Mission access reroutes like read.** It is unreachable, because the Host refuses any Mission task without an execution scope. Changing it would rewrite a baseline Mission unit test.
- **L-STEER (review N-F): the steering check is a pattern list.** Phrasings such as "Ignore whatever I said earlier" still pass. Recall labels every memory by trust regardless.
- **L-VOICE: voice hardware not tested.** Microphone, speaker, human barge-in and live persona adherence were NOT TESTED. Speaking pace and interruption preference are not adjustable.
- **L-PLAN: Part F planning not implemented.** Laya and Jev advice for workers, plan revisions and replan triggers are not implemented.
- **L-FAIR: fairness not exercised live.** Aging (F11) closed the starvation gap in Gate J. Fairness was still not exercised with four live Agents at once.
- **~~L-COMPACT~~ (F6) and ~~L-ATTR~~ (F12): closed in Gate J.**
- **L-COST: cloud cost is UNKNOWN.** No adapter reports per-request prices.
- **L-PERF: performance scope.** Performance was measured on one machine, display and browser. Battery was NOT MEASURED.
- **L-HARNESS: harness detection only.** Six harnesses stay detect-only, guided install was not exercised, and no harness ran a model.
- **L-CONSOLE: browser console.** Gates B–G have no recorded browser console check (D–G state this explicitly). Gate H recorded one, and its console was clean. The Gate I fixes change Host code and one Harness Manager note string only, so no new browser QA was run. Gate J changes Host and Mission code, tests and docs only (no UI file), so again no new browser QA was run.

### 20. Production-preservation proof

Gate J: see `gate-j/production/PRODUCTION_PRESERVATION.md`. The receipts are from 18:50Z and 20:45Z on 2026-10-14.

- The release, manifest, `install.json`, listener PIDs 13924 and 19896 with their start times, the 45 tables, the startup shortcut, microphone privacy and the audio endpoint hash are all identical.
- The only database changes are 13 `provider.usage_changed` events from the production Host's own refresh. Only their types and times were read, read-only.

Gate I: see `gate-i/production/PRODUCTION_PRESERVATION.md`, with the before and after receipts in the same folder.

- The installed release `Bunny-A-Windows-MA3-T13-FINAL-TEST` is unchanged: its 478-file manifest hash and `install.json` hash are identical.
- The same Host and gateway processes are running: PIDs 13924 and 19896, with the same start times.
- There are the same 45 tables.
- The only database changes are the production Host's own periodic provider-refresh events.

Nothing was pushed, deployed, installed, restarted or published. There was no sign-in, paid inference or subscription purchase. T14 was not started.

## Verdict

`BUNNY_MA3_T13_3_PASS_WITH_LIMITATIONS`
