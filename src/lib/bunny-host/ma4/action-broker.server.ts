import { randomUUID } from "node:crypto";
import type { z } from "zod";
import type { HostDatabase } from "../persistence.server.ts";
import { CHECKPOINT_SECRET_PATTERNS } from "../agent-checkpoint.server.ts";
import { canonical, sha256, SERVICE_ACCESS, type ActionProposal, type Activity, type Envelope, type Grants, type OperationCategory, type ServiceAccess, type StepSpec } from "./task-runtime.ts";
import type { Executor, StepContext, StepResult } from "./task-runtime.server.ts";

/**
 * MA4-S2-T2 permission broker. Models propose; the Host decides. A connected action exists only as a Host-registered
 * contract wrapped here into a task executor, so every call — first run, retry, recovery — passes the same gates in order:
 *
 *   input schema → resource grants (envelope ∩ Host registry) → [consequential: payload-bound owner approval]
 *   → dispatch receipt → trusted connector → result schema → secret redaction → result receipt
 *
 * Nothing a model writes can change a contract, a grant or the order. Each decision is appended to a hash-chained
 * receipt ledger in the Host database (tamper-evident: an edited or deleted row breaks the chain).
 */
export const ACTION_SCHEMA = "ma4.action.v1" as const;
export const RESULT_SCHEMA = "ma4.action.result.v1" as const;
export type ConnectorId = "local-files" | "browser" | "email" | "calendar" | "docs";
export type Requirement =
  | { kind: "file"; root: string; access: "read" | "write" }
  | { kind: "origin"; origin: string }
  | { kind: "service"; connector: "email" | "calendar" | "docs"; account: string; access: ServiceAccess; recipients: string[] };

export type ActionContract<I> = {
  schema: typeof ACTION_SCHEMA;
  kind: string; connector: ConnectorId; operation: string; resource: string;
  category: OperationCategory; sideEffect: boolean;
  /** Needs a fresh owner approval bound to the exact payload every time (send, publish, invite, write a file). */
  consequential: boolean;
  activity: Activity;
  /** How a repeat is made safe: none (read-only), a stable key the provider honours, or a version-conditional write. */
  idempotency: "none" | "key" | "conditional";
  input: z.ZodType<I>;
  result: z.ZodTypeAny;
  timeoutMs: number;
  maxResultChars: number;
  /** The resources this exact input touches; checked against the grants before anything is read or sent. */
  requires(input: I): Requirement[];
  /** Content that came from outside (pages, files, mail) is labelled untrusted for every model that later reads it. */
  untrusted: boolean;
};
export type Prepared = { target: string; summary: string; effects: string[]; data: string[]; changes: string[]; preview: string; reversible: boolean; payload: unknown };
export type ActionContext = {
  taskId: string; stepId: string; idempotencyKey: string; signal: AbortSignal; grants: Grants;
  outputOf(stepId: string): string | null; now(): number;
};
export type ConnectorOutcome = { ok: true; result: unknown; receipt?: string } | { ok: false; error: string; dispatched: boolean; definite?: boolean; /** a scope refusal discovered at run time (a link to an ungranted site) */ denied?: boolean };
export type Connector<I> = {
  contract: ActionContract<I>;
  /** Host-registry checks the grant alone cannot make (is the root registered, is the account connected). */
  available?(requirement: Requirement): string | null;
  /** Consequential actions only: read-only resolution of exactly what would happen. */
  prepare?(input: I, ctx: ActionContext): Promise<Prepared>;
  run(input: I, ctx: ActionContext, prepared: Prepared | null): Promise<ConnectorOutcome>;
  verify?(input: I, ctx: ActionContext): Promise<{ found: boolean; result?: unknown; receipt?: string }>;
};

