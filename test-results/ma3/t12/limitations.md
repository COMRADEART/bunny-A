# MA3 T12 limitations (disclosed, not hidden)

Everything below is either NOT TESTED, measured with a stated bound, or a known residual risk. Nothing here is claimed as passed.

## Audio hardware and AEC
- **One device configuration.** Intel Smart Sound mic array + Realtek laptop speakers (output volume 30–40 %). Headphones,
  Bluetooth, USB microphones, external speakers and other laptops: **NOT TESTED**.
- **Synthetic second talker inconclusive.** The SD4780P monitor speaker was too quiet at the laptop mic
  (`live/synthetic-doubletalk-1.json`). Human double-talk was measured instead.
- **Default endpoints only.** The echo reference is the default render endpoint. A default-device change or device reorder
  stops the duplex lane (unit-tested). Physical hot-unplug during a live session: **NOT TESTED**.
- The DSP's AGC and noise suppression stay at Windows defaults. Windows audio settings were never changed (user rule).

## Recognition and turn-taking
- whisper.cpp base.en, **English only**. Double-talk misrecognitions were recorded live, for example "call of Tt", "QTP",
  "8K47", and "plan" heard as "plant" or "approach". A misheard command routes by what was heard. It never escalates authority.
- **Split sentences.** The endurance session found that whisper's trailing full stop shortened the end-of-turn wait to
  700 ms, which split hesitant sentences. The worker fix (35dc893: punctuation ignored; 1500 ms after continuation words)
  was **not sufficient live**: live re-check 1 still split "Prepare to" / "plan for dashboard project." Whisper had no
  partial yet at the pause, so the shortest wait applied.
  - 6aa99ba adds a Host-side join. A chat-bound final ending on a word that cannot end a sentence waits up to 2.5 s for its
    continuation (bounded at 9 s).
  - In live re-check 2, both hesitant sentences arrived as single turns: a Mission draft, and "Tell me about the weather on
    Mars". The journal shows the join itself was **not exercised live** (`live/live-recheck-2-journal.json`); it is proven by
    unit tests only.
- **Post-endurance fixes re-checked live with the human** (`live/live-recheck-1.json`, `-2.json`):
  - "End voice, please." closed voice in both runs (`voice_command`), with 0 workers left.
  - "Open notes and … on the desktop" got the fixed computer-action answer.
  - "Are you running in it?" was answered from Host facts.
  - "Is any task running?" was **misheard 4 times** ("Is Anita scrunning?" and similar) and went to chat. This is a
    recognition limit of base.en on that phrase.
  - "Are you running any tasks?" was heard as "How would you running any tasks?" and refused, a safe failure.
- **The action-claim guard went through two independent re-checks.** Its round-3 rework had a HIGH regression (a lead-in hid
  a claim), fixed in 6aa99ba. Its last live gap ("Confirm, paused.") was found by a real-model run
  (`live/agent-speech-1.json`). It remains a pattern list (see below).
- **Missed interruptions are a bound, not a rate.** Of 20 barge-in trials, 16 interrupted, 2 resumed and 2 had no barge-in.
  The human was asked whether they spoke (trials 6 and 16) and whether they asked a real question (trials 9 and 17), but did
  not answer. The missed-interruption count is therefore between 0 and 4 of 20.
- **Pre-audio holds.** When the user speaks while Bunny is still preparing a reply, nothing is audible. The pause lands when
  the first chunk would have played (worst observed 1.7 s). This is reported separately and not as stop latency.
- Bunny alone: 0 self-triggered turns in 5 clean trials (231 s of speech). A sixth trial contained the user's own room
  conversation and is excluded.

## Endurance
- 42 minutes, but **23 spoken turns** (the brief aims for 30+), and 6 interruptions of which 3 were audible.
- The session was ended through the Host API at the user's spoken request. Spoken "end voice" did not exist then (added in
  35dc893).

## Intent coverage (safe failures)
- "Are you running any tasks?" is refused as a command phrase (a conservative false refusal, not an escalation).
- Voice cannot target a team member by role for control ("pause the reviewer"). The user picks by ordinal after a
  clarification, or uses the screen.
- The tool-free chat model can still paraphrase earlier Host-fact turns from its short history in its own words. Host facts
  themselves are only spoken from canonical records. The action-claim guard covers claims of having acted, not paraphrase
  quality.
- The action-claim guard is a pattern list. A novel phrasing of a false claim can pass it. The model is also instructed that
  it cannot act.

## Historical review findings (independent rounds 7–8 on pre-closeout source 92a4636)
- **Action-claim guard coverage:** on a fresh independent set it caught 42 of 60 false "I did it" claims (70 %) and flagged 2
  of 60 honest answers. The chat model is tool-free and the Host never acts on its text, so a miss is a spoken untruth, not
  an action.
