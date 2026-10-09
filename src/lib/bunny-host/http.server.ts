import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, createHash, timingSafeEqual, randomUUID } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { HostDatabase } from "./persistence.server.ts";
import { TaskManager } from "./manager.server.ts";
import { sampleHost } from "../orch/telemetry.server.ts";
import { validateVerifySpec, verifyTask } from "./verification.server.ts";
import type { Mode, OrchTask, Project, ProviderId, TaskConstraints } from "../orch/types.ts";
import type { AgentSession, HostSnapshot } from "./contracts.ts";
import { MissionManager, type MissionManagerOptions } from "../bunny-missions/manager.server.ts";
import { MISSION_ACTIONS, missionCommand } from "../bunny-missions/commands.server.ts";
import { hostStatePaths, refreshStateMarker } from "./state-paths.server.ts";
import { CommandRefusedError, HostContainment, HostUnavailableError, registerDiagnosticSecret, safeError, supervisedLoop ,
} from "./failure.server.ts";
import type { ProviderAdapter, HostEvent } from "./contracts.ts";
import type { HostSample } from "../orch/types.ts";
import type { EventEmitter } from "node:events";
import { stopOwnedChildren } from "./owned-processes.server.ts";
import { dashboardSnapshot, publicEventDetail, projectHostActivity } from "./presentation.ts";
import { releaseIdentity } from "./release-identity.server.ts";
import { AGENT_ACTIONS, AgentRuntime, agentCommand } from "./agent-runtime.server.ts";
import { ProjectService } from "./project-service.server.ts";
import {
  actorOf, APPROVAL_ON_HOST, assertDeviceAction, authenticateDevice, CodedRefusal, deviceArtifactRead, deviceExpiresAt,
  deviceMayLaunch, DevicePresence, deviceSnapshot, deviceStillValid, DeviceStreams, deviceTask, ensureDeviceSchema,
  hidePaths, hostId as stableHostId, mutating, OPERATION_ID, OperationLedger, viewerOf, WindowLimiter,
  WorkstationRequiredError, type DevicePrincipal, type OperationState, type Principal,
} from "./device-authority.server.ts";

const PROVIDERS: ProviderId[]=["codex","claude","ollama","opencode","cline","cursor"];
function record(value: unknown): Record<string,unknown> {if(!value || typeof value!=="object" || Array.isArray(value)) throw new Error("Expected an object.");return value as Record<string,unknown>;}
function text(value: unknown,max=100000): string {if(typeof value!=="string" || !value.trim() || value.length>max) throw new Error("Invalid or oversized text.");return value;}
function provider(value: unknown): ProviderId {if(!PROVIDERS.includes(value as ProviderId)) throw new Error("Unknown provider.");return value as ProviderId;}
export function validateConstraints(value: unknown): TaskConstraints {
  if(value===undefined) return {};
  const input=record(value);const output:TaskConstraints={};
  for(const key of ["localOnly","offlineOnly","requiresFilesystem","requiresTerminal","requiresGit","requiresGPU","cloudOnly","privacyLocal",
  ] as const) if(input[key]!==undefined) {if(typeof input[key]!=="boolean") throw new Error("Invalid constraint.");output[key]=input[key];}
  if(input.workingDirectory!==undefined) output.workingDirectory=text(input.workingDirectory,2000);
  for(const key of ["providerAllowlist","providerDenylist"] as const) if(input[key]!==undefined) {if(!Array.isArray(input[key]) || input[key].length>6) throw new Error("Invalid provider constraint.");output[key]=input[key].map(provider);}
  // M-A-3 T3 §27 model-level user constraints; exact pins are honored only where a real model surface exists (§9).
  if(input.modelExact!==undefined) output.modelExact=text(input.modelExact,200);
  if(input.modelAllowlist!==undefined) {if(!Array.isArray(input.modelAllowlist) || input.modelAllowlist.length>6 || input.modelAllowlist.some((entry) =>typeof entry!=="string" || !entry.trim() || entry.length>200,
      )) throw new Error("Invalid model constraint.");output.modelAllowlist=input.modelAllowlist.map((entry) =>String(entry));}
  if(input.maxRuntimeMs!==undefined) {if(!Number.isInteger(input.maxRuntimeMs) || Number(input.maxRuntimeMs)<1000 || Number(input.maxRuntimeMs)>3600000) throw new Error("Runtime must be 1–3600 seconds.");output.maxRuntimeMs=Number(input.maxRuntimeMs);}
  for(const key of Object.keys(input)) if(!(key in output)) throw new Error(`Unsupported constraint: ${key}`);
  return output;
}
export function validateSubmit(value: unknown) {
  const input = record(value);
  const mode = input.mode;
  if (!["fast", "balanced", "deep"].includes(String(mode)))
    throw new Error("Unknown routing mode.");
  const projectId = input.projectId == null ? null : text(input.projectId, 200);
  const override =
    input.override === undefined || input.override === "auto"
      ? ("auto" as const)
      : provider(input.override);
  const modelOverride = input.modelOverride == null ? null : text(input.modelOverride, 200);
  return {
    prompt: text(input.prompt),
    mode: mode as Mode,
    projectId,
    override,
    modelOverride,
    constraints: validateConstraints(input.constraints),
    verify: validateVerifySpec(input.verify),
  };
}
/** Counts failures only, in a fixed window that blocked requests never extend, and clears on success. */
export class FailureLimiter {
  entries = new Map<string, { count: number; resetAt: number }>();
  limit: number;
  windowMs: number;
  maxKeys: number;
  constructor(limit: number, windowMs: number, maxKeys = 1000) {
    this.limit = limit;
    this.windowMs = windowMs;
    this.maxKeys = maxKeys;
  }
  blocked(key: string, now = Date.now()) {
    const e = this.entries.get(key);
    if (!e) return false;
    if (e.resetAt <= now) {
      this.entries.delete(key);
      return false;
    }
    return e.count >= this.limit;
  }
  fail(key: string, now = Date.now()) {
    const e = this.entries.get(key);
    if (e && e.resetAt > now) {
      e.count++;
      return;
    }
    this.entries.delete(key);
    if (this.entries.size >= this.maxKeys) {
      for (const [k, v] of this.entries) if (v.resetAt <= now) this.entries.delete(k);
      if (this.entries.size >= this.maxKeys) this.entries.delete(this.entries.keys().next().value!);
    }
    this.entries.set(key, { count: 1, resetAt: now + this.windowMs });
  }
  succeed(key: string) {
    this.entries.delete(key);
  }
}
function hash(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
function equal(a: string, b: string) {
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
async function body(request: IncomingMessage) {
  let data = "";
  for await (const chunk of request) {
    data += String(chunk);
    if (Buffer.byteLength(data) > 4_000_000) throw new Error("Request too large.");
  }
  return record(JSON.parse(data));
}
// charset is explicit: Windows PowerShell 5.1 (the native Island) otherwise decodes JSON as Latin-1.
function json(response: ServerResponse, value: unknown, status = 200, headers: Record<string, string> = {}) {
  const encoded = JSON.stringify(value);
  if (response.destroyed || response.writableEnded) return;
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "cache-control": "no-store",
    "x-content-type-options": "nosniff",
    ...headers,
  });
  response.end(encoded);
}

