using System;
using System.Collections.Generic;
using System.Text.Json;
using System.Text.Json.Serialization;
using System.Windows;
using System.Windows.Media;

namespace BunnyA.Models;

public sealed record HostCredentials(int Port, string Token);

public sealed record HostIdentity(string HostId, string Epoch);

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
    bool CanResume = false
)
{
    public override string ToString() => $"{Title} · {State}";
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
);

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
);

public sealed record PersonalAgentSlot(
    int Slot,
    string Weapon,
    string Name,
    string State,
    string? ActiveRole,
    string? CurrentTaskTitle,
    int WorkingMissionsCount
);

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
);

public sealed record LotusMemoryRow(
    string Id,
    string Scope,
    string Layer,
    string Key,
    string Value,
    string Trust,
    string Provenance,
    long UpdatedAt
);

public sealed record ModelItem(
    string Id,
    string Name,
    string Provider,
    bool IsAvailable,
    bool IsDefault,
    string? Details
);

public sealed record VoiceState(
    string Mode,
    bool IsListening,
    bool IsSpeaking,
    bool IsMuted,
    string Transcript,
    string LastTurnId,
    List<string> Microphones,
    List<string> Speakers,
    string SelectedMicrophone,
    string SelectedSpeaker
);

public sealed record DeviceItem(
    string Id,
    string Name,
    long PairedAt,
    bool IsRevoked
);
