/**
 * Widget projections (pure). Every figure is a Host field the caller already has. A missing ledger, a missing voice
 * snapshot or a paired phone is a named gap — never a zero, never a fabricated percentage, never another Agent's memory.
 */
import type { SessionLedgerView, Known } from "../../lib/bunny-host/session-ledger.ts";
import type { PersonalAgentView } from "../../lib/bunny-host/personal-agents.ts";
import { presentationLabel } from "../../lib/bunny-host/personal-agents.ts";
import type { SnapshotViewer } from "../../lib/bunny-host/contracts.ts";
import { RECONCILE_HEADLINE, mayReconcile, type ReconcileItem } from "./reconciliation-model.ts";
import {
  notchCue, WIDGET_SCHEMA, parseWidgetPreference, validateWidgetPreference,
  type WidgetFocus, type WidgetPreference, type WidgetView,
} from "../../lib/bunny-host/widgets.ts";

export type WidgetViewer = "workstation" | "device" | "unknown";
export const widgetViewer = (viewer: SnapshotViewer | null | undefined): WidgetViewer =>
  viewer?.kind === "workstation" ? "workstation" : viewer?.kind === "device" ? "device" : "unknown";

export type StepFact = {
  id: string;
  role: string;
  state: string;
  dependsOn: readonly string[];
  verified: boolean | null;
  reconcile: boolean;
};
export type MissionFact = {
  id: string;
  title: string;
  projectId: string | null;
  state: string;
  updatedAt: number;
  failure: boolean;
  steps: readonly StepFact[];
};

const ACTIVE_STEP = new Set(["running", "verifying", "waiting_for_approval"]);
const DONE_STEP = new Set(["completed", "skipped"]);
const WAITING_STEP = new Set(["waiting_for_approval", "blocked", "pending"]);

export type MissionWidgetModel = {
  state: "offline" | "empty" | "ready";
  note: string;
  mission: null | {
    id: string;
    title: string;
    owner: string | null;
    active: string | null;
    verified: number;
    pending: number;
    waiting: number;
    failed: number;
    dependencies: number;
    reconcile: boolean;
    failure: boolean;
  };
};

/** A full Host list wins, except a row older than one already shown for the same Mission cannot roll it back. */
export function mergeMissions(previous: readonly MissionFact[], incoming: readonly MissionFact[]): MissionFact[] {
  const prior = new Map(previous.map((row) => [row.id, row]));
  return incoming.map((row) => {
    const old = prior.get(row.id);
    return old && old.updatedAt > row.updatedAt ? old : row;
  });
}

export function missionWidget(input: {
  online: boolean;
  missions: readonly MissionFact[];
  slots: readonly { slot: number; name: string; missionId: string | null }[];
  focus: WidgetFocus;
}): MissionWidgetModel {
  if (!input.online) return { state: "offline", note: "Offline. Mission progress stays on the Host until this window reconnects.", mission: null };
  const owned = new Map(input.slots.filter((slot) => slot.missionId).map((slot) => [slot.missionId, slot.name]));
  let rows = input.missions.slice();
  if (input.focus.projectId) rows = rows.filter((row) => row.projectId === input.focus.projectId);
  if (input.focus.slot) {
    const missionId = input.slots.find((slot) => slot.slot === input.focus.slot)?.missionId ?? null;
    rows = missionId ? rows.filter((row) => row.id === missionId) : [];
  }
  const mission = rows.find((row) => !["COMPLETED", "FAILED", "STOPPED"].includes(row.state)) ?? rows[0] ?? null;
  if (!mission) return { state: "empty", note: input.focus.projectId || input.focus.slot ? "Nothing in this filter is on the Host." : "No Mission is on the Host.", mission: null };
  const steps = mission.steps;
  const active = steps.find((step) => ACTIVE_STEP.has(step.state));
  return {
    state: "ready",
    note: `${steps.filter((step) => DONE_STEP.has(step.state)).length} of ${steps.length} steps completed. The Host did not provide a progress percentage.`,
    mission: {
      id: mission.id,
      title: mission.title,
      owner: owned.get(mission.id) ?? null,
      active: active ? active.role : null,
      verified: steps.filter((step) => step.verified === true).length,
      pending: steps.filter((step) => step.state === "pending" || step.state === "ready").length,
      waiting: steps.filter((step) => WAITING_STEP.has(step.state)).length,
      failed: steps.filter((step) => step.state === "failed").length,
      dependencies: steps.reduce((sum, step) => sum + step.dependsOn.length, 0),
      reconcile: steps.some((step) => step.reconcile),
      failure: mission.failure || steps.some((step) => step.state === "failed"),
    },
  };
}

