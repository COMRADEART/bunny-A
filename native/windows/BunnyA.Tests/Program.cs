using System.Text.Json;
using BunnyA.Services;

// MA5-S2 Phase 2: deterministic checks of the notch's Host-state mapping. Exit code = number of failures.
var failures = 0;
void Check(string name, bool ok, string detail = "")
{
    Console.WriteLine($"{(ok ? "ok  " : "FAIL")} {name}{(ok || detail.Length == 0 ? "" : $" — {detail}")}");
    if (!ok) failures++;
}
void Eq<T>(string name, T expected, T actual) => Check(name, EqualityComparer<T>.Default.Equals(expected, actual), $"expected {expected}, got {actual}");
JsonElement J(string json) => JsonDocument.Parse(json).RootElement.Clone();
const long Now = 1_800_000_000_000;

// ── Personal slots: the Host presentation state, never a guess ───────────────────────────────────
var presentation = new Dictionary<string, NotchState>
{
    ["UNASSIGNED"] = NotchState.Idle, ["IDLE"] = NotchState.Idle, ["PLANNING"] = NotchState.Planning, ["RESEARCHING"] = NotchState.Executing,
    ["CODING"] = NotchState.Executing, ["TESTING"] = NotchState.Executing, ["FILE_WORK"] = NotchState.Executing, ["ACTIVE"] = NotchState.Executing,
    ["VERIFYING"] = NotchState.Executing, ["WAITING"] = NotchState.Queued, ["WAITING_FOR_USER"] = NotchState.WaitingForUser, ["PAUSED"] = NotchState.Paused,
    ["COMPLETED"] = NotchState.Completed, ["VERIFIED"] = NotchState.Completed, ["FAILED"] = NotchState.Failed, ["STOPPED"] = NotchState.Canceled,
    ["RECOVERING"] = NotchState.Recovering, ["UNKNOWN"] = NotchState.Unknown, ["OFFLINE"] = NotchState.Disconnected, ["SOMETHING_NEW"] = NotchState.Unknown,
};
foreach (var (state, expected) in presentation)
    Eq($"presentation {state}", expected, NotchModel.FromPresentation(J("{\"presentation\":{\"state\":\"" + state + "\",\"basis\":{\"kind\":\"agent-state\"}}}")));
Eq("pending approvals override the presentation state", NotchState.WaitingForApproval,
    NotchModel.FromPresentation(J("""{"presentation":{"state":"ACTIVE"},"attention":{"pendingApprovals":1}}""")));
Eq("a Coordinator on a member's team step is delegating", NotchState.Delegating,
    NotchModel.FromPresentation(J("""{"agent":{"team":true},"presentation":{"state":"ACTIVE","basis":{"kind":"team-step","role":"implementer"}}}""")));
Eq("a single Agent on a team-step basis still executes", NotchState.Executing,
    NotchModel.FromPresentation(J("""{"agent":{"team":false},"presentation":{"state":"ACTIVE","basis":{"kind":"team-step","role":"implementer"}}}""")));

// ── Team members: working only while the Host reports the current step running or verifying ───────
Eq("Planner PLANNING with a pending step is queued, not planning", NotchState.Queued,
    NotchModel.FromTeamAgent(J("""{"state":"PLANNING","current":{"kind":"plan","state":"pending"}}"""), false));
Eq("running plan step", NotchState.Planning, NotchModel.FromTeamAgent(J("""{"state":"PLANNING","current":{"kind":"plan","state":"running"}}"""), false));
Eq("running model step", NotchState.Thinking, NotchModel.FromTeamAgent(J("""{"state":"RUNNING","current":{"kind":"generate_html","state":"running"}}"""), false));
Eq("running Host step", NotchState.Executing, NotchModel.FromTeamAgent(J("""{"state":"RUNNING","current":{"kind":"write_file","state":"running"}}"""), false));
Eq("verifying step", NotchState.Executing, NotchModel.FromTeamAgent(J("""{"state":"VERIFYING","current":{"kind":"verify_output","state":"verifying"}}"""), false));
Eq("waiting for another agent", NotchState.Queued, NotchModel.FromTeamAgent(J("""{"state":"WAITING_FOR_DEPENDENCY","current":{"kind":"review","state":"pending"}}"""), false));
Eq("waiting for the owner's approval", NotchState.WaitingForApproval, NotchModel.FromTeamAgent(J("""{"state":"WAITING_FOR_USER"}"""), true));
Eq("waiting for the owner, no approval pending", NotchState.WaitingForUser, NotchModel.FromTeamAgent(J("""{"state":"WAITING_FOR_USER"}"""), false));
Eq("Coordinator in plan review waits for the owner's approval", NotchState.WaitingForApproval,
    NotchModel.FromTeamAgent(J("""{"state":"VERIFYING","team":{"role":"coordinator"}}"""), true));
