# MA4-S2-T2 — Crash and replay safety

Connected actions inherit the S2-T1 ordering, which the broker extends:

```text
claim (lease, fence+1) → authorize → commit operation "started" (durable intent, fenced)
  → broker: grants → [approval check] → receipt "dispatched" → connector effect → receipt "succeeded"
  → commit result + operation receipt (fenced) → spend approval
```

A crash between "started" and the result commit leaves a started operation; recovery classifies it by the contract's
category (never by guesswork):

| Category | Recovery | Evidence |
|---|---|---|
| read-only | re-run within the step's attempt budget | T2-X12 (crash mid `file.read` → completes) |
| idempotent by key (`email.draft`, `email.send`) | `verify()` looks the key up at the provider; found ⇒ success with the provider receipt, never re-sent; absent ⇒ one attempt under the **same** still-valid approval | T2-S2: crash right after the provider accepted → recovery found it, `sent.length === 1` |
| idempotent by condition (`file.apply`, `docs.write`) | `verify()` compares the current version with the approved new version | T2-F9: crash at `before-operation-start`, `after-operation-start`, `after-effect`, `after-receipt` → file correct, ≤ 1 dispatch each |
| irreversible (`calendar.create`) | `UNCERTAIN`; nothing replayed; the owner reconciles | T2-S3: after a crash post-acceptance, a scheduler pass replays nothing |

Reconciliation (`ptask.reconcile`, workstation only): **happened** records an owner-attested receipt and continues
without sending; **did not happen** clears the step's approval, so the retry produces a new proposal that needs a new
approval (T2-S3); **abandon** fails the task. No action gains authority through recovery: grants are re-checked on
`verify` and on every re-run, approvals are never created by recovery, and expired envelopes stop the task (T2-X10).

## Other replay paths

* **Stale workers:** a worker whose lease was taken over cannot commit — its fence is stale (T2-X15: no output, no
  transition by the old worker after the takeover; the new Host finishes).
* **Duplicate creates:** a task id cannot be inserted twice (T2-X14).
* **Replayed approvals:** an approval after completion, or for a spent/unknown action id, is refused (E2E-C, T2-F12).
* **Host restart while waiting:** the proposal and its hash survive; approving after the restart works and sends once
  (E2E-C).
* **Failed Host start:** a refused second Host opens and changes nothing (HOST_STARTUP_CLEANUP.md).
* **Browser sessions** are not persisted across restarts; a recovered browsing task opens a fresh, empty profile.

## Tamper evidence

Receipts form a SHA-256 chain; `ActionLedger.verify()` (and `action.receipts`) recomputes it; editing any row breaks it
(T2-F11). This is tamper-evident, not tamper-proof: an attacker who can rewrite the whole Host database can rewrite the
chain too.
