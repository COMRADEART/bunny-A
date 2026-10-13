# Bunny-A MA3 T12 full-duplex voice acceptance

**BUNNY_MA3_T12_PASS_WITH_LIMITATIONS**

Core full-duplex behavior has retained real human/device proof on one laptop. Final repaired source has separate regression, package and browser checks. Historical human recordings are not labeled as new final-source acoustic tests.

## 1. Exact starting T11 commit

Starting T11 evidence / HEAD: e417a22215ffc507e54278c24b36482108ac6b5f. Accepted executable/source/tooling: 032954fad7c0d66097a1e6efe502eda21a66c3ce. Accepted T10: 2d5646d5c5a95ab040239b20b034e2c6b0828365.

## 2. T12 executable source commit

86cc164d103edb97b7c39de0f520bc37d40e1db4. The closeout repairs false completion claims, cancelled PCM after blocked driver Open, suspended microphone-consent resurrection, and pending-reset telemetry.

## 3. Evidence commit

A separate local evidence commit contains this report and INDEX.sha256. Its exact hash is returned in the final chat; a commit cannot contain its own future hash.

## 4. Development branch

claude/ma3-t9-phone-remote. No merge, push, installation or production promotion.

## 5. Files changed

24 runtime/test files changed since T11; source-provenance.json lists every file, hash and repair commit. Closeout touched ten files. Evidence-only byte-preservation attributes belong to the evidence commit.

## 6. Full-duplex architecture

An explicit hands-free grant owns continuous AEC capture. Input turns and output generations have separate identities and buffers. Local recognition/turn control feeds existing TaskManager/BunnyRouter or canonical Host intents. Audio does not own Missions or Agent processes. See duplex-architecture.md and voice-engine-contract.md.

## 7. Selected AEC technology

Actual Windows Voice Capture DSP / CLSID_CWMAudioAEC, source mode, SINGLE_CHANNEL_AEC, inside the contained native worker. ProcessOutput supplies 16 kHz mono PCM16. The measured DSP effect is not inferred from an enabled flag.

## 8. Playback reference

SAPI PCM -> waveOut on the selected default render endpoint -> Windows DSP render-loopback reference. Windows owns alignment/conversion; three silence buffers keep the endpoint active. Identity/reorder/reference failure refuses duplex. No independent clock-drift or external acoustic alignment measurement.

## 9. Voice activity detection

Bounded adaptive ambient/output-residual thresholds, sustained onset, decaying endpointing, actual recognition evidence and manual Finish my turn. Duplex ignores whisper trailing punctuation. Host-side incomplete-final joining is unit-proven but was not exercised in live recheck 2.

## 10. Turn-taking implementation

A separately tested local controller chooses pause/resume/interrupt/accept/drop from acoustic duration and actual partial/final transcripts. Energy alone cannot execute a command. Generation fencing rejects late inference/TTS.

## 11. Backchannels

Historical human session: 27 pauses, all 27 resumed, zero full interruptions. Duration, output context, reliability and echo evidence complement the lexicon; a hardcoded word list is not the sole decision.

## 12. Real hands-free barge-in proof

Real WPF Island, Intel SST array and Realtek speakers: 16/20 deliberate trials interrupted by voice alone; two resumed and two had no barge-in, with human labels unresolved. Final packaged source recorded 32/32 capture/playback overlap samples. Historical human trials were not rerun after closeout.

## 13. Interruption P50/P95

31 audible pause-to-silence receipts: worker-visible onset to render-meter silence P50 177 ms / P95 181 ms; onset-decision to silence 73/80 ms. These include resumed backchannels, not 31 intentional successful interruptions. Deliberate-trial audible subset n=13: 178/181 ms. Pre-audio/unmeasured receipts are separate. DSP delay before the first observed frame and externally instrumented acoustic stop timing were not measured.

## 14. False/missed interruptions

Five clean speaker-only trials, 231 seconds: zero onsets, full interruptions or routed finals. A human-contaminated sixth trial is retained and excluded. Missed interruptions are bounded 0-4/20, not a measured rate; no universal noise-immunity claim.

## 15. STT accuracy

Local whisper.cpp v1.9.4 base.en. Scripted human sample: 1 edit/17 reference words, three utterances, WER 5.9%. Ten synthetic phone-speaker clips: 0 edits/63 words. Unscripted turns have no reference corpus; recorded double-talk/status-phrase misrecognitions remain. Synthetic speech is not human accuracy proof.

## 16. Streaming TTS

Real model deltas become ordered bounded SAPI/winmm chunks. Cancellation invalidates queues/generations; post-Open recheck prevents the reproduced old PCM submission. Cancel wait, pending reset, acknowledged reset and measured silence stay distinct. Tool-free model action/Host-completion claims are refused; canonical Host facts use their own output path.

