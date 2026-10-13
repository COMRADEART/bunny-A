// Re-summarize recorded live sessions with the current summarize() (one receipt per onset, audible-only latency).
// The recorded session JSON is never rewritten; the result goes to <name>.reanalysis.json next to it.
// Usage: node --experimental-strip-types reanalyze.mjs <session.json>...
import { readFileSync, writeFileSync } from "node:fs";
import { summarize } from "./lib.mjs";

for (const file of process.argv.slice(2)) {
  const result = JSON.parse(readFileSync(file, "utf8"));
  const tr = (result.trials ?? []).filter((t) => !t.error);
  const b = tr.map((t) => t.bargeIn).filter(Boolean);
  const summary = summarize(result, tr, b, null);
  const out = file.replace(/\.json$/, ".reanalysis.json");
  writeFileSync(out, JSON.stringify({ source: file, recordedSummary: result.summary ?? null, summary }, null, 2));
  console.log(file, JSON.stringify(summary));
}
