import { createHmac, randomBytes, randomUUID } from "node:crypto";
import { spawn } from "node:child_process";
import type { HostDatabase } from "./persistence.server.ts";
import type { ProviderId, ProviderLive } from "../orch/types.ts";
import {
  CONNECTION_CATALOG,
  DEFAULT_ROUTING_POLICY,
  catalogEntry,
  catalogMode,
  connectionId,
  connectionDeviceView,
  defaultConsent,
  defaultModeFor,
  evaluateDispatch,
  localDayStart,
  maskIdentity,
  parseConnectionId,
  scrubChildEnvironment,
  type ApprovedRoute,
  type ConnectionView,
  type DeviceConnectionView,
  type DispatchRequest,
  type RoutingPrivacyPolicy,
  type UsageView,
  type Vendor,
} from "./connections.ts";
import { API_KEY_SHAPE, DpapiProtector, type SecretProtector } from "./jev-secrets.server.ts";
import { registerDiagnosticSecret } from "./failure.server.ts";
import { locate, systemContext, type Launchable } from "./discovery.server.ts";
import { systemTool } from "./system-tools.server.ts";
import { pruneUsage } from "./usage-retention.server.ts";

export type NativeAccount = {
  principal: string | null;
  workspace?: string | null;
  method: string | null;
  plan?: string | null;
};
export type ConnectionSeams = {
  now?: () => number;
  protector?: SecretProtector;
  fetch?: typeof fetch;
  launcher?: (launch: Launchable, args: readonly string[], env: Record<string, string>) => void;
  locate?: (provider: ProviderId) => Launchable | null;
  sessionId?: string;
};
export type ConnectionsSnapshot = {
  version: 1;
  accounts: ConnectionView[];
  policy: RoutingPrivacyPolicy;
  usage: UsageView;
  audit: { at: number; detail: string }[];
};

function initial(id: string): ConnectionView {
  const parsed = parseConnectionId(id);
  if (!parsed) throw new Error("Invalid connection.");
  const mode = catalogMode(parsed.catalog, parsed.mode)!;
  return {
    id,
    catalog: parsed.catalog,
    mode: mode.mode,
    vendor: mode.vendor,
    support: mode.support,
    dispatch: mode.dispatch,
    billing: mode.billing,
    status: mode.support === "unsupported" ? "unsupported" : "not_connected",
    session: mode.mode === "local_runtime" ? "not_required" : "unknown",
    entitlement: mode.mode === "local_runtime" ? "not_applicable" : "unknown",
    tool: "unknown",
    lifecycle: "active",
    epoch: 1,
    accountFingerprint: null,
    maskedIdentity: null,
    maskedWorkspace: null,
    plan: { label: null, source: "unknown" },
    consent: defaultConsent(mode),
    credential: null,
    authMethod: null,
    lastCheckedAt: null,
    authVerifiedAt: null,
    entitlementVerifiedAt: null,
    detail: mode.reason ?? mode.detail,
    toolInfo: null,
    capabilities: [],
    usageWindows: [],
    usageObservedAt: null,
    lastUsedAt: null,
    tasksToday: 0,
    identitySource: "none",
  };
}

