import { startHost } from "./host.mjs";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const h = await startHost(43863, "probe-d");
writeFileSync(join(h.workspace, "seed.txt"), "seed");
await h.api("mission.configure", { enabled: true });
const step = (role, action, params, { dependsOn = [], access = "read", verify = null } = {}) => ({ role, objective: role, access, executor: { kind: "capability", action, params }, dependsOn, verification: verify ? [verify] : [] });
const ex = { kind: "capability", action: "filesystem.exists", params: { path: "seed.txt" }, expect: { field: "exists", equals: true } };
for (const [name, steps] of [["plain-delete", [step("Read", "filesystem.read", { path: "seed.txt" }), step("Delete", "filesystem.delete", { path: "seed.txt" }, { dependsOn: [0], access: "write" })]], ["verify-read-then-delete", [step("Read", "filesystem.read", { path: "seed.txt" }, { verify: ex }), step("Delete", "filesystem.delete", { path: "seed.txt" }, { dependsOn: [0], access: "write" })]]]) {
  const c = await h.api("agent.create", { name, objective: name, steps });
  const id = c.body.snapshot.agents.agents.find((r) => r.name === name).id;
  const s = await h.api("agent.start", { id });
  console.log(name, "create", c.status, "start", s.status, JSON.stringify(s.body).slice(0, 300));
  await new Promise((r) => setTimeout(r, 1500));
  const st = await h.state();
  console.log(" state", st.agents.agents.find((a) => a.id === id)?.state, JSON.stringify(st.agents.agents.find((a) => a.id === id)?.failure));
}
console.log("HOSTLOG", h.log().slice(-1200));
await h.stop();
process.exit(0);
