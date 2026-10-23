# MA4-S2R1 — Negative retrieval tests

All in `src/lib/bunny-host/ma4-s2r1.test.ts` (run by `npm run test:ma4`). Deterministic, no model. Each case asserts
the **specific recorded reason**, not just an empty result, so a case cannot pass by failing for the wrong reason.
Fixtures are three attested, benchmark-qualified skills built through the real `SkillRegistry` lifecycle
(propose → screen → sandbox evidence → qualify evidence → `attest`): an ISO-date procedure (validated on a strict
`YYYY-MM-DD` parser), a median procedure (validated on a debugging task over a list of numbers) and a slug procedure.

## Required cases (prompt §B2)

| Case | Task the skill is offered to | Recorded reason |
|---|---|---|
| Matrix rotation vs date parsing | `rotate_matrix(matrix)` (debug) vs the ISO-date skill | `operation parse-date not required by the task (rotate)` |
| Similar tags, incompatible input type | `to_iso(values)`: list of numbers → `YYYY-MM-DD` strings (same format literal, same `strict-parsing` tags) | `input str incompatible with list<number>` |
| Correct domain, wrong operation | `most_frequent(values)` and `arithmetic_mean(values)` vs the median skill | `operation median not required …` |
| Correct operation, missing required tool | `slug_filename` with only `ma4.static_check` granted vs the slug skill (needs `ma4.run_tests`) | `requires tools not granted: ma4.run_tests` |
| Expired record | `weekday_name` two days after a 1-day attestation | `applicability attestation expired` |
| Untrusted record | the same skill in `candidate` / `quarantined` state | `state … is not usable in evaluation mode` |
| Wrong project scope | attested in `project:a`, requested for `project:b` | `validated in project:a, not authorized for project:b` (passes only with an explicit `authorizedScopes` grant) |
| Invalid provenance hash | the record edited after attestation (one step added) | `content does not match its attested hash` |
| Missing applicability metadata | contract removed | `missing applicability metadata` (the only reason; nothing else is evaluated) |
| Malicious instructions embedded | five forged records whose hash was recomputed to match, so only content defends: steering, external upload URL, model switch, `SYSTEM:` impersonation, "approved by the owner" | `unsafe content: …` with the specific screen |

## Pre-registered near-miss families

| Task | Skill | Reason |
|---|---|---|
| `hms_to_seconds` (`HH:MM:SS`) | ISO date | operation parse-date not required |
| `parse_dmy` (`DD.MM.YYYY`) | ISO date | precondition `formats ∋ YYYY-MM-DD` not satisfied |
| `to_snake` | slug | operation slugify not required |
| `class Stats` with a `median` method (planning) | median | category plan not in implement/debug |

## Memory (experience) cases

* S2-era experience records (tags only, no signature) → `missing applicability metadata`.
* A record from `add_days` (`parse-date`, `YYYY-MM-DD`, `str`) is eligible for `days_between`, rejected for
  `hms_to_seconds` (operation) and `parse_dmy` (format).
* Project B never sees project A's records; an expired record is not retrieved however relevant; a model-trust
  record with steering text is never retrieved; a Host-trust record containing a forged approval is rejected as
  unsafe content and grants nothing (the skill stays unusable in product mode).

## No false positives on development data

`evidence/relevance-dev.json` (8 dev tasks) and `evidence/relevance-s2-regressions.json` (24 S2 tasks), all nine S2
skills offered to every task: dev TP 3, FN 0, **FP 0**, TN 5; S2 TP 3, FN 0, **FP 0**, TN 21.
