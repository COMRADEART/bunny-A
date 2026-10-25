# MA4-S3-T1R3 engineering report

This branch wires Host classification into live chat submit and records the served Ollama digest when exactly one installed tag matches. It does not start the composed team, and it does not let the model change its class or grant itself a tool.

The Windows package was built from commit `adac5859c7a9de36f9f04dea5e071d8e297a1486` with the official Node.js v24.18.0 win-x64 executable and the LICENSE from that same official zip. The owner's Node install, Bunny A install, and Startup shortcut were not modified. An isolated stage-only install started through `Start-Bunny-Release.ps1`, completed C0, C1, and C2 chats, stopped a running generate, and was deleted.

The T1R2 cold gap did not reproduce when the candidate and the predecessor alternated after an unload. The time is Ollama model load. No latency patch was added. The warm result remains 14.0%, short of 15%.

Safety checks that ran did not regress: destructive model text did not execute a tool, an uncertain external write is not retried, a non-zero process check fails, and Stop ends the task. Independent verification was not claimed for any of these chats.

Local regression closed on rerun. The first scripts-stage failure was a missing temp `node.exe` while the package build was copying Node, and that file passed alone afterward. Stage 1's seven failures were six `npm` lookups against the license bin, which has no npm, and one event list that now includes `execution.classified`. Those seven passed on the system Node. Stage 2 passed 58/58. Hosted CI has not run on this head.

Do not merge this branch on the current evidence. Public beta remains NO-GO. MA4-S3-T2 is not started.
