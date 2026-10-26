# Glass Notch and UI Integration: Real-Time Truthful Observability

## 1. Truthful State Machine

Bunny-A replaces simulated progress bars and mock execution spinners with **12 truthful states** directly projected from the Host execution engine:

```
[ Proposed ] ──► [ Awaiting approval ] ──► [ Queued ]
                                              │
         ┌───────────────┬────────────────────┼───────────────┐
         ▼               ▼                    ▼               ▼
   [ Planning ]     [ Working ]          [ Testing ]     [ Reviewing ]
         │               │                    │               │
         └───────────────┴─────────┬──────────┴───────────────┘
                                   │
              ┌────────────────────┼────────────────────┐
              ▼                    ▼                    ▼
        [ Completed ]         [ Failed ]           [ Cancelled ]
                                                        ▲
              [ Paused ] ◄──────────────────────────────┤
                                                        │
              [ Uncertain ] ◄── (Awaiting Owner Check) ─┘
```

### The 12 Truthful States:

| Truth State | Underlying Host State | Description |
|---|---|---|
| **Proposed** | `task.proposal != null` | Task proposal prepared; awaiting owner confirmation to run with agents. |
| **Awaiting approval** | `AWAITING_APPROVAL` | Consequential action or capability grant requires explicit owner authorization. |
| **Queued** | `QUEUED` / `launching` | Task admitted to the scheduler; awaiting worker claim or resource availability. |
| **Planning** | `RUNNING` (step: `local.plan`) | Planner role active; decomposing task into verified dependency DAG. |
| **Working** | `RUNNING` (step: `local.generate`/tools) | Worker role active; executing code generation or registered tool inspections. |
| **Testing** | `RUNNING` (step: `local.test`) | Tester role active; executing test runner and evaluating deterministic criteria. |
| **Reviewing** | `RUNNING` (step: `local.review`) | Reviewer role active; validating semantic quality against acceptance contracts. |
| **Paused** | `PAUSED` | Task paused by owner, memory floor violation, or background window closure. |
| **Completed** | `COMPLETED` | All required steps finished and verified with cryptographic evidence receipts. |
| **Failed** | `FAILED` | Step execution, verification, or budget constraint permanently failed. |
| **Cancelled** | `CANCELLED` | Explicitly stopped by user via chat, notch, or API command. |
| **Uncertain** | `UNCERTAIN` | Host restart interrupted an irreversible action; requires workstation owner check. |

---

## 2. Glass Notch Layout Rules

The movable Glass Notch (`src/components/island/floating.tsx`) provides persistent, ambient visibility into active agent intelligence.

### Placement and Orientation:
1. **Horizontal Notch (Top/Bottom Screen Edge):**
   - Active agents render on the **left side** of the notch.
   - Information hierarchy flows left-to-right: Active Agent Avatars -> Task Title -> Truthful State Badge -> Action Controls.
2. **Vertical Notch (Left/Right Screen Edge):**
   - Active agents render at the **top** of the vertical strip.
   - Hierarchy flows top-to-bottom: Active Agent Avatars -> Character Pill -> State Badge -> Minimize/Close.

### Truth Invariants for Agent Badges:
- An agent role indicator is rendered **only** when that role is currently executing in real Host code.
- A future role listed in a plan is **never** shown as active.
- When an agent finishes its turn, its indicator gracefully transitions to dormant or is replaced by the next active role.

---

## 3. Voice and Multimodal Invariants

When voice interaction is enabled:
- The voice engine reads the truthful Host state (e.g., "Worker is reading project notes", "Awaiting your approval to apply changes to index.ts").
- Voice commands **cannot** bypass safety gates: an approval or capability grant must still be confirmed by the workstation owner through secure, authenticated UI controls.