/** Connector results also drop cookie, session-id and CSRF values a page or file may print. */
const RESULT_SECRETS = [/\b(set-cookie|cookie|session(?:[_-]?id)?|sid|jsessionid|phpsessid|connect\.sid|csrf(?:[_-]?token)?|xsrf(?:[_-]?token)?)\s*[:=]\s*["']?[^\s"';,\]]{8,}/i];
const GLOBAL_SECRETS = [...CHECKPOINT_SECRET_PATTERNS.map(rule => rule.pattern), ...RESULT_SECRETS].map(pattern => new RegExp(pattern.source, pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`));
/** Credentials, tokens and cookies never reach a task output, a model prompt or a log. */
export function redactSecrets(text: string): string {
  return GLOBAL_SECRETS.reduce((out, pattern) => out.replace(pattern, "[redacted credential]"), text);
}

/** Pure grant check: one requirement against the envelope's grants. Returns the refusal, or null. */
export function grantProblem(requirement: Requirement, grants: Grants | undefined): string | null {
  if (!grants) return "This task's envelope grants no connected resources.";
  switch (requirement.kind) {
    case "file": {
      const grant = grants.files.find(g => g.root === requirement.root);
      if (!grant) return `Folder "${requirement.root}" is not granted to this task.`;
      return requirement.access === "write" && grant.access !== "write" ? `Folder "${requirement.root}" is granted read-only.` : null;
    }
    case "origin":
      return grants.origins.includes(requirement.origin) ? null : `Site ${requirement.origin} is not granted to this task.`;
    case "service": {
      const grant = grants.services.find(g => g.connector === requirement.connector && g.account === requirement.account);
      if (!grant) return `The ${requirement.connector} account "${requirement.account}" is not granted to this task.`;
      if (SERVICE_ACCESS.indexOf(grant.access) < SERVICE_ACCESS.indexOf(requirement.access)) return `The ${requirement.connector} grant allows ${grant.access}, not ${requirement.access}.`;
      const outside = requirement.recipients.filter(r => !grant.recipients.map(x => x.toLowerCase()).includes(r.toLowerCase()));
      return outside.length ? `Recipients not granted: ${outside.join(", ")}.` : null;
    }
  }
}

type ReceiptRow = { seq: number; at: number; taskId: string; stepId: string; kind: string; event: string; payloadSha256: string | null; resultSha256: string | null; detail: string; prevSha256: string; entrySha256: string };
const GENESIS = "0".repeat(64);
/** Append-only, hash-chained action receipts. Detail is sanitized and bounded; content and credentials never land here. */
export class ActionLedger {
  readonly host: HostDatabase;
  constructor(host: HostDatabase) {
    this.host = host;
    host.db.exec(`CREATE TABLE IF NOT EXISTS ma4_action_receipts(seq INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,task_id TEXT NOT NULL,step_id TEXT NOT NULL,kind TEXT NOT NULL,event TEXT NOT NULL,payload_sha256 TEXT,result_sha256 TEXT,detail TEXT NOT NULL,prev_sha256 TEXT NOT NULL,entry_sha256 TEXT NOT NULL);
      CREATE INDEX IF NOT EXISTS ma4_action_receipts_task ON ma4_action_receipts(task_id,seq);
      INSERT OR IGNORE INTO migrations(key) VALUES('ma4.action-receipts.v1');`);
  }
  private static hash(prev: string, e: Omit<ReceiptRow, "seq" | "prevSha256" | "entrySha256">) { return sha256(`${prev}\n${canonical(e)}`); }
  record(e: { at: number; taskId: string; stepId: string; kind: string; event: string; payloadSha256?: string | null; resultSha256?: string | null; detail?: string }): ReceiptRow {
    const entry = { at: e.at, taskId: e.taskId, stepId: e.stepId, kind: e.kind, event: e.event, payloadSha256: e.payloadSha256 ?? null, resultSha256: e.resultSha256 ?? null, detail: redactSecrets(e.detail ?? "").slice(0, 300) };
    const db = this.host.db;
    db.exec("BEGIN IMMEDIATE");
    try {
      const last = db.prepare("SELECT entry_sha256 FROM ma4_action_receipts ORDER BY seq DESC LIMIT 1").get() as { entry_sha256: string } | undefined;
      const prevSha256 = last?.entry_sha256 ?? GENESIS, entrySha256 = ActionLedger.hash(prevSha256, entry);
      const r = db.prepare("INSERT INTO ma4_action_receipts(at,task_id,step_id,kind,event,payload_sha256,result_sha256,detail,prev_sha256,entry_sha256) VALUES(?,?,?,?,?,?,?,?,?,?)")
        .run(entry.at, entry.taskId, entry.stepId, entry.kind, entry.event, entry.payloadSha256, entry.resultSha256, entry.detail, prevSha256, entrySha256);
      db.exec("COMMIT");
      return { seq: Number(r.lastInsertRowid), ...entry, prevSha256, entrySha256 };
    } catch (error) { db.exec("ROLLBACK"); throw error; }
  }
  list(taskId: string, limit = 200): ReceiptRow[] {
    return this.host.db.prepare("SELECT seq,at,task_id AS taskId,step_id AS stepId,kind,event,payload_sha256 AS payloadSha256,result_sha256 AS resultSha256,detail,prev_sha256 AS prevSha256,entry_sha256 AS entrySha256 FROM ma4_action_receipts WHERE task_id=? ORDER BY seq DESC LIMIT ?").all(taskId, limit).reverse() as ReceiptRow[];
  }
  /** Recomputes the whole chain. */
  verify(): { ok: true; entries: number } | { ok: false; brokenAt: number } {
    let prev = GENESIS, n = 0;
    for (const row of this.host.db.prepare("SELECT seq,at,task_id AS taskId,step_id AS stepId,kind,event,payload_sha256 AS payloadSha256,result_sha256 AS resultSha256,detail,prev_sha256 AS prevSha256,entry_sha256 AS entrySha256 FROM ma4_action_receipts ORDER BY seq").all() as ReceiptRow[]) {
      const { seq: _seq, prevSha256, entrySha256, ...entry } = row;
      if (prevSha256 !== prev || ActionLedger.hash(prev, entry) !== entrySha256) return { ok: false, brokenAt: row.seq };
      prev = entrySha256; n++;
    }
    return { ok: true, entries: n };
  }
}

const issues = (error: z.ZodError) => error.issues.slice(0, 4).map(i => `${i.path.join(".") || "input"}: ${i.message}`).join("; ");
type StepInput = StepSpec["input"];

/**
 * The only way a connector becomes runnable: wrapped as a task executor behind the broker. The task runtime around it
 * already commits "started" before this runs and the receipt after, fences stale workers and turns an unknown outcome of
 * an irreversible action into UNCERTAIN; the broker adds the per-action scope, approval and receipt rules.
 */
export function brokered<I>(connector: Connector<I>, ledger: ActionLedger): Executor {
  const c = connector.contract;
  if (c.consequential && !connector.prepare) throw new Error(`Consequential action ${c.kind} needs a prepare() that shows exactly what will happen.`);
  if (c.category === "idempotent" && !connector.verify) throw new Error(`Idempotent action ${c.kind} needs verify().`);
  const scope = (input: I, grants: Grants | undefined) => c.requires(input).flatMap(r => { const p = grantProblem(r, grants) ?? connector.available?.(r) ?? null; return p ? [p] : []; });
  const context = (ctx: Pick<StepContext, "taskId" | "stepId" | "idempotencyKey" | "signal" | "outputOf" | "now">, envelope: Envelope): ActionContext =>
    ({ taskId: ctx.taskId, stepId: ctx.stepId, idempotencyKey: ctx.idempotencyKey, signal: ctx.signal, grants: envelope.grants!, outputOf: ctx.outputOf, now: ctx.now });
  const finish = (ctx: { taskId: string; stepId: string; now(): number }, result: unknown, receipt: string | undefined): StepResult => {
    const parsed = c.result.safeParse(result);
    if (!parsed.success) {
      ledger.record({ at: ctx.now(), taskId: ctx.taskId, stepId: ctx.stepId, kind: c.kind, event: "result_rejected", detail: issues(parsed.error) });
      // After a side effect, a result we cannot read is an unknown outcome, never a success.
      return { ok: false, error: `The ${c.connector} result did not match its contract.`, dispatched: true, definite: !c.sideEffect };
    }
    const output = redactSecrets(JSON.stringify({ schema: RESULT_SCHEMA, kind: c.kind, connector: c.connector, trust: c.untrusted ? "untrusted" : "host", result: parsed.data }));
    if (output.length > c.maxResultChars) {
      ledger.record({ at: ctx.now(), taskId: ctx.taskId, stepId: ctx.stepId, kind: c.kind, event: "result_rejected", detail: `result of ${output.length} characters exceeds ${c.maxResultChars}` });
      return { ok: false, error: `The result exceeds the ${c.maxResultChars}-character limit for ${c.kind}.`, dispatched: true, definite: true, fatal: "STEP_FAILED" };
    }
    const row = ledger.record({ at: ctx.now(), taskId: ctx.taskId, stepId: ctx.stepId, kind: c.kind, event: "succeeded", resultSha256: sha256(output), detail: receipt ? `provider receipt ${receipt}` : "" });
    return { ok: true, output, receipt: receipt ?? `receipt:${row.entrySha256}` };
  };
  return {
    kind: c.kind, category: c.category, gpu: false, sideEffect: c.sideEffect, consequential: c.consequential, activity: c.activity, timeoutMs: c.timeoutMs,
    preflight(raw: StepInput, envelope: Envelope) {
      const parsed = c.input.safeParse(raw);
      return parsed.success ? scope(parsed.data, envelope.grants) : [`invalid ${c.kind} input (${issues(parsed.error)})`];
    },
    async run(raw, ctx) {
      const at = ctx.now(), base = { taskId: ctx.taskId, stepId: ctx.stepId, kind: c.kind };
      const parsed = c.input.safeParse(raw);
      if (!parsed.success) { ledger.record({ ...base, at, event: "refused", detail: issues(parsed.error) }); return { ok: false, error: `Invalid ${c.kind} input: ${issues(parsed.error)}`, dispatched: false, fatal: "VALIDATION" }; }
      // Re-checked at execution, not only at creation: a root unregistered or an account removed since then refuses now.
      const denied = scope(parsed.data, ctx.envelope.grants);
      if (denied.length) { ledger.record({ ...base, at, event: "refused", detail: denied.join(" ") }); return { ok: false, error: denied.join(" "), dispatched: false, fatal: "PERMISSION_DENIED" }; }
      const actx = context(ctx, ctx.envelope);
      let prepared: Prepared | null = null, payloadSha256: string | null = null;
      if (c.consequential) {
        try { prepared = await connector.prepare!(parsed.data, actx); }
        catch (error) { const detail = error instanceof Error ? error.message : String(error); ledger.record({ ...base, at: ctx.now(), event: "prepare_failed", detail }); return { ok: false, error: redactSecrets(detail).slice(0, 300), dispatched: false }; }
        payloadSha256 = sha256(canonical({ schema: ACTION_SCHEMA, kind: c.kind, payload: prepared.payload }));
        const approval = ctx.approval;
        if (!approval || approval.payloadSha256 !== payloadSha256 || approval.expiresAt <= ctx.now()) {
          ledger.record({ ...base, at: ctx.now(), event: approval ? (approval.payloadSha256 !== payloadSha256 ? "approval_invalidated" : "approval_expired") : "proposed", payloadSha256, detail: prepared.summary });
          const now = ctx.now();
          const proposal: ActionProposal = { actionId: `act-${randomUUID()}`, stepId: ctx.stepId, kind: c.kind, connector: c.connector, target: prepared.target.slice(0, 120), summary: prepared.summary.slice(0, 200),
            effects: prepared.effects.slice(0, 8).map(e => e.slice(0, 160)), reversible: prepared.reversible, data: prepared.data.slice(0, 12).map(e => redactSecrets(e).slice(0, 300)),
            changes: prepared.changes.slice(0, 20).map(e => redactSecrets(e).slice(0, 300)), preview: redactSecrets(prepared.preview).slice(0, 12_000), payloadSha256, proposedAt: now, expiresAt: now + 15 * 60_000 };
          return { ok: false, error: "Waiting for your permission.", dispatched: false, proposal };
        }
        ledger.record({ ...base, at: ctx.now(), event: "authorized", payloadSha256, detail: `owner approval at ${approval.at}` });
      }
      ledger.record({ ...base, at: ctx.now(), event: "dispatched", payloadSha256 });
      let outcome: ConnectorOutcome;
      try { outcome = await connector.run(parsed.data, actx, prepared); }
      catch (error) { outcome = { ok: false, error: error instanceof Error ? error.message : String(error), dispatched: c.sideEffect, definite: !c.sideEffect }; }
      if (!outcome.ok) {
        const error = redactSecrets(outcome.error).slice(0, 300);
        if (outcome.denied) { ledger.record({ ...base, at: ctx.now(), event: "refused", payloadSha256, detail: error }); return { ok: false, error, dispatched: false, fatal: "PERMISSION_DENIED" }; }
        ledger.record({ ...base, at: ctx.now(), event: outcome.dispatched && !outcome.definite ? "outcome_unknown" : "failed", payloadSha256, detail: error });
        return outcome.dispatched ? { ok: false, error, dispatched: true, definite: !!outcome.definite } : { ok: false, error, dispatched: false };
      }
      return finish(ctx, outcome.result, outcome.receipt);
    },
    ...(connector.verify ? {
      async verify(key: string, signal: AbortSignal, raw?: StepInput, envelope?: Envelope, more?: Pick<StepContext, "taskId" | "stepId" | "outputOf" | "now">) {
        const parsed = c.input.safeParse(raw ?? {});
        if (!parsed.success || !envelope || !more) return { found: false };
        if (scope(parsed.data, envelope.grants).length) return { found: false };
        const found = await connector.verify!(parsed.data, context({ ...more, idempotencyKey: key, signal }, envelope));
        ledger.record({ at: more.now(), taskId: more.taskId, stepId: more.stepId, kind: c.kind, event: found.found ? "verified_applied" : "verified_absent", detail: found.receipt ?? "" });
        if (!found.found) return { found: false };
        const done = finish(more, found.result ?? {}, found.receipt);
        return done.ok ? { found: true, output: done.output, receipt: done.receipt } : { found: false };
      },
    } : {}),
  };
}
