#!/usr/bin/env node
// Prints one `&&` stage of the package.json `npm test` command, so CI runs each stage exactly as `npm test` does.
//   node scripts/ci/test-stage.mjs <index> [extra node --test flags...]
// Stage 1 (index 0) drops scripts/voice-worker.test.mjs, which needs the operator-staged whisper runtime (a LOCAL gate).
// Extra flags go right after `--test`, so the files, their order and the concurrency stay untouched.
import { readdirSync, readFileSync } from "node:fs";

export function testStage(script, index, extra = [], scripts = []) {
  const stages = script.split(" && ");
  let stage = stages[index];
  if (stage === undefined) throw new Error(`npm test has ${stages.length} stages; no stage ${index}`);
  if (stage.includes("scripts/*.test.mjs")) stage = stage.replace("scripts/*.test.mjs", scripts.filter((n) => n !== "voice-worker.test.mjs").map((n) => `scripts/${n}`).join(" "));
  if (extra.length && !/ --test( |$)/.test(stage)) throw new Error(`stage ${index} is not a node --test command: ${stage}`);
  return extra.length ? stage.replace(/ --test( |$)/, ` --test ${extra.join(" ")}$1`) : stage;
}

if (process.argv[1]?.endsWith("test-stage.mjs")) {
  const [index, ...extra] = process.argv.slice(2);
  const script = JSON.parse(readFileSync("package.json", "utf8")).scripts.test;
  const scripts = readdirSync("scripts").filter((n) => n.endsWith(".test.mjs")).sort();
  console.log(testStage(script, Number(index), extra, scripts));
}
