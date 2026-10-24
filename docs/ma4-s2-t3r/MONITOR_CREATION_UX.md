# MA4-S2-T3R — Monitor creation UX (Phase C)

**Gate T3R-G4: PASS.**

## Form

Name; a short label for the phone and notch (no paths); project; source — a status field in a JSON file, a file's first
line, or one of the owner's tasks; folder (registered folders only) and file; condition — changes from one value to another
(from optional), becomes a value, changes at all; check interval (not below the Host's minimum), checks per hour, end date,
notify, priority.

## Review card

What it reads ("the "status" field of build/status.json in folder "Atlas project""), when it acts, check rate, **"No model
runs for checks"**, notification rule (once per change), and "The first check after approval only records the current
value."

## Row states (distinct, not animated)

| State | Label | Colour |
|---|---|---|
| active and readable | Monitoring · `<label>` · checked HH:MM (class) · last change HH:MM / no change seen yet · next check HH:MM | muted |
| three or more failed reads | **Cannot read source** + "could not be read N times in a row" | red |
| waiting for approval | Waiting for approval (Approve on the PC, Reject) | amber |
| paused / disabled / expired | Paused / Disabled / Expired | muted |
| stale view | "Last known: … (time)", no controls | muted |

`lastChangeAt` is recorded by the Host when a check classifies a change as meaningful. The browser check confirms zero
running animations on a monitor row and in the panel under reduced motion.

## Evidence

`proactive-model.test.ts` (last change, unreadable state), `ui-evidence.json` (monitor preview, keyboard order, row with
last/next check, no animation), `installed/lifecycle-final.json` (UI-created monitor survives restart), phone round 2
(pause/resume of a monitor and schedule from the device), `T3-M4`/`T3-M5` (injected file content changes nothing; no
cross-project leakage).
