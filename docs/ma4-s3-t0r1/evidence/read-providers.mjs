import { readFileSync } from "node:fs";
const creds = JSON.parse(readFileSync("C:/Users/allam/AppData/Local/Bunny-S3T0R1-Install/state/credentials/credentials.json", "utf8"));
const res = await fetch(`http://127.0.0.1:${creds.port}/state`, {
  headers: { authorization: `Bearer ${creds.token}` },
});
const body = await res.json();
const providers = (body.providers ?? body.snapshot?.providers ?? []).map((p) => ({
  id: p.id,
  availability: p.availability,
  installed: p.installed,
  models: p.models,
  remoteModels: p.remoteModels,
  detail: p.detail,
  evidence: p.evidence,
}));
const tasks = (body.tasks ?? []).map((t) => ({
  id: t.id,
  state: t.state,
  title: t.title,
  provider: t.provider,
  model: t.model,
  stopReason: t.stopReason ?? t.stop_reason ?? null,
  error: typeof t.error === "string" ? t.error.slice(0, 180) : null,
}));
console.log(JSON.stringify({ status: res.status, keys: Object.keys(body), providers, taskCount: tasks.length, tasks }, null, 2));
