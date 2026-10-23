# MA4-S2 — Lotus Memory integration

Code: `src/lib/bunny-host/ma4/experience.server.ts` (adapter), `skill-learning.server.ts` (`buildGuidance`).
Existing Lotus (unchanged): `lotus.ts`, `lotus.server.ts`.

## Design: an adapter, not a second memory

Every S2 record is an ordinary Lotus memory — scoped, layered, trust-ceilinged, steering-checked, credential-refusing,
revisioned — written with `LotusStore.write`. The adapter adds one metadata row per record in `ma4_memory_meta`
(record type, content sha256, validation, confidence, task tags, expiry, sensitivity, created-at). Deleting the Lotus
memory orphans the row, which pruning removes.

| Lotus layer | S2 content | Written by | Text source |
|---|---|---|---|
| outer petals | (reserved for run notes; not used by the evaluation) | Host | Host |
| inner petals | **experience**: one deterministic-gate outcome of a task (`strict task [strict-parsing, …]: passed after repair; Worker repair for implementation_defect resolved.`) | Host after the gate decided | Host facts only — no prompt, output, source or hidden detail |
| central bud | **skill pointer**: `Verified procedure <name> vN for <tags> tasks (k passing validation stages; state …)` | Host after qualification | Host facts only; the model-written procedure stays in the skill registry |
| stem | `ExperienceMemory.retrieve` → Lotus `rank` over Host-derived task tags | Host (Researcher role) | — |
| root | the Coordinator decides what a role is shown; memory never overrides policy, pins, contract or acceptance | — | — |

## Record requirements (all present)

identifier (Lotus id) · project/session scope (`project:<id>`) · record type · provenance (`host:workflow:<task>`,
`host:skill:<id>`) · content hash (sha256 of key+value, re-checked at every read) · creation time · validation status ·
confidence · task categories (tags) · expiry (policy `retentionDays`, 1–365) · sensitivity (`synthetic` / `project` /
`personal`).

## Retrieval (the stem) — what can reach a prompt

Only records that are: in a scope the caller passed (the Host decides scopes, never the model) · `verified` · not
expired · Host- or user-trusted · of an allowed sensitivity (default `synthetic`, `project`; `personal` excluded) ·
of the requested record type · **unchanged since written** (hash check). Ranking is Lotus' own (`rank`: word overlap,
layer, trust, recency). A skill pointer only yields guidance if the registry has that exact name and version in a
state usable in the current mode (product = ACTIVE only).

Shown text is bounded (≤ 3 skills, ≤ 3 experience lines, ≤ 1,200 characters), labelled advisory, and placed after
the contract: "the task contract above always wins". Retrieved context cannot override the user's explicit
instructions, pins or the deterministic gate.

## Safety properties (tests in `ma4-s2.test.ts`)

| Property | Mechanism | Test |
|---|---|---|
| Local by default; never sent to an external model by this module | SQLite on the Host; no network code | structural |
| Off unless the user enables it | `ma4_s2_memory_v1` policy, default `enabled: false`; disabled = no write, no read | "memory is off by default" |
| No credentials | Lotus `admit` refuses credential-like text | "incorrect-memory resistance" |
| No prompts, files, outputs or source stored | experience text is composed from Host facts only | "provenance" |
| Project scoping, no cross-project access | reads take explicit scopes | "cross-project scope sees nothing" |
| Poisoning resistance | model-trust, untrusted and steering records are excluded; tampered rows fail the hash check | "incorrect-memory resistance" |
| Stale records identifiable and removed | expiry in metadata; `prune()` | "expired" |
| Deletion | `forgetScope(scope)`; Lotus `forget(id)` | "retrieval quality" |
| Provenance retained | Lotus provenance + sources + revisions | "provenance" |
| Retrieval quality | precision@3 = 1.0 on the fixed corpus and queries | "retrieval quality" |

## Evaluation use

Experience is written from train-split (discovery) and qualify-split trials only; the held-out phase reads memory and
writes nothing, so no held-out trial can influence another.