Eq("member waiting on others while the plan is reviewed is still queued", NotchState.Queued,
    NotchModel.FromTeamAgent(J("""{"state":"WAITING_FOR_DEPENDENCY","team":{"role":"tester"},"current":{"state":"pending"}}"""), true));
Eq("Coordinator after approval, members running", NotchState.Queued,
    NotchModel.FromTeamAgent(J("""{"state":"RUNNING","team":{"role":"coordinator"}}"""), false));
Eq("Coordinator not started yet waits for the owner to start it", NotchState.WaitingForUser,
    NotchModel.FromTeamAgent(J("""{"state":"CREATED","team":{"role":"coordinator"},"run":null}"""), false));
var unstarted = NotchModel.Agents(J("""
{ "missions": { "missions": [ { "id": "m", "title": "T", "state": "waiting_for_approval", "teamView": { "phase": "planning" }, "requests": [] } ] },
  "agents": { "agents": [ { "id": "c", "missionId": "m", "team": { "role": "coordinator" }, "state": "CREATED" },
                          { "id": "p", "missionId": "m", "team": { "role": "planner" }, "state": "PLANNING", "current": { "kind": "plan", "state": "pending" } } ] } }
"""), Now);
Eq("an unstarted team is not shown as awaiting a plan approval", "WaitingForUser,Queued", string.Join(",", unstarted.Select(c => c.State)));
var review = NotchModel.Agents(J("""
{ "missions": { "missions": [ { "id": "m", "title": "T", "state": "waiting_for_approval", "teamView": { "phase": "review" }, "requests": [] } ] },
  "agents": { "agents": [ { "id": "c", "missionId": "m", "team": { "role": "coordinator" }, "state": "VERIFYING" } ] } }
"""), Now);
Eq("a team in plan review shows its Coordinator awaiting approval", NotchState.WaitingForApproval, review[0].State);
Eq("stopped member", NotchState.Canceled, NotchModel.FromTeamAgent(J("""{"state":"STOPPED"}"""), false));
Eq("completed member", NotchState.Completed, NotchModel.FromTeamAgent(J("""{"state":"COMPLETED","current":{"state":"running"}}"""), false));
Eq("interrupted member", NotchState.Recovering, NotchModel.FromTeamAgent(J("""{"state":"INTERRUPTED"}"""), false));

// ── Persistent tasks ───────────────────────────────────────────────────────────────────────────────
Eq("queued task", NotchState.Queued, NotchModel.FromPtask(J("""{"state":"QUEUED"}""")));
Eq("queued, model unavailable", NotchState.WaitingForTool, NotchModel.FromPtask(J("""{"state":"QUEUED","blocked":{"code":"MODEL_UNAVAILABLE"}}""")));
Eq("queued, paused by owner is not a tool wait", NotchState.Queued, NotchModel.FromPtask(J("""{"state":"QUEUED","blocked":{"code":"OWNER_PAUSED"}}""")));
Eq("running with a pending action", NotchState.WaitingForApproval, NotchModel.FromPtask(J("""{"state":"RUNNING","pendingAction":{"actionId":"a"}}""")));
Eq("awaiting approval", NotchState.WaitingForApproval, NotchModel.FromPtask(J("""{"state":"AWAITING_APPROVAL"}""")));
Eq("running", NotchState.Executing, NotchModel.FromPtask(J("""{"state":"RUNNING","activity":"Reading files"}""")));
Eq("uncertain needs the owner's check", NotchState.NeedsCheck, NotchModel.FromPtask(J("""{"state":"UNCERTAIN"}""")));
Eq("cancelled", NotchState.Canceled, NotchModel.FromPtask(J("""{"state":"CANCELLED"}""")));
Eq("failed", NotchState.Failed, NotchModel.FromPtask(J("""{"state":"FAILED"}""")));

