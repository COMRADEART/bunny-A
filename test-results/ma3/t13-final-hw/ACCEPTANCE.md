# BUNNY-A MA3 T13 — Final Hardware Acceptance Record

- Starting commit: `3e533a9` (`3e533a91be3b77aa9f92e566447e41cd3741890f`), branch `ma3-t13-product`
- Working-tree source delta at record time: three one-prop heading edits only
  (`src/components/island/approvals.tsx` ×2, `src/components/island/surfaces.tsx` ×1 —
  `headingLevel={2}` on page-level empty states, mirroring the HEAD-sealed Tasks fix).
  Native scripts restored byte-identical after a reverted experiment (see §1.5).
  Pre-existing dirty `test-results/ma3/{t5,t6,t7,t9r}` files were left untouched.
- No commit, merge, or PR was created. No MA4 work was started.
- Overall disposition: **CONDITIONAL PASS retained** (Phase 2 BLOCKED; no authorized
  exception recorded). No merge or PR without authorization.

## Test environment

- Windows 11 Pro, build 10.0.26300, interactive desktop session on the owner machine.
- Dev server `http://127.0.0.1:8080/` (Vite, already running at session start; restarted once
  mid-session after it dropped; left running). Built-output evidence reused from
  `test-results/ma3/t13/t13-product-built.json` (no divergence).
- Disposable Host fixtures on loopback ports 43883–43886 (real Host code, fixture data);
  all stopped, ports released. Scratch under `%TEMP%`, removed.
- Narrator: `C:\WINDOWS\system32\Narrator.exe`, session PID 19624, started/stopped by this run.
- Playwright Chromium (headless) for DOM/keyboard-order probes; PowerShell UIA + SendKeys
  for native Island input. Production install (`Bunny-A-Windows-MA3-T13-FINAL-TEST`,
  its Host/gateway node processes) was never signaled, restarted, or written — read-only
  presence checks only.

## Phase 1 — Windows Narrator: PASS with limitations

### Reconciliation: walkthrough vs NOT TESTED

- No 25-stop artifact exists anywhere in the sealed tree. The closest successful dynamic
  walkthroughs are the sealed 12-stop native Tab round (`native-final/tab-round-final.json`,
  PID 40216, all four weapon Buttons + wrap, Enter/Back/Escape/minimize) and the web
  Chat focusable-control traces.
- The "NOT TESTED" labels (`native-peer-check.json` 18:41, `CLOSEOUT_NOTES.md`,
  `MA3_T13_UI_UX_MASTERY_ACCEPTANCE.md`) were written for the peer-check's software-unit
  scope and the then-unrerun final source. They are superseded below for the listed
  behaviors by fresh HEAD-source live runs — except where explicitly kept as limitations.
- One correction: the old `perf/native/keys-tab-collapsed.json` (PID 26780, weapons never
  focused) is evidence of the original Border defect (E02), fixed by the Button repair.

### Fresh HEAD evidence (this run, `test-results/ma3/t13-final-hw/`)

| Check | Result |
|---|---|
| Native UIA: 4 weapon chips named focusable Buttons, 0 unnamed focusable | PASS (`native/uia-collapsed.json`) |
| Native live Tab round (real SendKeys, foreground verified/key): all chips + wrap, no abort | PASS (`native/tab-round.json`, clean re-run) |
| Enter / Space on a chip expands detail; activation focuses "Back to the Notch" (designed path, `Weapons.ps1` focus call) | PASS |
| Escape collapses AND returns focus to originating chip (Gada) | PASS (`native/esc-collapse.json`) |
| WeaponBack button collapses panel; focus returns to originating chip (proven: post-Back Tab lands on Spear, so the root read was stale UIA latency — see §1.5) | PASS |
| Minimize iconifies / restore returns the Island window | PASS |
| Web headings: exactly one h1 per view; 0 skipped levels on Home/Tasks/Approvals/Agents/Settings after fix | PASS (`web/a11y-narrator-probe.json`, re-run) |
| Web control names: 0 unnamed interactive controls on all 6 views; skip link first stop; 41-stop keyboard walkthrough all named, no traps, no positive tabindex | PASS |
| Announcements: `role=status`/`aria-live=polite` regions on voice status, phone banner, studio badge, approvals count, models/session captions; `role=alert` on agent authorization, parse, appearance, conversation, memory errors | PASS (mechanism) |
| Approval mechanics: explicit plan approval, deny→FAILED, pause/resume/stop via real browser | PASS (preserved `live-agentic/final-live` 40/40; HEAD `ApprovalRow` action code unchanged — only h1 branches + reconcile panel added) |
| Narrator live session: Narrator ran (PID 19624), tracked a 4-stop Tab walkthrough of named controls, stayed healthy, stopped via Win+Ctrl+Enter (taskkill cannot stop it — protected process) | EXERCISED, PASS |

