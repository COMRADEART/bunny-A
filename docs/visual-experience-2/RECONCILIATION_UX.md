# Reconciliation UX (Visual Experience 2.0, Gate I)

This milestone closes T13.3 limitation L-RECONCILE-UI. When the Host cannot prove whether a write finished, it pauses
the work as **"Outcome uncertain — reconciliation required"** and replays nothing (T13.3 N-C policy). Until now the
owner could only resolve that through the raw `task.reconcile` and `mission.reconcile` commands. It now has a review in
the app.

## 1. Rules

- **Facts only from the Host.** `reconciliation-model.ts` builds every item from canonical snapshot data: tasks, Missions and their steps, Personal Agent slots, and projects. It never infers that work failed because a provider disconnected.
- **No automatic replay.** Nothing in the UI retries on its own. "Retry" exists only as an explicit owner choice behind a confirmation. For a task, it starts a new linked task that waits for fresh approval. For a Mission step, it reruns the step under the Mission's existing approval, once no earlier process is alive. Both are the Host's existing T13.3 behaviour.
- **Workstation owner only.**
  - The UI shows decision controls only when `mayReconcile(viewer)` is true, meaning the viewer is not a paired device.
  - `store.reconcile` refuses on a device, and accepts only `task.reconcile` or `mission.reconcile`.
  - The Host refuses both commands from a non-local principal (`WorkstationRequiredError`, `http.server.ts` and `bunny-missions/commands.server.ts`).
  - A device sees the review and the note "Only the workstation owner can decide. Open Bunny-A on your Windows PC to review." It gets no new phone authority.
- **Existing commands only.** A choice sends exactly `{action, data: {id, stepId?, resolution}}` through the normal command path, which checks `canAct()`. When the Host is not live, the choices are disabled and the card says why.

## 2. Where it appears

- **Approvals** (`approvals.tsx`): `ReconciliationReview` renders above the asks. While items exist, the heading reads "Review needed".
- **Navigation:** the Approvals count includes paused items, so the review is visible from every screen.
- **Mission plan:** an uncertain step keeps its T13 label (`UNCERTAIN_LABEL`).

## 3. The review card

| Field | Source |
| --- | --- |
| Title, "Paused" state | Task title, or `<Mission title>: <step role>` |
| Personal Agent | The slot whose Agent owns the Mission, with its weapon; otherwise "Not owned by a Personal Agent" |
| Project, Mission, Task | Names and ids from the snapshot |
| Last verified checkpoint | The last verified step of the Mission, or the task start time with "no verified result after that" |
| Last attempt | Provider, model and outcome (Mission: attempt number, provider or executor, outcome) |
| Why it is uncertain | The Host's own reason, with only the taxonomy prefix (`WRITE_PAUSE:`) removed |
| Paused since | `reconciliation.at` |
| What it may have changed | From the declared executor and access: a capability, a skill, or a model session; declared write access; a write-capable execution scope. It always ends "Nothing is replayed automatically. Check the target yourself before choosing." |
| Evidence from the Host | Dispatch "may have started", the error, the last event, process clean-up status, attempt detail and verification lines (at most 6) |

Choices:

- **Task:** "Retry as a new task" or "Close without retrying".
- **Mission step:** "Retry this step" or "Stop the Mission".

Each choice opens a confirmation (`role="group"`, "Confirm your decision") that states the consequence in plain words,
with **Confirm: <choice>** and **Back**. Keyboard focus moves to Confirm when the confirmation opens, and Back returns
focus to the choice that opened it. A refusal is shown inline with the Host's words.

Values are long sentences, so the card sets each label above its value, left-aligned. The reason spans the full width.
The card always sits on an opaque surface with a warning edge, so no theme's decoration, transparency, clipping or tilt
can obscure it (`reconciliation.css`).

## 4. Verification

| Check | Result |
| --- | --- |
| Unit: `reconciliation-model.test.ts` (3 tests) | A direct task becomes one review with Host facts, retry/close choices and the exact command. A Mission step names its owning Personal Agent, checkpoint and attempt, with retry/stop choices. A device viewer may not decide. Pass. |
| Live UI: `harness/reconcile-ui.mjs` against a DISPOSABLE Host whose uncertain task came from the Host's own N-C policy (fixture provider dropped its connection during unscoped write work) | **16/16**: the review renders in glass/light, cyberpunk/dark and editorial/light with Host facts; only retry/close are offered; focus moves to Confirm and Back returns it; Back sends nothing and changes nothing; Close plus Confirm sends exactly one `task.reconcile`; the Host records `resolution: close, resolvedBy: workstation`; the task count is unchanged and no linked task was created (no replay); the review disappears. |

The final run of `harness/reconcile-ui.mjs` (**16/16**) used the **built** desktop app from `910eb85`. It is in
`test-results/visual-experience-2/gate-i/`: `reconcile-ui.json` and screenshots of the review in three themes, the
confirmation, and the page after closing.

Superseded runs, kept under `superseded/`:

| Run | Outcome |
| --- | --- |
| `gate-i-run1-uppercase-check` | Harness bug: it read uppercase heading text through `innerText`. |
| `gate-i-run2-before-focus-fix` | Passed, but exposed the narrow fact layout and the lost focus, both fixed in source. |
| `gate-i-dev-server-run3` | 16/16 on the dev server, before the final build. |

## 5. Not covered

- The Mission-step path (`mission.reconcile`) is covered by the unit model test and by the Host's T13.3 N-C tests. It was not driven through this UI live, because the disposable fixture produces a direct-task uncertainty.
- "Retry" was not exercised live. It would start a new task on the fixture provider; its Host behaviour is covered by T13.3.
- The device's read-only view was checked by the model test and the Host refusal tests, not with a paired physical phone.
