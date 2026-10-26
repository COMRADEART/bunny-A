import test from "node:test";
import assert from "node:assert/strict";
import { runMultiAgentReliabilitySuite } from "./multi-agent-reliability.server.ts";
import type { ModelCall } from "./coding-workflow.server.ts";

test("multi-agent reliability: qualifies all 10 real agent interaction and failure scenarios", async () => {
  const mockCall: ModelCall = async (req) => {
    if (req.signal.aborted) {
      return { ok: false, error: "Aborted", stopped: true, durationMs: 1 };
    }

    if (req.prompt.includes("32768")) {
      return { ok: true, text: "The maximum context is 32768 tokens.", servedModel: req.model, durationMs: 5 };
    }
    if (req.prompt.includes("auth.ts and router.ts")) {
      return { ok: true, text: "1. Parse auth. 2. Verify router.", servedModel: req.model, durationMs: 5 };
    }
    if (req.prompt.includes("AUTH_OK and ROUTE_OK")) {
      return { ok: true, text: "AUTH_OK and ROUTE_OK verified.", servedModel: req.model, durationMs: 5 };
    }
    if (req.prompt.includes("State VERIFIED")) {
      return { ok: true, text: "VERIFIED without defects.", servedModel: req.model, durationMs: 5 };
    }
    if (req.prompt.includes("assert.equal(add(2, 2), 5)")) {
      return { ok: true, text: "Defect in add function: returns 5 instead of expected 4 sum.", servedModel: req.model, durationMs: 5 };
    }
    if (req.prompt.includes("Fix defect in function add")) {
      return { ok: true, text: "function add(a, b) { return a + b; }", servedModel: req.model, durationMs: 5 };
    }
    if (req.prompt.includes("500-word essay")) {
      // Cancellation scenario: wait for abort signal
      await new Promise((r) => setTimeout(r, 100));
      if (req.signal.aborted) {
        return { ok: false, error: "Aborted by signal", stopped: true, durationMs: 50 };
      }
    }
    return { ok: true, text: "OK", servedModel: req.model, durationMs: 2 };
  };

  const report = await runMultiAgentReliabilitySuite({
    call: mockCall,
    model: "mock:7b",
  });

  assert.equal(report.scenarios.length, 10, "Must qualify exactly 10 multi-agent scenarios");
  assert.equal(report.allPassed, true, "All 10 scenarios must pass");

  // Verify explicit roles and receipts
  const scen2 = report.scenarios.find(s => s.id === 2)!;
  assert.deepEqual(scen2.rolesInvoked, ["Planner", "Worker", "Reviewer"]);
  assert.equal(scen2.handoffReceipts.length, 3);

  const scen6 = report.scenarios.find(s => s.id === 6)!;
  assert.equal(scen6.passed, true);

  const scen9 = report.scenarios.find(s => s.id === 9)!;
  assert.equal(scen9.passed, true);
});
