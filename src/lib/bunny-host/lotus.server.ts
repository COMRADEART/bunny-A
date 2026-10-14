import type { HostDatabase } from "./persistence.server.ts";
import {
  LOTUS_LAYERS,
  LOTUS_LIMITS,
  LOTUS_SCHEMA,
  admit,
  canPromote,
  memoryHash,
  rank,
  summarize,
  type LotusExport,
  type LotusInput,
  type LotusLayer,
  type LotusMemory,
  type LotusScope,
} from "./lotus.ts";
import { clean } from "./personal-agents.ts";
import { looksSecret } from "./intelligence.ts";

type Row = {
  id: string;
  scope: string;
  layer: string;
  key: string;
  value: string;
  trust: string;
  provenance: string;
  sources: string;
  revision: number;
  created_at: number;
  updated_at: number;
};

const toMemory = (row: Row): LotusMemory => ({
  id: row.id,
  scope: row.scope as LotusScope,
  layer: row.layer as LotusLayer,
  key: row.key,
  value: row.value,
  trust: row.trust as LotusMemory["trust"],
  provenance: row.provenance,
  sources: (() => {
    try {
      const parsed = JSON.parse(row.sources);
      return Array.isArray(parsed) ? parsed.filter((id): id is string => typeof id === "string") : [];
    } catch {
      return [];
    }
  })(),
  revision: row.revision,
  createdAt: row.created_at,
  updatedAt: row.updated_at,
});

const SUMMARY = "host:summary";

/**
 * M-A-3 T13.3 Gate C: Lotus memory on the Host's SQLite file (additive tables, created by their owner). Every read takes
 * an explicit list of scopes; deciding which scopes a caller may read is the Host's job, never the model's. Every change
 * keeps a revision row so corrections and summaries stay versioned until the memory itself is forgotten.
 */
