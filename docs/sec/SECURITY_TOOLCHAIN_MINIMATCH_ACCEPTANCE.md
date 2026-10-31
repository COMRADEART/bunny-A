# Security lane receipt: dev-toolchain minimatch audit chain (GHSA-g3hv-75wg-m249)

- **Date:** 2026-10-31
- **Base:** main `b58611b` (Merge PR #71, 2026-10-31T21:28:39Z)
- **Branch:** `sec/minimatch-toolchain-override`
- **Scope:** dev-dependency toolchain only. No runtime dependency path changes.

## Finding

Full `npm audit` on baseline `b58611b` reported **14 moderate findings**, all in the dev
toolchain, rooted in a single advisory:

- **GHSA-g3hv-75wg-m249** — `minimatch < 11.0.1`, "potential denial of service via globparts
  amplification" (moderate). Reachable through the eslint/typescript-eslint chain:
  `@typescript-eslint/typescript-estree`, `@eslint/eslintrc`, `@eslint/config-array`,
  `eslint`, `typescript-eslint`.
- No production dependency was affected: the CI security gate
  (`npm audit --omit=dev --audit-level=high`) already passed on this baseline, consistent
  with Sprint 1/2 CI runs.
- Upstream has no fixed dependency pin yet at fix time: latest
  `@typescript-eslint/typescript-estree` 8.72.1 still depends on `minimatch ^10.2.2`, and
  `@eslint/config-array` 0.23.5 (eslint 10.14.0) on `^10.2.4` — both inside the vulnerable
  range. A plain devDependency bump therefore cannot clear the chain today.

## Fix

`package.json` gains one override entry next to the existing one:

```json
"overrides": {
  "minimatch": "^11.0.1",
  "nf3": "0.3.17"
}
```

`npm install` regenerated `package-lock.json`: the graph now resolves `minimatch` at
**11.0.3** everywhere dev tooling runs (the previously nested `10.2.6` under typescript-estree
and the root `3.1.5` under the legacy eslintrc path are both gone). All other resolutions in
the lock are unchanged versus `b58611b` (verified: eslint 9.39.5, typescript-eslint 8.70.1,
typescript-estree 8.70.1 identical before/after). Diff: `package-lock.json` +31/−61.

## Scope guards

- Dev-only override; no product/runtime dependency version changed.
- Production audit position unchanged (`npm audit --omit=dev` clean, high+ bar, before and after).
- No security check disabled and nothing skipped; the override makes the vulnerable version
  unresolvable rather than ignoring the advisory.

## Evidence (committed in this PR)

- `test-results/sec-toolchain/audit-before.txt` — baseline `b58611b` audit tail: 14 moderate findings.
- `test-results/sec-toolchain/audit-after.txt` — **"found 0 vulnerabilities"** (full audit, exit 0).
- `test-results/sec-toolchain/lint-after.txt` — `0 errors, 20 warnings` — identical to the
  PR #70 lint baseline (no new findings from the toolchain bump).
- `test-results/sec-toolchain/typecheck-after.txt` — `tsc --noEmit` pass.
- Upstream version survey quoted above (`npm view` receipts, 2026-10-31).

## Verdict

**PASS (agent scope, local gates).** CI gates on this PR: static security, typecheck/builds,
full `npm test` (~24 m). Agent does not merge; PR stays draft for owner review.
