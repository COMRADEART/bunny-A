# Adaptive feedback (M-A-3 T13.3 Gate G)

Gate G covers directive §20 (evaluation-gated routing improvement) and §21 (voice personalization). Both are owner-decided
on the workstation. Neither one rewrites code, trains a model or records conversations. The routing work changes at
most three bounded numbers in one score component, and only after the owner accepts a shadow-tested candidate. The
voice work changes the opening of Bunny's spoken-chat instruction and the installed voice used for a turn, and keeps the
T12 turn-taking and interruption behaviour exactly as it was.

Code:

- `src/lib/bunny-host/routing-feedback.ts`: pure rules (bounds, replay, shadow summary, the two gates, the bounded proposal search).
- `src/lib/bunny-host/learning.server.ts`: `PolicyEngine`, plus the additive tables `policy_lifecycle` and `policy_shadow` (migration `bunny-a.routing-learning.v1`).
- `src/lib/bunny-host/manager.server.ts`: the T3 pipeline reads `policy.liveWeights()` and records each live decision's shadow pick.
- `src/lib/bunny-host/voice/voice-personalization.ts` (pure) and `voice-personalization.server.ts` (`VoicePersonalizationStore`, table `voice_feedback`, migration `bunny-a.voice-personalization.v1`).
- `src/lib/bunny-host/voice/voice-session.server.ts`: an optional `persona` port, per-turn voice, and recent-answer bookkeeping without text.
- Host wiring, snapshot and commands: `http.server.ts`.
- UI:
  - `routing-improvement.tsx` (Settings → AI & Models → Routing improvement);
  - `voice-personalization.tsx` (Settings → Voice, and the notification frequency under Settings → Notifications).

## 1. Routing improvement (§20)

### What can change

Live routing is the T3 score. Gate G touches only its `empirical` component (weight 6). A learning policy is three
numbers, each with a fixed range:

| Field | Range | Meaning |
| --- | --- | --- |
| `historyWeight` | 0 – 2 (grid 0, 0.5, 1, 1.5, 2) | How much the bounded verified-success history (`db.learned`, ±0.06, at least 5 samples) moves the score |
| `latencyWeight` | 0 – 0.05 (grid 0, 0.025, 0.05) | Measured speed relative to other providers on the same kind of task, scaled down in Balanced and Deep modes |
| `perTaskType` | true / false | Whether history is read per kind of task (coding, research, …) or from the single "general" bucket |

The base policy `{1, 0, false}` reproduces the pre-Gate-G score exactly: history from the "general" bucket and no latency
term. Hard exclusions (capability, privacy, locality, consent, quota, harness lifecycle) run before any score, so no
policy can make an ineligible route eligible. `validateWeights` refuses anything outside the bounds.

### Lifecycle

| Stage | What happens | Who |
| --- | --- | --- |
| OBSERVE | Per provider and kind of task: Tasks, verified passed, verified failed, failed, stopped by the user, repair attempts, median duration, tokens, cost (0 for local, otherwise unknown) and the user's likes and dislikes | Host |
| EVALUATE | A candidate is replayed on the fixed routing benchmark and on up to 300 recorded live decisions. A decision counts only where the active policy, replayed today, still picks what actually ran, so the outcome can be attributed. Stopped and rerouted Tasks are excluded | Owner asks (`routing.learning.candidate`) |
| PROPOSE | Bunny searches the bounded grid (30 points) and offers the point with the most measured improvements that passes the shadow gate, nearest to the active policy on ties. When none passes, it says so with the count of verified decisions it replayed | Owner asks (`routing.learning.propose`) |
| SHADOW TEST | **Shadow gate:** no benchmark regression, no replayed decision moved away from a verified success, and at least one moved away from a verified failure. Each new live decision then records the shadow policy's pick beside the live pick, but dispatch is never changed by the shadow | Owner starts it (`routing.learning.shadow`); one shadow at a time |
| ACCEPT / REJECT | **Accept gate:** the shadow gate still holds against current evidence, the shadow run has at least 5 verified live decisions, and it disagreed with none that were later verified successful. Reject is always available | Owner (`routing.learning.accept` / `reject`) |
| VERSION / ROLLBACK | Each accepted policy records the policy it replaced. Rollback restores the previous one; at the base there is nothing to roll back | Owner (`routing.learning.rollback`) |