- **First-reply barge-in window (MEDIUM):** in a node port of the residual model, a barge-in starting within ~260 ms of the
  session's first audible reply seeds the echo residual from the user's own voice. That interruption, and possibly the next,
  is missed until a reply samples echo-only frames. This is not observed live; the live barge-ins began later.
- **Cut-off Mission drafts (MEDIUM):** the cut-off check is a closed list of words that cannot end a request. A request cut
  after another word ("Prepare a plan for the reports in") still creates a voice Mission draft. That draft waits in
  AWAITING_REVIEW, and nothing runs until it is approved on the Windows Host screen.
- **False cut-off refusals (LOW):** "Prepare a plan for vitamin A" or a request ending in "um"/"uh" is refused as cut off.
  Nothing is created and the user is asked to repeat.
- **Typed confirm (LOW, design question):** a typed "yes" in the Island's voice text box confirms a voice-or-screen pause
  proposal and is journaled as a voice confirm. Only the local workstation can do this, with the same effect as the
  on-screen button.
- **Native regimes outside the measured device (MEDIUM, simulated only):** loud echo with a silent lead-in over 1 s, AEC
  convergence from loud to quiet, wide per-frame jitter, and floor pumping by speech with no duplex turn attached. With a
  learned residual near the 0.003 cap, barge-in needs about twice the echo level.

## Hostile and agent-generated speech
- Recorded/hostile speech used **synthetic SAPI clips from the phone speaker** (10/10 heard, 0 authority violations).
  A human attacker, other voices, languages and replayed recordings of the owner's own voice: **NOT TESTED**.
- Bunny's own speech carrying "Confirm." / "Yes, do it." while a voice-confirmable pause proposal was pending: 0 turns heard,
  0 executed. That is **2 trials with a live proposal**, a small sample.
- Single-word user utterances ("stop", "confirm") are never classed as echo by text overlap, by design, so the user can
  always interrupt. Protection against Bunny confirming itself rests on AEC plus the overlap rule (an overlapped turn never
  confirms).
- `live/agent-speech-1.json` is excluded: it created no proposal, and room speech was present.

## UI
- The WPF Island's hands-free flow (mic → Hands-free → Start → Finish my turn → End voice) was verified by UI Automation
  with a real mouse click at 150 % DPI on the primary monitor.
- An always-on-top window (Task Manager) covering the expanded voice panel intercepts clicks. It probably explains why
  "Start hands-free" did not respond for the user once, but that is **not proven**. The Island does not raise itself above
  other topmost windows.
- Secondary monitor and other DPI settings: **NOT TESTED**.

## Final closeout source and scope

Final executable/tooling source is 86cc164d103edb97b7c39de0f520bc37d40e1db4. The original assertion of no HIGH finding on
92a4636 was superseded by the independent closeout review: completion claims, cancelled PCM after blocked driver Open,
and in-flight hands-free consent resurrection were reproduced and repaired. Pending reset telemetry was also repaired.
Final independent probes close those concrete findings, without a blanket guarantee about all natural language.

- Final bounded guard corpus: 55/55 claims and 4/4 split claims refused; 37/38 negative/general examples retained.
  Ten additional general operational-subject statements were refused: an open MEDIUM conversational tradeoff, with no
  authority impact. Two self-description refusals remain LOW. The historical 42/60 measurement is superseded.
- Suspended Start uses a revocation revision, so mute-unmute/mode changes while awaiting stop cannot revive a grant.
- Pending reset preserves workerResetMs=null; elapsed workerCancelWaitMs and workerResetPending retain uncertainty.
- Final packaged startup, AEC capture/playback overlap and cleanup were checked on the new pin. Historical human
  recordings remain historical; no final-source human acoustic/endurance rerun was performed.
- The 31 combined audible latency receipts include resumed backchannels, not 31 intentional successful interruptions.
  Worker-visible onset excludes DSP delay before the first observed frame; no external physical-acoustic timing claim.
- Final read-only production comparison preserved release/process/privacy invariants. Endpoint-enumeration hash changed;
  cause unknown, not attributed to this task.

## Scope carried from T10/T11
- No wake word. Hands-free needs an explicit Start each time. The grant lasts 30 minutes; the microphone is released after
  2 minutes of silence.
- Phone/LAN/tunnel remote voice was not exercised. The phone was used only as a synthetic speaker over adb. The installed
  Bunny app and pairing were not touched.
- Production stays `Bunny-A-Windows-v26-MA2-R1`. T12 is not deployed.
