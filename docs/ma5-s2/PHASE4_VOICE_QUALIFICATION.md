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

**Privacy gate (enforced in code, `scripts/ma5-s2-acoustic-session.test.mjs`, 4 tests).**
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

1. Choose the room, headset or speakers, and a volume. Close BunnyA.exe and any voice worker.
2. Print the template: `node scripts/ma5-s2/acoustic-session.mjs --print-template > %TEMP%\bunny-acoustic-auth.json`.
   Fill in the exact Windows device names (Sound settings → Input / Output), `maxMinutes`, the volume and `authorizedAt`
   (now, ISO). Confirm the four `true` statements.
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

## 9. Remaining release blockers

1. Owner-attended acoustic session (A16–A20, Narrator walk), §4.
2. Owner approval of the reproducible whisper shim pin `45f64172…`, §2. Without it the recognizer is SAPI.
3. Under-load answer latency: 6.5 s P50 vs 3 s. It needs a product decision on agent context size, voice pre-emption or
   hardware (§3).
4. Live evidence of Recognizing / Interrupting / Device unavailable on the notch (needs the attended session).
