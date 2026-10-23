# MA4-S2R1 — Skill applicability contract and retrieval gate

Code: `src/lib/bunny-host/ma4/relevance.ts` (pure), `SkillRegistry.attest` (`skills.server.ts`), `buildGuidance`
(`skill-learning.server.ts`), signature-tagged experience (`experience.server.ts`). Tests: `ma4-s2r1.test.ts`.

## 1. The contract a skill must carry

```ts
type Applicability = {
  version; contentSha256;            // bound to the exact skill text (name, version, procedure, roles, tools, …)
  categories: ("implement"|"debug"|"plan")[];
  operations; inputTypes; outputTypes; formats; domains;
  preconditions: { field: "formats"|"inputTypes"|"constraints"|"operations"; includes: string }[];
  requiredTools; permissions; exclusions;
  scope;                             // project scope it was validated in
  validatedOn: { taskId; signatureSha256 }[];   // must match passing sandbox evidence of the skill
  knownFailures: { taskId; signatureSha256 }[];
  attestedAt; expiresAt;             // 90 days by default
};
```

**Who writes it.** Only the Host, through `attestApplicability(skill, { taskId, signature })`, and only when the skill
has passing sandbox evidence on that task (`detail` starts with `<taskId>:`). The contract is exactly that task's
signature: its operations, input types and formats; preconditions are its formats; required tools and permissions
are the skill's own. It is **never widened** (no "similar" operations, no extra formats). The one generalisation is the
category family: a procedure validated on function-level work (implement or debug) applies to both, because in this
workflow both end with the Worker writing the specified function; plan-level (multi-part class) tasks need a
plan-validated skill. A model never writes applicability, and qualification trials do not add to it (in S2 they were
confounded by the broad retrieval this milestone removes).

**Missing metadata is ineligible.** A skill without a contract (every S2 skill before attestation, every rejected S2
skill, any future skill not yet attested) is rejected with `missing applicability metadata`.

**Binding.** `contentSha256` covers name, version, description, categories, preconditions, procedure, roles, tools
and limitations. `SkillRegistry.attest` refuses a contract that does not match the stored text; at retrieval a
mismatch (a replaced or edited record) is rejected. Attesting never changes the skill's lifecycle state.

## 2. Pipeline

```
task contract ──► taskSignature ──► Lotus skill pointers (authorized scopes, Host trust, verified, unexpired)
                                          │
                                          ▼
                         registry records of the pointed-to skills
                                          │
              hard filters (each failure = a recorded reason; no score overrides one)
   scope · trust state (usable in mode) · content hash · provenance · expiry · category family · operation ⊆ task
   · input type (or list of it) · preconditions · tools ⊆ granted · permissions ⊆ granted · exclusions
   · known failures · content screen (steering, credentials, named models, acceptance tampering, external transfer,
     model-pin changes, claimed authority) · validation evidence exists for every validatedOn entry
                                          │
                     explainable score ≥ threshold, excerpt fits 320 characters
                                          │
                  at most ONE skill (ties: score, shorter excerpt, name) — or NO SKILL
                                          │
       arm C only: at most one experience line passing the same signature gate and the memory text screen
                                          │
           one advisory block ≤ 600 characters, below the contract, labelled as data — or nothing
                                          │
             re-checked against the registry on every role call (rollback / quarantine / replacement)
```

## 3. Score (only for candidates that passed every filter)

| Part | Weight | Meaning |
|---|---|---|
| operation | +2 per shared operation | what the procedure does is what the task needs |
| format | +2 if the skill has formats and all are the task's | exact format match |
| output | +1 if an output type matches | the procedure's result is the task's result |
| domain | +1 if a domain matches | |
| evidence | +0.5 per passing sandbox/qualify record (max 3) | Host validation |
| success | +0.5 per passed recorded use (max 3) | monitoring |
| failure | −1 per failed recorded use (max 3) | known negative outcomes |
| cost | −1 per 400 excerpt characters | prompt-token cost (excerpt budget 320 characters after the dev run) |

Weights were fixed before any dev result; the threshold (3) was set on the dev split (`RELEVANCE_GATE_EVIDENCE.md`).
The score never admits a candidate a filter rejected.

## 4. Product behaviour

Unchanged defaults: the S2 memory policy is off, product mode uses `active` skills only, and no skill is approved or
active. With memory disabled the stem returns nothing, so no guidance is built. Cross-project retrieval needs an
explicit `authorizedScopes` entry; permissions beyond the workflow's tools need an explicit `grantedPermissions`
entry (none are granted anywhere). No raw conversation, prompt, hidden test or reference is ever a retrieval source.
