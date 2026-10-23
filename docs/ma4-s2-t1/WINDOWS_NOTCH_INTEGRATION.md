# MA4-S2-T1 — Windows notch integration

No redesign: the movable glass notch, its placement rules and the original agent characters are unchanged.

## What was added

- `Get-BunnyTaskStrip` (pure, `install/Bunny-Island.Placement.ps1`): the Host's `persistentTasks` snapshot in, facts
  out. One entry per task id (a recovered task never gets a second badge); only open tasks count (Queued, Working,
  Waiting for approval, Paused, Recovering, Needs attention); the most urgent state leads; offline the headline is
  "Tasks: last known" and the tooltip begins "Host unavailable. Last known task states:".
- One neutral task cell in the existing agent strip (`Get-BunnyTaskChip`, `Bunny-Island.Weapons.ps1`): a dot in the
  lead state's theme colour and the open-task count; tooltip lists each task with its state and real step position;
  a click opens the dashboard's task details. The element is created once and updated per poll; it never animates.
- The idle notch status line ("Ready" or "Voice is off") shows the task headline instead, e.g. "2 working",
  "Waiting for approval", "Recovering", "Needs attention" (`Get-BunnyNotchStatus`, `Bunny-Island.Voice.ps1`).

## Placement

Because the task cell lives in the agent strip, the existing rule places it: horizontal notch → agents on the left;
side notch → agents on top. The strip's cell count includes it, so the layout reserves space correctly.

## Truthfulness

The cell reflects the Host's current task facts on every 2 s poll, never a remembered animation. On reconnect the
Island simply reads the Host's state again; the task ids are the same, so nothing duplicates.

## Evidence

`docs/ma4-s2-t1/evidence/notch/`: the real WPF Island (`-SmokeTest -CollapsedView`) rendered against a real Host whose
tasks were Working, Waiting for approval and Needs attention — top edge (`horizontal-live.png`: task cell left of the
body, "Needs attention") and left edge (`side-live.png`: task cell above the body) — then again after a Host restart
(`*-after-restart.png`: still one cell, count 3; the working task is now Paused by the startup policy).
`scripts/island-ptask.test.mjs`: dedup, urgency order, offline wording, placement sides, ASCII-only scripts.

Not done: no OS toast; no per-task character (tasks are not Agents and get no weapon or letter, per T13 rules).
