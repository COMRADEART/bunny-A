using System;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Imaging;
using BunnyA.Services;

namespace BunnyA;

public partial class NotchWindow : Window
{
    private static readonly string[] WorkingStates = { "PLANNING", "RESEARCHING", "CODING", "TESTING", "FILE_WORK", "ACTIVE", "VERIFYING" };
    private static readonly string[] SlotNames = { "Gada", "Spear", "Vishnu Chakra", "Sword" };

    private readonly MainWindow mainWindow;
    private string currentEdge;
    private double offsetRatio;
    private bool expanded;
    private string? lastAvatar;
    private IntPtr previousForeground;
    // While the user drags, Host updates that resize the notch must not pull it back to its old edge.
    private bool dragging;
    private POINT? restoreAt;

    public string CurrentEdge => currentEdge;
    public event Action<string>? EdgeChanged;

    public NotchWindow(MainWindow owner)
    {
        InitializeComponent();
        mainWindow = owner;

        var config = ConfigService.Load();
        currentEdge = config.NotchEdge is "Top" or "Bottom" or "Left" or "Right" ? config.NotchEdge : "Top";
        offsetRatio = Math.Clamp(config.NotchOffsetRatio, 0, 1);
        expanded = !config.NotchCollapsed;
        // Restore the last position first so the monitor it was on is the one it is placed on again.
        // The first placement goes to the monitor holding the saved corner; the window has no real size yet to judge by.
        if (config.NotchLeft is double left && config.NotchTop is double top) restoreAt = new POINT { X = (int)left + 1, Y = (int)top + 1 };
        ApplyExpanded(animate: false);

        Loaded += (_, _) => ApplyEdgePlacement(currentEdge, offsetRatio);
        SizeChanged += (_, _) => Place();
        DpiChanged += (_, _) => Place();
        // Display, resolution, DPI and taskbar changes all move the work area; the notch follows it.
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        SystemParameters.StaticPropertyChanged += OnSystemParameterChanged;
        Closed += (_, _) =>
        {
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
            SystemParameters.StaticPropertyChanged -= OnSystemParameterChanged;
        };
        // WM_ACTIVATE names the window that lost activation to the notch, however it was activated (mouse, keyboard, UIA).
        SourceInitialized += (_, _) => HwndSource.FromHwnd(new WindowInteropHelper(this).Handle)?.AddHook((IntPtr hwnd, int msg, IntPtr wParam, IntPtr lParam, ref bool handled) =>
        {
            if (msg == 0x0006 && (wParam.ToInt64() & 0xFFFF) != 0) RememberForeground(lParam);
            return IntPtr.Zero;
        });
        PreviewKeyDown += (_, e) => { if (e.Key == Key.Escape) { RestoreForeground(); e.Handled = true; } };
    }

    private void OnDisplayChanged(object? sender, EventArgs e) => Dispatcher.BeginInvoke(Place);
    private void OnSystemParameterChanged(object? sender, System.ComponentModel.PropertyChangedEventArgs e)
    {
        if (e.PropertyName == nameof(SystemParameters.WorkArea)) Dispatcher.BeginInvoke(Place);
    }

    // ==========================================
    // PLACEMENT
    // ==========================================

    [StructLayout(LayoutKind.Sequential)] private struct RECT { public int Left, Top, Right, Bottom; }
    [StructLayout(LayoutKind.Sequential)] private struct POINT { public int X, Y; }
    [StructLayout(LayoutKind.Sequential)] private struct MONITORINFO { public int cbSize; public RECT rcMonitor; public RECT rcWork; public uint dwFlags; }
    [DllImport("user32.dll")] private static extern IntPtr MonitorFromPoint(POINT pt, uint flags);
    [DllImport("user32.dll")] private static extern bool GetMonitorInfo(IntPtr monitor, ref MONITORINFO info);
    [DllImport("user32.dll")] private static extern bool GetWindowRect(IntPtr hwnd, out RECT rect);
    [DllImport("user32.dll")] private static extern bool SetWindowPos(IntPtr hwnd, IntPtr after, int x, int y, int cx, int cy, uint flags);
    [DllImport("user32.dll")] private static extern bool SetForegroundWindow(IntPtr hwnd);
    [DllImport("user32.dll")] private static extern bool GetCursorPos(out POINT point);
    private const uint MONITOR_DEFAULTTONEAREST = 2, SWP_NOSIZE = 0x1, SWP_NOZORDER = 0x4, SWP_NOACTIVATE = 0x10;

    // Placement works in physical pixels: WPF's DIP Left/Top are ambiguous once a window spans monitors of different DPI.
    private IntPtr Hwnd => new WindowInteropHelper(this).EnsureHandle();

    private RECT WindowRect() { GetWindowRect(Hwnd, out var r); return r; }

