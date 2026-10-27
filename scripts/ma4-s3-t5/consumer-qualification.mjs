import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { GetBunnyPlacement, GetBunnyIndicatorLayout } from "./island-placement-shim.mjs";

// This executable makes no claim about native interaction or physical equipment.
// Those gates require separate, independently reviewed execution evidence.
export function unobservedPhysicalGates(_untrustedClaims = {}) {
  return [
    { id: "native-desktop", tier: "native_gui_interaction", status: "BLOCKED", reason: "No interactive Windows session was exercised by this runner." },
    { id: "physical-voice", tier: "physical_audio", status: "BLOCKED", reason: "No physical microphone and speaker session was exercised by this runner." },
    { id: "physical-android", tier: "physical_android", status: "BLOCKED", reason: "No physical phone pairing was exercised by this runner." },
    { id: "distribution-signing", tier: "release_signing", status: "BLOCKED", reason: "No distribution signing or installation was exercised by this runner." },
  ];
}

export function geometryContract() {
  const workArea = { Left: 0, Top: 0, Width: 2133, Height: 1333 };
  const size = { Width: 700, Height: 76 };
  const observations = [];
  for (const edge of ["top", "bottom", "left", "right"]) {
    const placement = GetBunnyPlacement({ Edge: edge, WorkArea: workArea, Size: size, Offset: 0.5, Margin: 4 });
    assert.ok(placement.Left >= workArea.Left && placement.Top >= workArea.Top);
    assert.ok(placement.Left + placement.Width <= workArea.Width && placement.Top + placement.Height <= workArea.Height);
    const horizontal = edge === "top" || edge === "bottom";
    assert.equal(placement.Orientation, horizontal ? "horizontal" : "vertical");
    assert.equal(placement.IndicatorSide, horizontal ? "left" : "top");
    const indicators = GetBunnyIndicatorLayout({ Placement: placement, AgentCount: 5, MaxVisible: 4 });
    assert.equal(indicators.VisibleCount, 4);
    assert.equal(indicators.OverflowCount, 1);
    assert.equal(indicators.Axis, horizontal ? "row" : "column");
    observations.push({ edge, placement, indicators });
  }
  return { id: "notch-geometry", tier: "unit_contract", status: "PASS", source: "scripts/ma4-s3-t5/island-placement-shim.mjs", acceptance: "All placements stay within the synthetic work area and indicators follow the specified axis and side.", observations };
}

export function runQualification() {
  const geometry = geometryContract();
  return {
    version: "bunny-ma4-s3-t5-consumer-qualification.v2",
    timestamp: new Date().toISOString(),
    scope: "Geometry contract execution only; no native GUI, physical device, installation or release-signing execution.",
    overallStatus: "INCOMPLETE",
    publicBetaReleaseRecommendation: "NO-GO",
    results: [geometry, ...unobservedPhysicalGates(),
      { id: "agent-workflows-a-f", tier: "host_integration", status: "NOT TESTED", reason: "This runner did not invoke the Host or a local model." },
      { id: "packaged-application", tier: "packaged_application", status: "NOT TESTED", reason: "This runner did not install or launch a packaged application." },
      { id: "accessibility", tier: "native_gui_interaction", status: "BLOCKED", reason: "Keyboard and screen-reader interaction was not performed." }],
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const report = runQualification();
  const dir = join(process.cwd(), "test-results/ma4/t5");
  mkdirSync(dir, { recursive: true });
  const output = join(dir, "consumer-qualification-report.v2.json");
  writeFileSync(output, JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${output}; geometry contract PASS, consumer release qualification INCOMPLETE.`);
}
