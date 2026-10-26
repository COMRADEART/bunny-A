# MA4-S3-T3R2 — Root Authorization & Authority Boundary

## 1. Problem Statement & Historical Flaw

Prior to MA4-S3-T3R2, the `local.test` step executor accepted a raw filesystem path parameter (`input.rootPath`) alongside the registered root identifier (`input.root`). While resource registration and envelope checks were enforced against `input.root`, the actual process launch in `executeDeterministicTest` permitted `rootPath` to define the execution working directory.

In an agentic system where task specifications may be synthesized by language models or supplied by remote actors, allowing raw caller-controlled filesystem paths creates an unacceptable ambient authority risk. A caller could specify a registered root to pass validation while pointing `rootPath` to `C:\Windows\System32`, user application data, or another project.

---

## 2. Architectural Redesign & Hardened Contract

### 2.1 Elimination of `input.rootPath`
In MA4-S3-T3R2, raw filesystem paths are completely removed from the task-step input contract:
1. **Preflight Rejection:** The static validator `localTest.preflight(input, envelope)` inspects `input`. If `"rootPath"` is present (even if empty, null, or undefined), the task creation is rejected with a fatal validation error:
   ```text
   Caller-provided 'rootPath' is forbidden. Only registered root identifiers ('root') are permitted.
   ```
2. **Runtime Rejection:** `localTest.run` verifies that `input.rootPath` does not exist. Any attempt to supply it fails closed (`fatal: "VALIDATION"`, `dispatched: false`).

### 2.2 Strict Registered Root Identifier (`input.root`)
All filesystem and test execution operations must supply a valid Host-registered root identifier (`input.root`):
1. **Mandatory Root Specification:** Defaulting to whichever registered root happens to be first is strictly prohibited. If `input.root` is missing, the executor refuses execution:
   ```text
   No registered root was specified for test execution ('root' is required). Defaulting to unverified roots is forbidden.
   ```
2. **Envelope Grant Verification:** The root ID must be explicitly listed in the task's cryptographically bound envelope:
   ```ts
   const rootGrant = ctx.envelope.grants?.files?.find(f => f.root === requestedRoot);
   if (!rootGrant) {
     return {
       ok: false,
       error: `Folder "${requestedRoot}" is not authorized by the task envelope.`,
       dispatched: false,
       fatal: "PERMISSION_DENIED",
     };
   }
   ```
3. **Host Registry Resolution:** The root is resolved through the trusted Host registry (`ctx.resolveRoot(requestedRoot)`):
   - Confirms root ID is currently active in `FileRootRegistry`.
   - Confirms the root path exists on the host disk and is a directory.
   - Verifies the directory is not a Windows symbolic link, junction, or reparse point.
   - Evaluates the native canonical path (`realpathSync.native`) and ensures exact equality with the registered path.
   - Fails closed if the root was revoked or removed while the task was queued.

---

## 3. Boundary Verification Evidence

The root authorization boundary is validated by adversarial test suites in `src/lib/bunny-host/ma4-s3-t3r2-root-security.test.ts` and `ma4-s3-t3r2-held-out-eval.test.ts`:

| Test Gate | Scenario | Observed Outcome | Status |
| :--- | :--- | :--- | :---: |
| **T3R2-P1.1** | Caller-supplied `input.rootPath` attempted | Task creation refused at preflight; zero execution | PASS |
| **T3R2-P1.2** | Missing `input.root` parameter | Rejected; no defaulting to first registered root | PASS |
| **T3R2-P1.3** | Registered root not in envelope grant | Rejected with `PERMISSION_DENIED`; zero execution | PASS |
| **T3R2-P1.4** | Nonexistent root ID requested | Fails closed: root revoked or removed | PASS |
| **T3R2-P1.5** | Windows junction escaping project folder | Canonical check fails; reparse point rejected | PASS |
| **T3R2-P1.6** | Symlink escaping registered boundary | Realpath mismatch detected; execution refused | PASS |
| **T3R2-P1.7** | Root revoked while task queued | Registry resolution fails at launch boundary | PASS |
| **T3R2-P1.8** | Directory swapped for non-directory file | `stat.isDirectory()` check fails closed | PASS |

---

## 4. Invariant Summary

1. **Sole Authority:** Only the Host's trusted registry (`FileRootRegistry`) grants filesystem access authority.
2. **Zero Ambience:** A filesystem path cannot be executed simply because it exists on disk or was mentioned in a model prompt.
3. **Fail-Closed:** Any missing grant, revoked registration, or path ambiguity halts execution before any subprocess is spawned.