/** One SSE client owns its reads, serializer and writes; failure removes every listener and timer.
 * Backpressure on a large replay waits for the socket to drain instead of treating a healthy,
 * slow client as failed — destroying on response.write()===false would RST the connection and a
 * reconnecting UI could never replay more than the socket buffer (~16KB) of history. */
export function streamSse(
  response: ServerResponse,
  bus: EventEmitter,
  read: (cursor: number) => HostEvent[],
  after: number,
  containment: HostContainment,
  authorized: () => boolean = () => true,
) {
  let cursor = after,
    closed = false,
    pumping = false;
  const close = () => {
    if (closed) return;
    closed = true;
    clearInterval(heartbeat);
    bus.off("event", pump);
    response.off("close", close);
    response.off("error", failed);
    try {
      response.destroy();
    } catch {
      /* Broken client already gone. */
    }
  };
  const failed = (error: unknown) => {
    close();
    containment.background({ subsystem: "sse" }, () => {
      throw error;
    });
  };
  const pump = async () => {
    if (closed || pumping) return;
    pumping = true;
    try {
      let batches = 0;
      for (;;) {
        if (!authorized()) {
          close();
          return;
        }
        const events = read(cursor);
        for (const event of events) {
          if (!authorized() || response.destroyed || response.writableEnded) {
            close();
            return;
          }
          cursor = event.sequence;
          if (!response.write(`id: ${event.sequence}\ndata: ${JSON.stringify(event)}\n\n`)) {
            await new Promise<void>((resolve) => {
              response.once("drain", resolve);
              response.once("close", resolve);
            });
            if (closed) return;
          }
        }
        if (events.length < 500 || ++batches >= 40) break;
      }
    } catch (error) {
      failed(error);
    } finally {
      pumping = false;
    }
  };
  const heartbeat = setInterval(() => {
    if (!closed) {
      try {
        if (!authorized() || response.destroyed || response.writableEnded) {
          close();
          return;
        }
        response.write(": heartbeat\n\n");
      } catch (error) {
        failed(error);
      }
    }
  }, 15000);
  response.on("close", close);
  response.on("error", failed);
  bus.on("event", pump);
  pump();
  return close;
}

