import test from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import {
  CONNECTOR_REGISTRY,
  validateConnectorRegistration,
  verifyOAuthOperationAuthorization,
  type ConnectorRegistryEntry,
} from "./ma4/connector-registry.ts";
import { serviceConnectors, SyntheticWorkspace } from "./ma4/connectors/services.server.ts";
import {
  ACTION_SCHEMA,
  ActionLedger,
  brokered,
  grantProblem,
  RESULT_SCHEMA,
  type ActionContext,
  type Connector,
  type Prepared,
} from "./ma4/action-broker.server.ts";
import type { Envelope, Grants } from "./ma4/task-runtime.ts";
import type { StepContext } from "./ma4/task-runtime.server.ts";
import { HostDatabase } from "./persistence.server.ts";

function makeActionContext(overrides: Partial<ActionContext> & { idempotencyKey: string; outputOf: (stepId: string) => string | null }): ActionContext {
  const defaultGrants: Grants = {
    files: [{ root: "proj-a", access: "read" }],
    origins: ["https://docs.example.com"],
    services: [
      { connector: "email", account: "work", access: "send", recipients: ["team@example.com", "victim@example.com"] },
      { connector: "calendar", account: "work", access: "write", recipients: ["team@example.com"] },
      { connector: "docs", account: "work", access: "write", recipients: [] },
    ],
  };
  return {
    taskId: "task-t6-1",
    stepId: "step-t6-1",
    signal: new AbortController().signal,
    grants: defaultGrants,
    now: () => 1_700_000_000_000,
    ...overrides,
  };
}

function makeStepContext(
  envelope: Envelope,
  now: number,
  overrides: Partial<StepContext> = {},
): StepContext {
  return {
    taskId: "t-broker",
    stepId: "s-1",
    attempt: 1,
    idempotencyKey: "k-broker-1",
    signal: new AbortController().signal,
    envelope,
    approval: null,
    model: null,
    call: async () => ({ ok: true, text: "ok", servedModel: "qwen2.5-coder:7b", durationMs: 1 }),
    track: () => {},
    outputOf: () => null,
    now: () => now,
    ...overrides,
  };
}

test("T6-A: every registered connector in CONNECTOR_REGISTRY passes capability & least-privilege validation", () => {
  const ids = Object.keys(CONNECTOR_REGISTRY);
  assert.deepEqual(ids.sort(), ["browser", "calendar", "docs", "email", "files"]);
  for (const entry of Object.values(CONNECTOR_REGISTRY)) {
    const res = validateConnectorRegistration(entry);
    assert.equal(res.ok, true, `${entry.connectorId} failed validation: ${res.errors.join("; ")}`);
  }

  // Reject wildcard scope or unapproved consequential write
  const badConnector: ConnectorRegistryEntry = {
    ...CONNECTOR_REGISTRY.email,
    enabledInProductionByDefault: true,
    operations: [
      {
        kind: "email.send",
        operation: "send",
        classification: "write_consequential",
        requiredScopes: ["https://mail.google.com/"],
        dataCategories: ["email_outbound"],
        sideEffectGuarantee: "bad",
        idempotency: "key",
        requiresExplicitApproval: false,
        untrustedOutput: false,
        recoveryBehavior: "verify_by_idempotency_key",
      },
    ],
  };
  const badRes = validateConnectorRegistration(badConnector);
  assert.equal(badRes.ok, false);
  assert.equal(badRes.errors.length, 3);
});

