# E5A — Universal UI inventory and baseline

**Ready for owner review as the first audit slice. Universal UI completion is not accepted yet.**

Freshly fetched and reverified protected `main`: `28903a6c23936be58ebdf5c94fe8b2ed0e21b26c`. Its three required CI checks succeeded; zero open PRs were found before this slice. The unrelated dirty source checkout was preserved using a managed worktree on `codex/e5a-universal-ui-audit`.

This PR changes audit documentation, reproducible capture tools and actual screenshot evidence only. It does not modify product layout, materials, authority, Android permissions, characters or Windows notch behavior. That keeps the defect baseline independently reviewable before E5B/E5C fixes.

- [Screen inventory](SCREENS.md): all 25 requested sections plus the additional navigable Characters page; exact entry points, observed states, dialogs and missing qualifications.
- [Eight open defects](DEFECTS.md): sidebar compression to a 50px Settings panel, clipped appearance controls, landscape overflow, ultrawide underuse, unpadded Server Control, OS transparency fallback, navigation mapping and companion hydration.
- [Evidence index](EVIDENCE.md): 190 capture cases and 18 targeted layout probes, Silver and Graphite, with raw metrics and contact sheets. Six related-only captures explicitly do not qualify the absent Connected Services destination.
- [Validation and qualification](VALIDATION.md): PASS / PARTIAL / FAIL / BLOCKED, including physical-device boundaries.
- [Reference interpretation](REFERENCES.md): the five owner-supplied concept images remain visual references; their example runtime claims are never treated as application facts.

## Next independently reviewable slices

| Slice | Scope after E5A owner review | Exit evidence |
|---|---|---|
| E5B | Shared responsive workspace allocation, optional inspectors, consistent navigation, settings rows and Liquid Glass material/media precedence. Preserve all 22 themes, System/Light/Dark, intensity default 85 and blur independence. | Before/after probes for F01/F02/F03/F05/F06/F07, material endpoints and keyboard focus. |
| E5C | Apply shared components to every inventoried feature, table, inline form, dialog and companion route; fix F04/F08; retain runtime truth and existing security gates. | Populated and empty/disabled/error states for each section; owner-reviewed resolution for Connected Services mapping. |
| E5D | Visual regression, accessibility, performance and full protected-branch CI; physical Windows/Android qualifications reported separately. | Actual Narrator/TalkBack/device receipts where hardware is available; explicit BLOCKED otherwise. No emulation-as-hardware claims. |

Do not self-merge this PR. E5B–E5D are not implemented or claimed complete in this slice.
