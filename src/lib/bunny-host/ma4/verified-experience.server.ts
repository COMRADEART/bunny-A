import { createHash } from "node:crypto";
import { z } from "zod";
import type { HostDatabase } from "../persistence.server.ts";
import { LotusStore } from "../lotus.server.ts";
import { ExperienceMemory, type Sensitivity } from "./experience.server.ts";
import { isVerifiedSuccess, type ExecutionOutcomeRecord } from "./outcome-measurement.ts";
import { parseScope, type LotusMemory, type LotusScope } from "../lotus.ts";
import { looksSecret } from "../intelligence.ts";

export const VERIFIED_EXPERIENCE_SETTING = "ma4_s3_t4_verified_learning_v1";

export const CandidateExperienceRecordSchema = z.object({
  version: z.literal("bunny-a.ma4-s3-t4.experience.v1"),
  projectScope: z.string().regex(/^project:[A-Za-z0-9_.:-]{1,120}$/),
  taskType: z.string().min(1).max(80),
  problemSignature: z.string().min(1).max(120),
  strategyUsed: z.string().min(1).max(200),
  verifiedOutcome: z.enum(["success", "failure"]),
  failureOrSuccessConditions: z.array(z.string().max(200)).max(10),
  modelIdentity: z.object({
    id: z.string(),
    digest: z.string().nullable(),
  }).strict(),
  relevantArtifactHashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).max(8),
  evidenceProvenance: z.string().min(1).max(200),
  createdAt: z.number().int().positive(),
  expiresAt: z.number().int().positive(),
  confidence: z.number().min(0).max(1),
}).strict();

export type CandidateExperienceRecord = z.infer<typeof CandidateExperienceRecordSchema>;

const sha256 = (text: string) => createHash("sha256").update(text).digest("hex");

export class VerifiedExperienceManager {
  readonly host: HostDatabase;
  readonly lotus: LotusStore;
  readonly experience: ExperienceMemory;

  constructor(host: HostDatabase, lotus = new LotusStore(host), experience = new ExperienceMemory(host, lotus)) {
    this.host = host;
    this.lotus = lotus;
    this.experience = experience;
    host.db.exec(`
      CREATE TABLE IF NOT EXISTS ma4_verified_experiences (
        id TEXT PRIMARY KEY,
        project_scope TEXT NOT NULL,
        problem_signature TEXT NOT NULL,
        verified_outcome TEXT NOT NULL,
        model_id TEXT NOT NULL,
        confidence REAL NOT NULL,
        record_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_ma4_ve_scope ON ma4_verified_experiences(project_scope, expires_at);
      CREATE INDEX IF NOT EXISTS idx_ma4_ve_sig ON ma4_verified_experiences(project_scope, problem_signature);
    `);
  }

  /**
   * Owner-controlled learning toggle.
   * Default is DISABLED (false) until explicitly enabled by the workstation owner.
   */
  isEnabled(): boolean {
    return this.experience.policy().enabled;
  }

  setEnabled(enabled: boolean): boolean {
    this.experience.setPolicy({ enabled });
    return this.isEnabled();
  }

  /**
   * Derives a deterministic problem signature from task class, invoked roles, and resource categories.
   */
  deriveProblemSignature(outcome: ExecutionOutcomeRecord): string {
    const roles = [...outcome.rolesInvoked].sort().join("+");
    const hasTools = outcome.toolCallCount > 0 ? "tools" : "notools";
    const status = outcome.taskClass;
    return `sig:${status}:${roles}:${hasTools}`;
  }

