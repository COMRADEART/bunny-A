# Gate J mutation checks

Each mutation puts one finding (or one fix) back and must make its targeted test fail. The script is `mutation-checks.cjs`, and files are restored after every run.

**Final result at the final source: 25 of 26 mutations caught.**

The main run is `mutation-checks.{json,log}`. Two mutations needed a corrected test after that run, and their retests caught them:

- `ND-M1`: the first N-D test used port 43291, which does not contain "429" (`mutation-checks-nd-retest.log`).
- `F1R-M1`: see attempt 5 below (`mutation-checks-f1r-retest.log`).

**The one survivor is F3-M1.** It is defence in depth, as in Gate I: the assign fix already guarantees that every focused Agent is owned by its slot.

## Retained attempts

| Attempt | File | What happened |
|---|---|---|
| 1 | `mutation-checks-attempt-1.*` | F6-M1 did not apply, because of an escaping bug in the checker. |
| 2 | `mutation-checks-attempt-2.*` | F6-M1 survived. My first F6 Host test used an Agent whose long answer pushed the quoted memory past the 80-character fold clip, so it could not fail. A short-reply test replaced it. |
| 3 | `mutation-checks-attempt-3-round-1.*` | Round one final: 15/16, F3-M1 survived. |
| 4 | `mutation-checks-attempt-4-crashed-file-lock.log` | Windows refused one mutation write (file lock). Nothing was left mutated, and every target was checked present afterwards. The checker now retries the write. |
| 5 | `mutation-checks-attempt-5-round-2.*` | Round two: F1R-M1 survived. The mutant copied the new heading text into the facts list. The test now requires the heading on its own line. |
| 6 | `mutation-checks-attempt-6-nd-survived.*` (= the main run) | Round three: 24/26. F3-M1 and ND-M1 survived. ND-M1 was fixed by the retest above. |