    /// <summary>The work area (taskbar excluded) of the monitor under the notch's centre, in physical pixels.</summary>
    private RECT WorkAreaPx()
    {
        var r = WindowRect();
        return WorkAreaAt((r.Left + r.Right) / 2, (r.Top + r.Bottom) / 2);
    }

    private static RECT WorkAreaAt(int x, int y)
    {
        var info = new MONITORINFO { cbSize = Marshal.SizeOf<MONITORINFO>() };
        GetMonitorInfo(MonitorFromPoint(new POINT { X = x, Y = y }, MONITOR_DEFAULTTONEAREST), ref info);
        return info.rcWork;
    }

    private void MoveTo(int x, int y) => SetWindowPos(Hwnd, IntPtr.Zero, x, y, 0, 0, SWP_NOSIZE | SWP_NOZORDER | SWP_NOACTIVATE);

    public void ApplyEdgePlacement(string edge) => ApplyEdgePlacement(edge, 0.5);

    public void ApplyEdgePlacement(string edge, double ratio)
    {
        var changed = edge != currentEdge;
        currentEdge = edge;
        offsetRatio = Math.Clamp(ratio, 0, 1);
        var horizontal = edge is "Top" or "Bottom";
        HorizontalLayout.Visibility = horizontal ? Visibility.Visible : Visibility.Collapsed;
        VerticalLayout.Visibility = horizontal ? Visibility.Collapsed : Visibility.Visible;
        NotchBorder.CornerRadius = new CornerRadius(horizontal ? 24 : 20);
        UpdateLayout(); // ActualWidth/Height must describe the new layout, not the previous orientation.
        Place();
        Save();
        if (changed) EdgeChanged?.Invoke(edge);
    }

    /// <summary>Puts the notch on its edge at its saved offset, inside the current monitor's work area.</summary>
    private void Place()
    {
        if (dragging) return;
        FitContent();
        if (ActualWidth <= 0 || ActualHeight <= 0) return;
        var w = restoreAt is POINT saved ? WorkAreaAt(saved.X, saved.Y) : WorkAreaPx();
        restoreAt = null;
        var dpi = VisualTreeHelper.GetDpi(this);
        int width = (int)Math.Round(ActualWidth * dpi.DpiScaleX), height = (int)Math.Round(ActualHeight * dpi.DpiScaleY);
        if (currentEdge is "Top" or "Bottom")
            MoveTo(w.Left + (int)Math.Round(offsetRatio * Math.Max(0, w.Right - w.Left - width)), currentEdge == "Top" ? w.Top : w.Bottom - height);
        else
            MoveTo(currentEdge == "Left" ? w.Left : w.Right - width, w.Top + (int)Math.Round(offsetRatio * Math.Max(0, w.Bottom - w.Top - height)));
    }

    /// <summary>
    /// WPF drops SizeToContent to Manual when Windows resizes the window (a DPI change while crossing monitors does);
    /// the notch must keep fitting its content, so it is restored before every placement.
    /// </summary>
    private void FitContent()
    {
        if (SizeToContent == SizeToContent.WidthAndHeight) return;
        SizeToContent = SizeToContent.WidthAndHeight;
        UpdateLayout();
    }

    private void Save()
    {
        var r = WindowRect();
        var config = ConfigService.Load();
        ConfigService.Save(config with { NotchEdge = currentEdge, NotchOffsetRatio = offsetRatio, NotchLeft = r.Left, NotchTop = r.Top, NotchCollapsed = !expanded });
    }

    /// <summary>
    /// After a drag, the notch snaps to the nearest edge of the monitor it was dropped on, keeping its offset. The drop
    /// point comes from the cursor and the grip offset: Windows may already have moved a window that straddled monitors of
    /// different DPI by the time DragMove returns.
    /// </summary>
    private void SnapToNearestEdge(POINT grip, int width, int height)
    {
        GetCursorPos(out var cursor);
        double cx = cursor.X - grip.X + width / 2.0, cy = cursor.Y - grip.Y + height / 2.0;
        var w = WorkAreaAt((int)cx, (int)cy);
        // Bring the window onto the chosen monitor first, so placement measures that monitor.
        MoveTo((int)(cx - width / 2.0), (int)(cy - height / 2.0));
        var distances = new (string edge, double d)[]
        {
            ("Top", Math.Abs(cy - w.Top)), ("Bottom", Math.Abs(w.Bottom - cy)),
            ("Left", Math.Abs(cx - w.Left)), ("Right", Math.Abs(w.Right - cx)),
        };
        var edge = distances.OrderBy(x => x.d).First().edge;
        var ratio = edge is "Top" or "Bottom"
            ? (cx - w.Left) / Math.Max(1, w.Right - w.Left)
            : (cy - w.Top) / Math.Max(1, w.Bottom - w.Top);
        ApplyEdgePlacement(edge, ratio);
    }

