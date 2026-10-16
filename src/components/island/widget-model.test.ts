import test from "node:test";
import assert from "node:assert/strict";
import type { PersonalAgentView } from "../../lib/bunny-host/personal-agents.ts";
import type { SessionLedgerView } from "../../lib/bunny-host/session-ledger.ts";
import { DEFAULT_WIDGET_PREFERENCE } from "../../lib/bunny-host/widgets.ts";
import {
  agentWidget, lotusWidget, mergeMissions, missionWidget, notchWidgetLine, reconciliationWidget, usageWidget, voiceWidget,
  type MissionFact,
} from "./widget-model.ts";
import { reconcileItems } from "./reconciliation-model.ts";
import type { OrchTask } from "../../lib/orch/types.ts";

const mission = (patch: Partial<MissionFact> = {}): MissionFact => ({
  id: "m1", title: "Ship the notes", projectId: "p1", state: "RUNNING", updatedAt: 10, failure: false,
  steps: [
    { id: "s1", role: "Read", state: "completed", dependsOn: [], verified: true, reconcile: false },
    { id: "s2", role: "Write", state: "running", dependsOn: ["s1"], verified: null, reconcile: false },
    { id: "s3", role: "Check", state: "pending", dependsOn: ["s2"], verified: null, reconcile: false },
  ],
  ...patch,
});

test("mission control uses step counts and never a made-up percentage", () => {
  const offline = missionWidget({ online: false, missions: [mission()], slots: [], focus: DEFAULT_WIDGET_PREFERENCE.focus });
  assert.equal(offline.state, "offline");
  assert.equal(offline.mission, null);
  const view = missionWidget({
    online: true,
    missions: [mission()],
    slots: [{ slot: 1, name: "Gada", missionId: "m1" }],
    focus: DEFAULT_WIDGET_PREFERENCE.focus,
  });
  assert.equal(view.mission?.owner, "Gada");
  assert.equal(view.mission?.active, "Write");
  assert.equal(view.mission?.verified, 1);
  assert.equal(view.mission?.pending, 1);
  assert.equal(view.mission?.dependencies, 2);
  assert.match(view.note, /did not provide a progress percentage/);
  assert.equal(JSON.stringify(view).includes("%"), false);
});

test("a stale mission event cannot replace a newer Host row", () => {
  const newer = mission({ updatedAt: 20, title: "Newer" });
  const older = mission({ updatedAt: 5, title: "Stale" });
  assert.equal(mergeMissions([newer], [older])[0].title, "Newer");
  assert.equal(mergeMissions([older], [newer])[0].title, "Newer");
});

test("personal agents are the four slots, and offline does not invent a status", () => {
  const slots = [1, 2, 3, 4].map((slot) => ({
    slot, weapon: (["gada", "spear", "chakra", "sword"] as const)[slot - 1], displayName: ["Gada", "Spear", "Vishnu Chakra", "Sword"][slot - 1],
    presentation: { state: "IDLE", label: "Ready to start", basis: { kind: "unassigned" } },
    agent: slot === 1 ? { missionId: "m1", missionTitle: "Ship the notes" } : null,
    progress: slot === 1 ? { completed: 1, total: 3, verified: 1 } : null,
    technical: { provider: "secret-provider", model: "secret-model", taskId: "t" },
  })) as unknown as PersonalAgentView[];
  const view = agentWidget(slots, true);
  assert.deepEqual(view.rows.map((row) => row.name), ["Gada", "Spear", "Vishnu Chakra", "Sword"]);
  assert.equal(view.rows[0].activity, "1 verified · 1 of 3 steps");
  assert.equal(JSON.stringify(view).includes("secret-provider"), false);
  assert.equal(agentWidget(slots, false).rows[0].status, "Offline");
});

test("unknown usage is not zero, and a phone does not receive the ledger", () => {
  const ledger = {
    sessionId: "sess",
    accounts: [{ harness: "Claude", billing: "plan_included", session: { reserved: 1, observedCostUsd: "UNKNOWN" }, remaining: { state: "UNKNOWN", reason: "The provider has not reported its limits in this session." } }],
    agents: [{ slot: 1, session: { reserved: 1, observedCostUsd: "UNKNOWN" } }],
  } as unknown as SessionLedgerView;
  const view = usageWidget(ledger, "workstation");
  assert.equal(view.cost, "Unknown");
  assert.equal(view.reserved, "1");
  assert.match(view.limits, /not reported/);
  assert.equal(JSON.stringify(view).includes(":0"), false);
  const phone = usageWidget(ledger, "device");
  assert.equal(phone.state, "withheld");
  assert.equal(phone.cost, "Unknown");
  assert.equal(phone.sessionId, null);
});

test("lotus hides memory text, and a phone receives none of it", () => {
  const memories = [{ id: "a", scope: "agent:1", layer: "central", trust: "user", updatedAt: 3, value: "private-memory-token" }];
  const view = lotusWidget({ viewer: "workstation", agentName: "Gada", projectName: "Notes", memories });
  assert.equal(view.count, 1);
  assert.equal(JSON.stringify(view).includes("private-memory-token"), false);
  assert.equal("value" in view.recent[0], false);
  const phone = lotusWidget({ viewer: "device", agentName: "Gada", projectName: "Notes", memories });
  assert.equal(phone.state, "withheld");
  assert.equal(phone.recent.length, 0);
  assert.equal(phone.agent, null);
  assert.equal(JSON.stringify(phone).includes("private-memory-token"), false);
});

test("voice uncertainty stays uncertainty, and reconciliation does not decide on a phone", () => {
  const missing = voiceWidget({ viewer: "workstation", speaker: "Bunny", voice: null });
  assert.equal(missing.state, "unreported");
  assert.match(missing.uncertainty ?? "", /not arrived/);
  const phone = voiceWidget({ viewer: "device", speaker: "Bunny", voice: { open: true, muted: false } });
  assert.equal(phone.state, "withheld");
  assert.equal(phone.speaker, null);
  const task = { id: "t1", title: "Update README", prompt: "x", projectId: "p1", mode: "balanced", state: "failed", provider: "claude", model: "m", startedAt: 1, logs: [], reconciliation: { required: true, reason: "Outcome uncertain — reconciliation required.", at: 5 }, dispatch: "may_have_started" } as unknown as OrchTask;
  const items = reconcileItems({ tasks: [task], missions: [], personalAgents: null, projects: [{ id: "p1", name: "Website" }] });
  const owner = reconciliationWidget(items, { kind: "workstation" });
  assert.equal(owner.canDecide, true);
  assert.match(owner.headline, /reconciliation required/);
  assert.equal(owner.rows[0].task, "Update README");
  const device = reconciliationWidget(items, { kind: "device", deviceId: "d", name: "Phone", role: "paired-device", pairedAt: 1, expiresAt: 2, lastSeenAt: null, rights: [] });
  assert.equal(device.canDecide, false);
  assert.deepEqual(device.rows, [], "a paired phone is told something waits, not which work it is");
  assert.match(device.headline, /reconciliation required/);
  assert.equal(notchWidgetLine(items.length).line, "Reconcile 1");
  assert.equal(notchWidgetLine(0).studio, "desktop");
});
