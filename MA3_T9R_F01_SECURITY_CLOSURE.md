# MA3 T9R-F01 — Security Closure: paired devices never authorize code execution

**Verdict: BUNNY_MA3_T9R_F01_PASS** (with the limitations in §7; no physical phone was tested)

| | |
|---|---|
| Starting source / T9R evidence | `395d1c0` / `7fbea39` (T9R evidence preserved byte-identical) |
| F01 source commit | `aacf398` — `fix(t9r-f01): paired devices never authorize command or code execution` |
| F01 evidence | `test-results/ma3/t9r-f01/` sealed by `test-results/ma3/t9r-f01/INDEX.sha256` |
| Production | v26 (`Bunny-A-Windows-v26-MA2-R1`) never modified; tunnel never enabled; nothing pushed |
| Date | 2026-10-09 |

## 1. Permission-contract delta (MA0R → T9R-F01)

**Before (MA0R / T9R):** a phone approval produced the same Mission envelope a workstation approval would.
That included `providers.sessions.writeIncludesShell: true`, so a phone could, directly or indirectly, start
Claude write sessions (Bash/PowerShell tools), Codex sessions, terminal commands, hook-running Git and
non-Calculator UI automation.

**After (T9R-F01, owner-approved):**

### 1.1 Remote authority
A device approval yields an envelope with `authority: {kind:"remote", sessionCeiling:["tool_free","read_tools"], codeExecution:"desktop_only"}` and `writeIncludesShell:false`.
- Trusted-local authority is exactly the Host bearer-token actor `"workstation"`. Any other grantor, header, label or provider claim is treated as remote, including older JSON without `authority`.
- The gateway refuses workstation authentication for any relay header family or `bunny_device` cookie.

### 1.2 Desktop-only operations under remote authority
The canonical `decide()` / `remoteExecutionRefusal()` path makes these desktop-only, across every adapter (Claude, Codex, Ollama, OpenCode, Cline, Cursor; unknown means shell):
- `terminal.exec`
- shell-capable provider sessions
- Git commit/merge/worktree
- EXECUTE actions other than exact Calculator operations that name the Calculator window
- `browser.download`
- unknown risk

### 1.3 Remote file writes
Remote writes are limited to data and document types (`.txt .md .csv .tsv .json .jsonl .ndjson .yaml .yml .log`).
- Refused: Git metadata and execution or agent configuration, under 8.3 aliases, NTFS streams, trailing dots and UNC paths.
- This allowlist is **risk reduction only**: interpreters can run any file. The authoritative control is §1.6.

### 1.4 Trusted-desktop grants
A grant is minted only by a workstation `allow_once` on a Host-marked `desktopRequired` ask. It is bound to:
- the Host id and epoch
- the Mission, Agent, step and Task
- the plan reference and the envelope
- the Host mutation sequence (captured at ask time; a later change supersedes the ask and re-asks)
- the exact operation: provider/model/effort/access/cwd for a session, or action + params digest + cwd + resolved executable + content hashes of named scripts for a capability

It expires after 5 minutes, allows one use, can be revoked, and is spent only at the last refusal point.

### 1.5 What a device may do
- Answer only an exact planned step inside the reviewed envelope.
- Never extend an expired or revoked envelope.
- Never answer code-adjacent asks.
- Never create batches beyond exact Calculator operations or outside an Agent's cross-app consent.
- Start, resume and answers are refused for a workstation envelope whose remaining plan holds code that would run without another workstation answer. That covers shell-capable sessions, terminal, hook Git, any Git or GitHub CLI read, skills, command, git-diff and Python checks, and auto-allowed non-Calculator EXECUTE.

### 1.6 Host-wide content review (authoritative control)
Every Mission change attributable to a paired device is recorded before it runs. A change is attributable when it comes from:
- a remote envelope
- any device answer in the Mission
- a device start or resume

No Bunny code run starts while such a change is unacknowledged. That covers terminal, Git and `gh` reads, shell-capable sessions, non-Calculator EXECUTE and Python `task_spec` checks.

The workstation prompt shows each changed file's size, full SHA-256 and JSON-escaped full content up to 8 KB; larger files are explicitly flagged. Each answer acknowledges exactly the files it shows.

### 1.7 Mid-run hold
Device-attributable changes are held while workstation-approved code is live. "Live" covers in-flight code, Git and `gh` runs, shell-capable sessions, and survivors of every ended attempt, tracked by growing lineage and classified by the attempt that left them.

### 1.8 No carry-over of device authority
Device authority never carries through any of these:
- **Retry, replan, reroute, fallback, model switch, delegation:** these re-judge the exact Task and drop unspent grants and one-time allowances.
- **Host restart:** remote envelopes are revoked and grants from the old epoch are void.
- **Device revocation:** ends the device's envelopes, consents, batches and unexecuted one-time answers, and stops Missions it started, resumed or answered.

### 1.9 Projection
A device never receives:
- grant, exact-operation or binding records
- review listings (paths, digests, content)

