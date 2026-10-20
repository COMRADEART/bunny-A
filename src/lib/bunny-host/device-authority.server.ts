import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { CommandRefusedError } from "./failure.server.ts";
import type { ActionManifest, RiskClass } from "../bunny-missions/types.ts";
import type { HostSnapshot, SnapshotViewer } from "./contracts.ts";
import type { OrchTask } from "../orch/types.ts";
import type { ProjectDetail } from "./project-types.ts";
import { connectionDeviceView } from "./connections.ts";
import { publicTask } from "./presentation.ts";
import { isRemoteOllamaTag } from "../orch/exec.server.ts";

/**
 * M-A-3 T9: the Host-side authority for paired devices. A paired device is a thin remote client of
 * this Host; it never gains a second runtime, scheduler or authorization engine. Everything here only
 * narrows what the existing Host commands already allow.
 */

/** Absolute device session lifetime: the existing gateway cookie Max-Age (31536000 s), now enforced by the Host. */
export const DEVICE_SESSION_MS = 365 * 24 * 60 * 60 * 1000;
/** A device unused for this long must pair again; the workstation issues the new code. */
export const DEVICE_IDLE_MS = 30 * 24 * 60 * 60 * 1000;
export const DEVICE_ROLE = "paired-device" as const;
/**
 * Risk classes whose approval stays on the Windows Host: the Host's own always-ask set (external side
 * effects, destructive changes). Paired devices keep their existing MA0/MA2 right to answer other exact
 * Host offers; this boundary only removes what needs local owner consent.
 */
export const WORKSTATION_ONLY_RISKS: readonly RiskClass[] = ["EXTERNAL_SIDE_EFFECT", "DESTRUCTIVE"];
/** Provider routes a paired device may launch: text-only local generation with no workspace tools. */
export const TOOL_FREE_PROVIDERS: ReadonlySet<string> = new Set(["ollama"]);
/**
 * A task a paired device may launch: local tool-free inference only, never a hosted (cloud) Ollama tag. M-A-3
 * T9R: a tag Ollama's own probe reported as remote (remote_host/remote_model, kept in `remoteModels`) is hosted
 * even without a cloud suffix, and an empty model is never launchable.
 */
export function deviceMayLaunch(task: Pick<OrchTask, "provider" | "model">, remoteModels: readonly string[] = []) {
  const model = task.model ?? "";
  return TOOL_FREE_PROVIDERS.has(task.provider) && !!model && !isRemoteOllamaTag({ name: model }) && !remoteModels.includes(model);
}
export const APPROVAL_ON_HOST = "Approval required on Windows Host.";

/** A refusal whose bounded explanation the phone renders as "requires the Windows Host". */
export class WorkstationRequiredError extends CommandRefusedError {
  code = "WORKSTATION_REQUIRED" as const;
  constructor(message: string) {
    super(message);
    this.name = "WorkstationRequiredError";
  }
}
export const isDeviceActor = (actor: string) => actor.startsWith("device:");

export type DeviceRight = "read" | "supervise" | "answer" | "chat" | "self";
/**
 * Default-deny rights of the single paired-device role. An action absent here is refused at the HTTP
 * boundary before any dispatch. "answer" actions are further limited by the device approval ceiling in
 * the canonical mission/agent command paths; "self" actions only ever target the calling device.
 */
