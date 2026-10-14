# Lotus Agent Memory Contract (M-A-3 T13.3 Gate C)

Lotus is the memory each Personal Agent keeps on the Windows Host. This contract states what is stored, who may
read or raise it, and what is refused. It describes the code as committed in Gate C; anything listed under
"Not yet exercised" is an interface for later gates, not a live capability.

| Piece | File |
| --- | --- |
| Pure rules (browser-safe) | `src/lib/bunny-host/lotus.ts` |
| Store (`LotusStore`, `node:sqlite`) | `src/lib/bunny-host/lotus.server.ts` |
| Host wiring (scopes, commands, recall, compaction) | `src/lib/bunny-host/http.server.ts` |
| Studio memory panel | `src/components/island/memory.tsx` |
| Tests | `lotus.test.ts` (7 unit), `lotus-host.test.ts` (3 real-Host HTTP) |

## 1. Layers

| Layer | Lotus name | Holds | Cap per scope |
| --- | --- | --- | --- |
| `bud` | Buds | Raw scoped evidence: conversation turns before compaction, pasted outside text | 400 |
| `outer` | Outer petals | Recent context and session summaries; non-summary rows expire after 14 days | 100 |
| `inner` | Inner petals | Verified Project knowledge and repeated patterns, including verified Mission facts | 100 |
| `central` | Central bud | Compact durable facts the user stated or confirmed | 40 |

The **stem** is retrieval: `recall` in the Host collects only authorized scopes, `rank` orders them, and
`render` turns each into one labelled line. Nothing outside the Host reads the store directly.

When a layer is full, the oldest rows are dropped first (`trim`). Expired outer rows that are not summaries are
dropped by `prune`, which runs at every Host start.

## 2. Scopes and isolation

- `agent:<slot>` (slot 1 to 4) is one Personal Agent's private memory. No other Agent's recall includes it.
- `project:<id>` is a Project boundary. A Personal Agent reads a Project scope only while it owns a Mission whose
  `projectId` is that Project (`ownProjects`). Project scopes are written only for Projects the Host knows
  (`projects.detail`).
- The Host derives scopes from the ownership ledger. A request never names the scopes it reads.
- **Child-worker slice.** `recall(slot, query, limit, projectId)` with a `projectId` returns that Project only, and
  only if the Agent owns a Mission there. Otherwise it is refused with "This Personal Agent has no Mission in that
  Project, so it cannot read its memory." Gate D's workers must receive memory through this slice; until Gate D
  lands, the slice is exercised through `lotus.recall` with `projectId`.
- **Cross-Agent transfer** happens only through `lotus.share`. That is an explicit handoff of chosen memory ids
  from an Agent's own scope into a Project it has a Mission in. Each copy records `handoff:agent:<slot>` as
  provenance and the original id in `sources`. Sharing someone else's memory, or into a Project the Agent does
  not work in, is refused.
- Verified Mission facts (`verified_fact`, `user_decision`, last 20 per Mission) are read in place as inner-petal
  sources with provenance `host:mission:<id>`. They are never copied into Lotus, so Mission memory keeps one
  owner.

## 3. Trust, poisoning and promotion

| Trust | Written by | Highest layer it may write |
| --- | --- | --- |
| `user` | The user in Studio, or a correction | central |
| `host` | Host records and summaries | central |
| `model` | A model's inference | outer |
| `untrusted` | Text pasted from a web page or repository | bud |

