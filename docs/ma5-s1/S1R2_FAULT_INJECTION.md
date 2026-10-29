# MA5-S1R2: Fault injection (device and JVM)

## Device setup

Same shape as S1R1 (S1R1_ANDROID_DEVICE_ACCEPTANCE.md), harness now kept as reusable, environment-configured tools in `scripts/android-device/`
(`fault-harness.mjs`, `ui.py`, `lifecycle.sh`; moved there and de-identified in MA5-S2):

- Phone: Galaxy SM-S948U (serial redacted), Android 17. Installed before: the S1R1 build (`classes.dex`
  `10bc29f1…e14f`), unpaired. The S1R2 builds were installed over it with `adb install -r`, re-signed with the same
  local key the phone already trusts (`51b965f3…2dd7`).
- Disposable Host: `startHost` in a temp folder with **only the Ollama adapter**. Never the owner's Host.
- Fault proxy between the real web gateway and the Host (the gateway's credentials file points at the proxy). Modes:
  `lose-answer` (forward the submit, let the Host answer, destroy the connection before the answer leaves),
  `drop-before` (destroy the connection before forwarding: the Host never sees it), `lose-hold` (`lose-answer`, then
  drop status checks until changed). Every device command is logged (`host-proxy-commands.log`, no credentials).
- Real gateway: this worktree's Vite dev server with `BUNNY_REMOTE_ORIGIN` set to a Cloudflare quick tunnel (trusted
  HTTPS). Tunnel, gateway, harness and Host data were removed afterwards.

Builds used, by scenario: A-after on `cd9828d3…`; D/E on `28470577…`; the rest on the final build `00eb4fa6…4702`
(the only later changes were wording, the Tasks list and tab retention; the A path was re-exercised on the final build
in N).

## Results

| # | Scenario | Observed | Verdict |
|---|---|---|---|
| A-before | Applied, answer lost (S1R1 build) | Host task created (`waiting_for_approval`). Phone: dialog "Outcome unknown"; after OK the line read **"Sending to the workstation…"**; **Send enabled**; no approve, task stuck | **FAIL (defect reproduced)** |
| A-after | Same fault, R2 build | One submit (`46ca350e`). Dialog "Outcome unknown"; the line became "Outcome unknown"; one `operation.status` with the original id and epoch → `applied` + task id → one approve → Host `completed` on `huihui_ai/qwen2.5-abliterate:7b` (Host output "Rome."). No second submit | **PASS** |
| B | Refused: Host restarted, phone sent before seeing the new epoch | Host 409 `HOST_EPOCH_CHANGED`; line "Refused, not done — The Host restarted after this view was loaded. Nothing was changed"; no task created (the Host still listed 4 tasks afterwards, none for this prompt); Send available | **PASS** |
| C | Host restarts mid-command | Submit `738fcbf8` applied (task created), answer lost, first check dropped → "Could not reach the workstation to check". Host restarted (epoch `27d73940` → `a0b3710f`). "Check workstation" sent the **original** epoch → 409 `HOST_EPOCH_CHANGED` → stays "Outcome unknown": "The workstation restarted or changed after this message, so its outcome can no longer be confirmed…". No resend. The Host kept the task from the old epoch (`waiting_for_approval`) | **PASS** |
| D | Ledger `unknown` (submit dropped before the Host) | Gateway 504 `OUTCOME_UNKNOWN`; check → `unknown`; line stays "Outcome unknown" + "no record … That does not prove it never ran." Send "Resolve above first (disabled)" | **PASS** |
| E | User closes the dialog | Line keeps its real state (D and C screenshots taken after OK); controls: Check / View tasks / Send a new message anyway…; Send disabled | **PASS** |
| R | Deliberate new message | "Send a new message anyway…" → dialog → KEEP WAITING / I UNDERSTAND. After I UNDERSTAND: earlier line still "Outcome unknown" + "may still have run"; Send enabled; the next send used a new operation id | **PASS** |
| N | Network loss with an unknown message (airplane mode 25 s) | Stayed unknown; after reconnect one automatic check → `applied` + task → approve → completed ("Ottawa." on the Host) | **PASS** |
| G | Gateway restart (2 min outage) with an unknown message | State kept; one automatic check after recovery; no submit | **PASS** |
| F | Local-only chat | The phone's chat was routed to local Ollama `huihui_ai/qwen2.5-abliterate:7b` and the phone's approve was accepted (device launch rule). The phone shows the model name and "Completed". **The answer text did not reach the phone**: the Host's device projection blanks `output` by design. The phone now says so instead of "completed with empty output" | **PARTIAL**: request, authorization and model PASS; answer on the phone FAIL (Host privacy rule, owner decision) |

Totals from the proxy log: 8 device submits, each a separate tap with a distinct operation id; 0 automatic re-sends;
21 `operation.status` reads, all with the original operation id and the original submission's epoch; 2 approves
(one per reconciled applied message).

## JVM and Host tests

| Suite | Result | Covers |
|---|---|---|
| `android/tests/ChatTurnTest` | 55 / 55 | C1 real socket: Host reads the submit, connection reset; exactly one delivery, line leaves Sending, ids kept, Send blocked. C2 every ledger answer incl. other epoch/Host. C3 each failure kind. C4 stable identity. C5 duplicate prevention. C6 restore after process end / recreated screen, nothing secret or successful stored. C7 following |
| `android/tests/HostExchangeTest` | 37 / 37 | Unchanged S1R1 transport faults |
| `remote-device.test.ts` T9 F06/F35/F40 | pass | `operation.status` returns the created task id; another principal still gets `unknown` |
| `native-companion.test.ts` | 9 / 9 | Unchanged gateway lost-answer test |

Against the old code: `ChatTurnTest` cannot compile (no per-message state existed); the `taskId` assertion fails on
the old Host (`undefined !== <task id>`). The old screen's behaviour is the device result A-before.
