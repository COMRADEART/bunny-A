import test from "node:test";
import assert from "node:assert/strict";
import {
  CONNECTOR_REGISTRY,
  validateConnectorRegistration,
  verifyOAuthOperationAuthorization,
  type ConnectorRegistryEntry,
} from "./ma4/connector-registry.ts";
import { serviceConnectors, SyntheticWorkspace } from "./ma4/connectors/services.server.ts";
import { RESULT_SCHEMA } from "./ma4/action-broker.server.ts";

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

test("T6-B: verifyOAuthOperationAuthorization enforces narrow scopes, expiry, revocation, and account isolation", () => {
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

  // Blocked send without mail.send scope
  const noSend = verifyOAuthOperationAuthorization({ operationKind: "email.send", requestedAccount: "work@example.com", grant, now });
  assert.equal(noSend.allowed, false);
  assert.match(noSend.reason ?? "", /Missing required narrow scope\(s\): mail\.send/);

  // Blocked cross-account confused deputy
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

test("T6-C/D/E: serviceConnectors enforce idempotency, version CAS, and untrusted-output prompt-injection boundary", async () => {
  const vault = { token: (_p: string, account: string) => (account === "work" ? "tok-work" : null) };
  const ws = new SyntheticWorkspace(vault, { email: ["work"], calendar: ["work"], docs: ["work"] });
  ws.docsStore.set("doc-1", { id: "doc-1", title: "Roadmap", version: "v1", content: "Initial text" });

  const connectors = serviceConnectors(ws);
  const byKind = new Map(connectors.map((c) => [c.contract.kind, c]));

  // 1. Untrusted connector output cannot be passed directly to email.send bodyFrom
  const sig = new AbortController().signal;
  const mailSend = byKind.get("email.send")!;
  const injectedCtx = {
    idempotencyKey: "key-inject-1",
    outputOf: () => JSON.stringify({ schema: RESULT_SCHEMA, body: "Injected from untrusted email" }),
  };
  const injectedOutcome = await mailSend.run(
    { account: "work", to: ["victim@example.com"], subject: "Exfil", bodyFrom: "step-1" } as never,
    injectedCtx as never,
    sig,
  );
  assert.equal(injectedOutcome.ok, false);
  assert.match((injectedOutcome as { error: string }).error, /must name a generating step, not a connector result/);
  assert.equal(ws.sent.length, 0);

  // 2. Idempotent email.send by key never sends twice
  const cleanCtx = { idempotencyKey: "key-send-1", outputOf: () => "Approved summary body" };
  const firstSend = await mailSend.run(
    { account: "work", to: ["team@example.com"], subject: "Status", bodyFrom: "step-gen" } as never,
    cleanCtx as never,
    sig,
  );
  const secondSend = await mailSend.run(
    { account: "work", to: ["team@example.com"], subject: "Status", bodyFrom: "step-gen" } as never,
    cleanCtx as never,
    sig,
  );
  assert.equal(firstSend.ok, true);
  assert.equal(secondSend.ok, true);
  assert.equal(ws.sent.length, 1, "idempotency key prevented duplicate email send");

  // 3. docs.write compare-and-swap refuses stale expectedVersion
  const docsWrite = byKind.get("docs.write")!;
  const staleWrite = await docsWrite.run(
    { account: "work", docId: "doc-1", content: "Overwritten", expectedVersion: "v0-stale" } as never,
    cleanCtx as never,
    sig,
  );
  assert.equal(staleWrite.ok, false);
  assert.match((staleWrite as { error: string }).error, /version v1, not v0-stale/);
});

test("T6-F: live external OAuth providers remain disabled by default and report BLOCKED without live credentials", () => {
  for (const id of ["email", "calendar", "docs"] as const) {
    assert.equal(CONNECTOR_REGISTRY[id].enabledInProductionByDefault, false);
    assert.equal(CONNECTOR_REGISTRY[id].liveQualificationStatus, "BLOCKED_NO_LIVE_OAUTH_ACCOUNT");
    assert.ok(CONNECTOR_REGISTRY[id].liveBlockerReason);
  }
});