export type AgentWidgetRow = {
  slot: number;
  weapon: PersonalAgentView["weapon"];
  name: string;
  status: string;
  mission: string | null;
  missionId: string | null;
  activity: string | null;
};
export function agentWidget(slots: readonly PersonalAgentView[], online: boolean): { state: "offline" | "ready"; rows: AgentWidgetRow[] } {
  const rows = slots.slice(0, 4).map((slot) => ({
    slot: slot.slot,
    weapon: slot.weapon,
    name: slot.displayName,
    status: online ? presentationLabel(slot.presentation.state) : "Offline",
    mission: slot.agent?.missionTitle ?? null,
    missionId: slot.agent?.missionId ?? null,
    activity: slot.progress ? `${slot.progress.verified} verified · ${slot.progress.completed} of ${slot.progress.total} steps` : null,
  }));
  return { state: online ? "ready" : "offline", rows };
}

const known = (value: Known<number> | null | undefined, suffix = ""): string =>
  value === null || value === undefined || value === "UNKNOWN" ? "Unknown" : `${value}${suffix}`;

export type UsageWidgetModel = {
  state: "withheld" | "unavailable" | "ready";
  note: string;
  sessionId: string | null;
  reserved: string;
  cost: string;
  local: string | null;
  limits: string;
  routes: string;
  agents: { slot: number | null; reserved: number; cost: string }[];
};
export function usageWidget(ledger: SessionLedgerView | null, viewer: WidgetViewer): UsageWidgetModel {
  if (viewer === "device") {
    return { state: "withheld", note: "Session usage stays on the workstation. This phone does not receive the ledger, and nothing here is counted as zero.", sessionId: null, reserved: "Unknown", cost: "Unknown", local: null, limits: "Unknown", routes: "Unknown", agents: [] };
  }
  if (!ledger) {
    return { state: "unavailable", note: "The Host has not reported a session ledger.", sessionId: null, reserved: "Unknown", cost: "Unknown", local: null, limits: "Unknown", routes: "Unknown", agents: [] };
  }
  const limits = ledger.accounts.map((account) => {
    if (account.remaining.state === "local") return `${account.harness}: local device`;
    if (account.remaining.state === "reported") {
      const window = account.remaining.windows[0];
      return window ? `${account.harness}: ${window.remainingPercent === null ? "Unknown" : `${window.remainingPercent}% remaining`} (${window.status})` : `${account.harness}: Unknown`;
    }
    return `${account.harness}: ${account.remaining.reason}`;
  });
  const localAccounts = ledger.accounts.filter((account) => account.billing === "local_device").length;
  const cloudAccounts = ledger.accounts.filter((account) => account.billing !== "local_device").length;
  return {
    state: "ready",
    note: "Figures are this Host run's ledger. A provider that did not report a cost or a limit stays Unknown.",
    sessionId: ledger.sessionId,
    reserved: String(ledger.accounts.reduce((sum, account) => sum + account.session.reserved, 0)),
    cost: !ledger.accounts.length || ledger.accounts.some((account) => account.session.observedCostUsd === "UNKNOWN")
      ? "Unknown"
      : known(ledger.accounts.reduce((sum, account) => sum + (typeof account.session.observedCostUsd === "number" ? account.session.observedCostUsd : 0), 0)),
    local: ledger.accounts.length ? `${localAccounts} local · ${cloudAccounts} other` : null,
    limits: limits.length ? limits.join("; ") : "No connected account has reported a limit.",
    routes: ledger.accounts.map((account) => account.harness).join(", ") || "No eligible route in this session.",
    agents: ledger.agents.map((agent) => ({ slot: agent.slot, reserved: agent.session.reserved, cost: known(agent.session.observedCostUsd) })),
  };
}

