# MA4-S1R3 dependency security baseline — R3-G12

* The baseline commit `5d92fea` (PR #11) changes only `package-lock.json` (224 insertions, 225 deletions). No `package.json` range or source file changed, and `npm audit fix --force` was not used.
* S1R3 changes no dependency and does not touch `package-lock.json` (verified by `git diff 5d92fea HEAD -- package-lock.json` being empty at release time).
* Re-verified on this branch, in the isolated worktree with its own `npm ci`, on 2026-10-21:

| Command | Result | Log |
|---|---|---|
| `npm audit --omit=dev --audit-level=high` (the CI gate) | **found 0 vulnerabilities** | `evidence/npm-audit-prod.log` |
| `npm audit` (including dev) | **found 0 vulnerabilities** | `evidence/npm-audit-all.log` |

* Hosted CI on PR #11: `static security checks` **SUCCESS**. Before the fix, PR #10 failed the same job.
* No newly discovered advisories.
* Conflict guidance: when the stack is integrated with `main`, resolve `package-lock.json` by taking the S1R3/#11 side and re-running `npm audit`. Never regenerate the lock from an older branch, which would restore vulnerable versions.
* The S1R2 report figures carried forward (2,204 regression, 406 UI, 58 MA4) are re-measured on this branch in RELEASE_QUALIFICATION.md rather than assumed.
