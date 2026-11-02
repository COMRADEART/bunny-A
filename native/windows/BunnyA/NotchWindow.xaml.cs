using System;
using System.Collections.Generic;
using System.Linq;
using System.Runtime.InteropServices;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Interop;
using System.Windows.Media;
using System.Windows.Media.Animation;
using System.Windows.Media.Effects;
using System.Windows.Media.Imaging;
using BunnyA.Services;

namespace BunnyA;

public partial class NotchWindow : Window
{
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

        Loaded += (_, _) => { ApplyTheme(); ApplyEdgePlacement(currentEdge, offsetRatio); };
        // Shown again: apply what the Host reported while hidden. Hidden: drop the chips, which stops every animation.
        IsVisibleChanged += (_, _) =>
        {
            if (IsVisible && pendingRoot is JsonElement root) { pendingRoot = null; UpdateSnapshot(root); }
            else if (!IsVisible) { HorizontalAgentsPanel.Children.Clear(); VerticalAgentsPanel.Children.Clear(); chipSignature = ""; }
        };
        SizeChanged += (_, _) => Place();
        DpiChanged += (_, _) => Place();
        // Display, resolution, DPI and taskbar changes all move the work area; the notch follows it.
        Microsoft.Win32.SystemEvents.DisplaySettingsChanged += OnDisplayChanged;
        Microsoft.Win32.SystemEvents.UserPreferenceChanged += OnUserPreferenceChanged;
        SystemParameters.StaticPropertyChanged += OnSystemParameterChanged;
        Closed += (_, _) =>
        {
            Microsoft.Win32.SystemEvents.DisplaySettingsChanged -= OnDisplayChanged;
            Microsoft.Win32.SystemEvents.UserPreferenceChanged -= OnUserPreferenceChanged;
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
        if (e.PropertyName is nameof(SystemParameters.HighContrast) or nameof(SystemParameters.ClientAreaAnimation)) Dispatcher.BeginInvoke(ApplyTheme);
    }
    // Light/dark and transparency-effects changes arrive as a General preference change.
    private void OnUserPreferenceChanged(object? sender, Microsoft.Win32.UserPreferenceChangedEventArgs e) => Dispatcher.BeginInvoke(ApplyTheme);

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
        NotchBorder.CornerRadius = NotchPlate.CornerRadius = new CornerRadius(horizontal ? 24 : 20);
        chipSignature = "";
        RenderChips(chips);
        UpdateLayout(); // ActualWidth/Height must describe the new layout, not the previous orientation.
        Place();
        Save();
        RequestSnapshot();
        if (changed)
        {
            EdgeChanged?.Invoke(edge);
            // A small spring settles the new orientation; skipped under reduced motion.
            if (!ReducedMotion)
            {
                var spring = new DoubleAnimation(0.9, 1, TimeSpan.FromMilliseconds(420)) { EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 6 } };
                NotchScale.BeginAnimation(ScaleTransform.ScaleXProperty, spring);
                NotchScale.BeginAnimation(ScaleTransform.ScaleYProperty, spring);
            }
        }
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
        RenderChips(chips);
        FitContent();
        if (animate && !ReducedMotion)
            NotchRoot.BeginAnimation(OpacityProperty, new DoubleAnimation(0.55, 1, TimeSpan.FromMilliseconds(180)) { EasingFunction = new QuadraticEase() });
        else
            NotchRoot.BeginAnimation(OpacityProperty, null);
    }

    // ==========================================
    // HOST STATUS — MA5-S2: agent chips from Host state (NotchModel), never from local guesses
    // ==========================================

    private const int MaxChips = 8;
    private List<NotchAgent> chips = new();
    private Dictionary<string, NotchState> previousStates = new();
    private string chipSignature = "";
    private JsonElement? pendingRoot;
    private bool offline;

    private bool ReducedMotion => !SystemParameters.ClientAreaAnimation || ConfigService.Load().ReducedMotion;

    public void ShowOffline(string reason)
    {
        offline = true;
        NotchTitle.Text = "Bunny A · Offline";
        NotchSubtitle.Text = reason;
        QuickStopButton.Visibility = VQuickStopButton.Visibility = Visibility.Collapsed;
        ApprovalBadge.Visibility = VApprovalBadge.Visibility = Visibility.Collapsed;
        ApplyVoice(NotchVoice.Disconnected, 0);
        // Nothing the Host last reported can be claimed now: every chip shows Disconnected, still and dimmed.
        RenderChips(chips.Select(c => c with { State = NotchState.Disconnected }).ToList());
    }

    public void UpdateSnapshot(JsonElement root)
    {
        // Hidden: no layout or animation work; the latest snapshot is applied when the notch is shown again.
        if (!IsVisible) { pendingRoot = root.Clone(); return; }
        try
        {
            offline = false;
            // E2b: parse this snapshot's uiTheme.notch (validated against the island's rules); a different key restyles.
            var incoming = NotchTokens.From(root);
            var nextKey = incoming?.Key;
            tokens = incoming;
            if (nextKey != tokenKey) { tokenKey = nextKey; ApplyTheme(); }
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
                if (t.JsonObj("pendingAction").ValueKind == JsonValueKind.Object || state == "AWAITING_APPROVAL") hasApproval = true;
                if (activeTitle == null && state is "RUNNING" or "RESUMING")
                    (activeTitle, activeState, activeId, activeKind) = (t.Json("title") ?? "Task running", state, t.Json("id"), "ptask");
            }

            // E2b: per-slot skins ride the same snapshot, but are committed here with the chips they render (the reads
            // above can throw on a malformed part), so a rejected snapshot keeps its last good look — skins included.
            // The stamp joins RenderChips' signature, so a skin change re-renders the chips even when states did not move.
            var nextAppearances = CharacterArt.Appearances(root);
            appearanceSlots = nextAppearances;
            appearancesStamp = string.Join(";", nextAppearances.OrderBy(kv => kv.Key).Select(kv => $"{kv.Key}={kv.Value.Style ?? "-"}/{kv.Value.Intensity}/{(kv.Value.HighContrast ? 1 : 0)}"));
            var next = NotchModel.Agents(root, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            RenderChips(next);
            var working = next.Count(c => NotchModel.IsActive(c.State));
            var waiting = next.Count(c => NotchModel.NeedsAttention(c.State));

            var stopTag = activeId == null ? null : $"{activeKind}:{activeId}";
            if (activeTitle != null)
            {
                NotchTitle.Text = $"Bunny A · {activeState}";
                NotchSubtitle.Text = activeTitle;
            }
            else
            {
                NotchTitle.Text = working > 0 ? "Bunny A · Working" : waiting > 0 ? "Bunny A · Needs you" : "Bunny A · Idle";
                NotchSubtitle.Text = working > 0 ? $"{working} agent{(working == 1 ? "" : "s")} working" : waiting > 0 ? $"{waiting} waiting for you" : "No agent is working";
            }
            QuickStopButton.Tag = VQuickStopButton.Tag = stopTag;
            QuickStopButton.Visibility = VQuickStopButton.Visibility = stopTag != null ? Visibility.Visible : Visibility.Collapsed;
            ApprovalBadge.Visibility = VApprovalBadge.Visibility = hasApproval ? Visibility.Visible : Visibility.Collapsed;

            var view = NotchVoice.From(root.JsonObj("voice"), DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            // Voice off or idle never hides the agents: the avatar follows agent work then.
            var avatar = view.State is "OFF" or "ON" && (activeTitle != null || working > 0) ? "processing" : view.Avatar;
            lastWorking = working;
            ApplyVoice(view, working);
            if (avatar != lastAvatar)
            {
                lastAvatar = avatar;
                var source = new BitmapImage(new Uri($"pack://application:,,,/Assets/characters/bunny.{avatar}.png"));
                BunnyAvatar.Source = VBunnyAvatar.Source = source;
            }
            RequestSnapshot();
        }
        catch (Exception)
        {
            // A malformed snapshot leaves the last good notch state; the main window reports the unreadable section.
        }
    }

    private string? lastVoiceState;
    private int lastWorking;
    // E2b: the Host's validated notch tokens; null = this notch keeps its local config theme (the fallback, unchanged).
    private NotchTokens? tokens;
    private string? tokenKey;
    // E2b: per-slot character skins from snapshot.characterAppearance; a slot absent here keeps its weapon's signature.
    private IReadOnlyDictionary<int, SlotAppearance> appearanceSlots = new Dictionary<int, SlotAppearance>();
    private string appearancesStamp = "";

    /// <summary>Phase 3: a voice-only update (the measured level while capture is confirmed); agent chips are untouched.</summary>
    public void UpdateVoice(JsonElement voice)
    {
        if (!IsVisible || offline || voice.ValueKind != JsonValueKind.Object) return;
        ApplyVoice(NotchVoice.From(voice, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()), lastWorking);
    }

    /// <summary>
    /// MA5-S2 Phase 3: the voice pill (both orientations) from Host voice facts. Brushes and the Narrator announcement change
    /// only when the state does; the level bar follows the worker's measured input and is hidden when there is none.
    /// </summary>
    private void ApplyVoice(VoiceView view, int working)
    {
        // Voice and agents are independent: an active voice state while agents work says so; the chips keep their own states.
        var label = $"{view.Glyph} {view.Label}{(view.State is not ("OFF" or "ON") && working > 0 ? $" · {working} working" : "")}";
        if (VoiceStatusText.Text != label) VoiceStatusText.Text = label;
        VVoiceGlyph.Text = view.Glyph;
        VVoicePill.ToolTip = label;
        var key = $"{view.State}|{HighContrast}";
        if (key != lastVoiceState)
        {
            var announce = lastVoiceState != null && !lastVoiceState.StartsWith(view.State + "|");
            lastVoiceState = key;
            foreach (var (pill, text) in new[] { (VoicePill, VoiceStatusText), (VVoicePill, VVoiceGlyph) })
            {
                if (HighContrast || view.Fill is not { } fill)
                {
                    pill.SetResourceReference(BackgroundProperty, HighContrast ? (object)SystemColors.WindowBrushKey : "NotchChip");
                    text.SetResourceReference(TextBlock.ForegroundProperty, HighContrast ? (object)SystemColors.WindowTextBrushKey : "NotchText");
                }
                else
                {
                    pill.Background = new SolidColorBrush(Color.FromRgb(fill.R, fill.G, fill.B));
                    text.Foreground = Brushes.White;
                }
                System.Windows.Automation.AutomationProperties.SetItemStatus(pill, view.State);
                System.Windows.Automation.AutomationProperties.SetHelpText(pill, NotchVoice.Announcement(view));
            }
            VoiceLevelTrack.SetResourceReference(ForegroundProperty, HighContrast ? (object)SystemColors.WindowTextBrushKey : "NotchText");
            if (announce && System.Windows.Automation.Peers.UIElementAutomationPeer.CreatePeerForElement(VoiceStatusText) is { } peer)
                peer.RaiseAutomationEvent(System.Windows.Automation.Peers.AutomationEvents.LiveRegionChanged);
        }
        VoiceLevelTrack.Visibility = view.Level is null ? Visibility.Collapsed : Visibility.Visible;
        // Quantized to 5 % so a steady room does not redraw the layered window on every reading.
        var value = Math.Round((view.Level ?? 0) * 20) / 20;
        if (VoiceLevelTrack.Value != value) VoiceLevelTrack.Value = value;
    }

    /// <summary>
    /// Rebuilds the chip strip only when what it shows changed. Collapsed shows only chips that are working or need the
    /// owner, so an idle notch is just the Bunny button; expanded shows every chip up to <see cref="MaxChips"/>.
    /// </summary>
    private void RenderChips(List<NotchAgent> next)
    {
        var shown = (expanded ? next : next.Where(c => NotchModel.IsActive(c.State) || NotchModel.NeedsAttention(c.State) || c.State is NotchState.Failed)).ToList();
        var signature = $"{expanded}|{currentEdge}|{ReducedMotion}|{appearancesStamp}|" + string.Join(";", shown.Select(c => $"{c.Key}={c.State}|{c.AccessibleName}"));
        chips = next;
        if (signature == chipSignature) return;
        chipSignature = signature;
        var horizontal = currentEdge is "Top" or "Bottom";
        var panel = horizontal ? HorizontalAgentsPanel : VerticalAgentsPanel;
        HorizontalAgentsPanel.Children.Clear();
        VerticalAgentsPanel.Children.Clear();
        foreach (var chip in NotchModel.Visible(shown, MaxChips))
        {
            var before = previousStates.GetValueOrDefault(chip.Key, chip.State);
            panel.Children.Add(BuildChip(chip, horizontal ? "" : "V", before));
        }
        if (shown.Count > MaxChips)
        {
            var more = new Button { Style = (Style)FindResource("AgentChip"), Content = new TextBlock { Text = $"+{shown.Count - MaxChips}", FontSize = 11, FontWeight = FontWeights.SemiBold } };
            more.SetResourceReference(ForegroundProperty, "NotchText");
            System.Windows.Automation.AutomationProperties.SetAutomationId(more, (horizontal ? "" : "V") + "AgentOverflow");
            System.Windows.Automation.AutomationProperties.SetName(more, $"{shown.Count - MaxChips} more agents; open Bunny A");
            System.Windows.Automation.AutomationProperties.SetItemStatus(more, $"{shown.Count - MaxChips} more");
            more.Click += (_, _) => { mainWindow.OpenItem(null, null, false); };
            panel.Children.Add(more);
        }
        panel.Margin = panel.Children.Count == 0 ? new Thickness(0) : horizontal ? new Thickness(0, 0, 10, 0) : new Thickness(0, 0, 0, 8);
        previousStates = next.ToDictionary(c => c.Key, c => c.State);
        FitContent();
        RequestSnapshot();
    }

    /// <summary>
    /// MA5-S2 acceptance evidence (BUNNY_NOTCH_SNAPSHOT=&lt;file.png&gt;): renders only the notch's own visual tree, with a
    /// transparent background, so no desktop content behind the glass is ever captured. Inert without the variable.
    /// </summary>
    private static readonly string? SnapshotPath = Environment.GetEnvironmentVariable("BUNNY_NOTCH_SNAPSHOT");
    private void RequestSnapshot()
    {
        if (SnapshotPath == null) return;
        Dispatcher.BeginInvoke(System.Windows.Threading.DispatcherPriority.ApplicationIdle, () =>
        {
            if (!IsVisible || NotchRoot.ActualWidth <= 0) return;
            var dpi = VisualTreeHelper.GetDpi(this);
            var bitmap = new RenderTargetBitmap((int)Math.Ceiling(NotchRoot.ActualWidth * dpi.DpiScaleX), (int)Math.Ceiling(NotchRoot.ActualHeight * dpi.DpiScaleY),
                dpi.PixelsPerInchX, dpi.PixelsPerInchY, PixelFormats.Pbgra32);
            bitmap.Render(NotchRoot);
            var png = new PngBitmapEncoder();
            png.Frames.Add(BitmapFrame.Create(bitmap));
            try { using var file = System.IO.File.Create(SnapshotPath); png.Save(file); } catch { /* evidence never breaks the notch */ }
        });
    }

    /// <summary>
    /// The canonical compact art for a weapon identity, rendered with its slot's skin (the PS island's
    /// Get-BunnyCharacterSkin: signature style when the Host sent none, pixel decoded to the grid and drawn crisp,
    /// per-slot or system high contrast plain). Returns null when the pack lacks the art, and the caller keeps the
    /// vector glyph — a chip is never blank.
    /// </summary>
    private Image? IdentityArt(NotchAgent a)
    {
        if (CharacterArt.WeaponArtId(a.Identity, "ACTIVE", "compact") is not { } id) return null;
        var appearance = a.Key.StartsWith("slot:") && int.TryParse(a.Key["slot:".Length..], out var slot)
            ? appearanceSlots.GetValueOrDefault(slot)
            : null;
        try
        {
            var bitmap = new BitmapImage();
            var pixel = appearance?.Style == "pixel";
            bitmap.BeginInit();
            bitmap.UriSource = new Uri($"pack://application:,,,/Assets/characters/{id}.png");
            if (pixel)
            {
                // The 24-cell grid rides the long side (Get-BunnyPixelDecodeWidth / pixelSprite), and decoding
                // never upsamples: measure the art, decode the long side down to the grid, keep the other axis.
                var probe = new BitmapImage();
                probe.BeginInit(); probe.UriSource = bitmap.UriSource; probe.EndInit(); probe.Freeze();
                if (Math.Max(probe.PixelWidth, probe.PixelHeight) > 24)
                {
                    if (probe.PixelWidth >= probe.PixelHeight) bitmap.DecodePixelWidth = 24; else bitmap.DecodePixelHeight = 24;
                }
            }
            bitmap.EndInit();
            bitmap.Freeze();
            var image = new Image
            {
                Source = bitmap, Stretch = Stretch.Uniform, Width = 20, Height = 20,
                HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
                RenderTransformOrigin = new Point(0.5, 0.5),
                RenderTransform = new TransformGroup { Children = { new ScaleTransform(), new RotateTransform(), new TranslateTransform() } },
            };
            if (appearance?.Style == "pixel") RenderOptions.SetBitmapScalingMode(image, BitmapScalingMode.NearestNeighbor);
            var style = appearance?.Style ?? CharacterArt.Signature(a.Identity);
            // A style is material only (the island's rule): the same art with an effect; system or per-slot contrast drops it for plain art.
            if (appearance?.HighContrast != true && !HighContrast && CharacterArt.StyleEffect(style) is { } spec)
                image.Effect = new DropShadowEffect { Color = (Color)ColorConverter.ConvertFromString(spec.Color), BlurRadius = spec.Blur, ShadowDepth = spec.Depth, Opacity = spec.Opacity };
            return image;
        }
        catch { return null; }
    }

    private Button BuildChip(NotchAgent a, string prefix, NotchState before)
    {
        var art = IdentityArt(a);
        FrameworkElement identity = art ?? (FrameworkElement)new System.Windows.Shapes.Path
        {
            Data = (Geometry)FindResource(a.Identity switch { "gada" => "GlyphGada", "spear" => "GlyphSpear", "chakra" => "GlyphChakra", "sword" => "GlyphSword", _ => "GlyphTask" }),
            StrokeThickness = 1.7, StrokeLineJoin = PenLineJoin.Round, StrokeStartLineCap = PenLineCap.Round, StrokeEndLineCap = PenLineCap.Round,
            Stretch = Stretch.Uniform, Width = 18, Height = 18, RenderTransformOrigin = new Point(0.5, 0.5),
            RenderTransform = new TransformGroup { Children = { new ScaleTransform(), new RotateTransform(), new TranslateTransform() } },
            HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center,
        };
        if (identity is System.Windows.Shapes.Path glyphOnly) glyphOnly.SetResourceReference(System.Windows.Shapes.Shape.StrokeProperty, "NotchText");
        var stateKey = a.State switch
        {
            _ when NotchModel.NeedsAttention(a.State) => "NotchAttention",
            _ when NotchModel.IsActive(a.State) => "NotchAccent",
            NotchState.Completed => "NotchPositive",
            NotchState.Failed => "NotchNegative",
            _ => "NotchChipEdge",
        };
        var mark = NotchModel.Glyph(a.State);
        var badge = new Border
        {
            CornerRadius = new CornerRadius(6), MinWidth = 12, Height = 12, Padding = new Thickness(2, 0, 2, 0),
            HorizontalAlignment = HorizontalAlignment.Right, VerticalAlignment = VerticalAlignment.Bottom, Margin = new Thickness(0, 0, -3, -3),
            Visibility = mark.Length == 0 ? Visibility.Collapsed : Visibility.Visible,
            Child = new TextBlock { Text = mark, FontSize = 8, FontWeight = FontWeights.Bold, HorizontalAlignment = HorizontalAlignment.Center, VerticalAlignment = VerticalAlignment.Center },
        };
        badge.SetResourceReference(Border.BackgroundProperty, stateKey);
        ((TextBlock)badge.Child).SetResourceReference(TextBlock.ForegroundProperty, HighContrast ? "NotchChip" : "NotchText");
        var grid = new Grid { Width = 28, Height = 28 };
        grid.Children.Add(identity);
        grid.Children.Add(badge);
        var chip = new Button { Style = (Style)FindResource("AgentChip"), Content = grid, Tag = a, ToolTip = a.AccessibleName.Replace(" · ", "\n") };
        chip.SetResourceReference(BorderBrushProperty, stateKey);
        chip.Opacity = a.State is NotchState.Idle or NotchState.Unknown or NotchState.Disconnected ? 0.55 : 1;
        System.Windows.Automation.AutomationProperties.SetAutomationId(chip, prefix + a.AutomationId);
        System.Windows.Automation.AutomationProperties.SetName(chip, a.AccessibleName);
        System.Windows.Automation.AutomationProperties.SetItemStatus(chip, NotchModel.Label(a.State));
        System.Windows.Automation.AutomationProperties.SetHelpText(chip, a.Kind != null ? "Opens this item in Bunny A" : "Opens the Agent Dashboard");
        chip.Click += Chip_Click;
        if (!ReducedMotion && !offline) Animate(a, before, identity, badge, chip);
        return chip;
    }

    /// <summary>
    /// One motion per identity, only while the Host reports work in progress: Gada a weighted impact pulse, Spear a
    /// forward thrust, Vishnu Chakra a turning ring, Sword a light sweep along the blade. Attention pulses its badge;
    /// a fresh Completed or Failed plays once. Nothing moves while idle, waiting, hidden or under reduced motion.
    /// </summary>
    private void Animate(NotchAgent a, NotchState before, FrameworkElement art, Border badge, Button chip)
    {
        var group = (TransformGroup)art.RenderTransform;
        var scale = (ScaleTransform)group.Children[0];
        var rotate = (RotateTransform)group.Children[1];
        var move = (TranslateTransform)group.Children[2];
        // The slot's skin paces the motion (the PS island's Get-BunnyCharacterSkin): subtle = half the reach at 1.6x the
        // period, off = the character and its badge hold still (badge visible, no pulse — the peers' stillness).
        var appearance = a.Key.StartsWith("slot:") && int.TryParse(a.Key["slot:".Length..], out var skinSlot)
            ? appearanceSlots.GetValueOrDefault(skinSlot)
            : null;
        var amp = appearance?.Amplitude ?? 1.0;
        var period = appearance?.PeriodScale ?? 1.0;
        var animates = appearance?.Animate ?? true;
        // Ambient loops on an 18 px glyph look the same at 30 fps and cost half the frames in a layered window.
        AnimationTimeline Loop(double from, double to, double seconds, IEasingFunction? ease = null, bool reverse = true)
        {
            if (appearance?.Style == "pixel")
            {
                // The pixel skin jumps through exactly four frames per loop (web steps(4,end); island DiscreteDoubleKeyFrames).
                var pixels = new DoubleAnimationUsingKeyFrames { RepeatBehavior = RepeatBehavior.Forever, AutoReverse = reverse };
                for (var step = 1; step <= 4; step++)
                    pixels.KeyFrames.Add(new DiscreteDoubleKeyFrame(from + (to - from) * step / 4, KeyTime.FromTimeSpan(TimeSpan.FromSeconds(seconds * step / 4))));
                Timeline.SetDesiredFrameRate(pixels, 30);
                return pixels;
            }
            var loop = new DoubleAnimation(from, to, TimeSpan.FromSeconds(seconds)) { AutoReverse = reverse, RepeatBehavior = RepeatBehavior.Forever, EasingFunction = ease };
            Timeline.SetDesiredFrameRate(loop, 30);
            return loop;
        }
        if (NotchModel.IsActive(a.State) && animates)
        {
            var horizontal = currentEdge is "Top" or "Bottom";
            switch (a.Identity)
            {
                case "gada":
                    var impact = Loop(1, 1 + 0.14 * amp, 0.55 * period, new BackEase { Amplitude = 0.6, EasingMode = EasingMode.EaseIn });
                    scale.BeginAnimation(ScaleTransform.ScaleXProperty, impact);
                    scale.BeginAnimation(ScaleTransform.ScaleYProperty, impact);
                    break;
                case "spear":
                    move.BeginAnimation(horizontal ? TranslateTransform.XProperty : TranslateTransform.YProperty, Loop(0, (horizontal ? 2.5 : -2.5) * amp, 0.45 * period, new SineEase()));
                    break;
                case "chakra":
                    rotate.BeginAnimation(RotateTransform.AngleProperty, Loop(0, 360, 2.4 * period, reverse: false));
                    break;
                case "sword":
                    // The vector glyph sweeps a glint along the blade; canonical art pulses a uniform sheen instead.
                    if (art is System.Windows.Shapes.Path path)
                    {
                        var sweep = new LinearGradientBrush { StartPoint = new Point(0, 1), EndPoint = new Point(1, 0) };
                        var baseColor = ((SolidColorBrush)FindResource("NotchText")).Color;
                        var glint = new GradientStop(((SolidColorBrush)FindResource("NotchFocus")).Color, 0);
                        sweep.GradientStops.Add(new GradientStop(baseColor, 0));
                        sweep.GradientStops.Add(glint);
                        sweep.GradientStops.Add(new GradientStop(baseColor, 1));
                        path.Stroke = sweep;
                        glint.BeginAnimation(GradientStop.OffsetProperty, Loop(0, 1, 1.1, new SineEase(), reverse: false));
                    }
                    else
                    {
                        art.BeginAnimation(OpacityProperty, Loop(1, 1 - 0.3 * amp, 1.1 * period, new SineEase()));
                    }
                    break;
                default:
                    art.BeginAnimation(OpacityProperty, Loop(1, 1 - 0.45 * amp, 0.9 * period, new SineEase()));
                    break;
            }
            FrameMeter.Track(chip);
        }
        else if (NotchModel.NeedsAttention(a.State))
        {
            // The amber pulse is motion; a skin at intensity off keeps the badge signaling by holding it visible.
            if (animates)
            {
                badge.BeginAnimation(OpacityProperty, Loop(1, 0.35, 0.7, new SineEase()));
                FrameMeter.Track(chip);
            }
        }
        else if (animates && before != a.State && a.State == NotchState.Completed)
        {
            var pop = new DoubleAnimation(1.25, 1, TimeSpan.FromMilliseconds(420)) { EasingFunction = new ElasticEase { Oscillations = 1, Springiness = 5 } };
            scale.BeginAnimation(ScaleTransform.ScaleXProperty, pop);
            scale.BeginAnimation(ScaleTransform.ScaleYProperty, pop);
        }
        else if (animates && before != a.State && a.State == NotchState.Failed)
        {
            move.BeginAnimation(TranslateTransform.XProperty, new DoubleAnimation(-2.5, 0, TimeSpan.FromMilliseconds(360)) { EasingFunction = new ElasticEase { Oscillations = 3, Springiness = 2 } });
        }
    }

    private void Chip_Click(object sender, RoutedEventArgs e)
    {
        if (sender is not Button { Tag: NotchAgent a }) return;
        mainWindow.OpenItem(a.Kind, a.ItemId, NotchModel.NeedsAttention(a.State));
    }

    // ==========================================
    // GLASS THEME — follows Windows light/dark, transparency effects and high contrast (or the NotchTheme override)
    // ==========================================

    private bool HighContrast { get; set; }

    private static (bool light, bool transparency) WindowsPersonalization()
    {
        try
        {
            using var key = Microsoft.Win32.Registry.CurrentUser.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");
            return ((key?.GetValue("AppsUseLightTheme") as int?) == 1, (key?.GetValue("EnableTransparency") as int?) != 0);
        }
        catch { return (false, true); }
    }

    private void ApplyTheme()
    {
        var config = ConfigService.Load();
        var (systemLight, systemTransparency) = WindowsPersonalization();
        HighContrast = config.NotchTheme == "HighContrast" || (config.NotchTheme is not ("Light" or "Dark") && SystemParameters.HighContrast);
        // E2b: a saved workstation variant (revision > 0, not "system") wins; then the notch's own setting; then
        // Windows — the island's Get-BunnyThemeLight rule exactly.
        var themed = tokens is { Revision: > 0 };
        var light = tokens is { Revision: > 0 } forcedSet && forcedSet.Variant != "system" ? forcedSet.Variant == "light"
            : config.NotchTheme == "Light" || (config.NotchTheme == "System" && systemLight);
        var opaque = HighContrast || config.ReducedTransparency || (config.NotchTheme == "System" && !systemTransparency);
        void Set(string key, Brush brush) => Resources[key] = brush;
        SolidColorBrush C(string hex) => new((Color)ColorConverter.ConvertFromString(hex));
        LinearGradientBrush Surface(string top, string bottom) => new(new GradientStopCollection { new((Color)ColorConverter.ConvertFromString(top), 0), new((Color)ColorConverter.ConvertFromString(bottom), 1) }, new Point(0, 0), new Point(0, 1));
        if (HighContrast)
        {
            // System colours only: the user's contrast theme decides every colour; state is carried by glyph and name.
            Set("NotchText", SystemColors.WindowTextBrush); Set("NotchMuted", SystemColors.WindowTextBrush);
            Set("NotchChip", SystemColors.WindowBrush); Set("NotchChipEdge", SystemColors.WindowTextBrush);
            Set("NotchFocus", SystemColors.HighlightBrush); Set("NotchAccent", SystemColors.HighlightBrush);
            Set("NotchAttention", SystemColors.HighlightBrush); Set("NotchPositive", SystemColors.WindowTextBrush); Set("NotchNegative", SystemColors.WindowTextBrush);
            Set("NotchSurface", SystemColors.WindowBrush);
        }
        else if (themed && tokens is { Revision: > 0 } themedSet)
        {
            // E2b: the Host's validated tokens replace text, muted, accent, chip fill/edge and the surface; the status
            // colours keep their tested C# values (the same rule the island applies to a themed surface). The C#
            // surface keeps its own translucency; the E1 glass block's sheen strength applies below (never a blur change).
            string Tok(string key) => themedSet.Color(light, key);
            string Alpha(string alpha, string hex) => "#" + alpha + hex[1..];
            Set("NotchText", C(Tok("ink"))); Set("NotchMuted", C(Tok("muted")));
            Set("NotchAccent", C(Tok("accent")));
            Set("NotchChip", C(Alpha(opaque ? "FF" : "CC", Tok("fill"))));
            Set("NotchChipEdge", C(Tok("stroke")));
            Set("NotchSurface", opaque
                ? Surface(Alpha("FF", Tok("fill")), Alpha("FF", Tok("fillEnd")))
                : Surface(Alpha("E6", Tok("fill")), Alpha("D9", Tok("fillEnd"))));
            NotchPlate.BorderBrush = themedSet.Glow ? C(Tok("glow")) : C(Tok("stroke"));
            NotchPlate.CornerRadius = NotchBorder.CornerRadius = themedSet.Shape is "pill" or "capsule" ? new CornerRadius(999) : new CornerRadius(Math.Max(2, themedSet.Radius));
            FontFamily = new FontFamily(themedSet.Font + ", Segoe UI");
        }
        else
        {
            if (light)
            {
                Set("NotchText", C("#141826")); Set("NotchMuted", C("#4A5268")); Set("NotchChip", C(opaque ? "#FFFFFFFF" : "#CCFFFFFF")); Set("NotchChipEdge", C("#B8C0D6"));
                Set("NotchFocus", C("#2F45D8")); Set("NotchAccent", C("#3A4FE0")); Set("NotchAttention", C("#B87800")); Set("NotchPositive", C("#14804F")); Set("NotchNegative", C("#C42B31"));
                Set("NotchSurface", opaque ? Surface("#FFF4F6FB", "#FFE9ECF5") : Surface("#E6FBFCFF", "#D9EEF1F8"));
            }
            else
            {
                Set("NotchText", C("#EEF1FA")); Set("NotchMuted", C("#9AA3B8")); Set("NotchChip", C(opaque ? "#FF1C2438" : "#CC1C2438")); Set("NotchChipEdge", C("#36425F"));
                Set("NotchFocus", C("#B9C6FF")); Set("NotchAccent", C("#6B7BFF")); Set("NotchAttention", C("#E5A000")); Set("NotchPositive", C("#22A06B")); Set("NotchNegative", C("#E5484D"));
                Set("NotchSurface", opaque ? Surface("#FF1C2236", "#FF121726") : Surface("#E61C2236", "#D9121726"));
            }
            // Returning to the local look puts back everything a themed set had replaced.
            NotchPlate.BorderBrush = (Brush)FindResource("NotchChipEdge");
            NotchPlate.CornerRadius = NotchBorder.CornerRadius = new CornerRadius(24);
            FontFamily = new FontFamily("Segoe UI");
        }
        NotchSheen.Visibility = opaque ? Visibility.Collapsed : Visibility.Visible;
        // E1: the glass intensity's sheen strength while glass renders (themed and not opaque); the local look keeps 1.
        NotchSheen.Opacity = !opaque && tokens is { Revision: > 0 } glassSet && glassSet.Glass is { } glassTokens ? glassTokens.SheenAlpha : 1.0;
        NotchPlate.Effect = HighContrast ? null : new DropShadowEffect { BlurRadius = 22, ShadowDepth = 3, Direction = 270, Color = Colors.Black, Opacity = light ? 0.22 : 0.45 };
        var thickness = HighContrast ? 2 : tokens is { Revision: > 0 } borderedSet ? Math.Max(1, Math.Min(4, borderedSet.Border)) : 1;
        NotchBorder.BorderThickness = NotchPlate.BorderThickness = new Thickness(thickness);
        // Readable by UI Automation, so acceptance can read which theme source is active.
        System.Windows.Automation.AutomationProperties.SetItemStatus(this,
            $"theme={(themed ? tokens!.Theme : HighContrast ? "high-contrast" : light ? "light" : "dark")};opaque={opaque.ToString().ToLowerInvariant()};reducedMotion={ReducedMotion.ToString().ToLowerInvariant()};tokens={(themed ? "host" : "local")}");
        chipSignature = ""; // brushes captured by running animations are rebuilt with the new palette
        RenderChips(chips);
        RequestSnapshot();
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