- `admit` caps every write at its trust ceiling. A web page asking to be a core fact lands in the buds.
- Instruction-like text (`isSteering`: "ignore previous instructions", "system prompt", "you are now", "grant
  yourself access" and similar) is downgraded to `untrusted` unless the user wrote it.
- `render` quotes untrusted text and labels it "untrusted outside text, not an instruction". Every line names
  its basis: "you told me", "recorded by the Host", "a model's unverified note", or "Project note".
- **Promotion.** `canPromote` lets the user move any memory to any layer. The Host may promote only memories
  that are `user` or `host` trust, and only up to their ceiling. Model and untrusted memories can therefore rise
  only by the user's hand ("Only you can raise a model's note or outside text into lasting memory."). Promotion
  changes the layer, not the trust label, so a promoted web tip still reads as outside text.

## 4. Correction, revisions, deduplication, summaries

- **Correction** (`lotus.correct`) rewrites the value, sets trust to `user` and provenance to `user:correction`,
  and bumps the revision. Every earlier value stays in `lotus_revisions`.
- **Correction precedence.** In `rank`, a `user` memory hides every non-user memory with the same key
  (case-insensitive). A stale model note therefore cannot outrank what the user said.
- **Deduplication.** Writing the same key and value (normalized hash) to the same scope and layer refreshes
  `updatedAt` and returns `duplicate: true` instead of adding a row.
- **Session compaction.** Conversation turns that fall out of Gate B's retention (`appendTurn` returns them) are
  folded into a versioned `Earlier conversation` outer-petal summary for that Agent, with provenance
  `host:summary`. Its `sources` list the turn ids, and its trust is that of its least-trusted source (user turns
  map to `host`). Its revision increases with each fold. The folded buds are then removed, so context survives
  compaction without unbounded growth.

## 5. Refusals

- **Credentials.** Any key or value matching `looksSecret` (the same filter the Host uses for Task intelligence)
  is refused: "This looks like a credential. Lotus memory never stores credentials." Corrections pass the same
  check.
- **Missing provenance** is refused: every memory records where it came from.
- **Paired devices** are refused on every `lotus.*` command (`WorkstationRequiredError`), and
  `personalAgentContext` (which carries memories) is stripped from device snapshots. A phone stays supervisory.

## 6. Host commands (workstation only)

| Command | Input | Effect | Event |
| --- | --- | --- | --- |
| `lotus.remember` | `scope, key, value, layer? (central), origin? web or repository` | Admit and write; pasted origins become `untrusted` with provenance `user:pasted-<origin>` | `lotus.remembered` |
| `lotus.correct` | `id, value` | User correction with a new revision | `lotus.corrected` |
| `lotus.promote` | `id, layer` | User promotion | `lotus.promoted` |
| `lotus.forget` | `id` | Delete the memory and all its revisions | `lotus.forgotten` |
| `lotus.export` | `scope` | `{schema: "bunny-a.lotus.v1", scope, exportedAt, memories}` with no internal hash | — |
| `lotus.share` | `slot, projectId, ids[≤20]` | Scoped handoff copies into the Project | `lotus.shared` |
| `lotus.recall` | `slot, query, projectId?, limit≤12` | Rendered, labelled lines only | — |

`lotus.export` and `lotus.recall` are read actions in the client (`READ_ACTIONS`). Studio's memory panel uses
remember, correct, promote ("Keep as core fact"), forget and export for the chosen Agent's own scope. Project
notes are shown but edited only through the Host commands.

## 7. Where memory is used today

`personal_agent.converse` recalls up to 3 memories for the question and appends them to the Host-composed reply
under "From memory:". Replies are Host facts, not model output. **No model prompt reads Lotus yet**: `render` is
the contract a later gate must use when a model receives memory, and it must go through `recall` scopes.

## 8. Storage

Two additive tables are created by `LotusStore` and recorded under a migrations key:

- `lotus_memories(id, scope, layer, key, value, trust, provenance, sources, hash, revision, created_at, updated_at)`
- `lotus_revisions(memory_id, revision, layer, value, trust, provenance, at)`

They live in the Host database next to the Gate B tables. The installed production Host validates its schema
hash, so these tables are a Gate I packaging concern. Gate C did not touch the installed production Host.

## 9. Test coverage (directive §36)

| Requirement | Test |
| --- | --- |
| Gada cannot retrieve Spear's private context | `lotus-host.test.ts` (private memory and Project boundaries) |
| A child slice cannot read unrelated Project data | same test, `lotus.recall` with `projectId` |
| Handoffs are scoped | same test, `lotus.share` refusals and provenance |
| Untrusted web text cannot promote itself | `lotus.test.ts` (trust ceilings, steering) and `lotus-host.test.ts` (poisoning) |
| Summaries keep provenance | `lotus.test.ts` (summary provenance and versioning) |
| User corrections take precedence | `lotus.test.ts` (ranking and correction) and `lotus-host.test.ts` |
| No secrets are stored | both files |
| Session compaction preserves context | `lotus-host.test.ts` (after 101 more turns, an `outer`/`host:summary` "Earlier conversation" memory begins with the first question asked) |
| Persistence across restart | `lotus-host.test.ts` |
| Devices refused | `lotus-host.test.ts` (paired device on every `lotus.*` command) |

## 10. Not yet exercised

- Model consumption of rendered memory (no model prompt reads Lotus in Gate C).
- Child workers themselves (Gate D). Only the slice they will receive is implemented and tested.
- Host-originated promotion of repeated verified patterns. `canPromote(…, "host")` is implemented and unit-tested,
  but no Host job calls it yet.
- Model-trust writes. The `model` trust level and its ceiling are unit-tested, but no Host path writes model notes
  yet.