export class LotusStore {
  host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS lotus_memories(id TEXT PRIMARY KEY, scope TEXT NOT NULL, layer TEXT NOT NULL, key TEXT NOT NULL, value TEXT NOT NULL, trust TEXT NOT NULL, provenance TEXT NOT NULL, sources TEXT NOT NULL, hash TEXT NOT NULL, revision INTEGER NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS lotus_revisions(memory_id TEXT NOT NULL, revision INTEGER NOT NULL, layer TEXT NOT NULL, value TEXT NOT NULL, trust TEXT NOT NULL, provenance TEXT NOT NULL, at INTEGER NOT NULL, PRIMARY KEY(memory_id, revision));
      CREATE INDEX IF NOT EXISTS lotus_scope_layer ON lotus_memories(scope, layer, updated_at);
      CREATE INDEX IF NOT EXISTS lotus_hash ON lotus_memories(scope, layer, hash);
      INSERT OR IGNORE INTO migrations(key) VALUES('${LOTUS_SCHEMA}');`);
  }
  get db() { return this.host.db; }

  get(id: string): LotusMemory | null {
    const row = this.db.prepare("SELECT * FROM lotus_memories WHERE id=?").get(id) as Row | undefined;
    return row ? toMemory(row) : null;
  }

  /** Stores a memory, or refreshes the identical one already in that scope and layer. Returns where it actually sits. */
  write(raw: LotusInput, now: number): { memory: LotusMemory; duplicate: boolean } {
    const input = admit(raw);
    const hash = memoryHash(input.key, input.value);
    const existing = this.db.prepare("SELECT * FROM lotus_memories WHERE scope=? AND layer=? AND hash=?").get(input.scope, input.layer, hash) as Row | undefined;
    if (existing) {
      this.db.prepare("UPDATE lotus_memories SET updated_at=? WHERE id=?").run(now, existing.id);
      return { memory: { ...toMemory(existing), updatedAt: now }, duplicate: true };
    }
    const memory: LotusMemory = { id: crypto.randomUUID(), ...input, sources: input.sources ?? [], revision: 1, createdAt: now, updatedAt: now };
    this.insert(memory, hash);
    this.trim(memory.scope, memory.layer);
    return { memory, duplicate: false };
  }

  /** The user's correction replaces the value, becomes user-trusted and wins over any inference with the same name. */
  correct(id: string, value: unknown, now: number): LotusMemory {
    const current = this.require(id);
    const text = clean(value, LOTUS_LIMITS.value, "Memory");
    if (!text) throw new Error("A corrected memory needs a value.");
    if (looksSecret(text)) throw new Error("This looks like a credential. Lotus memory never stores credentials.");
    return this.revise(current, { value: text, trust: "user", provenance: "user:correction" }, now);
  }

  promote(id: string, to: LotusLayer, actor: "user" | "host", now: number): LotusMemory {
    const current = this.require(id);
    if (!canPromote(current, to, actor))
      throw new Error("Only you can raise a model's note or outside text into lasting memory.");
    return this.revise(current, { layer: to }, now);
  }

  forget(id: string): boolean {
    this.db.prepare("DELETE FROM lotus_revisions WHERE memory_id=?").run(id);
    return Number(this.db.prepare("DELETE FROM lotus_memories WHERE id=?").run(id).changes) > 0;
  }

  list(scopes: readonly LotusScope[], layers: readonly LotusLayer[] = LOTUS_LAYERS): LotusMemory[] {
    if (!scopes.length || !layers.length) return [];
    const rows = this.db
      .prepare(`SELECT * FROM lotus_memories WHERE scope IN (${scopes.map(() => "?").join(",")}) AND layer IN (${layers.map(() => "?").join(",")}) ORDER BY updated_at DESC, id`)
      .all(...scopes, ...layers) as Row[];
    return rows.map(toMemory);
  }

  revisions(id: string): { revision: number; layer: LotusLayer; value: string; trust: string; provenance: string; at: number }[] {
    return this.db.prepare("SELECT revision,layer,value,trust,provenance,at FROM lotus_revisions WHERE memory_id=? ORDER BY revision").all(id) as never;
  }

  /** The stem: ranked memories from the given (already authorized) scopes only. */
  retrieve(scopes: readonly LotusScope[], query: string, now: number, limit: number = LOTUS_LIMITS.retrieve): LotusMemory[] {
    return rank(this.list(scopes), query, now, limit);
  }

  export(scope: LotusScope, now: number): LotusExport {
    return { schema: LOTUS_SCHEMA, scope, exportedAt: now, memories: this.list([scope]) };
  }

  /** Session compaction: folds `sources` into the scope's versioned summary under `key`, then drops the folded buds. */
  compact(scope: LotusScope, key: string, sources: readonly LotusMemory[], now: number): LotusMemory | null {
    if (!sources.length) return null;
    const row = this.db.prepare("SELECT * FROM lotus_memories WHERE scope=? AND key=? AND provenance=?").get(scope, key, SUMMARY) as Row | undefined;
    const previous = row ? toMemory(row) : null;
    const next = summarize(scope, key, sources, previous);
    const safe = looksSecret(next.value) ? { ...next, value: "[a folded entry looked like a credential and was left out]" } : next;
    let memory: LotusMemory;
    if (previous) memory = this.revise(previous, { value: safe.value, trust: safe.trust, sources: safe.sources, provenance: SUMMARY }, now);
    else {
      memory = { id: crypto.randomUUID(), ...safe, revision: 1, createdAt: now, updatedAt: now };
      this.insert(memory, memoryHash(memory.key, memory.value));
    }
    for (const source of sources) if (source.layer === "bud" && source.id !== memory.id) this.forget(source.id);
    return memory;
  }

  /** Retention: outer petals older than the TTL are dropped (summaries stay), then every layer is held to its cap. */
  prune(now: number): number {
    const old = Number(
      this.db.prepare("DELETE FROM lotus_memories WHERE layer='outer' AND provenance<>? AND updated_at<?").run(SUMMARY, now - LOTUS_LIMITS.outerTtlMs).changes,
    );
    this.db.exec("DELETE FROM lotus_revisions WHERE memory_id NOT IN (SELECT id FROM lotus_memories)");
    let trimmed = 0;
    const pairs = this.db.prepare("SELECT DISTINCT scope, layer FROM lotus_memories").all() as { scope: string; layer: string }[];
    for (const pair of pairs) trimmed += this.trim(pair.scope as LotusScope, pair.layer as LotusLayer);
    return old + trimmed;
  }

  private require(id: string): LotusMemory {
    const memory = this.get(id);
    if (!memory) throw new Error("That memory no longer exists.");
    return memory;
  }

  private insert(memory: LotusMemory, hash: string) {
    this.db
      .prepare("INSERT INTO lotus_memories(id,scope,layer,key,value,trust,provenance,sources,hash,revision,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)")
      .run(memory.id, memory.scope, memory.layer, memory.key, memory.value, memory.trust, memory.provenance, JSON.stringify(memory.sources), hash, memory.revision, memory.createdAt, memory.updatedAt);
    this.db
      .prepare("INSERT INTO lotus_revisions(memory_id,revision,layer,value,trust,provenance,at) VALUES(?,?,?,?,?,?,?)")
      .run(memory.id, memory.revision, memory.layer, memory.value, memory.trust, memory.provenance, memory.updatedAt);
  }

  private revise(current: LotusMemory, patch: Partial<Pick<LotusMemory, "layer" | "value" | "trust" | "provenance" | "sources">>, now: number): LotusMemory {
    const next: LotusMemory = { ...current, ...patch, revision: current.revision + 1, updatedAt: now };
    this.db
      .prepare("UPDATE lotus_memories SET layer=?,value=?,trust=?,provenance=?,sources=?,hash=?,revision=?,updated_at=? WHERE id=?")
      .run(next.layer, next.value, next.trust, next.provenance, JSON.stringify(next.sources), memoryHash(next.key, next.value), next.revision, now, next.id);
    this.db
      .prepare("INSERT INTO lotus_revisions(memory_id,revision,layer,value,trust,provenance,at) VALUES(?,?,?,?,?,?,?)")
      .run(next.id, next.revision, next.layer, next.value, next.trust, next.provenance, now);
    this.trim(next.scope, next.layer);
    return next;
  }

  private trim(scope: LotusScope, layer: LotusLayer): number {
    const removed = this.db
      .prepare("SELECT id FROM lotus_memories WHERE scope=? AND layer=? ORDER BY updated_at DESC, id LIMIT -1 OFFSET ?")
      .all(scope, layer, LOTUS_LIMITS.perLayer[layer]) as { id: string }[];
    for (const row of removed) this.forget(row.id);
    return removed.length;
  }
}