`redactReviewListing` is applied to every HTTP JSON response addressed to a device.

## 2. Changed pre-existing tests (only where the new contract requires)

| Test | Change | Reason |
|---|---|---|
| `missions.test.ts` MA0R phone-approval test (was :412) | asserts `authority:remote`, `writeIncludesShell:false`; workstation keeps `true` | remote envelopes never carry shell |
| `capabilities.test.ts` (was :264) | phone providers `writeIncludesShell:false`; authority kinds | same |
| `missions.test.ts` out-of-envelope allow-once (~:596) | device `allow_once` now refused (`/Approval required on Windows Host/`); workstation `allow_once` completes | MUST NOT: actions outside the reviewed envelope |
| `agent-runtime.test.ts` A02/A03/A04, A05, A18 (8 strings) | actor `"test"` → `"workstation"` | only `"workstation"` is trusted-local; production actors are `"workstation"` or `"device:<id>"` |
| `agent-recovery.test.ts` (27 strings) | actor `"test"` → `"workstation"` | same |
| `approval-batches.test.ts` | +1 test (phone keeps the Calculator batch, batch-only verdict) | additive |

No test was deleted or skipped. All other assertions were preserved.

## 3. Rejected attacks

All of these are proven at the manager/authorization boundary in `src/lib/bunny-missions/remote-authority.test.ts` (77 tests; the 78th new test is in `approval-batches.test.ts`).

**Owner scenarios:**

| # | Scenario | Test(s) |
|---|---|---|
| 1 | Bounded file op permitted, no extra prompt | F01-1 |
| 2 | Claude write (shell) denied to a phone | F01-2, F01-2b, F01-12 |
| 3 | Codex equivalent denied | F01-3 (write and read) |
| 4 | Ollama → Claude/Codex reroute denied | F01-4, F01-4b |
| 5 | Retry reuse denied | F01-5, R4, R13 |
| 6 | Replan to shell needs separate authorization | F01-6 |
| 7 | Device revocation invalidates approvals | F01-7, R45, R52, R56 |
| 8 | Host restart rejects stale approvals and epochs | F01-8 |
| 9 | Phone/desktop race cannot elevate | F01-9 |
| 10 | Desktop grant not replayable (target, command, folder, Mission, plan, Task, Host, epoch) | F01-10, R6, R9, R16, R17 |
| 11 | Forged desktop claim on remote transport denied (Host and gateway) | F01-11, R7, R14, R17 |
| 12 | Benign work keeps working without prompts | F01-1, F01-4b, R20 (no re-prompt after review), R5 |

**Indirect bypasses from the brief:**

| Bypass | Test(s) |
|---|---|
| Terminal and scripts | F01-T, T2, T3, R9 |
| Git hooks, filters, textconv | T4, R1, R2, R8, R37, R54 |
| Computer / UI automation | R3, R21, R25, R30 |
| Agent re-consent and resume | T5, R11, R24, R35 |
| Device answers outside the envelope | R18, R19, R32, R33 |
| Code over device changes | R20, R26, R27, R31, R36, R38–R44, R46, R47, R53, R55 |
| Leakage | R10, R49, R50, R57 |
| Prompt forgery | R48 |

## 4. Independent security review

13 adversarial review rounds were run as multi-agent workflows: five lenses each, and every non-INFO finding refuted-or-confirmed by two independent skeptics.

| Round | Confirmed findings (BLOCKER / HIGH / MEDIUM / LOW) |
|---|---|
| 1 | 27 findings, including 2 BLOCKER (Git 8.3 alias filter-driver bypass) — fixed |
| 2–3 | HIGH: config aliases/ADS, option-form files, ask→mint window, out-of-root device answers, cross-Mission laundering — fixed |
| 4 | 1 / 3 / 5 / 7 — fixed (one HIGH dispositioned, see §7) |
| 5 | 0 / 3 / 2 / 3 — fixed |
| 6 | 0 / 2 / 3 / 5 — fixed (several votes lost to the session limit; re-verified in round 7) |
| 7 | 0 / 3 / 5 / 6 — fixed |
| 8 | 1 / 2 / 4 / 1 — fixed (premise corrected: extension allowlist is risk reduction only) |
| 9 | 0 / 1 / 2 / 6 — fixed |
| 10 | 1 / 1 / 2 / 9 — fixed |
| 11 | **0 / 0** / 4 / 9 — MEDIUMs fixed |
| 12 | 2 / 1 / 1 / 9 — fixed (code-adjacent start/answer gate; review listing on shell asks; Python check gate) |
| 13 | **0 / 0** / 2 / 5 — both MEDIUMs and the fail-open LOWs fixed in `aacf398` |

**No unresolved BLOCKER or HIGH finding remains.** The round-13 MEDIUM/LOW fixes, applied in `aacf398`, have regression tests (R57, R40 update) but were not re-reviewed by a further round.

Journals and verdicts: `test-results/ma3/t9r-f01/review/round*-journal.jsonl` and `round*-verified.json`.