export type LotusChange = { id: string; scope: string; layer: string; trust: string; updatedAt: number };
export type LotusWidgetModel = {
  state: "withheld" | "unavailable" | "empty" | "ready";
  note: string;
  agent: string | null;
  project: string | null;
  count: number | null;
  recent: LotusChange[];
};
export function lotusWidget(input: {
  viewer: WidgetViewer;
  agentName: string | null;
  projectName: string | null;
  memories: readonly { id: string; scope: string; layer: string; trust: string; updatedAt: number; value?: string }[] | null;
}): LotusWidgetModel {
  if (input.viewer === "device") {
    return { state: "withheld", note: "Agent and Project memory stay on the workstation. This phone is not shown memory text or titles.", agent: null, project: null, count: null, recent: [] };
  }
  if (!input.memories) {
    return { state: "unavailable", note: "Lotus memory has not been reported.", agent: input.agentName, project: input.projectName, count: null, recent: [] };
  }
  const recent = input.memories.slice(0, 5).map(({ id, scope, layer, trust, updatedAt }) => ({ id, scope, layer, trust, updatedAt }));
  return {
    state: recent.length ? "ready" : "empty",
    note: "Titles of recent changes only. Memory text is not shown here.",
    agent: input.agentName,
    project: input.projectName,
    count: input.memories.length,
    recent,
  };
}

export type VoiceWidgetModel = {
  state: "withheld" | "unreported" | "ready";
  note: string;
  speaker: string | null;
  session: string | null;
  microphone: string | null;
  uncertainty: string | null;
};
export function voiceWidget(input: {
  viewer: WidgetViewer;
  speaker: string | null;
  voice: { open?: boolean; state?: string; muted?: boolean; error?: { message: string } | null; capturing?: boolean } | null;
}): VoiceWidgetModel {
  if (input.viewer === "device") {
    return { state: "withheld", note: "Voice and the conversational identity stay on the workstation.", speaker: null, session: null, microphone: null, uncertainty: null };
  }
  if (!input.voice) {
    return { state: "unreported", note: "The Host has not reported voice status. That is not the same as a closed microphone.", speaker: input.speaker, session: null, microphone: null, uncertainty: "Voice status has not arrived." };
  }
  const microphone = input.voice.muted ? "Muted" : input.voice.capturing ? "Capturing" : input.voice.open ? "Session open, not capturing" : "No session";
  return {
    state: "ready",
    note: "Status is the Host's voice snapshot. Choosing who answers does not pause a Mission.",
    speaker: input.speaker,
    session: input.voice.open ? (input.voice.state ?? "open") : "closed",
    microphone,
    uncertainty: input.voice.error?.message ?? null,
  };
}

export function reconciliationWidget(items: readonly ReconcileItem[], viewer: SnapshotViewer | null | undefined) {
  // The registry scopes this widget to the workstation: a paired phone sees that something waits, never which work it is.
  const device = viewer?.kind === "device";
  return {
    headline: items.length ? RECONCILE_HEADLINE : "No uncertain outcome is waiting.",
    canDecide: !device && mayReconcile(viewer),
    rows: (device ? [] : items).map((item) => ({
      key: item.key,
      title: item.title,
      agent: item.owner?.name ?? null,
      mission: item.mission?.title ?? null,
      task: item.task?.title ?? null,
    })),
  };
}

export function notchWidgetLine(reconcileCount: number): { line: string | null; studio: "desktop" } {
  return { line: notchCue(reconcileCount), studio: "desktop" };
}

export const DEVICE_WIDGET_KEY = "bunny-a.widgets.device.v1";

/** A device-local layout. A wrong schema or a damaged file is ignored so the window follows the Host. */
export function readDeviceWidgets(raw: string | null): WidgetPreference | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || parsed.schema !== WIDGET_SCHEMA) return null;
    const { schema: _schema, ...rest } = parsed;
    return validateWidgetPreference(rest);
  } catch {
    return null;
  }
}
export const storedWidgets = (preference: WidgetPreference) => JSON.stringify({ schema: WIDGET_SCHEMA, ...preference });

/** A Host widget view. An unknown schema is ignored. */
export function widgetHostView(value: unknown): WidgetView | null {
  if (!value || typeof value !== "object") return null;
  const view = value as WidgetView;
  if (view.schema !== WIDGET_SCHEMA || typeof view.revision !== "number") return null;
  return { schema: WIDGET_SCHEMA, revision: view.revision, preference: parseWidgetPreference(view.preference) };
}