// ── Ordering, recency, filtering ─────────────────────────────────────────────────────────────────
var snapshot = J($$"""
{
  "personalAgents": { "slots": [
    { "slot": 2, "weapon": "spear", "displayName": "Spear", "active": true, "agent": null, "presentation": { "state": "UNASSIGNED" } },
    { "slot": 1, "weapon": "gada", "displayName": "Gada", "active": true, "agent": { "id": "coord", "team": true, "missionId": "m1", "missionTitle": "Build page" },
      "presentation": { "state": "ACTIVE", "basis": { "kind": "team-step", "role": "implementer" } }, "progress": { "completed": 1, "total": 4, "verified": 1 } },
    { "slot": 3, "weapon": "chakra", "displayName": "Vishnu Chakra", "active": false, "agent": null, "presentation": { "state": "IDLE" } }
  ] },
  "missions": { "missions": [
    { "id": "m1", "title": "Build page", "state": "running", "createdAt": 10 },
    { "id": "m0", "title": "Old team", "state": "completed", "createdAt": 1, "finishedAt": {{Now - NotchModel.RecentMs - 1}} }
  ] },
  "agents": { "agents": [
    { "id": "tester", "missionId": "m1", "team": { "role": "tester" }, "state": "WAITING_FOR_DEPENDENCY", "current": { "kind": "verify_output", "state": "pending" }, "createdAt": 5 },
    { "id": "coord", "missionId": "m1", "team": { "role": "coordinator" }, "state": "RUNNING", "createdAt": 1 },
    { "id": "impl", "missionId": "m1", "team": { "role": "implementer" }, "state": "RUNNING", "current": { "kind": "generate_html", "state": "running", "provider": "ollama", "model": "qwen" }, "createdAt": 3 },
    { "id": "oldplanner", "missionId": "m0", "team": { "role": "planner" }, "state": "COMPLETED", "createdAt": 1 }
  ] },
  "persistentTasks": { "tasks": [
    { "id": "p2", "title": "Recent done", "state": "COMPLETED", "createdAt": 20, "updatedAt": {{Now - 1000}} },
    { "id": "p1", "title": "Running", "state": "RUNNING", "createdAt": 15, "progress": { "done": 1, "total": 2 }, "models": ["qwen"] },
    { "id": "p0", "title": "Old done", "state": "COMPLETED", "createdAt": 1, "updatedAt": {{Now - NotchModel.RecentMs - 1}} }
  ] },
  "tasks": [
    { "id": "c1", "title": "Hi", "state": "running", "provider": "ollama", "model": "qwen", "createdAt": 30 },
    { "id": "c0", "title": "Done", "state": "completed", "createdAt": 2 },
    { "id": "s1", "title": "Mission child", "state": "running", "mission": { "id": "m1" }, "createdAt": 31 }
  ]
}
""");
var chips = NotchModel.Agents(snapshot, Now);
Eq("chip order and filtering", "slot:1,slot:2,team:impl,team:tester,ptask:p1,ptask:p2,orch:c1", string.Join(",", chips.Select(c => c.Key)));
Eq("slotted Coordinator is not repeated as a team chip", false, chips.Any(c => c.Key == "team:coord"));
Eq("slot automation id follows its weapon", "AgentGada", chips[0].AutomationId);
Eq("slot 1 delegates", NotchState.Delegating, chips[0].State);
Eq("implementer is thinking", NotchState.Thinking, chips[2].State);
Eq("implementer identity is Gada (execution)", "gada", chips[2].Identity);
Eq("tester identity is Sword (verification)", "sword", chips[3].Identity);
Check("progress is Host step counts, never a percentage", chips[0].Detail == "1 of 4 steps, 1 Host-verified" && !chips.Any(c => (c.Detail ?? "").Contains('%')), chips[0].Detail ?? "");
Check("accessible name carries name, role, state and task",
    chips[2].AccessibleName == "Implementer · Build page team · Thinking (model generating) · generate_html (running) · ollama · qwen", chips[2].AccessibleName);
Check("stable order across repeated snapshots", string.Join(",", NotchModel.Agents(snapshot, Now).Select(c => c.Key)) == string.Join(",", chips.Select(c => c.Key)));
Eq("empty snapshot gives no chips", 0, NotchModel.Agents(J("{}"), Now).Count);

// ── Overflow drops the least important chips first and keeps the shown ones in stable order ─────
NotchAgent Chip(string key, NotchState s, long at) => new(key, key, key, "", "task", s, null, null, null, null, at);
var many = new List<NotchAgent>
{
    Chip("slot1", NotchState.Idle, 0), Chip("slot2", NotchState.Idle, 0), Chip("oldDone", NotchState.Completed, 100), Chip("working", NotchState.Executing, 50),
    Chip("newDone", NotchState.Completed, 900), Chip("approval", NotchState.WaitingForApproval, 10), Chip("queued", NotchState.Queued, 20), Chip("failed", NotchState.Failed, 30),
};
Eq("overflow keeps attention, work, failure, waiting, newest finished; in original order", "working,newDone,approval,queued,failed",
    string.Join(",", NotchModel.Visible(many, 5).Select(c => c.Key)));
Eq("no overflow keeps everything", 8, NotchModel.Visible(many, 8).Count);

// ── Labels and glyphs: every non-idle state is readable without colour or motion ─────────────────
foreach (var s in Enum.GetValues<NotchState>())
{
    Check($"label {s}", NotchModel.Label(s).Length > 0);
    if (s != NotchState.Idle) Check($"glyph {s}", NotchModel.Glyph(s).Length > 0);
}
Check("only work in progress animates", Enum.GetValues<NotchState>().Where(NotchModel.IsActive).SequenceEqual(new[] { NotchState.Thinking, NotchState.Planning, NotchState.Executing, NotchState.Delegating }));

Console.WriteLine(failures == 0 ? "ALL PASSED" : $"{failures} FAILED");
return failures;
