# MA4-S2-T2 — Connected action architecture

**Principle: models propose; the trusted Host validates, authorizes, executes and verifies.** There is no separate
tool runner. A connected action is a step of an S2-T1 persistent task, executed by a Host-registered executor that the
permission broker built from a connector contract.

```text
 owner request ──► Planner (local model, optional) ──► proposal (JSON spec)   [never created by the model]
                                                         │ validated like an owner task
 workstation owner ── ptask.create (spec + envelope with grants) ──► validateTask + broker preflight
                                                         │  (schema, registered executors, grants ∩ Host registry,
                                                         │   pins, side-effect permission)  — refused before any effect
                       task-level approval when impact requires it (S2-T1, hash-bound)
                                                         ▼
 PersistentTaskRuntime  claim (lease+fence) ─► authorize() ─► operation "started" committed (durable intent)
                                                         ▼
 brokered executor:  input schema ─► grants re-checked now ─► [consequential: prepare() ─► payloadSha256 ─►
                     owner approval for exactly this hash?  no ─► proposal, task AWAITING_APPROVAL (nothing sent)]
                     ─► receipt "dispatched" ─► trusted connector ─► result schema ─► redaction ─► receipt "succeeded"
                                                         ▼
 runtime commits result + operation receipt (fenced) ─► task progress ─► sanitized views ─► dashboard / phone / notch
```

## Components (all under `src/lib/bunny-host/ma4/`)

| File | Role |
|---|---|
| `task-runtime.ts` | Vocabulary: envelope **grants**, `ActionProposal`, `ActionApproval`, activities, preflight hook in `validateTask` |
| `task-runtime.server.ts` | Runtime: step context (envelope, approval, earlier outputs), the "waiting for permission" result, `approveAction` / `denyAction` / `pendingAction`, approval spending, proposal expiry sweep, terminal hook |
| `action-broker.server.ts` | `ActionContract` (versioned `ma4.action.v1`), `brokered()` — the only way a connector becomes runnable — `grantProblem()`, `ActionLedger` (hash-chained receipts), redaction |
| `connectors/files.server.ts` | Local file connector + `FileRootRegistry` |
| `connectors/browser.server.ts` | Controlled browser connector + task-scoped `BrowserSessions` |
| `connectors/services.server.ts` | Provider-neutral email/calendar/docs adapters + `SyntheticWorkspace` emulator |
| `connected-actions.server.ts` | Host registry: builds every executor through the broker; Planner catalog |
| `connected-workflow.server.ts` | Planner proposal validation, Reviewer step, fenced source material |
| `task-commands.server.ts` | Workstation-only Approval Center, receipts, folders and Planner commands |

## Trust boundaries

* **Contracts are code.** Category, side effect, consequential flag, idempotency, limits, required grants and result
  schema are fixed in the contract. A spec supplies only the step kind and flat scalar inputs; it cannot relabel an
  action (S2-T1 rule: the executor decides the category).
* **Grants are the owner's.** The envelope is created on the workstation and is immutable (hash-bound). Grants name
  Host-registered resources only; the Host registry is checked at creation and again at execution.
* **Outputs are data.** Results from files, pages and mail are stored as `{schema, kind, connector, trust, result}`;
  `trust: "untrusted"` content reaches later model steps only inside a data fence.
* **Credentials never cross a connector boundary** (service providers fetch their own tokens; browser cookies are never
  read; secret-shaped text is redacted from every result and receipt).
* **Paired devices are default-deny** for every new command; their task view hides what a pending action would send.

## Production vs test seams

Production registers: `local.generate`, `local.review`, the seven `file.*` actions and four `browser.*` actions.
Test-only Host options (`startHost({ connected: { allowLoopback, services } })`, never reachable from HTTP) enable
browsing synthetic local sites and the recorded synthetic workspace. With no provider supplied, `email.*`,
`calendar.*`, `docs.*` steps are refused at validation ("No registered executor") and the Planner is not offered them.
