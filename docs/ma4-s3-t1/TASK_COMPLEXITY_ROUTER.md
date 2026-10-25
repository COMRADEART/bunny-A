# Task complexity router

Classes are deterministic and come from the request text plus an optional Host hint. A model may not raise the role count.

| Class | Examples the tests use | Roles | Model calls | Verification |
| --- | --- | --- | --- | --- |
| C0 | Explain, summarize, define | direct | 1 | none, so the UI must not say verified |
| C1 | Read, check, list, inspect one target | tool | 0 | deterministic |
| C2 | Several files, propose a patch, refactor | Planner, Worker | 2 | deterministic |
| C3 | Deploy, delete, production, wipe | Planner, Worker, Reviewer | 3 | deterministic, and semantic review does not replace it |

Empty text stays C0 with no tools. A model payload that labels a deploy request as C0 is ignored.

Compared with a standing four-role team, C0 drops three model roles and C1 drops all of them. That is the call-count proof in `ma4-s3-t1.test.ts`. It is not a live multi-agent trace from the installed UI.