All six commands are workstation-only (`WORKSTATION_REQUIRED` for paired devices, which are also default-denied before the
command path). `routingLearning` is stripped from device snapshots. Every refusal is a 400 with the gate's reason, such as
"Promotion gate refused: The shadow run has 2 verified live decision(s); 5 are required."

The pre-Gate-G `policy.candidate`, `policy.promote` and `policy.rollback` commands remain for compatibility, and
`promote` now goes through the same accept gate. A policy that was promoted before Gate G has no "accepted" lifecycle
record, so live routing keeps the base weights for it. That case has its own test.

### Signals: measured and not measured

| Signal | Status |
| --- | --- |
| Verified pass / fail | Measured: the Host's own verification. **The only evidence that counts** |
| Completion without verification | Shown; counted as unverified, never as success |
| Stopped by the user, rerouted | Shown; excluded from attribution |
| Repair attempts, duration, tokens | Shown. Duration feeds the optional latency term |
| User likes and dislikes | Shown separately; **never counted as evidence that a Task was correct** (directive: praise is not proof) |
| Tool error rate | **Not measured separately.** Outcomes do not separate tool errors from other failures |
| Cloud cost | **Unknown.** No provider reports spend to Bunny; local cost is 0 |

### What it does not do

- No production-code rewrites: a policy is one stored record of three bounded numbers.
- No model-weight training.
- No automatic acceptance: shadow, accept, reject and rollback are owner actions on the workstation.
- No widening of eligibility, consent, quota or harness rules.

## 2. Voice personalization (§21)

T12 full-duplex conversation and interruption are unchanged. Barge-in still stops only the voice turn's own inference,
and the turn-taking controller is untouched. With default settings and Bunny in the foreground, the spoken-chat prompt and
the voice are byte-for-byte what they were before Gate G (tested).

| Directive setting | Status |
| --- | --- |
| Verbosity | **Implemented.** Bunny: Brief / Normal / Detailed (owner preference). A Personal Agent: from its interaction style on its card (concise → brief, conversational → normal, detailed → detailed) |
| Language | **Implemented for replies** (11 languages or "Same as I speak"). Speech recognition still uses the recognizer installed on the PC |
| Voice style | **Implemented.** One installed Windows voice per speaker (Bunny and each Agent). Only voices the native worker reports as installed are accepted; before voice has been opened once, the pickers are disabled |
| Per-Agent conversational identity | **Implemented.** When an Agent is the foreground speaker, the instruction opens with "You are \<name\>, one of the user's Personal Agents, speaking through Bunny. Your owner describes your personality as: …". Every action-refusal rule after the opening is kept word for word. An unconfigured slot falls back to Bunny |
| Notification frequency | **Implemented for browser notifications** on the workstation: Everything / Only what needs me (approvals, questions, failures, thermal) / None. Devices keep "Everything" |
| Pace | **Not adjustable.** The native worker's speak operation has no rate field |
| Interruption preference | **Not adjustable.** It would change the accepted T12 turn-taking controller |

### Feedback and advice

- **Rating.** The owner can rate the last spoken answer Too long, Too short or Just right. A rating needs a real recent `turnId` from this Host run; anything else is refused.
- **Recent answers.** These are held in Host memory only (at most 20) as `{turnId, speaker, length in characters, interrupted, time}`, never the text.
- **Interruptions.** Only user sources (button, hotkey, push-to-talk, mute, new turn, acoustic, speech stop) mark an answer interrupted. An inference timeout, a lost Host or a closed session does not.
- **Advice.** Advice is a suggestion only. It appears after at least 5 ratings with a 60% share in one direction, or 5 answers with 60% interrupted. For Bunny the owner can apply it with one click; for an Agent it points to the style on the Agent's card.

