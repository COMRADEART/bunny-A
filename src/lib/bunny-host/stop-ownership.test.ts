import test from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { sameProcessIdentity, survivors } from "./process-tree.server.ts";
const exec = promisify(execFile);
for (const mode of ["inspection-failure", "reuse", "positive", "before-failure", "unknown-birth", "image-change", "final-failure", "kill-failure", "native-reuse"]) {
  test(`IR-H1 real TaskManager Stop: ${mode}`, { timeout: 30000 }, async () => {
    const result = await exec(process.execPath, ["--experimental-strip-types", "--experimental-test-module-mocks", fileURLToPath(new URL("../../../scripts/ir-h1-stop-fixture.mjs", import.meta.url)), mode], { windowsHide: true, timeout: 25000 });
    assert.match(result.stdout, /IR_H1_RESULT/);
  });
}
test("IR-H1 birth time and current image are mandatory for PID identity", () => {
  const row = { pid: 42, ppid: 1, name: "node.exe", createdAt: 1234 };
  assert.equal(sameProcessIdentity(row, { ...row }), true);
  for (const changed of [{ ...row, createdAt: null }, { ...row, createdAt: 5678 }, { ...row, name: "other.exe" }]) assert.equal(sameProcessIdentity(row, changed), false);
  assert.deepEqual(survivors([{ ...row, createdAt: null }], [{ ...row, createdAt: null }]), []);
});
