/**
 * MA3 T13 everyday journey. Island status is derived from Host facts the caller already has.
 * Missing facts stay unnamed. Nothing here invents a percentage, an ETA, or a local-only claim.
 */

export const ISLAND_STATES = [
  "idle",
  "listening",
  "thinking",
  "planning",
  "working",
  "multi",
  "handoff",
  "approval",
  "streaming",
  "completed",
  "failed",
  "offline",
] as const;

export type IslandState = (typeof ISLAND_STATES)[number];

export type IslandEvent = {
  type: string;
  at: number;
  sequence: number | null;
  detail: string;
};

export type IslandFacts = {
  /** The Host view is fresh enough to describe current work. */
  live: boolean;
  /** Shown when the view is not live. The caller names the real connection, never a guessed cause. */
  disconnectTitle: string;
  voiceListening: boolean;
  pendingApprovals: number;
  /** Personal Agents the Host currently reports as doing work, excluding planning. */
  workingAgents: number;
  planningAgents: number;
  events: readonly IslandEvent[];
  agentName: string | null;
  taskName: string | null;
  taskState: "running" | "routing" | "completed" | "failed" | "approval" | "paused" | "idle";
  /** Clock time already computed from a recorded start, or null when the Host has no start time. */
  elapsed: string | null;
};

export type IslandPresence = {
  state: IslandState;
  /** Visible status word. Color and motion are never the only signal. */
  title: string;
  detail: string;
};

const HANDOFF = new Set(["mission.team.handoff", "mission.team.handoff_refused"]);
const THINKING = new Set(["agent.thinking", "agent.reasoning", "routing.started"]);

/** The newest Host event by sequence, then by time. An empty list has no newest event. */
export function newestIslandEvent(events: readonly IslandEvent[]): IslandEvent | null {
  let best: IslandEvent | null = null;
  for (const event of events) {
    if (!best) {
      best = event;
      continue;
    }
    const seq = event.sequence ?? -1;
    const bestSeq = best.sequence ?? -1;
    if (seq !== bestSeq) {
      if (seq > bestSeq) best = event;
      continue;
    }
    if (event.at >= best.at) best = event;
  }
  return best;
}

const ELAPSED_STATES = new Set<IslandState>(["thinking", "planning", "working", "multi", "handoff", "streaming"]);

/**
 * One Island status. Offline wins, then an approval the person must answer, then live voice,
 * then the newest Host event when it names a handoff, stream, or thinking turn, then agent counts,
 * then the focused task's terminal state. Idle is the absence of those facts.
 */
export function islandPresence(facts: IslandFacts): IslandPresence {
  const agent = facts.agentName?.trim() || null;
  const task = facts.taskName?.trim() || null;
  const newest = newestIslandEvent(facts.events);
  const running = facts.taskState === "running" || facts.workingAgents > 0;

  let state: IslandState = "idle";
  if (!facts.live) state = "offline";
  else if (facts.pendingApprovals > 0 || facts.taskState === "approval") state = "approval";
  else if (facts.voiceListening) state = "listening";
  else if (newest && HANDOFF.has(newest.type)) state = "handoff";
  else if (newest?.type === "agent.output" && running) state = "streaming";
  else if (facts.workingAgents > 1) state = "multi";
  else if (facts.planningAgents > 0 || newest?.type === "agent.planning") state = "planning";
  else if ((newest && THINKING.has(newest.type)) || facts.taskState === "routing") state = "thinking";
  else if (facts.workingAgents > 0 || facts.taskState === "running") state = "working";
  else if (facts.taskState === "failed") state = "failed";
  else if (facts.taskState === "completed") state = "completed";

  const title = state === "offline" ? facts.disconnectTitle || "Offline" : ISLAND_TITLE[state];
  const parts: string[] = [`Status: ${title}`];
  if (agent) parts.push(agent);
  if (task) parts.push(task);
  if (facts.elapsed && ELAPSED_STATES.has(state)) parts.push(facts.elapsed);
  if (state === "approval" && facts.pendingApprovals > 0) {
    parts.push(facts.pendingApprovals === 1 ? "1 approval waiting" : `${facts.pendingApprovals} approvals waiting`);
  }
  if (state === "handoff" && newest?.detail) parts.push(newest.detail);
  if (state === "multi") parts.push(`${facts.workingAgents} agents working`);
  return { state, title, detail: parts.join(" · ") };
}

const ISLAND_TITLE: Record<Exclude<IslandState, "offline">, string> = {
  idle: "Idle",
  listening: "Listening",
  thinking: "Thinking",
  planning: "Planning",
  working: "Agent working",
  multi: "Multiple agents working",
  handoff: "Agent handoff",
  approval: "Approval requested",
  streaming: "Streaming results",
  completed: "Completed",
  failed: "Failed",
};

export const ONBOARDING_IDS = ["welcome", "providers", "execution", "permissions", "island", "first-task", "phone"] as const;
export type OnboardingId = (typeof ONBOARDING_IDS)[number];

export type OnboardingStep = { id: OnboardingId; title: string; body: string };

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  {
    id: "welcome",
    title: "Welcome to Bunny-A",
    body: "Bunny-A is your personal companion. You ask, Bunny recommends, and work starts only when you allow it.",
  },
  {
    id: "providers",
    title: "Providers on this computer",
    body: "Bunny can use the providers this Host has actually discovered. Unavailable providers stay unavailable.",
  },
  {
    id: "execution",
    title: "Local and remote",
    body: "Tasks run on your Windows Host. A paired phone can watch and answer what the Host allows. It is not a second workstation.",
  },
  {
    id: "permissions",
    title: "You stay in control",
    body: "Ordinary requests that policy already allows can run with one confirmation. Consequential actions wait for an explicit approval. Nothing here grants access by itself.",
  },
  {
    id: "island",
    title: "The Island",
    body: "The Island is the compact status surface. It shows the real state — listening, working, an approval, or offline — with the agent and task when the Host has them.",
  },
  {
    id: "first-task",
    title: "A first task",
    body: "When you are ready, describe one task on Home. Bunny will show the recommendation before anything runs.",
  },
  {
    id: "phone",
    title: "Phone pairing",
    body: "Pairing is optional. It uses a one-time code from this PC. The phone still has to submit that code, and the Host checks it.",
  },
];

export type OnboardingRecord = { status: "active" | "skipped" | "done"; step: number };

export function onboardingRecord(raw: unknown): OnboardingRecord {
  if (!raw || typeof raw !== "object") return { status: "active", step: 0 };
  const record = raw as { status?: unknown; step?: unknown };
  const status = record.status === "skipped" || record.status === "done" || record.status === "active" ? record.status : "active";
  const step = typeof record.step === "number" && Number.isInteger(record.step) ? Math.min(ONBOARDING_STEPS.length - 1, Math.max(0, record.step)) : 0;
  return { status, step };
}

/** Names and availability the Host reported. An empty list is "none discovered", not a fabricated provider. */
export function providerSetupLine(providers: readonly { name: string; availability: string }[]): string {
  if (!providers.length) return "No providers discovered yet. You can continue and connect one later in Models.";
  return providers.map((provider) => `${provider.name}: ${provider.availability}`).join(" · ");
}

/** A one-time pairing code from the Host. Anything else is ignored so a link cannot smuggle a different credential. */
export function pairingCodeFromLocation(search: string, hash: string): string | null {
  const fromHash = new URLSearchParams(hash.replace(/^#/, "")).get("pair");
  const fromQuery = new URLSearchParams(search).get("pair");
  const code = fromHash || fromQuery || "";
  return /^[A-Za-z0-9_-]{8,64}$/.test(code) ? code : null;
}