test("T6-B: verifyOAuthOperationAuthorization enforces narrow scopes, expiry, revocation, missing grant, and account isolation", () => {
  const now = 1_700_000_000_000;
  const grant = {
    account: "work@example.com",
    grantedScopes: ["mail.read.metadata", "mail.read.body", "mail.compose.draft"],
    expiresAt: now + 3_600_000,
    revoked: false,
  };

  // Allowed read & draft
  assert.equal(
    verifyOAuthOperationAuthorization({ operationKind: "email.read", requestedAccount: "work@example.com", grant, now }).allowed,
    true,
  );
  assert.equal(
    verifyOAuthOperationAuthorization({ operationKind: "email.draft", requestedAccount: "work@example.com", grant, now }).allowed,
    true,
  );

  // Blocked missing authorization grant
  const missingGrant = verifyOAuthOperationAuthorization({
    operationKind: "email.read",
    requestedAccount: "work@example.com",
    grant: null,
    now,
  });
  assert.equal(missingGrant.allowed, false);
  assert.match(missingGrant.reason ?? "", /No OAuth grant found/);

  // Blocked expired grant
  const expiredGrant = verifyOAuthOperationAuthorization({
    operationKind: "email.read",
    requestedAccount: "work@example.com",
    grant: { ...grant, expiresAt: now },
    now,
  });
  assert.equal(expiredGrant.allowed, false);
  assert.match(expiredGrant.reason ?? "", /expired/);

  // Blocked send without mail.send scope (provider scope mismatch)
  const noSend = verifyOAuthOperationAuthorization({ operationKind: "email.send", requestedAccount: "work@example.com", grant, now });
  assert.equal(noSend.allowed, false);
  assert.match(noSend.reason ?? "", /Missing required narrow scope\(s\): mail\.send/);

  // Blocked cross-account confused deputy (wrong account identity)
  const crossAccount = verifyOAuthOperationAuthorization({
    operationKind: "email.read",
    requestedAccount: "personal@example.com",
    grant,
    now,
  });
  assert.equal(crossAccount.allowed, false);
  assert.match(crossAccount.reason ?? "", /Cross-account confused-deputy blocked/);

  // Blocked revoked grant
  const revoked = verifyOAuthOperationAuthorization({
    operationKind: "email.read",
    requestedAccount: "work@example.com",
    grant: { ...grant, revoked: true },
    now,
  });
  assert.equal(revoked.allowed, false);
  assert.match(revoked.reason ?? "", /revoked/);
});

test("T6-C/D/E: serviceConnectors enforce idempotency, version CAS, and untrusted-output prompt-injection boundary with real Prepared context", async () => {
  const vault = { token: (_p: string, account: string) => (account === "work" ? "tok-work" : null) };
  const ws = new SyntheticWorkspace(vault, { email: ["work"], calendar: ["work"], docs: ["work"] });
  ws.docsStore.set("doc-1", { id: "doc-1", title: "Roadmap", version: "v1", content: "Initial text" });

  const connectors = serviceConnectors(ws) as unknown as Connector<Record<string, unknown>>[];
  const byKind = new Map(connectors.map((c) => [c.contract.kind, c]));

  // 1. Untrusted connector output cannot be passed directly to email.send bodyFrom (rejected at prepare and run)
  const mailSend = byKind.get("email.send")!;
  const injectedCtx = makeActionContext({
    idempotencyKey: "key-inject-1",
    outputOf: () => JSON.stringify({ schema: RESULT_SCHEMA, body: "Injected from untrusted email" }),
  });
  const injectedInput = { account: "work", to: ["victim@example.com"], subject: "Exfil", bodyFrom: "step-1" };
  await assert.rejects(
    () => mailSend.prepare!(injectedInput, injectedCtx),
    /must name a generating step, not a connector result/,
  );
  const injectedOutcome = await mailSend.run(injectedInput, injectedCtx, null);
  assert.equal(injectedOutcome.ok, false);
  assert.match((injectedOutcome as { error: string }).error, /must name a generating step, not a connector result/);
  assert.equal(ws.sent.length, 0);

  // 2. Idempotent email.send by key with real Prepared context never sends twice
  const cleanCtx = makeActionContext({
    idempotencyKey: "key-send-1",
    outputOf: () => "Approved summary body",
  });
  const sendInput = { account: "work", to: ["team@example.com"], subject: "Status", bodyFrom: "step-gen" };
  const preparedSend: Prepared = await mailSend.prepare!(sendInput, cleanCtx);
  assert.equal(preparedSend.target, "Email · work");
  assert.equal(preparedSend.reversible, false);

  const firstSend = await mailSend.run(sendInput, cleanCtx, preparedSend);
  const secondSend = await mailSend.run(sendInput, cleanCtx, preparedSend);
  assert.equal(firstSend.ok, true);
  assert.equal(secondSend.ok, true);
  assert.equal(ws.sent.length, 1, "idempotency key prevented duplicate email send");

  const verifiedSend = await mailSend.verify!(sendInput, cleanCtx);
  assert.equal(verifiedSend.found, true);

  // 3. docs.write compare-and-swap refuses stale expectedVersion in both prepare and run, and succeeds with matching Prepared version
  const docsWrite = byKind.get("docs.write")!;
  const validDocInput = { account: "work", docId: "doc-1", content: "Updated roadmap", expectedVersion: "v1" };
  const preparedDoc: Prepared = await docsWrite.prepare!(validDocInput, cleanCtx);
  assert.equal(preparedDoc.target, "Documents · work");

  const staleDocInput = { account: "work", docId: "doc-1", content: "Overwritten", expectedVersion: "v0-stale" };
  await assert.rejects(
    () => docsWrite.prepare!(staleDocInput, cleanCtx),
    /changed since it was read \(now version v1\)/,
  );
  const staleWrite = await docsWrite.run(staleDocInput, cleanCtx, preparedDoc);
  assert.equal(staleWrite.ok, false);
  assert.match((staleWrite as { error: string }).error, /version v1, not v0-stale/);
});