### Source changes made (3 props, verified)

`Approvals are loading.` / `No approvals waiting.` / `Agents are unavailable.` empty states
now render `h2` under their page `h1` — the exact pattern HEAD established for Tasks.
Post-fix probe: 0 skipped levels on those views. `test:ui` 405/405, `tsc --noEmit` clean.

### Limitations (kept, not hidden)

1. Phone companion home renders widget-card `h3`s directly under `h1 "Bunny A"` (one skip);
   context-panel card `h3`s precede their `h2 "Context"` in DOM order on desktop pages.
   Content fully named/reachable; restructuring section hierarchy would be redesign —
   explicitly out of scope. Minor.
2. Backspace has no key handler in the Island (Escape/WeaponBack/Up/Down/Ctrl+Return are the
   handled keys); pressing it is a documented no-op, not a trap.
3. Cross-process UIA `FocusedElement` reads lag reality by one sample; focus verdicts above
   were confirmed by subsequent Tab behavior, not single reads.
4. Narrator exposes no speech-transcript API: announcement *content* is proven by the UIA
   names/live-regions it consumes; human-ear prosody/verbosity review was not performed.
5. Live approval/deny with pending items was not re-driven at HEAD (no live Host task);
   mechanics preserved from `live-agentic` + unchanged action code (see table).

## Phase 2 — Real phone pairing: BLOCKED

- Prerequisites absent: no authorized physical Android device (no `adb`, no USB device),
  no remote transport (`BUNNY_REMOTE_ORIGIN` unset; no `remote.json` in dev state or
  installed settings). Both are required; neither was available.
- Nothing was bypassed: no pairing code entered, no device enrolled, no browser-pairing
  shortcut introduced. The `?companion=1` loads in this run were read-only workstation
  context (policy-gated, voice workstation-only).
- Mechanism review (source, read-only): `pairing.create` is workstation-only
  (`http.server.ts`: "Pairing can only be initiated on the workstation"); `/pair` takes a
  single-use 96-bit code (hash-compared, nulled after success, 10-minute expiry),
  per-client (5) + global (100) rate limits, loopback-host + same-origin binding.
- Preserved non-physical coverage (not re-run): `host.test.ts` pairing auth/revocation,
  `connections-host`, T9R `remote-remediation` matrix (offline-refused-after-reconnect,
  concurrent single-winner, revocation ends approvals, lost-ack replay, host-replacement
  pinning, restart-epoch refusal, four-way race), phone browser-simulation + stale/offline
  presentation reports, device policy/caption checks.
- Redaction: this evidence set contains no pairing codes, tokens, credentials, or device
  identifiers (verified by scan; `host-fixture.json` holds only a cleaned TEMP path and
  disposable UUIDs).

## Phase 3 — Final verification

| Check | Result |
|---|---|
| Voice-worker provenance: committed `bunny-voice-worker.exe` SHA-256 `44e3d80a…` equals manifest `binarySha256`; `npm run build:voice` reproduces both records (`up to date`); exe from committed `BunnyVoiceWorker.cs` via recorded csc 4.8.9221.0; shim `34f91420…` rebuilt from committed `whisper-shim.c` against pinned DLLs matching `whisper-pin.json` (whisper v1.9.4). HEAD's 1-line manifest change is the refreshed shim hash — accounted for | PASS |
| Desktop UI: fresh probe, 200s, no overflow, 0 console errors, content rendered (dev); built output clean with no dev/built divergence (preserved `t13-product-built.json`) | PASS |
| One transient dev-only React hydration warning (`caret-color` SSR/client diff, Composer) appears in the 10/17 desktop capture; did not reproduce in 3 subsequent runs; absent from built output | Disclosed, no change (not reproducible) |
| Native Island: `install/` byte-identical to HEAD; fresh keyboard/UIA runs above | PASS, no rerun of CPU suites (`Motion.ps1` untouched; minimized-cost evidence stands) |
| Mobile layout: 390×844 no overflow, headings/names intact (fresh probe + built capture) | PASS |
| Authorization: `npm run check:auth` agrees (sign-in off, dev and build); `pairing.create` workstation-only; T9R matrix preserved; no `authMiddleware`/`requireUserId` in device paths per auth-off posture | PASS, no regression |
| Targeted suites: `test:ui` 405/405, `tsc --noEmit` exit 0, `oauth-pkce.test.ts` 8/8 direct | PASS (with finding below) |
| Full `npm test` / complete regression | NOT re-run (unchanged areas; HEAD commit records green; preserved counts stand) |

