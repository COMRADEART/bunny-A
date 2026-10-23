# MA4-S2-T1 — Mobile task continuity

The phone uses the existing authenticated Host/mobile path (paired device token, default-deny rights, device snapshot
projection). No cloud relay was added and the workstation is not exposed further.

## What a paired phone can do

| Action | Phone | Workstation |
|---|---|---|
| See tasks, per-task progress, approval-needed state, recovery status, completion evidence (step receipts) | yes | yes |
| Pause, resume, cancel; dismiss a notification | yes (`supervise`) | yes |
| Create a task, approve, resolve an uncertain action, revoke, change background/restart policy, read step outputs | **no** — `WORKSTATION_REQUIRED` | yes |

Resume always passes through RESUMING and re-authorization on the Host, so a phone cannot resume a task whose
approval expired or whose authority was revoked.

## Privacy

Task views never include step inputs (prompts) or outputs; the phone sees titles, states, counts and output hashes.
Tested over real HTTP: the phone's `/state` contains neither the step input text nor the output text.

## Stale state

The phone's existing connection model decides live vs stale vs offline. A task row in a view the Host has not just
confirmed reads "Last known: Working (14:05)", uses a neutral tone and offers no controls ("Controls are paused until
the Host answers"). A cached RUNNING is never shown as running now. The notch applies the same rule.

## Placement in the UI

Phone Home: a "Background tasks" section after the widgets. Desktop Today page: after "Persistent agents", with the
owner's two policy switches.

Tests: `ma4-s2t1-host.test.ts` (paired device over real HTTP), `ptask-model.test.ts` (stale rows, controls).
Physical Android hardware: **NOT TESTED** (web-mobile tests do not qualify a phone).
