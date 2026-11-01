# Voice boundary receipt — spoken-phrase authorization exclusion (masterplan backlog row #7)

**Branch:** `test/spoken-approval-exclusion` · **Base:** main `8685c59` · 2026-11-01
**Hard rule (§17/C4):** a spoken phrase — any transcription, especially Bunny's own output — is
never an approval or authorization.

## What the recon established (read-only audit, one merged worktree)

Every phrase enters via `VoiceSessionManager.acceptFinal` → `classifyTranscript`
(`voice-intent.ts`). Approval-shaped language is refused at intent level; `confirm` only
executes already-proposed pause/stop controls; drafts land in `waiting_for_approval` and are
never started. Approvals remain id/enum/revision-keyed everywhere; `answerApprovals`
explicitly cannot approve by voice; journals keep transcripts as evidence, never control
flow. Existing locks cover the intent/session/duplex/approval surfaces
(`approvals-model.test.ts`, `voice-intent.test.ts`, `voice-session.test.ts`,
`voice-duplex.test.ts`, `voice-answers.test.ts`, `voice-agents-t12.test.ts`,
`t14-autonomy-host.test.ts`).

**The material untested boundary** was the one place a phrase alone authorizes execution:
`TaskManager.approveVoiceTurn` (manager.server.ts) — local, probed, tool-free admission
("approval.voice_tool_free"). Its guards had zero test references.

## Locks added (`src/lib/bunny-host/voice/voice-admission.test.ts`, 4 locks, node:test)

1. **Happy-path honesty:** a spoken question (fake voice-chat submit with the voice chat
   port's exact constraints `localOnly+offlineOnly`) waits in `waiting_for_approval` and is
   admitted only as a local ollama generation with a concrete probed model — the phrase
   itself is the only authority, and it pins the route like a device approval.
2. **Cloud-only probe:** with `offlineOnly/localOnly` hard constraints, a cloud-only provider
   is unrouteable — the route refuses before any waiting task exists, so the voice boundary
   never even opens for it.
3. **State guard:** once a task has left `waiting_for_approval` (e.g., a workstation/device
   launcher approved it), the voice gate refuses a second authority — no double authorization.
4. **Structural §17:** `VOICE_ACTIONS ∩ MISSION_ACTIONS = ∅` and every voice action is
   namespaced `voice.*` — the voice HTTP surface cannot reach mission approval paths.

Also verified in code-read (documented, not re-tested here): the hosted-tag/remote-model
refusals (`isRemoteOllamaTag`, unprobed list never trusted) and the mission-bound refusal sit
inside the same predicate (manager.server.ts:1668-1695) covered by lock 1's re-checks.

## Fixtures note

Routing preferences come from the probed list; the fixtures pin `preferredLocalModel` to the
probed model to keep route selection deterministic — the admission guards, not the router,
are what this lane locks. Committed receipts in `test-results/voice-approval-exclusion/`:
admission-lock run (4/4), full voice suite, typecheck, lint.

## Scope guard

Test-only lane (one new `.test.ts`); no product code, no production deps, no native shell.
CI: static security · typecheck/builds/UI · full `npm test` (~25 m). Agent does not merge.
