using System;
using System.Collections.Generic;
using System.Linq;
using System.Text.Json;

namespace BunnyA.Services;

/// <summary>
/// MA5-S2 Phase 2: what one notch chip may claim. Every value is derived from Host state; a state the Host does not
/// report is never shown (there is no "thinking" without a running model step, no progress without Host step counts).
/// </summary>
public enum NotchState
{
    Idle, Thinking, Planning, Executing, Delegating, WaitingForTool, WaitingForApproval, WaitingForUser,
    Queued, Paused, Recovering, NeedsCheck, Completed, Failed, Canceled, Unknown, Disconnected,
}

/// <summary>One chip. Identity is a weapon (gada, spear, chakra, sword) or "task"; Kind/ItemId open the item it represents.</summary>
public sealed record NotchAgent(
    string Key, string AutomationId, string Name, string Role, string Identity, NotchState State,
    string? Task, string? Detail, string? Kind, string? ItemId, long At = 0)
{
    /// <summary>What Narrator reads: name, role, state and task, so nothing depends on colour or motion.</summary>
    public string AccessibleName => string.Join(" · ", new[] { Name, Role, NotchModel.Label(State), Task, Detail }.Where(s => !string.IsNullOrEmpty(s)));
}

public static class NotchModel
{
    /// <summary>Finished team members and tasks stay visible this long after the Host recorded their end.</summary>
    public const long RecentMs = 10 * 60_000;

    public static readonly string[] Weapons = ["gada", "spear", "chakra", "sword"];
    private static readonly Dictionary<string, string> WeaponName = new() { ["gada"] = "Gada", ["spear"] = "Spear", ["chakra"] = "Vishnu Chakra", ["sword"] = "Sword" };
    private static readonly string[] RoleOrder = ["coordinator", "planner", "researcher", "implementer", "documenter", "reviewer", "tester"];
    private static readonly HashSet<string> ModelKinds = ["plan", "generate_json", "generate_markdown", "generate_html", "review"];

    /// <summary>A team role's identity follows the weapon meanings: orchestration, precision, execution, verification.</summary>
    public static string RoleIdentity(string role) => role switch
    {
        "coordinator" or "planner" => "chakra",
        "researcher" => "spear",
        "implementer" or "documenter" => "gada",
        "reviewer" or "tester" => "sword",
        _ => "task",
    };

    public static string Label(NotchState s) => s switch
    {
        NotchState.Idle => "Idle",
        NotchState.Thinking => "Thinking (model generating)",
        NotchState.Planning => "Planning",
        NotchState.Executing => "Executing",
        NotchState.Delegating => "Delegating",
        NotchState.WaitingForTool => "Waiting for a tool",
        NotchState.WaitingForApproval => "Approval needed",
        NotchState.WaitingForUser => "Waiting for you",
        NotchState.Queued => "Queued",
        NotchState.Paused => "Paused",
        NotchState.Recovering => "Recovering",
        NotchState.NeedsCheck => "Outcome uncertain: needs your check",
        NotchState.Completed => "Completed",
        NotchState.Failed => "Failed",
        NotchState.Canceled => "Canceled",
        NotchState.Disconnected => "Disconnected",
        _ => "State unknown",
    };

    /// <summary>A text symbol for the state, so the chip never relies on colour alone.</summary>
    public static string Glyph(NotchState s) => s switch
    {
        NotchState.Thinking or NotchState.Planning or NotchState.Executing or NotchState.Delegating => "▶",
        NotchState.WaitingForApproval or NotchState.WaitingForUser or NotchState.NeedsCheck => "!",
        NotchState.WaitingForTool or NotchState.Queued or NotchState.Recovering => "…",
        NotchState.Paused => "‖",
        NotchState.Completed => "✓",
        NotchState.Failed => "✕",
        NotchState.Canceled => "■",
        NotchState.Disconnected => "⌁",
        NotchState.Unknown => "?",
        _ => "",
    };