    // ==========================================
    // EXPAND / COLLAPSE
    // ==========================================

    private void Collapse_Click(object sender, RoutedEventArgs e)
    {
        expanded = !expanded;
        ApplyExpanded(animate: true);
        Save();
        RestoreForeground();
    }

    private void ApplyExpanded(bool animate)
    {
        var visibility = expanded ? Visibility.Visible : Visibility.Collapsed;
        HorizontalDetails.Visibility = VerticalDetails.Visibility = visibility;
        FitContent();
        var reducedMotion = !SystemParameters.ClientAreaAnimation || ConfigService.Load().ReducedMotion;
        if (animate && !reducedMotion)
            NotchBorder.BeginAnimation(OpacityProperty, new DoubleAnimation(0.55, 1, TimeSpan.FromMilliseconds(180)) { EasingFunction = new QuadraticEase() });
        else
            NotchBorder.BeginAnimation(OpacityProperty, null);
    }

    // ==========================================
    // HOST STATUS
    // ==========================================

    public void ShowOffline(string reason)
    {
        NotchTitle.Text = "Bunny A · Offline";
        NotchSubtitle.Text = reason;
        QuickStopButton.Visibility = VQuickStopButton.Visibility = Visibility.Collapsed;
        ApprovalBadge.Visibility = VApprovalBadge.Visibility = Visibility.Collapsed;
        foreach (var badge in Badges()) badge.Opacity = 0.45;
    }

    private Border[][] Badges2() => new[] { new[] { GadaBadge, VGadaBadge }, new[] { SpearBadge, VSpearBadge }, new[] { ChakraBadge, VChakraBadge }, new[] { SwordBadge, VSwordBadge } };
    private Border[] Badges() => Badges2().SelectMany(b => b).ToArray();

    public void UpdateSnapshot(JsonElement root)
    {
        try
        {
            string? activeTitle = null, activeState = null, activeId = null, activeKind = null;
            var hasApproval = false;

            foreach (var t in root.JsonArr("tasks"))
            {
                var state = t.Json("state") ?? "";
                if (state == "waiting_for_approval" && t.JsonObj("mission").ValueKind != JsonValueKind.Object) hasApproval = true;
                if (activeTitle == null && state is "running" or "routing")
                    (activeTitle, activeState, activeId, activeKind) = (t.Json("title") ?? "Task running", state.ToUpperInvariant(), t.Json("id"), "orch");
            }
            foreach (var m in root.JsonObj("missions").JsonArr("missions"))
            {
                var state = m.Json("state") ?? "";
                if (state == "waiting_for_approval" || m.JsonArr("requests").Any(r => r.TryGetProperty("resolvedAt", out var ra) && ra.ValueKind == JsonValueKind.Null))
                    hasApproval = true;
                if (activeTitle == null && state is "planning" or "running" or "waiting_for_user" or "verifying")
                    (activeTitle, activeState, activeId, activeKind) = (m.Json("title") ?? "Mission running", state.ToUpperInvariant(), m.Json("id"), "mission");
            }
            foreach (var t in root.JsonObj("persistentTasks").JsonArr("tasks"))
            {
                var state = t.Json("state") ?? "";
                if (t.JsonObj("pendingAction").ValueKind == JsonValueKind.Object) hasApproval = true;
                if (activeTitle == null && state is "RUNNING" or "RESUMING")
                    (activeTitle, activeState, activeId, activeKind) = (t.Json("title") ?? "Task running", state, t.Json("id"), "ptask");
            }

            // Agent icons reflect each slot's Host presentation state; idle slots stay dimmed.
            var working = 0;
            var badges = Badges2();
            foreach (var s in root.JsonObj("personalAgents").JsonArr("slots"))
            {
                var slot = (int)s.JsonLong("slot");
                if (slot is < 1 or > 4) continue;
                var state = s.JsonObj("presentation").Json("state") ?? "UNKNOWN";
                var isWorking = WorkingStates.Contains(state);
                if (isWorking) working++;
                foreach (var badge in badges[slot - 1])
                {
                    badge.Opacity = isWorking ? 1 : 0.45;
                    badge.BorderBrush = new SolidColorBrush(isWorking ? Color.FromRgb(53, 80, 214) : Color.FromRgb(44, 54, 82));
                    badge.ToolTip = $"{SlotNames[slot - 1]} · {state.Replace('_', ' ').ToLowerInvariant()}";
                    System.Windows.Automation.AutomationProperties.SetItemStatus(badge, state);
                }
            }

            var stopTag = activeId == null ? null : $"{activeKind}:{activeId}";
            if (activeTitle != null)
            {
                NotchTitle.Text = $"Bunny A · {activeState}";
                NotchSubtitle.Text = activeTitle;
            }
            else
            {
                NotchTitle.Text = "Bunny A · Idle";
                NotchSubtitle.Text = working > 0 ? $"{working} of 4 agents working" : "No agent is working";
            }
            QuickStopButton.Tag = VQuickStopButton.Tag = stopTag;
            QuickStopButton.Visibility = VQuickStopButton.Visibility = stopTag != null ? Visibility.Visible : Visibility.Collapsed;
            ApprovalBadge.Visibility = VApprovalBadge.Visibility = hasApproval ? Visibility.Visible : Visibility.Collapsed;

            var voice = root.JsonObj("voice");
            var voiceState = voice.JsonBool("open") ? voice.Json("state") ?? "IDLE" : "CLOSED";
            var (label, avatar, color) = voiceState switch
            {
                "ARMING" or "LISTENING" => ("🔴 Listening…", "listening", Color.FromRgb(53, 80, 214)),
                "TRANSCRIBING" or "PROCESSING" => ("💭 Thinking…", "thinking", Color.FromRgb(53, 80, 214)),
                "SPEAKING" => ("🔊 Speaking…", "speaking", Color.FromRgb(109, 79, 224)),
                "MUTED" => ("🔇 Muted", "sleeping", Color.FromRgb(32, 38, 54)),
                "INTERRUPTED" => ("⏸ Interrupted", "interrupted", Color.FromRgb(28, 36, 56)),
                "ERROR" or "DEVICE_UNAVAILABLE" => ("⚠️ Voice unavailable", "idle", Color.FromRgb(70, 34, 40)),
                _ => (voice.JsonBool("muted") ? "🔇 Muted" : "🎙️ Voice", activeTitle != null ? "processing" : "idle", Color.FromRgb(28, 36, 56)),
            };
            VoiceStatusText.Text = label;
            VoicePill.Background = new SolidColorBrush(color);
            if (avatar != lastAvatar)
            {
                lastAvatar = avatar;
                var source = new BitmapImage(new Uri($"pack://application:,,,/Assets/characters/bunny.{avatar}.png"));
                BunnyAvatar.Source = VBunnyAvatar.Source = source;
            }
        }
        catch (Exception)
        {
            // A malformed snapshot leaves the last good notch state; the main window reports the unreadable section.
        }
    }

