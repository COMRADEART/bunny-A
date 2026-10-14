import test from "node:test";
import assert from "node:assert/strict";
import { GUIDED_INSTALL, HARNESS_IDS, harnessExecutables, judgeHarness } from "./harnesses.ts";

test("T13.3 E the capability ladder never treats a binary's presence as inference", () => {
  const found = { path: "C:\\tools\\claude.exe", version: "2.1.299 (Claude Code)", runs: true, detail: "ok" };
  assert.equal(judgeHarness({ path: null, version: null, runs: null, detail: "No claude was found on this PC." }, true, 3).verdict, "not_found");
  assert.equal(judgeHarness({ ...found, runs: false, version: null }, true, 5).verdict, "found_not_running", "completed history never rescues a harness that does not run");
  assert.equal(judgeHarness(found, false, 5).verdict, "runs_not_signed_in");
  const untested = judgeHarness(found, true, 0);
  assert.equal(untested.verdict, "runs");
  assert.match(untested.detail, /inference is not demonstrated/);
  assert.equal(judgeHarness(found, null, 0).verdict, "runs", "unknown sign-in is not a refusal and not a pass");
  assert.equal(judgeHarness(found, true, 2).verdict, "task_completed");
});

test("T13.3 E guided installs are pinned with integrity, or offer no command at all", () => {
  assert.ok(!HARNESS_IDS.includes("openrouter"), "an API without a client program is not a harness");
  assert.deepEqual(harnessExecutables("copilot"), ["copilot"], "the GitHub CLI is not the Copilot harness");
  for (const id of HARNESS_IDS) {
    const guide = GUIDED_INSTALL[id];
    assert.ok(/^https:\/\//.test(guide.source), id);
    if (guide.kind === "npm" || guide.kind === "winget") {
      assert.ok(guide.version && guide.install?.includes(guide.version), `${id} pins its version`);
      assert.match(guide.integrity ?? "", /^(sha512-[A-Za-z0-9+/=]{80,}|sha256:[a-f0-9]{64})$/, `${id} has an integrity hash`);
      assert.ok(guide.uninstall, id);
    } else assert.equal(guide.install, null, `${id} has no pinned source, so Bunny shows no command`);
    assert.doesNotMatch(`${guide.install ?? ""} ${guide.uninstall ?? ""}`, /\b(iex|irm|curl|wget|Invoke-Expression)\b|\|\s*(sh|bash)\b/, `${id} never pipes a downloaded script`);
  }
});
