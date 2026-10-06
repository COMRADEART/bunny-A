// Ad-hoc probe: current nonterminal missions and the states of the newest ones.
import { getState } from "./live-shared.ts";

const state = await getState();
const all = state.missions?.missions ?? [];
const nonterminal = all.filter((x) => !["completed", "failed", "stopped"].includes(x.state));
console.log("nonterminal:", JSON.stringify(nonterminal.map((x) => `${x.id.slice(0, 8)}:${x.state}`)));
const newest = all.slice(-4);
for (const m of newest) {
  console.log(JSON.stringify({ id: m.id.slice(0, 8), state: m.state, title: String(m.title ?? "").slice(0, 60) }));
}