    /// <summary>Only work in progress moves; idle, waiting and finished chips are still.</summary>
    public static bool IsActive(NotchState s) => s is NotchState.Thinking or NotchState.Planning or NotchState.Executing or NotchState.Delegating;
    public static bool NeedsAttention(NotchState s) => s is NotchState.WaitingForApproval or NotchState.WaitingForUser or NotchState.NeedsCheck;

    /// <summary>A personal slot, from the Host's own presentation projection (state, basis and pending approvals).</summary>
    public static NotchState FromPresentation(JsonElement slot)
    {
        var p = slot.JsonObj("presentation");
        var basis = p.JsonObj("basis");
        if (slot.JsonObj("attention").JsonLong("pendingApprovals") > 0) return NotchState.WaitingForApproval;
        return p.Json("state") switch
        {
            "UNASSIGNED" or "IDLE" => NotchState.Idle,
            "PLANNING" => NotchState.Planning,
            // A Coordinator whose current fact is a member's team step is delegating, not doing the work itself.
            "RESEARCHING" or "CODING" or "TESTING" or "FILE_WORK" or "ACTIVE" or "VERIFYING" when basis.Json("kind") == "team-step" && basis.Json("role") is { } r && r != "coordinator" && slot.JsonObj("agent").JsonBool("team") => NotchState.Delegating,
            "RESEARCHING" or "CODING" or "TESTING" or "FILE_WORK" or "ACTIVE" or "VERIFYING" => NotchState.Executing,
            "WAITING" => NotchState.Queued,
            "WAITING_FOR_USER" => NotchState.WaitingForUser,
            "PAUSED" => NotchState.Paused,
            "RECOVERING" => NotchState.Recovering,
            "COMPLETED" or "VERIFIED" => NotchState.Completed,
            "FAILED" => NotchState.Failed,
            "STOPPED" => NotchState.Canceled,
            "OFFLINE" => NotchState.Disconnected,
            _ => NotchState.Unknown,
        };
    }

    /// <summary>A team member, from its Agent row and current step. Working only while that step runs or verifies.</summary>
    public static NotchState FromTeamAgent(JsonElement agent, bool missionAwaitsOwner)
    {
        var current = agent.JsonObj("current");
        var step = current.Json("state");
        return agent.Json("state") switch
        {
            "COMPLETED" => NotchState.Completed,
            "FAILED" => NotchState.Failed,
            "STOPPED" => NotchState.Canceled,
            "PAUSED" => NotchState.Paused,
            "INTERRUPTED" => NotchState.Recovering,
            "WAITING_FOR_USER" => missionAwaitsOwner ? NotchState.WaitingForApproval : NotchState.WaitingForUser,
            // The Coordinator answers for the whole team: while the Mission waits on the owner, so does it; before the
            // owner starts it, it waits to be started (there is no plan to approve yet).
            _ when missionAwaitsOwner && agent.JsonObj("team").Json("role") == "coordinator" && step is not ("running" or "verifying") => NotchState.WaitingForApproval,
            "CREATED" when agent.JsonObj("team").Json("role") == "coordinator" => NotchState.WaitingForUser,
            _ when step is "running" => current.Json("kind") == "plan" ? NotchState.Planning
                : ModelKinds.Contains(current.Json("kind") ?? "") ? NotchState.Thinking : NotchState.Executing,
            _ when step is "verifying" => NotchState.Executing,
            _ when step is "waiting_for_approval" => NotchState.WaitingForApproval,
            "WAITING_FOR_DEPENDENCY" or "PLANNING" or "CREATED" or "RUNNING" or "VERIFYING" => NotchState.Queued,
            _ => NotchState.Unknown,
        };
    }

    /// <summary>A persistent task, from its Host view (state, block reason, pending action, activity).</summary>
    public static NotchState FromPtask(JsonElement task) => task.Json("state") switch
    {
        "QUEUED" or "VALIDATED" or "CREATED" => task.JsonObj("blocked").Json("code") is "MODEL_UNAVAILABLE" or "RESOURCES_UNAVAILABLE" ? NotchState.WaitingForTool : NotchState.Queued,
        "AWAITING_APPROVAL" => NotchState.WaitingForApproval,
        "RUNNING" or "RESUMING" => task.JsonObj("pendingAction").ValueKind == JsonValueKind.Object || task.Json("activity") == "Waiting for permission"
            ? NotchState.WaitingForApproval : NotchState.Executing,
        "PAUSED" => NotchState.Paused,
        "UNCERTAIN" => NotchState.NeedsCheck,
        "COMPLETED" => NotchState.Completed,
        "FAILED" => NotchState.Failed,
        "CANCELLED" => NotchState.Canceled,
        _ => NotchState.Unknown,
    };

