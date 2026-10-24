# MA4-S2-T2 — Security and adversarial tests

All tests below run in `npm run test:ma4` (stage 4 of `npm test`). Final full-regression run:
`evidence/npm-test.log` — every `T2-*` test passes (38/38), exit 0.

Fixtures: temporary folders under the test's own directory, a recorded fake local model, local synthetic sites on
loopback (enabled only by the test-only `allowLoopback` Host option) and the in-memory `SyntheticWorkspace` for
email/calendar/docs. No live provider, account or external site is contacted.

## Threat → test

| Threat | Defence (where) | Test(s) |
|---|---|---|
| Prompt injection in a file or page adds a step, recipient or permission | outputs stored as `trust: "untrusted"` data; reach later model steps only inside a data fence; the spec is fixed at creation | T2-F10, T2-W4 |
| The Planner creates or widens work | the Planner only proposes; proposals are validated like owner specs; recipients, actions and models outside the envelope are refused | T2-X11, T2-E2E-A |
| Path traversal / drive paths / ADS / device and 8.3 names | refused at creation (`validateTask` → broker preflight) | T2-F2 |
| Symlinks, junctions and hard links leave the folder | resolved and re-checked against the registered root at execution | T2-F3 |
| Over-broad folder registration (system, whole-user, drive root, Bunny state, via a link) | `FileRootRegistry` refuses it | T2-F5 |
| Reading credential, binary or oversized files | protected names refused; size and type limits in the contract | T2-F6 |
| Ungranted folder, or grant revoked mid-task | grants checked at creation **and** before every step | T2-F4 |
| A file changes between preview and approval | approval bound to the payload hash incl. the file version; mismatch → `approval_invalidated`, new preview, nothing written | T2-F8 |
| Double or unapproved write after a crash | durable intent + conditional `verify()`; fault injected at all four boundaries | T2-F9 |
| Secrets leak into results or receipts; receipts edited later | redaction on every result/receipt; SHA-256 receipt chain verified | T2-F11 |
| Stale or denied approvals reused | proposals expire and are re-prepared from current data; denial ends the task with nothing written | T2-F12 |
| A model answer substituted by another model | served-model receipt must equal the pin → `PIN_VIOLATION` before any later action | T2-F13 |
| Email to recipients outside the grant | refused before anything runs | T2-S1 |
| Send content changed after approval; duplicate send after a crash | hash covers recipients, subject and body; idempotency key verified at the provider on recovery | T2-S2 |
| Irreversible action replayed after a crash | `UNCERTAIN`, never re-sent without the owner | T2-S3 |
| Owner reconciliation abused to send; credentials crossing the connector | "happened" records the owner's word only; providers hold their own tokens | T2-S4 |
| Overwriting a document someone else changed | write conditional on the version read; stale version refused at preview | T2-S5 |
| Service actions without a provider | no executor registered → refused at validation; not offered to the Planner | T2-S6 |
| Browser exfiltration: form values, cookies, hidden fields | page reader returns structure only; forms are never submitted | T2-W1 |
| Cross-origin subresources, fetches, redirects, or calls back to the Host | origin allowlist on every request through the MA3 isolated browser proxy | T2-W2 |
| SSRF to loopback / private networks | refused unless separately authorized (test-only option) | T2-W3 |
| Session or download leakage between tasks | task-scoped profile, deleted on task end; downloads refused | T2-W5, T2-W6 |
| Envelope expires mid-task | the next connected step stops the task; nothing more is read | T2-X10 |
| Crash during a read-only action | re-read within budget; no lost state | T2-X12 |
| Replayed create / approval after completion | duplicate task id refused; late approval changes nothing | T2-X14 |
| Stale worker commits after lease takeover | fencing token refuses its commit | T2-X15 |
| One task reads another task's steps | step context limited to the task's own earlier outputs | T2-X16 |
| Work runs with no window attached and background work off | no connected action runs | T2-X19 |
| A phone approves or reads what would be sent | `action.*`, `connector.*`, `ptask.plan` are workstation-only (allowlist + command check); phone view hides recipients, paths and previews | T2-E2E-C (six commands → `WORKSTATION_REQUIRED`; recipient absent from the phone view) |
| A refused second Host corrupts the live Host's state | port bound before any state is opened | T2-H1, T2-H2, T2-H3 |

The adversarial suite (`ma4-s2t2-adversarial.test.ts`) holds X10, X11, X12, X14, X15, X16 and X19 (7/7). The
other threat classes are tested in the file, browser, service, workflow and startup suites named in the table.

## Carried over unchanged

The S2-T1 and earlier controls still pass in the same regression: sandbox F4.1–F4.11 / F5 seccomp, paired-device
default-deny, envelope pins and budgets, cloud inference not expressible, MA3 material guard on checkpoints.

## Not covered

* Real providers (Gmail, Outlook, Google/Microsoft calendar and docs): no adapter is connected. The service tests
  qualify the broker and adapter contract against the synthetic stand-in only.
* Real public websites: browser tests use local synthetic sites.
* An attacker with write access to the whole Host database can rewrite the receipt chain (tamper-evident, not
  tamper-proof; see CRASH_AND_REPLAY_SAFETY.md).
* Installed Windows release and a physical Android phone: NOT TESTED.
