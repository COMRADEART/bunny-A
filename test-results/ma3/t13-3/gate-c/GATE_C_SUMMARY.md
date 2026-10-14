# MA3 T13.3 Gate C — Lotus memory: evidence summary

- Base (Gate B evidence commit): `72cfeb4`
- Gate C source commit: `9fb179c` (`final-source-head.txt`)
- Contract: `docs/t13-3/LOTUS_AGENT_MEMORY_CONTRACT.md`

## Regression (one full run on the committed source tree, UTF-8 logs)

| Suite | Gate B | Gate C | Change |
| --- | --- | --- | --- |
| `npm test`, scripts | 440 / 440 | 440 / 440 | — |
| `npm test`, library | 1,512 / 1,512 | 1,522 / 1,522 | +10: `lotus.test.ts` (7), `lotus-host.test.ts` (3) |
| `npm test`, Agent runtime | 58 / 58 | 58 / 58 | — |
| `npm run test:ui` | 366 / 366 | 366 / 366 | — |
| typecheck | exit 0 | exit 0 | |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings | baseline unchanged |
| build | exit 0 | exit 0 | |

Exit codes: `exit-codes.txt`. Logs: `npm-test.log`, `npm-test-ui.log`, `typecheck.log`, `lint.log`, `build.log`.
No test was weakened, and no focused run is counted in these totals. The only edited existing test is
`personal-agent-context.test.ts`, which now also asserts which turns `appendTurn` drops (Gate C compacts them).

Before the full run, a focused run of the Lotus and Gate B files (20/20) was used during development. It is not
counted here.

## Restored side effects

`npm test` rewrites committed evidence of earlier milestones. After the run,
`git checkout -- test-results/ma3/t5 test-results/ma3/t6 test-results/ma3/t7 test-results/ma3/t9r` restored it.

## Production preservation

The installed production Host (port 43119) was not stopped, restarted or written to. QA used a separate Host on
port 43190 with a temporary data directory, and a Vite dev server on 8091. Only that QA Host was restarted, to
load the Gate C wiring. No push, deployment, sign-in or paid inference took place.

## Credential check

A count-only scan of the new source files, the contract and these logs for common token shapes (GitHub, OpenAI-style,
AWS, Slack, PEM private keys) found 0 matches. Tests build credential-shaped strings at runtime, so none are stored
in source.

## Not demonstrated in Gate C

- No model prompt reads Lotus yet. Recall feeds only the Host-composed conversation reply.
- Child workers do not exist yet (Gate D). Only the one-Project recall slice they will use is tested.
- Host-initiated promotion and model-trust writes are unit-tested rules, not live Host paths.
- In the browser, typing instruction-like text was blocked by the session's safety review, so the steering
  downgrade is evidenced by `lotus.test.ts` and `lotus-host.test.ts`, not by browser QA. The export file's
  content is evidenced by the Host test; in the browser only a refusal-free export was observed.
