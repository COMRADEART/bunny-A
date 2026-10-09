import { createHash, createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { readFileSync, statSync } from "node:fs";
import type { HostDatabase } from "../bunny-host/persistence.server.ts";
import type { MissionStore } from "./store.server.ts";
import type { AgenticAdmission, AgenticAdjustment, AgenticAuthorizationEnvelope, AgenticProjection, AgenticState } from "./agentic-types.ts";
import { AGENTIC_POLICY_VERSION, AGENTIC_STATES } from "./agentic-types.ts";
import { CommandRefusedError } from "../bunny-host/failure.server.ts";

export function digest(value: unknown): string { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
export function fileDigest(path: string): string { return createHash("sha256").update(readFileSync(path)).digest("hex"); }
export function rootIdentity(path: string): string { const s = statSync(path); return `${s.dev}:${s.ino}:${s.birthtimeMs}`; }
const END: AgenticState[] = ["REVOKED", "EXPIRED", "COMPLETED", "EXHAUSTED"];

/** Persistence and accounting only. Admission requires the canonical policy callback inside BEGIN IMMEDIATE. */
export class AgenticStore {
  host: HostDatabase; missions: MissionStore; generation: string; private key: Buffer;
  constructor(host: HostDatabase, missions: MissionStore, generation: string) {
    this.host = host; this.missions = missions; this.generation = generation;
    host.db.exec(`CREATE TABLE IF NOT EXISTS agentic_authorizations(id TEXT PRIMARY KEY, mission_id TEXT NOT NULL UNIQUE, agent_id TEXT NOT NULL, revision INTEGER NOT NULL, record TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agentic_authorization_key(id INTEGER PRIMARY KEY CHECK(id=1), key TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS agentic_admissions(id TEXT PRIMARY KEY, envelope_id TEXT NOT NULL, record TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS agentic_admissions_envelope ON agentic_admissions(envelope_id);
      CREATE TABLE IF NOT EXISTS agentic_denials(mission_id TEXT NOT NULL, fingerprint TEXT NOT NULL, PRIMARY KEY(mission_id,fingerprint));
      INSERT OR IGNORE INTO migrations(key) VALUES('${AGENTIC_POLICY_VERSION}');`);
    let row = host.db.prepare("SELECT key FROM agentic_authorization_key WHERE id=1").get() as { key: string } | undefined;
    if (!row) {
      const count = host.db.prepare("SELECT COUNT(*) n FROM agentic_authorizations").get() as { n: number };
      if (count.n) throw new Error("Agentic integrity evidence is missing; authority cannot be restored.");
      host.db.prepare("INSERT OR IGNORE INTO agentic_authorization_key VALUES(1,?)").run(randomBytes(32).toString("hex"));
      row = host.db.prepare("SELECT key FROM agentic_authorization_key WHERE id=1").get() as { key: string };
    }
    if (!/^[a-f0-9]{64}$/.test(row.key)) throw new Error("Invalid Agentic integrity key.");
    this.key = Buffer.from(row.key, "hex");
    // Historical intent survives. Executable generation, in-flight effects and grants do not.
    for (const item of host.db.prepare("SELECT record FROM agentic_admissions").all() as { record: string }[]) {
      const admission = JSON.parse(item.record) as AgenticAdmission;
      if (admission.outcome === "ADMITTED" && admission.host_generation !== generation) this.finish(admission.id, "UNKNOWN");
    }
    for (const item of host.db.prepare("SELECT id FROM agentic_authorizations").all() as { id: string }[]) {
      try {
        const envelope = this.get(item.id)!;
        if (["ACTIVE", "PAUSED"].includes(envelope.current_state) && envelope.host_generation !== generation) {
          this.put({ ...envelope, current_state: envelope.expires_at <= Date.now() ? "EXPIRED" : "WAITING_FOR_USER", revision: envelope.revision + 1, host_generation: null });
          this.audit("agent.authorization_changed", envelope, { reason: "host_restart_requires_fresh_consent" });
        }
      } catch { /* A corrupt record remains evidence; every read/admission fails closed. */ }
    }
  }
  private signature(envelope: AgenticAuthorizationEnvelope): string {
    const { integrity_reference: _ignored, ...body } = envelope;
    return createHmac("sha256", this.key).update(JSON.stringify(body)).digest("hex");
  }
  private put(envelope: AgenticAuthorizationEnvelope): AgenticAuthorizationEnvelope {
    const signed = { ...envelope, integrity_reference: this.signature(envelope) };
    this.host.db.prepare("INSERT INTO agentic_authorizations VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET revision=excluded.revision,record=excluded.record")
      .run(signed.id, signed.mission_id, signed.agent_id, signed.revision, JSON.stringify(signed));
    return signed;
  }
  get(id: string): AgenticAuthorizationEnvelope | null {
    const row = this.host.db.prepare("SELECT revision,record FROM agentic_authorizations WHERE id=?").get(id) as { revision: number; record: string } | undefined;
    if (!row) return null;
    const e = JSON.parse(row.record) as AgenticAuthorizationEnvelope;
    if (e.id !== id || e.policy_version !== AGENTIC_POLICY_VERSION || e.revision !== row.revision || !AGENTIC_STATES.includes(e.current_state)
      || !Number.isSafeInteger(e.maximum_actions) || e.maximum_actions < 1 || e.maximum_actions > 1000
      || !Number.isSafeInteger(e.maximum_duration) || e.maximum_duration < 1000 || e.maximum_duration > 7_200_000
      || !Number.isSafeInteger(e.maximum_concurrency) || e.maximum_concurrency < 1 || e.maximum_concurrency > 8
      || !Number.isSafeInteger(e.expires_at) || !Array.isArray(e.permitted_capabilities) || !Array.isArray(e.permitted_resource_scopes)
      || !e.scope || e.restart_requires_consent !== true || typeof e.integrity_reference !== "string" || !/^[a-f0-9]{64}$/.test(e.integrity_reference)
      || !timingSafeEqual(Buffer.from(e.integrity_reference, "hex"), Buffer.from(this.signature(e), "hex"))) throw new Error("Invalid Agentic authorization integrity/schema.");
    return e;
  }
  forMission(missionId: string): AgenticAuthorizationEnvelope | null {
    const row = this.host.db.prepare("SELECT id FROM agentic_authorizations WHERE mission_id=?").get(missionId) as { id: string } | undefined;
    if (!row) return null;
    const e = this.get(row.id)!;
    if (["ACTIVE", "PAUSED", "WAITING_FOR_USER"].includes(e.current_state) && e.expires_at <= Date.now()) {
      const next = this.put({ ...e, current_state: "EXPIRED" }); this.audit("agent.authorization_expired", next); return next;
    }
    if (e.current_state === "ACTIVE" && this.rows(e.id).length >= e.maximum_actions) {
      const next = this.put({ ...e, current_state: "EXHAUSTED" }); this.audit("agent.authorization_exhausted", next); return next;
    }
    return e;
  }
  exists(missionId: string): boolean { return !!this.host.db.prepare("SELECT id FROM agentic_authorizations WHERE mission_id=?").get(missionId); }
  propose(envelope: AgenticAuthorizationEnvelope): AgenticAuthorizationEnvelope {
    if (this.exists(envelope.mission_id)) throw new Error("Agentic authorization already exists; use a revisioned adjustment.");
    this.put(envelope); this.audit("agent.authorization_proposed", envelope);
    return this.put({ ...envelope, current_state: "WAITING_FOR_USER" });
  }
  assertRevision(id: string, revision: number): AgenticAuthorizationEnvelope {
    const e = this.get(id);
    if (!e || e.revision !== revision) throw new CommandRefusedError("Stale or unknown Agentic authorization revision.");
    return e;
  }
  approve(id: string, revision: number, authorizationId: string, actor: string): AgenticAuthorizationEnvelope {
    const e = this.assertRevision(id, revision);
    if (e.current_state !== "WAITING_FOR_USER" || e.expires_at <= Date.now()) throw new CommandRefusedError("Agentic consent is not pending or has expired.");
    const now = Date.now();
    const next = this.put({ ...e, user_authorization_id: authorizationId, authorization_provenance: { actor, channel: actor.startsWith("device:") ? "paired-device" : "workstation", request_revision: revision }, approved_at: now, host_generation: this.generation, current_state: "ACTIVE" });
    this.audit("agent.authorization_approved", next); return next;
  }
  adjust(id: string, revision: number, patch: AgenticAdjustment): AgenticAuthorizationEnvelope {
    const e = this.assertRevision(id, revision);
    if (END.includes(e.current_state)) throw new Error("Ended authorization cannot be adjusted or resurrected.");
    const allowed = ["capabilities", "maximumActions", "durationMs", "maximumConcurrency"];
    if (Object.keys(patch).some(k => !allowed.includes(k))) throw new Error("Unsupported scope adjustment; new authority requires a new exact proposal.");
    const integer = (v: unknown, max: number, min = 1) => { if (!Number.isSafeInteger(v) || Number(v) < min || Number(v) > max) throw new Error("Scope adjustments may only reduce the Host offer."); return Number(v); };
    if (patch.capabilities && (!Array.isArray(patch.capabilities) || patch.capabilities.some(c => !e.permitted_capabilities.includes(c)))) throw new Error("Capabilities may only be reduced.");
    const duration = patch.durationMs === undefined ? e.maximum_duration : integer(patch.durationMs, e.maximum_duration, 1000);
    const next = this.put({ ...e, permitted_capabilities: patch.capabilities ?? e.permitted_capabilities,
      maximum_actions: patch.maximumActions === undefined ? e.maximum_actions : integer(patch.maximumActions, e.maximum_actions),
      maximum_concurrency: patch.maximumConcurrency === undefined ? e.maximum_concurrency : integer(patch.maximumConcurrency, e.maximum_concurrency),
      maximum_duration: duration, expires_at: Math.min(e.expires_at, (e.approved_at ?? e.proposed_at) + duration), revision: e.revision + 1 });
    this.audit("agent.authorization_changed", next); return next;
  }
  state(id: string, state: AgenticState, revision?: number): AgenticAuthorizationEnvelope {
    const e = revision === undefined ? this.get(id)! : this.assertRevision(id, revision);
    if (!e) throw new Error("Unknown authorization.");
    if (END.includes(e.current_state) && e.current_state !== state && !(e.current_state === "EXHAUSTED" && state === "COMPLETED")) throw new Error("Ended authorization cannot be restored.");
    if (state === "ACTIVE" && (e.current_state !== "PAUSED" || e.host_generation !== this.generation || e.expires_at <= Date.now())) throw new Error("Resume needs current, unexpired consent.");
    const next = this.put({ ...e, current_state: state, revoked_at: state === "REVOKED" ? Date.now() : e.revoked_at, revision: e.revision + 1 });
    this.audit(state === "REVOKED" ? "agent.authorization_revoked" : state === "EXPIRED" ? "agent.authorization_expired" : "agent.authorization_changed", next);
    return next;
  }
  rows(id: string): AgenticAdmission[] { return (this.host.db.prepare("SELECT record FROM agentic_admissions WHERE envelope_id=? ORDER BY rowid").all(id) as { record: string }[]).map(r => JSON.parse(r.record) as AgenticAdmission); }
  admit(id: string, revision: number, input: Omit<AgenticAdmission, "id" | "envelope_id" | "revision" | "host_generation" | "admitted_at" | "finished_at" | "outcome">, validate: (e: AgenticAuthorizationEnvelope) => string | null): { admission?: AgenticAdmission; reason?: string } {
    return this.host.transaction(() => {
      const e = this.assertRevision(id, revision);
      const reason = validate(e);
      if (reason) return { reason };
      if (e.current_state !== "ACTIVE" || e.host_generation !== this.generation || !e.authorization_provenance || !e.user_authorization_id) return { reason: "Current generation has no active user delegation." };
      if (e.expires_at <= Date.now() || Date.now() - e.approved_at! >= e.maximum_duration) { this.put({ ...e, current_state: "EXPIRED" }); this.audit("agent.authorization_expired", e); return { reason: "Agentic authorization expired." }; }
      const rows = this.rows(id);
      if (rows.length >= e.maximum_actions) { this.put({ ...e, current_state: "EXHAUSTED" }); this.audit("agent.authorization_exhausted", e); return { reason: "Agentic action budget exhausted." }; }
      if (rows.filter(r => r.outcome === "ADMITTED").length >= e.maximum_concurrency) return { reason: "Agentic parallel action ceiling reached." };
      if (input.capability === "provider.execute" && rows.filter(r => r.capability === "provider.execute").length >= e.budget_constraints.maximum_provider_attempts) return { reason: "Finite provider attempt budget exhausted." };
      const admission: AgenticAdmission = { ...input, id: randomUUID(), envelope_id: id, revision, host_generation: this.generation, admitted_at: Date.now(), finished_at: null, outcome: "ADMITTED" };
      this.host.db.prepare("INSERT INTO agentic_admissions VALUES(?,?,?)").run(admission.id, id, JSON.stringify(admission));
      this.audit("agent.action_admitted", e, { admission });
      return { admission };
    });
  }
  finish(id: string, outcome: "COMPLETED" | "FAILED" | "UNKNOWN"): void {
    const row = this.host.db.prepare("SELECT record FROM agentic_admissions WHERE id=?").get(id) as { record: string } | undefined;
    if (!row) return;
    const a = JSON.parse(row.record) as AgenticAdmission;
    if (a.outcome !== "ADMITTED") return;
    this.host.db.prepare("UPDATE agentic_admissions SET record=? WHERE id=?").run(JSON.stringify({ ...a, outcome, finished_at: Date.now() }), id);
  }
  deny(missionId: string, fingerprint: string): void { this.host.db.prepare("INSERT OR IGNORE INTO agentic_denials VALUES(?,?)").run(missionId, fingerprint); }
  denied(missionId: string, fingerprint: string): boolean { return !!this.host.db.prepare("SELECT 1 FROM agentic_denials WHERE mission_id=? AND fingerprint=?").get(missionId, fingerprint); }
  audit(type: string, e: AgenticAuthorizationEnvelope, extra: Record<string, unknown> = {}): void {
    this.host.event(type, null, JSON.stringify({ kind: "agent-authorization", agentId: e.agent_id, missionId: e.mission_id, envelopeId: e.id, revision: e.revision, hostGeneration: this.generation, ...extra }), e.mission_id);
  }
  projection(missionId: string): AgenticProjection | null {
    const e = this.forMission(missionId); if (!e) return null;
    const rows = this.rows(e.id);
    const mission = this.missions.mission(missionId);
    return { id: e.id, revision: e.revision, state: e.current_state, objective: mission.objective, capabilities: e.permitted_capabilities,
      ...(e.cross_app ? { browserOrigins: e.browser_origins, applications: e.permitted_capabilities.some(action => action.startsWith("computer.")) ? ["Microsoft Calculator (verified native lifetime)"] : [] } : {}),
      roots: e.permitted_resource_scopes.map(r => r.root), commands: e.commands.map(c => ({ command: c.command, args: c.args, cwd: c.cwd, timeoutMs: c.timeout_ms })),
      riskCeiling: e.risk_ceiling, expiresAt: e.expires_at, durationMs: e.maximum_duration, maximumActions: e.maximum_actions, maximumConcurrency: e.maximum_concurrency,
      admitted: rows.length, completed: rows.filter(r => r.outcome === "COMPLETED").length, failed: rows.filter(r => r.outcome === "FAILED").length, unknown: rows.filter(r => r.outcome === "UNKNOWN").length,
      remainingActions: Math.max(0, e.maximum_actions - rows.length), remainingMs: Math.max(0, Math.min(e.expires_at - Date.now(), e.maximum_duration - (e.approved_at ? Date.now() - e.approved_at : 0))), latestAdmission: rows.at(-1) ?? null,
      pending: this.missions.requests(missionId).filter(r => !r.resolvedAt).map(r => ({ id: r.id, action: r.action, risk: r.risk, reason: r.reason, ...(r.agentic ? { resource: r.agentic.resource } : {}) })),
      limitations: ["Restart requires fresh reviewed consent.", "Model delegation supports tool-free Ollama inference; workspace CLI tools require separate review.", "Terminal delegation supports pure read/assertion Node checks in a read-only snapshot, with no executable imports, subprocesses or network APIs; script edits require new consent.", e.cross_app ? "Browser observation is bound to exact approved origins and a Mission-owned profile. Desktop scope is verified Calculator arithmetic only; ambiguous effects require review." : "Browser and desktop operations require their existing specific approval boundary."] };
  }
}
