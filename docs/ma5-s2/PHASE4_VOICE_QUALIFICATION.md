# MA5-S2 Phase 4: real-world voice, acoustic qualification and latency under load

Branch `ma5-s2-phase4-voice-qualification`, cut from `main` at **`5be54f6`** (PR #64 merged). Final commit: see the PR
(the head SHA is recorded there and in §9). Target: native Windows 11 Bunny A, RTX 4050 laptop (6 GB), Ollama 0.40.13.
No merge, no beta, no Android Phase 5.

**Evidence classes.** Everything in this phase is software evidence: unit tests, the real contained voice worker with its
fixture flags (`--input-silence` / `--input-synth`, `--output null`), real Hosts, the real local model and the compiled WPF
app read through UI Automation. **No microphone or speaker was opened.** The owner has not authorized an attended session,
so every physical acoustic gate is **BLOCKED** (§7), and no number below is offered as acoustic evidence.

## 1. Summary

| Workstream | Outcome |
|---|---|
| P4-1 Whisper | Root cause found: the shim build was never reproducible. Fixed; candidate pin proven reproducible and working; **not adopted** (owner decision). The checkout fails closed to SAPI and says why. |
| P4-2 Latency under load | Bunny now queues local inference itself and puts voice first, never pre-empting. Same workload: first audible response **12.5 s → 1.6 s P50**; answer audio **12.5 s → 6.5 s P50**; background throughput −2.5 %, no starvation. The answer itself still misses 3 s. The small-model experiment shows why that is a GPU-memory limit here. |
| P4-3 Acoustic harness | Built, gated and self-checked end to end with fixtures. Waiting for the owner. |
| P4-4 Privacy gate | Enforced in code: no authorization, no Host code loaded and nothing opened. Nothing was opened in this phase. |
| P4-5 Windows UX | THINKING now shown live (it was PARTIAL); keyboard-only operation verified; 12/12 UIA stages. Narrator walk prepared, not run. |
| P4-6 Reliability and cleanup | F04 temp leak root-caused and fixed; 55 proven leftovers removed. Cancellation and continuity re-proven under the new queue. |

## 2. P4-1 Whisper runtime

**Finding.** The committed build record pins `bunny-whisper-shim.dll` at `35c03239…`. The staged shim was `982dfbff…`. Every
other runtime file (whisper.dll, ggml*.dll, 9 CPU-variant DLLs) and the model match `whisper-pin.json` exactly.

- No copy of `35c03239…` exists on this machine. The search covered the four checkouts and worktrees, five packaged releases
  under `%LOCALAPPDATA%` and the extracted T2R1 release; each holds a different shim.
- It cannot be rebuilt. With the same pinned gcc (`f96a3bdb…`, MSYS2 16.1.0) and identical inputs, two builds always differed.
  `objdump` and byte diffs show two causes: (1) ld stamps the link time into the PE header and debug directory; (2) ld's
  auto-image-base derives the preferred base from the **full output path**, and `build-voice-worker.mjs` linked inside a
  random `mkdtemp` folder. So no shim build was ever reproducible, including the pinned one.
- `build-voice-worker.mjs` (also run by `npm test`'s pretest) then wrote whatever hash it built into the record. That is
  how Phase 3's local whisper pass came to select whisper: a silent local re-pin, not a verified runtime.

**Fix (commit `84defbc`).**
- The shim links with `-Wl,--no-insert-timestamp -Wl,--disable-auto-image-base`. ASLR is kept (`DllCharacteristics 0x160`:
  dynamic base, high-entropy VA, NX); only the preferred base is fixed (0x180000000). Builds are now byte-identical across
  temp folders, working directories and source locations. The record now lists the flags.
- A recorded shim pin is never replaced silently. A build that differs is **refused and not installed**, and the record keeps
  the old pin, unless `--repin-whisper-shim` is passed after owner approval. The Host's selection was already fail-closed and
  is unchanged.

**Evidence (`evidence/voice/whisper-verification.json`, `scripts/ma5-s2/verify-whisper.mjs`).** This is read-only against the
checkout: two disposable roots, synthesized speech, no microphone.

| Check | Result |
|---|---|
| Checkout selection with the committed pin | **SAPI**, reason `bunny-whisper-shim.dll differs from the pin` (fail closed, stated) |
| All 12 runtime DLLs and the model vs `whisper-pin.json` | match |
| Candidate shim, two independent builds | `45f64172a5b41144f6057399f5a92776cf394c4991dce2d5b50346d3be8867e3` both times |
| Candidate linked against | the pinned whisper.dll / ggml.dll / ggml-base.dll; same compiler hash as the recorded one |
| Disposable root, committed pin | SAPI (refused) |
| Disposable root, candidate pin, real launcher (selection + exe integrity re-run) | **whisper.cpp v1.9.4 / ggml-base.en, local** |
| 5 scripted phrases (SAPI-synthesized, not human), whisper | 5/5 exact, mean WER 0; confidence 0.55–0.97; speech end → result 816–1 298 ms |
| Repo runtime after the run | unchanged; 0 disposable roots left |

**Owner decision required.** Adopt `45f64172…` as the new shim pin (run `node scripts/build-voice-worker.mjs
--repin-whisper-shim`, check that it prints that hash, and commit `native/voice/bunny-voice-worker.json`). Provenance: source
`whisper-shim.c` `eaefdfef…`; whisper.cpp v1.9.4 (927cfce) headers verified by `stage-whisper.mjs`; gcc `f96a3bdb…`; flags as
recorded. Limitation: reproducible on this toolchain (MSYS2 gcc 16.1.0, binutils 2.46). Another gcc or binutils gives
another hash, and packaging then fails closed instead of shipping it. Until the owner approves, the Host uses SAPI. In MA3
SAPI measured as unusable on this microphone (WER 0.95), so A18 stays blocked either way.

## 3. P4-2 Conversational latency under agent load

**Profile.** Phase 3 showed that about 95 % of the under-load delay was waiting for the model's first token. A direct probe
confirms the cause. This Ollama serves **one generation at a time, FIFO**: a second request's first token arrives only
after the first finishes (6.8 s). Bunny sent every agent request straight to Ollama, so a voice question queued behind
all of them.

**Change (commit `067230e`).** `src/lib/orch/local-inference.ts` is the one admission point for local generations
(`execute()` and the MA4 tool chat):

- **1 slot.** One model context in GPU memory at a time. Since Ollama already serves one at a time here, this costs no
  throughput (measured below). The GPU memory peak was unchanged (4 101 vs 4 103 MiB used of 6 141).
- **Voice first.** A waiting interactive request is admitted before waiting background requests; each class is FIFO.
- **No pre-emption.** A running generation is never cancelled, so a voice turn waits at most for the one in flight.
- **No starvation.** After 3 interactive admissions in a row while background work waits, the oldest background request goes.
- **Not a permission path.** It runs after every model-pin, local-only and permission check, and changes none. Only the
  manager marks a turn interactive (`approveVoiceTurn`); no HTTP field can. Provider receipts keep their meaning:
  `requestedAt` is still taken before the wait, as it was before Ollama's internal queue.
- **Short, true acknowledgment.** If a question is still queued 1.5 s after admission, the Host says once: *"One moment.
  The local model is finishing other work first."* That is a status, not an answer. It is never said once model text has
  arrived, when the request already reached the model, or after a barge-in. It takes seq 0 and the answer follows on seq 1…,
  and it is timed separately from the answer's first audio.

**Benchmark (`scripts/ma5-s2/measure-voice-priority.mjs`).** The identical script ran against the **previous code** (a
`5be54f6` worktree) and the **Phase 4 code**, back to back with the same workload:

- 2 agent-style generations (≈200 tokens) kept in flight at all times on the canonical path
  (`manager.submit → approve → Ollama adapter → execute`, local-only);
- 12 spoken-path questions (typed text, Host voice path, real worker, null sink), 3 s apart, each allowed to finish;
- the same model on both sides (`huihui_ai/qwen2.5-abliterate:7b`, the router's pick).

Clock starts at the Host's receipt of the question.

| ms, n = 12 per side | Before: Ollama FIFO | After: Bunny queue |
|---|---|---|
| First token P50 / P95 | 12 013 / 16 880 | **4 861 / 9 204** |
| **First audible** (acknowledgment or answer) P50 / P95 | 12 479 / 17 451 | **1 612 / 2 224** |
| Answer's own first audio P50 / P95 / max | 12 479 / 17 451 / 17 451 | **6 545 / 9 603 / 9 603** |
| Completed answer P50 / P95 | 17 734 / 21 821 | **12 688 / 15 738** |
| Delay acknowledgments spoken | — | 10 of 12 (the other 2 found the model free) |
| Idle Host, answer audio (warm) | 1 342, 1 106 | 1 294, 1 016 |

| Background fairness | Before | After |
|---|---|---|
| Generations submitted / completed | 33 / 33 | 26 / 26 (none cancelled) |
| Throughput in the voice window | 7.91 / min | 7.71 / min (−2.5 %) |
| Submit → first output P50 / P95 / max | 8 094 / 9 655 / 10 402 | 8 170 / 11 410 / 11 572 |
| Submit → done P50 / P95 | 14 435 / 18 093 | 14 841 / 19 007 |
| Starvation overrides needed | — | 0 (voice never took 3 slots in a row here) |

The fairness cost to agents is bounded and small: about 1.2 s added at the background P95, −2.5 % throughput. Voice
admissions waited 0–8.5 s for the generation in flight (`queue.interactiveAdmissions`).

**Target.** The 3 s target is met for the first audible response (P95 2.2 s, an accurate status line). It is **not met for
the answer itself** (P50 6.5 s). Without pre-emption, a question must wait for the agent generation already on the GPU, about
3–8 s here.

**Smaller dedicated voice model, a separately reported experiment** (commit `885c3b5`,
`evidence/voice/voice-model-experiment.json`; direct Ollama, no product change). I pulled `qwen2.5:1.5b`, 986 MB; remove it
with `ollama rm qwen2.5:1.5b` if not wanted.

- Idle GPU: first token **24 ms**, answer ~0.11 s.
- Under the same 2-lane load on the 7B: **0 of 6 served within 120 s.** At Ollama's default context here the 7B takes 6.5 GB
  (4.0 GB on the GPU, the rest on the CPU). The two models cannot share 6 GB, and Ollama does not unload a busy model to load
  another, so the small model starves. A first attempt also left Ollama's runner stuck "Stopping…" until the requests were
  cancelled.

So a dedicated voice model is **not viable on this GPU as configured**. Options for the owner, each changing agent behaviour:
(a) cap the agents' context (`num_ctx`) so both models fit; (b) pre-empt agent generations for voice (cancel and retry the
step), which the brief rules out; (c) more VRAM.

## 4. P4-3 / P4-4 Physical acoustic qualification: prepared, BLOCKED

`scripts/ma5-s2/acoustic-session.mjs` (commit `0f48f7d`) covers the ten required measurements with a scripted, nonpersonal
phrase set:

- 8 STT phrases × 3;
- 4 interruptions × 3;
- 4 backchannels × 3;
- 2 paused sentences × 3;
- 10 silent-echo replies;
- 10 latency turns;
- 5 turns under agent load.

Each category has at least 12 trials so rates mean something. Each metric is labelled `acoustic` or `software`. Barge-in is
reported as worker-monotonic speech onset → **render-meter silence** (`onsetToSilenceMs`, the Host's existing
`VoiceBargeInReceipt`) against the 200 ms target. A software cancel acknowledgment is never reported as speaker silence.

**Privacy gate (enforced in code, `scripts/ma5-s2-acoustic-session.test.mjs`, 4 tests).** *Phase 4R1 replaced the volume
field, the deadline, the shutdown and the evidence format described here; see §10. The steps below are current.*
- No authorization file: refused before any Host code loads.
- The authorization must name the microphone, speakers, maximum minutes (1–120), script `p4-v1` and playback volume. It must
  also set `transientInMemoryProcessing`, `noRawAudioSavedOrUploaded`, `ownerUnmutesMicrophoneManually` and
  `ownerPresentForWholeSession` to `true`, and be signed within the last 12 hours.
- Before anything is captured, the default devices must equal the authorized ones. Privacy "deny" is refused. A muted
  microphone makes the script wait for the owner and never unmutes.
- It stops at the authorized duration and closes voice in `finally`.
- No audio is written. Recognized text is stored only when it is plainly the scripted phrase (WER ≤ 0.5); anything else is
  stored as `[off-script: not stored]`.

**Self-check without devices** (`--fixture`: synthesized input, null sink, prompts auto-answered; evidence labelled
"SELF-CHECK ONLY"; `evidence/voice/acoustic-harness-selfcheck-{ptt,handsfree}.json`). Sections 1, 7, 10, 3, 4 and 9 ran end to
end with 0 workers left. Off-script redaction worked, and mute, close and recovery receipts were read. The self-check found
and fixed two harness defects before any owner time was spent: an operator-precedence slip in the fixture device bypass,
and a read of a confidence field the snapshot does not carry. With the duplex lane, fixture input never opens the real
microphone (`AecSource` is used only when no fixture flag is set).

### Owner-attended session: exact steps

1. Choose the room, headset or speakers. Set the Windows output volume yourself, at or below the limit you will authorize.
   Close BunnyA.exe and any voice worker.
2. Print the template: `node scripts/ma5-s2/acoustic-session.mjs --print-template > %TEMP%\bunny-acoustic-auth.json`.
   Fill in the exact Windows device names (Sound settings → Input / Output), `maxMinutes`, `maxPlaybackVolumePercent` (an
   integer 1–100) and `authorizedAt` (now, ISO). Confirm the four `true` statements. The session refuses to start, and stops,
   if the real output volume is above the limit or the output device changes. Bunny never changes the volume.
3. Validate without opening anything: `node scripts/ma5-s2/acoustic-session.mjs --authorization %TEMP%\bunny-acoustic-auth.json --check`.
4. Unmute the microphone yourself in Windows. Bunny will not.
5. Run: `node --experimental-strip-types scripts/ma5-s2/acoustic-session.mjs --authorization %TEMP%\bunny-acoustic-auth.json`.
   Speak only the phrases shown. Enter = go, `s` = skip, `q` = end. Sections can be split across sessions with `--sections 1,7`.
6. Evidence: `docs/ma5-s2/evidence/voice/acoustic-session.json` (no audio). Delete the authorization file afterwards.
7. Run it once with SAPI, and again after approving the whisper pin (§2), to measure human WER per engine (A18).

**Narrator walkthrough (attended, not run).** Start Narrator (Ctrl+Win+Enter) and open Voice Studio.
1. Tab through Open Voice Session, Start Hands-Free, Start/Stop Listening, Barge-In, Mute Mic, the question box and Ask.
   Each must be announced by name (v12 verified the names and focus through UIA).
2. Ask "What failed?" with the keyboard. Narrator should announce the pill changes Thinking → Speaking → On, using the
   live-region text, and stay silent on level changes.
3. Move the notch to each of the four edges in Settings, and repeat step 2 on one vertical edge.
4. With Windows high contrast on, confirm the pill uses system colours.
5. With "Show animations" off, confirm the agent chips do not animate.

## 5. P4-5 Windows user experience

`scripts/ma5-s2/verify-voice-windows.mjs`: compiled app, disposable real Host, real worker with fixture flags, everything read
through UI Automation. **12/12 PASS**, 0 workers after shutdown (`evidence/voice/windows-voice.json`).

| Stage | Result |
|---|---|
| v1–v10 (Phase 3 set: private start, push-to-talk, Host facts, model turn + barge-in, hands-free, mute, stop hands-free, close, left edge, Host disconnect) | all PASS |
| **v11 THINKING while queued** (new) | An agent generation held the model. The notch showed `THINKING > SPEAKING (delay line, 1.6 s) > THINKING > SPEAKING (answer, 9.2 s)`, and the agent generation completed. THINKING was also caught in v4 this run. |
| **v12 keyboard** (new) | Every enabled Voice Studio control takes keyboard focus and has an accessible name. Disabled controls (Stop Listening, Barge-In while idle) correctly do not take focus. A keyboard-only question was answered from Host facts. |

| Voice state | Live evidence |
|---|---|
| Listening, Speaking, Muted, Disconnected | live (v5, v4, v6, v10) |
| Thinking | **live (v11, v4)**, new in Phase 4 |
| Recognizing | unit-checked only: SAPI's decode is ~14 ms, below UIA sampling; whisper (~0.9 s) awaits the pin decision |
| User interrupting, Device unavailable | unit-checked only: they need real speech over output or a real device fault (attended session, section 4 / 10) |

Native build: 0 warnings, 0 errors; `BunnyA.Tests` 134 checks pass. They cover all four orientations, reduced motion and
high-contrast brushes. No native code changed in Phase 4, so the notch, agent animations and the four edges are as Phase 3
left them.

## 6. P4-6 Reliability, safety and cleanup

- **Cancellation and stale generations under the new queue.** A request stopped while queued leaves the queue and never runs.
  Release is idempotent; a slot is never freed twice (`local-inference.test.ts`). A barge-in before the delay threshold
  silences the line, and stale turn or generation fencing applies to it (`P4-V02`). The existing generation, worker-exit,
  relaunch and Host-epoch suites pass (§8).
- **Background-agent continuity.** 26/26 and 33/33 benchmark generations completed. 68/68 completed during the harness
  self-check. The v11 agent generation completed. Voice cancelled none.
- **Worker shutdown and Host restart.** v8 and v10 (0 workers, nothing reopened after restart); every harness ended with 0 workers.
- **F04 temp leak (commit `d290dee`).** `provider-containment.test.ts` `workspace().cleanup()` removed its folder once and
  swallowed the error. A test that kills a fixture and cleans up straight away hits Windows refusing to delete an exe that
  is still exiting (EBUSY/EPERM). It now uses `rmSync`'s bounded retries (≤ ~5.5 s). Existing leftovers:
  `scripts/ma5-s2/clean-f04-temp.mjs` deletes a folder only when its name, plain-directory status, exact file set,
  `provider.cjs` bytes (equal to the test's source), `host.mjs` binding to the same folder and PE fixture all prove it is that
  workspace. **55 found, 55 proven, 55 removed, 0 failed.** Nothing else was touched. Decoys are refused (test).
  Leftovers after this phase's full `npm test`: see §8.
- **Security and authorization.** No new authority: the queue only orders already-authorized requests, and the delay line
  is Host-authored status text. CI static checks (§8) are clean.

## 7. Acceptance matrix

| # | Requirement | Result | Evidence |
|---|---|---|---|
| P4-1a | Root cause of the whisper fingerprint mismatch | **PASS** | §2: timestamp + path-derived image base; silent re-pin in the build |
| P4-1b | Never silently accept a new fingerprint; fail closed | **PASS** | build refuses; checkout selects SAPI with a reason |
| P4-1c | Actual whisper selection shown with synthetic audio | **PASS** (disposable root, candidate pin) | whisper-verification.json |
| P4-1d | Verified whisper restored in the product | **BLOCKED: owner approval of pin `45f64172…`** | §2 |
| P4-2a | Bounded voice priority, no pre-emption, no starvation, bounded GPU/concurrency | **PASS** | §3, local-inference.test.ts |
| P4-2b | Accurate acknowledgment when delayed | **PASS** | P4-V01/V02, v11 |
| P4-2c | Before/after P50/P95 first token, first playback, completed; background throughput and fairness | **PASS** | §3 |
| P4-2d | Spoken answer first audio ≤ 3 s under agent load | **MISS**: 6.5 s P50 (from 12.5 s); first audible 1.6 s | §3 |
| P4-2e | Smaller dedicated voice model evaluated | **DONE**: not viable on 6 GB as configured | §3 |
| P4-3 | Repeatable owner-attended harness, ten measurements, scripted phrases | **PASS** (built, gated, self-checked) | §4 |
| A16 | AEC effectiveness | **BLOCKED** (owner session) | — |
| A17 | Real spoken barge-in, onset → audible silence ≤ 200 ms | **BLOCKED** (owner session) | — |
| A18 | Human STT accuracy | **BLOCKED** (owner session; whisper also needs the pin) | — |
| A19 | Speech → first audible response, acoustic | **BLOCKED** (owner session) | — |
| A20 | Device unplug and recovery on hardware | **BLOCKED** (owner session, section 10) | — |
| P4-4 | No real audio without authorization; no raw audio or personal transcripts | **PASS** | gate tests; nothing opened |
| P4-5a | Notch and Voice Studio show real Host state | **PASS** for 6 live states; **PARTIAL** for Recognizing, Interrupting, Device unavailable (unit only) | §5 |
| P4-5b | Keyboard and UIA checks | **PASS** | v12 |
| P4-5c | Narrator walkthrough | **PREPARED, not run** (attended) | §4 |
| P4-6 | Reliability, F04 leak, proven-only cleanup | **PASS** | §6 |
| P4-7 | Regression, native build, security, packaging, CI | see §8 | — |

**Overall: PARTIAL.** The software work is complete and measured. Under-load answer latency improved about 2× but still
misses 3 s on this GPU. Whisper waits for one owner approval. Every physical acoustic gate waits for an attended session.
Phase 4 is **not** fully accepted.

## 8. Regression, packaging and CI

Local, Windows 11, on the final Phase 4 source:

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm test` stage 1 (scripts) | **481 / 482**. The one failure is `whisper: the staged runtime … match … the build record`: correct and expected, because no approved shim is installed (§2). It turns green once the owner re-pins. The pretest printed the refusal. CI excludes this file (it needs the operator-staged runtime). |
| `npm test` stage 2 (MA3 Host and Mission suites, incl. all voice and F04 containment) | 1 693 pass, 1 skip, 0 fail |
| `npm test` stage 3 (agent runtime and teams) | first run: 61/62. **T11-I07 hung for about 2 h** (no sleep event in the System log). Re-run of the whole stage as CI runs it: **62/62 in 2.5 min**; the file alone: 8/8. The test uses a scripted adapter that never reaches `execute()` or the new queue (`agent-team.fixture.ts`), so this is recorded as a pre-existing, non-reproducing restart/probe flake, not a Phase 4 regression. |
| `npm test` stage 4 (`test:ma4`) | 317 pass, 1 skip, 0 fail |
| New Phase 4 tests | queue 3, session P4-V01/V02, chunker 1, shim reproducibility/refusal 1, F04 cleanup 1, acoustic gate 4: all pass |
| `npm run test:ui` | 421 / 421 |
| `npm run build` | exit 0 |
| `native/windows/build.ps1` (Debug + `BunnyA.Tests`) | 0 warnings, 0 errors; 134 checks pass |
| `native/windows/package-dev-candidate.ps1` | 4 files identical across two Release builds; unsigned dev candidate zip built to a scratch folder, not committed |
| `scripts/ma5-s2/verify-voice-windows.mjs` | 12 / 12 |
| CI static security checks, run locally | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities; no committed secrets or env files; external inference still disabled; evidence holds no user paths |
| `%TEMP%\bunny-f04-*` after the full suite | **0** (55 before the fix) |
| Voice workers after every harness | 0 |

Hosted CI: see the PR (results recorded in the PR description once the run finishes).

## 9. Remaining release blockers (updated by Phase 4R1, §10.8)

1. Owner-attended acoustic session (A16–A20, Narrator walk), §4.
2. ~~Owner approval of the reproducible whisper shim pin `45f64172…`~~: **resolved**. The owner authorized it on
   2026-10-29 and it was adopted in `6e4b553`. Whisper is now selected over SAPI (§10.9).
3. Under-load answer latency: 6.5 s P50 vs 3 s. It needs a product decision on agent context size, voice pre-emption or
   hardware (§3).
4. Live evidence of Recognizing / Interrupting / Device unavailable on the notch (needs the attended session).

## 10. Phase 4R1 correction: acoustic safety hardening and whisper release readiness

Continues PR #65 from `10b137c`. Software only: **no microphone or speaker was opened, no Windows microphone or volume
setting was changed, the whisper pin was not adopted.** The local inference queue, voice priority, fairness and
full-duplex code are unchanged. Final head: see the PR (recorded there with the CI result).

### 10.1 Hard session deadline (Task 1, commit `8002944`)

The Phase 4 harness checked its deadline only before a Host command, so a session waiting at the keyboard, on the Host
or on the model could outlive its authorization. Now (`scripts/ma5-s2/acoustic-session.mjs`):

- **Independent watchdog.** `createSessionGuard` arms a timer for the session budget and aborts one `AbortSignal`. Every
  wait races it: keyboard prompts (`readline` question with the signal), Host commands (`fetch` with the signal), polls,
  sleeps, Host start-up and the background-agent lanes. A stop of any kind (expiry, owner `q`, unauthorized endpoint, error)
  starts the shutdown at once, from the abort itself, not when the main flow unwinds.
- **Monotonic time.** Elapsed time is `performance.now()`. `check()` also catches a timer that fired late because the event
  loop was blocked. The budget is `min(maxMinutes, authorizedAt + 12 h − now)`, so it can never run past the
  authorization's own validity. The wall clock is read once, at start.
- **Fail-safe, bounded, idempotent shutdown** (`createShutdown`). Every caller gets the same receipt. The steps:
  1. `voice.interrupt` silences playback, then `voice.session.close` ends capture and shuts the worker down.
  2. The Host closes; a Host that was still starting is awaited and closed too.
  3. Any `bunny-voice-worker.exe` still present is force-terminated by pid. A session starts only with zero workers, so
     every one is its own.

  Each step has 5 s; a hanging or failing step does not block the next. A forced or timed-out shutdown is never reported
  `clean`. It exits 3, and the worker's job object (kill-on-close) ends with the process. A session that did not complete
  exits 2.

| Deterministic test (no device; fake Host, real `readline` on an idle stream) | Result |
|---|---|
| Expiry while waiting for keyboard input: prompt cancelled at the deadline, voice closed | pass |
| Expiry during active capture: capture ended by the session close | pass |
| Expiry during playback: `voice.interrupt` before `voice.session.close`, playback stopped | pass |
| Expiry during model inference: the pending call is abandoned; no further Host command is sent | pass |
| Hanging shutdown: each step bounded, leftover worker force-terminated, idempotent (one close, one kill) | pass |
| A failing step does not stop the rest | pass |
| Monotonic: a late timer cannot extend the session; the budget is cut by authorization validity | pass |

Mutation check: removing the prompt's race fails the input-expiry test; unbounding a shutdown step makes the shutdown test
time out.

**Real Host and worker self-checks** (`--fixture`: synthesized input, null sink, nothing opened; labelled `simulated`):

| Run | Stop | Shutdown | Workers after |
|---|---|---|---|
| `--sections 7,10`, `evidence/voice/acoustic-p4r1-selfcheck-complete.json` | `COMPLETED` (58 s); 52 endpoint reads, max 34 % | clean: 94 ms + 7 ms | 0 |
| `--sections 1 --fixture-budget-ms 15000`, `…-selfcheck-expiry.json` | **`SESSION_EXPIRED` at 15 006 ms**, mid-section | clean: 331 ms + 7 ms | 0 |

The first self-check run found a harness defect, which is now fixed and covered by a test. Section 10 closes the voice
session on purpose, and the Host clears its endpoint report on close. The new monitor read that as an unauthorized output
and stopped the session. The monitor now enforces only while a session is open: with no worker, nothing can play.

### 10.2 Real playback volume (Task 2)

- The authorization schema is now `bunny-acoustic-authorization/2`. `maxPlaybackVolumePercent` must be an integer 1–100.
  The free-form `playbackVolume` is refused by name, and a `/1` file is refused.
- Before anything can play, the worker's read-only Core Audio query (`IAudioEndpointVolume::GetMasterVolumeLevelScalar`;
  the worker calls no volume or mute setter) must report all of the following:
  - the authorized output, present;
  - the authorized input;
  - a readable volume at or below the limit.

  An unreadable or out-of-range volume fails closed (`OUTPUT_VOLUME_UNVERIFIED`). Rounding is `ceil` with a float32
  tolerance: 0.30 reads as 30 %, and 0.305 as 31 %, which is refused at a 30 % limit.
- **Monitored.** While a session is open, the endpoints are re-read every second (`voice.devices`, then the snapshot). The
  worker's own change event ignores volume, so it cannot be relied on for this. A switched output, a raised volume or an
  unreadable volume stops the session (`ENDPOINT_NOT_AUTHORIZED`), which runs the shutdown above. During the attended
  device-recovery step only, an input change is tolerated, because unplugging the microphone is the point of that step;
  the output rules still apply.
- Tests use fixture measurements only: limits and rounding, unknown volumes, wrong or absent output, wrong input, an output
  switch, a raised volume and an unreadable volume mid-session, and recovery tolerance. The monitor never sends a volume
  command.

### 10.3 Evidence privacy (Task 3)

- Recognitions are stored as `{ phraseId, refWords, wordErrors, outcome }`. **Recognized text is no longer stored at all**;
  Phase 4 stored on-script text.
- Device names are no longer stored. Evidence records `inputAuthorized` / `outputAuthorized`, the volume percent and the
  mute and privacy states. The authorization echo is reduced to the two limits.
- Failures are recorded as `{ code, detail }`. The detail is redacted of paths (Windows, UNC, POSIX home and temp, `file://`),
  e-mail addresses, bearer tokens, long identifiers containing a digit and the authorized device names, and capped at
  200 characters. Stop codes survive. Console errors use the same redaction.
- Before writing, `assertPrivateEvidence` refuses any recognized-text field, device name, path, address, credential or
  free text longer than 200 characters. On refusal, only a stub (codes, stop, shutdown) is written. `writeEvidence` still
  refuses credentials and the Host token.
- Labels: section `class` is `acoustic`, `software receipt with real capture` or `acoustic capture + software receipts`. In
  a `--fixture` run every class is `simulated`, and the top-level `evidenceClass` says so.
- The prohibition on raw audio is unchanged. The worker processes audio in memory, and nothing writes audio.

### 10.4 Whisper fingerprint (Task 4, commit `1de15ae`): verified, PENDING owner approval

`scripts/ma5-s2/verify-whisper-fingerprint.mjs` builds only: no worker, no device. Evidence:
`evidence/voice/whisper-fingerprint-verification.json`. Every check passes:

| Check | Result |
|---|---|
| Source `whisper-shim.c` | `eaefdfef…` = recorded `sourceSha256`; unchanged vs `origin/main` |
| Source tarball v1.9.4 (927cfce) | `57e280ce…` = pin |
| Header closure (`gcc -MM`: the 5 project headers gcc actually reads) | each byte-identical to the pinned tarball; no other project header |
| Linked `whisper.dll`, `ggml.dll`, `ggml-base.dll` | = `whisper-pin.json` |
| Compiler | gcc 16.1.0 (MSYS2 Rev5) `f96a3bdb…` = recorded |
| Flags | equal to an independently written list; include `--no-insert-timestamp`, `--disable-auto-image-base` |
| Build A: the build script's own function, short temp root | `45f64172a5b41144f6057399f5a92776cf394c4991dce2d5b50346d3be8867e3` |
| Build B: literal gcc command, long nested root, separate cwd and `TEMP` | `45f64172a5b41144f6057399f5a92776cf394c4991dce2d5b50346d3be8867e3` |
| PE header, both builds | TimeDateStamp 0; ImageBase `0x180000000`; DllCharacteristics `0x160` (ASLR kept); no build path embedded |
| `native/voice/bunny-voice-worker.json` | **unchanged** (still pins `35c03239…`) |

Both builds ran on this machine with the same compiler binary. "Independent" here means different code paths, folders,
working directories and temp directories, not a second machine or toolchain.

**Provenance note.** The first build B wrote `out.dll`, and its hash differed, because a PE export directory records the
DLL's own file name. With the same output name the hashes are identical. The fingerprint therefore depends on the output
file name `bunny-whisper-shim.dll`, which the build script fixes.

**Prepared for review, not adopted.** No owner approval of `45f64172…` is recorded. Proposed change:
`whisperShim.binarySha256 35c03239… → 45f64172…`; every other `whisperShim` field is unchanged. Once the owner approves:

1. Run `node scripts/build-voice-worker.mjs --repin-whisper-shim`. It must print `build:whisper-shim built`.
2. Check that the record holds `45f64172…`.
3. Commit `native/voice/bunny-voice-worker.json` alone, as a separate commit.
4. Rerun `scripts/voice-worker.test.mjs` (whisper selection and integrity) and
   `node --experimental-strip-types scripts/ma5-s2/verify-whisper.mjs`.

Until then the build refuses the shim, the record keeps the old pin, and the Host selects SAPI and says why (pretest output
in this run: `build:whisper-shim refused: built shim 45f64172… differs from the recorded pin 35c03239…`).

### 10.5 Latency (Task 5)

No inference, queue or voice-priority code changed in 4R1, so the §3 measurements stand and were **not re-measured**:

- first audible (status acknowledgment) **1.6 s P50**;
- answer's own first audio **6.5 s P50: an unresolved MISS** against 3 s;
- background throughput −2.5 %, 0 starvation overrides.

The harness's section 9 now reports the status acknowledgment (`statusAckAudibleMs`), first model token, first audible
**answer** and completed response separately, plus background completed per minute. The acknowledgment is never counted as
the answer.

### 10.6 Regression (Task 6), local Windows 11, on the 4R1 source

| Check | Result |
|---|---|
| `scripts/ma5-s2-acoustic-session.test.mjs` (authorization, deadline, volume, monitor, privacy) | **17 / 17** (was 4) |
| `npm run pretest` | exit 0; whisper shim refused against the recorded pin, as designed (§10.4) |
| `npm run typecheck` | exit 0 |
| `npm test` stage 1 (scripts, CI form: without `voice-worker.test.mjs`) | **418 / 418** |
| `npm test` stage 2 (MA3 Host and Mission suites, all voice and F04 containment) | **1 693 pass, 1 skip, 0 fail** |
| `npm test` stage 3 (agent runtime and teams) | **62 / 62** (T11-I07 did not hang) |
| `npm test` stage 4 (`test:ma4`) | **317 pass, 1 skip, 0 fail** |
| `scripts/voice-worker.test.mjs` (local hardware-voice gate; fixture input, null sink) | **76 / 77**. The one failure is `whisper: the staged runtime and model match … the build record`: expected while the pin is pending (§10.4) |
| `npm run test:ui` | 421 / 421 |
| Routing policy tests | pass |
| Local inference scheduling and fairness (`local-inference.test.ts`, P4-V01/V02, in stage 2) | pass |
| `npm run build` | exit 0 |
| `native/windows/build.ps1` (Debug + `BunnyA.Tests`) | 0 warnings, 0 errors; **134 / 134** |
| `scripts/ma5-s2/verify-voice-windows.mjs` (compiled app, UI Automation, fixture voice) | **12 / 12**, 0 workers after; `evidence/voice/windows-voice-p4r1.json` (Phase 4's file kept) |
| `scripts/ma5-s2/verify-whisper-fingerprint.mjs` | all 11 checks pass |
| Static security (CI checks run locally) | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities; no committed secrets or env files; external inference disabled |
| `eslint` on changed files | 0 errors, 0 warnings |
| `npm run check:auth` | **not run**: it reads a running dev server's `VITE_AUTH_ENABLED`, and none was running (exit 2, "could not read"). Not a CI check; no auth code changed |
| `%TEMP%\bunny-f04-*` after the suite; voice workers; BunnyA.exe | 0; 0; 0 |
| Packaging | not re-run: no native, installer or package input changed since Phase 4 |

Hosted CI: recorded in the PR.

### 10.7 Updated acceptance matrix

Rows not listed are unchanged from §7.

| # | Requirement | Phase 4 | Phase 4R1 | Evidence |
|---|---|---|---|---|
| R1-1 | Hard acoustic-session deadline: watchdog, cancellation, fail-safe stop, bounded and forced shutdown, monotonic, idempotent | — | **PASS** (software) | §10.1; 17 tests; live expiry self-check |
| R1-2 | Real playback volume verified against a numeric limit, fail closed, monitored, never changed | — | **PASS** (software, fixture measurements) | §10.2 |
| R1-3 | Evidence privacy: no recognized text, device names, paths, addresses or tokens; classes labelled | PASS (on-script text stored) | **PASS**, stricter | §10.3 |
| P4-1d / R1-4 | Whisper fingerprint independently verified | BLOCKED | **Verified; adoption PENDING owner approval** | §10.4 |
| P4-2d | Spoken answer ≤ 3 s under load | MISS (6.5 s P50) | **MISS, unchanged, not re-measured** | §3, §10.5 |
| P4-4 | No real audio without authorization | PASS | **PASS**; nothing was opened in 4R1 either | §10 |
| A16–A20, P4-5c | Physical acoustic gates, Narrator walk | BLOCKED | **BLOCKED** (owner-attended session) | §4 |
| P4-7 | Regression, native build, security | §8 | **PASS** locally, with the expected whisper-pin failure; hosted CI in the PR | §10.6 |

**Overall: still PARTIAL.** Every software safety gate now passes, and the harness is safe to hand to the owner. Phase 4
is not accepted until the decisions below are made.

### 10.8 Decisions that remain the owner's

1. ~~**Whisper pin.**~~ **Decided:** the owner authorized `45f64172a5b41144f6057399f5a92776cf394c4991dce2d5b50346d3be8867e3`,
   and it was adopted as a separate commit (§10.9).
2. **Attended acoustic session** (A16–A20, Narrator). Sign a `/2` authorization with a numeric volume limit (§4 steps), then run it.
3. **Under-load answer latency** (6.5 s P50 vs 3 s). Choose between capping agent context, pre-empting agents for voice
   (currently ruled out) and more VRAM; or accept the miss with the 1.6 s status acknowledgment (§3).

### 10.9 Final integration (follow-up PR #66)

PR #65 was merged at `10b137c` (main `42e8b66`) before the 4R1 commits were pushed. Those commits now go to main
through **draft PR #66** (https://github.com/COMRADEART/bunny-A/pull/66). The branch was reconciled with a no-op merge of
main (`b065086`): main's tree equalled the branch base, so no change was lost or rewritten. Software only, as before: no
microphone or speaker was opened, no Windows privacy or volume setting was changed, and the voice scheduler is unchanged
(non-preemptive).

**Whisper pin adopted.** The verification was re-run on the PR branch before asking: all 11 checks passed, and both builds
gave `45f64172…`. The owner then authorized adoption.

| Step | Result |
|---|---|
| `build-voice-worker.mjs --repin-whisper-shim` | `6e4b553` changes only `native/voice/bunny-voice-worker.json` → `whisperShim`: `binarySha256` `35c03239…` → `45f64172…`, plus the reproducible `flags` list. The record equals the reviewed `proposedWhisperShim` byte for byte. The worker exe hash and `builtAt` are unchanged. §10.4's "every other field unchanged" was wrong about `flags`; the verifier now computes the changed fields (`1b057ea`) |
| Installed shim | `45f64172…` = record |
| Selection (`verify-whisper.mjs`) | checkout, committed pin and candidate all select **whisper**, not SAPI. WER 0 on synthesized fixture speech; repo runtime unchanged; 0 disposable roots left |
| `scripts/voice-worker.test.mjs` | **77 / 77** (twice) |
| `npm run pretest` after adoption | `build:whisper-shim up to date`; record hash unchanged before and after the whole regression |

Two harness defects were found and fixed during the final regression. Neither changes product behaviour.

- **Path leak (`a8e7183`).** With whisper selected, `whisper-verification.json` recorded the launcher args, which
  contain absolute local paths (SAPI selection had no args, so this was hidden). Every selection now records only
  `{ engine, reason }`. `adopted` is computed from the record; it is no longer hardcoded `false`.
- **UIA JSON (`d396f65`).** `notch_tree` wrote `Infinity` for a collapsed element (`Rect.Empty`), which made
  `v11-thinking-while-queued` fail once with a JSON parse error. Collapsed elements now report no bounds.

**Safety verification.** Simulated audio and null output only.

| Protection | Enforced by | Result |
|---|---|---|
| Hard session deadline; immediate cancellation of pending input, capture, playback and inference | `ma5-s2-acoustic-session.test.mjs` P4R1-1 (5 tests) | pass |
| Bounded, idempotent shutdown; no orphaned workers | P4R1-1 hanging-shutdown and failing-step tests; every harness counts workers afterwards | pass; 0 workers and 0 `BunnyA.exe` after the full regression |
| Authorized audio endpoints only; actual output volume at or below the approved ceiling; fails closed; monitored | P4R1-2 (4 tests: volume and endpoint rules, monitor switch and raise, recovery tolerance, open-session-only) | pass |
| No raw-audio recording or upload | Worker processes audio in memory; nothing writes audio (§10.3); external inference disabled (CI static check) | pass |
| Privacy-safe evidence | P4R1-3 (2 tests) and `assertPrivateEvidence`; whisper evidence path leak fixed above | pass; no path in the 4R1 evidence files |
| No unauthorized Mission actions | The acoustic harness sends only `voice.*` commands. Host voice suites (stage 2): voice cannot approve; a confirm spoken over Bunny's own output never executes a proposal | pass |

The acoustic suite has **17 / 17**.

**Regression (local Windows 11, final source):**

| Check | Result |
|---|---|
| `npm run typecheck` | exit 0 |
| `npm run test:ui` | 421 / 421 |
| `npm test` stage 1 (scripts, CI form) | 418 / 418 |
| `npm test` stage 2 (MA3 Host, Mission, voice, F04) | **1 694 / 1 694**. The test that skipped in §10.6 now runs, because whisper is adopted |
| `npm test` stage 3 (agent runtime and teams) | 62 / 62 |
| `npm test` stage 4 (`test:ma4`) | 317 pass, 1 skip, 0 fail |
| `scripts/voice-worker.test.mjs` | 77 / 77 |
| `npm run build` | exit 0 |
| Static security (CI checks run locally) | `npm audit --omit=dev --audit-level=high`: 0 vulnerabilities; no committed `.env` or secrets; external inference disabled |
| `native/windows/build.ps1` (Debug + `BunnyA.Tests`) | 0 warnings, 0 errors; 134 / 134 |
| `package-dev-candidate.ps1` (reproducible packaging) | two Release builds byte-identical (4 files) |
| `scripts/ma5-s1r1-installer.test.mjs` | pass |
| `verify-voice-windows.mjs` (UI Automation, fixture voice) | **12 / 12** after the helper fix; 0 workers; `evidence/voice/windows-voice-p4r1.json` |
| `verify-notch-windows.mjs` (shares the UIA helper) | 7 pass, n3 BLOCKED (single monitor, as before). n9 frame pacing failed once (two single gaps of 236 and 274 ms; p95 and fps in budget) and passed when re-run alone. No native or UI code changed since main. Notch evidence not re-committed |
| `verify-whisper-fingerprint.mjs` | 11 / 11; proposal `ADOPTED` |
| `%TEMP%unny-f04-*`; voice workers; `BunnyA.exe` | 0; 0; 0 |

Hosted CI: recorded in PR #66.

**Latency.** Still a known limitation: answer first audio **6.5 s P50** against a 3 s target. The status acknowledgment
plays at 1.6 s P50. Not re-measured; no inference or scheduling code changed.

**Classification: PARTIAL.** Every software gate passes and the whisper pin is adopted. Phase 4 acoustic acceptance is
**not** claimed: A16–A20 and the Narrator walk need an owner-attended session with a signed `/2` authorization (§4).
The latency MISS also remains open (§10.8).

## 11. Owner-attended acoustic testing (in progress, paused by the owner)

**Status: IN PROGRESS.** One valid physical session ran (S1, recognition). S3 (echo and spoken interruption) was run
once with a defective harness, fixed in this PR, and the rerun was ended by the owner before any section finished. No
Phase 4 acoustic gate is claimed yet.

### 11.1 Preflight (2026-10-30, main `f29ab04` = PR #66 merge, tree identical to `99b1930`)

| Check | Result |
|---|---|
| Whisper fingerprint (`verify-whisper-fingerprint.mjs`) | two independent builds `45f64172…67e3`; `ADOPTED` |
| Engine selection (`verify-whisper.mjs`) | checkout and candidate select **whisper**, no fallback reason; WER 0 on synthesized speech |
| `scripts/voice-worker.test.mjs` | **77 / 77** |
| `scripts/ma5-s2-acoustic-session.test.mjs` | **17 / 17** (18 / 18 with this PR's regression test) |
| Other voice workers / Host | none before or after any step |
| Harness | authorization schema `bunny-acoustic-authorization/2`; watchdog, 1 s endpoint and volume monitor, bounded shutdown present |
| Evidence directory | no audio, user paths, credentials or device names. The only stored text is the synthesized fixture phrase |

**Endpoints (read-only, the worker's own `devices` report, no capture or playback).** Default microphone: the laptop
microphone array; default output: the laptop speakers. The output read 26 % at first, so the session would have refused
to start. The owner lowered it to 24 % by hand. Bunny never changed a volume, mute, privacy or driver setting.

**Authorization.** Each session had its own `/2` authorization: `maxMinutes` 15, `maxPlaybackVolumePercent` 25, script
`p4-v1`, kept outside the repository. At the owner's explicit instruction, Claude Code wrote the files. The device names
were copied from the live read, not typed, and the four consent fields reflect the owner's chat confirmation. Each file
carries a note recording that.

### 11.2 S1: human speech recognition (A18)

`evidence/voice/acoustic-session-s1.json`. Push-to-talk; 24 trials (8 phrases × 3); whisper.cpp v1.9.4; COMPLETED in
244 s of 15 min. Devices authorized; the volume monitor took 187 reads, max 24 %; shutdown clean; 0 workers afterwards.

| Measure | Result |
|---|---|
| Exact phrase | **15 / 24 (62.5 %)** |
| WER over recognized trials | **11 / 101 words = 10.9 %** (21 trials) |
| WER counting no-results as fully missed | 21 / 111 = 18.9 % |
| No result | 3: once "what are my agents working on", twice "goodbye bunny" |
| Per phrase | "what failed", "how many agents are working", "open the approvals": 3/3 exact. "what are my agents working on": 0/3 exact |

The two "goodbye bunny" no-results are most likely a script artifact. The phrase is Bunny's voice-close command
(`voice-intent.ts:274`), so the first exact recognition closes the session. This is not proven by the evidence.

**A18: MEASURED, no verdict.** No numeric A18 threshold has been set in this report or in Phase 3. None is invented
here; the owner sets it.

### 11.3 S3: echo and spoken interruption (A16, A17): not measured

- **First run** (`acoustic-session-s3-invalid-no-handsfree.json`, kept only as a record): COMPLETED safely in 377 s,
  but invalid. The harness never sent the explicit hands-free start, so the microphone was closed while Bunny spoke:
  echo showed 0 false interrupts and interruptions 0 / 12 "none". These are **not** results.
- **Rerun** with this PR's harness (identical bytes to `3eb2c94`): the owner postponed it. The process ended without
  running the harness's own shutdown or evidence step, most likely because the window was closed before the typed `q`
  was read. The worker ended with the process (kill-on-close job): 0 workers, no Host port, volume unchanged at 24 %.
  The run left two disposable Host data folders in `%TEMP%`; one came from a killed fixture run. Both were deleted by
  hand. **No S3 trial is recorded.**

### 11.4 Findings

1. **Harness, fixed in this PR:** no hands-free start; section 7 read latency before playback (S1: 24/24 null); a stop
   button pressed mid-reply ended the lane; partial sections were lost on a stop.
2. **Engine, reported and not fixed:** during hands-free, `interrupt()` aborts the input capture and re-arms
   immediately (`voice-session.server.ts:752-753`). The worker releases a capture only when its thread exits
   (`BunnyVoiceWorker.cs:2537`), so the new start is refused with `DEVICE_BUSY` (`:5146`) and the hands-free lane
   ends. Fixture: 4 / 4. A user who presses stop during a hands-free reply loses the microphone. Recommended: re-arm on
   the aborted turn's `capture.stopped`, in a separate PR with a regression test.
3. **Harness, open:** closing the session window skips cleanup. The worker still dies, but the temp Host folder, which
   may hold recognized text, stays behind. Recommended: handle the console close (`SIGHUP`) and sweep stale
   `bunny-p4-acoustic-*` folders at start.
4. The fixture cannot speak an interruption on cue, so barge-in detection has never been exercised by this harness.
   It will be first exercised by the attended rerun.

### 11.5 Gate status

| Gate | Status |
|---|---|
| A16 echo cancellation | **BLOCKED**: not measured (S3 pending) |
| A17 spoken interruption ≤ 200 ms | **BLOCKED**: not measured (S3 pending) |
| A18 human recognition | **MEASURED, no threshold**: 62.5 % exact, WER 10.9 % (§11.2) |
| A19 response latency, acoustic | **BLOCKED**: needs this PR's section 7 (S2) and section 9 (S5). Known under-load MISS (6.5 s P50) unchanged |
| A20 device shutdown and recovery | **BLOCKED**: section 10 not run |
| Backchannels, pauses (sections 5, 6) | not run |
| Host and Mission concurrency (section 9) | not run |
| Narrator walkthrough | not run |
| Privacy and cleanup | S1 clean. S3 rerun ended abruptly: no worker left, temp folders removed by hand (finding 3) |

**Remaining sessions, each with a fresh authorization:** S3 rerun (`2,3,4`), S2 (`7,10`), S4 (`5,6`), S5 (`9`), then
the Narrator walk. Phase 4 acceptance: **not claimed.**