export const DEVICE_RIGHTS: Readonly<Record<string, DeviceRight>> = {
  "connections.review_request": "chat",
  "agent.list": "read",
  "agent.get": "read",
  "mission.get": "read",
  "project.list": "read",
  "project.get": "read",
  "project.artifact": "read",
  "operation.status": "read",
  "agent.pause": "supervise",
  "agent.resume": "supervise",
  "agent.stop": "supervise",
  "agent.authorization.deny": "supervise",
  "agent.authorization.revoke": "supervise",
  "mission.stop": "supervise",
  "mission.revoke_batch": "supervise",
  "inbox.ack": "supervise",
  stop: "supervise",
  "agent.authorization.approve": "answer",
  "mission.approve": "answer",
  "mission.start": "answer",
  "mission.respond": "answer",
  approve: "answer",
  submit: "chat",
  "task.feedback": "chat",
  "device.revoke": "self",
};
export function deviceRight(action: string): DeviceRight | null {
  return Object.hasOwn(DEVICE_RIGHTS, action) ? DEVICE_RIGHTS[action] : null;
}
/** Refuses a device action outside the paired-device role before it reaches any command path. */
export function assertDeviceAction(action: string): DeviceRight {
  const right = deviceRight(action);
  if (!right)
    throw new WorkstationRequiredError(
      `${action || "This action"} requires workstation access on the Windows Host.`,
    );
  return right;
}
/** Actions that change Host state. Reads are never ledgered or epoch-bound. */
export function mutating(action: string) {
  return deviceRight(action) !== "read" && action !== "session.get";
}

/**
 * Why a paired device may not answer this Host-offered request, or null when it may. Applied inside the
 * canonical decision paths, so no client field can widen what the device approves.
 */
export function deviceApprovalRefusal(
  risk: RiskClass | null | undefined,
  manifest: Pick<ActionManifest, "sensitive" | "hardApproval"> | null | undefined,
): string | null {
  if (!risk || WORKSTATION_ONLY_RISKS.includes(risk) || manifest?.sensitive || manifest?.hardApproval)
    return APPROVAL_ON_HOST;
  return null;
}

export type DevicePrincipal = {
  kind: "device";
  id: string;
  name: string;
  pairedAt: number;
  expiresAt: number;
};
export type Principal = { kind: "workstation" } | DevicePrincipal;
export type DeviceAuthFailure = "AUTH_REQUIRED" | "DEVICE_REVOKED" | "DEVICE_EXPIRED";
export type DeviceAuth = { ok: true; device: DevicePrincipal } | { ok: false; code: DeviceAuthFailure };
export const actorOf = (principal: Principal) =>
  principal.kind === "workstation" ? "workstation" : `device:${principal.id}`;

