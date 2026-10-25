# Final acceptance matrix

Source under test: `adac5859c7a9de36f9f04dea5e071d8e297a1486` plus the docs and smoke script in this change. The installed package was built from `adac585` only. Hosted CI has not run on this branch.

| Gate | Result | Evidence |
| --- | --- | --- |
| R3-G1 baseline | PASS | PR #41 OPEN, not merged, head `199cf3a20b39ddfd61e228aee1eaffd6c0a676f3`. Runs 40220086981 and 40220106304 SUCCESS. |
| R3-G2 live routing | PASS, with a limit | Live submit stores the Host class and a bounded team. Chat still launches one model. The team is not started and no tool is granted. |
| R3-G3 real tasks | PASS, with a limit | Status-code, SQL, and file prompts went through production submit. C0 answered 404. C3 recorded Planner, Worker, and Reviewer and ran no tool. Stop settled `stopped`. Verification was not established. |
| R3-G4 digest | PASS | Served digest matched the single Ollama tag. A missing digest stays null and the UI does not call a name a verified digest. |
| R3-G5 Node license | PASS | Packaged exe matches official v24.18.0 `win-x64/node.exe`. LICENSE is the license from that official zip. |
| R3-G6 installed smoke | PASS, with a limit | Isolated launcher started, onboarding saved the model, C0/C1/C2 completed, Stop settled, isolated tree removed, real install untouched. C1 file text is model output only. |
| R3-G7 cold start | PASS | Alternating runs: the T1R2 gap did not reproduce. The time is Ollama `load_duration`. No code change was made for it. The 15% warm goal remains unmet. |
| R3-G8 no safety regression | PASS for the checks that ran | Hard pin, no tool grant, no retry of an uncertain write, process exit 3 fails, Stop stops output. |
| R3-G9 full local regression | PASS, with a recorded first-run miss | typecheck, UI, both builds, and audit passed. Scripts stage 462/463 while the package build copied `node.exe`; that file passed 23/23 on rerun. Stage 1 was 1649/1656 under the license bin (no npm); the 7 failures passed on system Node after the direct-task event list included `execution.classified`. Stage 2 was 58/58. |
| R3-G10 hosted CI | NOT TESTED on this head | Earlier runs 40220086981, 40220106304, and 40192245873 are not this branch. The PR body records this head's runs when they finish. |

Public beta: NO-GO. MA4-S3-T2: not started.