## 5. Full regression on `aacf398`

| Gate | Result |
|---|---|
| `npm test` | 256/256 script + 769/769 lib + 24/24 agent = **1,049 pass, 0 fail** |
| `npm run test:ui` | **99/99** |
| Total | **1,148 pass, 0 fail** (baseline 1,070 + 78 new; changed assertions per §2) |
| `tsc --noEmit` | clean |
| ESLint | 0 errors, 22 warnings (all in files untouched by F01, or pre-existing lines) |
| Production build (`npm run build`) | pass (`db:migrate` skipped: no `DATABASE_URL`) |

**Native Calculator / X53 (live, real UIA, fresh disposable Host per run):** **10/10 consecutive PASS** — cold ×3, warm ×5, minimized ×2.
- Each minimized run restored the exact owned window.
- Warm runs kept the exact frame and content identity.
- Only the test-owned Calculator was manipulated: exact window handle, no process termination.

**Production comparison:** release, manifest (161 files), install file, listener PIDs (8084→23016, 43119→13672) and 22/25 table digests are unchanged. The three changed tables hold only the running v26 Host's own `provider.status_changed` polling (see `production-change-attribution.txt`).

**Secret scan:** 552 text files, 0 findings, with exact production credential values compared (never printed).

## 6. Evidence

`test-results/ma3/t9r-f01/` is sealed by `INDEX.sha256` (verify with `node test-results/ma3/t9r-f01/seal-evidence.mjs --verify`). Key hashes (SHA-256):

| File | SHA-256 |
|---|---|
| regression/npm-test.log | `b4ae5a1338421b229b41c719b1d8023ac7209d71a4a1477de941c463112bbd59` |
| regression/test-ui.log | `b430276a24f50239ea8521548e932ec0f18d667bca42cde724d9754564ef3c31` |
| regression/typecheck.log | `19eaf43821a7660ec323a87c8457bf74823beb296c39f5e01aa8a683aa50f061` |
| regression/lint.log | `9c455b242362f897680374965ff4e37b93127c180c0509de9e0cc3500b7eddff` |
| regression/build.log | `091481591f95870d45310e0f30258cb413008e0a15140dcecf751dd20ebb6ec9` |
| x53/x53-stability-matrix.json | `3b83bbbfd4c892fb61ebe85f087833c7fd5f98bb18830165ceae3a1f1a8bba10` |
| x53-stability.log | `6aa8d0fc939826e47eb25d2659c3798c6ad1f6c1207d7acc9ecc7bf5bbb6c533` |
| production-before.json | `0750ed694389f7aa19d4a41f2fb2e23a896f6ba2617bd20d67dea72e213a7adc` |
| production-after.json | `b604c5c962791353cb862f15ad37f2d461c1de24b73b80672c2efba879057f1d` |
| secret-scan.json | `747e4c5fd8952fc14e7b270923ab9019d9f9eea6f42ebf48db97b2074893b2ba` |

Other folders:
- `prelim/`: copies of sealed T5/T6 files that intermediate test runs rewrote. The originals were restored after every run.
- `audit/`: the pathway audit.

## 7. Remaining limitations and owner decisions

1. **No physical phone, LAN or internet acceptance** was performed. Mobile hardware acceptance is **not claimed**.
2. **Contract tightening (owner awareness):** under remote authority a device writes only data and document types. Code, configuration, agent configuration and downloads need the Windows Host.
3. **Disposition (round 4, HIGH):** a device may answer a single one-time ask for an Agent's exact planned, in-envelope, non-sensitive file step even when the workstation narrowed the Agent consent to make it ask. This is the T9 supervision contract and the brief's "approve narrowly scoped, non-sensitive operations" clause; nine T9/T9R tests encode it. The owner may tighten it.
4. **Programs outside Bunny's tracking** may read device-written data files without review. Examples: editors, dev containers, CI or deploy tools, a manually started server, a program launched by workstation UI automation, or a process whose whole ancestor chain lived between two 15 s snapshots. The review gate covers every code run Bunny itself starts, and the config denylist cannot enumerate every external tool.
5. Survivor tracking is in memory. Processes surviving a Host restart are not tracked; remote envelopes are revoked at restart.
6. **Owner-configured Git filters** already present in repo or global config still run on remote Git reads (devices cannot plant them).
7. **Accepted, all fail-closed or availability-only:**
   - a workstation one-time answer given after a workstation envelope expired still runs (a deliberate workstation decision)
   - a device-attributed write inside a skill step stays held while code is live
   - a persistently failing process-table read keeps device changes held
   - some ordinary data writes under dot-directories are refused
8. **Pre-existing open owner decision (unchanged):** device self sign-out keeps approvals the user gave (T9R F-02 documented design).
9. Agent Missions cannot use trusted-desktop session grants (T5 tool-free confinement). A grant consumed and then refused by a later fail-closed gate is burned.

T10 has **not** been started. No production release was installed.
