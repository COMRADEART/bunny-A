# MA4-S2-T2 — Approval and permission model

## Three layers, all enforced by the Host

| Layer | Bound to | Checked |
|---|---|---|
| **Resource grants** (envelope) | exact folder ids + access, exact origins, accounts + access + exact recipients | at creation (`validateTask` → broker preflight) **and** at every execution (broker `run`) and recovery `verify` |
| **Task approval** (S2-T1) | `specSha256` + `envelopeSha256`, expires (≤ 7 days, ≤ envelope) | before every claim; required for side effects, background work or non-read-only steps |
| **Action approval** (new) | one step's `payloadSha256` (canonical hash of exactly what will be sent/written/created), expires (15 min default, ≤ 1 h, ≤ envelope) | inside the broker immediately before dispatch |

Read-only actions still need resource-level authorization: no grant, no read (T2-F4, T2-W3, T2-S1).

## Approval Center (workstation only)

A consequential step first runs `prepare()` (read-only) and, without a matching approval, stores an `ActionProposal`
on the task and moves it to `AWAITING_APPROVAL` — nothing sent, the attempt not spent. The proposal shows:

* requesting task and step (the agent role is the step's role; connected steps are Host-executed);
* target (`Email · me@…`, `Folder "atlas"`, `Calendar · …`);
* exactly what will happen (`summary`, `effects`), whether it can be undone (`reversible`);
* data read or transmitted (`data`), records/files that change (`changes`), the full `preview`;
* expiry (`expiresAt`) and the payload hash.

Decisions: **Approve this action** (`action.approve {id, actionId, payloadSha256}`), **Deny** (`action.deny` → task
`FAILED / ACTION_DENIED`, nothing sent), **Cancel task** (`ptask.cancel`), **Inspect details** (`action.inspect` →
preview + receipts). There is no blanket approval: one approval covers one step's one payload, and is spent when that
step succeeds.

Invalidation: the approval names a payload hash. If recipients, destination, content or the file/document version differ
at execution, the hash differs: receipt `approval_invalidated`, a new proposal, nothing sent (T2-F8, T2-S5, E2E-C forged
hash). Approving with a hash other than the shown one is refused ("changed since you reviewed it"); an unknown or
replayed action id is refused; an expired proposal cannot be approved and is prepared again from current data
(T2-F12). `ptask.approve` cannot stand in for an action approval.

## Phone and other devices

* Paired devices are default-deny on an allowlist; `action.*`, `connector.*`, `ptask.plan` are not on it, and the
  command module adds a second workstation-only check (E2E-C: six commands → `WORKSTATION_REQUIRED`).
* The phone's task view says a `<connector>` action is waiting for permission on the PC, with its kind, effects and
  reversibility — never recipients, subjects, paths or the preview (E2E-C asserts the recipient address is absent).
* The phone keeps S2-T1 supervision (pause/resume/cancel). No phone approval flow exists.

## Envelope rules unchanged from S2-T1

Cloud inference is not expressible (`providers: ["ollama"]`, `localOnly: true`); models are hard pins; budgets; project
scopes; expiry; revocation. A consequential step also needs `sideEffects: true`.
