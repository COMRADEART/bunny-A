// M-A-3 T12: starts one more real Team Mission on an already-running DISPOSABLE endurance Host (found by its temp
// credential file), so background Agent work continues during the voice endurance session.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startTeam } from "./team.mjs";
const dir = readdirSync(tmpdir()).filter((n) => n.startsWith("bunny-t12-endurance-")).map((n) => join(tmpdir(), n)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const c = JSON.parse(readFileSync(join(dir, "island-credentials.json"), "utf8"));
if (!/^438\d\d$/.test(String(c.port))) throw new Error("not a disposable Host");
const H = { authorization: `Bearer ${c.token}`, "content-type": "application/json" };
const host = {
  command: async (action, data = {}) => { const r = await fetch(`http://127.0.0.1:${c.port}/command`, { method: "POST", headers: H, body: JSON.stringify({ action, data }) }); return { status: r.status, body: await r.json().catch(() => ({})) }; },
  state: async () => (await fetch(`http://127.0.0.1:${c.port}/state`, { headers: H })).json(),
};
const s = await host.state();
host.projectId = (s.projects ?? s.workspaces?.projects ?? []).find?.((p) => /T12 offline dashboard/.test(p.name))?.id;
if (!host.projectId) { const r = await host.command("project.list", {}); host.projectId = (r.body?.data ?? []).find((p) => /T12 offline dashboard/.test(p.name))?.id; }
const n = Number(process.argv[2] ?? 3);
const spec = { name: `Inventory categories team ${n}`, outputDir: `inventory-categories-${n}`, objective: "Build an offline page that groups data/inventory.csv items by category, with a Markdown restock note.",
  requirements: [{ id: "R1", text: "The page has a categories section", check: { kind: "html_id", value: "categories" } }, { id: "R2", text: "Every item is shown", check: { kind: "dataset_values" } }, { id: "R3", text: "The page works offline", check: { kind: "no_external_resources" } }, { id: "R4", text: "The note has a Restock section", check: { kind: "markdown_heading", value: "Restock" } }] };
const team = await startTeam(host, null, spec, (k, d) => console.log(k, JSON.stringify(d)));
console.log("started", JSON.stringify({ missionId: team.missionId, projectId: host.projectId }));
