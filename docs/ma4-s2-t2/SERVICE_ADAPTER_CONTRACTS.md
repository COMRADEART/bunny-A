# MA4-S2-T2 — Service adapter contracts

`ma4/connectors/services.server.ts`. Tests: `ma4-s2t2-services.test.ts` (T2-S1…S6), workflow C.

**Live providers connected: none.** Every result below is against `SyntheticWorkspace`, a recorded in-memory emulator.
No OAuth consent, no real account, no live provider call happened in this milestone.

## Interface

`ServiceProvider` — provider-neutral; a real adapter (Gmail / Microsoft Graph / Google Calendar / Drive…) would
implement it with delegated OAuth scopes:

* `mail`: `list`, `read`, `createDraft(key)` / `findDraft(key)`, `send(key)` / `findSent(key)` — idempotent by key.
* `calendar`: `events`, `create` (notifies attendees; **no lookup** — an interrupted create is genuinely uncertain).
* `docs`: `list`, `read`, `write(expectedVersion)` (conditional).
* `accounts(connector)` — which accounts are connected; a grant naming any other is refused.

Credentials: a provider obtains its token from a `CredentialVault` by account id inside the adapter. Tokens never appear
in step inputs, results, prompts, receipts, checkpoints or logs (T2-S4 scans every task, output, checkpoint and receipt
row for the token: absent). A provider without a credential refuses before any effect (a definite failure).

## Contracts

| Action | Class | Grant | Approval |
|---|---|---|---|
| `email.list`, `email.read` | read-only | `read` | — |
| `email.draft` | idempotent (key), side effect | `draft` + every recipient | task-level (side effects) |
| `email.send` | idempotent (key), consequential | `send` + every recipient | **fresh, payload-bound**: recipients, subject, body hash |
| `calendar.events`, `calendar.availability` | read-only | `read` | — |
| `calendar.propose` | read-only ("Preparing draft") | `draft` + attendees | — (creates nothing; reports conflicts and notification effects) |
| `calendar.create` | irreversible, consequential | `write` + attendees | **fresh, payload-bound**: title, time, attendees |
| `docs.list`, `docs.read` | read-only | `read` | — |
| `docs.write` | idempotent (conditional), consequential | `write` | **fresh, payload-bound**: doc, expected version, content hash |

Recipients are parsed to exact, lower-cased, validated addresses (≤ 20) and every one must be in the grant
(T2-S1: `boss@…` refused; workflow C: adding `all-staff@…` refused at creation). Body/content may come from a generating
step (`bodyFrom`/`contentFrom`), never from a connector result.

## Validated behaviours (synthetic)

* Draft is created once per key; a draft never sends (T2-S1).
* Send waits in the Approval Center with the exact preview; a crash after the provider accepted the send is recovered by
  key lookup — sent exactly once (T2-S2).
* Calendar create interrupted after acceptance → `UNCERTAIN`, never replayed; "did not happen" requires a **new**
  approval (the old one is gone); "happened" records the owner's word and sends nothing (T2-S3, S4).
* Docs write refused when the document changed after it was read; the newer version is kept; no write attempted (T2-S5).
* Without a supplied provider, no service action is registered and the Planner is not offered one (T2-S6).

Real-account authorization, OAuth consent and live calls require a separate owner approval and qualification.
