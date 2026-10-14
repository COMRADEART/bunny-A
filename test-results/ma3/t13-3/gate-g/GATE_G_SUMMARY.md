# MA3 T13.3 Gate G: evaluation-gated routing improvement and voice personalization (evidence summary)

- Base (Gate F evidence commit): `8670b77` (`base-head.txt`)
- Gate G source commit: `a8d3787` (`final-source-head.txt`)
- Design, test mapping, §37 classification and mutation table: `docs/t13-3/ADAPTIVE_FEEDBACK.md`

## Regression on the committed source tree (UTF-8 logs)

| Suite | Gate F | Gate G | Change |
| --- | --- | --- | --- |
| `npm test`, scripts | 440 / 440 | 440 / 440 | none |
| `npm test`, library | 1,543 / 1,543 | 1,560 / 1,560 | +17: `routing-learning.test.ts` (7), `voice-personalization.test.ts` (5), `voice-session.test.ts` (4), `t3-manager.test.ts` (1) |
| `npm test`, Agent runtime | 58 / 58 | 58 / 58 | none |
| `npm run test:ui` | 366 / 366 | 366 / 366 | none |
| typecheck | exit 0 | exit 0 | |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings | baseline unchanged |
| build | exit 0 | exit 0 | |

All five steps passed on the first attempt: `exit-codes.txt` (a copy of `exit-codes-attempt1.txt`), `typecheck.log`, `lint.log`, `build.log`, `npm-test.log`, `npm-test-ui.log`. There were no failed regression runs to retain.

`routing-learning.test.ts` was added to the `test` script; the `voice/*.test.ts` glob already covers the voice files. No existing test assertion was weakened. Two existing files gained tests (`t3-manager.test.ts`, `voice-session.test.ts`), and no focused run is counted in these totals.

## Mutation checks (retained runs)

- `mutation-checks-attempt1.*`: M6, M8 and M11 survived.
  - M8 and M11 led to stronger tests: the T3 shadow test now seeds per-task-type evidence and asserts the recorded empirical points, and the timeout test speaks part of the answer and asserts `lastInterrupt.source`.
  - M6 is equivalent (below).
- `mutation-checks-run2.*`: 13 killed, M6 equivalent.
- `mutation-checks.*` (final): 13 killed, M6 equivalent. Re-run after the Bunny → Gada voice test was extended to Gada → Sword (a §37 "switching between Personal Agents" item); M12 is now killed by the renamed test.

M6, which removes the handler's workstation check, survives because `assertDeviceAction` default-denies every unmapped device action before the handler runs. The handler check stays as defence in depth.

## Browser QA (QA Host 43190, `browser-qa.md`)

- Settings → AI & Models → Routing improvement: Propose refused honestly with 0 verified decisions. An owner candidate showed as Evaluated with "Not ready: No measured improvement…", survived a reload, and was rejected.
- Settings → Voice: per-speaker voice pickers stay disabled until voice has listed installed voices; rating is disabled with no spoken answer. Answer length and the Remember switch saved through the Host and were reset.
- Settings → Notifications: the frequency saved and held.
- **One defect was found and fixed:** the Routing improvement buttons had no button styling (missing `btn secondary`). The fix is in the source commit, and the desktop screenshot was retaken after it.
- At 390×844 there is no horizontal overflow on either panel.
- Afterwards the QA Host was reset to defaults: Normal length, Remember off, Everything, and the candidate rejected.

## Restored side effects

`npm test` rewrites committed evidence of earlier milestones. After the run, `git checkout -- test-results/ma3/t5 test-results/ma3/t6 test-results/ma3/t7 test-results/ma3/t9r` restored it (0 files left modified).

## Production preservation

The installed production Host (port 43119) was not stopped, restarted or written to. QA used the separate Host on port 43190, with a temporary data directory, and the Vite dev server on 8091.

No push, deployment, sign-in, installation or paid inference took place. No model request was sent from the QA Host, and no candidate routing policy was accepted.

## Credential check

A count-only scan checked common token shapes: GitHub, OpenAI-style `sk-`, AWS, Slack, PEM private keys and bearer tokens. It covered 36 files: the 18 files of the source commit, every file in this folder, `ADAPTIVE_FEEDBACK.md` and the architecture doc.

The first pass found 1 match for the unanchored `sk-` pattern in `npm-test.log`. Without printing it, the match was confirmed to sit inside a longer word, to appear in committed test source, and to appear in the accepted Gate F log, so it is part of an existing test title. With the pattern anchored at a word start, the scan finds 0 matches. The screenshots show no credentials.

## Not demonstrated in Gate G

- **No routing policy was proposed, shadow tested or accepted on real verified provider work.** The QA Host has no finished Tasks. Every lifecycle transition is proven by tests: pure rules, the `PolicyEngine` with seeded evidence, a real Host over HTTP, and the T3 pipeline with fixture adapters.
- **The routing signals have gaps.** The tool error rate is not separated from other failures, and cloud cost stays UNKNOWN.
- **Two voice settings are not adjustable:** speaking pace (the native worker has no rate field) and interruption preference (it would change T12 turn-taking).
- **Hardware voice paths were NOT TESTED in this gate:** microphone capture, speaker playback and a human barge-in. A live model's adherence to an Agent personality was also not tested.
- **Browser console errors:** not recorded during QA.
