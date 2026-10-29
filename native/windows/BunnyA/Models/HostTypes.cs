using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Media;

namespace BunnyA.Models;

public sealed record HostCredentials(int Port, string Token);

public sealed record TaskRow(
    string Id,
    string Title,
    string State,
    string? ProjectId = null,
    string? Model = null,
    string? Role = null,
    string? Error = null,
    long CreatedAt = 0,
    long UpdatedAt = 0,
    int CompletedSteps = 0,
    int TotalSteps = 0,
    string? CurrentStep = null,
    string? PendingActionSummary = null,
    string? PendingActionId = null,
    string? PendingActionPayloadSha256 = null,
    bool CanCancel = false,
    bool CanPause = false,
    bool CanResume = false,
    // "orch" (direct task), "mission" or "ptask": the one Host command family that may act on this row.
    string Kind = "orch",
    string? Progress = null,
    // MA5-S2: a team Mission's Coordinator Agent (from the Host's teamView), which owns its start/pause/stop/approval.
    string? CoordinatorId = null,
    bool CanStartTeam = false
)
{
    public override string ToString() =>
        $"{Title} · {State}{(Progress is { Length: > 0 } ? $" · {Progress}" : "")}{(Model is { Length: > 0 } ? $" · {Model}" : "")}{(Error is { Length: > 0 } ? $" · {Error}" : "")}";
}

public sealed record StepRow(
    string Id,
    string Kind,
    string State,
    string? Role,
    string? Model,
    string? Error,
    string? Output,
    string? Receipt
)
{
    public override string ToString() =>
        $"{Kind} · {Role} · {State}{(Model is { Length: > 0 } ? $" · {Model}" : "")}{(Receipt is { Length: > 0 } ? $" · {Receipt}" : "")}" +
        (Output is { Length: > 0 } ? $"\n   {Output}" : "") + (Error is { Length: > 0 } ? $"\n   {Error}" : "");
}

public sealed record PendingApprovalItem(
    string TaskId,
    string TaskTitle,
    string ActionId,
    string OperationKind,
    string Summary,
    string PayloadSha256,
    string Category,
    bool Reversible,
    long ExpiresAt,
    string Scope,
    string ProposedDiff,
    string ExpectedEffects
)
{
    /// <summary>What the user reviewed. A changed digest or a different request is a different approval, never the same one.</summary>
    public string Key => $"{Category}|{TaskId}|{ActionId}|{PayloadSha256}";
    public override string ToString() => $"{OperationKind} · {TaskTitle} · {ActionId}";
}

/// <summary>MA5-S2: an owner-registered folder (`connector.roots.list`). The path is shown on the workstation only.</summary>
public sealed record ConnectedRoot(string Id, string Label, string Path)
{
    public override string ToString() => $"{Label} — {Path}";
}

public sealed record ChatMessage(
    string Id,
    string Sender,
    string Text,
    bool IsUser,
    long Timestamp,
    string? Model = null,
    string? Status = null
)
{
    public HorizontalAlignment Alignment => IsUser ? HorizontalAlignment.Right : HorizontalAlignment.Left;
    public SolidColorBrush BubbleBackground => IsUser 
        ? new SolidColorBrush(Color.FromRgb(34, 46, 74)) 
        : new SolidColorBrush(Color.FromRgb(22, 28, 44));
    public SolidColorBrush BubbleBorder => IsUser 
        ? new SolidColorBrush(Color.FromRgb(58, 76, 120)) 
        : new SolidColorBrush(Color.FromRgb(38, 50, 78));
    public SolidColorBrush SenderColor => IsUser 
        ? new SolidColorBrush(Color.FromRgb(121, 170, 255)) 
        : new SolidColorBrush(Color.FromRgb(134, 232, 171));
}

public sealed record ProjectItem(
    string Id,
    string Name,
    string Path,
    long CreatedAt,
    int ActiveMissions
)
{
    public override string ToString() => $"{Name} · {Path}";
}

public sealed record LotusMemoryRow(
    string Id,
    string Scope,
    string Layer,
    string Key,
    string Value,
    string Trust,
    string Provenance,
    long UpdatedAt
)
{
    public override string ToString() => $"[{Layer}] {Key}: {Value} · {Trust}/{Provenance}";
}

public sealed record ModelItem(
    string Id,
    string Name,
    string Provider,
    bool IsAvailable,
    bool IsDefault,
    string? Details,
    // True only for models the Host lists as running on this computer (never an Ollama cloud tag).
    bool IsLocal = false
)
{
    public override string ToString() => $"{Name} · {Details}";
}

public sealed record DeviceItem(
    string Id,
    string Name,
    long PairedAt,
    bool IsRevoked
)
{
    public override string ToString() =>
        $"{Name} · paired {(PairedAt > 0 ? DateTimeOffset.FromUnixTimeMilliseconds(PairedAt).LocalDateTime.ToString("g") : "unknown")}{(IsRevoked ? " · REVOKED" : " · active")}";
}
