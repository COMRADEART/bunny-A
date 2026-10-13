# MA3 T12 independent security and correctness review

Every review was performed by independent agents that did not write the code under review, using concrete probes (unit-test
harness copies, node ports of the native classes, classifier probes). Each round's findings were repaired and the repair was
itself re-checked by a fresh reviewer. Rounds are listed with the commit reviewed and the repair commit.

| Round | Reviewed | Lenses | Highest severity found | Repaired in |
|---|---|---|---|---|
| 1-2 | cc33de5 + 61fad6d (core, intents) | echo, grant, receipts, authority, lexicon, caps | HIGH (echo/grant/authority classes) | 7fb3e60 |
| 3 | 7fb3e60..0c225e1 | authority, truth, native, lifecycle (5 agents incl. adversarial verifier) | MEDIUM (9 confirmed), LOW (5); no BLOCKER/HIGH | b4b29b9 |
| 4 | b4b29b9 | adversarial re-check | HIGH: claim-guard regression (lead-in hid a claim); MEDIUM: residual reseed pin | 6aa99ba |
| 5 | 6aa99ba | adversarial re-check | HIGH: held fragment could confirm a later proposal (agent.pause only); HIGH: claim-guard misses | 8b405b4 |
| 6 | 8b405b4 | fragments, claims, native (3 agents) | HIGH: claim-guard misses (new phrasings, chunk split); MEDIUM: fragment chains, native lead-in | d6fd564 |
| 7 | d6fd564 | authority, native, claims miss-rate measurement (3 agents) | MEDIUM; **no BLOCKER/HIGH** | 92a4636 |
| 8 | 92a4636 | focused verification of round-7 repairs (draft refusal, mute vs fragments, first seed, authority) | MEDIUM (2), LOW (2); **no BLOCKER/HIGH**, no authority bypass | disclosed, not changed |

## Authority (voice never grants)

No round found speech (the user's, recorded, Bunny's own, overlapped, or fragment-built) that approves, starts, grants or
runs anything. One HIGH in round 5 let a held fragment confirm a later voice-confirmable **pause** proposal. Pause is the
only voice-confirmable action and is reversible. This was repaired in 8b405b4: fragment-built turns can never confirm, and
typed or push-to-talk input, mute, mode switch, errors, worker exit and interrupt drop held words. Rounds 6-8 re-probed every
arrangement (held + joined, timed out, under a live proposal, across close/reopen) and found no execution.

Live: 10/10 synthetic hostile/recorded clips gave 0 authority violations (`hostile-audio-results.json`). Bunny's own spoken
"Confirm." with a live proposal produced 0 turns and 0 executions (2 trials).

Open design question, recorded rather than changed: a **typed** "yes" in the Island's voice text box confirms a
voice_or_screen pause proposal (TYPED_META is not overlapped). The typed path is the workstation's own loopback UI, at the
same trust level as the on-screen button. The rule text says "spoken confirm".

## Truthfulness guard on the tool-free chat model (defense in depth)

The chat model has no tools and the Host never acts on its text. The action-claim guard replaces sentences that claim Bunny
acted or that report Agent/Mission/item state as done. Reviewers rated guard misses HIGH under this gate's rubric (a spoken
false claim of action), and each round's reported phrasings were fixed. The guard is a pattern backstop, so it cannot be
complete. On a fresh independent set in round 7 it caught **42 of 60 false claims (70 %)** and flagged **2 of 60 honest
answers**. The residual is disclosed in `limitations.md`. It is a truthfulness limitation with no authority impact; it is not
claimed as closed.

## Open MEDIUM/LOW (disclosed)

- **Native, simulated unsupported devices only:**
  - a loud-echo device with a silent lead-in over 1 s;
  - AEC convergence (loud-then-quiet);
  - wide per-frame jitter.

  The measured device's echo (2e-5..8e-5 RMS) is below these regimes.
- **Native, first reply (round 8, MEDIUM):** in a node port of AmbientFloor, a user who starts speaking within the first
  ~260 ms of the session's first audible reply seeds the echo residual at the cap. Their barge-in is then missed for that
  reply, and possibly the next, until a reply samples echo-only frames. Onset at 260 ms or later was detected at 100 ms.
  This is a missed interruption, not an authority path.
- **Cut-off drafts (round 8, MEDIUM):** the cut-off check is a closed list of words that cannot end a request. A request
  cut after another word ("Prepare a plan for the reports in") still creates a voice Mission draft. That draft is in
  AWAITING_REVIEW, and nothing runs until it is approved on the Windows Host screen. Widening the list would refuse
  legitimate requests ("…logging in"), so it is disclosed instead.
- **False cut-off refusals (round 8, LOW):** a draft ending in a standalone "a" ("vitamin A") or a trailing "um"/"uh" is
  refused as cut off. Nothing is created and the user is asked to repeat.
- **Native, near-cap echo:** with a learned residual near the 0.003 cap, barge-in needs about 2x the echo level.
- **Native, floor pumping:** sustained speech with no duplex turn attached raises the floor.
- **Session:**
  - typed confirm (see above);
  - "Are you running any tasks?" is a conservative false refusal;
  - control by role name is unsupported.
