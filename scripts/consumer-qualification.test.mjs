import test from "node:test";
import assert from "node:assert/strict";
import { runQualification, unobservedPhysicalGates } from "./ma4-s3-t5/consumer-qualification.mjs";

test("preset success claims cannot qualify unobserved native or physical gates", () => {
  const misleading = { verified: true, pass: true, status: "PASS", native: true, phone: true, voice: true, signed: true };
  for (const gate of unobservedPhysicalGates(misleading)) assert.equal(gate.status, "BLOCKED");
  const report = runQualification();
  assert.equal(report.overallStatus, "INCOMPLETE");
  assert.ok(report.results.filter(x => x.status === "PASS").every(x => x.tier === "unit_contract"));
});
