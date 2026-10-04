import type { ArtifactStore } from "../artifacts.server.ts";
import { decide } from "../authorization.server.ts";
import { redact, type MissionStore } from "../store.server.ts";
import { resolveCommand, type Resolved } from "./process.server.ts";
import { HostContainment, safeError } from "../../bunny-host/failure.server.ts";
import type {
  ActionManifest, AuthorizationEnvelope, CapabilityAvailability, CapabilityManifest, CapabilityResult, CapabilityRun, CapabilityStatus,
  PermissionDecision, RiskClass,
} from "../types.ts";

export type ExecutionContext = {
  missionId: string | null;
  stepId: string | null;
  /** Folder relative paths resolve against. */
  cwd: string;
  /** Every folder this execution may touch (approved project roots plus Host-owned workspaces). */
  roots: string[];
  dataDirectory: string;
  signal: AbortSignal;
  timeoutMs: number;
  /** Resolved before permission evaluation; terminal must launch this identity without a second PATH lookup. */
  executable?: Resolved | null;
};

/** A capability provider. Adapters report unavailable/unconfigured/unsupported truthfully; they never fake success. */
export interface CapabilityAdapter {
  manifest: CapabilityManifest;
  health(): Promise<{ availability: CapabilityAvailability; detail: string }>;
  execute(action: string, params: Record<string, unknown>, context: ExecutionContext): Promise<CapabilityResult>;
  /** Parameter-dependent escalation (e.g. `git reset --hard` is DESTRUCTIVE even though terminal.exec is EXECUTE). */
  riskFor?(action: string, params: Record<string, unknown>): RiskClass | null;
  close?(): Promise<void>;
}

export type CapabilityRequest = {
  action: string;
  params: Record<string, unknown>;
  missionId: string | null;
  stepId: string | null;
  envelope: AuthorizationEnvelope | null;
  origin: string;
  cwd: string;
  roots: string[];
  oneTime?: boolean;
  /** Matching action allowed for this capability invocation / this skill run; other skill actions still ask. */
  oneTimeAction?: string | null;
  direct?: { confirmed: boolean };
  timeoutMs?: number;
};
export type CapabilityOutcome = { decision: PermissionDecision; run: CapabilityRun | null; result: CapabilityResult | null; artifactIds: string[] };

const RANK: RiskClass[] = ["READ", "WRITE", "EXECUTE", "EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"];
const STATUS_FOR: Record<Exclude<CapabilityAvailability, "available" | "degraded">, CapabilityResult["status"]> = { unavailable: "unavailable", unconfigured: "unconfigured", unsupported: "unsupported" };

/**
 * The Bunny Capability Bus. Every deterministic action — filesystem, terminal, git, browser, computer,
 * connectors — passes the same permission decision, is recorded as a capability run with redacted
 * parameters, and emits normalized capability.* events.
 */
