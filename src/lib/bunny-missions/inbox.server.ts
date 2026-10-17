import type { HostEvent } from "../bunny-host/contracts.ts";
import type { MissionStore } from "./store.server.ts";
import type { InboxEvent, InboxKind, InboxSource } from "./types.ts";

type Rule = { kind: InboxKind; source: InboxSource | ((event: HostEvent) => InboxSource); title: (event: HostEvent) => string };
const sourceOf = (event: HostEvent): InboxSource => {
  const action = event.detail.split(/[\s:]/)[0] ?? "";
  if (action.startsWith("browser.")) return "browser";
  if (action.startsWith("computer.")) return "computer";
  if (/^(github|email|calendar|messaging|sms|whatsapp|phone)\./.test(action)) return "connector";
  return "capability";
};
/** Host event type → inbox classification. Anything not listed (output chunks, routine progress) is not an inbox item. */
const RULES: Record<string, Rule> = {
  "approval.required": { kind: "requires_approval", source: "approval", title: () => "Task waiting for approval" },
  "task.completed": { kind: "completed", source: "task", title: () => "Task completed" },
  "task.failed": { kind: "failure", source: "task", title: () => "Task failed" },
  "agent.waiting_for_input": { kind: "requires_attention", source: "task", title: () => "Agent waiting for input" },
  "agent.waiting_for_approval": { kind: "requires_approval", source: "task", title: () => "Agent waiting for approval" },
  "mission.approval_required": { kind: "requires_approval", source: "mission", title: () => "Mission waiting for approval" },
  "mission.permission_required": { kind: "requires_approval", source: "approval", title: () => "Mission step needs permission" },
  "mission.waiting_for_user": { kind: "requires_attention", source: "mission", title: () => "Mission needs you" },
  "mission.recovered": { kind: "requires_attention", source: "mission", title: () => "Mission interrupted by a Host restart" },
  "mission.completed": { kind: "completed", source: "mission", title: () => "Mission completed" },
  "mission.failed": { kind: "failure", source: "mission", title: () => "Mission failed" },
  "mission.stopped": { kind: "informational", source: "mission", title: () => "Mission stopped" },
  "capability.failed": { kind: "failure", source: sourceOf, title: (event) => `${event.detail.split(" ")[0]} failed` },
  "skill.failed": { kind: "requires_attention", source: "skill", title: () => "Skill failed; repair needed" },
  "skill.promoted": { kind: "informational", source: "skill", title: () => "Skill version promoted" },
  "skill.learned": { kind: "requires_attention", source: "skill", title: () => "Bunny learned a routine; verify it to use it" },
  "thermal.warning": { kind: "requires_attention", source: "system", title: () => "Temperature warning" },
  "provider.status_changed": { kind: "informational", source: "provider", title: () => "Provider status changed" },
  "trigger.fired": { kind: "external_event", source: "trigger", title: () => "Trigger fired" },
  "notification.sent": { kind: "informational", source: "system", title: (event) => event.detail.split("\n")[0].slice(0, 80) },
};
const SUGGESTION: Record<InboxKind, InboxEvent["suggestion"]> = { informational: "ignore", requires_attention: "ask_user", requires_approval: "ask_user", failure: "notify", completed: "notify", external_event: "notify" };

/**
 * The Bunny Inbox: one normalized stream of things that may need the user, fed from the Host event
 * journal. It classifies and suggests; it does not act.
 */
export class Inbox {
  store: MissionStore;
  constructor(store: MissionStore) { this.store = store; }
  classify(event: HostEvent): Omit<InboxEvent, "id" | "acknowledgedAt"> | null {
    const rule = RULES[event.type];
    if (!rule) return null;
    // A mission child's own approval request is answered by the mission's delegated approval, not the user.
    if (event.type === "approval.required" && event.missionId) return null;
    if ((event.type === "task.completed" || event.type === "task.failed") && event.missionId) return null;
    const requestId = /request ([0-9a-f-]{36})/.exec(event.detail)?.[1] ?? null;
    const stepId = /step ([0-9a-f-]{36})/.exec(event.detail)?.[1] ?? null;
    return { at: event.at, source: typeof rule.source === "function" ? rule.source(event) : rule.source, kind: rule.kind, title: rule.title(event), detail: event.detail.slice(0, 1000), missionId: event.missionId ?? null, taskId: event.taskId, stepId, requestId, suggestion: SUGGESTION[rule.kind], hostEventSequence: event.sequence };
  }
  ingest(event: HostEvent): InboxEvent | null {
    const classified = this.classify(event);
    if (!classified) return null;
    const entry: InboxEvent = { ...classified, id: crypto.randomUUID(), acknowledgedAt: null };
    this.store.saveInbox(entry);
    return entry;
  }
  add(input: Omit<InboxEvent, "id" | "at" | "acknowledgedAt" | "hostEventSequence" | "suggestion"> & { suggestion?: InboxEvent["suggestion"] }): InboxEvent {
    const entry: InboxEvent = { suggestion: SUGGESTION[input.kind], ...input, id: crypto.randomUUID(), at: Date.now(), acknowledgedAt: null, hostEventSequence: null };
    this.store.saveInbox(entry);
    return entry;
  }
  acknowledge(id: string): InboxEvent {
    const entry = this.store.inboxEvent(id);
    const next = { ...entry, acknowledgedAt: entry.acknowledgedAt ?? Date.now() };
    this.store.saveInbox(next);
    return next;
  }
  /** Marks attention items as handled once the thing they asked about was answered or ended. */
  resolve(missionId: string, filter: { requestId?: string; kinds?: InboxKind[] } = {}) {
    const kinds = filter.kinds ?? ["requires_approval", "requires_attention"];
    for (const entry of this.store.inbox(200, true)) {
      if (entry.missionId !== missionId || !kinds.includes(entry.kind)) continue;
      if (filter.requestId && entry.requestId && entry.requestId !== filter.requestId) continue;
      if (filter.requestId && !entry.requestId && entry.kind === "requires_approval") continue;
      this.store.saveInbox({ ...entry, acknowledgedAt: Date.now() });
    }
  }
  /** A direct task's approval item is handled once the task was approved or ended. */
  resolveTask(taskId: string) {
    for (const entry of this.store.inbox(200, true)) if (entry.taskId === taskId && entry.kind === "requires_approval") this.store.saveInbox({ ...entry, acknowledgedAt: Date.now() });
  }
  recent(limit = 40) { return this.store.inbox(limit); }
}