### Privacy

- **No recording, no training, no transcript retention.** The `voice_feedback` table has only `id, at, speaker, rating` (tested by column list).
- **Remember my feedback is off by default.** Ratings then last only until the Host restarts.
- **When it is on**, ratings are kept on this PC, bounded to 200. Turning it off deletes them, and "Forget all feedback" deletes both the stored and the in-memory ratings.
- **Workstation-only.** All three commands (`personalization.preferences`, `personalization.feedback`, `personalization.feedback.forget`) refuse paired devices, and `voicePersonalization` is stripped from device snapshots.
- **Validation.** Preferences are validated strictly: unknown keys (for example a `transcripts` flag), unknown languages or speakers, and non-installed voices are refused, never coerced.

## 3. Tests

Gate G adds 17 tests to the suite: 7 in `routing-learning.test.ts`, 1 in `t3-manager.test.ts`, 4 in `voice-session.test.ts` and 5 in `voice-personalization.test.ts`.

| Requirement | Test |
| --- | --- |
| Replay attributes only what the active policy would still pick | "T13.3 G rules: replay attributes outcomes only where the active policy still picks what ran" |
| Bounded weights; bounded proposal with an honest refusal | "T13.3 G rules: weights are bounded; propose searches only the bounded grid …" |
| Acceptance needs 5 verified shadow decisions and no risked success | "T13.3 G rules: a shadow run is accepted only with enough verified live decisions …" |
| Base weights live; proposal from verified evidence; praise not counted; stopped Tasks excluded | "T13.3 G engine: base weights are live; Bunny proposes from verified evidence …" |
| Shadow → accept → rollback with every refusal | "T13.3 G engine: shadow → accept → rollback, with every refusal path" |
| A legacy-promoted policy keeps base weights | "T13.3 G engine: a policy promoted before Gate G keeps live weights at the base" |
| Real Host: workstation-only, honest refusals, device stripping, persistence across restart | "T13.3 G Host: routing-improvement commands are workstation-only …" |
| Shadow never changes dispatch; recorded shadow pick is what the policy would choose | `t3-manager.test.ts` "T13.3 G §20: a shadow policy scores every live decision beside it …" (the shadow row is inserted directly, so gate passage is simulated there; the gates have their own tests) |
| Default voice unchanged; persona per turn; timeout is not a user interruption; a failing persona falls back | `voice-session.test.ts` "T13.3 G §21: …" (4 tests) |
| Instruction rules kept; strict validation; advice thresholds; store privacy; real Host + worker | `voice-personalization.test.ts` "T13.3 G §21 …" (5 tests) |

### §37 voice tests

Classification:

- **LIVE**: run against the real Windows Host and the real native voice worker.
- **SIMULATED**: the voice session driven by the test worker, chat and clock doubles.
- **NOT TESTED**: not run in this gate.