/** Additive tables only: the protected `devices` rows are never rewritten by authentication or presence. */
export function ensureDeviceSchema(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS host_identity(key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS device_presence(device_id TEXT PRIMARY KEY, last_seen_at INTEGER NOT NULL, last_action TEXT);`);
}
/** One stable identity per Host installation; the per-boot instanceId remains the epoch. */
export function hostId(db: DatabaseSync): string {
  db.prepare("INSERT OR IGNORE INTO host_identity(key,value) VALUES('host_id',?)").run(randomUUID());
  return (db.prepare("SELECT value FROM host_identity WHERE key='host_id'").get() as { value: string }).value;
}

/**
 * Authenticates one presented device credential on every request: present, unrevoked, within its
 * absolute lifetime and not idle beyond DEVICE_IDLE_MS (measured from the last authenticated use, or
 * from pairing when the device was never seen). The expiry is the earlier of the two bounds.
 */
export function authenticateDevice(
  db: DatabaseSync,
  tokenHash: string,
  now = Date.now(),
  limits: { sessionMs?: number; idleMs?: number } = {},
): DeviceAuth {
  const sessionMs = limits.sessionMs ?? DEVICE_SESSION_MS;
  const idleMs = limits.idleMs ?? DEVICE_IDLE_MS;
  const row = db
    .prepare(
      "SELECT d.id,d.name,d.created_at AS createdAt,d.revoked_at AS revokedAt,p.last_seen_at AS lastSeenAt FROM devices d LEFT JOIN device_presence p ON p.device_id=d.id WHERE d.token_hash=?",
    )
    .get(tokenHash) as
    | { id: string; name: string; createdAt: number; revokedAt: number | null; lastSeenAt: number | null }
    | undefined;
  if (!row) return { ok: false, code: "AUTH_REQUIRED" };
  if (row.revokedAt !== null) return { ok: false, code: "DEVICE_REVOKED" };
  const expiresAt = deviceExpiresAt(row.createdAt, row.lastSeenAt, sessionMs, idleMs);
  if (expiresAt <= now) return { ok: false, code: "DEVICE_EXPIRED" };
  return { ok: true, device: { kind: "device", id: row.id, name: row.name, pairedAt: row.createdAt, expiresAt } };
}
/** Re-checks the exact credential for an open stream: still present, unrevoked and unexpired. */
export function deviceStillValid(
  db: DatabaseSync,
  id: string,
  tokenHash: string,
  now = Date.now(),
  limits: { sessionMs?: number; idleMs?: number } = {},
) {
  const auth = authenticateDevice(db, tokenHash, now, limits);
  return auth.ok && auth.device.id === id;
}

/**
 * last_seen_at is written at most once per interval per device. It extends the idle bound only, never
 * the absolute lifetime, and it is never written for a refused credential.
 */
export class DevicePresence {
  db: DatabaseSync;
  intervalMs: number;
  written = new Map<string, number>();
  constructor(db: DatabaseSync, intervalMs = 30_000) {
    this.db = db;
    this.intervalMs = intervalMs;
  }
  touch(deviceId: string, action: string, now = Date.now()) {
    const last = this.written.get(deviceId) ?? 0;
    if (now - last < this.intervalMs) return;
    this.written.delete(deviceId);
    this.written.set(deviceId, now);
    if (this.written.size > 1000) this.written.delete(this.written.keys().next().value!);
    this.db
      .prepare(
        "INSERT INTO device_presence(device_id,last_seen_at,last_action) VALUES(?,?,?) ON CONFLICT(device_id) DO UPDATE SET last_seen_at=excluded.last_seen_at,last_action=excluded.last_action",
      )
      .run(deviceId, now, action.slice(0, 80));
  }
  lastSeen(deviceId: string): number | null {
    const row = this.db.prepare("SELECT last_seen_at AS at FROM device_presence WHERE device_id=?").get(deviceId) as
      | { at: number }
      | undefined;
    return row?.at ?? null;
  }
}

/** Fixed-window counter per key. Every request counts (not only failures) — this bounds paired-device load. */
export class WindowLimiter {
  limit: number;
  windowMs: number;
  maxKeys: number;
  entries = new Map<string, { count: number; resetAt: number }>();
  constructor(limit: number, windowMs: number, maxKeys = 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }
  /** Returns null when admitted, or the milliseconds until the window resets. */
  take(key: string, now = Date.now()): number | null {
    let entry = this.entries.get(key);
    if (!entry || entry.resetAt <= now) {
      this.entries.delete(key);
      if (this.entries.size >= this.maxKeys) {
        for (const [k, v] of this.entries) if (v.resetAt <= now) this.entries.delete(k);
        if (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value!);
      }
      entry = { count: 0, resetAt: now + this.windowMs };
      this.entries.set(key, entry);
    }
    if (entry.count >= this.limit) return entry.resetAt - now;
    entry.count++;
    return null;
  }
}

/** Open device event streams, so revocation can close them immediately instead of at the next delivery. */
export class DeviceStreams {
  perDevice: number;
  total: number;
  open = new Map<string, Set<() => void>>();
  constructor(perDevice = 3, total = 24) {
    this.perDevice = perDevice;
    this.total = total;
  }
  count() {
    let n = 0;
    for (const set of this.open.values()) n += set.size;
    return n;
  }
  admit(deviceId: string) {
    return (this.open.get(deviceId)?.size ?? 0) < this.perDevice && this.count() < this.total;
  }
  add(deviceId: string, close: () => void) {
    const set = this.open.get(deviceId) ?? new Set();
    set.add(close);
    this.open.set(deviceId, set);
    return () => {
      set.delete(close);
      if (!set.size && this.open.get(deviceId) === set) this.open.delete(deviceId);
    };
  }
  closeDevice(deviceId: string) {
    const set = this.open.get(deviceId);
    if (!set) return 0;
    const closers = [...set];
    this.open.delete(deviceId);
    for (const close of closers) close();
    return closers.length;
  }
}

export type OperationState = "in_progress" | "applied" | "refused" | "failed";
export type OperationOutcome = {
  operationId: string;
  action: string;
  state: OperationState;
  at: number;
  status?: number;
  code?: string;
  error?: string;
};
export const OPERATION_ID = /^[A-Za-z0-9-]{8,64}$/;
/**
 * Bounded per-epoch idempotency ledger. A replayed operation id returns its recorded outcome and never
 * re-executes. Keys include the principal, so one device can neither read nor replay another's outcome;
 * the caller authenticates before every lookup, so a revoked or expired device never reaches it. The
 * ledger is memory only: a new Host epoch answers "unknown" and the client reconciles from canonical state.
 */
export class OperationLedger {
  ttlMs: number;
  maxTotal: number;
  maxPerPrincipal: number;
  entries = new Map<string, OperationOutcome>();
  constructor(ttlMs = 10 * 60_000, maxTotal = 2000, maxPerPrincipal = 200) {
    this.ttlMs = ttlMs;
    this.maxTotal = maxTotal;
    this.maxPerPrincipal = maxPerPrincipal;
  }
  private key(principal: string, operationId: string) {
    return `${principal}\u0000${operationId}`;
  }
  private prune(now: number) {
    for (const [key, value] of this.entries)
      if (value.at + this.ttlMs <= now && value.state !== "in_progress") this.entries.delete(key);
  }
  get(principal: string, operationId: string, now = Date.now()): OperationOutcome | null {
    const found = this.entries.get(this.key(principal, operationId));
    if (!found) return null;
    if (found.state !== "in_progress" && found.at + this.ttlMs <= now) {
      this.entries.delete(this.key(principal, operationId));
      return null;
    }
    return found;
  }
  begin(principal: string, operationId: string, action: string, now = Date.now()): OperationOutcome {
    this.prune(now);
    const prefix = `${principal}\u0000`;
    const inFlight = [...this.entries.entries()].filter(([, value]) => value.state === "in_progress");
    if (inFlight.length >= this.maxTotal || inFlight.filter(([key]) => key.startsWith(prefix)).length >= this.maxPerPrincipal)
      throw new CodedRefusal("RATE_LIMITED", "Too many operations are still being confirmed. Try again shortly.", 429);
    const own = [...this.entries.entries()].filter(([key, value]) => key.startsWith(prefix) && value.state !== "in_progress");
    if (own.length >= this.maxPerPrincipal) this.entries.delete(own[0][0]);
    if (this.entries.size >= this.maxTotal) {
      const oldest = [...this.entries.entries()].find(([, value]) => value.state !== "in_progress");
      if (oldest) this.entries.delete(oldest[0]);
    }
    const outcome: OperationOutcome = { operationId, action, state: "in_progress", at: now };
    this.entries.set(this.key(principal, operationId), outcome);
    return outcome;
  }
  finish(
    principal: string,
    operationId: string,
    result: Omit<OperationOutcome, "operationId" | "action" | "at">,
    now = Date.now(),
  ) {
    const found = this.entries.get(this.key(principal, operationId));
    if (!found) return;
    Object.assign(found, result, { at: now });
  }
}

/** The public description of a principal; never carries a credential or its hash. */
export function viewerOf(principal: Principal, presence: DevicePresence): SnapshotViewer {
  return principal.kind === "workstation"
    ? { kind: "workstation" }
    : {
        kind: "device",
        deviceId: principal.id,
        name: principal.name,
        role: DEVICE_ROLE,
        pairedAt: principal.pairedAt,
        expiresAt: principal.expiresAt,
        lastSeenAt: presence.lastSeen(principal.id),
        rights: Object.keys(DEVICE_RIGHTS).sort(),
      };
}

/** Newest tasks a device snapshot carries besides every active one; history beyond it stays on the Host. */
export const DEVICE_TASK_HISTORY = 100;
/** Newest finished Agents a device snapshot carries besides every unfinished one. */
export const DEVICE_AGENT_HISTORY = 50;
const FINISHED_AGENT = new Set(["COMPLETED", "FAILED", "STOPPED"]);
const TERMINAL_TASK = new Set(["completed", "failed", "stopped"]);
/**
 * Host-side device projection, applied before the gateway's public redaction: only this device's own
 * row, bounded task history, and no local process, folder or executable facts.
 */
export function deviceSnapshot(snapshot: HostSnapshot, principal: DevicePrincipal, presence: DevicePresence): HostSnapshot {
  const active = snapshot.tasks.filter((task) => !TERMINAL_TASK.has(task.state));
  const recent = snapshot.tasks
    .filter((task) => TERMINAL_TASK.has(task.state))
    .sort((a, b) => b.createdAt - a.createdAt || a.id.localeCompare(b.id))
    .slice(0, DEVICE_TASK_HISTORY);
  const kept = new Set([...active, ...recent].map((task) => task.id));
  return {
    ...snapshot,
    projects: (snapshot.projects ?? []).map((project) => ({ ...project, path: "[Project folder on the Windows Host]" })),
    devices: (snapshot.devices ?? [])
      .filter((device) => device.id === principal.id)
      .map((device) => ({ ...device, expiresAt: principal.expiresAt, lastSeenAt: presence.lastSeen(principal.id) })),
    tasks: snapshot.tasks
      .filter((task) => kept.has(task.id))
      .map((task) => deviceTask(task)),
    providers: snapshot.providers.map((provider) => ({
      ...provider,
      executable: null,
      evidence: [],
      ...(provider.activeSessions
        ? { activeSessions: provider.activeSessions.map((session) => ({ ...session, providerSessionId: null, pid: null })) }
        : {}),
    })),
    presentation: snapshot.presentation
      ? { ...snapshot.presentation, tasks: snapshot.presentation.tasks?.filter((task) => kept.has(task.id)) }
      : snapshot.presentation,
    // M-A-3 T11: a paired device sees team structure and Host verdicts; Reviewer model text, planner-echoed rejection
    // text, the user's revision note, fixture origins, folder paths and file locations stay on the workstation.
    missions: snapshot.missions
      ? { ...snapshot.missions, missions: snapshot.missions.missions.map((mission) => mission.team || mission.teamView ? deviceTeamMission(mission) : mission) }
      : snapshot.missions,
    agents: snapshot.agents
      ? {
          ...snapshot.agents,
          agents: [
            ...snapshot.agents.agents.filter((agent) => !FINISHED_AGENT.has(agent.state)),
            ...snapshot.agents.agents
              .filter((agent) => FINISHED_AGENT.has(agent.state))
              .sort((a, b) => b.updatedAt - a.updatedAt || a.id.localeCompare(b.id))
              .slice(0, DEVICE_AGENT_HISTORY),
          ].map((agent) => ({ ...agent, authorization: agent.authorization ? { ...agent.authorization, roots: agent.authorization.roots.map(() => "[Project folder on the Windows Host]"), commands: agent.authorization.commands.map((command) => ({ ...command, cwd: "[Project folder on the Windows Host]" })) } : agent.authorization })),
        }
      : snapshot.agents,
    // M-A-3 T13.1: credential state, provider limits and usage are workstation-owner settings.
    intelligence: undefined,
    modelIntelligence: undefined,
    connections: undefined,
    deviceConnections: snapshot.connections?.accounts.map(connectionDeviceView),
  };
}

type SnapshotMission = NonNullable<HostSnapshot["missions"]>["missions"][number];
function deviceTeamMission<T extends Pick<SnapshotMission, "root" | "requestedScope" | "team"> & Partial<Pick<SnapshotMission, "steps" | "artifacts" | "teamView" | "planning" | "recovery">>>(mission: T): T {
  const rejected = (list: { at: number; reasons: string[] }[]) => list.map((entry) => ({ at: entry.at, reasons: [REJECTION_DEVICE_LABEL] }));
  return {
    ...mission,
    root: "[Project folder on the Windows Host]",
    ...(mission.planning ? { planning: { ...mission.planning, rationale: ["Plan details are retained on the Windows Host."] } } : {}),
    ...(mission.recovery ? { recovery: { ...mission.recovery, detail: "Recovery details are retained on the Windows Host." } } : {}),
    ...(mission.requestedScope ? { requestedScope: { ...mission.requestedScope, projectRoots: mission.requestedScope.projectRoots.map(() => "[Project folder on the Windows Host]"), filesystem: { read: mission.requestedScope.filesystem.read.map(() => "[Project folder on the Windows Host]"), write: mission.requestedScope.filesystem.write.map(() => "[Project folder on the Windows Host]") } } } : {}),
    ...(mission.steps ? { steps: mission.steps.map((step) => ({ ...step, scope: { ...step.scope, root: step.scope.root === null ? null : "[Project folder on the Windows Host]" }, workspace: null })) } : {}),
    ...(mission.artifacts ? { artifacts: mission.artifacts.map((artifact) => ({ ...artifact, location: { kind: artifact.location.kind, mediaType: artifact.location.mediaType } as typeof artifact.location })) } : {}),
    ...(mission.team ? { team: { ...mission.team, revisionNote: null, browserFixture: null, offerFiles: [], rejected: rejected(mission.team.rejected) } } : {}),
    ...(mission.teamView ? { teamView: { ...mission.teamView, rejected: rejected(mission.teamView.rejected),
      findings: mission.teamView.findings.map((review) => ({ ...review, findings: review.findings.map((finding) => ({ ...finding, summary: "Advisory Reviewer finding (full text on the Windows Host)." })) })) } } : {}),
  };
}

/** Project read endpoints use the same privacy boundary as device snapshots, including retained team metadata. */
export function deviceProjectDetail(detail: ProjectDetail): ProjectDetail {
  const folder = "[Project folder on the Windows Host]";
  return {
    ...detail,
    project: { ...detail.project, path: folder },
    missions: detail.missions.map((mission) => deviceTeamMission(mission)),
    tasks: detail.tasks.map((task) => publicTask(deviceTask(task))),
    agents: detail.agents.map((agent) => ({ ...agent, authorization: agent.authorization ? { ...agent.authorization, roots: agent.authorization.roots.map(() => folder), commands: agent.authorization.commands.map((command) => ({ ...command, cwd: folder })) } : agent.authorization })),
    workspaces: detail.workspaces.map((workspace) => ({ ...workspace, root: { ...workspace.root, path: folder }, scratch: { ...workspace.scratch, path: folder }, workspaceRoot: { ...workspace.workspaceRoot, path: folder }, ownershipMarker: "[Ownership evidence on the Windows Host]" })),
    artifacts: detail.artifacts.map((artifact) => ({ ...artifact, location: { kind: artifact.location.kind, mediaType: artifact.location.mediaType } as typeof artifact.location })),
  };
}

/** A typed refusal with its own HTTP status (409 epoch/operation conflicts, 429 limits). Nothing executed. */
export class CodedRefusal extends CommandRefusedError {
  code: string;
  status: number;
  constructor(code: string, message: string, status = 400) {
    super(message);
    this.name = "CodedRefusal";
    this.code = code;
    this.status = status;
  }
}
/** The earlier of the absolute lifetime and the idle bound, as authenticateDevice enforces it. */
export function deviceExpiresAt(createdAt: number, lastSeenAt: number | null, sessionMs = DEVICE_SESSION_MS, idleMs = DEVICE_IDLE_MS) {
  return Math.min(createdAt + sessionMs, Math.max(createdAt, lastSeenAt ?? 0) + idleMs);
}
/** Local folder paths never reach a paired device inside refusal text. */
export function hidePaths(text: string) {
  return text
    .replace(/[A-Za-z]:[\\/][^\s'"`,;)]*/g, "[Host path]")
    .replace(/\\\\[^\s'"`,;)]+/g, "[Host path]")
    .replace(/(^|[\s'"`(])\/(?:Users|home|tmp|var|private|mnt|opt|root)\/[^\s'"`,;)]*/g, "$1[Host path]");
}
/** A device artifact read keeps the verified body and identity, never the Host file location. */
export function deviceArtifactRead<T>(result: T, teamStep: (stepId: string) => boolean = () => false): T {
  if (!result || typeof result !== "object" || !("artifact" in result)) return result;
  const read = result as T & { artifact: { type?: string; stepId?: string | null; location?: { kind: string; mediaType: string; path?: string } }; body?: unknown };
  const location = read.artifact.location;
  // M-A-3 T11 (review SURF-01): a team Reviewer report is model text and a team observation is project file content;
  // both stay on the workstation, consistent with the device snapshot.
  const withheld = !!read.artifact.stepId && ["review", "structured_result"].includes(read.artifact.type ?? "") && teamStep(read.artifact.stepId);
  return {
    ...read,
    ...(withheld ? { body: TEAM_ARTIFACT_DEVICE_LABEL } : {}),
    artifact: {
      ...read.artifact,
      location: location ? { kind: location.kind, mediaType: location.mediaType } : location,
    },
  };
}
export const TEAM_ARTIFACT_DEVICE_LABEL = "Team Agent working material (full text on the Windows Host).";
const REJECTION_DEVICE_LABEL = "Bunny's plan validation rejected this proposal (reasons on the Windows Host).";
/**
 * A task returned to a device carries no local process, folder or provider session facts. A Mission child's
 * prompt is Bunny's assembled agent prompt (dependency results, artifact excerpts, folders), so the device sees
 * the step objective instead; a direct task keeps the user's own words.
 */
/** What a paired device sees instead of a spoken voice turn's prompt (privacy#0). */
export const VOICE_TURN_DEVICE_LABEL = "Voice question (workstation)";

export function deviceTask<T extends Pick<OrchTask, "prompt" | "routingPrompt" | "mission"> & { constraints?: OrchTask["constraints"]; cwd?: string; pid?: number | null; processTree?: unknown; processTreeAt?: number | null; sessionId?: string | null }>(task: T): T {
  // privacy#0: a voice turn's prompt carries spoken history and Bunny's earlier answers, and its routingPrompt is the spoken
  // transcript. Only the in-process voice path sets routingPrompt on a direct (non-mission) task, so such a task is a voice
  // turn: neither field reaches a device. Mission steps keep their objective, as before.
  const voiceTurn = !task.mission && task.routingPrompt !== undefined;
  return {
    ...task,
    connectionRoute: undefined,
    proposedRoute: undefined,
    ...(task.mission ? { prompt: task.routingPrompt ?? "Mission step (Bunny's full prompt stays on the Host)." } : {}),
    ...(voiceTurn ? { prompt: VOICE_TURN_DEVICE_LABEL, routingPrompt: VOICE_TURN_DEVICE_LABEL } : {}),
    cwd: undefined,
    ...(task.constraints ? { constraints: { ...task.constraints, workingDirectory: undefined } } : {}),
    pid: null,
    processTree: null,
    processTreeAt: null,
    sessionId: null,
  };
}
