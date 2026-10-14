import test from "node:test";
import assert from "node:assert/strict";
import { accountFacts, ACCOUNT_STATUS, BILLING_LABEL } from "./account-model.ts";
import type { ConnectionView } from "../../lib/bunny-host/connections.ts";
test("T13.2 UI [SIMULATED] sign-in, entitlement, runtime and Task eligibility remain separate facts", () => {
  const row = {
    session: "signed_in",
    entitlement: "unknown",
    tool: "ready",
    dispatch: false,
    lifecycle: "active",
    consent: { allowTasks: true },
  } as ConnectionView;
  const facts = accountFacts(row);
  assert.equal(facts[0].value, "signed in");
  assert.equal(facts[1].value, "unknown");
  assert.equal(facts[3].value, "Unavailable");
});
test("T13.2 UI [STATIC VERIFIED] payment and failure labels do not claim free access", () => {
  assert.ok(BILLING_LABEL.api_billed.includes("separately"));
  assert.equal(ACCOUNT_STATUS.reconnect_required, "Reconnect required");
  assert.equal(ACCOUNT_STATUS.unsupported, "Unsupported");
  assert.ok(!JSON.stringify(BILLING_LABEL).includes("free"));
});

test("T13.2 UI [SIMULATED] a signed-in native account with a blocked budget never claims Task eligibility", () => {
  const row = {
    session: "signed_in",
    entitlement: "plan_reported",
    tool: "ready",
    dispatch: true,
    lifecycle: "active",
    status: "budget_blocked",
    consent: { allowTasks: true },
  } as ConnectionView;
  const facts = accountFacts(row);
  assert.equal(facts[0].value, "signed in");
  assert.equal(facts[3].value, "Budget blocked");
});