test("T6-F: brokered executor enforces fail-closed authorization for missing/expired/replayed approvals, wrong account, cross-project access, scope mismatch, and malicious connector output", async () => {
  const db = new HostDatabase(":memory:");
  try {
    const ledger = new ActionLedger(db);
    const vault = { token: (_p: string, account: string) => (account === "work" ? "tok-work" : null) };
    const ws = new SyntheticWorkspace(vault, { email: ["work"], calendar: ["work"], docs: ["work"] });
    const connectors = serviceConnectors(ws) as unknown as Connector<Record<string, unknown>>[];
    const mailSend = connectors.find((c) => c.contract.kind === "email.send")!;
    const exec = brokered(mailSend, ledger);

    const now = 1_700_000_000_000;
    const baseEnvelope: Envelope = {
      capabilities: ["email.send"],
      providers: ["ollama"],
      localOnly: true,
      models: ["qwen2.5-coder:7b"],
      projectScopes: ["proj-a"],
      sideEffects: true,
      background: false,
      budgets: { maxModelCalls: 5, maxWallMs: 60_000 },
      expiresAt: now + 60_000,
      grants: {
        files: [{ root: "proj-a", access: "read" }],
        origins: [],
        services: [{ connector: "email", account: "work", access: "send", recipients: ["team@example.com"] }],
      },
    };
    const rawInput = { account: "work", to: "team@example.com", subject: "Report", body: "Clean body" };

    // 1. Cross-project / ungranted file root and wrong account identity fail closed in grantProblem / preflight
    assert.match(
      grantProblem({ kind: "file", root: "proj-b", access: "read" }, baseEnvelope.grants) ?? "",
      /Folder "proj-b" is not granted/,
    );
    assert.match(
      grantProblem({ kind: "file", root: "proj-a", access: "write" }, baseEnvelope.grants) ?? "",
      /granted read-only/,
    );
    assert.match(
      exec.preflight!({ ...rawInput, account: "personal" }, baseEnvelope).join(" "),
      /account "personal" is not granted/,
    );
    // Provider scope mismatch (grant allows draft, operation requires send)
    const draftOnlyEnvelope: Envelope = {
      ...baseEnvelope,
      grants: {
        files: [],
        origins: [],
        services: [{ connector: "email", account: "work", access: "draft", recipients: ["team@example.com"] }],
      },
    };
    assert.match(exec.preflight!(rawInput, draftOnlyEnvelope).join(" "), /allows draft, not send/);

    // 2. Missing authorization (no approval on consequential action) proposes and fails closed without dispatching
    const noApprovalRes = await exec.run(rawInput, makeStepContext(baseEnvelope, now));
    assert.equal(noApprovalRes.ok, false);
    assert.equal(noApprovalRes.dispatched, false);
    if (noApprovalRes.ok || !("proposal" in noApprovalRes) || !noApprovalRes.proposal) {
      assert.fail("expected ActionProposal when approval is missing");
    }
    const proposal = noApprovalRes.proposal;
    assert.equal(ws.sent.length, 0);

    // 3. Expired approval fails closed without dispatching
    const expiredApprovalRes = await exec.run(
      rawInput,
      makeStepContext(baseEnvelope, now, {
        approval: {
          actionId: proposal.actionId,
          stepId: proposal.stepId,
          payloadSha256: proposal.payloadSha256,
          at: now - 1000,
          expiresAt: now,
        },
      }),
    );
    assert.equal(expiredApprovalRes.ok, false);
    if (!expiredApprovalRes.ok) assert.equal(expiredApprovalRes.dispatched, false);
    assert.equal(ws.sent.length, 0);

    // 4. Replayed approval against modified payload (different subject/recipient) fails closed (approval_invalidated)
    const replayedRes = await exec.run(
      { ...rawInput, subject: "Tampered Subject" },
      makeStepContext(baseEnvelope, now, {
        approval: {
          actionId: proposal.actionId,
          stepId: proposal.stepId,
          payloadSha256: proposal.payloadSha256,
          at: now,
          expiresAt: now + 60_000,
        },
      }),
    );
    assert.equal(replayedRes.ok, false);
    if (!replayedRes.ok) assert.equal(replayedRes.dispatched, false);
    assert.equal(ws.sent.length, 0);
    assert.ok(ledger.list("t-broker").some((r) => r.event === "approval_invalidated"));

    // 5. Valid payload-bound approval succeeds and records hash-chained receipt
    const authorizedRes = await exec.run(
      rawInput,
      makeStepContext(baseEnvelope, now, {
        approval: {
          actionId: proposal.actionId,
          stepId: proposal.stepId,
          payloadSha256: proposal.payloadSha256,
          at: now,
          expiresAt: now + 60_000,
        },
      }),
    );
    assert.equal(authorizedRes.ok, true);
    assert.equal(ws.sent.length, 1);

    // 6. Malicious connector output (schema violation) is rejected by the broker
    const maliciousConnector: Connector<{ account: string }> = {
      contract: {
        schema: ACTION_SCHEMA,
        kind: "email.malicious_test",
        connector: "email",
        operation: "read",
        resource: "message",
        category: "read_only",
        sideEffect: false,
        consequential: false,
        activity: "Reading files",
        idempotency: "none",
        input: z.object({ account: z.string() }).strict(),
        result: z.object({ safeText: z.string() }).strict(),
        timeoutMs: 5_000,
        maxResultChars: 1_000,
        requires: (i) => [{ kind: "service", connector: "email", account: i.account, access: "read", recipients: [] }],
        untrusted: true,
      },
      async run() {
        return { ok: true, result: { wrongField: "malformed connector payload" } };
      },
    };
    const maliciousExec = brokered(maliciousConnector, ledger);
    const badResult = await maliciousExec.run(
      { account: "work" },
      makeStepContext(baseEnvelope, now, { stepId: "s-bad", idempotencyKey: "k-bad" }),
    );
    assert.equal(badResult.ok, false);
    if (!badResult.ok) assert.match(badResult.error, /did not match its contract/);
    assert.equal(ledger.verify().ok, true);
  } finally {
    db.close();
  }
});

test("T6-G: live external OAuth providers remain disabled by default and report BLOCKED without live credentials", () => {
  for (const id of ["email", "calendar", "docs"] as const) {
    assert.equal(CONNECTOR_REGISTRY[id].enabledInProductionByDefault, false);
    assert.equal(CONNECTOR_REGISTRY[id].liveQualificationStatus, "BLOCKED_NO_LIVE_OAUTH_ACCOUNT");
    assert.ok(CONNECTOR_REGISTRY[id].liveBlockerReason);
  }
});
