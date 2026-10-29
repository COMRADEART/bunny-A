# MA5-S2 Phase 1A: Native connected-task creation (S2-G3, S2-G4)

## Flow (Windows, "New Connected Task")

1. **Folders**: register/remove folders (`connector.roots.set`); select which ones this task may read.
2. **Goal**: description, project, pinned local model (only installed, non-hosted Ollama models are offered),
   allowed actions (read files / write text / check results).
3. **Plan**: `ptask.plan` with the narrowest envelope: local-only, `sideEffects:false`, foreground, 10 model calls,
   1 hour, expires in 24 h, read-only grants for the selected folders only.
4. **Review**: Host verdict (or its problems, in which case Create is unavailable), steps with inputs, each step's
   side-effect class from Host executor facts, the exact permissions, and whether Create starts work immediately or
   waits for approval (`review.approvalRequired`).
5. **Create**: enabled only after "I reviewed these steps and permissions". Sends the reviewed spec and the exact
   envelope object it was planned under. One attempt per proposal: success, refusal or uncertain outcome all consume
   it; nothing is retried.
6. **Monitor**: Agent Dashboard / Task History; tasks waiting for whole-task approval now appear in the Approval
   Center ("Start persistent task", bound to the task version; Deny cancels).

Safety rules enforced in the client, on top of the Host's own validation:

- Changing the goal, project, model, actions or folder selection after planning withdraws the proposal.
- A Host restart or identity change withdraws the proposal.
- No arbitrary directories: the Host decides what is grantable; refusals are shown verbatim.

## Evidence

| Check | Kind | Result |
|---|---|---|
| `scripts/ma5-s2/connected-task-contract.mjs` → `evidence/connected-task-contract.json` | Host-integrated, real local model | roots refusal (system folder), roots set, plan refusals (unpinned model, cloud provider), real plan in 7.3 s, create refuses a spec widened after review, create → `QUEUED` → `COMPLETED` |
| `ma4-s2t2-workflows.test.ts` T2-E2E-A (extended) | Unit/integration (recorded model) | `review` = no approval, four read-only steps; background envelope → approval required |
| `scripts/ma5-s2/verify-connected-task-windows.mjs` → `evidence/windows-connected-task.json` | **Real UI-tested** (compiled WPF, UI Automation, disposable Host, real `qwen2.5` 7B) | 6/6 stages: c1 register folder; c2 system folder refused with the Host's text, nothing changed; c3 plan + review (8.9 s), Create disabled before review; c4 edit after review withdraws it, zero tasks; c5 create → exactly one task, envelope = local-only, no side effects, read-only `notes` grant, `COMPLETED`, shown in Task History; c6 background task approved from the Approval Center (`approval.by = workstation`) |
| `native/windows/build.ps1` | build | 0 warnings, 0 errors |

## Not covered

- Planner quality: a 7B local Planner proposes valid but sometimes thin plans (e.g. `maxTokens: 50`). G7 findings stand.
- Keyboard-only and screen-reader walk-through of the new screen: not tested (controls have names/live regions).
- Write grants, browser origins and connected accounts are not offered in the native flow (read-only scope only).