| §37 item | Classification | Evidence |
| --- | --- | --- |
| Switching Bunny to Gada | SIMULATED | "switching Bunny → Gada → Sword changes the speaker, instruction and installed voice per turn …" |
| Switching between Personal Agents | SIMULATED | Same test (Gada → Sword; Gada's name never appears in Sword's turn); `speakerFor` rule test |
| Correct speaker / Agent identity | SIMULATED | Same test: the prompt opening, the speak command's voice and the recent-answer speaker match the foreground identity on every turn |
| Active Mission status while speaking | SIMULATED | Gate B "T13.3 B: the foreground Personal Agent answers status from its own Missions …" |
| No accidental Mission cancellation | SIMULATED | "V29 V34 interrupt never touches agents or missions", "V45 closing voice does not call any agent command"; the Gate G interruption test asserts only the voice turn's own inference was stopped |
| Stale voice response suppression | SIMULATED | T10–T12 "V21 late model deltas … never restart speech", "R1-races#3 …" (unchanged and passing) |
| Speech interruption during background work | SIMULATED | "V19 V20 barge-in …", "V23 a second question during speech cancels only the first voice turn's inference", Gate G interruption test |
| Distinct Agent personality behaviour | SIMULATED (prompt only) | The personality text and style-driven length reach the instruction (Sword detailed, Gada concise). **Whether a model's spoken wording follows the personality is NOT TESTED**: no live model inference was run |
| Privacy settings for feedback and transcript retention | SIMULATED + LIVE | Store test (no text columns, off by default, delete on off/forget). LIVE: "T13.3 G §21 Host: …" runs the real Host and the real native worker (`--input-silence --output null`). It reads this PC's installed voices, refuses an uninstalled voice and an unknown `turnId`, refuses devices, and keeps preferences across a restart |
| Hardware: microphone capture, speaker playback, a human barge-in | NOT TESTED in Gate G | T12 hardware evidence is unchanged; Gate G added no audio-path code |

### Mutation checks

The checks are run by `%TEMP%\gate-g-mutations.cjs`. Each mutation is applied, its targeted tests are run, and the file is restored.

The results are retained in `test-results/ma3/t13-3/gate-g/`:

| File | Result |
| --- | --- |
| `mutation-checks-attempt1.*` | M6, M8 and M11 survived. The T3 shadow and timeout tests were then strengthened (per-task-type evidence and asserted empirical points; a spoken timeout with `lastInterrupt.source`) |
| `mutation-checks-run2.*` | 13 killed |
| `mutation-checks.*` (final) | 13 killed. Re-run after the Bunny → Gada test was extended to Gada → Sword |

| Id | Mutation | Result |
| --- | --- | --- |
| M1 | An unaccepted (pre-Gate-G) active policy drives live weights | Killed |
| M2 | Acceptance skips the shadow verified-count requirement | Killed |
| M3 | An unverified outcome counts as shadow-verified evidence | Killed |
| M4 | Replay attributes outcomes to decisions the active policy would not make again | Killed |
| M5 | A stopped Task's outcome is attributed | Killed |
| M6 | The handler's workstation check is removed | **Survives (equivalent mutation).** `assertDeviceAction` default-denies every unmapped device action before the handler is reached, so removing the inner check changes no behaviour. The handler check is kept as defence in depth |
| M7 | `routingLearning` projected to devices | Killed |
| M8 | Live routing uses the shadow policy's weights | Killed |
| M9 | The personalized instruction drops the action-refusal rules | Killed |
| M10 | Ratings written to disk while remembering is off | Killed |
| M11 | A timeout counts as the user interrupting | Killed |
| M12 | The per-identity voice is ignored | Killed |
| M13 | An uninstalled voice name is accepted | Killed |
| M14 | `voicePersonalization` projected to devices | Killed |

### Browser QA

`test-results/ma3/t13-3/gate-g/browser-qa.md` and `screenshots/`, run against a disposable QA Host. QA found one defect: the Routing improvement buttons had no button styling. It was fixed and re-checked. The panels show no horizontal overflow at 390×844.

## 4. Limitations

- **Routing improvement is unexercised on real evidence.** On a fresh Host, Propose honestly refuses until verified Tasks exist, and a shadow run needs at least 5 verified live Tasks. No candidate was accepted on live provider work in this gate.
- **The routing signals have gaps.** The tool error rate is not separated from other failures, and cloud cost is unknown.
- **Two voice settings are not adjustable:** speaking pace and interruption preference.
- **Speech recognition language is fixed** to the recognizer installed on the PC.
- **Notification frequency applies to browser notifications only.** The workstation's preference applies there; devices are unaffected.
- **Ratings only work for recent answers.** They need an answer from the current Host run, because the last-answer list lives in Host memory only.
- **Personality is prompt-only.** It shapes the instruction; adherence by a live model was not tested.
