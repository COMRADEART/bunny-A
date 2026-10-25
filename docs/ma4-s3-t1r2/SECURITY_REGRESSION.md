# Security and resource regression

`npm audit --omit=dev --audit-level=high` exited 0 and printed `found 0 vulnerabilities`.

No new authorization bypass, silent model substitution, or post-cancel write showed up in the live probes:

- A cloud model override on a local-only task was refused, and no model was selected.
- A stored preference for a model that is not installed returned `MODEL_APPROVAL_REQUIRED` and selected nothing.
- Host Stop settled to `stopped`. The generate output did not grow afterward.
- The approved edit reached disk only after task approval and action approval. The stale-hash edit did not write.
- An uncertain external effect is not retried, and a process that exits 3 stays failed rather than verified.
- File reads were checked against the fixture hash.

The unit and host suites that cover cancellation, routing, and process ownership passed. After `pretest` built the ownership helper, `ma4-s2t1-process.test.ts` passed 3/3, including the detached-child kill that the earlier `test:ma4` run had skipped. The broader counts are in `CI_RESULTS.md`.

The one local `npm test` failure is the packager refusing to ship without a Node license file. That is the fail-closed check, and it is recorded under `INSTALLED_WINDOWS_TEST.md`. It is not a vulnerability in the Host.

`classifyTask`, `admitWork`, and `orderQueue` are still not on the live chat submit path. That is an existing wiring gap, not a new permission bypass: chat still goes through approval, and local-only still refuses a cloud override.

Gate T1R2-G11 is **PASS** for defects found in this pass. The installed-package gate remains blocked, so this is not a release approval.
