import type { HostDatabase } from "./persistence.server.ts";
import type { SlotId } from "./personal-agents.ts";
import { BUILTIN_ABILITIES, OPEN_STATES, WORKER_SCHEMA, type AgentWorker, type WorkerAbility } from "./workers.ts";

const parse = <T,>(text: string): T => JSON.parse(text) as T;
const OPEN = OPEN_STATES.map((state) => `'${state}'`).join(",");

/**
 * M-A-3 T13.3 Gate D: the worker ledger (additive tables, created by their owner). It records what each worker was
 * allowed and what its child Mission produced; MissionManager stays the only thing that executes.
 */
export class WorkerStore {
  host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS agent_workers(id TEXT PRIMARY KEY, slot INTEGER NOT NULL, parent_mission_id TEXT NOT NULL, child_mission_id TEXT, state TEXT NOT NULL, record TEXT NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE INDEX IF NOT EXISTS agent_workers_parent ON agent_workers(parent_mission_id, state);
      CREATE INDEX IF NOT EXISTS agent_workers_child ON agent_workers(child_mission_id);
      CREATE INDEX IF NOT EXISTS agent_workers_slot ON agent_workers(slot, updated_at);
      CREATE TABLE IF NOT EXISTS agent_worker_abilities(id TEXT PRIMARY KEY, record TEXT NOT NULL, created_at INTEGER NOT NULL);
      INSERT OR IGNORE INTO migrations(key) VALUES('${WORKER_SCHEMA}');`);
  }
  get db() { return this.host.db; }

  save(worker: AgentWorker): AgentWorker {
    this.db
      .prepare("INSERT INTO agent_workers(id,slot,parent_mission_id,child_mission_id,state,record,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET child_mission_id=excluded.child_mission_id, state=excluded.state, record=excluded.record, updated_at=excluded.updated_at")
      .run(worker.id, worker.slot, worker.parentMissionId, worker.childMissionId, worker.state, JSON.stringify(worker), worker.createdAt, worker.updatedAt);
    return worker;
  }
  get(id: string): AgentWorker | null {
    const row = this.db.prepare("SELECT record FROM agent_workers WHERE id=?").get(id) as { record: string } | undefined;
    return row ? parse<AgentWorker>(row.record) : null;
  }
  byChild(missionId: string): AgentWorker | null {
    const row = this.db.prepare("SELECT record FROM agent_workers WHERE child_mission_id=?").get(missionId) as { record: string } | undefined;
    return row ? parse<AgentWorker>(row.record) : null;
  }
  isWorkerMission(missionId: string): boolean {
    return !!this.db.prepare("SELECT 1 FROM agent_workers WHERE child_mission_id=?").get(missionId);
  }
  forParent(missionId: string): AgentWorker[] {
    return (this.db.prepare("SELECT record FROM agent_workers WHERE parent_mission_id=? ORDER BY created_at").all(missionId) as { record: string }[]).map((row) => parse<AgentWorker>(row.record));
  }
  forSlot(slot: SlotId, limit = 20): AgentWorker[] {
    return (this.db.prepare("SELECT record FROM agent_workers WHERE slot=? ORDER BY updated_at DESC LIMIT ?").all(slot, limit) as { record: string }[]).map((row) => parse<AgentWorker>(row.record));
  }
  open(): AgentWorker[] {
    return (this.db.prepare(`SELECT record FROM agent_workers WHERE state IN (${OPEN})`).all() as { record: string }[]).map((row) => parse<AgentWorker>(row.record));
  }
  counts(slot: SlotId, parentMissionId: string): { openForParent: number; totalForParent: number; openForSlot: number } {
    const n = (sql: string, ...args: (string | number)[]) => (this.db.prepare(sql).get(...args) as { n: number }).n;
    return {
      openForParent: n(`SELECT COUNT(*) n FROM agent_workers WHERE parent_mission_id=? AND state IN (${OPEN})`, parentMissionId),
      // Refused proposals never ran, so they do not use up the parent's allowance.
      totalForParent: n("SELECT COUNT(*) n FROM agent_workers WHERE parent_mission_id=? AND child_mission_id IS NOT NULL", parentMissionId),
      openForSlot: n(`SELECT COUNT(*) n FROM agent_workers WHERE slot=? AND state IN (${OPEN})`, slot),
    };
  }

  abilities(): WorkerAbility[] {
    const user = (this.db.prepare("SELECT record FROM agent_worker_abilities ORDER BY created_at").all() as { record: string }[]).map((row) => parse<WorkerAbility>(row.record));
    return [...BUILTIN_ABILITIES, ...user];
  }
  ability(id: string): WorkerAbility | null {
    return this.abilities().find((ability) => ability.id === id) ?? null;
  }
  saveAbility(ability: WorkerAbility): WorkerAbility {
    if (ability.source !== "user") throw new Error("Built-in abilities cannot be changed.");
    this.db.prepare("INSERT INTO agent_worker_abilities(id,record,created_at) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record").run(ability.id, JSON.stringify(ability), ability.createdAt ?? Date.now());
    return ability;
  }
  removeAbility(id: string): boolean {
    return this.db.prepare("DELETE FROM agent_worker_abilities WHERE id=?").run(id).changes > 0;
  }
}
