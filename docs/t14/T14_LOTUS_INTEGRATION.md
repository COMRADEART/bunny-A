# M-A-3 T14 — Lotus Memory integration

Lotus (T13.3 Gate C) is unchanged. T14 adds one source of facts to it and proves isolation and restoration with the
autonomous flows.

## Scopes

- `agent:<slot>` — one Personal Agent's private memory. Only that Agent recalls it.
- `project:<id>` — a Project boundary. An Agent recalls it only while it owns a Mission in that Project.
- A worker receives the one-Project slice only (at most 4 rendered lines), never its Agent's private scope.
- Verified Mission facts (`verified_fact`, `user_decision`) of the Missions an Agent owns are read in place as
  inner-petal sources, scoped to the Mission's Project (or the Agent when it has none). They are never copied into Lotus.

## What T14 adds

When a worker closes, the Host records its verdict in the parent Mission's memory:

| Verdict | Memory kind | Verified | Reaches Lotus recall |
| --- | --- | --- | --- |
| VERIFIED (Host verification passed) | `verified_fact` with Host-written text only (verdict reason, step count, child Mission) | yes (`bunny:verification:worker:<id>`) | yes, in the parent's scope |
| any verdict | `agent_conclusion` with the steps' reported summaries | no | no |

The parent's later model steps receive the verified facts in their prompt (`memory.context`), which is how delegated
results are integrated (Scenario B shows the dependent step's prompt carrying "Worker Run tests verified" and "Worker
Lint verified"). Unverified model assertions never become permanent facts.

## Evidence

| Scenario | What it proves |
| --- | --- |
| T14-G | After a Host restart, Gada recalls its private note, its Project note and the verified step outcome from the Mission's own facts; Spear (no Mission in that Project) sees none of them; a worker's context holds the Project note and not the private one |
| T14-C | With four Agents running, Spear's recall never contains Gada's private memory |
| T14-K | Gada explicitly shares one memory into a shared Project; Spear recalls it with handoff provenance; Gada's other private memory stays private |

Credentials and secret-looking values are refused by the existing Lotus admission (`looksSecret`); no T14 path writes
provider output or credentials into Lotus.
