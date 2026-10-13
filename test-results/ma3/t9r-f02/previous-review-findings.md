# Previous review findings carried into T9R-F02

Sources:
- `MA3_T9R_F01_SECURITY_CLOSURE.md` §4 and §7;
- `test-results/ma3/t9r-f01/review/round13-verified.json` (sealed F01 evidence, unchanged).

## F01 round 13: final findings that were fixed but never independently re-reviewed

| # | Finding (F01 round 13) | Severity | F01 repair (`aacf398`) | F02 independent re-review (round 1, lens `f01-mediums`) | Disposition |
|---|---|---|---|---|---|
| 1 | Paired-device command responses carry desktop grant, operation and binding records | MEDIUM | `redactReviewListing` applied to every device JSON response; `DEVICE_HIDDEN_KEYS`; regression F01-R57 | **CLOSED** for its stated scope (probe-verified: keys stripped, review reason replaced). F02 adds `promotion` to the hidden keys and redacts promotion reasons. A residual LOW: staging event and run text reached device `mission.get`. F02 rewords those texts as "paired-device change" so the existing redaction replaces them. | Closed |
| 2 | Survivor watcher dedupe keyed by Task id and root PID skips a later attempt whose root reuses the PID (mid-run hold fails open) | MEDIUM | per-attempt survivor tracking; regression R40 update | The **dedupe defect is CLOSED**: probe A tracked a second attempt with a reused root PID separately. A related **lineage gap** was confirmed: a grandchild whose intermediate parent exits between two 15 s process-tree samples is never admitted to the lineage (probe B). This is the residual F01 already disclosed in §7.4. | Dispositioned MEDIUM (see below) |
| 3 | Device `mission.get` events name trusted-desktop grant ids and the Host epoch | LOW | redaction | not reopened | Closed (LOW) |
| 4 | Python task check fails with an approval message but raises no review prompt | LOW | — | not in F02 scope | Unchanged (LOW) |
| 5 | `remoteActorFor` fails open on a read error | LOW | returns `device:unattributed` (fail closed) | not reopened | Closed (LOW) |

### Disposition of the survivor-lineage MEDIUM (explicit)

**Why it remains open.** A process tree created and orphaned entirely between two 15 s samples cannot be proven to descend from workstation-approved code. A safe fix needs synchronous process-table sampling at attempt end with an "unknown, fail closed" state. That is a Host process-tracking change outside F02's authorization-edge scope, with an availability risk of holding device changes indefinitely because of unrelated orphan processes.

**Why the impact is lower after F02.**
- The hold it weakens (`remoteMutationHeld`) used to protect device writes **landing in the project** while workstation code ran. Under F02 a device write never lands; it is staged.
- A staged change reaches the project only by a workstation promotion. Promotion refuses while `liveCodeExecutions()` reports code, and it is a deliberate owner decision on exact bytes.
- The gap therefore no longer lets a paired device change files under running code without the owner's action.
- It remains a defense-in-depth gap for the promotion-time check: the owner could promote while an untracked orphan survivor still runs.

**Status:** disclosed, not claimed independently cleared. Recommended follow-up: synchronous survivor sampling (a future gate).

## F01 §7 limitations and owner decisions: status after F02

| F01 §7 item | F02 status |
|---|---|
| 1. No physical phone, LAN or internet acceptance | Unchanged. Not tested in F02 either (see final report). |
| 2. Remote writes limited to data/document types | **Tightened (D1):** purpose-aware classification; root `.json/.yaml`, dot-folders, agent instructions, CI, watched source folders, 8.3 and invisible-character names are refused. |
| 3. **Disposition (round 4, HIGH):** a device may answer a one-time ask for an Agent's planned file step even after the workstation narrowed the Agent consent; nine T9/T9R tests encode it | **Closed by D3.** A device answer must lie inside the Agent's current consent (state, generation, expiry, revision and resource scope). `reviewedFilesystemOnce` honours only workstation answers, and a narrowed permission stays narrowed. The nine tests were rewritten (see `one-time-approval-regression.json`). |
| 4. Programs outside Bunny's tracking may read device-written files | **Reduced (D2):** device-written files are inert in Host-owned staging until a workstation promotion. External consumers can still read *promoted* files (documented; not claimed preventable). |
| 5. Survivor tracking is in memory | Unchanged (see the disposition above). |
| 6. Owner-configured Git filters still run on remote Git reads | Unchanged (out of F02 scope). |
| 7. Fail-closed availability items | Unchanged. F02 adds more fail-closed paths: staging requires promotion, and attributed deletes need a workstation grant. |
| 8. **Pre-existing open owner decision:** device self sign-out keeps the approvals the user gave | **Closed by D5:** self sign-out now invalidates the device's unused answers, staged changes, batches, consents and the envelopes it granted. Independent workstation authority is kept. |
| 9. Agent Missions cannot use trusted-desktop session grants; a burned grant | Unchanged. |
