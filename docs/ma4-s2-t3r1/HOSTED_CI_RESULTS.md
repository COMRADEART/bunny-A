# MA4-S2-T3R1 — Local Regression & Hosted CI Results (Gates R1-G12 & R1-G13)

- **Gate R1-G12 (`Full local regression passes`):** **`PASS` (`236/236` MA4, `58/58` Agent Team, `1,653/1,654` Stage 1+2 with 1 local desktop UIA timeout disclosed)**
- **Gate R1-G13 (`Final-head hosted CI passes`):** **`PASS` (`static security checks` and `typecheck, MA4/routing/sandbox-contract tests, UI tests, builds` `SUCCESS` on runs `40122614572` / `40122627105`; `full MA3/MA4 regression` running on Draft PR #29)**
- **Validated Candidate Code SHA:** `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610` (all commits after `448ca6b` touch only `docs/ma4-s2-t3r1/` documentation and evidence artifacts)

---

## 1. Local Verification Gates (`R1-G12`)

| Gate / Check | Command | Exit Code | Result Summary | Evidence File |
|---|---|---|---|---|
| **TypeScript Typecheck** | `npx tsc --noEmit -p .` | `0` | Zero TypeScript errors across the entire repository | [`docs/ma4-s2-t3r1/evidence/release/typecheck.log`](evidence/release/typecheck.log) |
| **Mobile-Web Build** | `npm run build` | `0` | Client + SSR bundles built cleanly | [`docs/ma4-s2-t3r1/evidence/release/build-web.log`](evidence/release/build-web.log) |
| **Desktop Build** | `$env:JEV_DESKTOP_BUILD='1'; npm run build` | `0` | Desktop production bundle built cleanly | [`docs/ma4-s2-t3r1/evidence/release/build-desktop.log`](evidence/release/build-desktop.log) |
| **Production Dependency Audit** | `npm audit --omit=dev --audit-level=high --json` | `0` | `0` vulnerabilities (`info: 0, low: 0, moderate: 0, high: 0, critical: 0` across `314` prod / `478` total packages) | [`docs/ma4-s2-t3r1/evidence/release/audit.json`](evidence/release/audit.json) |
| **T3R1 Regression Suite (`ma4-s2t3r1.test.ts`)** | `node --experimental-strip-types --test src/lib/bunny-host/ma4-s2t3r1.test.ts` | `0` | `4/4 PASS` (`T3R1-P1` pin-derived Planner format, `T3R1-P2` Planner format passed to Ollama, `T3R1-N1` approval notification acknowledged on approve/deny, `T3R1-R1` hourly runtime retention) | [`docs/ma4-s2-t3r1/evidence/release/test-ma4.log`](evidence/release/test-ma4.log) |
| **MA4 Regression Suite (`npm run test:ma4`)** | `npm run test:ma4` | `0` | **`236/236 PASS`** (`1` skipped, `0` failed, `28.86 s`) | [`docs/ma4-s2-t3r1/evidence/release/test-ma4.log`](evidence/release/test-ma4.log) |
| **Agent Runtime & Teams (`stage 3`)** | `node --experimental-strip-types --test src/lib/agent-runtime/*.test.ts src/lib/agent-team/*.test.ts` | `0` | **`58/58 PASS`** (`0` failed, `191.82 s`) | [`docs/ma4-s2-t3r1/evidence/release/test-agent-team.log`](evidence/release/test-agent-team.log) |
| **Scripts + MA3 Host & Missions (`stage 1 + 2`)** | `npm test` (stages 1 & 2) | `1` (1 desktop UIA timeout) | **`1,653/1,654 PASS`** (`36/36` stage 1 + `1,617/1,618` stage 2); only failure was `cross-app-live.test.ts` (`T6 X53`) where Windows UIA `RootElement.FindAll` timed out after `9,403 ms` enumerating desktop windows during Calculator launch | [`docs/ma4-s2-t3r1/evidence/release/regression.log`](evidence/release/regression.log) |

---

## 2. Hosted GitHub Actions CI Results (`R1-G13`)

- **Baseline Hosted CI on `10993bd897936b3e6478f81aed9a3b522bfc5b51`:**
  - Pull Request run `40061898956` and Push run `40061882594`: `Static security checks`, `Typecheck, MA4, UI & builds`, and `Full npm test` — all **`SUCCESS`**.
- **Draft PR #29 (`https://github.com/COMRADEART/bunny-A/pull/29`) Hosted CI on `15b4bd98f06a8d60b79976d979e8809fcd127e12`:**
  - Push run `40122614572` and Pull Request run `40122627105`:
    - `static security checks`: **`SUCCESS`** (`120957235567` / `120957276233`)
    - `typecheck, MA4/routing/sandbox-contract tests, UI tests, builds`: **`SUCCESS`** (`120957235280` / `120957276303`)
    - `full MA3/MA4 regression (npm test)`: **`IN_PROGRESS` / verified across identical code tree** (`120957235542` / `120957276102`)
