# MA3 T13.3 acceptance: independent Personal Agents and character styles

**Verdict: `BUNNY_MA3_T13_3_PASS_WITH_LIMITATIONS`**

Every gate's contract is implemented and proven by tests on real Hosts. The full regression passes at the final source in a clean checkout. The Windows test package verifies and passes the packaged end-to-end run. The independent review's blocker and medium findings are fixed, and production is untouched.

The verdict is not a plain PASS for two reasons:

- No live provider inference, real quota exhaustion or hardware voice was exercised.
- The packaged runtime cannot run npm-based worker abilities.

Both are listed under item 19.

Evidence lives in `test-results/ma3/t13-3/` (one folder per gate). Gate I evidence is in `test-results/ma3/t13-3/gate-i/`.

## Final delivery report

### 1. Exact starting source

`08e53df`, the sealed T13.2 evidence commit. Its accepted totals were 2,364 distinct tests: scripts 440, library 1,501, Agent runtime 58, UI 365.

### 2. Final executable commit

`fd54c2b`, "M-A-3 T13.3 Gate I: fix independent-review findings". Source commits per gate:

| Gate | Source | Evidence |
|---|---|---|
| A, B | `498822e` | `72cfeb4` |
| C | `9fb179c` | `4852b0a` |
| D | `6d7c60e` | `446f850` |
| E | `e836781` | `c2f4528` |
| F | `e00f6bf` | `8670b77` |
| G | `a8d3787` | `2b833fb` |
| H | `88c3413` | `4d2401b` |
| I | `fd54c2b` | the commit that adds this file |

### 3. Evidence commit

The Gate I evidence commit is the one that adds this document, `T13_3_INDEPENDENT_REVIEW.md` and `test-results/ma3/t13-3/gate-i/`. It holds evidence only; no executable source changes in it. Nothing was pushed.

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
- Host tests: `lotus-host.test.ts`, 3 tests. Agent memory is private, Projects are shared boundaries, and sharing is explicit. Poisoning, correction, export, forget and restart are covered, and a paired device cannot read, write, share or export.
- End-to-end E06 checks private recall per slot and refuses a credential-shaped value. E18 confirms that value reached no state file or log.

### 7. Child worker orchestration

- `workers-host.test.ts`, 5 tests. Workers run as real child Missions and are VERIFIED only by Host checks. A failing worker is REJECTED. Ownership, recursion, Project, tool and limit refusals are covered, as are cancellation from the parent and restart survival. Described abilities wait for review.
- Also new in Gate I: a model worker's Project memory reaches only its model prompt, and a device can neither read it nor release the worker.
- End-to-end, repository at `fd54c2b`: E07 runs PROPOSED, ELIGIBILITY_CHECK, ADMITTED, RUNNING, RESULT_REPORTED, VERIFIED and CLOSED, with no provider.
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

**Retained attempt.** `gate-i/regression-attempt-1/`, at the same commit:

- The scripts suite ran 447/448. The packaging test needs the Node runtime license notice, a gitignored local file that the clean checkout lacked.
- Because `npm test` chains its suites with `&&`, the library and Agent suites never ran in that attempt.
- The runner now copies that notice in, alongside the `node_modules` and `native/voice/vendor` junctions, and runs each suite as its own step, as in T13.2.

**Source files rewritten by the run.** The run rewrote three tracked files in the throwaway checkout: `native/voice/bunny-voice-worker.exe` and `.json` (pretest rebuilds them) and `src/routeTree.gen.ts`. Nothing in the working tree changed.

### 17. Windows package hashes and import closure

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

### 19. Remaining limitations

- **L-LIVE: no live inference.** No provider model ran: no live local model, no cloud model and no model-backed worker against a real provider. Quota exhaustion, failover and routing improvement are proven with fixtures and real Hosts only.
- **L-PKG-NPM: the package has no npm.** The packaged runtime ships `node.exe` without the npm CLI, as every earlier package did, T13.2 FINAL included. So in the packaged build, `terminal.exec npm …` cannot resolve, and the built-in `test`, `typecheck` and `lint` worker abilities wait for a permission that cannot be granted. They fail closed: never VERIFIED, closed as INDETERMINATE on cancel. They work from the repository source. Fixing this means either shipping npm in the package or changing `terminal.exec` executable identity, which is a packaging and security decision for a later milestone.
- **L-QUOTA-DIRECT (review F4): direct tasks reroute on quota.** A directly submitted task with no declared scope keeps the T3 R22 single bounded reroute on a quota error, within the user's switch allowlist. Mission write work pauses.
- **L-VOICE: voice hardware not tested.** Microphone, speaker, human barge-in and live persona adherence were NOT TESTED. Speaking pace and interruption preference are not adjustable.
- **L-PLAN: Part F planning not implemented.** Laya and Jev advice for workers, plan revisions and replan triggers are not implemented.
- **L-FAIR (F11): fairness has no aging.** Fairness was not exercised with four live Agents at once.
- **L-COMPACT (F6): compaction skips admission.** Conversation compaction does not re-run steering admission on folded turns.
- **L-ATTR (F12): worker attribution.** A worker keeps the slot that proposed it after its parent Agent is reassigned.
- **L-COST: cloud cost is UNKNOWN.** No adapter reports per-request prices.
- **L-PERF: performance scope.** Performance was measured on one machine, display and browser. Battery was NOT MEASURED.
- **L-HARNESS: harness detection only.** Six harnesses stay detect-only, guided install was not exercised, and no harness ran a model.
- **L-CONSOLE: browser console.** Gates B–G have no recorded browser console check (D–G state this explicitly). Gate H recorded one, and its console was clean. The Gate I fixes change Host code and one Harness Manager note string only, so no new browser QA was run.

### 20. Production-preservation proof

See `gate-i/production/PRODUCTION_PRESERVATION.md`, with the before and after receipts in the same folder.

- The installed release `Bunny-A-Windows-MA3-T13-FINAL-TEST` is unchanged: its 478-file manifest hash and `install.json` hash are identical.
- The same Host and gateway processes are running: PIDs 13924 and 19896, with the same start times.
- There are the same 45 tables.
- The only database changes are the production Host's own periodic provider-refresh events.

Nothing was pushed, deployed, installed, restarted or published. There was no sign-in, paid inference or subscription purchase. T14 was not started.

## Verdict

`BUNNY_MA3_T13_3_PASS_WITH_LIMITATIONS`
