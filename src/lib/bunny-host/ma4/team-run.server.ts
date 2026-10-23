import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import type { HostDatabase } from "../persistence.server.ts";
import { validateGraph } from "./task-intelligence.ts";

/**
 * MA4-S2 bounded multi-step workflow control: plan → dependency-aware scheduling → progress → pause/resume → cancel →
 * partial failure → controlled retry → restart recovery → evidence. A node's start is recorded BEFORE it runs, so a
 * crash leaves an honest "running" mark. On recovery a reversible node (e.g. sandboxed generation) is retried within
 * its budget; an irreversible node that may or may not have happened becomes "uncertain" and is never replayed
 * automatically — the owner decides. Irreversible nodes need an owner approval before they may start at all.
 * Persistence follows the user's privacy setting: with persist=false the ledger lives in memory only.
 */
export type NodeState = "pending" | "running" | "done" | "failed" | "cancelled" | "uncertain";
export type RunNode = { id: string; dependsOn: string[]; reversible: boolean; state: NodeState; attempts: number; resultSha256: string | null; error: string | null };
export type RunState = "running" | "paused" | "cancelled" | "completed" | "failed" | "needs_decision";
export type TeamRun = { id: string; state: RunState; nodes: RunNode[]; maxConcurrent: number; maxRetries: number; approvals: string[]; persisted: boolean; createdAt: number; updatedAt: number; events: { at: number; node: string | null; event: string }[] };

