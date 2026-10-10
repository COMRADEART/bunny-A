# T9R-F03 independent review — round 2

Two independent reviewer agents (security-auditor) worked on the uncommitted F03 tree after the round-1 repairs. Neither reviewer wrote the change. They used probes only and made no repository edits.

## Reviewer A — manager/state repairs and changed legacy tests

Test runs: `f03-hardening.test.ts` 15/15 and `remote-authority.test.ts` 77/77.

| Item | Verdict |
|---|---|
| 1. Promotion reads verified bytes, then re-classifies with content | PASS. Both refusals land in `end()`. The request closes once and nothing is stranded or written. |
| 2. Retry runs every refusal check before mutating | PASS with F-1 and F-2 |
| 3. Replan clears only non-completed answers (`WITHDRAWN`); `CONSUMED` is kept | PASS |
| 4. Stop cleanup wording | PASS with F-3. No test or UI depends on the old text. |
| 5. Changed legacy tests F01-R6 and F01-R27 | PASS. Not a weakening. Coverage gap F-4. |

| Finding | Severity | Disposition |
|---|---|---|
| F-1: a refused Retry leaves an unspent trusted-desktop grant live | LOW | **Accepted.** A grant cannot be consumed while the Mission is not running. It is bounded by its 5-minute TTL and is revoked by any accepted Retry, Stop or Replan. Revoking on every state change is a broader behaviour change, outside scope. |
| F-2: Retry of a promotion-waiting step left the attempt `running` | LOW | **Fixed.** The attempt is closed as `failed` (`permission_required`). Regression F03-R2-2. |
| F-3: the Stop wording understated the gap (any process spawned after the last sample) | LOW | **Fixed.** Wording corrected. |
| F-4: the F01-R27 in-project case was only unit-checked | LOW | **Fixed.** End-to-end test F03-R2-1: the phone write is refused before staging. |
| F-5: Retry and Replan used different "keep" step lists | INFO | **Fixed.** Aligned on `completed`. |

## Reviewer B — classifier bypass and availability sweep

Reviewer B's controls C1–C9 were refused, so the probe harness discriminated correctly. The reviewer noted that promotion-time re-classification gates only remote envelopes. Under a workstation envelope, the owner's review of the exact bytes is the only control. That is documented in the report.

| Finding | Severity | Disposition |
|---|---|---|
| 1. Default-discovery Markdown executors (MkDocs default `docs/`, VitePress `<script setup>`, pytest `--markdown-docs`) | MEDIUM | **Fixed.** MkDocs `docs_dir` (default `docs`) and `.vitepress` in the root or an ancestor make Markdown destinations `EXECUTION_RELEVANT`; a `markdown-docs` reference counts; any `<script` is `EXECUTION_RELEVANT`. F03-R2-3, F03-R2-4. |
| 2. Obsidian Templater and DataviewJS blocks | MEDIUM | **Fixed.** Content rules for `<% … %>` and `dataviewjs` / `meta-bind-js` / `js-engine` / `templater` fences. F03-R2-4. |
| 3. Runner keyword allowlist for extension globs (`mdsh`, `npx md-runner`) | MEDIUM | **Fixed.** In shell-run text any glob of the extension counts unless the line names a read-only tool (prettier, markdownlint, …), so an unknown runner fails safe. F03-R2-5. |
| 4. Unscanned consumers: extensionless shebang scripts, junctioned folders, literal reads in `scripts/*.mjs` | MEDIUM | **Fixed** for shebang scripts and linked folders, which are followed once per real path (F03-R2-6). **Residual** for literal paths inside program code: the F02 R3-7 disposition, "programs read project files", refuted 2/2 there and documented. |
| 5. JSON `/` escapes | LOW | **Fixed.** Escapes decoded before matching. F03-R2-6. |
| 6. CSV formula cells | LOW | **Fixed (warning).** Formula-like cells add a review warning. Spreadsheet evaluation is not project code execution. F03-R2-8. |
| 7. Oversize non-document files fail closed | MEDIUM (availability) | **Fixed** for generated `.html`, `.svg` and `.ipynb`, now non-consumers. **Residual:** a consumer-named YAML/TOML over 1 MiB still fails closed. This keeps the F02 contract (F02-R4-1); the effect is LOW, fail-safe. |
| 8. Binary non-opaque files (`.DS_Store`, media, e-books) | MEDIUM (availability) | **Fixed.** `OPAQUE_FILE` was extended, and binaries in the root or ancestors are skipped unless they carry a consumer name. F03-R2-7. |
| 9. Budget and depth caps; uncached tool folders (`.godot`, …) | MEDIUM / LOW (availability) | **Fixed.** Budget 2000, depth 32, more cache folders. F03-R2-7. |

## Round-2 follow-up adjustment (keeps F02 accepted tests unchanged)

The first round-2 classifier patch broke two accepted F02 tests:
- treating every linked folder as `UNKNOWN` broke F02-ST5;
- raising the read limit to 16 MiB broke F02-R4-1's oversize contract.

Both were reworked instead of changing the F02 tests:
- linked folders are now **followed** with a cycle guard (that still catches the junction case);
- the 1 MiB limit was restored.
