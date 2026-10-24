# MA4-S2-T2 — Action schema

## Contract (`ActionContract`, schema `ma4.action.v1`, `action-broker.server.ts`)

| Field | Meaning | Who sets it |
|---|---|---|
| `kind` | e.g. `file.read`, `email.send` — the step kind | Host code |
| `connector`, `operation`, `resource` | `local-files` / `browser` / `email` / `calendar` / `docs`; operation and resource type | Host code |
| `category` | `read_only` / `idempotent` / `irreversible` (S2-T1 recovery classes) | Host code |
| `sideEffect` | changes something outside Bunny; needs `envelope.sideEffects` | Host code |
| `consequential` | needs a fresh, payload-bound owner approval every time it runs | Host code |
| `idempotency` | `none` / `key` (provider honours the stable operation key) / `conditional` (version-checked write) | Host code |
| `input` | strict zod schema of flat scalar inputs | Host code |
| `result` | zod schema the connector's result must satisfy | Host code |
| `timeoutMs`, `maxResultChars` | execution and result budgets | Host code |
| `requires(input)` | the resources this exact input touches (folder+access, origin, account+access+recipients) | Host code |
| `untrusted` | results are outside content, fenced for models | Host code |
| `activity` | what the notch/phone say while it runs | Host code |

A model or spec controls only: the step `id`, the `kind` (must be registered **and** listed in the envelope's
capabilities), and the input values (validated by the contract).

## Identifiers recorded per action

* Task and step ids; operation key `${taskId}:${stepId}` (S2-T1, the stable idempotency key).
* `actionId` (`act-<uuid>`) for each proposal; `payloadSha256` = SHA-256 of canonical JSON
  `{schema:"ma4.action.v1", kind, payload}` where `payload` is what the connector's `prepare()` says will happen
  (recipients, subject and body hash; folder, path, expected version and new version; event, attendees...).
* Receipts (`ma4_action_receipts`): `seq, at, task_id, step_id, kind, event, payload_sha256, result_sha256, detail,
  prev_sha256, entry_sha256` with `entry = sha256(prev + "\n" + canonical(fields))`. Events: `refused`, `proposed`,
  `approval_invalidated`, `approval_expired`, `authorized`, `dispatched`, `succeeded`, `failed`, `outcome_unknown`,
  `result_rejected`, `prepare_failed`, `verified_applied`, `verified_absent`.

## Grants (`envelope.grants`, `GrantsSchema`)

```json
{ "files":    [{ "root": "atlas", "access": "read" | "write" }],
  "origins":  ["https://wiki.example.com"],
  "services": [{ "connector": "email", "account": "me@example.com", "access": "read|draft|write|send",
                 "recipients": ["lead@example.com"] }] }
```

* Absent on S2-T1 envelopes → no connected resource at all.
* Service access levels are ordered (`read < draft < write < send`); every recipient must be listed.
* The envelope (grants included) is hashed into the task record; the S2-T1 approval binds that hash.

## Result envelope stored as the step output

```json
{ "schema": "ma4.action.result.v1", "kind": "file.read", "connector": "local-files", "trust": "untrusted", "result": { ... } }
```

Redacted before storage; larger than `maxResultChars` (≤ 60,000, below the 64,000-character output cap) is a failure,
never a silent truncation of JSON.

## Registered actions

| Kind | Category | Consequential | Notes |
|---|---|---|---|
| `file.list`, `file.read`, `file.stat`, `file.search`, `file.changes` | read_only | no | grant `read` |
| `file.prepare` | read_only | no | diff preview, writes nothing |
| `file.apply` | idempotent (conditional) | **yes** | grant `write`; version-checked atomic replace + backup |
| `browser.open`, `browser.follow`, `browser.extract`, `browser.form.prepare` | read_only | no | exact origins; no submit action exists |
| `email.list`, `email.read` | read_only | no | synthetic only |
| `email.draft` | idempotent (key) | no | side effect; grant `draft` + recipients |
| `email.send` | idempotent (key) | **yes** | grant `send` + recipients |
| `calendar.events`, `calendar.availability`, `calendar.propose` | read_only | no | propose creates nothing |
| `calendar.create` | irreversible | **yes** | notifies attendees; no lookup → UNCERTAIN on interruption |
| `docs.list`, `docs.read` | read_only | no | |
| `docs.write` | idempotent (conditional) | **yes** | expected version |
| `local.generate`, `local.review` | read_only (model) | no | pinned local model; Worker / Reviewer |

Not implemented by design: delete, publish, share, form submission, purchases, payments, money transfer.