export class TeamRuns {
  private memory = new Map<string, TeamRun>();
  private host: HostDatabase | null;
  constructor(host: HostDatabase | null) {
    this.host = host;
    host?.db.exec("CREATE TABLE IF NOT EXISTS ma4_team_runs(id TEXT PRIMARY KEY,record TEXT NOT NULL,updated_at INTEGER NOT NULL)");
  }
  create(id: string, nodes: { id: string; dependsOn?: string[]; reversible: boolean }[], options: { maxConcurrent?: number; maxRetries?: number; persist: boolean }, now = Date.now()): TeamRun {
    const problems = validateGraph({ taskId: id, workerSamples: 1, nodes: nodes.map(n => ({ id: n.id, kind: "verify", actor: "orchestrator", dependsOn: n.dependsOn ?? [] })) }, { maxAgents: 4, maxNodes: 64 });
    if (problems.length) throw new Error(`Invalid run plan: ${problems.join("; ")}`);
    if (this.get(id)) throw new Error("A run with this id already exists.");
    const run: TeamRun = { id, state: "running", nodes: nodes.map(n => ({ id: n.id, dependsOn: n.dependsOn ?? [], reversible: n.reversible, state: "pending", attempts: 0, resultSha256: null, error: null })),
      maxConcurrent: Math.max(1, Math.min(options.maxConcurrent ?? 1, 4)), maxRetries: Math.max(0, Math.min(options.maxRetries ?? 1, 3)), approvals: [], persisted: options.persist && !!this.host, createdAt: now, updatedAt: now, events: [] };
    return this.save(run, null, "created", now);
  }
  get(id: string): TeamRun | null {
    const row = this.host?.db.prepare("SELECT record FROM ma4_team_runs WHERE id=?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as TeamRun : structuredClone(this.memory.get(id) ?? null);
  }
  /** Pending nodes whose dependencies are done, bounded by the free concurrency. Paused/cancelled runs offer nothing. */
  ready(id: string): string[] {
    const run = this.require(id);
    if (run.state !== "running") return [];
    const done = new Set(run.nodes.filter(n => n.state === "done").map(n => n.id)), running = run.nodes.filter(n => n.state === "running").length;
    return run.nodes.filter(n => n.state === "pending" && n.dependsOn.every(d => done.has(d))).slice(0, Math.max(0, run.maxConcurrent - running)).map(n => n.id);
  }
  approve(id: string, nodeId: string, actor: unknown, now = Date.now()): TeamRun {
    if (!isTrustedLocalActor(actor)) throw new Error("Only the workstation owner can approve an irreversible step.");
    const run = this.require(id);
    if (!run.approvals.includes(nodeId)) run.approvals.push(nodeId);
    return this.save(run, nodeId, "approved by owner", now);
  }
  /** Recorded before the work starts. Refuses unready nodes, paused or cancelled runs, and unapproved irreversible steps. */
  start(id: string, nodeId: string, now = Date.now()): TeamRun {
    const run = this.require(id), node = this.node(run, nodeId);
    if (run.state !== "running") throw new Error(`The run is ${run.state}; no new step starts.`);
    if (!this.ready(id).includes(nodeId)) throw new Error(`Step ${nodeId} is not ready (dependencies, state or concurrency).`);
    if (!node.reversible && !run.approvals.includes(nodeId)) throw new Error(`Step ${nodeId} is irreversible and needs the owner's approval first.`);
    node.state = "running"; node.attempts++;
    return this.save(run, nodeId, `started (attempt ${node.attempts})`, now);
  }
  finish(id: string, nodeId: string, outcome: { ok: boolean; resultSha256?: string; error?: string }, now = Date.now()): TeamRun {
    const run = this.require(id), node = this.node(run, nodeId);
    if (node.state !== "running") throw new Error(`Step ${nodeId} is not running.`);
    if (outcome.ok) Object.assign(node, { state: "done", resultSha256: outcome.resultSha256 ?? null, error: null });
    else if (node.reversible && node.attempts <= run.maxRetries) Object.assign(node, { state: "pending", error: outcome.error ?? "failed" });
    else Object.assign(node, { state: "failed", error: outcome.error ?? "failed" });
    return this.settle(run, nodeId, outcome.ok ? "done" : `failed: ${(outcome.error ?? "").slice(0, 120)}`, now);
  }
  pause(id: string, now = Date.now()) { const run = this.require(id); if (run.state === "running") run.state = "paused"; return this.save(run, null, "paused", now); }
  resume(id: string, now = Date.now()) { const run = this.require(id); if (run.state === "paused") run.state = "running"; return this.save(run, null, "resumed", now); }
  /** Cancellation stops admission at once; running reversible work is marked cancelled when its caller observes the abort. */
  cancel(id: string, now = Date.now()): TeamRun {
    const run = this.require(id);
    for (const n of run.nodes) if (n.state === "pending" || (n.state === "running" && n.reversible)) n.state = "cancelled";
    for (const n of run.nodes) if (n.state === "running") n.state = "uncertain";
    run.state = run.nodes.some(n => n.state === "uncertain") ? "needs_decision" : "cancelled";
    return this.save(run, null, "cancelled", now);
  }
  /** After a restart: reversible work is retried within its budget; irreversible work in flight becomes uncertain. */
  recover(id: string, now = Date.now()): TeamRun {
    const run = this.require(id);
    for (const n of run.nodes.filter(x => x.state === "running")) {
      if (!n.reversible) n.state = "uncertain";
      else n.state = n.attempts <= run.maxRetries ? "pending" : "failed";
    }
    return this.settle(run, null, "recovered after restart", now);
  }
  /** The owner resolves an uncertain step: it did happen (done), or it may be retried, or the run gives it up. */
  decide(id: string, nodeId: string, decision: "happened" | "retry" | "abandon", actor: unknown, now = Date.now()): TeamRun {
    if (!isTrustedLocalActor(actor)) throw new Error("Only the workstation owner can resolve an uncertain step.");
    const run = this.require(id), node = this.node(run, nodeId);
    if (node.state !== "uncertain") throw new Error(`Step ${nodeId} is not uncertain.`);
    node.state = decision === "happened" ? "done" : decision === "retry" ? "pending" : "failed";
    if (run.state === "needs_decision" && !run.nodes.some(n => n.state === "uncertain")) run.state = "running";
    return this.settle(run, nodeId, `owner decided: ${decision}`, now);
  }
  summary(id: string) {
    const run = this.require(id);
    return { id, state: run.state, persisted: run.persisted, counts: run.nodes.reduce((a, n) => ({ ...a, [n.state]: (a[n.state] ?? 0) + 1 }), {} as Record<string, number>), attempts: run.nodes.reduce((a, n) => a + n.attempts, 0) };
  }

  private settle(run: TeamRun, node: string | null, event: string, now: number): TeamRun {
    if (run.nodes.some(n => n.state === "uncertain")) run.state = "needs_decision";
    else if (run.nodes.every(n => n.state === "done")) run.state = "completed";
    else if (run.nodes.some(n => n.state === "failed") && !run.nodes.some(n => n.state === "running" || (n.state === "pending" && this.reachable(run, n)))) run.state = "failed";
    return this.save(run, node, event, now);
  }
  /** A pending node is still reachable if none of its (transitive) dependencies failed. */
  private reachable(run: TeamRun, node: RunNode): boolean {
    const byId = new Map(run.nodes.map(n => [n.id, n]));
    const ok = (n: RunNode, seen = new Set<string>()): boolean => !seen.has(n.id) && n.state !== "failed" && n.state !== "cancelled" && n.dependsOn.every(d => { const x = byId.get(d)!; return x.state === "done" || ok(x, new Set([...seen, n.id])); });
    return ok(node);
  }
  private save(run: TeamRun, node: string | null, event: string, now: number): TeamRun {
    run.updatedAt = now;
    run.events.push({ at: now, node, event });
    if (run.events.length > 500) run.events.splice(0, run.events.length - 500);
    if (run.persisted) this.host!.db.prepare("INSERT INTO ma4_team_runs(id,record,updated_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,updated_at=excluded.updated_at").run(run.id, JSON.stringify(run), now);
    else this.memory.set(run.id, structuredClone(run));
    return structuredClone(run);
  }
  private require(id: string): TeamRun { const run = this.get(id); if (!run) throw new Error("That run does not exist."); return run; }
  private node(run: TeamRun, id: string): RunNode { const n = run.nodes.find(x => x.id === id); if (!n) throw new Error(`No step ${id}.`); return n; }
}