### Finding (no edit made — owner decision)

`src/lib/bunny-host/oauth-pkce.test.ts` (added at HEAD, 8 tests, all passing direct) is **not
wired into `npm test`** — that script lists `bunny-host` files explicitly while only
`bunny-missions` uses a glob. The "full npm test green" claim therefore never executed it.
Recommend wiring it in (one line in `package.json`) or confirming intentional exclusion.
Left unchanged per minimal-change / no-unrelated-edits rule.

## Preservation pass (this task — disposition unchanged: CONDITIONAL PASS, phone gate BLOCKED)

- The three heading fixes were re-inspected against the `Empty` contract
  (`headingLevel?: 2 | 3`, default 3): each fixed empty state sits directly under a
  page-level `h1`, so `h2` is correct. Re-probed live post-fix: Home/Tasks/Approvals/
  Agents/Settings show exactly one `h1`, 0 skipped levels, 0 unnamed controls,
  0 console errors; mobile 390×844 no overflow.
- `oauth-pkce.test.ts` wired into `npm test` exactly once (alphabetical slot after
  `model-capability.test.ts`; no glob or second lane covers it). Resolves the §Phase-3
  finding above; no pairing-security code touched.
- Full verification at preservation source:
  - `npm test` library lane: 1636/1637 (scripts lane passed; chain stopped before the
    runtime lane). The single failure was `remote-remediation.test.ts:391`
    (T9R cross-Project artifact): a receipt *file-write* error (`UNKNOWN ... open
    cross-project-artifact.json`), not an assertion failure — unrelated to this
    task's changes (UI props + test-list line cannot affect a Host file-write path).
    Solo re-run of the file: 15/15 PASS including that test. Transient environmental
    lock; non-reproducing.
  - Agent-runtime lane (run separately, same flags): 58/58 PASS.
  - `test:ui` 405/405, `tsc --noEmit` exit 0, ESLint exit 0 on both touched views,
    `check:auth` agrees (sign-in off), `oauth-pkce.test.ts` 8/8.
  - Effective totals: scripts 448 (chain green), library 1636/1637 in-chain + 15/15
    solo, runtime 58/58, UI 405/405.
- Commits (branch `ma3-t13-product`, no merge, no PR, no MA4):
  - Source commit `7f6c06dc36c92bfe74b004ffb78dcfb80bc2e149` (verified code only:
    approvals.tsx + surfaces.tsx + package.json).
  - Record commit (this evidence dir + updated record): the HEAD commit of this
    preservation pass; `git log --oneline -2` on `ma3-t13-product` shows the record
    commit atop the source commit above.
- Phone pairing gate stays BLOCKED (no device, no remote transport); T13 NOT declared
  COMPLETE; pairing security unmodified.
- Note: native run-1 artifacts (explorer foreground steal at Tab step 11) were
  overwritten by the clean re-run; retained as description only — clean-run files are
  authoritative. Full-suite re-runs regenerated some already-dirty T9R receipts by
  design; unrelated dirty/untracked working-tree files were never staged.

## Evidence paths (new, this run)

- `test-results/ma3/t13-final-hw/web/a11y-narrator-probe.mjs` + `a11y-narrator-probe.json` + `shots/` (6 views, keyboard walkthrough, mobile)
- `test-results/ma3/t13-final-hw/web/a11y-supplement.mjs` + `a11y-supplement.json` (tabindex/autofocus/approval semantics)
- `test-results/ma3/t13-final-hw/native/seed-host.mjs` (cop
...[truncated 911 chars]