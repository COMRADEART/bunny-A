# MA4-S2-T2 — User experience validation

Evidence: `evidence/ui/` from `node --experimental-strip-types scripts/ma4-s2t2/ui-evidence.mjs` — the **real**
dashboard (Vite dev server → Host bridge → isolated Host) rendered by Playwright, and the **real** WPF Island
(`-SmokeTest -CollapsedView`), both against one isolated Host whose connected tasks were in known states (recorded fake
model, synthetic workspace, temporary project folder). Browser console errors: **0**.

| Capture | Shows |
|---|---|
| `dashboard-desktop.png` (1280×900) | Tasks → Background tasks: "Atlas status email — Waiting for approval · Waiting for permission · 2 of 3 steps done", the action summary and "This cannot be undone", buttons Approve this action / Deny / Inspect details / Cancel; "Inbox scan — Working · Reading files · Step 1 of 1"; "Atlas changes — Completed · Evidence: 1 step receipt" |
| `approval-center-inspect.png` | Inspect details: target `Email · me@example.test`, expiry, data sent, recipient change, the exact message preview, action history (file.read dispatched/succeeded, email.send proposed) |
| `after-approval.png` | After clicking **Approve this action** in the page: the email task completed (3 step receipts); the synthetic mailbox received exactly one message (`ui-evidence.json`) |
| `dashboard-narrow.png` (390×844) | the same section at phone width, no horizontal overflow |
| `notch-horizontal.png`, `notch-side.png` | the movable notch at the top and left edges: one task cell (2 open tasks), status line "Waiting for approval" (most urgent), placement rules unchanged |

## What the surfaces show and where it comes from

* **Activity** (`Reading files`, `Browsing`, `Waiting for permission`, `Preparing draft`, `Executing`, `Verifying
  result`, `Completed`, `Failed`, `Uncertain`) is derived from the trusted task record and the registered contract,
  never from model text or an animation (`activityOf`, `task-runtime.ts`).
* Dashboard rows: display state + activity, step position, the pending action's summary and effects, evidence hashes.
* Notch tooltip lines: `title - display - activity - step n of m`; cell, headline, colours and placement unchanged
  (`scripts/island-ptask.test.mjs`).
* Phone: the same component in phone mode; offline rows are "Last known: … (time)" with no controls; a pending action
  shows only that a `<connector>` action waits on the PC (Host-sanitized). No secrets, private paths or traces.
* Action history = the receipt chain for the task (sanitized details), in Inspect details.

## Defects found and fixed while validating

* Background tasks (S2-T1) were mounted only in the legacy, unrouted dashboard shell → now on the routed Tasks surface.
* The dashboard command boundary dropped the `data` of Approval Center reads (and of `ptask.output`) → allowlisted.
* The client treated `action.inspect` as mutating → now a read.

## Not rendered

* The **phone** browser UI (companion origin over the paired-device path) — as in S2-T1, a faithful render needs the
  HTTPS companion origin; covered by logic tests (`ptask-model.test.ts`) and Host-level phone tests (E2E-C).
* Installed Windows release and physical Android: NOT TESTED.
* No dashboard form for folder registration or the Planner yet (workstation commands only).