    /// <summary>A direct (chat) task from the Host's task list.</summary>
    public static NotchState FromDirectTask(JsonElement task) => task.Json("state") switch
    {
        "queued" or "routing" => NotchState.Queued,
        "waiting_for_approval" => NotchState.WaitingForApproval,
        "running" => NotchState.Thinking,
        "completed" => NotchState.Completed,
        "failed" => NotchState.Failed,
        "stopped" => NotchState.Canceled,
        _ => NotchState.Unknown,
    };

    private static bool Recent(long at, long now) => at > 0 && now - at <= RecentMs;

    /// <summary>
    /// At most <paramref name="max"/> chips: when there are more, the least important go first (idle, then finished,
    /// oldest first, then waiting), so work, failures and anything needing the owner are never pushed out. The chips
    /// kept stay in their stable order.
    /// </summary>
    public static List<NotchAgent> Visible(IReadOnlyList<NotchAgent> chips, int max)
    {
        if (chips.Count <= max) return chips.ToList();
        static int Rank(NotchState s) => s switch
        {
            _ when IsActive(s) || NeedsAttention(s) || s == NotchState.Failed => 0,
            NotchState.Completed or NotchState.Canceled => 2,
            NotchState.Idle or NotchState.Disconnected => 3,
            _ => 1,
        };
        var keep = chips.Select((c, i) => (c, i)).OrderBy(x => Rank(x.c.State)).ThenByDescending(x => x.c.At).Take(max).Select(x => x.i).ToHashSet();
        return chips.Where((_, i) => keep.Contains(i)).ToList();
    }

