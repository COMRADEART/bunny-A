/**
 * Offline T1R tasks. Classification is recorded and is never the success bit.
 * Holdout lives in holdout.json. This file does not teach the router those ids.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  assessReplan,
  classifyTask,
  completionClaim,
  deterministicCheck,
  selectExecutionModel,
} from "../../src/lib/bunny-host/ma4/s3t1.ts";

const here = fileURLToPath(new URL(".", import.meta.url));

/** @param {string} name @returns {{ tasks: any[] }} */
export function loadSet(name) {
  return JSON.parse(readFileSync(join(here, name), "utf8"));
}

/** @param {string} text */
function sha(text) {
  return createHash("sha256").update(text).digest("hex");
}

/** @param {any} task @param {string} root */
async function runOne(task, root) {
  const classification = classifyTask(task.prompt);
  const base = {
    id: task.id,
    set: task.set,
    complexity: task.complexity,
    classified: classification.complexity,
    classificationMatched: classification.complexity === task.complexity,
    model: null,
    agents: classification.roles,
    modelCalls: classification.resource.modelCalls,
    toolResult: null,
    approvalsRequired: task.complexity === "C3" ? 1 : 0,
    approvalsClearedOnReplan: false,
    functionalCorrect: false,
    verification: "not_requested",
    outcome: "failed",
    failure: null,
  };
  if (task.complexity === "C0") {
    return { ...base, functionalCorrect: null, verification: "unavailable", outcome: "not-tested-offline", failure: "Direct answers need the pinned local model. Classification was not scored." };
  }
  if (task.complexity === "C1") {
    const file = join(root, `${task.id}.txt`);
    await writeFile(file, task.bytes);
    const actual = sha(await readFile(file, "utf8"));
    const check = deterministicCheck({ kind: "file", expectedHash: task.sha256, actualHash: actual });
    const claim = completionClaim({ executed: true, output: true, verification: check.state });
    return { ...base, modelCalls: 0, toolResult: actual, functionalCorrect: actual === task.sha256, verification: check.state, outcome: claim.verified ? "verified" : "failed", failure: claim.verified ? null : check.detail };
  }
  if (task.complexity === "C2") {
    const source = join(root, `${task.id}-src.txt`);
    const copy = join(root, `${task.id}-copy.txt`);
    await writeFile(source, task.bytes);
    await writeFile(copy, await readFile(source));
    const actual = sha(await readFile(copy, "utf8"));
    const check = deterministicCheck({ kind: "file", expectedHash: task.sha256, actualHash: actual });
    const claim = completionClaim({ executed: true, output: true, verification: check.state });
    return { ...base, modelCalls: 0, toolResult: actual, functionalCorrect: actual === task.sha256, verification: check.state, outcome: claim.verified ? "verified" : "failed", failure: claim.verified ? null : check.detail };
  }
  if (task.control === "uncertain") {
    const check = deterministicCheck({ kind: "external-write", observed: "uncertain" });
    const claim = completionClaim({ executed: true, output: true, verification: check.state });
    return { ...base, toolResult: "unconfirmed", functionalCorrect: false, verification: check.state, outcome: "uncertain", failure: check.detail, verifiedClaim: claim.verified };
  }
  if (task.control === "bad-exit") {
    const child = spawnSync(process.execPath, ["-e", "process.exit(3)"], { cwd: root });
    const check = deterministicCheck({ kind: "process", exitCode: child.status });
    return { ...base, toolResult: child.status, functionalCorrect: false, verification: check.state, outcome: "failed", failure: check.detail };
  }
  if (!task.approved) {
    const file = join(root, `${task.id}.txt`);
    await writeFile(file, task.bytes);
    const before = sha(await readFile(file, "utf8"));
    const replan = assessReplan({ failure: "approval missing", insideEnvelope: true, retriesLeft: 1, consequentialOutcomeUnknown: false });
    return {
      ...base,
      toolResult: before,
      functionalCorrect: before === task.sha256,
      verification: "unavailable",
      outcome: "refused",
      failure: "Consequential delete was not run. The owner has to choose it.",
      approvalsClearedOnReplan: replan.clearApprovals,
    };
  }
  const child = spawnSync(process.execPath, ["-e", "process.exit(0)"], { cwd: root });
  const check = deterministicCheck({ kind: "process", exitCode: child.status });
  const claim = completionClaim({ executed: true, output: true, verification: check.state });
  return { ...base, toolResult: child.status, functionalCorrect: child.status === 0, verification: check.state, outcome: claim.verified ? "verified" : "failed", failure: claim.verified ? null : check.detail };
}

export async function runOffline() {
  const development = loadSet("development.json").tasks.map((task) => ({ ...task, set: "development" }));
  const holdout = loadSet("holdout.json").tasks.map((task) => ({ ...task, set: "holdout" }));
  const root = await mkdtemp(join(tmpdir(), "bunny-t1r-"));
  try {
    /** @type {any[]} */
    const rows = [];
    for (const task of [...development, ...holdout]) rows.push(await runOne(task, root));
    const preference = selectExecutionModel({
      mode: "PREFERRED",
      preference: { id: "missing:7b" },
      pool: [
        { provider: "ollama", id: "huihui_ai/qwen2.5-abliterate:7b", digest: "sha256:pinned", local: true, authorized: true, workingMemoryBytes: 4_000_000_000 },
        { provider: "ollama", id: "deepseek-v4.1-flash:cloud", digest: "sha256:cloud", local: false, authorized: true, workingMemoryBytes: 1 },
      ],
      allowAuthorizedAlternate: true,
    });
    const scored = rows.filter((row) => row.outcome !== "not-tested-offline" && row.complexity !== "C3");
    const verified = scored.filter((row) => row.outcome === "verified").length;
    return {
      classificationCountedAsSuccess: false,
      rows,
      preferenceOfferedChoice: preference.ok === false && preference.choices.length === 1,
      preferenceSelectedNothing: preference.ok === false,
      counts: count(rows),
      verifiedCompletion: scored.length ? verified / scored.length : null,
    };
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

/** @param {any[]} rows @returns {Record<string, number>} */
function count(rows) {
  /** @type {Record<string, number>} */
  const counts = {};
  for (const row of rows) {
    const key = `${row.set}:${row.complexity}`;
    counts[key] = (counts[key] ?? 0) + 1;
  }
  return counts;
}

export function policySourceContainsHoldoutIds() {
  const source = readFileSync(fileURLToPath(new URL("../../src/lib/bunny-host/ma4/s3t1.ts", import.meta.url)), "utf8");
  const holdout = loadSet("holdout.json");
  return holdout.tasks.filter((/** @type {any} */ task) => source.includes(task.id)).map((/** @type {any} */ task) => task.id);
}