    // ==========================================
    // INTERACTION & FOCUS
    // ==========================================

    private void RememberForeground(IntPtr deactivated)
    {
        // Any other window, Bunny A's main window included, gets focus back after a notch action.
        if (deactivated != IntPtr.Zero && deactivated != new WindowInteropHelper(this).Handle) previousForeground = deactivated;
    }

    /// <summary>Hands focus back to the app the user was in before touching the notch.</summary>
    private void RestoreForeground()
    {
        if (previousForeground != IntPtr.Zero && IsActive) SetForegroundWindow(previousForeground);
    }

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            OpenWindow();
            return;
        }
        var start = WindowRect();
        GetCursorPos(out var at);
        var grip = new POINT { X = at.X - start.Left, Y = at.Y - start.Top };
        dragging = true;
        try { DragMove(); }
        finally { dragging = false; }
        SnapToNearestEdge(grip, start.Right - start.Left, start.Bottom - start.Top);
        RestoreForeground();
    }

    private void OpenWindow_Click(object sender, RoutedEventArgs e) => OpenWindow();

    private void OpenWindow() => mainWindow.ShowAndActivate();

    private void DockEdge_Click(object sender, RoutedEventArgs e)
    {
        var nextEdge = currentEdge switch
        {
            "Top" => "Right",
            "Right" => "Bottom",
            "Bottom" => "Left",
            _ => "Top"
        };
        ApplyEdgePlacement(nextEdge, offsetRatio);
        // A keyboard user keeps focus on the edge control of the layout now visible; anyone else gets their app back.
        if (InputManager.Current.MostRecentInputDevice is KeyboardDevice) (nextEdge is "Top" or "Bottom" ? DockEdgeButton : VDockEdgeButton).Focus();
        else RestoreForeground();
    }

    private void ApprovalBadge_Click(object sender, RoutedEventArgs e)
    {
        OpenWindow();
        mainWindow.SelectTab("Approvals");
    }

    private void VoicePill_Click(object sender, RoutedEventArgs e)
    {
        OpenWindow();
        mainWindow.SelectTab("Voice");
    }

    private async void QuickStop_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: string tag } || tag.Split(':', 2) is not [var kind, var id]) return;
        QuickStopButton.IsEnabled = VQuickStopButton.IsEnabled = false;
        try { await mainWindow.StopItemAsync(kind, id, "User stopped from notch."); }
        finally
        {
            QuickStopButton.IsEnabled = VQuickStopButton.IsEnabled = true;
            RestoreForeground();
        }
    }
}
