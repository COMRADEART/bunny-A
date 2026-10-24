# T6 TypeScript Failure Root Cause & Remediation (`ma4-s2t6.test.ts`)

**Task:** `MA4-S2-FINAL-FIX` — Critical Fix B  
**Affected PRs:**
- PR #32 (`ma4-s2-t6-provider-integrations`, head `823487df490daf14f4f96bb659908e1e1b5548d6`, Run `40125624171`)
- PR #33 (`ma4-s2-t7-operations-reliability`, head `e3e88ea754a6c6895f05b96306c042d74918332b`, Run `40126400429`)
- PR #34 (`ma4-s2-t8-release-candidate`, commit `7c81bd0` replaced the missing argument with synthetic `{} as never`, which was remediated to use the real `Prepared` & `ActionContext` contracts)

---

## 1. Exact TypeScript Errors Reported on Hosted CI
```text
src/lib/bunny-host/ma4-s2t6.test.ts(103,28): error TS2554: Expected 3 arguments, but got 2.
src/lib/bunny-host/ma4-s2t6.test.ts(113,27): error TS2554: Expected 3 arguments, but got 2.
src/lib/bunny-host/ma4-s2t6.test.ts(117,28): error TS2554: Expected 3 arguments, but got 2.
src/lib/bunny-host/ma4-s2t6.test.ts(127,28): error TS2554: Expected 3 arguments, but got 2.
```

---

## 2. Production Contract & Root Cause Analysis
In [`src/lib/bunny-host/ma4/action-broker.server.ts:50-58`](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/ma4/action-broker.server.ts#L50-L58), the `Connector<I>` interface defines:
```ts
export type Connector<I> = {
  contract: ActionContract<I>;
  available?(requirement: Requirement): string | null;
  prepare?(input: I, ctx: ActionContext): Promise<Prepared>;
  run(input: I, ctx: ActionContext, prepared: Prepared | null): Promise<ConnectorOutcome>;
  verify?(input: I, ctx: ActionContext): Promise<{ found: boolean; result?: unknown; receipt?: string }>;
};
```
And `ActionContext` (`src/lib/bunny-host/ma4/action-broker.server.ts:45-48`) requires:
```ts
export type ActionContext = {
  taskId: string;
  stepId: string;
  idempotencyKey: string;
  signal: AbortSignal;
  grants: Grants;
  outputOf(stepId: string): string | null;
  now(): number;
};
```

In `brokered<I>(connector: Connector<I>, ledger: ActionLedger)` (`action-broker.server.ts:137-214`):
1. For any consequential action (`c.consequential === true`, including `email.send`, `calendar.create`, and `docs.write`), the broker calls `prepared = await connector.prepare!(parsed.data, actx)` before verifying `ctx.approval.payloadSha256 === sha256(canonical({ schema: ACTION_SCHEMA, kind: c.kind, payload: prepared.payload }))` and before invoking `connector.run(parsed.data, actx, prepared)`.
2. In PR #32 (`fe70878`), `ma4-s2t6.test.ts` called `mailSend.run(input, ctx)` and `docsWrite.run(input, ctx)` with 2 arguments instead of 3 (`(input, ctx, prepared)`).
3. In PR #34 (`7c81bd0`), `ma4-s2t6.test.ts` silenced the compiler by passing `const sig = {} as never` as the 3rd argument and `{ idempotencyKey, outputOf } as never` as the 2nd argument, bypassing `prepare()` and `brokered()` altogether.

---

## 3. Remediation Implemented
In [`src/lib/bunny-host/ma4-s2t6.test.ts`](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/src/lib/bunny-host/ma4-s2t6.test.ts):
1. Constructed a complete, strongly-typed `ActionContext` via `makeActionContext(...)` with explicit `taskId`, `stepId`, `idempotencyKey`, `AbortSignal`, `now()`, `outputOf()`, and `Grants`.
2. Replaced synthetic `{} as never` with real `Prepared` objects obtained from `await mailSend.prepare!(sendInput, cleanCtx)` and `await docsWrite.prepare!(validDocInput, cleanCtx)`.
3. Verified that `mailSend.prepare!` and `docsWrite.prepare!` also enforce the untrusted-output boundary and version-CAS precondition before execution.
4. Added test `T6-F` exercising `brokered(connector, ledger)` end-to-end with `HostDatabase` and `ActionLedger`, verifying fail-closed behavior for:
   - Expired grants (`verifyOAuthOperationAuthorization` and `brokered` expired `approval.expiresAt <= now`)
   - Wrong account identity (cross-account confused-deputy refusal in `verifyOAuthOperationAuthorization` and `brokered.preflight`)
   - Cross-project access (`grantProblem` refusing ungranted folder root `proj-b` and write access on read-only root `proj-a`)
   - Missing authorization (`grant: null` in `verifyOAuthOperationAuthorization` and `approval: null` in `brokered.run` returning `ActionProposal` with `dispatched: false`)
   - Provider scope mismatch (`mail.send` missing from OAuth grant scopes; `draft` service grant when `send` is required)
   - Replayed operation (replaying an approval bound to one payload against a modified subject/payload records `approval_invalidated` and fails closed with `dispatched: false`)
   - Idempotency keys (`email.send` with identical `idempotencyKey` sends once and `verify()` confirms delivery)
   - Version-CAS conflict (`docs.write` with stale `expectedVersion` rejected in `prepare()` and `run()`)
   - Malicious connector output (connector result violating contract schema rejected with `result_rejected` and `ok: false`)
5. Added `ma4-s2t5.test.ts`, `ma4-s2t6.test.ts`, and `ma4-s2t7.test.ts` to the `test:ma4` script in [`package.json`](file:///C:/Users/allam/Documents/new/bun-router-s2-remediation/package.json).
