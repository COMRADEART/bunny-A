# MA3 T13.3 Gate E — Harness Manager: evidence summary

- Base (Gate D evidence commit): `446f850`
- Gate E source commit: `e836781` (`final-source-head.txt`)
- Matrix: `docs/t13-3/HARNESS_COMPATIBILITY_MATRIX.md`
- Owner decision: installation is guided only. Bunny shows the pinned official command and never runs an installer.

## Regression (one full run on the committed source tree, UTF-8 logs)

| Suite | Gate D | Gate E | Change |
| --- | --- | --- | --- |
| `npm test`, scripts | 440 / 440 | 440 / 440 | — |
| `npm test`, library | 1,530 / 1,530 | 1,533 / 1,533 | +3: `harnesses.test.ts` (2), `harnesses-host.test.ts` (1) |
| `npm test`, Agent runtime | 58 / 58 | 58 / 58 | — |
| `npm run test:ui` | 366 / 366 | 366 / 366 | — |
| typecheck | exit 0 | exit 0 | |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings | baseline unchanged |
| build | exit 0 | exit 0 | |

Exit codes: `exit-codes.txt`. Logs: `npm-test.log`, `npm-test-ui.log`, `typecheck.log`, `lint.log`, `build.log`.
No existing test was edited or weakened, and no focused run is counted in these totals.

## Retained exploratory failures (explained)

- `live-version-probe-1-gh-false-positive.txt`: the first live probe looked for Copilot by every catalogue
  executable, matched GitHub's `gh` identity CLI and reported its version as Copilot's. Copilot is now looked for only
  as `copilot` (`harnessExecutables`); `live-version-probe-2.txt` is the retest.
- `lint-1-failed-control-regex.log`: the first lint run had 1 error, a raw ESC character in the probe's ANSI-stripping
  regex. The probe now reuses `stripAnsi` and `firstLine` from `adapters.server.ts`; the second run (`lint.log`) is back
  to the 27-warning baseline. Typecheck, the build and the full regression ran after this fix.

## What was shown live (QA Host 43190, `browser-qa.md`)

- All nine harnesses render with their real install path, version, routes, sign-in, billing and warnings.
- Pressing Test on Codex and Grok ran each one's own `--version` and returned "Runs; inference not yet shown".
- Disable on Codex paused its routes ("Disabled by you"); Enable restored "Can run Tasks".
- Two UI fixes were made during QA, before the regression: the long-path wrap on mobile, and "Not detected yet"
  replacing a misleading pre-test "Not found".

## Restored side effects

`npm test` rewrites committed evidence of earlier milestones. After the run,
`git checkout -- test-results/ma3/t5 test-results/ma3/t6 test-results/ma3/t7 test-results/ma3/t9r` restored it.

## Production preservation

The installed production Host (port 43119) was not stopped, restarted or written to. QA used the separate Host on port
43190 (temporary data directory) and the Vite dev server on 8091. Only that QA Host was restarted, to load Gate E.
Disable and Enable in QA changed only the QA Host's account records.

No push, deployment, sign-in, installation, uninstallation or paid inference took place. The only programs started
were the harnesses' own `--version` commands: during the live probe, and on the two QA Test clicks.

## Credential check

A count-only scan of the new source files, the matrix, the architecture doc and these logs checked common token shapes
(GitHub, OpenAI-style, AWS, Slack, PEM private keys, bearer tokens, quoted API keys). It found 1 match, in
`npm-test.log`: an OpenAI-style fixture string that a tracked test file contains and the existing suite prints. The
same string is in the committed Gate D `npm-test.log`. The diff of the edited source had 0 matches. The screenshots
show local install paths that include the Windows user folder name, and no credentials.

## Not demonstrated in Gate E

- No harness ran a model. On this workstation the ladder reaches `runs` at most; `task_completed` is evidenced only by
  the fixture adapter in `harnesses-host.test.ts`.
- Guided installation was not exercised: nothing was installed, updated or uninstalled.
- Remove was exercised only in `harnesses-host.test.ts`, not in the browser, to keep the QA Host's accounts intact.
- Routing support is unchanged from T13.2: Cursor, Cline, Grok, OpenCode, Gemini and Copilot stay detect-only.
- Browser console errors were not recorded during QA.
