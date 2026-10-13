# T9R-F03 independent review — round 3 (scoped verification of the round-2 repairs)

One independent reviewer agent (security-auditor) did this round. Method:
- 60 probes;
- `f03-hardening.test.ts` 23/23 and `f02-staging.test.ts` 48/48;
- no repository edits.

**No crash path** was found: empty or unreadable files, NUL, junction cycles, dangling links and budget overflow all return a classification. **No regression** was found.

| Finding | Severity | Disposition |
|---|---|---|
| R3-1: brace and bare globs (`*.{md,txt}`, `for f in *`, `*.*`, `**/*`) | MEDIUM | **Fixed.** Brace and any-extension globs are matched. A bare `*` counts only for root files (or with `**/`) and only in a command that runs files. F03-R3-1. |
| R3-2: a read-only tool word exempted the whole line (`markdownlint … && mdsh **/*.md`) | MEDIUM | **Fixed.** Each simple command is judged separately (`&&`, `\|\|`, `;`, `\|`, `&`). F03-R3-1. |
| R3-3: installer directives in UTF-16 or non-`.txt` files; `name @ url` requirement lines | MEDIUM | **Fixed.** Read with the consumer decoder. A non-`.txt` document counts when it is a requirements list. PEP 508 direct references are requirement lines. F03-R3-2. |
| R3-4: `.ipynb` was opaque, so root notebooks were not consumers | MEDIUM | **Fixed.** Notebooks are program consumers. Their cell sources are read (up to 64 MiB, outputs ignored). F03-R3-3. |
| R3-5: `\x2f` and `\u{2f}` escapes | LOW | **Fixed.** Decoded. F03-R3-4. |
| R3-6: MkDocs `docs_dir: ./` | LOW | **Fixed.** It means the whole project. F03-R3-4. |
| R3-7: Mercurial hooks (`.hg/hgrc`) | LOW | **Fixed.** `.hg/hgrc` and `.hg/hooks` are read; the rest of `.hg` stays skipped. F03-R3-4. |
| R3-8: executable fences in list items and blockquotes | LOW | **Fixed.** F03-R3-5. |
| R3-9: NUL-bearing or CJK-heavy BOM-less UTF-16 consumers skipped silently | LOW | **Fixed.** A skippable binary-looking file is still searched as NUL-stripped text. F03-R3-5. |

**Availability check after these repairs, on this repository.** Two over-refusals appeared and were tightened before the commit:
- a root review packet counted as a requirements file;
- PowerShell arithmetic `*` counted as a glob.

The result: `notes/`, `docs/`, `reports/` and root `.md` writes are phone-safe. `data/` is refused (prose "Host data" in an installer script; fail-safe).

**Not independently re-verified:** the round-3 repairs themselves. Each one is covered by a regression test in `f03-hardening.test.ts` and by the full regression on the source pin.
