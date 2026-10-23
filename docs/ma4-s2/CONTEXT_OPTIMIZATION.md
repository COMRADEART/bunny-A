# MA4-S2 — Task memory and context optimization

| Requirement | Implementation |
|---|---|
| Project-aware context selection | retrieval takes the Host-authorized Lotus scopes only (`project:<id>`); the evaluation uses its own scopes |
| Memory relevance scoring | Lotus `rank` over Host-derived task tags (`taskTags`: strict-parsing, validation-errors, debugging, stateful-class, string-processing, collections, algorithm, numeric) — never model-chosen tags |
| Evidence-based retrieval | only `verified` records whose stored hash still matches; skill pointers resolve only to registry skills usable in the mode |
| Bounded working context | ≤ 3 skills, ≤ 3 experience lines, ≤ 1,200 characters per role and phase; each skill ≤ 400 characters; contract and prompts otherwise unchanged |
| De-duplication | Lotus dedupes identical key+value per scope/layer (refreshes instead of duplicating); one pointer per skill version; duplicate skill names are rejected at discovery |
| Staleness detection | expiry per record (`retentionDays`), `prune()`; Lotus outer-petal TTL unchanged |
| Explicit references | each shown skill is cited `[name vN]`; the workflow records per role/phase the guidance hash, size and source ids (`skill:<id>`, `memory:<id>`) — never the text |
| Safe summarization/compression | the central bud holds Host-written one-line pointers, not procedures; Lotus `compact` (existing) is unchanged |
| No private data by default | experience text is composed from Host facts only (status, kind, tags, categories); prompts, files, outputs, sources and conversations are never stored; memory is off unless enabled |
| Current instructions win | guidance is labelled advisory and placed after the contract ("the task contract above always wins") |

Measured cost of retrieval (latency, tokens) is reported per arm in `INTELLIGENCE_EVALUATION.md` §2: arm C vs arm B
differs only by retrieval and guidance, so the difference in prompt tokens and call latency is the cost of memory.

Measured on the held-out run: arm C used **+26 % prompt tokens** vs B (149,519 vs 118,313; ≈ 700 characters of
guidance per role call), call latency was unchanged (median 14.1 s vs 14.2 s, P95 34.3 s vs 31.2 s), and correctness
was lower (10/24 vs 14/24). The bound held, but relevance did not: one shared coarse tag was enough to attach a skill,
so unrelated procedures filled most of the budget (INTELLIGENCE_EVALUATION §2.4). Context was bounded, not optimized.
