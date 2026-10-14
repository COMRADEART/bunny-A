# MA3 T13.3 Gate H: character styles (evidence summary)

- Base (Gate G evidence commit): `2b833fb` (`base-head.txt`)
- Gate H source commit: `88c3413` (`final-source-head.txt`)
- Design, rendering, measured performance, §38 mapping and limitations: `docs/t13-3/CHARACTER_STYLE_SYSTEM.md`

## Regression on the committed source tree (UTF-8 logs)

| Suite | Gate G | Gate H | Change |
| --- | --- | --- | --- |
| `npm test`, scripts | 440 / 440 | 448 / 448 | +8: `island-notch.test.mjs` native style tests |
| `npm test`, library | 1,560 / 1,560 | 1,563 / 1,563 | +3: `character-appearance-host.test.ts` (real Host over HTTP) |
| `npm test`, Agent runtime | 58 / 58 | 58 / 58 | none |
| `npm run test:ui` | 366 / 366 | 379 / 379 | +13: `character-style.test.ts` (H01–H13) |
| typecheck | exit 0 | exit 0 | |
| lint | 0 errors, 27 warnings | 0 errors, 27 warnings | baseline unchanged |
| build | exit 0 | exit 0 | |

All five steps passed on the first attempt. The logs are `exit-codes.txt` (a copy of `exit-codes-attempt1.txt`), `typecheck.log`, `lint.log`, `build.log`, `npm-test.log` and `npm-test-ui.log`. There were no failed regression runs to retain.

`character-appearance-host.test.ts` was added to the `test` script; the `test:ui` glob already covers the new UI test. No existing assertion was weakened, and no focused run is counted in these totals.

## Mutation checks (`mutation-checks.cjs`, `.json`, `.log`)

Of 19 mutations, 18 were killed by a targeted test, and every mutated file was hash-verified as restored. The mutations covered:

- **Pure rules:** strict validation, chosen style, Host-gated motion, high contrast, intensity off, the pixel alpha cut and no upscaling, the speaker mark and the Notch edge rule.
- **Host:** validation through the Host, reset deleting the row, and the snapshot projection.
- **Native:** pixel scaling, high contrast, intensity off, the speaker mark, signature fallback and the art-container cache.

H-M10, which removes the handler's workstation check, survives. `assertDeviceAction` default-denies every action missing from the device-rights map, `personal_agent.appearance` included, before the handler runs. The handler check stays as defence in depth (the same equivalence as Gate G's M6).

## Native Notch (`notch/`)

**Harness.** A disposable fixture Host (`fake-host-styles.mjs`, ports 43920–43959, every value labelled fixture) feeds the real Island in `-SmokeTest` through `wrapper.ps1`. `run-styles.ps1` checks each chip against expected values it computes independently; it does not read the Island's own tables.

**Final run.** `run-styles.log` and `style-receipts.json` record 23 runs with 0 failing, and 23 screenshots in `shots/`:

- **Edges.** All four edges with Gada speaking: Agents left of Bunny on top and bottom, above Bunny on left and right. Only the foreground slot carries the speaker bar, which is named "speaking now" in automation, and the working dots come from Host states.
- **Styles.** Each of the five styles is shown on all four Agents.
- **Settings.** High contrast, intensity off, intensity subtle and the reduced-motion preference are each covered. With Bunny speaking, no Agent is marked.
- **Performance.** Nine perf runs are recorded; the table is in `CHARACTER_STYLE_SYSTEM.md`. With the cache, every style costs about the same as the T13 chips without an effect: 19–22.5% of one core, 75 fps, p95 13.33 ms and about 5–5.7% GPU 3D.

**Retained exploratory and superseded runs:**

| Files | What they show |
|---|---|
| `explore-attempt-1..3.log` | Harness bring-up failures: no exit code from the Island process, skin expectations that did not allow `Fant` scaling or native art widths, and the GPU sample shape |
| `explore-attempt-4.log` | A single pixel perf probe (passing) |
| `explore-attempt-5-art-cache.log` | A single signature perf probe with the art-container cache (passing) |
| `run-styles-pre-cache.*`, `shots-pre-cache/` | Material styles at 34–43% CPU, 20–24% GPU and p95 26.7 ms before the fix |
| `run-styles-image-cache-attempt.*` | A cache on the image itself; it does not hold the image's own effect, so there was no gain and it was rejected |
| `run-styles-pixel14-superseded.*` | Native pixel art at a 14 px decode width, which made the Chakra unreadable. It was replaced by the 24 px longest-side rule that matches the web |

## Browser QA (`browser-qa.md`, `browser/`)

**Final run.** `appearance-qa.log` and `appearance-qa.json` record 36 of 36 checks passing, in headed Edge with Playwright. The Studio Appearance panel was tested against the QA Host on 43190 and the Vite server on 8091. The checks cover:

- the keyboard flow;
- all five styles in three previews;
- the Notch preview on four edges, with a single speaker and no celebration;
- high contrast, reduced motion and forced colours;
- the 20-cell design-preview gallery;
- Mission and Agent facts unchanged;
- 390×844 with no overflow and option targets of at least 44 px;
- a clean console.

**One defect was found and fixed.** Keyboard focus dropped to the page after each choice, because the controls were disabled while a change was in flight. The fix is in the source commit.

**Retained attempts.** `appearance-qa-attempt-1..3`:

- Attempt 1: the bundled Chromium was missing.
- Attempt 2: a stale Vite server render, and the mobile navigation needed opening first.
- Attempt 3: passed 36 of 36. It was re-run to explain a skip link drawn over the mobile panel. That was an artifact of Playwright's stitched element capture; the plain viewport capture is clean.

**Web performance** was measured per style; the table is in `browser-qa.md`.

## Restored side effects

`npm test` rewrites committed evidence of earlier milestones. After the run, `git checkout -- test-results/ma3/t5 test-results/ma3/t6 test-results/ma3/t7 test-results/ma3/t9r` restored it, leaving 0 files modified.

## Production preservation

The installed production Host (port 43119, its process unchanged) was not stopped, restarted or written to. The QA Host used a temporary data directory, and the native harness used disposable fixture Hosts and temporary Island data folders.

No push, deployment, sign-in, installation or paid inference took place. No model request was sent.

## Credential check

A count-only scan checked GitHub, OpenAI-style `sk-`, AWS, Slack, PEM private key and bearer token shapes. It covered 61 text files: the 26 Gate H source and doc files, and every text file in this folder. All six shapes count 0. The fixture Host token is a fixed non-secret string, and the screenshots show fixture data only.

## Not demonstrated in Gate H

- **Battery impact: NOT MEASURED.** The machine was on AC power, and per-process energy needs SRUM or administrator tooling.
- **Native draws less than the web.** It shows material effects and motion flavour, not the web accent overlays, and its pixel art has no 15-bit quantisation or 1-bit alpha.
- **The browser Notch preview showed two Agents.** The QA Host binds only Gada and Spear; the native harness covers all four.
- **Measurement scope.** Performance was measured on one machine, one display and one browser.
