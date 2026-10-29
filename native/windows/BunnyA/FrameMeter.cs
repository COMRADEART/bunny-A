using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Windows;
using System.Windows.Media;

namespace BunnyA;

/// <summary>
/// MA5-S2 opt-in frame-pacing log (BUNNY_NOTCH_FRAME_LOG=&lt;file&gt;): while any notch animation runs, counts rendered
/// frames and the gaps between them, one JSON line per 5 s window. Unhooked whenever nothing animates, and inert
/// without the variable, so it never keeps WPF rendering on its own.
/// </summary>
internal static class FrameMeter
{
    private static readonly string? LogPath = Environment.GetEnvironmentVariable("BUNNY_NOTCH_FRAME_LOG");
    private static readonly List<WeakReference<FrameworkElement>> Animated = new();
    private static readonly Stopwatch Clock = Stopwatch.StartNew();
    private static readonly List<double> Gaps = new();
    private static bool hooked;
    private static double windowStart, last;

    public static void Track(FrameworkElement element)
    {
        if (LogPath == null) return;
        Animated.Add(new WeakReference<FrameworkElement>(element));
        if (hooked) return;
        hooked = true;
        windowStart = Clock.Elapsed.TotalMilliseconds;
        last = 0;
        CompositionTarget.Rendering += OnFrame;
    }

    private static void OnFrame(object? sender, EventArgs e)
    {
        Animated.RemoveAll(w => !w.TryGetTarget(out var t) || !t.IsLoaded);
        var now = Clock.Elapsed.TotalMilliseconds;
        if (Animated.Count == 0)
        {
            Flush(now);
            CompositionTarget.Rendering -= OnFrame;
            hooked = false;
            return;
        }
        if (last > 0) Gaps.Add(now - last);
        last = now;
        if (now - windowStart >= 5_000) Flush(now);
    }

    private static void Flush(double now)
    {
        if (Gaps.Count > 0 && LogPath != null)
        {
            var sorted = Gaps.OrderBy(g => g).ToArray();
            double Pct(double p) => sorted[Math.Min(sorted.Length - 1, (int)Math.Ceiling(p * sorted.Length) - 1)];
            var line = JsonSerializer.Serialize(new
            {
                at = DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), windowMs = Math.Round(now - windowStart), frames = sorted.Length + 1,
                fps = Math.Round(sorted.Length / ((now - windowStart) / 1000), 1), p50Ms = Math.Round(Pct(0.5), 2), p95Ms = Math.Round(Pct(0.95), 2),
                maxMs = Math.Round(sorted[^1], 2), over33Ms = sorted.Count(g => g > 33.4), animatedElements = Animated.Count,
            });
            try { File.AppendAllText(LogPath, line + Environment.NewLine); } catch { /* diagnostics never break the notch */ }
        }
        Gaps.Clear();
        windowStart = now;
    }
}