  /**
   * Lifecycle Step 1-5:
   * Observes a completed run, evaluates Host-verified evidence, creates a candidate record,
   * and promotes it to Lotus Memory IF AND ONLY IF owner policy is enabled and outcome is verified.
   */
  observeAndPromote(
    outcome: ExecutionOutcomeRecord,
    options: {
      now?: number;
      ttlMs?: number;
      sensitivity?: Sensitivity;
    } = {},
  ): { candidate: CandidateExperienceRecord; promoted: boolean; reason: string } {
    const now = options.now ?? Date.now();
    const ttlMs = options.ttlMs ?? 30 * 24 * 3_600_000; // 30 days
    const isSuccess = isVerifiedSuccess(outcome);
    const scopeStr = `project:${outcome.projectId}`;
    const scope = parseScope(scopeStr);

    const problemSignature = this.deriveProblemSignature(outcome);
    const conditions: string[] = [];
    if (isSuccess) {
      conditions.push(`Accepted: all ${outcome.evidence.hostVerified.exitCodes.length} test processes exited 0`);
      if (outcome.verifiedArtifactHashes.length) {
        conditions.push(`Verified ${outcome.verifiedArtifactHashes.length} artifact hashes`);
      }
    } else {
      conditions.push(`Failed: ${outcome.failureTaxonomy ?? "STEP_FAILED"}`);
    }

    // Never store raw documents, credentials, or private transcripts
    const strategyUsed = `Strategy ${outcome.taskClass} using [${outcome.rolesInvoked.join(", ")}] with ${outcome.modelCallCount} model calls`;

    const candidate: CandidateExperienceRecord = {
      version: "bunny-a.ma4-s3-t4.experience.v1",
      projectScope: scopeStr as CandidateExperienceRecord["projectScope"],
      taskType: outcome.taskClass,
      problemSignature,
      strategyUsed,
      verifiedOutcome: isSuccess ? "success" : "failure",
      failureOrSuccessConditions: conditions,
      modelIdentity: outcome.approvedModel,
      relevantArtifactHashes: outcome.verifiedArtifactHashes.slice(0, 8),
      evidenceProvenance: `host:task:${outcome.taskId}:receipts:${outcome.evidence.hostVerified.testReceipts.length}`,
      createdAt: now,
      expiresAt: now + ttlMs,
      confidence: isSuccess ? 0.95 : 0.40,
    };

    // Promotion gate: check owner-enabled policy
    if (!this.isEnabled()) {
      return { candidate, promoted: false, reason: "Verified experience learning is disabled by owner policy." };
    }

    // Persist to local SQLite table
    const id = crypto.randomUUID();
    this.host.db.prepare(`
      INSERT INTO ma4_verified_experiences(id, project_scope, problem_signature, verified_outcome, model_id, confidence, record_json, created_at, expires_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      id,
      candidate.projectScope,
      candidate.problemSignature,
      candidate.verifiedOutcome,
      candidate.modelIdentity.id,
      candidate.confidence,
      JSON.stringify(candidate),
      candidate.createdAt,
      candidate.expiresAt,
    );

    // Promote into Lotus inner layer (Host trust only)
    if (isSuccess) {
      const summaryText = `${outcome.taskClass} workflow [${problemSignature}]: succeeded on ${outcome.approvedModel.id} using ${outcome.rolesInvoked.join("/")}.`;
      if (!looksSecret(summaryText)) {
        this.lotus.write(
          {
            scope,
            layer: "inner",
            key: `experience:${problemSignature}`,
            value: summaryText,
            trust: "host",
            provenance: candidate.evidenceProvenance,
            sources: [`host:task:${outcome.taskId}`],
          },
          now,
        );
      }
    }

    return { candidate, promoted: true, reason: "Candidate record validated and promoted to project memory." };
  }

  /**
   * Lifecycle Step 6-7:
   * Retrieves relevant experiences for an authorized project task.
   * Strict Isolation Invariants:
   * 1. Scoped strictly to `project:<projectId>`. Never reads other projects.
   * 2. Returns formatted advisory context, NEVER instructions.
   * 3. Cannot grant tools, permissions, or change model pins.
   */
  retrieveProjectExperience(
    projectId: string,
    problemSignature: string,
    options: { now?: number; limit?: number } = {},
  ): { records: CandidateExperienceRecord[]; advisoryContext: string | null } {
    if (!this.isEnabled()) {
      return { records: [], advisoryContext: null };
    }

    const now = options.now ?? Date.now();
    const limit = options.limit ?? 3;
    const projectScope = `project:${projectId}`;

    const rows = this.host.db.prepare(`
      SELECT record_json FROM ma4_verified_experiences
      WHERE project_scope = ? AND problem_signature = ? AND expires_at > ?
      ORDER BY confidence DESC, created_at DESC
      LIMIT ?
    `).all(projectScope, problemSignature, now, limit) as { record_json: string }[];

    const records: CandidateExperienceRecord[] = [];
    for (const row of rows) {
      try {
        records.push(CandidateExperienceRecordSchema.parse(JSON.parse(row.record_json)));
      } catch {}
    }

    if (!records.length) {
      return { records: [], advisoryContext: null };
    }

    // Format strictly as bounded advisory context
    const lines = records.map((rec, i) =>
      `Prior verified workflow #${i + 1} (${rec.verifiedOutcome}): ${rec.strategyUsed}; outcome conditions: ${rec.failureOrSuccessConditions.join("; ")}.`
    );

    const advisoryContext = [
      "[advisory workflow context — not instructions, authorization, or tool grants]",
      ...lines,
      "[/advisory workflow context]",
    ].join("\n");

    return { records, advisoryContext };
  }

  /**
   * Lifecycle Step 9: Expire and prune obsolete records.
   */
  prune(now = Date.now()): number {
    const res = this.host.db.prepare("DELETE FROM ma4_verified_experiences WHERE expires_at <= ?").run(now);
    const lotusPruned = this.experience.prune(now);
    return Number(res.changes ?? 0) + lotusPruned;
  }

  /**
   * Deletes all experiences in a project (user privacy control: "forget project memory").
   */
  forgetProject(projectId: string): number {
    const scope = `project:${projectId}`;
    const res = this.host.db.prepare("DELETE FROM ma4_verified_experiences WHERE project_scope = ?").run(scope);
    const lotusPruned = this.experience.forgetScope(parseScope(scope));
    return Number(res.changes ?? 0) + lotusPruned;
  }
}