    /// <summary>
    /// The chips, in a stable order: personal slots (by slot), team members (by Mission, then role), persistent tasks,
    /// then direct tasks (each by creation). Finished items stay for <see cref="RecentMs"/> after the Host's end time.
    /// </summary>
    public static List<NotchAgent> Agents(JsonElement root, long now)
    {
        var chips = new List<NotchAgent>();
        var slotted = new HashSet<string>();
        foreach (var s in root.JsonObj("personalAgents").JsonArr("slots").OrderBy(s => s.JsonLong("slot")))
        {
            if (s.TryGetProperty("active", out var active) && active.ValueKind == JsonValueKind.False) continue;
            var weapon = s.Json("weapon") is { } w && Weapons.Contains(w) ? w : Weapons[Math.Clamp((int)s.JsonLong("slot") - 1, 0, 3)];
            var agent = s.JsonObj("agent");
            if (agent.Json("id") is { } boundId) slotted.Add(boundId);
            var progress = s.JsonObj("progress");
            var technical = s.JsonObj("technical");
            chips.Add(new NotchAgent($"slot:{s.JsonLong("slot")}", $"Agent{char.ToUpperInvariant(weapon[0])}{weapon[1..]}",
                s.Json("displayName") ?? WeaponName[weapon], agent.ValueKind == JsonValueKind.Object ? (agent.JsonBool("team") ? "Team Coordinator" : "Agent") : "Unassigned",
                weapon, FromPresentation(s), agent.Json("missionTitle"),
                string.Join(" · ", new[]
                {
                    progress.ValueKind == JsonValueKind.Object ? $"{progress.JsonLong("completed")} of {progress.JsonLong("total")} steps, {progress.JsonLong("verified")} Host-verified" : null,
                    technical.Json("model") is { } model ? $"{technical.Json("provider")} · {model}" : null,
                }.Where(x => x != null)),
                agent.Json("missionId") != null ? "mission" : null, agent.Json("missionId")));
        }

        var missions = root.JsonObj("missions").JsonArr("missions").ToDictionary(m => m.Json("id") ?? "", m => m);
        var members = root.JsonObj("agents").JsonArr("agents")
            .Where(a => a.JsonObj("team").ValueKind == JsonValueKind.Object && a.Json("id") is { } id && !slotted.Contains(id) && a.Json("missionId") is { } mid && missions.ContainsKey(mid))
            .Select(a => (agent: a, mission: missions[a.Json("missionId")!]))
            .Where(x => x.mission.Json("state") is not ("completed" or "failed" or "stopped") || Recent(x.mission.JsonLong("finishedAt"), now))
            .OrderBy(x => x.mission.JsonLong("createdAt"))
            .ThenBy(x => Array.IndexOf(RoleOrder, x.agent.JsonObj("team").Json("role") ?? ""))
            .ThenBy(x => x.agent.JsonLong("createdAt"));
        foreach (var (a, m) in members)
        {
            var role = a.JsonObj("team").Json("role") ?? "member";
            var current = a.JsonObj("current");
            var owned = a.JsonObj("owned");
            // A team Mission reports waiting_for_approval before it is even started; only plan review is an approval.
            var awaits = (m.Json("state") == "waiting_for_approval" && m.JsonObj("teamView").Json("phase") == "review")
                || m.JsonArr("requests").Any(r => r.JsonLong("resolvedAt") == 0);
            chips.Add(new NotchAgent($"team:{a.Json("id")}", $"AgentTeam-{a.Json("id")}", char.ToUpperInvariant(role[0]) + role[1..], $"{m.Json("title")} team",
                RoleIdentity(role), FromTeamAgent(a, awaits), current.Json("kind") is { } kind ? $"{kind} ({current.Json("state")})" : null,
                string.Join(" · ", new[]
                {
                    owned.ValueKind == JsonValueKind.Object ? $"{owned.JsonLong("verified")} of {owned.JsonLong("total")} Host-verified" : null,
                    current.Json("model") is { } model ? $"{current.Json("provider")} · {model}" : null,
                    a.JsonObj("failure").Json("code"),
                }.Where(x => x != null)),
                "mission", m.Json("id"), Math.Max(a.JsonLong("updatedAt"), m.JsonLong("finishedAt"))));
        }

        foreach (var t in root.JsonObj("persistentTasks").JsonArr("tasks").Where(t => !t.JsonBool("corrupt")).OrderBy(t => t.JsonLong("createdAt")))
        {
            var state = FromPtask(t);
            if (state is NotchState.Completed or NotchState.Failed or NotchState.Canceled && !Recent(t.JsonLong("updatedAt"), now)) continue;
            var progress = t.JsonObj("progress");
            chips.Add(new NotchAgent($"ptask:{t.Json("id")}", $"AgentTask-{t.Json("id")}", "Task", "Persistent task", "task", state, t.Json("title"),
                string.Join(" · ", new[]
                {
                    progress.ValueKind == JsonValueKind.Object ? $"{progress.JsonLong("done")} of {progress.JsonLong("total")} steps" : null,
                    string.Join(", ", t.JsonArr("models").Select(m => m.GetString())) is { Length: > 0 } models ? models : null,
                    t.JsonObj("failure").Json("detail") ?? t.JsonObj("blocked").Json("detail"),
                }.Where(x => x != null)),
                "ptask", t.Json("id"), t.JsonLong("updatedAt")));
        }

        foreach (var t in root.JsonArr("tasks").Where(t => t.JsonObj("mission").ValueKind != JsonValueKind.Object).OrderBy(t => t.JsonLong("createdAt")))
        {
            var state = FromDirectTask(t);
            if (state is NotchState.Completed or NotchState.Failed or NotchState.Canceled or NotchState.Unknown) continue;
            chips.Add(new NotchAgent($"orch:{t.Json("id")}", $"AgentChat-{t.Json("id")}", "Chat", "Direct task", "task", state, t.Json("title"),
                t.Json("model") is { } model ? $"{t.Json("provider")} · {model}" : null, "orch", t.Json("id"), t.JsonLong("createdAt")));
        }
        return chips;
    }
}
