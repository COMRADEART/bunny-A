# MA4-S2-T2 — End-to-end qualification

Suite: `src/lib/bunny-host/ma4-s2t2-workflows.test.ts` (3/3 in `evidence/npm-test.log`). Each workflow runs through a
real `startHost()` on loopback, with a temporary data directory and a registered temporary project folder, using
the workstation command path the dashboard uses.

**What this does and does not show.** The model is a recorded fake. The workflows show that the Host's controls work
end to end — proposal validation, grants, approvals, receipts, recovery, sanitized views. They do not show model
quality. Email/calendar/docs use the synthetic stand-in; browsing uses a local synthetic site.

## Workflow A — local project analysis (read-only)

1. The Planner (local model step) proposes a task spec from the owner's request. It cannot create it.
2. The Host validates the proposal like an owner spec; the owner creates it with a read-only folder grant.
3. `file.list` → `file.search` → `file.read` → `local.generate` summary. No approval needed (read-only); complete.

Checked: the proposal cannot add steps or grants beyond the owner's envelope; every step has a receipt; the summary
is stored as data. Timing: plan 17 ms, run 169 ms.

## Workflow B — browser research

Open a granted origin, follow an in-scope link, extract headings and text, summarize, then a Reviewer step. Checked:
nothing outside the one granted origin is fetched; page text reaches the model only fenced as untrusted; the
task's browser profile is gone after completion. Timing: 565 ms.

## Workflow C — connected draft and send

Files + Worker + Reviewer + `email.draft`, then `email.send`:

1. The draft is written idempotently; the Reviewer may stop the task before anything is sent.
2. `email.send` prepares the exact message and waits in the Approval Center (`AWAITING_APPROVAL`, nothing sent).
3. A forged payload hash is refused; the six approval/connector commands from a paired device return
   `WORKSTATION_REQUIRED`; the phone view does not contain the recipient address.
4. The Host is restarted while waiting; the proposal survives; approval after the restart sends exactly once.
5. A replayed approval after completion changes nothing.

Timing: 190 ms to the permission request, 401 ms from approval to verified send.

## UI evidence

USER_EXPERIENCE_VALIDATION.md: the real dashboard (Vite → bridge → isolated Host, Playwright) and the real WPF notch
against the same task states; Approve clicked in the page sent exactly one message; 0 console errors.

## Results

| Suite | Result |
|---|---|
| Workflows A/B/C (real Host) | 3/3 |
| File connector | 13/13 |
| Service adapters (synthetic) | 6/6 |
| Browser (real Chromium, synthetic sites) | 6/6 |
| Adversarial | 7/7 |
| Host startup (F-CI1-1) | 3/3 |
| S2-T1 persistent runtime (regression) | 31/31 |
| UI component tests | 412/412 |

## Limits

* **T2-G12 phone status: PARTIAL.** The phone screen was not rendered in a browser (needs the HTTPS companion origin);
  covered by logic tests and Host-level phone assertions only.
* Service connectors are qualified against the synthetic stand-in only; no live provider exists.
* Recorded fake model only.
* Folder registration and the Planner are Host commands; there is no settings form yet.
* Installed Windows release and a physical Android phone: NOT TESTED.
