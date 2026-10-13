import { startHost } from "./host.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const h = await startHost(43864, "probe-conc"); const h0 = h;
for (const f of ["seed.txt", "seed2.txt", "t.test.mjs"]) writeFileSync(join(h.workspace, f), f === "t.test.mjs" ? "import test from 'node:test';\ntest('x', async () => { await new Promise((r) => setTimeout(r, 2000)); });\n" : "seed");
for (let i = 1; i <= 6; i++) writeFileSync(join(h.workspace, `r${i}.txt`), `n${i}`);
await h.api("mission.configure", { enabled: true });
const step = (role, action, params, { dependsOn = [], access = "read", verify = null } = {}) => ({ role, objective: role, access, executor: { kind: "capability", action, params }, dependsOn, verification: verify ? [verify] : [] });
const ex = (p) => ({ kind: "capability", action: "filesystem.exists", params: { path: p }, expect: { field: "exists", equals: true } });
const specs = {
  A: [step("List", "filesystem.list", { path: "." }), ...[1, 2, 3, 4, 5, 6].map((i) => step(`Read ${i}`, "filesystem.read", { path: `r${i}.txt` }, { dependsOn: [i - 1] }))],
  B: [step("Write", "filesystem.write", { path: "out.txt", content: "hello", overwrite: true }, { access: "write", verify: { kind: "capability", action: "filesystem.compare", params: { path: "out.txt", content: "hello" }, expect: { field: "matches", equals: true } } })],
  C: [step("Run", "terminal.exec", { command: "node --test", args: ["t.test.mjs"] }, { verify: ex("t.test.mjs") })],
  D: [step("Read seed", "filesystem.read", { path: "seed.txt" }, { verify: ex("seed.txt") }), step("Delete seed", "filesystem.delete", { path: "seed.txt" }, { dependsOn: [0], access: "write" })],
};
const ids = {};
for (const [k, steps] of Object.entries(specs)) { const c = await h.api("agent.create", { name: k, objective: k, steps }); ids[k] = c.body.snapshot.agents.agents.find((r) => r.name === k).id; }
for (const k of (process.env.ORDER ?? "ABCD").split("")) { const s = await h.api("agent.start", { id: ids[k] }); console.log("start", k, s.status, s.body.error ?? "ok"); }
await new Promise((r) => setTimeout(r, 3000));
for (const [k, id] of Object.entries(ids)) { const st = await h.state(); console.log("state", k, st.agents.agents.find((a) => a.id === id)?.state); }
await h.stop(); process.exit(0);