/** Provider-owned interactive sign-in. The user owns the visible console; Bunny captures no output or secrets. */
function launchNative(launch: Launchable, args: readonly string[], env: Record<string, string>) {
  if (process.platform !== "win32")
    throw new Error("Native sign-in opens on the Windows workstation only.");
  const q = (s: string) => `'${s.replace(/'/g, "''")}'`;
  const script = `& ${q(launch.command)} ${[...launch.args, ...args].map(q).join(" ")}`;
  const child = spawn(
    systemTool("powershell.exe"),
    ["-NoProfile", "-NoExit", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
    { env, detached: true, windowsHide: false, stdio: "ignore", shell: false },
  );
  child.on("error", () => undefined);
  child.unref();
}

/** Host-owned state and dispatch authority. Owns no scheduler and never reads another client's credential files. */
export class ConnectionRegistry {
  private records = new Map<string, ConnectionView>();
  private live = new Map<ProviderId, ProviderLive>();
  private revoked = new Set<(id: string, reason: string) => void>();
  private transactions = new Map<string, { epoch: number; expires: number; hint: string | null }>();
  private selectedPolicy: RoutingPrivacyPolicy = structuredClone(DEFAULT_ROUTING_POLICY);
  private salt: string;
  private clock: () => number;
  private timer: ReturnType<typeof setInterval>;
  private closed = false;
  private readonly options: {
    db: HostDatabase;
    emit: (type: string, detail: string) => void;
  } & ConnectionSeams;
  constructor(
    options: { db: HostDatabase; emit: (type: string, detail: string) => void } & ConnectionSeams,
  ) {
    this.options = options;
    this.clock = options.now ?? Date.now;
    const db = options.db.db;
    db.exec(`CREATE TABLE IF NOT EXISTS settings(key TEXT PRIMARY KEY,value TEXT NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_accounts(id TEXT PRIMARY KEY,record TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_credentials(handle TEXT PRIMARY KEY,connection_id TEXT NOT NULL UNIQUE,ciphertext BLOB NOT NULL,protector TEXT NOT NULL,updated_at INTEGER NOT NULL);
      CREATE TABLE IF NOT EXISTS connection_usage(id INTEGER PRIMARY KEY AUTOINCREMENT,at INTEGER NOT NULL,connection_id TEXT NOT NULL,task_id TEXT,kind TEXT NOT NULL,outcome TEXT NOT NULL,input_tokens INTEGER,output_tokens INTEGER,cost_usd REAL,cost_source TEXT);
      CREATE INDEX IF NOT EXISTS connection_usage_at ON connection_usage(at);`);
    db.prepare(
      "UPDATE connection_usage SET outcome='unknown_restart' WHERE outcome='pending'",
    ).run();
    const savedSalt = db
      .prepare("SELECT value FROM settings WHERE key='connections_salt_v1'")
      .get() as { value: string } | undefined;
    this.salt = savedSalt?.value ?? randomBytes(32).toString("hex");
    if (!savedSalt)
      db.prepare("INSERT INTO settings VALUES('connections_salt_v1',?)").run(this.salt);
    try {
      const row = db
        .prepare("SELECT value FROM settings WHERE key='connections_policy_v1'")
        .get() as { value: string } | undefined;
      if (row) this.selectedPolicy = this.validatePolicy(JSON.parse(row.value));
    } catch {
      /* Corruption never grants authority. */
    }
    for (const entry of CONNECTION_CATALOG)
      for (const mode of entry.modes)
        this.records.set(
          connectionId(entry.id, mode.mode),
          initial(connectionId(entry.id, mode.mode)),
        );
    for (const row of db.prepare("SELECT id,record FROM connection_accounts").all() as {
      id: string;
      record: string;
    }[]) {
      if (!parseConnectionId(row.id)) continue;
      const base = initial(row.id);
      try {
        const saved = JSON.parse(row.record) as ConnectionView;
        if (
          !Number.isSafeInteger(saved.epoch) ||
          saved.epoch < 1 ||
          !["active", "paused", "disconnected"].includes(saved.lifecycle)
        )
          throw new Error("Invalid row");
        const consent = this.validateConsent(saved.consent, base.consent);
        this.records.set(row.id, {
          ...base,
          lifecycle: saved.lifecycle,
          epoch: saved.epoch,
          consent: {
            ...consent,
            revision: Number.isSafeInteger(saved.consent.revision) ? saved.consent.revision : 1,
            grantedAt: saved.consent.grantedAt,
            provenance: saved.consent.provenance,
          },
          accountFingerprint:
            typeof saved.accountFingerprint === "string" ? saved.accountFingerprint : null,
          maskedIdentity: typeof saved.maskedIdentity === "string" ? saved.maskedIdentity : null,
          maskedWorkspace: typeof saved.maskedWorkspace === "string" ? saved.maskedWorkspace : null,
        });
      } catch {
        this.records.set(row.id, {
          ...base,
          lifecycle: "disconnected",
          consent: { ...base.consent, allowTasks: false },
        });
      }
    }
    this.prune();
    this.timer = setInterval(() => this.prune(), 86_400_000);
    this.timer.unref();
  }
  private hash(value: string) {
    return createHmac("sha256", this.salt).update(value).digest("hex");
  }
  private save(row: ConnectionView) {
    if (this.closed) return;
    this.records.set(row.id, row);
    this.options.db.db
      .prepare(
        "INSERT INTO connection_accounts VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET record=excluded.record,updated_at=excluded.updated_at",
      )
      .run(row.id, JSON.stringify(row), this.clock());
  }
  private notify(id: string, reason: string) {
    for (const listener of this.revoked) listener(id, reason);
  }
  onRevoked(listener: (id: string, reason: string) => void) {
    this.revoked.add(listener);
    return () => this.revoked.delete(listener);
  }
  policy() {
    return structuredClone(this.selectedPolicy);
  }
  views() {
    const usage = this.usage();
    return [...this.records.values()].map((row) => {
      const key = this.options.db.db
        .prepare("SELECT protector,updated_at FROM connection_credentials WHERE connection_id=?")
        .get(row.id) as { protector: string; updated_at: number } | undefined;
      let status = row.status;
      if (row.lifecycle === "disconnected") status = "not_connected";
      else if (row.lifecycle === "paused") status = "paused";
      else if (row.support === "unsupported") status = "unsupported";
      else if (row.tool === "missing" || row.tool === "offline") status = "offline";
      else if (row.session === "account_switched" || row.session === "expired")
        status = "reconnect_required";
      else if (row.session === "signed_out") status = "sign_in_required";
      else if (row.entitlement === "rate_limited" || row.entitlement === "exhausted")
        status = "rate_limited";
      const tasksToday = usage.requestsToday[row.id] ?? 0;
      if (
        row.lifecycle === "active" &&
        row.dispatch &&
        row.consent.allowTasks &&
        row.tool === "ready" &&
        ["signed_in", "not_required"].includes(row.session) &&
        !["rate_limited", "exhausted", "not_entitled", "billing_problem"].includes(
          row.entitlement,
        ) &&
        ((row.consent.maxRequestsPerDay !== null && tasksToday >= row.consent.maxRequestsPerDay) ||
          (!["api_billed", "metered_credits", "unknown"].includes(row.billing) &&
            row.consent.maxUsdPerDay !== null))
      )
        status = "budget_blocked";
      return structuredClone({
        ...row,
        tasksToday,
        status,
        credential: key
          ? { present: true, updatedAt: key.updated_at, protection: key.protector }
          : null,
      });
    });
  }
  deviceView(): DeviceConnectionView[] {
    return this.views().map(connectionDeviceView);
  }
  snapshot(): ConnectionsSnapshot {
    return {
      version: 1,
      accounts: this.views(),
      policy: this.policy(),
      usage: this.usage(),
      audit: this.options.db
        .recentEvents()
        .filter((e) => e.type.startsWith("connections.") || e.type === "routing.consent_denied")
        .map((e) => ({ at: e.at, detail: e.detail }))
        .slice(-20),
    };
  }
  usage(now = this.clock()): UsageView {
    const requestsToday: Record<string, number> = {},
      usdToday: Record<string, number | null> = {};
    for (const row of this.options.db.db
      .prepare(
        "SELECT connection_id AS id,COUNT(*) AS n,SUM(cost_usd) AS usd,SUM(CASE WHEN cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown FROM connection_usage WHERE at>=? GROUP BY connection_id",
      )
      .all(localDayStart(now)) as {
      id: string;
      n: number;
      usd: number | null;
      unknown: number;
    }[]) {
      requestsToday[row.id] = row.n;
      usdToday[row.id] = row.unknown ? null : (row.usd ?? 0);
    }
    return { requestsToday, usdToday };
  }
  evaluate(request: DispatchRequest, ownReservation?: { id: number; taskId: string } | null) {
    const provider = this.live.get(request.provider);
    // Remote metadata from this Host probe wins over client/model-name guesses.
    const remoteModels = provider?.remoteModels ?? request.remoteModels ?? [];
    if (request.provider === "ollama" && !provider)
      return {
        ok: false as const,
        code: "TOOL_UNAVAILABLE" as const,
        reason: "Check the Ollama runtime before routing.",
        connectionId: null,
      };
    const usage = this.usage();
    if (ownReservation) {
      const row = this.options.db.db
        .prepare(
          "SELECT connection_id AS id FROM connection_usage WHERE id=? AND task_id=? AND outcome='pending'",
        )
        .get(ownReservation.id, ownReservation.taskId) as { id: string } | undefined;
      if (row)
        usage.requestsToday = {
          ...usage.requestsToday,
          [row.id]: Math.max(0, (usage.requestsToday[row.id] ?? 0) - 1),
        };
    }
    return evaluateDispatch({ ...request, remoteModels }, this.views(), this.selectedPolicy, usage);
  }
  bind(
    provider: ProviderId,
    model: string | null,
    approvedBy: ApprovedRoute["approvedBy"] = "workstation",
    projectId: string | null = null,
    additionalProviders: readonly ProviderId[] = [],
  ): ApprovedRoute | null {
    const verdict = this.evaluate({
      kind: "advice",
      provider,
      model,
      projectId,
      origin: approvedBy,
      route: null,
    });
    if (!verdict.ok) return null;
    const allowed = this.views().filter(
      (row) =>
        row.id === verdict.connectionId ||
        this.selectedPolicy.switchAllowlist.includes(row.vendor) ||
        additionalProviders.includes(catalogEntry(row.catalog).providerId!),
    );
    const destinationBindings = allowed
      .filter(
        (row) =>
          row.dispatch &&
          row.lifecycle === "active" &&
          row.consent.allowTasks &&
          (row.session === "signed_in" || row.session === "not_required") &&
          (row.consent.projects === "all" || row.consent.projects.includes(projectId ?? "")),
      )
      .map((row) => ({
        connectionId: row.id,
        mode: row.mode,
        accountFingerprint: row.accountFingerprint,
        connectionEpoch: row.epoch,
        consentRevision: row.consent.revision,
      }));
    return {
      provider,
      vendor: verdict.vendor,
      connectionId: verdict.connectionId,
      mode: verdict.mode,
      accountFingerprint: verdict.accountFingerprint,
      connectionEpoch: verdict.epoch,
      consentRevision: verdict.consentRevision,
      consentedVendors: [verdict.vendor],
      destinationBindings,
      approvedAt: this.clock(),
      approvedBy,
    };
  }
  ingestProviderLive(
    live: readonly ProviderLive[],
    facts: (id: ProviderId) => NativeAccount | null | undefined,
  ) {
    for (const provider of live) {
      this.live.set(provider.id, provider);
      const family = defaultModeFor(provider.id, null);
      if (!family) continue;
      const id = connectionId(family.catalog, family.mode);
      const row = this.records.get(id);
      if (!row) continue;
      const next = {
        ...row,
        lastCheckedAt: provider.probedAt ?? this.clock(),
        tool: provider.installed
          ? ["offline", "unavailable"].includes(provider.availability)
            ? ("offline" as const)
            : ("ready" as const)
          : ("missing" as const),
      };
      if (provider.id === "ollama") {
        next.session = "not_required";
        next.entitlement = "not_applicable";
        next.status = next.tool === "ready" ? "connected" : "offline";
      } else {
        const identity = facts(provider.id);
        const trustedFixture = identity === undefined;
        const method = identity?.method ?? (trustedFixture ? "native_status" : null);
        const signed =
          provider.authenticated &&
          (trustedFixture ||
            (provider.id === "codex"
              ? method === "chatgpt"
              : provider.id === "claude"
                ? method === "claude.ai"
                : true));
        const principal = identity?.principal ?? (trustedFixture ? `fixture:${provider.id}` : null);
        const fingerprint =
          signed && principal
            ? this.hash(`${family.catalog}\0${principal}\0${identity?.workspace ?? ""}`)
            : null;
        if (fingerprint && row.accountFingerprint && fingerprint !== row.accountFingerprint) {
          next.session = "account_switched";
          next.epoch++;
          this.notify(id, "Provider account changed; the Task requires a new review.");
        } else if (row.session !== "account_switched")
          next.session =
            signed && fingerprint
              ? "signed_in"
              : provider.authenticatedState === "not_authenticated"
                ? "signed_out"
                : "unknown";
        if (
          row.session === "signed_in" &&
          next.session !== "signed_in" &&
          next.session !== "account_switched"
        ) {
          next.epoch++;
          this.notify(
            id,
            "Provider sign-in could no longer be verified; active work was stopped for review.",
          );
        }
        next.accountFingerprint = fingerprint ?? row.accountFingerprint;
        next.maskedIdentity = maskIdentity(identity?.principal) ?? row.maskedIdentity;
        next.maskedWorkspace = maskIdentity(identity?.workspace) ?? row.maskedWorkspace;
        next.authMethod = method;
        next.plan = {
          label: identity?.plan ?? null,
          source: identity?.plan ? "provider_reported" : "unknown",
        };
        next.entitlement =
          provider.availability === "rate_limited"
            ? "rate_limited"
            : identity?.plan
              ? "plan_reported"
              : "unknown";
        next.status = next.session === "signed_in" ? "connected" : "sign_in_required";
        next.authVerifiedAt = next.session === "signed_in" ? this.clock() : null;
        if (method && !["chatgpt", "claude.ai", "native_status"].includes(method))
          next.detail =
            "The native client uses a different authentication/billing mode; subscription dispatch is refused.";
      }
      const tx = this.transactions.get(id);
      if (tx) {
        if (this.clock() > tx.expires || tx.epoch !== row.epoch) this.transactions.delete(id);
        else if (next.session === "signed_in") {
          if (
            tx.hint &&
            this.hash(facts(provider.id)?.principal?.toLowerCase() ?? "") !== tx.hint
          ) {
            next.session = "account_switched";
            next.detail =
              "The provider signed in as another account. Confirm the account before sending Tasks.";
          }
          this.transactions.delete(id);
        }
      }
      this.save(next);
    }
  }
  childEnvironment() {
    return scrubChildEnvironment(process.env).env;
  }
  observeBillingSource(id: string, source: string) {
    if (source === "none") return "ok";
    const row = this.records.get(id);
    if (row) {
      this.save({
        ...row,
        session: "expired",
        status: "reconnect_required",
        epoch: row.epoch + 1,
        detail: "The native client selected API billing; this session was stopped.",
      });
      this.notify(id, "billing_mode_mismatch: unexpected API billing source.");
    }
    return "mismatch";
  }
  observeOutcome(id: string, taxonomy: string) {
    const row = this.records.get(id);
    if (!row) return;
    if (/AUTH/.test(taxonomy)) {
      this.save({ ...row, session: "expired", epoch: row.epoch + 1 });
      this.notify(id, "Provider authorization expired.");
    } else if (/QUOTA|RATE_LIMIT/.test(taxonomy))
      this.save({ ...row, entitlement: "rate_limited", status: "rate_limited" });
  }
  recordDispatch(id: string, taskId: string) {
    return Number(
      this.options.db.db
        .prepare(
          "INSERT INTO connection_usage(at,connection_id,task_id,kind,outcome,cost_usd,cost_source) VALUES(?,?,?,'dispatch','pending',NULL,'provider_unknown')",
        )
        .run(this.clock(), id, taskId).lastInsertRowid,
    );
  }
  settle(id: number, ok: boolean) {
    this.options.db.db
      .prepare("UPDATE connection_usage SET outcome=? WHERE id=? AND outcome='pending'")
      .run(ok ? "completed" : "failed", id);
  }
  private validateConsent(raw: unknown, base: ConnectionView["consent"]) {
    if (!raw || typeof raw !== "object") throw new Error("Invalid consent.");
    const c = raw as ConnectionView["consent"];
    if (
      typeof c.allowTasks !== "boolean" ||
      typeof c.billingOptIn !== "boolean" ||
      typeof c.strictBudget !== "boolean" ||
      !(
        c.projects === "all" ||
        (Array.isArray(c.projects) &&
          c.projects.length <= 100 &&
          c.projects.every((p) => typeof p === "string" && p.length <= 200))
      ) ||
      !(
        c.maxRequestsPerDay === null ||
        (Number.isSafeInteger(c.maxRequestsPerDay) &&
          c.maxRequestsPerDay >= 0 &&
          c.maxRequestsPerDay <= 10000)
      ) ||
      !(
        c.maxUsdPerDay === null ||
        (typeof c.maxUsdPerDay === "number" &&
          Number.isFinite(c.maxUsdPerDay) &&
          c.maxUsdPerDay >= 0 &&
          c.maxUsdPerDay <= 10000)
      )
    )
      throw new Error("Invalid consent limits or project scope.");
    return {
      ...base,
      allowTasks: c.allowTasks,
      billingOptIn: c.billingOptIn,
      strictBudget: c.strictBudget,
      projects: c.projects,
      maxRequestsPerDay: c.maxRequestsPerDay,
      maxUsdPerDay: c.maxUsdPerDay,
    };
  }
  private validatePolicy(raw: unknown): RoutingPrivacyPolicy {
    const p = raw as RoutingPrivacyPolicy;
    const vendors: Vendor[] = [
      "openai",
      "anthropic",
      "cursor",
      "cline",
      "xai",
      "ollama_cloud",
      "opencode",
      "google",
      "github",
      "openrouter",
      "local",
    ];
    if (
      !p ||
      p.version !== 1 ||
      !Array.isArray(p.switchAllowlist) ||
      p.switchAllowlist.length > 11 ||
      !p.switchAllowlist.every((v) => vendors.includes(v)) ||
      !["same_vendor_or_local", "ask"].includes(p.failover) ||
      !Number.isInteger(p.retentionDays) ||
      p.retentionDays < 7 ||
      p.retentionDays > 365 ||
      !p.selected ||
      typeof p.selected !== "object"
    )
      throw new Error("Invalid routing/privacy policy.");
    for (const [provider, id] of Object.entries(p.selected))
      if (
        !parseConnectionId(id) ||
        catalogEntry(parseConnectionId(id)!.catalog).providerId !== provider
      )
        throw new Error("Selected connection does not match provider.");
    return {
      version: 1,
      switchAllowlist: [...new Set(p.switchAllowlist)],
      failover: p.failover,
      retentionDays: p.retentionDays,
      selected: { ...p.selected },
      revision: this.selectedPolicy.revision + 1,
    };
  }
  prune() {
    const result = pruneUsage(this.options.db, {
      days: this.selectedPolicy.retentionDays,
      sessionId: this.options.sessionId ?? "",
      now: this.clock(),
    });
    if (result.removed)
      this.options.emit(
        "connections.retention",
        `Rolled up ${result.removed} old usage rows; current accounting was preserved.`,
      );
    return result;
  }
  async command(action: string, data: Record<string, unknown>, actor: string) {
    if (!actor.startsWith("workstation"))
      throw new Error("WORKSTATION_REQUIRED: connection authority belongs to the Windows owner.");
    if (action === "connections.policy.set") {
      const next = this.validatePolicy(data.policy);
      this.selectedPolicy = next;
      this.options.db.db
        .prepare(
          "INSERT INTO settings VALUES('connections_policy_v1',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        )
        .run(JSON.stringify(next));
      this.options.emit(
        "connections.configured",
        "Routing privacy policy updated by the Windows owner.",
      );
      return;
    }
    if (action === "connections.retention.run") {
      this.prune();
      return;
    }
    const id =
      typeof data.id === "string"
        ? data.id
        : connectionId(data.catalog as never, data.mode as never);
    const row = this.records.get(id) ?? (parseConnectionId(id) ? initial(id) : null);
    if (!row) throw new Error("Unknown connection.");
    const mode = catalogMode(row.catalog, row.mode)!;
    if (action === "connections.consent.set") {
      const consent = this.validateConsent(data.consent, row.consent);
      this.save({
        ...row,
        consent: {
          ...consent,
          revision: row.consent.revision + 1,
          grantedAt: this.clock(),
          provenance: "owner",
        },
      });
      this.notify(id, "Connection consent changed; active work was stopped for review.");
    } else if (
      action === "connections.pause" ||
      action === "connections.disconnect" ||
      action === "connections.resume" ||
      action === "connections.accept_account"
    ) {
      const lifecycle =
        action === "connections.pause"
          ? "paused"
          : action === "connections.disconnect"
            ? "disconnected"
            : "active";
      this.transactions.delete(id);
      this.save({
        ...row,
        lifecycle,
        epoch: row.epoch + 1,
        session: action === "connections.accept_account" ? "unknown" : row.session,
      });
      if (lifecycle !== "active")
        this.notify(id, `You ${lifecycle} this connection. Native provider login is unchanged.`);
    } else if (action === "connections.credential.remove") {
      this.options.db.db
        .prepare("DELETE FROM connection_credentials WHERE connection_id=?")
        .run(id);
      this.save({ ...row, epoch: row.epoch + 1, session: "signed_out", accountFingerprint: null });
      this.notify(id, "Connection key was removed.");
    } else if (action === "connections.credential.save") {
      if (row.mode !== "api_key" || mode.support === "unsupported")
        throw new Error("This mode accepts no API key.");
      const key = typeof data.apiKey === "string" ? data.apiKey.trim() : "";
      if (!API_KEY_SHAPE.test(key))
        throw new Error("Enter a valid key (8–512 visible characters, no spaces).");
      registerDiagnosticSecret(key);
      const protector =
        this.options.protector ??
        new DpapiProtector(`Bunny-A/Connections/${row.catalog}/${row.mode}/v1`);
      const ciphertext = await protector.protect(key);
      if (ciphertext.includes(Buffer.from(key)))
        throw new Error("Secret protection failed; nothing was saved.");
      if (
        this.closed ||
        ((this.records.get(id)?.epoch !== row.epoch ||
          this.records.get(id)?.consent.revision !== row.consent.revision) &&
          this.records.has(id))
      )
        throw new Error("Connection changed while saving the key.");
      this.options.db.db
        .prepare(
          "INSERT INTO connection_credentials VALUES(?,?,?,?,?) ON CONFLICT(connection_id) DO UPDATE SET ciphertext=excluded.ciphertext,protector=excluded.protector,updated_at=excluded.updated_at",
        )
        .run(randomUUID(), id, ciphertext, protector.kind, this.clock());
      this.save({
        ...row,
        epoch: row.epoch + 1,
        accountFingerprint: this.hash(`${row.catalog}\0${key}`),
        session: "unknown",
        status: "not_connected",
        detail:
          "Key saved encrypted on this PC. Not yet verified; Task dispatch remains unavailable.",
      });
    } else if (action === "connections.check") {
      if (row.mode !== "api_key") return;
      await this.checkKey(row);
    } else if (action === "connections.signin.start" || action === "connections.signout.native") {
      if (mode.support === "unsupported" || mode.signIn.kind !== "native_cli")
        throw new Error(
          "This provider has no verified native sign-in flow here. Use its own site or save a separately billed API key.",
        );
      const entry = catalogEntry(row.catalog);
      if (!entry.providerId || entry.id === "cline" || entry.id === "ollama")
        throw new Error(
          "Open the provider's own client for this connection; Bunny does not launch it automatically.",
        );
      const launch = this.options.locate
        ? this.options.locate(entry.providerId)
        : locate(systemContext(), entry.providerId).launch;
      if (!launch)
        throw new Error("The provider's official client is not installed on this Windows profile.");
      const args =
        action === "connections.signout.native"
          ? entry.id === "anthropic"
            ? ["auth", "logout"]
            : ["logout"]
          : [...mode.signIn.args];
      const hint = typeof data.accountHint === "string" ? data.accountHint.trim() : "";
      if (hint && !/^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}$/.test(hint))
        throw new Error("Enter a plain email account hint.");
      if (hint && mode.signIn.hintFlag) args.push(mode.signIn.hintFlag, hint);
      (this.options.launcher ?? launchNative)(launch, args, scrubChildEnvironment(process.env).env);
      if (action === "connections.signin.start") {
        const next = {
          ...row,
          lifecycle: "active" as const,
          epoch: row.epoch + 1,
          status: "connecting" as const,
          session: "unknown" as const,
        };
        this.save(next);
        this.notify(id, "Provider sign-in started; previous account authority was revoked.");
        this.transactions.set(id, {
          epoch: next.epoch,
          expires: this.clock() + 600_000,
          hint: hint ? this.hash(hint.toLowerCase()) : null,
        });
      } else {
        this.save({ ...row, lifecycle: "disconnected", epoch: row.epoch + 1 });
        this.notify(
          id,
          "Native provider sign-out requested; completion is controlled by the provider.",
        );
      }
    } else if (action === "connections.entitlement.test")
      throw new Error(
        "Live entitlement inference is unavailable in this release. Check status and approve a normal scoped Task; sign-in and plan metadata alone do not verify entitlement.",
      );
    else throw new Error("Unknown connection action.");
    this.options.emit(
      "connections.changed",
      `${catalogEntry(row.catalog).name}: ${action.replace("connections.", "")}.`,
    );
  }
  private async checkKey(row: ConnectionView) {
    if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === "0")
      throw new Error("TLS verification is disabled; connection checks are refused.");
    const keyRow = this.options.db.db
      .prepare("SELECT ciphertext,protector FROM connection_credentials WHERE connection_id=?")
      .get(row.id) as { ciphertext: Uint8Array; protector: string } | undefined;
    if (!keyRow) throw new Error("Save a key on this Windows profile first.");
    const protector =
      this.options.protector ??
      new DpapiProtector(`Bunny-A/Connections/${row.catalog}/${row.mode}/v1`);
    if (protector.kind !== keyRow.protector)
      throw new Error("Key belongs to another protection context.");
    const key = await protector.unprotect(Buffer.from(keyRow.ciphertext));
    registerDiagnosticSecret(key);
    if (
      this.closed ||
      this.records.get(row.id)?.epoch !== row.epoch ||
      this.records.get(row.id)?.consent.revision !== row.consent.revision
    )
      throw new Error(
        "Connection authorization changed before the metadata check; nothing was sent.",
      );
    const endpoints: Partial<Record<ConnectionView["catalog"], { url: string; header: string }>> = {
      openai: { url: "https://api.openai.com/v1/models", header: "Authorization" },
      anthropic: { url: "https://api.anthropic.com/v1/models", header: "x-api-key" },
      xai: { url: "https://api.x.ai/v1/api-key", header: "Authorization" },
      gemini: {
        url: "https://generativelanguage.googleapis.com/v1beta/models",
        header: "x-goog-api-key",
      },
      openrouter: { url: "https://openrouter.ai/api/v1/key", header: "Authorization" },
    };
    const endpoint = endpoints[row.catalog];
    if (!endpoint) throw new Error("No approved metadata-check endpoint exists.");
    const headers: Record<string, string> = {
      [endpoint.header]: endpoint.header === "Authorization" ? `Bearer ${key}` : key,
    };
    if (row.catalog === "anthropic") headers["anthropic-version"] = "2023-06-01";
    let status = 0;
    try {
      const response = await (this.options.fetch ?? fetch)(endpoint.url, {
        method: "GET",
        headers,
        redirect: "error",
        signal: AbortSignal.timeout(8000),
      });
      status = response.status;
      // Body contents and provider diagnostic text never enter state or logs.
      const reader = response.body?.getReader();
      let size = 0;
      if (reader)
        try {
          for (;;) {
            const part = await reader.read();
            if (part.done) break;
            size += part.value.byteLength;
            if (size > 262144) throw new Error("Response too large");
          }
        } finally {
          await reader.cancel().catch(() => undefined);
        }
    } catch {
      status = 0;
    }
    if (
      this.closed ||
      this.records.get(row.id)?.epoch !== row.epoch ||
      this.records.get(row.id)?.consent.revision !== row.consent.revision
    )
      return;
    this.save({
      ...row,
      lastCheckedAt: this.clock(),
      authVerifiedAt: status >= 200 && status < 300 ? this.clock() : null,
      session:
        status >= 200 && status < 300
          ? "signed_in"
          : status === 401 || status === 403
            ? "signed_out"
            : "unknown",
      status:
        status >= 200 && status < 300
          ? "connected"
          : status === 429
            ? "rate_limited"
            : status === 401 || status === 403
              ? "sign_in_required"
              : "offline",
      entitlement: "unknown",
      detail:
        status >= 200 && status < 300
          ? "Provider accepted this key for a non-inference metadata check. Billing is separate; inference entitlement and Task dispatch are unverified."
          : "The provider metadata check did not establish a usable connection.",
    });
    this.options.emit(
      "connections.checked",
      `${catalogEntry(row.catalog).name}: metadata authentication ${status >= 200 && status < 300 ? "verified" : "unverified"}; no inference sent.`,
    );
  }
  close() {
    this.closed = true;
    clearInterval(this.timer);
    this.transactions.clear();
    this.revoked.clear();
  }
}