export class CapabilityBus {
  adapters = new Map<string, CapabilityAdapter>();
  health = new Map<string, { availability: CapabilityAvailability; detail: string; checkedAt: number }>();
  store: MissionStore; artifacts: ArtifactStore; dataDirectory: string;
  emit: (type: string, detail: string, missionId: string | null) => void;
  inFlight = new Map<string, AbortController>();
  settling = new Map<string, Promise<void>>();
  cancelledMissions = new Set<string>(); cancelledSteps = new Set<string>();
  containment: HostContainment;
  clearCancellation(missionId: string) { this.cancelledMissions.delete(missionId); }
  constructor(store: MissionStore, artifacts: ArtifactStore, dataDirectory: string, emit: (type: string, detail: string, missionId: string | null) => void, containment=new HostContainment()) {
    this.store = store; this.artifacts = artifacts; this.dataDirectory = dataDirectory; this.containment=containment;
    this.emit=(type,detail,missionId)=>{try {emit(type,detail,missionId);} catch(error) {containment.fatal(error,{subsystem:"capability-event-persistence",...(missionId ? {missionId} : {})});throw error;}};
  }
  register(adapter: CapabilityAdapter) {
    if (this.adapters.has(adapter.manifest.id)) throw new Error(`Capability ${adapter.manifest.id} is already registered.`);
    for (const action of adapter.manifest.actions) if (!action.id.startsWith(`${adapter.manifest.id}.`)) throw new Error(`Action ${action.id} must be namespaced under ${adapter.manifest.id}.`);
    this.adapters.set(adapter.manifest.id, adapter);
  }
  find(action: string): { adapter: CapabilityAdapter; manifest: ActionManifest } | null {
    const adapter = this.adapters.get(action.split(".")[0]);
    const manifest = adapter?.manifest.actions.find((item) => item.id === action);
    return adapter && manifest ? { adapter, manifest } : null;
  }
  async refreshHealth(): Promise<void> {
    await Promise.all([...this.adapters.values()].map(async (adapter) => {
      const platformOk = adapter.manifest.platforms === "any" || adapter.manifest.platforms.includes(process.platform);
      let result:{availability:CapabilityAvailability;detail:string};
      try { result=platformOk ? await adapter.health() : {availability:"unsupported",detail:`Not supported on ${process.platform}.`}; }
      catch(error) {result={availability:"unavailable",detail:`Health check failed: ${safeError(error).message}`};}
      this.health.set(adapter.manifest.id, { ...result, checkedAt: Date.now() });
    }));
  }
  list(): CapabilityStatus[] {
    return [...this.adapters.values()].map((adapter) => {
      const health = this.health.get(adapter.manifest.id);
      return { ...adapter.manifest, availability: health?.availability ?? "unavailable", detail: health?.detail ?? "Not checked yet.", checkedAt: health?.checkedAt ?? null };
    });
  }
  availability(action: string): CapabilityAvailability {
    const found = this.find(action);
    if (!found) return "unsupported";
    return this.health.get(found.adapter.manifest.id)?.availability ?? "unavailable";
  }
  riskOf(action: string, params: Record<string, unknown>): RiskClass | null {
    const found = this.find(action); if (!found) return null;
    const escalated = found.adapter.riskFor?.(action, params) ?? null;
    return escalated && RANK.indexOf(escalated) > RANK.indexOf(found.manifest.risk) ? escalated : found.manifest.risk;
  }
  /** Permission decision only; no side effects. */
  decision(request: CapabilityRequest, executable?: Resolved | null): PermissionDecision {
    const found = this.find(request.action);
    if (!found) return { decision: "deny", reason: `Unknown capability action ${request.action}.`, risk: "READ" };
    const risk = this.riskOf(request.action, request.params) ?? found.manifest.risk;
    return decide({ ...found.manifest, risk }, request.params, { envelope: request.envelope, missionId: request.missionId, grants: this.store.grants(), oneTime: request.oneTime || (!!request.oneTimeAction && request.oneTimeAction === request.action), direct: request.direct, base: request.cwd, executable });
  }
  async cancel(filter: { missionId?: string; stepId?: string }) {
    if (filter.missionId) this.cancelledMissions.add(filter.missionId);
    if (filter.stepId) this.cancelledSteps.add(filter.stepId);
    const settling: Promise<void>[] = [];
    for (const [runId, controller] of this.inFlight) {
      const run = this.store.run(runId);
      if ((filter.missionId && run.missionId === filter.missionId) || (filter.stepId && run.stepId === filter.stepId)) {
        controller.abort(new Error("Cancelled by Bunny-A."));
        const done = this.settling.get(runId); if (done) settling.push(done);
      }
    }
    await Promise.all(settling);
  }
  /**
   * Decides, then (only when allowed) executes and records. An "ask" decision executes nothing and
   * returns no run; the caller turns it into a permission request.
   */
  async request(request: CapabilityRequest): Promise<CapabilityOutcome> {
    this.containment.assertAccepting(request.action.split(".")[0]);
    this.containment.assertAccepting("capability-health");
    const found = this.find(request.action);
    const executable = request.action === "terminal.exec" ? resolveCommand(String(request.params.command ?? ""), request.cwd) : undefined;
    const cancelled = request.missionId && this.cancelledMissions.has(request.missionId) || request.stepId && this.cancelledSteps.has(request.stepId);
    const decision: PermissionDecision = cancelled ? { decision: "deny", reason: "Execution was cancelled by Bunny-A.", risk: this.riskOf(request.action, request.params) ?? "READ" } : this.decision(request, executable);
    // Typed text and file bodies may be private; records keep their size, not their content.
    const recorded = { ...request.params };
    for (const key of ["text", "content"]) if (typeof recorded[key] === "string") recorded[key] = `[${(recorded[key] as string).length} characters]`;
    const params = redact(recorded) as Record<string, unknown>;
    this.emit("capability.requested", `${request.action} requested by ${request.origin}${request.stepId ? ` (step ${request.stepId})` : ""}.`, request.missionId);
    if (decision.decision === "ask") { this.emit("authorization.required", `${request.action}: ${decision.reason}`, request.missionId); return { decision, run: null, result: null, artifactIds: [] }; }
    const startedAt = Date.now();
    const base: CapabilityRun = {
      id: crypto.randomUUID(), action: request.action, capability: request.action.split(".")[0], missionId: request.missionId, stepId: request.stepId,
      risk: decision.risk, decision: decision.decision, decisionReason: decision.reason, params, status: "running", summary: "", evidence: [], artifactIds: [],
      startedAt, finishedAt: null, durationMs: null, origin: request.origin,
    };
    let terminal:CapabilityOutcome|null=null;
    const finish = (status: CapabilityRun["status"], summary: string, result: CapabilityResult | null, artifactIds: string[] = []): CapabilityOutcome => {
      if(terminal) return terminal;
      const finishedAt = Date.now();
      const run = { ...base, ...(result?.cleanup ? { cleanup: result.cleanup } : {}), status, summary: summary.slice(0, 2000), evidence: result?.evidence.slice(0, 40) ?? [], artifactIds, finishedAt, durationMs: finishedAt - startedAt };
      this.store.host.transaction(()=>{this.store.saveRun(run);this.emit(status === "succeeded" ? "capability.completed" : "capability.failed", `${request.action} ${status}: ${run.summary}`, request.missionId);});
      terminal={decision,run,result,artifactIds};
      return terminal;
    };
    if (decision.decision === "deny") { this.emit("authorization.denied", `${request.action}: ${decision.reason}`, request.missionId); return finish("denied", decision.reason, null); }
    if (!found) return finish("unsupported", "Unknown capability action.", null);
    const availability = this.health.get(found.adapter.manifest.id)?.availability ?? "unavailable";
    if (availability !== "available" && availability !== "degraded") {
      return finish(STATUS_FOR[availability], this.health.get(found.adapter.manifest.id)?.detail ?? `${found.adapter.manifest.id} is ${availability}.`, { ok: false, status: STATUS_FOR[availability], summary: `${found.adapter.manifest.id} is ${availability}.`, output: null, evidence: [], errorCategory: "capability_unavailable" });
    }
    this.emit("authorization.granted", `${request.action}: ${decision.reason}`, request.missionId);
    this.store.host.transaction(()=>{this.store.saveRun(base);this.emit("capability.started", `${request.action} started.`, request.missionId);});
    const controller = new AbortController(); this.inFlight.set(base.id, controller);
    let settled!: () => void;
    this.settling.set(base.id, new Promise<void>((done) => { settled = done; }));
    const timeoutMs = Math.min(request.timeoutMs ?? found.manifest.timeoutMs, 30 * 60_000);
    const timer = setTimeout(() => controller.abort(new Error(`Timed out after ${timeoutMs} ms.`)), timeoutMs);
    try {
    let result: CapabilityResult;
    try {
      result = await found.adapter.execute(request.action, request.params, { missionId: request.missionId, stepId: request.stepId, cwd: request.cwd, roots: request.roots, dataDirectory: this.dataDirectory, signal: controller.signal, timeoutMs, executable });
    } catch (error) {
      const message = safeError(error).message;
      const timedOut = controller.signal.aborted && /timed out/i.test(String(controller.signal.reason));
      result = { ok: false, status: timedOut ? "timeout" : "failed", summary: message, output: null, evidence: [], errorCategory: timedOut ? "timeout" : "capability_failed" };
      await this.containment.contain(error,"boundary",{owner:{subsystem:base.capability,capabilityRunId:base.id,...(request.missionId ? {missionId:request.missionId} : {}),...(request.stepId ? {stepId:request.stepId} : {})}});
    }
    if(controller.signal.aborted && result.ok) result={ok:false,status:"failed",summary:"Execution was cancelled; late success was discarded.",output:null,evidence:[],errorCategory:"user_stopped",cleanup:result.cleanup};
    const artifactIds: string[] = [];
    if (request.missionId) for (const item of result.artifacts ?? []) {
      try { artifactIds.push((await this.artifacts.create({ missionId: request.missionId, stepId: request.stepId, type: item.type, title: item.title, inline: item.inline, path: item.path, mediaType: item.mediaType, provenance: `bunny:capability:${base.id}`, verification: "unverified" })).id); }
      catch (error) { result.evidence.push(`Artifact not stored: ${safeError(error).message}`); }
    }
    return finish(result.status, result.summary, result, artifactIds);
    } catch(error) {
      if(terminal) return terminal;
      const message=safeError(error).message;
      try {return finish("failed",message,{ok:false,status:"failed",summary:message,output:null,evidence:[],errorCategory:"capability_failed"});}
      catch(persistenceError) {this.containment.fatal(persistenceError,{subsystem:"persistence",capabilityRunId:base.id});throw persistenceError;}
    } finally { clearTimeout(timer); this.inFlight.delete(base.id); this.settling.delete(base.id); settled(); }
  }
  async close() {
    for (const controller of this.inFlight.values()) controller.abort(new Error("Bunny Capability Bus closed."));
    await Promise.all(this.settling.values());
    for (const adapter of this.adapters.values()) await adapter.close?.().catch(() => {});
  }
}