## 17. Warm/cold latency

Historical endurance under real Agent load: nine warm model answers, speech end to first audio P50 11404 ms / P95 27499 ms. Nine Host-fact answers: 1124/2853 ms. Controlled T12 cold trials NOT TESTED; T10 timings are historical only. Fast interruption does not imply fast substantive model answers.

## 18. Audio device coverage

One built-in Intel SST array + Realtek speakers, output 30-40%. Bluetooth, wired headphones, USB microphones, external speakers, other laptops and physical hot-unplug/reconnect NOT TESTED. SD4780P synthetic second talker was inconclusive.

## 19. Actual endurance

42 minutes / 23 spoken turns / no typed prompts / six interruptions (three audible). The 30+ turn aim was not met. Forty-one Agents persisted after voice close and Agentic reopened. Live-found defects were repaired; later spoken End voice rechecks left zero workers. No final-source 20-minute human rerun.

## 20. Agent delegation integration

Spoken planning requests use the existing Mission draft path and await Host review; voice grants no execution. Final packaged Host used actual local Ollama to plan a real Team Mission with durable distinct Agents, deliberately left unapproved. No second runtime.

## 21. Multi-Agent voice supervision

Roles, Tasks, approvals, verification and status come from canonical Host records. References are session/TTL bounded; ambiguous identities require clarification. Interruption/closure preserves unrelated authorized work. Free-form Talk/Redirect remains unsupported.

## 22. Authorization/security

No speech approval, start, shell, permission or scope expansion. Partials, held fragments, overlap and replay cannot become owner consent. Ten synthetic hostile phone-speaker clips had zero authority violations; two Bunny self-speech trials with a live proposal executed nothing. These are bounded/synthetic samples.

## 23. Native process containment

Existing F04 suspended launch and verified Windows Job ownership remain. Final package provider/voice shutdown has zero active owned processes. No independently managed Ollama or user process is seized. Host epochs fence stale voice events.

## 24. Full regression counts

Final source pin 86cc164d103edb97b7c39de0f520bc37d40e1db4. 1995 PASS / 0 FAIL / 0 SKIP. Scripts 406, library 1332, Agent 57, UI 200. Typecheck/lint/build exit zero; lint retains existing warnings. All 1,750 historical T11 case names remain; focused reruns are excluded. Calculator X53 and F01-F04 are included.

## 25. Independent review

Reviewer /root/t12_final_review did not author the implementation. Three reproduced HIGHs and one MEDIUM were repaired/rechecked; no reproduced BLOCKER/HIGH remains. Bounded guard tests block 55/55 claims and 4/4 split claims, retaining 37/38 negative/general examples. Ten other general operational-subject facts were refused (open MEDIUM). This is not exhaustive semantic proof; residual simulated first-reply and other MEDIUM/LOW limits stay disclosed.

## 26. Windows package acceptance

Bunny-A-Windows-MA3-T12-TEST / 1.0.0-MA3-T12-TEST, source/tooling 86cc164d103edb97b7c39de0f520bc37d40e1db4. 393-file manifest has no missing/changed/extra entries; import closure and Git-blob checks pass. Pinned bundled node, ownership helper, whisper DLL/shim/model and licenses are recorded. Disposable Host, real typed speech, AEC capture/playback overlap, Team planning, containment and cleanup pass. Fixed-port packaged gateway boot NOT TESTED because production owns its port; the same final middleware passed separate browser QA.

## 27. Production preservation

Bunny-A-Windows-v26-MA2-R1 install/release hashes, listener PIDs/start times, Startup and microphone privacy are unchanged. Read-only comparison records 32 normal provider.status_changed observations; no database-byte-equality claim. Endpoint-enumeration hash changed, cause unknown; no driver/privacy/settings mutation. No install, migration, restart, tunnel, credential/pairing change, trigger enabling or push.

## 28. Remaining limitations

One hardware configuration; English recognition errors; four uncertain trials; 23-turn endurance; cold timing absent; slow warm model replies under Agent load; fragment joining unit-only; no final human rerun; device/DPI/phone-remote coverage absent. Conservative model refusals and simulated first-reply residual seeding remain MEDIUM. See limitations.md and D01-D70; no unavailable measurement is invented.

## 29. Evidence root and seal

test-results/ma3/t12/. INDEX.md maps retained text/JSON/logs/browser screenshots; INDEX.sha256 seals bytes and this report. Release folders/archives and synthetic audio binaries are excluded from the commit; final manifest pins package bytes. No raw human audio or credentials committed. Evidence scripts derive records and never generate human trials.

BUNNY_MA3_T12_PASS_WITH_LIMITATIONS
