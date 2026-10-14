import type { HostDatabase } from "./persistence.server.ts";
import type { SlotId } from "./personal-agents.ts";
import {
  CONTEXT_LIMITS,
  FOREGROUND_SETTING,
  PERSONAL_AGENT_CONTEXT_SCHEMA,
  emptyProfile,
  parseIdentity,
  type ConversationIdentity,
  type ConversationTurn,
  type PersonalAgentProfile,
  type TurnBasis,
  type TurnRole,
} from "./personal-agent-context.ts";

/**
 * M-A-3 T13.3 Gate B: additive tables on the Host's SQLite file, created by their owner like AgentStore. No existing table
 * or row is rewritten. `agent_id` is the primary key of the ownership ledger, so an Agent has at most one Personal Agent.
 */
export class PersonalAgentContextStore {
  host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_agent_ownership(agent_id TEXT PRIMARY KEY, slot INTEGER NOT NULL, assigned_at INTEGER NOT NULL, assigned_by TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_agent_profiles(slot INTEGER PRIMARY KEY, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS personal_agent_turns(id INTEGER PRIMARY KEY AUTOINCREMENT, slot INTEGER NOT NULL, at INTEGER NOT NULL, role TEXT NOT NULL, text TEXT NOT NULL, basis TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS personal_agent_ownership_slot ON personal_agent_ownership(slot, assigned_at);
      CREATE INDEX IF NOT EXISTS personal_agent_turns_slot ON personal_agent_turns(slot, id);
      INSERT OR IGNORE INTO migrations(key) VALUES('${PERSONAL_AGENT_CONTEXT_SCHEMA}');`);
  }
  get db() { return this.host.db; }

  ownerOf(agentId: string): SlotId | null {
    const row = this.db.prepare("SELECT slot FROM personal_agent_ownership WHERE agent_id=?").get(agentId) as { slot: number } | undefined;
    return row ? (row.slot as SlotId) : null;
  }
  owned(slot: SlotId): string[] {
    return (this.db.prepare("SELECT agent_id FROM personal_agent_ownership WHERE slot=? ORDER BY assigned_at, agent_id").all(slot) as { agent_id: string }[]).map((row) => row.agent_id);
  }
  /** Records `slot` as the owner. Returns the previous owner (null when new, the same slot when unchanged). */
  assign(agentId: string, slot: SlotId, actor: string, now: number): SlotId | null {
    const previous = this.ownerOf(agentId);
    if (previous === slot) return previous;
    this.db.prepare("INSERT INTO personal_agent_ownership(agent_id,slot,assigned_at,assigned_by) VALUES(?,?,?,?) ON CONFLICT(agent_id) DO UPDATE SET slot=excluded.slot,assigned_at=excluded.assigned_at,assigned_by=excluded.assigned_by")
      .run(agentId, slot, now, actor.slice(0, 100));
    return previous;
  }

  profile(slot: SlotId): PersonalAgentProfile {
    const row = this.db.prepare("SELECT record FROM personal_agent_profiles WHERE slot=?").get(slot) as { record: string } | undefined;
    if (!row) return emptyProfile(slot);
    // A corrupt row reads as empty rather than as some other slot's or a guessed profile.
    try {
      const parsed = JSON.parse(row.record) as PersonalAgentProfile;
      return parsed?.slot === slot && Number.isSafeInteger(parsed.revision) ? parsed : emptyProfile(slot);
    } catch {
      return emptyProfile(slot);
    }
  }
  saveProfile(profile: PersonalAgentProfile): void {
    this.db.prepare("INSERT INTO personal_agent_profiles(slot,record) VALUES(?,?) ON CONFLICT(slot) DO UPDATE SET record=excluded.record").run(profile.slot, JSON.stringify(profile));
  }

  /** Appends a turn and returns the oldest turns that fell outside retention, so the caller can compact them. */
  appendTurn(slot: SlotId, role: TurnRole, text: string, basis: TurnBasis, at: number): { turn: ConversationTurn; dropped: ConversationTurn[] } {
    const result = this.db.prepare("INSERT INTO personal_agent_turns(slot,at,role,text,basis) VALUES(?,?,?,?,?)").run(slot, at, role, text, basis);
    const dropped = this.db
      .prepare("SELECT id,slot,at,role,text,basis FROM personal_agent_turns WHERE slot=? ORDER BY id DESC LIMIT -1 OFFSET ?")
      .all(slot, CONTEXT_LIMITS.retainedTurns) as ConversationTurn[];
    if (dropped.length) this.db.prepare(`DELETE FROM personal_agent_turns WHERE id IN (${dropped.map(() => "?").join(",")})`).run(...dropped.map((turn) => turn.id));
    return { turn: { id: Number(result.lastInsertRowid), slot, at, role, text, basis }, dropped: dropped.reverse() };
  }
  /** The newest `limit` turns of ONE slot, oldest first. */
  turns(slot: SlotId, limit: number = CONTEXT_LIMITS.projectedTurns): ConversationTurn[] {
    return (this.db.prepare("SELECT id,slot,at,role,text,basis FROM personal_agent_turns WHERE slot=? ORDER BY id DESC LIMIT ?").all(slot, limit) as ConversationTurn[]).reverse();
  }

  foreground(): ConversationIdentity {
    const row = this.db.prepare("SELECT value FROM settings WHERE key=?").get(FOREGROUND_SETTING) as { value: string } | undefined;
    try {
      return row ? parseIdentity(JSON.parse(row.value)) : "bunny";
    } catch {
      return "bunny";
    }
  }
  setForeground(identity: ConversationIdentity): void {
    this.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(FOREGROUND_SETTING, JSON.stringify(identity));
  }
}
