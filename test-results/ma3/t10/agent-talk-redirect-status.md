# M-A-3 T10 — Agent Talk / Redirect status

**Decision: §15 option B.** Free-form Agent Talk and Redirect remain **unsupported and disabled**. This is disclosed to the user by voice and in this evidence.

## Why not option A in T10

T8 and T9 identified free-form Agent steering as unsupported. The Host has no canonical command that injects a conversational message into a running Mission (`MA3_T8_PREMIUM_UI_ACCEPTANCE.md`, `MA3_T9_PHONE_REMOTE_ACCEPTANCE.md`; the audit confirmed there is no `agent.talk` or `agent.redirect` action in `AGENT_ACTIONS`).

A safe steering path would need all of the following:
- durable message records bound to exact Agent and Mission IDs;
- a reviewed re-plan path that preserves the accepted Mission graph;
- re-authorization when new resources or capabilities are needed;
- duplicate suppression;
- restart reconciliation;
- its own adversarial matrix.

None of this exists yet. Sending a transcript to a provider would be the "unreviewed conversational side channel" that §15 forbids.

## What voice does instead

- The deterministic intent classifier (`src/lib/bunny-host/voice/voice-intent.ts`) maps redirect-style requests to `redirect_unsupported`. Examples: "tell the agent to …", "change the plan", "redirect it", "instead do …".
- Bunny answers by voice: redirecting a running agent isn't supported in this version, and the user can stop it and start a new Mission in the Agentic workspace.
- No Task, proposal, Mission change or provider message is created. This is covered by the V41 tests in `voice-intent.test.ts` and `voice-session.test.ts`.
- Supported Agent controls stay exactly the existing canonical commands: `agent.pause`, `agent.resume`, `agent.stop` with `{id, revision}`, gated as described in `voice-command-authorization.json`.

## Re-evaluation trigger

Option A should be a dedicated gate with its own Host command, persistence schema and authorization review. It is not a voice feature.
