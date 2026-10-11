# M-A-3 T10 — Independent security review (§42)

## Method

Four review rounds were run on the T10 source by independent agents. Each agent was given a single review lens and read the code itself; none shared the authoring context.

In rounds 1–3, two independent verifiers were asked to **refute** each finding. In round 4, one adversarial verifier per finding did the same. A finding counts only if it survived verification.

Raw findings, with verifier verdicts and dispositions, are in `review/round1-findings.json` … `review/round4-findings.json`.

| Round | Scope | Lenses | Findings raised | Survived verification | Outcome |
|---|---|---|---|---|---|
| 1 | Full T10 source (b80fab6) | authz, privacy, races, native, containment, truth | 40 | 1 HIGH, 12 MEDIUM, 20 LOW (2/2) | HIGH and every MEDIUM fixed in ae026b1 |
| 2 | Round-1 fixes plus full re-read | fixcheck, authz, races, native, containment, truth | 27 | 13 MEDIUM (2/2, including 2 MEDIUM/LOW splits), 7 LOW | Fixed in ae026b1 / a23fd8e |
| 3 | Whisper integration and round-2 fixes | intent, session, worker, clients | 15 | 4 MEDIUM (2/2), 5 LOW | Fixed in a23fd8e. LOWs disclosed below. |
| 4 | Live Part-B fixes (08aab35, e80d313) | host-races, worker-vad, authority-intent | 13 | 3 MEDIUM (H-RELAUNCH-WAKE, T10-VAD-1, T10-VAD-2), 6 LOW (2 duplicate one issue; D1 was downgraded from MEDIUM to LOW by its verifier); 4 refuted | 2 MEDIUM and 4 LOW fixed in aed363b. T10-VAD-2 (MEDIUM) and D1 (LOW) disclosed. |

## Invariants checked in every round

| Invariant | How it holds |
|---|---|
| Speech is never identity | `voice.*` actions are workstation-only, using the workstation Bearer token over loopback. They are absent from `DEVICE_RIGHTS`, so paired devices are refused before any data is read (V38, V56). No voiceprint or speaker identification exists. |
| Voice never authorizes privileged actions | The deterministic classifier runs first. Sensitive phrasing (approvals, permissions, shell, deletion, publishing, credentials, settings) is refused. Agent Stop and Resume need an on-screen Confirm. Pause may be confirmed by voice only through a proposal bound to agent id, revision, Host epoch and a 30 s TTL. Every execution uses the canonical `agentCommand` path. |
| Chat cannot become agentic execution | Voice chat goes through `TaskManager.submit` with forced `localOnly`/`offlineOnly`. `approveVoiceTurn` admits only a tool-free local provider with a concrete non-`:cloud` model. The DEV-01 pin prevents a launch-time reroute, and exec-time `localOnly` refuses hosted tags (V16, V42). |
| No cloud audio | whisper.cpp and SAPI run locally. The worker source contains no network API (`cloud-egress-verification.json`). The browser Web Speech path was removed. |
| No raw audio retained | PCM stays in bounded worker memory. Nothing is written to disk, stdout, the journal or evidence. The secret scan also scans for audio files (V52). |
| Stale sessions cannot act | Generation, turn and session epoch checks drop late events. A close joins any in-flight close. A press waiting on transcription re-checks the epoch, the relaunch gate and the worker before acting (round 4). |
| Worker containment | The F04 OwnedProcessGroup applies: job membership is verified before resume, KILL_ON_JOB_CLOSE is set, breakaway is not allowed, and there is no uncontained fallback. The environment is limited to `SystemRoot` and `windir`. The worker, shim, runtime DLLs and model are sha-verified before every spawn. |

## Round 4 detail (the source in the final package)

| ID | Severity (verified) | Disposition |
|---|---|---|
| H-RELAUNCH-WAKE | MEDIUM | **Fixed aed363b.** A waiting press re-runs the idle-relaunch gate after its wake. The new test fails without the fix (mutation-checked). |
| T10-VAD-1 | MEDIUM | **Fixed aed363b.** The end cap is now 0.002 and the smoothed peak decays. Selftest `softAfterLoudEndFrame` covers it. |
| T10-VAD-2 | MEDIUM | **Disclosed limitation.** The energy end rule needs the speaker's peak to be at least about 12× the room noise. Otherwise the turn ends on hotkey release, a second tap, or the 30 s cap. |
| T10-VAD-3 | LOW | **Fixed aed363b.** `speechMs` counts onset-threshold frames again. |
| M-A-3-T10-D1 | LOW (verifier-downgraded from MEDIUM) | **Disclosed.** Lead-word variants ("Stop, is it okay to accept it?") classify like the pre-existing bare question form, which is a tool-free chat turn that grants nothing. |
| M-A-3-T10-D2 | LOW | **Fixed aed363b.** "No, …" while a proposal is pending cancels the proposal. |
| M-A-3-T10-D4 / L-CLOSE-SOURCE-SHADOW | LOW | **Fixed aed363b.** A second in-flight close journals its own label. |
| L-BUSY-TRANSCRIBING-COPY | LOW | **Fixed aed363b.** |
| M-A-3-T10-D3, T10-TEST-1, L-WORKER-EXIT-WAIT, L-CAPTURE-STOP-REASON-UNVALIDATED | — | **Refuted** by the verifier. |

## Disclosed residuals (not repaired)

- **R3 clients#0 (LOW).** The Island hotkey uses source `hotkey`, so voice-activity endpointing applies to a short tap. A hold of at least 350 ms ends the turn explicitly on release.
- **R3 worker#1 and worker#2 (LOW), R2 native#4 (LOW).** Worker stdout writes happen under locks. These are minor native robustness items with no authority impact.
- **Canonical agent-runtime pause/stop do not themselves check revision.** Voice re-checks the revision immediately before calling them, and a TOCTOU window of one tick remains.
- **A same-user writer replacing `native/voice`.** This is outside the F04 contract, as for every same-user binary. Integrity checks catch tampering at the next spawn.
- **Approve-synonym questions** ("is it okay to <approve-synonym>") are classified as chat. The model's spoken-mode instruction says it cannot act, and the turn is tool-free.
- **T10-VAD-2 and D1**, as described above.

## Verdict of the review

No HIGH finding remains open. No remaining finding breaks authority, identity, egress, privacy or containment. The open items are robustness limits of energy-based endpointing and classifier wording. They are listed in `limitations.md`.
