# T9R-F03 independent review summary

| Round | Reviewers | Scope | Confirmed findings | Outcome |
|---|---|---|---|---|
| Map (pre-implementation) | 3 read-only analysts | containment, classifier design, LOW items | design inputs | `containment-reassessment.md`; tuned classifier design |
| 1 | 4 lenses, each MEDIUM+ finding sent to 2 refuting skeptics (`review/round1.json`) | bypass, availability, repairs, containment | classifier gaps rated **HIGH** by the bypass lens but downgraded to **MEDIUM** by every skeptic (backstop); availability MEDIUMs (one confirmed LOW); repairs LOWs only; containment claims confirmed | every confirmed item fixed with regression tests F03-R1-1..7, or dispositioned |
| 2 | 2 independent reviewers (`review/round2.md`) | manager/state repairs and changed legacy tests; classifier sweep | state: LOWs only (five PASS verdicts); classifier: MEDIUM/LOW gaps and availability items | fixed with F03-R2-1..8, or dispositioned |
| 3 | 1 independent reviewer, scoped verification (`review/round3.md`) | the round-2 repairs | 4 MEDIUM, 5 LOW defects in the repairs; no crash, no regression | all fixed with F03-R3-1..5 |

**BLOCKER / HIGH:** none confirmed. Round 1's three HIGH-rated bypass findings were all downgraded to MEDIUM by their skeptics, and all three were fixed.

**MEDIUM — open, dispositioned:**

1. **D1 heuristic residual class.** A tool or convention that consumes a project file by default without naming it in any file the scan reads. Every round found new families, and every family found was fixed; the class itself is open-ended. Mitigation: every paired-device change is inert in Host staging until the Windows Host owner promotes the exact reviewed bytes. Under a paired-device (remote) envelope, the bytes are also re-classified at promotion.
2. **Process containment** (F01 §7.4 survivor lineage, plus the unclean-Host-exit exposure). Reassessed and not repaired: the fix needs a native helper change for provider-session job containment. Recommended as its own gate (`containment-reassessment.md`).

**LOW — open, accepted:**

- A refused Retry leaves an unspent trusted-desktop grant. It cannot be consumed while the Mission is not running and expires after 5 minutes.
- Literal paths in program code are the F02 R3-7 disposition.
- Over-refusal caused by bare folder words in shell prose (fail-safe). In this repository, `data/` is refused for that reason.
- A consumer-named YAML/TOML file over 1 MiB fails closed (F02 contract).
- The round-3 repairs were verified by tests, not by a further independent round.
