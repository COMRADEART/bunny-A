# MA4-S2R1 — Task signature schema

`taskSignature(task, ctx)` in `src/lib/bunny-host/ma4/relevance.ts`, version `bunny-a.ma4-s2r1.task-signature.v1`.
Deterministic and pure: computed from the frozen task contract (`spec`, `testerRule`, `kind`) and Host facts
(`projectScope`, granted tools, sensitivity). Never from model output, never from hidden tests or references.

| Field | Type | Source | Example (`days_between`) |
|---|---|---|---|
| `version` | literal | constant | `bunny-a.ma4-s2r1.task-signature.v1` |
| `category` | `implement` \| `debug` \| `plan` | task kind (`debugging` → debug, `planning` → plan, else implement) | `implement` |
| `operations` | string[] | operation lexicon over the contract | `["parse-date"]` |
| `inputTypes` | string[] | input lexicon (`str`, `list<str>`, `list<number>`, `list<record>`, `matrix`) | `["str"]` |
| `outputTypes` | string[] | output lexicon (`tuple`, `int`, `float`, `list`, `dict`, `str`, `object`) | `["int"]` |
| `formats` | string[] | literal date/time templates (`YYYY-MM-DD`, `DD.MM.YYYY`, `HH:MM:SS` …) | `["YYYY-MM-DD"]` |
| `domains` | string[] | derived: operation → domain; list inputs → collections; records | `["calendar"]` |
| `projectScope` | string | Host (the scope the retrieval runs for) | `project:ma4-s2r1-eval` |
| `tools` | string[] | Host: tools the workflow grants (`ma4.static_check`, `ma4.import_smoke`, `ma4.run_tests`) | all three |
| `constraints` | string[] | `raises:<Error>`, `no-mutation`, `strict-format` | `["raises:ValueError","strict-format"]` |
| `validation` | `all-pass` \| `reference-validated` | the Tester rule | `all-pass` |
| `security` | `synthetic` \| `project` \| `personal` | Host classification of the data | `project` |

`signatureHash(sig)` (sha256 of the signature without scope and tools) identifies "a task of this shape" in
`validatedOn` and `knownFailures` entries.

## Operation lexicon

`parse-date`, `parse-time`, `median`, `mean`, `mode`, `slugify`, `case-convert`, `parse-csv`, `merge-intervals`,
`shift-cipher`, `parse-color`, `rotate`, `transpose`. A task whose contract matches none of them has no operation, so
no skill can be eligible for it: the conservative outcome.

**Shortcut, disclosed:** the lexicons are keyword rules, not a learned classifier. They were written against the S2
tasks and the S2R1 dev split. The same engineer had written the S2R1 held-out tasks (committed earlier, in
`707ebea`) before writing these rules; held-out wording was not used to add or change a rule, but that knowledge
cannot be excluded, so the held-out retrieval decisions are reported per task (`INTELLIGENCE_EVALUATION.md`) rather
than claimed as a blind test of the extractor. Upgrade path: a classifier trained on labelled dev signatures, only
with evidence that it beats the lexicon.

Two rules worth naming:

* A date/time template implies a text input only when no other input is named, because the template may describe
  the output (`to_iso(values)` takes a list of numbers and *returns* `YYYY-MM-DD` strings).
* `list<number>` is inferred from "list of numbers/ints/floats", or from a statistic applied to `values` ("median of
  values"), which the dev task `median_ignore_none` needed.

## Development behaviour (no model)

Over the 24 S2 tasks and 8 S2R1 dev tasks the signatures are listed in `evidence/relevance-dev.json` and
`evidence/relevance-s2-regressions.json`. Examples: `tr-median` → debug / median / list<number>; `d-hhmm` →
parse-time / `HH:MM`; `d-mean` → mean / list<number>; `S2 h-rotate` → debug / rotate; `d-chunksum` → no operation.
