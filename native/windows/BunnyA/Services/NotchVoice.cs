using System;
using System.Text.Json;

namespace BunnyA.Services;

/// <summary>
/// MA5-S2 Phase 3: what the notch's voice pill may claim, from the Host <c>voice</c> snapshot only. <c>State</c> is a stable
/// key (UI Automation ItemStatus); <c>Label</c> is what is shown and read; <c>Level</c> is 0..1 from the worker's measured
/// input RMS, present only while the Host confirms capture and the reading is fresh, so nothing is simulated.
/// </summary>
public sealed record VoiceView(string State, string Label, string Glyph, string Avatar, (byte R, byte G, byte B)? Fill, double? Level);

public static class NotchVoice
{
    /// <summary>A level older than this is not shown: the bar stops instead of freezing on a stale value.</summary>
    public const long LevelFreshMs = 1_500;

    public static VoiceView Disconnected { get; } = new("DISCONNECTED", "Voice disconnected", "⚠️", "idle", (70, 34, 40), null);

    public static VoiceView From(JsonElement voice, long nowMs)
    {
        if (voice.ValueKind != JsonValueKind.Object || !voice.JsonBool("open")) return new("OFF", "Voice off", "🎙️", "idle", null, null);
        var state = voice.Json("state") ?? "IDLE";
        var capturing = voice.JsonBool("capturing");
        var playing = voice.JsonBool("playing");
        var duplex = voice.JsonObj("duplex");
        VoiceView view = state switch
        {
            "DEVICE_UNAVAILABLE" => new("DEVICE_UNAVAILABLE", "Microphone unavailable", "⚠️", "idle", (70, 34, 40), null),
            "ERROR" => new("ERROR", "Voice error", "⚠️", "idle", (70, 34, 40), null),
            // A held reply means the controller is deciding whether the user is taking the turn (T12 outputHeld).
            _ when voice.JsonBool("outputHeld") => new("INTERRUPTING", "You're interrupting", "✋", "interrupted", (176, 96, 24), null),
            "SPEAKING" when playing => new("SPEAKING", capturing ? "Speaking · listening" : "Speaking", "🔊", "speaking", (109, 79, 224), null),
            "PROCESSING" or "SPEAKING" => new("THINKING", "Thinking", "💭", "thinking", (53, 80, 214), null),
            "TRANSCRIBING" => new("RECOGNIZING", "Recognizing", "✍️", "thinking", (53, 80, 214), null),
            "LISTENING" when capturing && voice.Json("partial") is { Length: > 0 } => new("RECOGNIZING", "Recognizing", "✍️", "listening", (53, 80, 214), null),
            "LISTENING" when capturing => new("LISTENING", "Listening", "🔴", "listening", (53, 80, 214), null),
            "ARMING" or "LISTENING" => new("ARMING", "Microphone starting", "🎙️", "listening", (40, 60, 150), null),
            "INTERRUPTED" => new("INTERRUPTED", "Stopped · your turn", "⏸", "interrupted", (28, 36, 56), null),
            "MUTED" => new("MUTED", "Muted", "🔇", "sleeping", (32, 38, 54), null),
            _ when voice.JsonBool("muted") => new("MUTED", "Muted", "🔇", "sleeping", (32, 38, 54), null),
            _ when duplex.JsonBool("starting") => new("ARMING", "Microphone starting", "🎙️", "listening", (40, 60, 150), null),
            _ => new("ON", "Voice on", "🎙️", "idle", null, null),
        };
        return capturing && !voice.JsonBool("muted") ? view with { Level = LevelOf(voice.JsonObj("level"), nowMs) } : view;
    }

    /// <summary>Maps measured RMS to 0..1 on a -60..0 dBFS scale; null when absent, stale or not a number.</summary>
    public static double? LevelOf(JsonElement level, long nowMs)
    {
        if (level.ValueKind != JsonValueKind.Object || !level.TryGetProperty("rms", out var r) || r.ValueKind != JsonValueKind.Number) return null;
        var at = level.JsonLong("at");
        if (at <= 0 || nowMs - at > LevelFreshMs || at - nowMs > LevelFreshMs) return null;
        var rms = r.GetDouble();
        if (!double.IsFinite(rms) || rms < 0) return null;
        return rms <= 0 ? 0 : Math.Clamp((20 * Math.Log10(rms) + 60) / 60, 0, 1);
    }

    /// <summary>What Narrator announces on a change of voice state. Level changes are never announced.</summary>
    public static string Announcement(VoiceView view) => $"Voice: {view.Label}";
}
