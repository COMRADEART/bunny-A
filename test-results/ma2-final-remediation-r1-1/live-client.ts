import { readFileSync, writeFileSync } from "node:fs";

/** Authorized production acceptance client; canonical private credentials read in memory only. */
export const STAGE_ROOT = "C:/Users/allam/AppData/Local/Bunny-A";
export const STAGE_STATE = STAGE_ROOT + "/state";
export const STAGE_WORKSPACE = "C:/Users/allam/Bunny-Workspace";
export const REC = "C:/Users/allam/Documents/new/bun-router/test-results/ma2-final-remediation-r1-1";
export const BASE = "http://127.0.0.1:43119";

export function bearer(): string {
  const file = STAGE_STATE + "/credentials/credentials.json";
  return (JSON.parse(readFileSync(file, "utf8")) as { token: string }).token;
}

async function send<T>(method: "GET" | "POST", path: string, body?: unknown): Promise<{ status: number; body: T }> {
  const headers: Record<string, string> = { authorization: "Bearer " + bearer() };
  if (body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(BASE + path, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  let parsed: unknown = null;
  try { parsed = await response.json(); } catch { parsed = null; }
  return { status: response.status, body: parsed as T };
}

export function cmd<T = any>(action: string, data: Record<string, unknown> = {}): Promise<{ status: number; body: T }> {
  return send<T>("POST", "/command", { action, data });
}
export function get<T = any>(path: string): Promise<{ status: number; body: T }> { return send<T>("GET", path); }

export type Health = { app: string; pid: number; instanceId: string; operationalState: string; unavailableSubsystems: string[] };
export async function health(): Promise<Health> { return (await get<Health>("/health")).body; }

export type EventRow = { id: number; type: string; detail: string; missionId: string | null; createdAt?: number };

export type OfferView = {
  family: "computer"; actions: string[]; counts: Record<string, number>;
  maxActions: number; ttlMs: number; riskCeiling: string; targetLabel: string;
  target: { app: string | null; processId: number | null; title: string | null };
  targetTier: string; readOnly: string[];
};
export type RequestView = {
  id: string; missionId: string; stepId: string; action: string; risk: string; reason: string;
  createdAt: number; resolvedAt: number | null; resolution: string | null; resolvedBy: string | null;
  batchOffer: OfferView | null;
};
export type BatchView = {
  id: string; maxActions: number; usedCount: number; targetLabel: string;
  createdAt: number; expiresAt: number; status: "active" | "ended"; endReason: string | null;
};
export type StepView = {
  id: string; index: number; role: string; objective: string; dependsOn: string[]; state: string;
  taskId: string | null; approvedOnce: { requestId: string; action: string } | null;
  executor: { kind: string; action?: string; skillId?: string; params?: Record<string, unknown> };
  pendingRequestId: string | null; failure: { category: string; detail: string } | null;
};
export type MissionView = {
  id: string; title: string; objective: string; mode: string; state: string;
  root: string; authorizationId: string | null;
  steps: StepView[]; requests: RequestView[]; artifacts: unknown[]; batch: BatchView | null;
};
export type HostState = {
  app: string; pid: number;
  missions?: {
    enabled: boolean; missions: MissionView[]; capabilities?: { id: string; availability: string }[];
    config?: Record<string, unknown>;
  };
  events?: EventRow[];
};

export async function getState(): Promise<HostState> { return (await get<HostState>("/state")).body; }

/** mission.get — the richest per-mission view: mission view + events + runs + authorization. */
export async function getMission(id: string): Promise<{
  mission: MissionView; events: EventRow[]; memory: unknown[];
  authorization: { id: string; revokedAt: number | null; expiresAt: number; computer: { enabled: boolean }; capabilities: string[]; riskClasses: string[] } | null;
  runs: RunView[];
}> {
  const out = await cmd<{ data: { mission: MissionView; events: EventRow[]; memory: unknown[]; authorization: never; runs: RunView[] } }>("mission.get", { id });
  return out.body.data;
}

export type RunView = {
  id: string; missionId: string | null; stepId: string | null; action: string;
  status: string; summary: string | null; params: unknown; output: unknown;
  createdAt: number; finishedAt: number | null;
  /** Mission-get run rows carry `startedAt` (not `createdAt`); view rows always carry both. */
  startedAt?: number;
};

export const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function until<T>(
  probe: () => Promise<T | null | undefined | false>,
  what: string,
  options?: { timeoutMs?: number; each?: () => Promise<void> | void }
): Promise<T> {
  const started = Date.now();
  const timeoutMs = options?.timeoutMs ?? 60_000;
  for (;;) {
    const found = await probe();
    if (found) return found;
    if (Date.now() - started > timeoutMs) throw new Error(`Timed out waiting: ${what}`);
    if (options?.each) await options.each();
    await wait(200);
  }
}

/** Open an allowlist-backed capability run; confirmed:true is the direct surface's own explicit consent. */
export async function directRun(action: string, params: Record<string, unknown>, cwd?: string): Promise<{ status: number; body: Record<string, unknown> }> {
  const out = await cmd("capability.run", { action, params, ...(cwd ? { cwd } : {}), confirmed: true });
  return { status: out.status, body: out.body as Record<string, unknown> };
}

export function directOutcome(run: { status: number; body: Record<string, unknown> }): { decision: string; reason: string | null; risk: string | null; status: string; summary: string | null; output: unknown; evidence: unknown[] } {
  // The /command envelope is { snapshot, data } and data = { decision, run, result, artifactIds }
  // (an "ask" outcome carries run/result null; a deny outcome carries result null + a run row).
  const data = (run.body?.data ?? run.body) as Record<string, unknown> | null ?? {};
  const decision = (data.decision ?? {}) as { decision?: string; reason?: string | null; risk?: string };
  const result = (data.result ?? {}) as Record<string, unknown>;
  const runRow = (data.run ?? {}) as { status?: string; summary?: string | null };
  return {
    decision: decision.decision ?? "",
    reason: decision.reason ?? null,
    risk: decision.risk ?? null,
    status: (result.status as string) ?? runRow.status ?? "",
    summary: (result.summary as string) ?? runRow.summary ?? null,
    output: result.output ?? null,
    evidence: (result.evidence as unknown[]) ?? [],
  };
}

// ── mission setup ─────────────────────────────────────────────────────────────────────

export type PlanStep = { role: string; objective: string; executor: unknown };

/** Chain every step on the previous one so the mission runs strictly sequentially and predictably. */
export function chain(steps: PlanStep[]): unknown[] {
  return steps.map((step, index) => ({
    role: step.role,
    objective: step.objective,
    ...(index === 0 ? {} : { dependsOn: [index - 1] }),
    executor: step.executor,
  }));
}

export function capStep(role: string, action: string, params: Record<string, unknown>, objective: string): PlanStep {
  return { role, objective, executor: { kind: "capability", action, params } };
}

export async function createMission(input: { title: string; objective: string; steps: unknown[] }): Promise<MissionView> {
  const out = await cmd<{ mission?: MissionView }>("mission.create", {
    mode: "fast", objective: input.objective, title: input.title, steps: input.steps,
  });
  if (out.status !== 200) throw new Error(`mission.create failed (${out.status}): ${JSON.stringify(out.body)}`);
  return out.body.mission!;
}
export async function approveMission(id: string): Promise<MissionView> {
  const out = await cmd<{ mission?: MissionView }>("mission.approve", { id, start: true });
  if (out.status !== 200) throw new Error(`mission.approve failed (${out.status}): ${JSON.stringify(out.body)}`);
  return out.body.mission!;
}
export async function respond(requestId: string, decision: "allow_once" | "allow_batch" | "deny", options: { maxActions?: number; ttlMs?: number } = {}) {
  const data: Record<string, unknown> = { requestId, decision };
  if (options.maxActions !== undefined) data.maxActions = options.maxActions;
  if (options.ttlMs !== undefined) data.ttlMs = options.ttlMs;
  return cmd("mission.respond", data);
}

/** The un-answered requests of one mission's view (newest first, as stored). */
export const openRequests = (view: MissionView) => (view.requests ?? []).filter((r) => r.resolvedAt === null);

export async function waitOpenRequest(missionId: string, options?: { timeoutMs?: number; action?: string }): Promise<RequestView> {
  return until(async () => {
    const found = await getMission(missionId);
    if (found.mission.state === "completed" || found.mission.state === "failed" || found.mission.state === "stopped") return null;
    const open = openRequests(found.mission);
    if (!open.length) return null;
    return options?.action ? (open.find((r) => r.action === options.action) ?? null) : open[0];
  }, `an open permission request for ${missionId}`, options);
}

export async function waitMissionState(missionId: string, wanted: string[], options?: { timeoutMs?: number }): Promise<MissionView> {
  return until(async () => {
    const found = await getMission(missionId);
    return wanted.includes(found.mission.state) ? found.mission : null;
  }, `state ${wanted.join("|")} for ${missionId}`, options);
}

// ── records ───────────────────────────────────────────────────────────────────────────

export function saveRecord(name: string, value: unknown) {
  writeFileSync(REC + "/" + name, JSON.stringify(value, null, 2) + "\n");
}
export function phaseGuard(name: string) {
  let saved = false;
  return {
    ok(value: unknown) { saved = true; saveRecord(name, value); },
    fatal(error: unknown): never {
      const detail = error instanceof Error ? `${error.message}\n${error.stack ?? ""}` : String(error);
      if (!saved) saveRecord(name, { ok: false, error: detail });
      throw error;
    },
  };
}
