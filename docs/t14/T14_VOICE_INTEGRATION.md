# M-A-3 T14 — Voice-to-action

T14 changes no voice code. The T10/T12 voice session already has the shape the brief asks for; T14 proves it against the
autonomous flows (Scenario H, `t14-autonomy-host.test.ts`).

## The path

1. The owner speaks a goal ("prepare a plan for writing the changelog").
2. The voice session classifies it as `mission_draft` and calls the canonical `mission.create` (origin
   `voice:workstation`, fast, local-only).
3. The draft waits for review: autonomy phase WAITING_AUTHORIZATION. Voice can never approve or start it ("I can't
   approve or start it by voice").
4. The owner approves on the Windows Host screen; from then on the Mission runs like any other.
5. Bunny keeps talking. Status questions are answered from Host facts, not from a model.

## What voice can never do to a running Mission

| Spoken / control | Result | Checked in T14-H |
| --- | --- | --- |
| "be quiet", "stop talking" (`speech_stop`) | Silences Bunny only | Mission and step still running, no dispatch |
| Barge-in `voice.interrupt` | Cancels speech only | unchanged |
| "stop the mission" (`mission_control`) | A screen-confirmed proposal; nothing happens until confirmed on screen | unchanged; then `voice.control.cancel` |
| `voice.session.close` | Ends the voice session only | Mission keeps running and completes afterwards |
| A paired device | Every voice action refused (V38/V53, unchanged) | — |

## Simulated versus real

- **Real:** the contained native voice worker (`bunny-voice-worker.exe`) under the Host's integrity check and job
  containment, opened through `voice.session.open`, with real turns through the Host's voice session.
- **Simulated:** speech input. Turns are typed with `voice.text`; the worker runs with `--output null`, so nothing is
  played. In the development worktree the whisper runtime is not staged, so recognition falls back to Windows SAPI
  (reported honestly as `STT_UNAVAILABLE`); typed turns do not use recognition.
- **Not tested in T14:** a real microphone, a real speaker and full-duplex barge-in by voice. The T10 and T12 live
  receipts remain the evidence for those.
- The word "release" is classified as a sensitive verb by T12 (a spoken plan to *release* something is refused, not
  drafted); T14-H uses "changelog".
