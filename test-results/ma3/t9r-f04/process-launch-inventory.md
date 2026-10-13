# T9R-F04 process launch inventory

The baseline source is `b693167`. Every path was re-checked against the F04 working tree. The raw discovery reports are in `discovery/` (`launches.md`, `manager.md`, `critic.md`).

**Classes**
- **A**: Bunny-owned local process.
- **B**: existing user-owned process.
- **C**: remote hosted provider.
- **D**: shared local service.
- **E**: existing application automation target.
- **F**: WSL, or indirect/brokered execution.

| id | Path | What launches | Model-directed? | Class | Containment before F04 | Containment in F04 | Cleanup authority |
|---|---|---|---|---|---|---|---|
| P04 | `adapters.server.ts` `spawnSession`, reached from `CodexAdapter.launch` (direct and Mission) and `ClaudeAdapter.launch` | Codex `exec --json … -`, Claude `--print --output-format stream-json …`; prompt on stdin | **Yes**: shell, edits, tools | A | Plain `spawn` + `taskkill /T` + 15 s samples | **Windows job** through `containedSession`: created suspended and assigned at creation (`JOB_LIST`), membership verified, then resumed. Prompt goes over an unnamed pipe. Root exit or Stop terminates the whole job. Refused if containment fails. | `TerminateJobObject` on the session's own handle; kernel accounting |
| P05 | Codex Mission launch (`CodexAdapter.launch`, async compatibility then `spawnSession`) | same as P04 | Yes | A | as P04 | as P04 (same function) | as P04 |
| P01/P02 | `adapters.server.ts` `probe()` (also used by `CodexCompatibilityGate`) | `--version`, `login status`, `auth status`, `exec --help`, `features list` | No (fixed argv, no model turn) | A | Plain `execFile` | **Windows job**, `NUL` stdin, through `runWindowsOwnedProcess`; refused if containment fails | job close |
| P03 | `codex-probe.server.ts` (`codex app-server --stdio`) | JSON-RPC `initialize`, `model/list`, `account/rateLimits/read` | No (metadata RPC, no tool turn) | A | Plain `spawn`, 8 s timeout | **Not contained (disclosed limitation L3)**. Needs interactive stdin; the F04 helper delivers one stdin buffer and then EOF. | root kill + timeout |
| P06–P10 | Ollama (`orch/exec.server.ts`, `model-capability.server.ts`) | HTTP to `127.0.0.1:11434` | Tool-free inference | D (C for `:cloud` tags) | No local worker is launched | No local worker exists, so nothing is put in a job. Never reported as job-contained. | request abort |
| P19 | Mission `terminal.exec` → `runWindowsOwnedProcess` | approved executable + argv | Yes (agent-chosen) | A | Windows job (T4) | Windows job; handle access now reduced | job close |
| P20–P23 | Mission `git.*`, `git-merge`, `gh` | git / gh | Gated actions | A | Windows job (T4) | Windows job; handle access now reduced | job close |
| P12/P13 | `verification.server.ts` | `python <file>` only when the source is exactly `print("<expected>")` | No (Host-fixed one-liner) | A | Plain `execFile` | Not contained (disclosed limitation L4). Runs after the provider job is already empty. | timeout |
| P24/P25 | `computer.server.ts` PowerShell UIA; Calculator via `Start-Process` | Host automation of an E target | Semantic operations | A (Host) / E (target) | Plain `execFile`; Calculator activated by the UWP broker | **Unchanged on purpose** (MA2/T6 target identity). Calculator is never put into a provider job. | MA2 owned-target rules |
| P26 | Playwright browser | Chromium | Yes (web) | A + C | Playwright-managed | Unchanged (disclosed limitation L5; outside the provider-session scope) | Playwright close |
| P14/P16/P17 | `processTable`, telemetry PowerShell, `nvidia-smi` | Host diagnostics | No | A | `execFile` | unchanged | timeout |
| — | WSL | none | — | F | No `wsl.exe` launch exists | Not applicable. Any WSL-side process a provider might start runs in the WSL VM and is **not** claimed as contained. | — |

There is no CLI-to-shell fallback, alternate launcher or `cmd.exe` path for Codex or Claude. Every retry, reroute and escalation relaunches through `adapter.launch` → `spawnSession` → `containedSession` (`manager.server.ts` initial launch and `startSession`).
