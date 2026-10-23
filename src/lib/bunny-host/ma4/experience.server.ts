import { createHash } from "node:crypto";
import type { HostDatabase } from "../persistence.server.ts";
import { LotusStore } from "../lotus.server.ts";
import { rank, render, type LotusMemory, type LotusScope } from "../lotus.ts";
import type { Skill } from "./skills.ts";

/**
 * MA4-S2 Lotus Memory integration for agent experience. This is an ADAPTER over the existing Lotus store, not a second
 * memory system: records are ordinary Lotus memories (scoped, layered, trust-ceilinged, revisioned, steering-checked,
 * credential-refusing) plus one additive metadata row each (record type, content hash, validation, confidence, task
 * tags, expiry, sensitivity). Layers used:
 *   outer petals — recent run notes (expire with the Lotus outer TTL)
 *   inner petals — verified experience (a deterministic-gate outcome on a task, Host-written text only)
 *   central bud  — compact pointers to qualified skills (Host-written; the procedure text stays in the registry)
 *   stem         — retrieve(): authorized scopes only, verified only, unexpired only, Host/user trust only
 * Off by default. Nothing here stores prompts, user files, model output, source code or credentials, and nothing is
 * ever sent to an external model by this module.
 */
export const S2_MEMORY_SETTING = "ma4_s2_memory_v1";
export type MemoryPolicy = { enabled: boolean; retentionDays: number; persistRuns: boolean };
export const DEFAULT_MEMORY_POLICY: MemoryPolicy = { enabled: false, retentionDays: 30, persistRuns: false };
export type RecordType = "experience" | "skill-pointer" | "run-note";
export type Sensitivity = "synthetic" | "project" | "personal";
export type MemoryMeta = { memoryId: string; recordType: RecordType; contentSha256: string; validation: "verified" | "unverified"; confidence: number; tags: string[]; expiresAt: number; sensitivity: Sensitivity; createdAt: number };
export type Experience = { taskId: string; kind: string; tags: string[]; status: string; firstAttempt: boolean; repairs: { target: string; categories: string[]; outcome: string }[]; skills: string[] };
export type Retrieved = { memory: LotusMemory; meta: MemoryMeta; line: string };

const sha = (text: string) => createHash("sha256").update(text).digest("hex");
const TAG = /^[a-z][a-z0-9-]{1,40}$/;

export class ExperienceMemory {
  host: HostDatabase;
  lotus: LotusStore;
  constructor(host: HostDatabase, lotus = new LotusStore(host)) {
    this.host = host; this.lotus = lotus;
    host.db.exec(`CREATE TABLE IF NOT EXISTS ma4_memory_meta(memory_id TEXT PRIMARY KEY,record_type TEXT NOT NULL,content_sha256 TEXT NOT NULL,validation TEXT NOT NULL,confidence REAL NOT NULL,tags TEXT NOT NULL,expires_at INTEGER NOT NULL,sensitivity TEXT NOT NULL,created_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);`);
  }
  policy(): MemoryPolicy {
    try {
      const row = this.host.db.prepare("SELECT value FROM settings WHERE key=?").get(S2_MEMORY_SETTING) as { value: string } | undefined;
      const p = row ? JSON.parse(row.value) : {};
      return { enabled: p.enabled === true, retentionDays: Number.isInteger(p.retentionDays) && p.retentionDays >= 1 && p.retentionDays <= 365 ? p.retentionDays : DEFAULT_MEMORY_POLICY.retentionDays, persistRuns: p.persistRuns === true };
    } catch { return { ...DEFAULT_MEMORY_POLICY }; }
  }
  setPolicy(policy: Partial<MemoryPolicy>): MemoryPolicy {
    const next = { ...this.policy(), ...policy };
    this.host.db.prepare("INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").run(S2_MEMORY_SETTING, JSON.stringify(next));
    return this.policy();
  }

  /** A deterministic-gate outcome, written as Host text built only from Host facts (status, kinds, categories). */
  recordExperience(scope: LotusScope, e: Experience, sensitivity: Sensitivity, now = Date.now()): LotusMemory | null {
    if (!this.policy().enabled) return null;
    const tags = e.tags.filter(t => TAG.test(t)).slice(0, 8);
    const repairs = e.repairs.map(r => `${r.target} repair for ${r.categories.join("/")} ${r.outcome}`).join("; ");
    const value = `${e.kind} task [${tags.join(", ")}]: ${e.status}${e.status === "passed" ? (e.firstAttempt ? " on the first attempt" : " after repair") : ""}${repairs ? `; ${repairs}` : ""}${e.skills.length ? `; skills used: ${e.skills.join(", ")}` : ""}.`;
    return this.write(scope, "inner", `experience:${e.kind}:${tags.join("+") || "untagged"}`, value, "experience", tags, sensitivity, 1, now, [`host:workflow:${e.taskId}`]);
  }

