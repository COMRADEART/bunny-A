# Independent review

## Rounds

| Round | Reviewer | Scope |
| --- | --- | --- |
| 0 | The session that wrote the change (self-review) | the original pass; findings R1–R5 of that pass are folded into the Limitations below |
| 1 | A separate reviewer agent with no context from the authoring sessions. It was read-only and ran only the focused tests. | Widget Studio files in the working tree on top of `777f666` |
| 2 | Built-app browser walk and packaged end-to-end (`test-results/widget-design-studio/`) | behaviour the code review could not see |

Round 1 found no BLOCKER and no HIGH. It confirmed that `__proto__` at the top level, in `focus` and in an item, a string `gap`, and a markup `projectId` are all refused. It also confirmed that a damaged row falls back to the default.

## Round 1 findings and disposition

| # | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| 1 | MEDIUM | Apply dead-ends after a stale refusal | **Fixed.** A refused Apply rebases, so the next Apply is a deliberate overwrite. |
| 2 | MEDIUM | Unapplied draft leaks onto other pages | **Fixed.** The draft is discarded when leaving Settings. |
| 3 | MEDIUM | Phone renders reconciliation row text | **Fixed.** Rows are withheld on a device, and a unit test was added. |
| 4 | MEDIUM | Agent card silently changes who answers | **Fixed.** The registry wording now says so. |
| 5 | MEDIUM | Phone home insertion not rendered | **Verified.** 22 phone pages at 390×844 had no overflow and no errors. |
| 6 | LOW | Global Escape closes the drawer and writes to the Host | **Fixed.** Only from inside the drawer; verified from the composer. |
| 7 | LOW | Resize handle is pointer-only; focus is not restored after a move | Limitation |
| 8 | LOW | Lotus ignores the Project filter; Inspector copy | Limitation |
| 9 | LOW | Dead device-layout path; Host copy promised a phone editor | Host copy **fixed**; the path is a limitation |
| 10 | LOW | Platform list not enforced on the phone | Limitation. The cards show "withheld" notes. |
| 11 | LOW | `mayReconcile(null)` fails open | Limitation. VE2 file; the Host enforces the decision. |
| 12 | LOW | Whole-store subscriptions | Limitation |
| 13 | LOW | Test gaps (`__proto__`, damaged row via the store, stale reset) | Covered by packaged W03 (`__proto__`, malformed revision). Stale reset is not separately tested. |
| 14 | LOW | Wordmark became "BunnyA" | Owner to confirm (carried VE2 follow-up) |

**Correction to round 1.** The reviewer reported no per-theme widget rule sets. That is not accurate. `widgets.css` has a rule for 21 theme ids, and Sketch is covered through `[data-material="sketch"]`. Rendered coverage is now 66/66 pages.

## Round 2 findings

| Id | Sev | Finding | Disposition |
| --- | --- | --- | --- |
| B1 | HIGH (visible breakage) | Sidebar floated over the page, covered the Appearance controls, and hid "Customize widgets". The independent review read the code and did not catch this. | **Fixed** as a fixed-width third column; verified by reload persistence and screenshot |
| B2 | MEDIUM | Agent rows ran together | **Fixed** |

Round 2 also found that the "Skip to content" chip in some widget-only captures is a screenshot artifact. During a normal scroll the link stays at `top: -100px` and unfocused (`skip-link-check-surreal.png`).

## Verdict

`BUNNY_WIDGET_STUDIO_PASS_WITH_LIMITATIONS`. Every BLOCKER and HIGH (B1) is resolved and re-verified, and the limitations are listed in `WIDGET_DESIGN_STUDIO_ACCEPTANCE.md` §8.
