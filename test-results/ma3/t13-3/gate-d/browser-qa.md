# Gate D browser QA — Studio workers panel

Stack: QA Host on 43190 (temporary data directory, restarted once to load Gate D), Vite dev server on 8091,
Cursor's embedded browser. Gada (slot 1) owns two Missions from Gate B QA ("Release notes", "Website redesign"),
neither with a Project.

| Step | Observed |
| --- | --- |
| Agents → choose Gada | "Gada's workers" appears under Gada's memory: "No workers yet.", the Add worker form (Inside Mission lists only Gada's two live Missions; Ability lists the 9 built-ins) and the Abilities form |
| Add worker: Release notes, Run tests, "Run the release notes checks" | Row `Run tests · Waiting for your approval · up to 10 min` with a Stop button (the child Mission waits for approval) |
| Stop | Row `Run tests · Not verified · up to 10 min` with "Child Mission stopped. The worker was stopped before a verified result." No Stop button |
| Describe ability "Pre-merge check" from Typecheck + Lint | Row `Pre-merge check · Waiting for your review · runs typecheck, lint` with Approve and Remove; it is not offered in the Ability list |
| Approve | Row `Pre-merge check · Approved · runs typecheck, lint`; it is now offered in the Ability list |
| Mobile 390×844 | No horizontal overflow (`scrollWidth - innerWidth = 0`); form fields stack |

Screenshots: `studio-workers-desktop.png` (after Stop and approval), `studio-workers-mobile.png`.

After the first screenshot, the ability checkboxes were made inline with their labels and the Approve button got an
accessible name ("Approve <ability>"); the mobile screenshot shows the result. Both edits precede the regression run.

Blocked by the session's safety review: clicking Approve from an injected page script. The normal click tool was
used instead.
