// Ad-hoc probe: full view of one mission (state, requests, runs) for run diagnosis.
import { getMission } from "./live-shared.ts";

const id = process.argv[2] ?? "";
if (!id) { console.error("usage: node --experimental-strip-types probe-mission.ts <mission-id-prefix-or-full>"); process.exit(1); }
const view = await getMission(id);
const requests = (view.requests ?? []).map((r) => ({
  action: r.action, resolvedAt: r.resolvedAt === null ? null : r.resolvedAt,
  decision: (r.resolution ?? null), createdAt: r.createdAt,
  batchOffer: r.batchOffer ? { target: r.batchOffer.target?.app, maxActions: r.batchOffer.maxActions, ttlMs: r.batchOffer.ttlMs } : null,
}));
const runs = (view.runs ?? []).map((r) => ({
  action: r.action, status: r.status, decisionReason: (r.decisionReason ?? "").slice(0, 90),
  summary: (r.summary ?? "").slice(0, 110), startedAt: r.startedAt ?? r.createdAt, finishedAt: r.finishedAt,
}));
const steps = (view.steps ?? []).map((s) => ({ role: s.role, state: s.state, attempts: (s.attempts ?? []).length }));
console.log(JSON.stringify({ id: view.id, state: view.state, failure: view.failure, requests, runs, steps }, null, 1));