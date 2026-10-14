# T13.3 Gate G — browser QA

Disposable QA Host (separate data directory, port 43190) behind the Vite dev Studio on 8091; the browser is the
workstation viewer. The installed production Host was not touched. Every setting changed here was reset to its default
afterwards (answer length Normal, Remember my feedback off, notification frequency Everything; the evaluated candidate
was rejected).

| # | Surface | Action | Observed | Result |
|---|---------|--------|----------|--------|
| 1 | Settings → AI & Models → Routing improvement | Open tab | "Routing in use" (Standard routing, Past results ×1 · speed off · one history for all tasks), "What Bunny observed" (No finished Tasks yet; 5-Task minimum stated), "Improve routing" | PASS |
| 2 | Routing improvement | Propose | Refused honestly: "No bounded policy improves on the current one: 0 verified decision(s) were replayed and none changed a verified failure without risking a verified success." No candidate created | PASS |
| 3 | Routing improvement | Try your own → Evaluate (×1, speed off, per kind of task) | Candidate "Evaluated · yours" with replay line (0 decisions) and "Not ready: No measured improvement …"; Shadow test disabled, Reject enabled | PASS |
| 4 | Routing improvement | Reload page | Candidate still listed (stored by the Host) | PASS |
| 5 | Routing improvement | Reject | "Rejected · yours … Rejected by the owner."; no action buttons; routing in use unchanged | PASS |
| 6 | Routing improvement | Visual check | **Defect found:** the panel's buttons rendered as plain text (no `btn secondary` class). Fixed in `routing-improvement.tsx`; re-screenshotted after reload | FIXED |
| 7 | Routing improvement at 390×844 | Layout | No element wider than the viewport (`scrollWidth` 390); controls wrap | PASS |
| 8 | Settings → Voice | Open group | Answer length, reply language, one voice picker per speaker (Bunny + 4 Agents) disabled with "Open voice once to list the voices installed on this PC."; rating buttons disabled ("No spoken model answer yet in this Host run."); Remember switch; Forget; limitations caption | PASS |
| 9 | Voice | Answer length → Brief | "Saved."; Bunny row reads "Brief answers (your choice above)"; Agents keep "from its interaction style" | PASS |
| 10 | Voice | Remember my feedback on → off | "Saved." each time; switch state follows the Host | PASS |
| 11 | Voice at 390×844 | Layout | No horizontal overflow | PASS |
| 12 | Settings → Notifications | Frequency → Only what needs me → Everything | "Saved." and value held after navigating away and back | PASS |

Not covered in the browser (covered by automated tests, see `docs/t13-3/ADAPTIVE_FEEDBACK.md`): rating a real spoken
answer, choosing an installed voice (needs a live voice session), Accept / Roll back (needs ≥5 verified shadow Tasks), and
device viewers (covered by the Host HTTP tests).

Screenshots: `screenshots/t13-3-g-routing-improvement-desktop.png` (after the fix), `…-routing-improvement-mobile.png`,
`…-voice-desktop.png`, `…-voice-mobile.png`, `…-notifications-desktop.png`.
