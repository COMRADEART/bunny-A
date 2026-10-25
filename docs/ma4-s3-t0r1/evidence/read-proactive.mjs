import { readFileSync } from "node:fs";
const creds = JSON.parse(readFileSync("C:/Users/allam/AppData/Local/Bunny-S3T0R1-Install/state/credentials/credentials.json", "utf8"));
const res = await fetch(`http://127.0.0.1:${creds.port}/state`, { headers: { authorization: `Bearer ${creds.token}` } });
const body = await res.json();
const p = body.proactive ?? {};
const monitors = (p.monitors ?? p.items ?? []).map((m) => ({
  id: m.id,
  title: m.title,
  state: m.state ?? m.status,
  last: m.lastCheck ?? m.lastCheckedAt ?? m.checkedAt ?? null,
  detail: m.detail ?? m.lastResult ?? m.reading ?? null,
}));
console.log(JSON.stringify({
  keys: Object.keys(p),
  away: p.away ?? null,
  notices: (p.notices ?? p.notifications ?? []).length,
  monitors,
}, null, 2));
