import { randomUUID } from "node:crypto";
import type { HostDatabase } from "../persistence.server.ts";
import { isTrustedLocalActor } from "../../bunny-missions/authorization.server.ts";
import {
  BASE_TOOLS, SKILL_SCHEMA_VERSION, SkillProposalSchema, assertTransition, screen, shouldQuarantine,
  type Skill, type SkillActor, type SkillEvidence, type SkillState,
} from "./skills.ts";
import { skillContentHash, type Applicability } from "./relevance.ts";

/**
 * MA4-S2 skill registry on the Host's SQLite file (additive table, created by its owner). Versioned by name; every
 * state change is checked by assertTransition() and appended to the skill's history. Owner-only steps require the
 * trusted local workstation actor; the Host can only screen, attach evidence, quarantine, reject and roll back.
 */
export class SkillRegistry {
  host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`CREATE TABLE IF NOT EXISTS ma4_skills(id TEXT PRIMARY KEY,name TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,record TEXT NOT NULL,UNIQUE(name,version));
      INSERT OR IGNORE INTO migrations(key) VALUES('${SKILL_SCHEMA_VERSION}');`);
  }
  private save(skill: Skill) {
    this.host.db.prepare("INSERT INTO ma4_skills(id,name,version,state,record) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,record=excluded.record")
      .run(skill.id, skill.name, skill.version, skill.state, JSON.stringify(skill));
    return skill;
  }
  get(id: string): Skill | null {
    const row = this.host.db.prepare("SELECT record FROM ma4_skills WHERE id=?").get(id) as { record: string } | undefined;
    return row ? JSON.parse(row.record) as Skill : null;
  }
  list(states?: readonly SkillState[]): Skill[] {
    const rows = this.host.db.prepare("SELECT record FROM ma4_skills ORDER BY name,version").all() as { record: string }[];
    return rows.map(r => JSON.parse(r.record) as Skill).filter(s => !states || states.includes(s.state));
  }

  /** A model's proposal enters as DISCOVERED (schema-checked); the next version of an existing name gets version+1. */
  propose(raw: unknown, input: { failureCategories: string[]; provenance: Skill["provenance"] }, now = Date.now()): Skill {
    const p = SkillProposalSchema.parse(raw);
    const row = this.host.db.prepare("SELECT MAX(version) AS v FROM ma4_skills WHERE name=?").get(p.name) as { v: number | null };
    const at = new Date(now).toISOString();
    return this.save({ ...p, schema: SKILL_SCHEMA_VERSION, id: randomUUID(), version: (row.v ?? 0) + 1, state: "discovered",
      inputs: "the frozen task contract", outputs: "advisory guidance text for the listed roles",
      failureCategories: [...new Set(input.failureCategories)].slice(0, 8),
      // Tools outside the workflow's own would be new permissions; they are carried so approval must name them.
      requiredPermissions: p.tools.filter(t => !(BASE_TOOLS as readonly string[]).includes(t)),
      budget: { maxGuidanceChars: 400 }, evidence: [], uses: [], provenance: input.provenance,
      history: [{ at, from: null, to: "discovered", actor: "host", reason: "proposed by the extraction step" }] });
  }

  /** Screening decides CANDIDATE or REJECTED from the skill text alone; reasons are kept as evidence. */
  screen(id: string, forbidden: readonly string[], now = Date.now()): Skill {
    const skill = this.require(id), reasons = screen(skill, forbidden);
    skill.evidence.push({ stage: "screen", passed: reasons.length === 0, at: new Date(now).toISOString(), detail: reasons.join("; ") || "admissible" });
    return this.move(skill, reasons.length ? "rejected" : "candidate", "host", reasons.join("; ") || "screening passed", now);
  }

  addEvidence(id: string, evidence: Omit<SkillEvidence, "at">, now = Date.now()): Skill {
    const skill = this.require(id);
    skill.evidence.push({ ...evidence, at: new Date(now).toISOString() });
    return this.save(skill);
  }

  /**
   * MA4-S2R1: binds a Host applicability attestation (relevance.ts attestApplicability) to the skill. It never changes
   * the state; a later change of the skill text breaks the attested content hash, so the skill stops being retrievable.
   */
  attest(id: string, applicability: Applicability, now = Date.now()): Skill {
    const skill = this.require(id) as Skill & { applicability?: Applicability };
    if (applicability.contentSha256 !== skillContentHash(skill)) throw new Error("The attestation does not match this skill's content.");
    skill.applicability = applicability;
    skill.history.push({ at: new Date(now).toISOString(), from: skill.state, to: skill.state, actor: "host", reason: `applicability attested from ${applicability.validatedOn.map(v => v.taskId).join(", ")}` });
    return this.save(skill);
  }

  /** One lifecycle step. `actor` must be the trusted workstation actor for approval, activation and removal. */
  transition(id: string, to: SkillState, actor: unknown, reason: string, options: { permissionsApproved?: string[]; now?: number } = {}): Skill {
    const who: SkillActor = isTrustedLocalActor(actor) ? "workstation" : "host";
    const skill = this.require(id);
    assertTransition(skill, to, who, options.permissionsApproved ?? []);
    return this.move(skill, to, who, reason, options.now ?? Date.now());
  }

  /** Monitoring: record a verified use; four consecutive failures (or a security violation) quarantine the skill. */
  recordUse(id: string, use: { taskId: string; passed: boolean; securityViolation?: boolean }, now = Date.now()): Skill {
    const skill = this.require(id);
    skill.uses.push({ at: new Date(now).toISOString(), taskId: use.taskId, passed: use.passed });
    if (skill.state === "active" && shouldQuarantine(skill.uses, use.securityViolation)) return this.move(skill, "quarantined", "host", use.securityViolation ? "security violation during use" : "four consecutive failed uses", now);
    return this.save(skill);
  }

  /** Rollback: the active version of a name is retired and the newest earlier version the owner approved returns. */
  rollback(name: string, now = Date.now()): { retired: Skill | null; restored: Skill | null } {
    const versions = this.list().filter(s => s.name === name);
    const current = versions.find(s => s.state === "active" || s.state === "quarantined") ?? null;
    if (current) this.move(current, "rolled_back", "host", "rolled back", now);
    const previous = versions.filter(s => s.version < (current?.version ?? Infinity) && s.history.some(h => h.to === "active") && s.state === "rolled_back").at(-1) ?? null;
    if (previous) this.move(previous, "active", "host", `restored by rollback of v${current?.version}`, now, true);
    return { retired: current, restored: previous ? this.get(previous.id) : null };
  }

  private move(skill: Skill, to: SkillState, actor: SkillActor, reason: string, now: number, restore = false): Skill {
    skill.history.push({ at: new Date(now).toISOString(), from: skill.state, to, actor, reason: reason.slice(0, 300) });
    skill.state = to;
    if (restore) skill.history.at(-1)!.reason += " (owner-approved earlier version)";
    return this.save(skill);
  }
  private require(id: string): Skill {
    const skill = this.get(id);
    if (!skill) throw new Error("That skill does not exist.");
    return skill;
  }
}
