# MA4-S2R1 — Hosted voice CI failure: root cause and fix

## 1. The failure

Hosted run 39921539119 (PR #17, `pull_request`, Windows Server runner), Stage 2:

```
not ok 732 - T12 native fixture: continuous input and actual synthesis/null playback operate concurrently inside F04 Job
  duration_ms: 27959.8006
  error: 'Worker event timed out: capture.error,capture.stopped,playback.chunk_done,playback.idle,stt.none,duplex.stopped'
  at voice-duplex-worker.test.ts:48  (await h.until(e => e.ev === "capture.first_audio" && e.turn === "input"))
```

The same test passed in the neighbouring hosted runs in 3.5 s, **12.1 s**, 3.5 s and 4.0 s, and locally in ~1.0 s. The
base branch's post-merge run 39944836044 failed on a different, unrelated test (§6).

## 2. Investigation

**Was the event never emitted, emitted late, or lost?** Never emitted. The harness keeps every event; the tail shows
the turn ended (`capture.error` → `capture.stopped`) *before* any audio frame was read, and `first_audio` is emitted
only on the first frame a turn reads (`CaptureLoop`). The playback events that follow are the untouched output lane
finishing naturally; `duplex.stopped` is the 20 s duplex lifetime bound expiring, since the test never stopped it.

**Event and thread sequence** (`native/voice/BunnyVoiceWorker.cs`, `capture.start` handler):

1. `duplex.Attach()` creates the turn's `TurnFrames` queue; from that moment the continuous capture thread pushes
   every frame into it (50 frames/s).
2. `t.StartRecognizer(recognizer)` — `new SpeechRecognitionEngine` + `LoadGrammar(new DictationGrammar())` — runs
   *after* attach, while the command loop holds `Program.Gate`.
3. `capture.started` is emitted and only then the turn's reader thread starts (`t.StartCapture(source)`).

`TurnFrames` is bounded at 250 frames (5 s): `Push` sets `overflow` when full, and the reader's next `Read` throws
`VoiceFault("BUFFER_LIMIT")`. A recognizer load longer than ~5 s therefore fills the queue before the reader exists,
and the reader's **first** `Read` throws. The capture loop's catch reported every exception as
`capture.error INTERNAL "capture loop failed: VoiceFault"`, hiding the code, then `Finish("error")` →
`capture.stopped`; the finalizer emits `stt.none aborted`. That is exactly the hosted tail.

**Why hosted, why intermittently.** The dictation recognizer load time on hosted runners varies widely: the same
test took 3.5–12.1 s when it passed, and 9.6 s in the diagnostic Stage 2 lane (§4); locally it is ~0.1 s. CPU
contention alone does not reproduce it: 5 runs under 88 busy threads on a 22-core machine all passed in ~1.0 s
(`--test-concurrency=1` means no other test file runs beside it in CI either). The variable is the recognizer
start, not the scheduler. Fixture availability, null playback and process cleanup were normal in every run: the
following tests in the same file (`close leaves zero active Job processes`) passed in the failing run.

## 3. Controlled reproduction

A fixture-only seam, `--fixture-recognizer-delay-ms N` (honoured only with fixture input, clamped to 30 s), delays
`StartRecognizer` at exactly the point a slow load occupies. With 6.5 s and the **unfixed** worker, locally:

```
error: 'Worker event timed out: ready, duplex.started, capture.started:slow,
        capture.error:slow:INTERNAL:capture loop failed: VoiceFault, capture.stopped:slow:error,
        stt.none:slow:aborted, duplex.stopped:lifetime'
```

— the same sequence as hosted (without the playback events, which this regression test does not start).

## 4. Fix

* **`TurnFrames`:** before the turn's reader performs its first `Read`, a full queue drops its oldest frame (zeroed)
  instead of setting `overflow` — the queue keeps the newest 5 s, like the pre-roll already does. A reader that has
  not started is not "behind". After the first `Read` the bound is unchanged: a reader 250 frames behind is still a
  `BUFFER_LIMIT`.
* **Capture loop:** a typed `VoiceFault` keeps its own code and message (`BUFFER_LIMIT`, `DEVICE_LOST`); only an
  unexpected exception is reported as `INTERNAL`.
* **Diagnostics:** the worker-event timeout now prints each tail event's turn, code, reason and message.

Not chosen: starting the recognizer before `Attach`. A started SAPI engine cannot simply be disposed if `Attach` then
fails (that is what the abandon ledger exists for), so that ordering would add an engine-teardown path; the queue
change closes the race for any delay between attach and the first read, not only the recognizer's. No sleep was
increased, no test skipped, no `--test-force-exit` added.

Regression coverage: `T12 native fixture: a slow recognizer start never overflows the attached continuous turn`
(6.5 s seam; asserts `first_audio`, no `capture.error`, levels keep flowing) and the selftest
`TurnFramesBoundCheck` (300 unread pushes keep frames 50..299; after a read, falling behind is `BUFFER_LIMIT`).

## 5. Hosted acceptance (temporary `ci-diag/*` branches, workflow `ci-stage2-diagnostic`)

| Run | Code | Lane | Result |
|---|---|---|---|
| 39948226063 | seam + test, **fix reverted** | isolated (duplex file) | **fails**: `capture.error:slow:BUFFER_LIMIT:continuous recognition queue exceeded 5 seconds, capture.stopped:slow:error, stt.none:slow:aborted, duplex.stopped:lifetime`; the two selftest-based tests also fail (the new selftest overflows without the fix) |
| 39948226063 | same | full Stage 2 | fails the same three tests |
| 39948222512 | fix | isolated: duplex file ×3, then `voice/*.test.ts` | 17/17, 17/17, 17/17, then **439/439** |
| 39948222512 | fix | full Stage 2 | **1,643 tests: 1,641 pass, 0 fail, 2 skipped** |

The hosted A/B shows the mechanism directly on the hosted runner, with the real code visible. The complete hosted
`ci` regression on the final code is recorded in `ENGINEERING_REPORT.md`.

## 6. Unrelated hosted intermittency (reported separately)

Run 39944836044 (`ma4-s1r3-agent-reliability` after #17 was merged) failed `F04 R1-BYPASS-1: verification never runs
a python.exe planted in (or on PATH inside) the task folder` with `ran python …\hello.py: exit_code=ETIMEDOUT`
(16.7 s). It is a different suite (`provider-containment.test.ts`), passed in the other hosted runs, and is not
touched by S2R1.
