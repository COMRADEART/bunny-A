# MA4-S2-T3R1 — Local Regression & Hosted CI Results (Gates R1-G12 & R1-G13)

- **Gate R1-G12 (`Full local regression passes`):** **`PASS`** (TypeScript typecheck, mobile-web build, desktop build, production dependency audit, UI/accessibility suite, and full `npm test` regression suite)
- **Gate R1-G13 (`Final-head hosted CI passes`):** _Updated below once the final-head GitHub Actions run completes on `ma4-s2-t3r1-beta-closure`_
- **Validated Candidate Code SHA:** `448ca6b6fb7252e2ea7af00e02ed9e078b5d1610` (all commits after `448ca6b` touch only `docs/ma4-s2-t3r1/` documentation and evidence artifacts)

---

## 1. Local Verification Gates (`R1-G12`)

| Gate / Check | Command | Exit Code | Result Summary | Evidence File |
|---|---|---|---|---|
| **TypeScript Typecheck** | `npx tsc --noEmit -p .` | `0` | Zero TypeScript errors across the entire repository | [`docs/ma4-s2-t3r1/evidence/release/typecheck.log`](evidence/release/typecheck.log) |
| **Mobile-Web Build** | `npm run build` | `0` | Client + SSR bundles built cleanly | [`docs/ma4-s2-t3r1/evidence/release/build-web.log`](evidence/release/build-web.log) |
| **Desktop Build** | `$env:JEV_DESKTOP_BUILD='1'; npm run build` | `0` | Desktop production bundle built cleanly | [`docs/ma4-s2-t3r1/evidence/release/build-desktop.log`](evidence/release/build-desktop.log) |
| **Production Dependency Audit** | `npm audit --omit=dev --audit-level=high --json` | `0` | `0` vulnerabilities (`info: 0, low: 0, moderate: 0, high: 0, critical: 0` across `314` prod / `478` total packages) | [`docs/ma4-s2-t3r1/evidence/release/audit.json`](evidence/release/audit.json) |
| **T3R1 Regression Suite (`ma4-s2t3r1.test.ts`)** | `node --experimental-strip-types --test src/lib/bunny-host/ma4-s2t3r1.test.ts` | `0` | `4/4 PASS` (`T3R1-P1` pin-derived Planner format, `T3R1-P2` Planner format passed to Ollama, `T3R1-N1` approval notification acknowledged on approve/deny, `T3R1-R1` hourly runtime retention) | [`docs/ma4-s2-t3r1/evidence/release/regression.log`](evidence/release/regression.log) |
| **Full Repository Regression (`npm test`)** | `npm test` | `0` | Full MA3 + MA4 + WSL2/seccomp regression suite `PASS` | [`docs/ma4-s2-t3r1/evidence/release/regression.log`](evidence/release/regression.log) |

---

## 2. Hosted GitHub Actions CI Results (`R1-G13`)

- **Baseline Hosted CI on `10993bd897936b3e6478f81aed9a3b522bfc5b51`:**
  - Pull Request run `40061898956` and Push run `40061882594`: `Static security checks`, `Typecheck, MA4, UI & builds`, and `Full npm test` — all **`SUCCESS`**.
- **Final-Head Hosted CI on `ma4-s2-t3r1-beta-closure`:**
  - _Pending push and draft PR creation; run ID and job table recorded immediately upon workflow completion._
