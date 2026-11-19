using System;

namespace BunnyA.Services;

public readonly record struct NotchWorkArea(int Left, int Top, int Right, int Bottom)
{
    public int Width => Math.Max(0, Right - Left);
    public int Height => Math.Max(0, Bottom - Top);
}

/// <summary>
/// Pure physical-pixel placement and drop-snapping geometry for the glass notch.
/// Target monitor selection comes from the drop cursor rather than pre-drag dimensions, so crossing between
/// monitors of different DPI (e.g. 150% ↔ 100%) never pulls the notch back onto the previous screen.
/// </summary>
public static class NotchPlacement
{
    public static (string Edge, double Ratio) SnapFromDrop(int cursorX, int cursorY, NotchWorkArea work)
    {
        var cx = Math.Clamp(cursorX, work.Left, work.Right);
        var cy = Math.Clamp(cursorY, work.Top, work.Bottom);

        var top = Math.Abs(cy - work.Top);
        var bottom = Math.Abs(work.Bottom - cy);
        var left = Math.Abs(cx - work.Left);
        var right = Math.Abs(work.Right - cx);

        var edge = "Top";
        var best = top;
        if (bottom < best) { edge = "Bottom"; best = bottom; }
        if (left < best) { edge = "Left"; best = left; }
        if (right < best) { edge = "Right"; }

        var ratio = edge is "Top" or "Bottom"
            ? (work.Width <= 0 ? 0.5 : Math.Clamp((double)(cx - work.Left) / work.Width, 0.0, 1.0))
            : (work.Height <= 0 ? 0.5 : Math.Clamp((double)(cy - work.Top) / work.Height, 0.0, 1.0));

        return (edge, ratio);
    }

    public static (int X, int Y) PositionOnEdge(NotchWorkArea work, string edge, double ratio, int widthPx, int heightPx)
    {
        var r = Math.Clamp(ratio, 0.0, 1.0);
        var w = Math.Max(0, widthPx);
        var h = Math.Max(0, heightPx);

        if (edge is "Top" or "Bottom")
        {
            var x = work.Left + (int)Math.Round(r * Math.Max(0, work.Width - w));
            var y = edge == "Top" ? work.Top : Math.Max(work.Top, work.Bottom - h);
            return (x, y);
        }
        else
        {
            var x = edge == "Left" ? work.Left : Math.Max(work.Left, work.Right - w);
            var y = work.Top + (int)Math.Round(r * Math.Max(0, work.Height - h));
            return (x, y);
        }
    }
}
