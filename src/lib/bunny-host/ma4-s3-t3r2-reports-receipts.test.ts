import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, utimesSync } from "node:fs";
import { join } from "node:path";
import {
  executeDeterministicTest,
  verifyTestReceipt,
  sha256,
} from "./ma4/test-runner.server.ts";

const TEST_BASE = join(process.cwd(), ".tmp-t3r2-reports");

function createRig() {
  mkdirSync(TEST_BASE, { recursive: true });
  const dir = mkdtempSync(join(TEST_BASE, "rep-rig-"));
  const projectDir = join(dir, "proj");
  mkdirSync(projectDir, { recursive: true });

  const passingScript = join(projectDir, "test-with-report.test.js");
  writeFileSync(
    passingScript,
    `import fs from 'node:fs';
     fs.writeFileSync('report.json', JSON.stringify({ passed: 5, failed: 0 }));
     process.exit(0);`,
  );

  return {
    dir,
    projectDir,
    passingScript,
    close: () => {
      try { rmSync(dir, { recursive: true, force: true }); } catch {}
    },
  };
}

test("T3R2-P4.1: Report file escaping root directory via traversal is strictly refused", async () => {
  const rig = createRig();
  try {
    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "test-with-report.test.js",
      reportFile: "../../outside-report.json",
    });

    assert.equal(result.launched, false);
    assert.equal(result.terminalState, "refused");
    assert.match(result.reason, /Report path invalid.*traversal/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P4.2: Stale report file inherited from earlier runs fails closed", async () => {
  const rig = createRig();
  try {
    const reportPath = join(rig.projectDir, "report.json");
    // Write an old report file beforehand
    writeFileSync(reportPath, JSON.stringify({ passed: 10, failed: 0 }));
    // Set old mtime in the past
    const past = new Date(Date.now() - 60_000);
    utimesSync(reportPath, past, past);

    // Test script exits 0 WITHOUT updating report.json
    const noUpdateScript = join(rig.projectDir, "no-update.test.js");
    writeFileSync(noUpdateScript, "process.exit(0);");

    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "no-update.test.js",
      reportFile: "report.json",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false, "Stale report must fail closed");
    assert.equal(result.reportMissing, true);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /stale evidence/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P4.3: Empty report file (0 bytes) fails closed", async () => {
  const rig = createRig();
  try {
    const emptyReportScript = join(rig.projectDir, "empty-report.test.js");
    writeFileSync(
      emptyReportScript,
      `import fs from 'node:fs';
       fs.writeFileSync('report.json', '');
       process.exit(0);`,
    );

    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "empty-report.test.js",
      reportFile: "report.json",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false);
    assert.equal(result.reportMissing, true);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /empty \(0 bytes\)/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P4.4: Malformed JSON report fails closed", async () => {
  const rig = createRig();
  try {
    const malformedScript = join(rig.projectDir, "malformed.test.js");
    writeFileSync(
      malformedScript,
      `import fs from 'node:fs';
       fs.writeFileSync('report.json', '{ "passed": 1, corrupt json');
       process.exit(0);`,
    );

    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "malformed.test.js",
      reportFile: "report.json",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false);
    assert.equal(result.reportMissing, true);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /parse test report JSON/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P4.5: Report indicating failed tests fails closed", async () => {
  const rig = createRig();
  try {
    const failReportScript = join(rig.projectDir, "fail-report.test.js");
    writeFileSync(
      failReportScript,
      `import fs from 'node:fs';
       fs.writeFileSync('report.json', JSON.stringify({ passed: 4, failed: 1 }));
       process.exit(0);`,
    );

    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "fail-report.test.js",
      reportFile: "report.json",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /failed test/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P4.6: Report exceeding maximum size limit (1 MiB) fails closed", async () => {
  const rig = createRig();
  try {
    const hugeReportScript = join(rig.projectDir, "huge-report.test.js");
    writeFileSync(
      hugeReportScript,
      `import fs from 'node:fs';
       const largeBuffer = Buffer.alloc(1024 * 1024 + 1024, 'a');
       fs.writeFileSync('report.json', largeBuffer);
       process.exit(0);`,
    );

    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "huge-report.test.js",
      reportFile: "report.json",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false);
    assert.equal(result.reportMissing, true);
    assert.equal(result.receipt, null);
    assert.match(result.reason, /exceeds maximum limit/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P5.1: Fresh, valid report successfully cryptographically bound to receipt", async () => {
  const rig = createRig();
  try {
    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "test-with-report.test.js",
      reportFile: "report.json",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, true);
    assert.equal(result.exitCode, 0);
    assert.ok(result.receipt !== null);
    assert.ok(result.reportSha256 !== null);
    assert.ok(result.receipt.includes(result.reportSha256));
  } finally {
    rig.close();
  }
});

test("T3R2-P5.2: Zero discovered/executed tests cannot produce PASS receipt when assertions required", async () => {
  const rig = createRig();
  try {
    const zeroTestScript = join(rig.projectDir, "zero.test.js");
    writeFileSync(
      zeroTestScript,
      `// Empty file without any test cases
       console.log('ℹ tests 0');
       console.log('ℹ pass 0');
       process.exit(0);`,
    );

    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "zero.test.js",
      requireAssertions: true,
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false, "Zero assertions must fail closed when assertions required");
    assert.equal(result.receipt, null);
    assert.match(result.reason, /zero assertions/i);
  } finally {
    rig.close();
  }
});

test("T3R2-P5.3: Modified report hash invalidates verification receipt", () => {
  const receipt = "receipt:test-exec:test-123:stdoutHash:originalReportHash";
  const verifiedBefore = verifyTestReceipt({
    receipt,
    recordedReportHash: "originalReportHash",
    currentReportHash: "originalReportHash",
  });
  assert.equal(verifiedBefore.verified, true);

  const verifiedAfter = verifyTestReceipt({
    receipt,
    recordedReportHash: "originalReportHash",
    currentReportHash: "tamperedReportHash",
  });
  assert.equal(verifiedAfter.verified, false);
  assert.match(verifiedAfter.reason, /Receipt report version is stale/i);
});

test("T3R2-P5.4: Process crashing cannot issue PASS receipt regardless of stdout contents", async () => {
  const rig = createRig();
  try {
    const deceptiveCrash = join(rig.projectDir, "deceptive-crash.test.js");
    writeFileSync(
      deceptiveCrash,
      `console.log('✔ All 100 tests passed successfully!');
       console.log('ℹ tests 100');
       console.log('ℹ pass 100');
       process.abort();`,
    );

    const result = await executeDeterministicTest({
      rootPath: rig.projectDir,
      testFile: "deceptive-crash.test.js",
    });

    assert.equal(result.launched, true);
    assert.equal(result.pass, false);
    assert.equal(result.receipt, null);
  } finally {
    rig.close();
  }
});