export async function startHost(
  options: {
    dataDirectory?: string;
    root?: string;
    workspaceRoot?: string;
    port?: number;
    missions?: Omit<MissionManagerOptions, "dataDirectory">;
    containment?: HostContainment;
    removeProcessHandlers?: () => void;
    adapters?: ProviderAdapter[];
    sample?: () => Promise<HostSample>;
  } = {},
) {
  const paths = hostStatePaths(options.dataDirectory);
  const dataDirectory = paths.data;
  if (!paths.installed) mkdirSync(dataDirectory, { recursive: true });
  const credentialPath = paths.credentials;
  const saved = existsSync(credentialPath)
    ? (JSON.parse(readFileSync(credentialPath, "utf8")) as { token: string })
    : null;
  const token = saved?.token ?? randomBytes(32).toString("base64url");
  const containment =
    options.containment ??
    new HostContainment({
      diagnosticDirectory: paths.diagnostics,
      runtimeDirectory: paths.runtime,
    });
  containment.options.secrets = [...(containment.options.secrets ?? []), token];
  registerDiagnosticSecret(token);
  const port = options.port ?? Number(process.env.BUNNY_HOST_PORT ?? 43119);
  const db = new HostDatabase(paths.database);
  // M-A-3 T9: additive device tables exist before the state marker is reconciled below; never on a request path.
  ensureDeviceSchema(db.db);
  containment.options.persist = (type, detail, owner) => {
    db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null);
  };
  db.onFailure = (error, rollbackFailed) => {
    if (rollbackFailed) containment.fatal(error, { subsystem: "persistence" });
    else
      containment.degrade(
        "*",
        "A persistence boundary failed; new execution requires Host recovery.",
      );
  };
  containment.recoverMarker(false);
  const workspaceRoot =
    options.workspaceRoot ??
    (paths.installed ? process.env.BUNNY_HOST_WORKSPACE : join(dataDirectory, "workspace"));
  if (!workspaceRoot) throw new Error("Configured Bunny workspace root is required.");
  if (!paths.installed && !options.workspaceRoot) mkdirSync(workspaceRoot, { recursive: true });
  const manager = new TaskManager(db, options.root ?? process.cwd(), options.adapters, {
    sessionDirectory: paths.sessions,
    containment,
    workspaceRoot,
  });
  containment.options.persist = (type, detail, owner) =>
    manager.emit(db.event(type, owner.taskId ?? null, detail, owner.missionId ?? null));
  db.onFailure = (error, rollbackFailed) => {
    if (rollbackFailed) containment.fatal(error, { subsystem: "persistence" });
    else
      containment.degrade(
        "*",
        "A persistence boundary failed; new execution requires Host recovery.",
      );
  };
  // M-A-0 mission layer: additive tables are created, but nothing runs unless missions are enabled.
  const missions = new MissionManager(manager, { dataDirectory, ...options.missions });
  // M-A-3 T4: the durable Agent runtime sits above Missions — it owns continuity only, and construction
  // runs the recovery walk after MissionManager.recover() has reconciled the mission rows.
  const agents = new AgentRuntime(db, missions);
  const projects = new ProjectService(missions, agents);
  missions.missionPauseGate = (missionId) => agents.blockedForMission(missionId);
  // M-A-3 T9: one stable installation identity (persisted) plus this boot's epoch; a phone pins the first and
  // refuses to act on a view from another Host or an earlier epoch.
  const hostIdentity = { hostId: stableHostId(db.db), epoch: manager.instanceId, startedAt: Date.now() };
  const presence = new DevicePresence(db.db);
  const ledger = new OperationLedger();
  const deviceStreams = new DeviceStreams();
  const deviceCommands = new WindowLimiter(60, 60_000);
  const deviceReads = new WindowLimiter(300, 60_000);
  const deviceStreamOpens = new WindowLimiter(30, 60_000);
  // M-A-2 T9: this Host just applied its own additive schema; reconcile the installed-state marker
  // with the applied schema so the next boot validates a healthy database instead of refusing it.
  refreshStateMarker({ installed: paths.installed, data: paths.data, database: paths.database });
  let presentationRevision = 0;
  const installedIdentity = releaseIdentity();
  const snapshot = (after: number): HostSnapshot => {
    const canonical = {
      ...manager.snapshot(after),
      missions: missions.snapshot(),
      agents: agents.snapshot(),
    };
    const retainedFrom = Number(
      (db.db.prepare("SELECT COALESCE(MIN(sequence),0) n FROM events").get() as { n: number }).n,
    );
    return {
      ...canonical,
      release: installedIdentity,
      presentation: projectHostActivity(
        canonical,
        missions.store.runs({ limit: 100 }),
        retainedFrom,
        ++presentationRevision,
      ),
    };
  };
  /** The snapshot as one principal may see it: Host identity and viewer for all, the device projection for devices. */
  const viewFor = (after: number, principal: Principal): HostSnapshot => {
    const base = snapshot(after);
    const withVerdicts: HostSnapshot = {
      ...base,
      hostIdentity,
      viewer: viewerOf(principal, presence),
      missions: base.missions ? missions.remoteVerdicts(base.missions) : base.missions,
      agents: base.agents
        ? {
            ...base.agents,
            agents: base.agents.agents.map((agent) =>
              agent.authorization && agent.missionId
                ? {
                    ...agent,
                    authorization: {
                      ...agent.authorization,
                      ...(agent.authorization.state === "WAITING_FOR_USER"
                        ? (() => {
                            const refusal = missions.safeRefusal(() => missions.deviceAgenticRefusal(agent.missionId!));
                            return { remoteOffer: { answerable: !refusal, reason: refusal } };
                          })()
                        : {}),
                      pending: agent.authorization.pending.map((item) => {
                        const refusal = missions.safeRefusal(() => missions.deviceRequestRefusal(missions.store.request(item.id)));
                        return { ...item, remote: { answerable: !refusal, reason: refusal } };
                      }),
                    },
                  }
                : agent,
            ),
          }
        : base.agents,
      devices: (base.devices ?? []).map((row) => {
        const lastSeenAt = presence.lastSeen(row.id);
        return { ...row, lastSeenAt, expiresAt: deviceExpiresAt(row.createdAt, lastSeenAt) };
      }),
    };
    return principal.kind === "device" ? dashboardSnapshot(deviceSnapshot(withVerdicts, principal, presence)) : withVerdicts;
  };
  manager.remoteConfigured = !!process.env.BUNNY_REMOTE_ORIGIN || existsSync(paths.remote);
  if (existsSync(paths.remote))
    manager.remoteUrl = JSON.parse(readFileSync(paths.remote, "utf8")).url;
  let pairing: { codeHash: string; expiresAt: number } | null = null;
  // Per-client limit stops guessing from one source; the global cap stops header rotation.
  // Pairing codes carry 96 bits of entropy, so both limits are defence in depth.
  const clientAttempts = new FailureLimiter(5, 600000);
  const globalAttempts = new FailureLimiter(100, 600000, 1);
  const handler = async (req: IncomingMessage, res: ServerResponse) => {
    const host = req.headers.host ?? "";
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host))
      return json(res, { error: "Host header rejected." }, 403);
    if (req.headers.origin || req.headers["sec-fetch-site"] === "cross-site")
      return json(res, { error: "Use the authenticated same-origin application bridge." }, 403);
    const path = new URL(req.url ?? "/", `http://${host}`);
    if(path.pathname === "/health" && req.method === "GET") return json(res,{app:"Bunny-A",instanceId:manager.instanceId,pid:process.pid,...containment.snapshot(),
      });
    const bearer=(req.headers.authorization ?? "").replace(/^Bearer /,"");
    const local=equal(bearer,token);
    // M-A-3 T9: every request re-authenticates the device: present, unrevoked, within its lifetime and idle bound.
    const auth=local || !bearer ? null : authenticateDevice(db.db,hash(bearer));
    const device:DevicePrincipal | null=auth?.ok ? auth.device : null;
    if(device) registerDiagnosticSecret(bearer);
    if(path.pathname === "/pair" && req.method === "POST") {
      if(!containment.allows("http")) return json(res,{error:new HostUnavailableError().message},503);
      const key=String(req.headers["x-bunny-pair-client"] ?? "bridge").slice(0,80);const now=Date.now();
      if(clientAttempts.blocked(key,now) || globalAttempts.blocked("*",now)) return json(res,{error:"Pairing attempts limited. Try again later."},429);
      const reject=(status:number,error:string)=>{clientAttempts.fail(key,now);globalAttempts.fail("*",now);return json(res,{error},status);};
      try {
        const input=await body(req);
        if(!pairing || pairing.expiresAt<now || !equal(hash(text(input.code,100)),pairing.codeHash)) return reject(403,"Invalid or expired pairing code.");
        const deviceToken=randomBytes(32).toString("base64url");const id=randomUUID();
        registerDiagnosticSecret(deviceToken);
        db.db.prepare("INSERT INTO devices VALUES(?,?,?,?,NULL)").run(id,text(input.name,100),hash(deviceToken),now);
        pairing=null;clientAttempts.succeed(key);manager.emit(db.event("device.paired",null,`Paired device ${id}`));
        return json(res, { token: deviceToken, deviceId: id, hostId: hostIdentity.hostId });
      } catch {
        return reject(400, "Pairing request failed.");
      }
    }
    if (!local && !device)
      return json(res, { error: "Authentication required.", code: auth && !auth.ok ? auth.code : "AUTH_REQUIRED" }, 401);
    const principal: Principal = device ?? { kind: "workstation" };
    const actor = actorOf(principal);
    if (device) {
      // Paired-device load is bounded per device; the workstation is unchanged.
      const limiter = path.pathname === "/command" ? deviceCommands : path.pathname === "/events" ? deviceStreamOpens : deviceReads;
      const wait = limiter.take(device.id);
      if (wait !== null)
        return json(res, { error: "Too many requests from this device. Try again shortly.", code: "RATE_LIMITED", retryAfterMs: wait }, 429, { "retry-after": String(Math.max(1, Math.ceil(wait / 1000))) });
      presence.touch(device.id, path.pathname);
    }
    let action = "";
    let operationId: string | null = null;
    let began = false;
    try {
      const after = Number(path.searchParams.get("after") ?? 0);
      if (!Number.isSafeInteger(after) || after < 0) throw new Error("Invalid event cursor.");
      if (req.method === "GET" && path.pathname === "/state") return json(res, viewFor(after, principal));
      if (req.method === "GET" && path.pathname === "/events") {
        if (device && !deviceStreams.admit(device.id))
          return json(res, { error: "Too many open activity streams for this device.", code: "RATE_LIMITED", retryAfterMs: 5000 }, 429, { "retry-after": "5" });
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive",
        });
        // Deliver the authenticated handshake even when the caller is already at the journal head.
        res.flushHeaders();
        const taskId = path.searchParams.get("task");
        // ?task=<id> streams one task's normalized events (the Host-side streamEvents for that session).
        const read = (from: number) => {
          const events = taskId ? db.taskEvents(taskId, from) : db.events(from);
          return device ? events.map((event) => ({ ...event, detail: publicEventDetail(event.type) })) : events;
        };
        // Device identity, revocation and expiry are checked for every delivery, including an already-open
        // stream; revocation also closes the device's open streams at once (DeviceStreams).
        const tokenHash = hash(bearer);
        const stillAuthorized = () => local || deviceStillValid(db.db, device!.id, tokenHash);
        const closeStream = streamSse(res, manager.bus, read, after, containment, stillAuthorized);
        if (device) res.once("close", deviceStreams.add(device.id, closeStream));
        return;
      }
      if (req.method !== "POST" || path.pathname !== "/command")
        return json(res, { error: "Not found" }, 404);
      const input = await body(req);
      // Body delivery can be delayed while another request revokes the device. Revalidate at dispatch.
      if (device) {
        const currentAuth = authenticateDevice(db.db, hash(bearer));
        if (!currentAuth.ok) return json(res, { error: "Authentication required.", code: currentAuth.code }, 401);
      }
      action = typeof input.action === "string" ? input.action.slice(0, 100) : "";
      // M-A-3 T9: default-deny paired-device role, checked before anything is read or dispatched.
      if (device) assertDeviceAction(action);
      const data = record(input.data ?? {});
      // A view from another Host or an earlier epoch never drives a command; nothing below executes.
      if (input.expect !== undefined) {
        const expect = record(input.expect);
        if (expect.hostId !== undefined && expect.hostId !== hostIdentity.hostId)
          throw new CodedRefusal("HOST_IDENTITY_CHANGED", "This is not the Bunny-A Host this view came from. Nothing was changed.", 409);
        if (expect.epoch !== undefined && expect.epoch !== hostIdentity.epoch)
          throw new CodedRefusal("HOST_EPOCH_CHANGED", "The Host restarted after this view was loaded. Nothing was changed; review the current state.", 409);
      }
      // Idempotency: a retried operation id returns its recorded outcome and never executes twice.
      if (input.operationId !== undefined) {
        if (typeof input.operationId !== "string" || !OPERATION_ID.test(input.operationId))
          throw new CommandRefusedError("Invalid operation id.");
        if (mutating(action)) {
          const prior = ledger.get(actor, input.operationId);
          if (prior && prior.action !== action)
            throw new CodedRefusal("OPERATION_CONFLICT", "This operation id was already used for a different action.", 409);
          if (prior?.state === "in_progress")
            throw new CodedRefusal("OPERATION_IN_PROGRESS", "The Host is still applying this operation.", 409);
          operationId = input.operationId;
          if (prior) {
            const operation = { id: operationId, state: prior.state, replayed: true };
            if (prior.state === "applied") return json(res, { snapshot: viewFor(after, principal), operation });
            return json(
              res,
              { requestId: containment.context.getStore()?.owner.requestId, error: prior.error, code: prior.code, operation },
              prior.status ?? 400,
            );
          }
          ledger.begin(actor, operationId, action);
          began = true;
        }
      }
      let task: OrchTask | undefined;
      let pairCode: string | undefined;
      let session: AgentSession | undefined;
      let extra: { mission?: unknown; data?: unknown; agents?: unknown; agent?: unknown } = {};
      const safeActions = new Set([
        "stop",
        "mission.stop",
        "session.get",
        "mission.get",
        "capability.list",
        "skill.list",
        "inbox.list",
        "trigger.list",
        "agent.list",
        "agent.get",
        // M-A-3 T9: holding or stopping an Agent must work exactly when the Host is degraded.
        "agent.stop",
        "agent.pause",
        "agent.authorization.deny",
        "agent.authorization.revoke",
        "operation.status",
      ]);
      if (!safeActions.has(action)) containment.assertAccepting("http");
      if (typeof input.action === "string" && AGENT_ACTIONS.has(input.action)) {
        if (!local && input.action === "agent.create" && data.steps !== undefined)
          throw new CommandRefusedError("Remote devices cannot supply executable Agent graphs.");
        if (
          !local &&
          Object.keys(data).some((k) => !["id", "revision"].includes(k)) &&
          input.action.startsWith("agent.authorization.")
        )
          throw new CommandRefusedError("Remote approval can only answer the exact Host offer.");
        extra = await agentCommand(agents, input.action, data, actor);
      } else if (typeof input.action === "string" && MISSION_ACTIONS.has(input.action))
        extra = await missionCommand(missions, input.action, data, { local, actor });
      else if (typeof input.action === "string" && input.action.startsWith("project.")) {
        try {
          const result = await projects.command(input.action, data, local);
          extra = { data: device && action === "project.artifact" ? deviceArtifactRead(result) : result };
        } catch (error) {
          const message = error instanceof Error ? error.message : "Project command refused.";
          // A paired device never receives local folder paths inside refusal text.
          throw new CommandRefusedError(device ? hidePaths(message) : message);
        }
      } else
        switch (input.action) {
          case "submit": {
            const submitted = validateSubmit(data);
            // A paired device queues chat for review; folders and verification checks are workstation settings.
            if (device && (submitted.verify || submitted.constraints.workingDirectory))
              throw new WorkstationRequiredError("Task folders and verification checks are set on the workstation (Windows Host).");
            task = manager.submit(submitted);
            break;
          }
          case "approve": {
            const id = text(data.id, 200);
            if (device) {
              // M-A-3 T9 (DEV-01): a direct task runs an unscoped provider session; a paired device may only
              // launch local tool-free inference. Mission work is answered through its exact Mission request.
              let pending: OrchTask;
              try {
                pending = db.get(id);
              } catch {
                throw new CommandRefusedError("Unknown task.");
              }
              if (pending.mission)
                throw new WorkstationRequiredError("Mission work is approved through its Mission request.");
              if (!deviceMayLaunch(pending))
                throw new WorkstationRequiredError(
                  `${APPROVAL_ON_HOST} This route can use workspace tools or a hosted model on the workstation.`,
                );
            }
            task = manager.approve(id, actor);
            break;
          }
          case "operation.status": {
            const id = text(data.operationId, 64);
            if (!OPERATION_ID.test(id)) throw new CommandRefusedError("Invalid operation id.");
            const found = ledger.get(actor, id);
            extra = {
              data: found
                ? { operationId: id, state: found.state, action: found.action, at: found.at, code: found.code ?? null, error: found.error ?? null, epoch: hostIdentity.epoch }
                : { operationId: id, state: "unknown", epoch: hostIdentity.epoch },
            };
            break;
          }
          case "stop":
            task = await manager.stop(text(data.id, 200));
            break;
          case "retarget":
            task = missions.retargetTask(
              text(data.id, 200),
              provider(data.provider),
              data.modelOverride == null ? null : text(data.modelOverride, 200),
            );
            break;
          case "discover":
            await manager.discover();
            break;
          case "session.get":
            session = manager.getSession(text(data.id, 200));
            break;
          case "input":
          case "session.input":
            await manager.sendInput(text(data.id, 200), text(data.input, 100000));
            break;
          case "terminal":
            manager.terminal(text(data.id, 200));
            break;
          case "task.feedback": {
            if (data.value !== "positive" && data.value !== "negative")
              throw new Error("Feedback must be positive or negative.");
            task = manager.feedback(text(data.id, 200), data.value);
            break;
          }
          case "provider.configure_path":
            if (!local)
              throw new Error("Executable paths can only be configured on the workstation.");
            await manager.configureProviderPath(
              provider(data.provider),
              data.path == null ? null : text(data.path, 2000),
            );
            break;
          case "remote.configure":
            if (!local)
              throw new Error("Remote connection configuration requires workstation access.");
            if (typeof data.enabled !== "boolean")
              throw new Error("Invalid remote connection setting.");
            if (data.enabled) {
              const url = new URL(text(data.url, 2000));
              if (
                url.protocol !== "https:" ||
                url.username ||
                url.password ||
                url.pathname !== "/" ||
                url.search ||
                url.hash
              )
                throw new Error("Expected an HTTPS origin.");
              manager.remoteUrl = url.origin;
            }
            manager.remoteConfigured = data.enabled;
            break;
          case "thermal.configure":
            if (!local)
              throw new Error("Thermal policy configuration requires workstation access.");
            if (typeof data.autoStop !== "boolean")
              throw new Error("Explicit automatic-stop preference required.");
            manager.configureThermal(Number(data.cpuWarn), Number(data.gpuWarn), data.autoStop);
            break;
          case "verification.record": {
            if (!local) throw new Error("Independent verification requires workstation access.");
            const original = db.get(text(data.id, 200));
            const verification = await verifyTask(original, text(data.kind, 100));
            task = manager.update(
              original,
              { verification },
              "verification.completed",
              verification.detail,
            );
            db.outcome(task);
            break;
          }
          case "policy.candidate": {
            if (!local) throw new Error("Policy evaluation requires workstation access.");
            const result = manager.policy.candidate(
              Number(data.historyWeight),
              Number(data.workloadWeight),
              manager.live(),
              data.latencyWeight === undefined ? 0 : Number(data.latencyWeight),
            );
            manager.emit(db.event("policy.evaluated", null, JSON.stringify(result)));
            break;
          }
          case "policy.promote":
            if (!local) throw new Error("Policy promotion requires workstation access.");
            manager.policy.promote(text(data.id, 200));
            break;
          case "policy.rollback":
            if (!local) throw new Error("Policy rollback requires workstation access.");
            manager.policy.rollback();
            break;
          case "legacy.import": {
            if (!local) throw new Error("Legacy import requires workstation access.");
            if (
              !Array.isArray(data.tasks) ||
              !Array.isArray(data.projects) ||
              data.tasks.length > 100 ||
              data.projects.length > 100
            )
              throw new Error("Invalid migration.");
            for (const value of data.tasks) {
              const t = record(value);
              text(t.id, 200);
              text(t.prompt);
              provider(t.provider);
              record(t.decision);
              if (!Array.isArray(t.logs) || !Number.isFinite(t.createdAt))
                throw new Error("Invalid legacy task.");
            }
            for (const value of data.projects) {
              const p = record(value);
              text(p.id, 200);
              text(p.path, 2000);
              text(p.name, 100);
            }
            manager.importLegacy(data.tasks as OrchTask[], data.projects as Project[]);
            break;
          }
          case "pairing.create": {
            if (!local) throw new Error("Pairing can only be initiated on the workstation.");
            pairCode = randomBytes(12).toString("base64url");
            pairing = { codeHash: hash(pairCode), expiresAt: Date.now() + 600000 };
            manager.emit(
              db.event(
                "pairing.created",
                null,
                "One-time pairing code created; expires in 10 minutes.",
              ),
            );
            break;
          }
          case "device.revoke": {
            // The workstation revokes any device; a paired device may only sign itself out.
            const id = data.id === undefined && device ? device.id : text(data.id, 200);
            if (device && id !== device.id)
              throw new WorkstationRequiredError("Revoking another device requires workstation access on the Windows Host.");
            const changed = Number(
              db.db.prepare("UPDATE devices SET revoked_at=? WHERE id=? AND revoked_at IS NULL").run(Date.now(), id).changes,
            );
            if (!changed) throw new CommandRefusedError("Unknown or already revoked device.");
            const closed = deviceStreams.closeDevice(id);
            // A lost device's authority ends with it: batches it created and Agentic consent it approved.
            const ended = local ? await endDeviceGrants(`device:${id}`) : { batches: 0, delegations: 0 };
            manager.emit(
              db.event(
                "device.revoked",
                null,
                `Device credential revoked: ${id} by ${local ? "the workstation" : "the device itself (sign out)"}; ${closed} open stream(s) closed; ${ended.batches} batch(es) and ${ended.delegations} Agentic consent(s) it granted ended.`,
              ),
            );
            break;
          }
          case "resume":
          case "pause":
            throw new Error(
              "Pause and resume are not supported: the current provider sessions expose no reliable pause or resume mechanism.",
            );
          default:
            throw new Error("Unknown Host action.");
        }
      manager.emit(
        db.event(
          "audit.command",
          task?.id ?? null,
          `${local ? "workstation" : `device ${device!.id}`}: ${String(input.action)}`,
        ),
      );
      if (began && operationId) ledger.finish(actor, operationId, { state: "applied", status: 200 });
      if (device && action === "device.revoke")
        return json(res, { signedOut: true, ...(operationId ? { operation: { id: operationId, state: "applied", replayed: false } } : {}) });
      // Already-admitted effects may finish, but a revoked device receives no new protected projection.
      if (device) {
        const currentAuth = authenticateDevice(db.db, hash(bearer));
        if (!currentAuth.ok) return json(res, { error: "Authentication required.", code: currentAuth.code }, 401);
      }
      const projected = viewFor(after, principal);
      if (device) {
        if (extra.agents) extra.agents = projected.agents;
        if (extra.agent) extra.agent = projected.agents?.agents.find((row) => row.id === data.id);
        if (extra.mission && typeof extra.mission === "object" && "id" in extra.mission)
          extra.mission = projected.missions?.missions.find((row) => row.id === (extra.mission as { id: string }).id);
      }
      json(res, {
        snapshot: projected,
        task: device && task ? projected.tasks.find((row) => row.id === task!.id) ?? deviceTask(task) : task,
        pairCode,
        session,
        ...extra,
        ...(began && operationId ? { operation: { id: operationId, state: "applied", replayed: false } } : {}),
      });
    } catch (error) {
      const requestId = containment.context.getStore()?.owner.requestId;
      if (!(error instanceof CommandRefusedError) && !(error instanceof HostUnavailableError))
        await containment.contain(error, "boundary", {
          owner: { subsystem: "http-command", requestId },
        });
      const status = error instanceof HostUnavailableError ? 503 : error instanceof CodedRefusal ? error.status : 400;
      const code =
        error instanceof HostUnavailableError
          ? "HOST_UNAVAILABLE"
          : error instanceof WorkstationRequiredError
            ? "WORKSTATION_REQUIRED"
            : error instanceof CodedRefusal
              ? error.code
              : error instanceof CommandRefusedError
                ? "REFUSED"
                : "FAILED";
      const message =
        error instanceof HostUnavailableError
          ? error.message
          : error instanceof CommandRefusedError
            ? safeError(error, [token]).message
            : "Host command failed. Inspect operation state before retrying.";
      // A refusal executed nothing; a failure (or an unavailable Host mid-command) may have partly applied,
      // so its operation is "failed" and the client reconciles from canonical state.
      const state: OperationState = code === "FAILED" || code === "HOST_UNAVAILABLE" ? "failed" : "refused";
      if (began && operationId) ledger.finish(actor, operationId, { state, status, code, error: message });
      if (device && action && code !== "RATE_LIMITED")
        manager.emit(db.event("audit.device_refused", null, `device ${device.id}: ${action} (${code})`));
      json(
        res,
        {
          requestId,
          error: message,
          code,
          ...(began && operationId ? { operation: { id: operationId, state, replayed: false } } : {}),
        },
        status,
      );
    }
  };
  /** Workstation revocation of a lost device ends the authority that device granted (never on self sign-out). */
  const endDeviceGrants = async (deviceActor: string) => {
    let batches = 0,
      delegations = 0;
    for (const row of db.db
      .prepare("SELECT id, mission_id AS missionId FROM approval_batches WHERE status='active' AND created_by=?")
      .all(deviceActor) as { id: string; missionId: string }[])
      try {
        missions.revokeBatch(row.missionId, row.id, `workstation (revoked ${deviceActor})`);
        batches++;
      } catch {
        /* Already ended by its own lifecycle. */
      }
    for (const row of db.db.prepare("SELECT id, agent_id AS agentId FROM agentic_authorizations").all() as { id: string; agentId: string }[])
      try {
        const e = missions.agentic.get(row.id);
        if (!e || e.authorization_provenance?.actor !== deviceActor || !["ACTIVE", "PAUSED"].includes(e.current_state)) continue;
        missions.syncAgentic(missions.agentic.state(e.id, "REVOKED"));
        delegations++;
        const profile = agents.store.agent(row.agentId);
        if (profile && !profile.stoppedAt && !profile.completedAt) await agents.stop(row.agentId, `workstation (revoked ${deviceActor})`);
      } catch {
        /* A corrupt or already-ended record fails closed; Stop remains available on the workstation. */
      }
    return { batches, delegations };
  };
  const server = createServer((req, res) => {
    const requestId = randomUUID();
    res.on("error", () => {
      try {
        res.destroy();
      } catch {
        /* Disconnected client. */
      }
    });
    containment.background(
      { subsystem: "http", requestId },
      () => handler(req, res),
      () => {
        try {
          if (!res.headersSent)
            json(
              res,
              { error: "Host request failed. Inspect operation state before retrying.", requestId },
              500,
            );
          else res.destroy();
        } catch {
          res.destroy();
        }
      },
    );
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", resolveListen);
  });
  writeFileSync(
    credentialPath,
    JSON.stringify({ token, port, pid: process.pid, instanceId: manager.instanceId }),
    { mode: 0o600 },
  );
  let closing = false;
  let closed: Promise<void> | null = null;
  const loops: { stop: () => void }[] = [];
  const close = () => {
    if (closed) return closed;
    closing = true;
    for (const loop of loops) loop.stop();
    missions.deactivate();
    closed = (async () => {
      const ownedCleanup = stopOwnedChildren();
      try {
        await Promise.allSettled(
          [...manager.sessions.keys()].map((id) =>
            containment.health.operationalState === "draining"
              ? manager.failOperation(id, {
                  name: "HostFatal",
                  message:
                    "Host fatal shutdown interrupted this owned task; no session was resumed.",
                })
              : manager.stop(id, "Host shutdown stopped this owned task."),
          ),
        );
        agents.close();
        await missions.close();
      } finally {
        await ownedCleanup;
      }
      await new Promise<void>((r) => {
        server.closeAllConnections();
        server.close(() => r());
      });
      db.close();
      process.off("SIGTERM", signalClose);
      process.off("SIGINT", signalClose);
      if (containment.health.operationalState !== "draining") options.removeProcessHandlers?.();
    })();
    return closed;
  };
  containment.options.shutdown = close;
  const signalClose = () =>
    containment.background(
      { subsystem: "shutdown" },
      async () => {
        await close();
        process.exit(0);
      },
      undefined,
      "HOST_FATAL",
    );
  process.once("SIGTERM", signalClose);
  process.once("SIGINT", signalClose);
  server.on("error", (error) =>
    containment.background(
      { subsystem: "http" },
      () => {
        throw error;
      },
      undefined,
      "SUBSYSTEM_FAILURE",
    ),
  );
  containment.finishRecovery();
  await manager.discover();
  const poll = async () => {
    if (closing) return;
    manager.sample(await (options.sample ?? sampleHost)());
  };
  const unavailable = () => {
    manager.samples = manager.samples.map((sample) => ({
      ...sample,
      cpu: { ...sample.cpu, utilization: null, temperatureC: null, clockMhz: null },
      gpus: sample.gpus.map((gpu) => ({
        ...gpu,
        utilization: null,
        temperatureC: null,
        note: "Sensor unavailable.",
      })),
    }));
  };
  // Every 30 s: cheap health checks; full CLI probes only when their interval is due (the registry decides).
  try {
    await poll();
  } catch (error) {
    unavailable();
    await containment.contain(error, "boundary", { owner: { subsystem: "telemetry" } });
  }
  loops.push(supervisedLoop(containment, { subsystem: "telemetry" }, poll, 3000, unavailable));
  loops.push(
    supervisedLoop(
      containment,
      { subsystem: "provider-discovery" },
      () => manager.refreshProviders(),
      30000,
      undefined,
      "SUBSYSTEM_FAILURE",
    ),
  );
  console.log(`Bunny-A Host ready on loopback (${manager.instanceId}).`);
  return { server, manager, missions, agents, projects, close, token, port, containment };
}