  /** The central bud holds a Host-written pointer to a qualified skill: name, version, tags and evidence counts only. */
  recordSkillPointer(scope: LotusScope, skill: Skill, sensitivity: Sensitivity, now = Date.now()): LotusMemory | null {
    if (!this.policy().enabled) return null;
    const passed = skill.evidence.filter(x => x.passed && x.stage !== "screen").length;
    return this.write(scope, "central", `skill:${skill.name}@v${skill.version}`, `Verified procedure ${skill.name} v${skill.version} for ${skill.categories.join(", ")} tasks (${passed} passing validation stages; state ${skill.state}).`, "skill-pointer", [...skill.categories], sensitivity, 1, now, [`host:skill:${skill.id}`]);
  }

  /**
   * The stem. Only scopes the caller was authorized for; only verified, unexpired, Host- or user-trusted records of an
   * allowed sensitivity; ranked by Lotus over the Host-derived task tags. Disabled policy = nothing is read.
   */
  retrieve(scopes: readonly LotusScope[], tags: readonly string[], input: { now?: number; limit?: number; types?: RecordType[]; sensitivities?: Sensitivity[] } = {}): Retrieved[] {
    if (!this.policy().enabled || !scopes.length) return [];
    const now = input.now ?? Date.now(), allowed = input.sensitivities ?? ["synthetic", "project"];
    const metas = new Map(this.metaFor(this.lotus.list(scopes).map(m => m.id)).map(m => [m.memoryId, m]));
    const eligible = this.lotus.list(scopes).filter(m => {
      const meta = metas.get(m.id);
      return meta && meta.validation === "verified" && meta.expiresAt > now && allowed.includes(meta.sensitivity) && (m.trust === "host" || m.trust === "user")
        && (!input.types || input.types.includes(meta.recordType)) && meta.contentSha256 === sha(`${m.key}\u0000${m.value}`);
    });
    const query = tags.join(" ").replace(/-/g, " ");
    return rank(eligible, query, now, input.limit ?? 3).map(m => ({ memory: m, meta: metas.get(m.id)!, line: render(m) }));
  }

  /** Retention: drops expired records (and the Lotus rows they describe), then runs Lotus' own pruning. */
  prune(now = Date.now()): number {
    const expired = this.host.db.prepare("SELECT memory_id FROM ma4_memory_meta WHERE expires_at<=?").all(now) as { memory_id: string }[];
    for (const row of expired) this.lotus.forget(row.memory_id);
    const pruned = this.lotus.prune(now);
    this.host.db.exec("DELETE FROM ma4_memory_meta WHERE memory_id NOT IN (SELECT id FROM lotus_memories)");
    return expired.length + pruned;
  }
  /** Deletes every S2 record in a scope (the user's "forget this Project's agent experience"). */
  forgetScope(scope: LotusScope): number {
    const ids = this.lotus.list([scope]).map(m => m.id).filter(id => this.metaFor([id]).length);
    for (const id of ids) this.lotus.forget(id);
    this.host.db.exec("DELETE FROM ma4_memory_meta WHERE memory_id NOT IN (SELECT id FROM lotus_memories)");
    return ids.length;
  }

  private write(scope: LotusScope, layer: "outer" | "inner" | "central", key: string, value: string, recordType: RecordType, tags: string[], sensitivity: Sensitivity, confidence: number, now: number, sources: string[]): LotusMemory {
    const { memory } = this.lotus.write({ scope, layer, key, value, trust: "host", provenance: sources[0] ?? "host:ma4-s2", sources }, now);
    this.host.db.prepare("INSERT INTO ma4_memory_meta VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(memory_id) DO UPDATE SET content_sha256=excluded.content_sha256,expires_at=excluded.expires_at")
      .run(memory.id, recordType, sha(`${memory.key}\u0000${memory.value}`), "verified", confidence, JSON.stringify(tags), now + this.policy().retentionDays * 86_400_000, sensitivity, now);
    return memory;
  }
  private metaFor(ids: string[]): MemoryMeta[] {
    if (!ids.length) return [];
    return (this.host.db.prepare(`SELECT * FROM ma4_memory_meta WHERE memory_id IN (${ids.map(() => "?").join(",")})`).all(...ids) as Record<string, unknown>[]).map(r => ({
      memoryId: String(r.memory_id), recordType: r.record_type as RecordType, contentSha256: String(r.content_sha256), validation: r.validation as MemoryMeta["validation"], confidence: Number(r.confidence),
      tags: JSON.parse(String(r.tags)), expiresAt: Number(r.expires_at), sensitivity: r.sensitivity as Sensitivity, createdAt: Number(r.created_at) }));
  }
}
