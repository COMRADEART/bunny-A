# Full CI report

| Check | Result |
|---|---|
| `npx tsc --noEmit` | Exit 0 after the shutdown detach and the deadline test. |
| Focused unit tests listed in SECURITY_REGRESSION.md | Exit 0, no `--test-force-exit` |
| Eight agent suites | First combined run exited 1 (recovery assertions). Recovery re-run exited 0. Full eight-file re-run after the detach fix was not repeated. |
| `npm test` | **NOT RUN** |
| Desktop build | **NOT RUN** |
| Mobile build | **NOT RUN** |
| Hosted CI | **NOT RUN**. No push had been made when this file was written. |

`--test-force-exit` remains on the `npm test` script. Removing it would hide nothing only after a full natural-exit run, which was not done.
