# MA4-S2-T1 — Security validation

## Preserved guarantees (unchanged code paths)

| Guarantee | How it is preserved |
|---|---|
| WSL2 sandbox and seccomp | Not touched; the runtime registers no sandbox executor. Adversarial suite result: §3. |
| Model pins | Step pin ∈ envelope; executor checks the served-model receipt (`PIN_VIOLATION`); unavailable pin blocks; no substitution (T1-9, live Q5). |
| Local-only routing / no unapproved cloud inference | Envelope `providers` is the literal `["ollama"]` and `localOnly` the literal `true`; `execute()` refuses hosted tags; a hosted-tag pin was blocked live. The runtime never routes and never reads MA4 provider approvals. |
| Provider permissions and the tool broker | Not touched; the runtime adds no tool and no provider. |
| Project isolation | Envelope `projectScopes`; dependencies must be same-project; views carry the project id only. |
| Memory trust boundaries | The runtime reads no Lotus Memory and no skills; injection stays OFF. |
| Cancellation | Cancel aborts the step, kills its children, records the honest outcome. |
| Credential separation | Step inputs matching credential patterns are refused; checkpoints pass the MA3 material guard; no secret is stored with a task. |

## New boundaries introduced and tested

| Boundary | Test |
|---|---|
| Only the workstation creates, approves, reconciles, revokes, sets policy, reads outputs | runtime (`T1-12/15`), HTTP with a real paired device (`ma4-s2t1-host.test.ts`: every such action → 400 `WORKSTATION_REQUIRED`, nothing created, policy unchanged) |
| Paired device rights are additive and narrow: `ptask.list`/`get` (read), `pause`/`resume`/`cancel`/`notification.ack` (supervise) | `DEVICE_RIGHTS`; default-deny for everything else |
| An envelope cannot be widened by the spec, a stored row, a model response, memory or a skill | spec/envelope hashed; tampered or widened stored rows refused as corrupt (`T1-14`) |
| Historical approval is not standing authority | approvals bind hashes and expire; re-checked before every step and on recovery (`T1-8`) |
| A superseded worker cannot commit | fencing token checked inside the store transaction (`T1-7`) |
| No duplicate consequential action | store-level start guard + recovery classification (`T1-5`, process test, live) |
| Phone sees no step inputs or outputs | HTTP test over the real device projection |
| Orphan cleanup never kills by bare PID | identity (pid, creation time, image) re-verified before the reviewed native termination |

## Not added

No Windows service, scheduled task, startup entry or privileged daemon; no external email/SMS/push; no cloud relay;
no persistent external monitoring.

## 3. Regression and sandbox results

Filled in from the actual runs in ENGINEERING_REPORT.md (RELEASE section).
