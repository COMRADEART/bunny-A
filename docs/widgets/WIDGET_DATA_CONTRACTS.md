# Widget data contracts

Projections live in `src/components/island/widget-model.ts`. They read Host objects the shell already stores. They do not call the network and they do not fill gaps with sample numbers.

## Mission Control

Inputs: mission id, title, project, state, `updatedAt`, failure flag, and steps (role, state, dependencies, verified flag, reconcile flag), plus the Personal Agent slot that owns the mission.

Output: step counts (verified, pending, waiting, failed, dependencies) and the running step's role. The note says the Host did not provide a percentage. `mergeMissions` keeps a row when an incoming copy of the same id has an older `updatedAt`.

Offline: no mission body.

## Personal Agents

The four slots only: Gada, Spear, Vishnu Chakra, Sword, using the existing weapon art component. Status is `presentationLabel`. Activity is the Host step count on the slot when the Host sent one. Provider and model strings are not copied into the widget.

## Session Usage

Workstation only, from `sessionLedger`. Reservation count is the ledger's reserved count. Observed cost is Unknown when any account's observed cost is UNKNOWN, or when the ledger has no accounts. A reported local-device zero stays a number because the ledger already classified that cost as known. Limits use `remaining`: local, reported percent, or the Host's UNKNOWN reason. A phone gets `state: "withheld"` and no session id.

## Lotus Memory

Workstation: count, scope, layer, trust, time. The `value` field is dropped before render. Phone: withheld, including the Agent name, and an empty recent list even if the caller passed memories.

## Reconciliation

Uses `reconcileItems` and `mayReconcile`. The headline is the existing "Outcome uncertain — reconciliation required." The widget does not send `task.reconcile` or `mission.reconcile`. On the workstation, Open goes to Approvals, which mounts `ReconciliationReview`. On a phone, `canDecide` is false.

## Voice

Workstation: speaker name, session state, microphone (muted, capturing, open, or none), and the Host error string when present. A missing voice snapshot is "unreported", not a closed microphone. Choosing a speaker calls `personal_agent.foreground`, which does not pause Missions. Mute, open and close call the existing voice commands. A phone is withheld.

## Notch line

`notchCue` returns null, or `Reconcile 1` / `Reconcile N` (capped at 99). It is a label for the studio's four-edge preview. It does not move the WPF Notch.
