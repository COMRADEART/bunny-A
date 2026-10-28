using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using BunnyA.Models;
using BunnyA.Services;

namespace BunnyA;

public partial class MainWindow : Window
{
    private static readonly string[] Tabs = { "Chat", "Agents", "Projects", "Approvals", "Voice", "History", "Lotus", "Models", "Devices", "Settings" };
    private static readonly HashSet<string> WorkingPresentation = new() { "PLANNING", "RESEARCHING", "CODING", "TESTING", "FILE_WORK", "ACTIVE", "VERIFYING" };
    private static readonly HashSet<string> WaitingPresentation = new() { "WAITING", "WAITING_FOR_USER", "PAUSED", "RECOVERING" };

    private readonly HostClient hostClient = new();
    private readonly DispatcherTimer refreshTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly DispatcherTimer activityDebounce = new() { Interval = TimeSpan.FromMilliseconds(300) };
    private readonly CancellationTokenSource lifetime = new();
    private NotchWindow? notchWindow;

    private bool refreshInFlight;
    private long refreshSeq;
    private long appliedSeq;
    private int consecutiveFailures;
    private bool isClosed;
    private bool exiting;
    private bool rebinding;
    private bool hostRestartedDuringChat;
    private JsonElement lastRoot;

    private int selectedSpeakerSlot = 0; // 0 = Bunny, 1 = Gada, 2 = Spear, 3 = Chakra, 4 = Sword
    private string? activeInferenceTaskId;
    private readonly List<ChatMessage> chatMessages = new();
    private List<ModelItem> chatModels = new();
    private string chatModelSignature = "";

    private List<PendingApprovalItem> currentApprovals = new();
    private readonly Dictionary<string, (bool ok, string scope, string effects, string context)> inspected = new();
    private readonly List<string> decisions = new();

    private string lastVoiceLine = "";
    private JsonElement taskPolicy;
    private (double cpu, double gpu)? thermalWarn;

    public MainWindow()
    {
        InitializeComponent();
        hostClient.HostChanged += OnHostChanged;
        activityDebounce.Tick += (_, _) => { activityDebounce.Stop(); _ = RefreshAllStateAsync(); };
        refreshTimer.Tick += (_, _) => _ = RefreshAllStateAsync();
        PreviewKeyDown += Window_PreviewKeyDown;

        Loaded += async (_, _) =>
        {
            notchWindow = new NotchWindow(this);
            notchWindow.EdgeChanged += SyncNotchEdgeCombo;
            notchWindow.Show();
            SyncNotchEdgeCombo(notchWindow.CurrentEdge);
            ToggleNotchButton.Content = "💎 Hide Glass Notch";

            await RefreshAllStateAsync();
            if (isClosed) return;
            refreshTimer.Start();
            // The activity stream only wakes a refresh; /state stays the source of truth and polling the fallback.
            _ = hostClient.RunEventStreamAsync(() => Dispatcher.BeginInvoke(() => { if (!activityDebounce.IsEnabled) activityDebounce.Start(); }), lifetime.Token);
        };

        Closing += (_, e) =>
        {
            // Closing hides the window; the notch keeps Bunny A reachable. Only Quit exits.
            if (exiting) return;
            e.Cancel = true;
            Hide();
            if (notchWindow is { IsVisible: false })
            {
                notchWindow.Show();
                ToggleNotchButton.Content = "💎 Hide Glass Notch";
            }
        };

        Closed += (_, _) =>
        {
            isClosed = true;
            refreshTimer.Stop();
            activityDebounce.Stop();
            lifetime.Cancel();
            hostClient.Dispose();
            lifetime.Dispose();
        };
    }

    // ==========================================
    // NAVIGATION & LIFECYCLE
    // ==========================================

    public void SelectTab(string tabName)
    {
        ScreenChat.Visibility = tabName == "Chat" ? Visibility.Visible : Visibility.Collapsed;
        ScreenAgents.Visibility = tabName == "Agents" ? Visibility.Visible : Visibility.Collapsed;
        ScreenProjects.Visibility = tabName == "Projects" ? Visibility.Visible : Visibility.Collapsed;
        ScreenApprovals.Visibility = tabName == "Approvals" ? Visibility.Visible : Visibility.Collapsed;
        ScreenVoice.Visibility = tabName == "Voice" ? Visibility.Visible : Visibility.Collapsed;
        ScreenHistory.Visibility = tabName == "History" ? Visibility.Visible : Visibility.Collapsed;
        ScreenLotus.Visibility = tabName == "Lotus" ? Visibility.Visible : Visibility.Collapsed;
        ScreenModels.Visibility = tabName == "Models" ? Visibility.Visible : Visibility.Collapsed;
        ScreenDevices.Visibility = tabName == "Devices" ? Visibility.Visible : Visibility.Collapsed;
        ScreenSettings.Visibility = tabName == "Settings" ? Visibility.Visible : Visibility.Collapsed;

        foreach (var child in NavButtonsPanel.Children)
        {
            if (child is Button btn)
            {
                var match = (string)btn.Tag == tabName;
                btn.Style = match ? (Style)FindResource("PrimaryButtonStyle") : (Style)FindResource(typeof(Button));
                System.Windows.Automation.AutomationProperties.SetItemStatus(btn, match ? "current" : "");
            }
        }
    }

    public void ShowAndActivate()
    {
        Show();
        if (WindowState == WindowState.Minimized) WindowState = WindowState.Normal;
        Activate();
    }

    private void NavButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string tabName) SelectTab(tabName);
    }

    private void Window_PreviewKeyDown(object sender, KeyEventArgs e)
    {
        // Ctrl+1..9, Ctrl+0 select screens; F5 refreshes from the Host.
        if (Keyboard.Modifiers == ModifierKeys.Control && e.Key is >= Key.D0 and <= Key.D9)
        {
            var index = e.Key == Key.D0 ? 9 : e.Key - Key.D1;
            SelectTab(Tabs[index]);
            e.Handled = true;
        }
        else if (e.Key == Key.F5)
        {
            _ = RefreshAllStateAsync(force: true);
            e.Handled = true;
        }
    }

    private void Quit_Click(object sender, RoutedEventArgs e)
    {
        // The only clean exit: closing the window just hides it to the notch.
        exiting = true;
        notchWindow?.Close();
        Application.Current.Shutdown(0);
    }

    private void ToggleNotch_Click(object sender, RoutedEventArgs e)
    {
        if (notchWindow == null) return;
        if (notchWindow.IsVisible)
        {
            notchWindow.Hide();
            ToggleNotchButton.Content = "💎 Show Glass Notch";
        }
        else
        {
            notchWindow.Show();
            ToggleNotchButton.Content = "💎 Hide Glass Notch";
        }
    }

    private async void RefreshAll_Click(object sender, RoutedEventArgs e) => await RefreshAllStateAsync(force: true);

    private void OnHostChanged(bool identityChanged)
    {
        // Anything reviewed against the previous Host or epoch is reviewed again; nothing carries over.
        inspected.Clear();
        PendingApprovalsList.SelectedItem = null;
        hostRestartedDuringChat = activeInferenceTaskId != null;
        RecordDecision(identityChanged
            ? "A different Bunny A Host is now answering. Pending approvals were cleared for review."
            : "The Host restarted. Pending approvals were cleared for review.");
    }

    // ==========================================
    // HOST STATE
    // ==========================================

    /// <summary>Fetches /state and applies it unless a newer refresh already did. Returns false when no fresh state arrived.</summary>
    private async Task<bool> RefreshAllStateAsync(bool force = false)
    {
        if (isClosed || (refreshInFlight && !force)) return false;
        refreshInFlight = true;
        var seq = ++refreshSeq;
        try
        {
            var root = await hostClient.GetStateAsync(lifetime.Token);
            if (isClosed) return false;
            consecutiveFailures = 0;
            if (seq < appliedSeq) return true; // an older response never overwrites a newer one
            appliedSeq = seq;
            ApplySnapshot(root);
            return true;
        }
        catch (OperationCanceledException) { return false; }
        catch (Exception ex)
        {
            consecutiveFailures++;
            if (!isClosed && seq >= appliedSeq) ShowOffline(ex);
            return false;
        }
        finally
        {
            refreshInFlight = false;
            if (!isClosed) refreshTimer.Interval = NextRefreshInterval();
        }
    }

    // Bounded backoff while disconnected (3, 6, 12, 24, 30 s); a slow safety poll while the activity stream is live.
    private TimeSpan NextRefreshInterval() => consecutiveFailures > 0
        ? TimeSpan.FromSeconds(Math.Min(30, 3 * Math.Pow(2, consecutiveFailures - 1)))
        : TimeSpan.FromSeconds(hostClient.EventsConnected ? 15 : 3);

    private void ShowOffline(Exception ex)
    {
        HostStatusDot.Fill = (SolidColorBrush)FindResource("NegativeBrush");
        HostStatusText.Text = ex is HostException h ? h.Kind switch
        {
            HostFailure.CredentialsMissing or HostFailure.Unreachable => "Host not running",
            HostFailure.CredentialsInvalid => "Host credentials invalid",
            HostFailure.AuthRejected => "Host rejected credential",
            HostFailure.Timeout => "Host not responding",
            HostFailure.Malformed => "Host data unreadable",
            _ => "Host connection lost",
        } : "Host connection lost";
        HostEpochText.Text = $"{ex.Message} Retrying in {NextRefreshInterval().TotalSeconds:0} s.";
        notchWindow?.ShowOffline(HostStatusText.Text);
        UpdateApprovalButtons();
    }

    private readonly List<string> malformedSections = new();

    private void Section(string name, Action apply)
    {
        try { apply(); }
        catch (Exception) { malformedSections.Add(name); }
    }

    private void ApplySnapshot(JsonElement root)
    {
        lastRoot = root;
        malformedSections.Clear();
        HostStatusDot.Fill = (SolidColorBrush)FindResource("PositiveBrush");
        HostStatusText.Text = "Connected to Workstation Host";

        notchWindow?.UpdateSnapshot(root);
        Section("tasks", () => ApplyTasks(root));
        Section("agents", () => ApplyAgents(root));
        Section("projects", () => ApplyProjects(root));
        Section("memory", () => ApplyLotus(root));
        Section("models", () => ApplyModels(root));
        Section("devices", () => ApplyDevices(root));
        Section("voice", () => ApplyVoice(root));
        Section("settings", () => ApplySettings(root));

        var id = hostClient.HostId ?? "";
        HostEpochText.Text = $"Epoch {hostClient.HostEpoch} · Host {id[..Math.Min(8, id.Length)]}… · " +
            (hostClient.EventsConnected ? "live activity stream" : "polling every 3 s") +
            (malformedSections.Count > 0 ? $" · could not read: {string.Join(", ", malformedSections)}" : "");
        UpdateApprovalButtons();
    }

    private static void SetItems<T>(ListBox list, List<T> items, Func<T, string> key) where T : class
    {
        // Keep the user's selection by identity; a vanished item leaves nothing selected rather than a neighbour.
        var previous = list.SelectedItem is T p ? key(p) : null;
        list.ItemsSource = items;
        list.SelectedItem = previous == null ? null : items.FirstOrDefault(i => key(i) == previous);
    }

    private void ApplyTasks(JsonElement root)
    {
        var activeTasks = new List<TaskRow>();
        var historyTasks = new List<TaskRow>();
        var approvals = new List<PendingApprovalItem>();

        foreach (var task in root.JsonArr("tasks"))
        {
            var id = task.Json("id");
            if (string.IsNullOrEmpty(id)) continue;
            var title = task.Json("title") ?? "Task";
            var state = task.Json("state") ?? "unknown";
            var provider = task.Json("provider");
            var model = task.Json("model");
            var isStep = task.JsonObj("mission").ValueKind == JsonValueKind.Object;
            var row = new TaskRow(id, isStep ? $"[Step] {title}" : title, state.ToUpperInvariant(), Model: $"{provider} · {model}", Error: task.Json("error"),
                CanCancel: state is "queued" or "routing" or "waiting_for_approval" or "running", Kind: "orch");
            (state is "completed" or "failed" or "stopped" ? historyTasks : activeTasks).Add(row);

            // Mission children are released through their Mission's own approval, never as a bare task launch.
            if (state == "waiting_for_approval" && !isStep)
            {
                var cwd = task.Json("cwd");
                approvals.Add(new PendingApprovalItem(
                    TaskId: id, TaskTitle: title, ActionId: id, OperationKind: "task.approve",
                    Summary: $"Launch {provider} · {model}",
                    PayloadSha256: "-", Category: "task_launch", Reversible: true, ExpiresAt: 0,
                    Scope: cwd is { Length: > 0 } ? $"Working folder: {cwd}" : "No working folder (tool-free conversation)",
                    ProposedDiff: task.Json("prompt") ?? "",
                    ExpectedEffects: $"Runs {provider} · {model} ({(IsLocalLaunch(task) ? "local model on this computer" : "hosted or tool-capable route")})."));
            }
        }

        foreach (var mission in root.JsonObj("missions").JsonArr("missions"))
        {
            var mId = mission.Json("id");
            if (string.IsNullOrEmpty(mId)) continue;
            var mTitle = mission.Json("title") ?? "Mission";
            var mState = mission.Json("state") ?? "unknown";
            var progress = mission.JsonObj("progress");
            var row = new TaskRow(mId, $"[Mission] {mTitle}", mState.ToUpperInvariant(),
                Progress: progress.ValueKind == JsonValueKind.Object ? $"{progress.JsonLong("completed")}/{progress.JsonLong("total")} steps done" : null,
                CanCancel: mState is "draft" or "planning" or "waiting_for_approval" or "ready" or "running" or "waiting_for_user" or "verifying", Kind: "mission");
            (mState is "completed" or "failed" or "stopped" ? historyTasks : activeTasks).Add(row);

            if (mState == "waiting_for_approval")
            {
                var plan = string.Join("\n", mission.JsonArr("steps").Select(s => $"{s.JsonLong("index") + 1}. [{s.Json("role")}] {s.Json("objective")}"));
                approvals.Add(new PendingApprovalItem(
                    TaskId: mId, TaskTitle: mTitle, ActionId: mId, OperationKind: "mission.approve",
                    Summary: $"Multi-Agent Execution Plan: {mTitle}",
                    // The Host refuses the approval if the plan changed after this reference was reviewed.
                    PayloadSha256: mission.Json("planReference") ?? "-", Category: "agent_plan", Reversible: true, ExpiresAt: 0,
                    Scope: $"Mission {mId}",
                    ProposedDiff: $"Objective: {mission.Json("objective")}\n\nPlan:\n{plan}",
                    ExpectedEffects: "Approves this exact plan and starts it."));
            }

            foreach (var req in mission.JsonArr("requests"))
            {
                if (req.TryGetProperty("resolvedAt", out var resAt) && resAt.ValueKind != JsonValueKind.Null) continue;
                var reqId = req.Json("id");
                if (string.IsNullOrEmpty(reqId)) continue;
                var action = req.Json("action") ?? "operation";
                var reason = req.Json("reason") ?? "";
                var sha256 = "-";
                var diff = reason;
                var scope = $"Mission {mId} / Step {req.Json("stepId")}";
                var promo = req.JsonObj("promotion");
                var dOp = req.JsonObj("desktopOperation");
                if (promo.ValueKind == JsonValueKind.Object)
                {
                    sha256 = promo.Json("contentHash") ?? "-";
                    var dest = promo.Json("destination") ?? "";
                    diff = $"Staged Destination: {dest}\nSHA-256: {sha256}\n{reason}";
                    scope = $"Promote File: {dest}";
                }
                else if (dOp.ValueKind == JsonValueKind.Object)
                {
                    sha256 = dOp.Json("digest") ?? "-";
                    scope = dOp.Json("cwd") ?? scope;
                }
                approvals.Add(new PendingApprovalItem(
                    TaskId: mId, TaskTitle: mTitle, ActionId: reqId, OperationKind: action, Summary: reason,
                    PayloadSha256: sha256, Category: "consequential", Reversible: false, ExpiresAt: 0, Scope: scope, ProposedDiff: diff,
                    ExpectedEffects: $"Consequential {action} ({req.Json("risk") ?? "WRITE"} risk), answered once for this exact request."));
            }
        }

        var known = new HashSet<string>(activeTasks.Concat(historyTasks).Select(t => t.Id));
        foreach (var task in root.JsonObj("persistentTasks").JsonArr("tasks"))
        {
            var id = task.Json("id");
            if (string.IsNullOrEmpty(id) || !known.Add(id)) continue;
            if (task.JsonBool("corrupt"))
            {
                historyTasks.Add(new TaskRow(id, "Unreadable task record", "NEEDS ATTENTION", Error: task.Json("detail"), Kind: "ptask"));
                continue;
            }
            var title = task.Json("title") ?? "Task";
            var state = task.Json("state") ?? "UNKNOWN";
            var progress = task.JsonObj("progress");
            var row = new TaskRow(id, title, state,
                Progress: progress.ValueKind == JsonValueKind.Object ? $"{progress.JsonLong("done")}/{progress.JsonLong("total")} steps" : null,
                Model: string.Join(", ", task.JsonArr("models").Select(m => m.GetString())),
                Error: task.JsonObj("blocked").Json("detail") ?? task.JsonObj("failure").Json("detail"),
                CanCancel: state is "VALIDATED" or "AWAITING_APPROVAL" or "QUEUED" or "RUNNING" or "PAUSED" or "RESUMING",
                CanPause: state is "RUNNING" or "RESUMING", CanResume: state is "PAUSED", Kind: "ptask");
            (state is "COMPLETED" or "FAILED" or "CANCELLED" or "UNCERTAIN" ? historyTasks : activeTasks).Add(row);

            var pending = task.JsonObj("pendingAction");
            var actionId = pending.Json("actionId");
            var sha = pending.Json("payloadSha256");
            // Only a task that is actually waiting asks for a decision; a cancelled one may still carry its last action.
            if (state == "AWAITING_APPROVAL" && actionId != null && sha != null)
            {
                approvals.Add(new PendingApprovalItem(
                    TaskId: id, TaskTitle: title, ActionId: actionId, OperationKind: pending.Json("kind") ?? "action",
                    Summary: pending.Json("summary") ?? "",
                    PayloadSha256: sha,
                    // Not "consequential": that category answers mission requests via mission.respond.
                    Category: "action", Reversible: pending.JsonBool("reversible"), ExpiresAt: pending.JsonLong("expiresAt"),
                    Scope: "Loading the Host's exact grants…",
                    ProposedDiff: $"{pending.Json("summary")}\nTarget: {pending.Json("target")}",
                    ExpectedEffects: string.Join(" ", pending.JsonArr("effects").Select(e => e.GetString()))));
            }
        }

        rebinding = true;
        try
        {
            SetItems(ActiveTasksList, activeTasks, r => r.Id);
            SetItems(TaskHistoryList, historyTasks, r => r.Id);
            currentApprovals = approvals;
            SetItems(PendingApprovalsList, approvals, a => a.Key);
        }
        finally { rebinding = false; }
        UpdateTaskButtons();
        UpdateHistoryButtons();
        RenderMissionSteps();
        RenderApprovalDetails();
    }

    private void ApplyAgents(JsonElement root)
    {
        var chips = new (TextBlock text, Border chip, TextBlock detail)[]
        {
            (GadaStatusText, GadaStatusChip, GadaDetailText), (SpearStatusText, SpearStatusChip, SpearDetailText),
            (ChakraStatusText, ChakraStatusChip, ChakraDetailText), (SwordStatusText, SwordStatusChip, SwordDetailText),
        };
        foreach (var s in root.JsonObj("personalAgents").JsonArr("slots"))
        {
            var slot = (int)s.JsonLong("slot");
            if (slot is < 1 or > 4) continue;
            var (text, chip, detail) = chips[slot - 1];
            var presentation = s.JsonObj("presentation");
            var state = presentation.Json("state") ?? "UNKNOWN";
            var agent = s.JsonObj("agent");
            text.Text = state.Replace('_', ' ');
            chip.Background = WorkingPresentation.Contains(state) ? (SolidColorBrush)FindResource("PositiveBrush")
                : WaitingPresentation.Contains(state) ? (SolidColorBrush)FindResource("WarningBrush")
                : state == "FAILED" ? (SolidColorBrush)FindResource("NegativeBrush")
                : new SolidColorBrush(Color.FromRgb(38, 52, 80));
            detail.Text = agent.ValueKind == JsonValueKind.Object
                ? $"{presentation.Json("label")}{(agent.Json("missionTitle") is { Length: > 0 } m ? $" · {m}" : "")}"
                : "No Agent bound to this slot";
        }
    }

    private void ApplyProjects(JsonElement root)
    {
        var projects = root.JsonArr("projects")
            .Where(p => p.Json("id") is { Length: > 0 })
            .Select(p => new ProjectItem(p.Json("id")!, p.Json("name") ?? p.Json("id")!, p.Json("path") ?? "", p.JsonLong("createdAt"), 0))
            .ToList();
        SetItems(ProjectsList, projects, p => p.Id);
    }

    private void ApplyLotus(JsonElement root)
    {
        var memories = root.JsonObj("lotus").JsonArr("memories")
            .Where(m => m.Json("id") is { Length: > 0 })
            .Select(m => new LotusMemoryRow(m.Json("id")!, m.Json("scope") ?? "", m.Json("layer") ?? "", m.Json("key") ?? "", m.Json("value") ?? "",
                m.Json("trust") ?? "", m.Json("provenance") ?? "", m.JsonLong("updatedAt")))
            .ToList();
        SetItems(LotusMemoriesList, memories, m => m.Id);
    }

    private void ApplyModels(JsonElement root)
    {
        var models = new List<ModelItem>();
        foreach (var p in root.JsonArr("providers"))
        {
            var pId = p.Json("id") ?? "";
            var local = p.Json("local_or_cloud") == "local";
            var availability = p.Json("availability") ?? "unknown";
            var remote = new HashSet<string>(p.JsonArr("remoteModels").Select(m => m.GetString() ?? ""));
            foreach (var pm in p.JsonArr("models"))
            {
                var name = pm.GetString() ?? "";
                if (name.Length == 0 || models.Any(x => x.Id == name)) continue;
                var isLocal = local && !remote.Contains(name) && !IsCloudTag(name);
                var where = isLocal ? "local" : remote.Contains(name) || IsCloudTag(name) ? "Ollama cloud (hosted)" : "hosted";
                models.Add(new ModelItem(name, name, pId, availability is "ready" or "busy", false, $"{pId} · {where} · {availability}", isLocal));
            }
        }
        SetItems(ModelsList, models, m => m.Id);
        chatModels = models;
        RebuildChatModels();
    }

    private void RebuildChatModels()
    {
        var localOnly = LocalOnlyCheck.IsChecked == true;
        var options = new[] { "Auto" }.Concat(chatModels.Where(m => !localOnly || m.IsLocal).Select(m => m.Id)).ToList();
        var signature = string.Join("|", options);
        if (signature == chatModelSignature) return;
        chatModelSignature = signature;
        var previous = ChatModelCombo.SelectedItem as string;
        ChatModelCombo.ItemsSource = options;
        // R1R2: default to Host routing; silently pinning models[0] sent chats to whatever listed first.
        ChatModelCombo.SelectedItem = previous != null && options.Contains(previous) ? previous : "Auto";
    }

    // Checked/Unchecked, not Click: keyboard and UI Automation toggles must refilter the picker too.
    private void LocalOnly_Changed(object sender, RoutedEventArgs e) { if (IsLoaded) RebuildChatModels(); }

    private void ApplyDevices(JsonElement root)
    {
        var devices = root.JsonArr("devices")
            .Where(d => d.Json("id") is { Length: > 0 })
            .Select(d => new DeviceItem(d.Json("id")!, d.Json("name") ?? "Companion Phone", d.JsonLong("createdAt"), d.JsonBool("revoked")))
            .ToList();
        SetItems(PairedDevicesList, devices, d => d.Id);
    }

    private void ApplyVoice(JsonElement root)
    {
        var voice = root.JsonObj("voice");
        var open = voice.JsonBool("open");
        var state = voice.Json("state") ?? "IDLE";
        var muted = voice.JsonBool("muted");
        VoiceSessionButton.Content = open ? "🎙️ Close Voice Session" : "🎙️ Open Voice Session";
        VoiceSessionButton.IsEnabled = voice.ValueKind == JsonValueKind.Object;
        VoiceStateText.Text = voice.ValueKind != JsonValueKind.Object ? "Voice: not available from this Host"
            : open ? $"Voice: {state.Replace('_', ' ')}{(voice.JsonBool("capturing") ? " · microphone open" : "")}{(voice.JsonBool("playing") ? " · speaking" : "")}"
            : "Voice: no session (microphone closed)";
        ListenStartButton.IsEnabled = open && !muted && state is "IDLE" or "INTERRUPTED" or "ERROR";
        ListenEndButton.IsEnabled = open && state is "ARMING" or "LISTENING";
        VoiceBargeInButton.IsEnabled = open && state is "SPEAKING" or "PROCESSING" or "TRANSCRIBING";
        VoiceMuteButton.IsEnabled = open;
        VoiceMuteButton.Content = muted ? "Unmute Mic" : "Mute Mic";

        var devices = voice.JsonObj("devices");
        static string Endpoint(JsonElement d) => d.ValueKind != JsonValueKind.Object ? "Not reported"
            : !d.JsonBool("present") ? "No device present" : $"{d.Json("name") ?? "Default device"}{(d.JsonBool("muted") ? " (muted in Windows)" : "")}";
        VoiceInputText.Text = Endpoint(devices.JsonObj("input")) + (devices.Json("micPrivacy") == "deny" ? " · blocked by Windows privacy settings" : "");
        VoiceOutputText.Text = Endpoint(devices.JsonObj("output"));

        // Only what the Host reports: the final transcript, its answer and errors. Nothing is narrated locally.
        var line = string.Join("\n", new[]
        {
            voice.Json("finalTranscript") is { Length: > 0 } t ? $"You: {t}" : null,
            voice.Json("answer") is { Length: > 0 } a ? $"Bunny ({voice.Json("answerSource")}): {a}" : null,
            voice.JsonObj("error").Json("message") is { Length: > 0 } err ? $"[Voice error] {err}" : null,
        }.Where(x => x != null));
        if (line.Length > 0 && line != lastVoiceLine)
        {
            lastVoiceLine = line;
            VoiceTranscriptBox.AppendText($"\n{DateTime.Now:T}\n{line}\n");
            VoiceTranscriptBox.ScrollToEnd();
        }
    }

    // Checked/Unchecked fire for mouse, keyboard and screen-reader toggles alike; this suppresses the Host's own updates.
    private bool applyingSettings;

    private void ApplySettings(JsonElement root)
    {
        applyingSettings = true;
        try { ApplySettingsCore(root); }
        finally { applyingSettings = false; }
    }

    private void ApplySettingsCore(JsonElement root)
    {
        var thermal = root.JsonObj("thermal");
        if (thermal.ValueKind == JsonValueKind.Object && thermal.TryGetProperty("cpuWarn", out var cpu) && thermal.TryGetProperty("gpuWarn", out var gpu))
        {
            thermalWarn = (cpu.GetDouble(), gpu.GetDouble());
            AutoStopThermalCheck.IsChecked = thermal.JsonBool("autoStop");
            AutoStopThermalCheck.IsEnabled = true;
            ThermalPolicyText.Text = $"Host policy: warn at CPU {cpu.GetDouble():0} °C, GPU {gpu.GetDouble():0} °C.";
        }
        var missions = root.JsonObj("missions");
        MissionsEnabledCheck.IsEnabled = missions.ValueKind == JsonValueKind.Object;
        MissionsEnabledCheck.IsChecked = missions.JsonBool("enabled");
        taskPolicy = root.JsonObj("persistentTasks").JsonObj("policy");
        ResumeOnStartCheck.IsEnabled = taskPolicy.ValueKind == JsonValueKind.Object;
        ResumeOnStartCheck.IsChecked = taskPolicy.JsonBool("resumeOnStart");
    }

    // ==========================================
    // COMMANDS
    // ==========================================

    /// <summary>One Host command, never retried; failures are shown and the view is refreshed either way.</summary>
    private async Task<JsonElement?> RunCommandAsync(string action, object data, string failTitle)
    {
        try
        {
            return await hostClient.SendCommandAsync(action, data, lifetime.Token);
        }
        catch (HostException ex) when (ex.Kind == HostFailure.OutcomeUnknown)
        {
            Warn(failTitle, await hostClient.ResolveOutcomeAsync(ex, lifetime.Token));
        }
        catch (HostException ex)
        {
            Warn(failTitle, ex.Message);
        }
        catch (OperationCanceledException) { }
        finally
        {
            await RefreshAllStateAsync(force: true);
        }
        return null;
    }

    private void Warn(string title, string message)
    {
        if (!isClosed) MessageBox.Show(this, message, title, MessageBoxButton.OK, MessageBoxImage.Warning);
    }

    private bool Confirm(string title, string message) =>
        MessageBox.Show(this, message, title, MessageBoxButton.YesNo, MessageBoxImage.Question, MessageBoxResult.No) == MessageBoxResult.Yes;

    /// <summary>Stops one item with the single command its kind accepts; nothing guesses between command families.</summary>
    public async Task StopItemAsync(string kind, string id, string reason)
    {
        _ = kind switch
        {
            "mission" => await RunCommandAsync("mission.stop", new { id }, "Stop Failed"),
            "ptask" => await RunCommandAsync("ptask.cancel", new { id }, "Cancel Failed"),
            _ => await RunCommandAsync("stop", new { id, reason }, "Stop Failed"),
        };
    }

    // ==========================================
    // CHAT & CONVERSATION
    // ==========================================

    private void Speaker_Changed(object sender, RoutedEventArgs e)
    {
        if (RadioSpeakerGada?.IsChecked == true) selectedSpeakerSlot = 1;
        else if (RadioSpeakerSpear?.IsChecked == true) selectedSpeakerSlot = 2;
        else if (RadioSpeakerChakra?.IsChecked == true) selectedSpeakerSlot = 3;
        else if (RadioSpeakerSword?.IsChecked == true) selectedSpeakerSlot = 4;
        else selectedSpeakerSlot = 0;
    }

    private void NewChat_Click(object sender, RoutedEventArgs e)
    {
        chatMessages.Clear();
        ChatHistoryList.ItemsSource = null;
        PromptInput.Clear();
    }

    private void PromptInput_KeyDown(object sender, KeyEventArgs e)
    {
        if (e.Key == Key.Enter && !Keyboard.IsKeyDown(Key.LeftShift) && !Keyboard.IsKeyDown(Key.RightShift))
        {
            e.Handled = true;
            SendPrompt();
        }
    }

    private void SendPrompt_Click(object sender, RoutedEventArgs e) => SendPrompt();

    private void AddChatMessage(ChatMessage message)
    {
        chatMessages.Add(message);
        ChatHistoryList.ItemsSource = chatMessages.ToList();
        ChatHistoryList.ScrollIntoView(message);
    }

    private void UpdateChatMessage(string id, string text, string status, string? model = null)
    {
        var i = chatMessages.FindIndex(m => m.Id == id);
        if (i < 0) return;
        chatMessages[i] = chatMessages[i] with { Text = text, Status = status, Model = model ?? chatMessages[i].Model };
        ChatHistoryList.ItemsSource = chatMessages.ToList();
        ChatHistoryList.ScrollIntoView(chatMessages[i]);
    }

    private static bool IsCloudTag(string model) =>
        model.EndsWith(":cloud", StringComparison.OrdinalIgnoreCase) || model.EndsWith("-cloud", StringComparison.OrdinalIgnoreCase);

    /// <summary>The Host's own rule for a tool-free local launch (device-authority deviceMayLaunch), checked before auto-starting a chat.</summary>
    private bool IsLocalLaunch(JsonElement task)
    {
        // Ollama is the Host's only tool-free provider, so the default working folder it records grants no tools.
        var model = task.Json("model") ?? "";
        if (task.Json("provider") != "ollama" || model.Length == 0 || IsCloudTag(model)) return false;
        var ollama = lastRoot.ValueKind == JsonValueKind.Object ? lastRoot.JsonArr("providers").FirstOrDefault(p => p.Json("id") == "ollama") : default;
        return !ollama.JsonArr("remoteModels").Any(m => m.GetString() == model);
    }

    private JsonElement? FindTask(string id) =>
        lastRoot.ValueKind == JsonValueKind.Object ? lastRoot.JsonArr("tasks").Where(t => t.Json("id") == id).Cast<JsonElement?>().FirstOrDefault() : null;

    private async void SendPrompt()
    {
        var prompt = PromptInput.Text.Trim();
        if (string.IsNullOrEmpty(prompt) || !SendButton.IsEnabled) return;
        if (!hostClient.IsConnected)
        {
            AddChatMessage(new ChatMessage(Guid.NewGuid().ToString(), "Bunny", "Not connected to the Host. Your message was not sent.", false, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Status: "Offline"));
            return;
        }

        PromptInput.Clear();
        SendButton.IsEnabled = false;
        AddChatMessage(new ChatMessage(Guid.NewGuid().ToString(), "You", prompt, true, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds()));
        var aiMsgId = Guid.NewGuid().ToString();
        try
        {
            if (selectedSpeakerSlot == 0) await RunBunnyChatAsync(prompt, aiMsgId);
            else await RunAgentChatAsync(prompt, aiMsgId);
        }
        finally
        {
            activeInferenceTaskId = null;
            SendButton.IsEnabled = true;
            StopButton.IsEnabled = false;
        }
    }

    private async Task RunBunnyChatAsync(string prompt, string aiMsgId)
    {
        var model = ChatModelCombo.SelectedItem as string;
        if (model == "Auto") model = null;
        var selectedProvider = model == null ? null : chatModels.FirstOrDefault(m => m.Id == model)?.Provider;
        var localOnly = LocalOnlyCheck.IsChecked == true;
        AddChatMessage(new ChatMessage(aiMsgId, "Bunny", "Submitting to the Host…", false, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Model: model ?? "Auto", Status: "Submitting"));
        hostRestartedDuringChat = false;

        try
        {
            // The Host enforces local/offline-only at routing, launch and failover; it refuses rather than substitutes.
            var submit = new Dictionary<string, object?>
            {
                ["prompt"] = prompt,
                ["mode"] = "fast",
                ["override"] = selectedProvider ?? "auto",
                ["modelOverride"] = model,
            };
            if (localOnly) submit["constraints"] = new { localOnly = true, offlineOnly = true };
            var res = await hostClient.SendCommandAsync("submit", submit, lifetime.Token);
            var taskObj = res.JsonObj("task");
            var taskId = taskObj.Json("id");
            if (taskId == null)
            {
                UpdateChatMessage(aiMsgId, "The Host did not create a task for this message.", "Refused", model);
                return;
            }
            activeInferenceTaskId = taskId;
            StopButton.IsEnabled = true;

            if (taskObj.Json("state") == "waiting_for_approval")
            {
                if (IsLocalLaunch(taskObj))
                {
                    // Sending a chat is consent to run it on this computer's local model, tool-free. Anything else is reviewed.
                    await hostClient.SendCommandAsync("approve", new { id = taskId }, lifetime.Token);
                    UpdateChatMessage(aiMsgId, "Running on the local model…", "Running", $"{taskObj.Json("provider")} · {taskObj.Json("model")}");
                }
                else
                {
                    UpdateChatMessage(aiMsgId, $"The Host routed this chat to {taskObj.Json("provider")} · {taskObj.Json("model")}, which is not a local tool-free model. It waits for you in the Approval Center.",
                        "Awaiting approval", $"{taskObj.Json("provider")} · {taskObj.Json("model")}");
                }
            }

            var started = DateTime.UtcNow;
            var lastState = "";
            while (!lifetime.Token.IsCancellationRequested)
            {
                await Task.Delay(hostClient.EventsConnected ? 750 : 500, lifetime.Token);
                var fresh = await RefreshAllStateAsync(force: true);
                var elapsed = DateTime.UtcNow - started;
                var limit = lastState == "waiting_for_approval" ? TimeSpan.FromMinutes(10) : TimeSpan.FromMinutes(3);
                if (elapsed > limit)
                {
                    UpdateChatMessage(aiMsgId, $"No result after {elapsed.TotalSeconds:0} s. The task is still on the Host and was not stopped; see Agent Dashboard.", "Timeout", model);
                    return;
                }
                if (!fresh)
                {
                    UpdateChatMessage(aiMsgId, "Reconnecting to the Host…", "Reconnecting", model);
                    continue;
                }
                if (FindTask(taskId) is not JsonElement t)
                {
                    UpdateChatMessage(aiMsgId, "The Host no longer lists this task.", "Unknown", model);
                    return;
                }

                var curState = t.Json("state") ?? "";
                lastState = curState;
                var providerUsed = t.Json("provider");
                var served = t.JsonObj("servedModel");
                var digest = served.Json("digest");
                var modelLine = $"{providerUsed} · {t.Json("model")}{(digest is { Length: > 12 } ? $" · digest {digest[..19]}" : "")}";
                var restarted = hostRestartedDuringChat ? " (The Host restarted during this request.)" : "";

                // Defence in depth: a pinned local chat never shows an answer from a different provider.
                if (selectedProvider != null && providerUsed != null && providerUsed != selectedProvider)
                {
                    await hostClient.SendCommandAsync("stop", new { id = taskId, reason = "Route changed from the selected provider." }, lifetime.Token);
                    UpdateChatMessage(aiMsgId, $"Refused: the Host routed this chat to {providerUsed}, not the selected {selectedProvider}.", "Refused", modelLine);
                    return;
                }

                switch (curState)
                {
                    case "completed":
                        var output = t.Json("output") ?? "";
                        var usage = t.JsonObj("usage");
                        var usageInfo = usage.ValueKind == JsonValueKind.Object ? $" · {usage.JsonLong("inputTokens")} in / {usage.JsonLong("outputTokens")} out" : "";
                        UpdateChatMessage(aiMsgId, (string.IsNullOrEmpty(output) ? "(The model completed with empty output.)" : output) + restarted, "Completed", modelLine + usageInfo);
                        return;
                    case "failed":
                        UpdateChatMessage(aiMsgId, $"Failed: {t.Json("error") ?? "the task failed."}{restarted}", "Failed", modelLine);
                        return;
                    case "stopped":
                        UpdateChatMessage(aiMsgId, $"Stopped.{restarted}", "Cancelled", modelLine);
                        return;
                    case "running":
                        UpdateChatMessage(aiMsgId, $"{t.Json("model")} is generating ({elapsed.TotalSeconds:0} s)…{restarted}", "Generating", modelLine);
                        break;
                    case "waiting_for_approval":
                        UpdateChatMessage(aiMsgId, "Waiting for your review in the Approval Center.", "Awaiting approval", modelLine);
                        break;
                    default:
                        UpdateChatMessage(aiMsgId, $"Host state: {curState}…", curState, modelLine);
                        break;
                }
            }
        }
        catch (OperationCanceledException)
        {
            UpdateChatMessage(aiMsgId, "Cancelled.", "Cancelled", model);
        }
        catch (HostException ex) when (ex.Kind == HostFailure.OutcomeUnknown)
        {
            UpdateChatMessage(aiMsgId, await hostClient.ResolveOutcomeAsync(ex, lifetime.Token), "Uncertain", model);
        }
        catch (HostException ex) when (ex.Kind == HostFailure.Failed)
        {
            UpdateChatMessage(aiMsgId, ex.Message, "Failed", model);
        }
        catch (HostException ex)
        {
            UpdateChatMessage(aiMsgId, $"Host refused: {ex.Message}", "Refused", model);
        }
    }

    private async Task RunAgentChatAsync(string prompt, string aiMsgId)
    {
        var agentName = selectedSpeakerSlot switch { 1 => "Gada", 2 => "Spear", 3 => "Vishnu Chakra", 4 => "Sword", _ => "Agent" };
        AddChatMessage(new ChatMessage(aiMsgId, agentName, "Asking the Host…", false, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
            Model: $"Personal Agent (Slot {selectedSpeakerSlot})", Status: "Querying"));
        try
        {
            var res = await hostClient.SendCommandAsync("personal_agent.converse", new { slot = selectedSpeakerSlot, text = prompt }, lifetime.Token);
            var reply = res.JsonObj("data").JsonObj("reply").Json("text") ?? res.JsonObj("reply").Json("text") ?? "The Host returned no reply.";
            UpdateChatMessage(aiMsgId, reply, "Answered", $"Personal Agent (Slot {selectedSpeakerSlot})");
        }
        catch (HostException ex) when (ex.Kind == HostFailure.OutcomeUnknown)
        {
            UpdateChatMessage(aiMsgId, await hostClient.ResolveOutcomeAsync(ex, lifetime.Token), "Uncertain");
        }
        catch (HostException ex)
        {
            UpdateChatMessage(aiMsgId, $"Agent error: {ex.Message}", "Error");
        }
        catch (OperationCanceledException) { }
    }

    private async void StopInference_Click(object sender, RoutedEventArgs e)
    {
        if (activeInferenceTaskId is { } id) await StopItemAsync("orch", id, "User cancelled inference from native UI.");
    }

    private async void DelegatePrompt_Click(object sender, RoutedEventArgs e)
    {
        var prompt = PromptInput.Text.Trim();
        if (string.IsNullOrEmpty(prompt)) return;
        DelegateButton.IsEnabled = false;
        try
        {
            var res = await RunCommandAsync("mission.create", new { objective = prompt, mode = "fast", localOnly = LocalOnlyCheck.IsChecked == true }, "Delegation Failed");
            if (res is not JsonElement r) return;
            PromptInput.Clear();
            var mission = r.JsonObj("mission");
            AddChatMessage(new ChatMessage(Guid.NewGuid().ToString(), "Agent Coordinator",
                $"Mission {mission.Json("id")} created ({mission.Json("state")}). Its plan appears in the Approval Center when the Host asks you to review it.",
                false, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Model: "Mission"));
            SelectTab("Agents");
        }
        finally { DelegateButton.IsEnabled = true; }
    }

    private void CopyMessage_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string text) Clipboard.SetText(text);
    }

    // ==========================================
    // AGENT DASHBOARD & TASKS
    // ==========================================

    private void ActiveTasksList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        UpdateTaskButtons();
        if (!rebinding) RenderMissionSteps();
    }

    private void UpdateTaskButtons()
    {
        var row = ActiveTasksList.SelectedItem as TaskRow;
        CancelActiveTaskButton.IsEnabled = row?.CanCancel == true;
        PauseTaskButton.IsEnabled = row is { Kind: "ptask", CanPause: true };
        ResumeTaskButton.IsEnabled = row is { Kind: "ptask", CanResume: true };
        RunWithAgentsButton.IsEnabled = row is { Kind: "mission", State: "WAITING_FOR_APPROVAL" };
    }

    private void RenderMissionSteps()
    {
        if (ActiveTasksList.SelectedItem is not TaskRow { Kind: "mission" } row || lastRoot.ValueKind != JsonValueKind.Object)
        {
            MissionStepsHeader.Text = "Select a Mission to see its Host-reported steps.";
            MissionStepsList.ItemsSource = null;
            return;
        }
        var mission = lastRoot.JsonObj("missions").JsonArr("missions").FirstOrDefault(m => m.Json("id") == row.Id);
        var steps = mission.JsonArr("steps").Select(s =>
        {
            var result = s.JsonObj("result");
            var flag = result.ValueKind == JsonValueKind.Object && result.TryGetProperty("verified", out var v) ? v.ValueKind : JsonValueKind.Undefined;
            var verified = result.ValueKind != JsonValueKind.Object ? null
                : flag == JsonValueKind.True ? "Host-verified" : flag == JsonValueKind.False ? "verification failed" : "not verified";
            var task = s.Json("taskId") is { } tid ? FindTask(tid) : null;
            return new StepRow(s.Json("id") ?? "", $"Step {s.JsonLong("index") + 1}", (s.Json("state") ?? "unknown").ToUpperInvariant(), s.Json("role"),
                task is JsonElement t ? $"{t.Json("provider")} · {t.Json("model")}" : null,
                null, result.Json("summary") ?? s.Json("objective"), verified);
        }).ToList();
        MissionStepsHeader.Text = $"Steps of “{row.Title}” — states as the Host reports them" + (row.Progress is { } p ? $" ({p})" : "");
        MissionStepsList.ItemsSource = steps;
    }

    private void RunWithAgents_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is not TaskRow { Kind: "mission" } row) return;
        // A plan is approved only after its exact steps and reference are shown; this button opens that review.
        SelectTab("Approvals");
        PendingApprovalsList.SelectedItem = currentApprovals.FirstOrDefault(a => a.Category == "agent_plan" && a.TaskId == row.Id);
    }

    private async void CancelSelectedTask_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow { CanCancel: true } row)
            await StopItemAsync(row.Kind, row.Id, "User cancelled task from native UI.");
    }

    private async void PauseSelectedTask_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow { Kind: "ptask", CanPause: true } row)
            await RunCommandAsync("ptask.pause", new { id = row.Id }, "Pause Failed");
    }

    private async void ResumeSelectedTask_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow { Kind: "ptask", CanResume: true } row)
            await RunCommandAsync("ptask.resume", new { id = row.Id }, "Resume Failed");
    }

    // ==========================================
    // APPROVAL CENTER (workstation only)
    // ==========================================

    private void PendingApprovalsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (rebinding) return;
        RenderApprovalDetails();
    }

    private void RenderApprovalDetails()
    {
        if (PendingApprovalsList.SelectedItem is not PendingApprovalItem app)
        {
            ApprovalOpKind.Text = "Operation: -";
            ApprovalTaskTitle.Text = currentApprovals.Count == 0 ? "No pending approvals." : "Select a request to review it.";
            ApprovalScopeText.Text = ApprovalPayloadShaText.Text = ApprovalEffectsText.Text = ApprovalContextText.Text = "-";
            ApprovalDiffText.Text = "Select an approval request to inspect.";
            UpdateApprovalButtons();
            return;
        }
        ApprovalOpKind.Text = $"Operation: {app.OperationKind}";
        ApprovalTaskTitle.Text = $"{app.TaskTitle} ({app.TaskId})";
        ApprovalScopeText.Text = app.Scope;
        ApprovalPayloadShaText.Text = app.PayloadSha256 != "-" ? app.PayloadSha256
            : app.Category == "task_launch" ? "No payload digest: the Host binds this launch to the task id and its current state."
            : "No digest supplied by the Host.";
        ApprovalEffectsText.Text = app.ExpectedEffects;
        ApprovalDiffText.Text = app.ProposedDiff;
        ApprovalContextText.Text = app.Category switch
        {
            "agent_plan" => "Bound to the plan reference above; a re-planned Mission is refused until reviewed again.",
            "consequential" => "Answers this one request once; a new request needs a new decision.",
            "task_launch" => "Launch only; the task can be stopped from the Agent Dashboard.",
            _ => "Loading the Host's recovery rule…",
        };
        if (app.Category == "action")
        {
            if (inspected.TryGetValue(app.Key, out var facts))
            {
                ApprovalScopeText.Text = facts.scope;
                ApprovalEffectsText.Text = facts.effects;
                ApprovalContextText.Text = facts.context;
            }
            else _ = InspectActionAsync(app);
        }
        UpdateApprovalButtons();
    }

    private async Task InspectActionAsync(PendingApprovalItem app)
    {
        inspected[app.Key] = (false, "Loading the Host's exact grants…", app.ExpectedEffects, "Loading…");
        try
        {
            var res = await hostClient.SendCommandAsync("action.inspect", new { id = app.TaskId, actionId = app.ActionId }, lifetime.Token);
            var data = res.JsonObj("data");
            var action = data.JsonObj("action");
            var ctx = data.JsonObj("context");
            if (ctx.ValueKind != JsonValueKind.Object || action.Json("payloadSha256") != app.PayloadSha256)
            {
                inspected[app.Key] = (false, "The Host no longer has this exact action pending.", app.ExpectedEffects, "Approval is unavailable; review the current request.");
            }
            else
            {
                var scope = string.Join("\n", ctx.JsonArr("scope").Select(s => s.GetString()));
                var expires = ctx.JsonLong("approvalExpiresAt");
                inspected[app.Key] = (true,
                    scope.Length > 0 ? scope : "No folder, website or account grants.",
                    $"{ctx.Json("sideEffect")}. {ctx.Json("expected")}",
                    $"{ctx.Json("role")} · {ctx.Json("step")}. {ctx.Json("recovery")}" +
                    (expires > 0 ? $" Approval window ends {DateTimeOffset.FromUnixTimeMilliseconds(expires).LocalDateTime:T}." : "") +
                    $" {data.JsonArr("receipts").Count()} prior receipt(s) for this task.");
            }
        }
        catch (Exception ex) when (ex is HostException or OperationCanceledException)
        {
            // Without the Host's exact context the action cannot be approved here.
            inspected[app.Key] = (false, $"The Host's context is unavailable: {ex.Message}", app.ExpectedEffects, "Approval is unavailable until the Host answers.");
        }
        if ((PendingApprovalsList.SelectedItem as PendingApprovalItem)?.Key == app.Key) RenderApprovalDetails();
    }

    private void UpdateApprovalButtons()
    {
        var app = PendingApprovalsList.SelectedItem as PendingApprovalItem;
        var reviewable = app != null && hostClient.IsConnected && app.Category switch
        {
            "action" => inspected.TryGetValue(app.Key, out var f) && f.ok,
            "agent_plan" => app.PayloadSha256 != "-",
            _ => true,
        };
        ApproveActionButton.IsEnabled = reviewable;
        DenyActionButton.IsEnabled = app != null && hostClient.IsConnected;
    }

    private void RecordDecision(string line)
    {
        decisions.Insert(0, $"{DateTime.Now:T}  {line}");
        if (decisions.Count > 20) decisions.RemoveAt(decisions.Count - 1);
        ApprovalReceiptText.Text = string.Join("\n", decisions);
    }

    private static string Short(string digest) => digest.Length > 16 ? digest[..16] + "…" : digest;

    private async Task DecideAsync(bool approve)
    {
        if (PendingApprovalsList.SelectedItem is not PendingApprovalItem app) return;
        ApproveActionButton.IsEnabled = DenyActionButton.IsEnabled = false;
        var verb = approve ? "APPROVED" : "DENIED";
        try
        {
            if (approve)
            {
                // Fail closed unless the exact reviewed request is still pending on the same Host epoch.
                var epoch = hostClient.HostEpoch;
                if (!await RefreshAllStateAsync(force: true) || hostClient.HostEpoch != epoch || currentApprovals.All(a => a.Key != app.Key))
                {
                    RecordDecision($"NOT SENT · {app.OperationKind} · {app.TaskTitle}: it changed, ended or the Host restarted after you reviewed it.");
                    Warn("Approval Not Sent", "This request changed, is no longer pending, or the Host restarted after you reviewed it. Nothing was approved; review the current request.");
                    return;
                }
            }
            (string Action, object Data) cmd = (app.Category, approve) switch
            {
                ("agent_plan", true) => ("mission.approve", new { id = app.TaskId, start = true, plan = app.PayloadSha256 }),
                ("agent_plan", false) => ("mission.stop", new { id = app.TaskId }),
                ("task_launch", true) => ("approve", new { id = app.TaskId }),
                ("task_launch", false) => ("stop", new { id = app.TaskId, reason = "User denied task approval." }),
                ("consequential", _) => ("mission.respond", new { requestId = app.ActionId, decision = approve ? "allow_once" : "deny" }),
                (_, true) => ("action.approve", new { id = app.TaskId, actionId = app.ActionId, payloadSha256 = app.PayloadSha256 }),
                (_, false) => ("action.deny", new { id = app.TaskId, actionId = app.ActionId }),
            };
            var res = await hostClient.SendCommandAsync(cmd.Action, cmd.Data, lifetime.Token);
            var op = res.JsonObj("operation");
            RecordDecision($"{verb} · {app.OperationKind} · {app.TaskTitle} · digest {Short(app.PayloadSha256)} · Host operation {op.Json("id")} {op.Json("state")}");
        }
        catch (HostException ex) when (ex.Kind == HostFailure.OutcomeUnknown)
        {
            var outcome = await hostClient.ResolveOutcomeAsync(ex, lifetime.Token);
            RecordDecision($"UNCERTAIN · {app.OperationKind} · {app.TaskTitle}: {outcome}");
            Warn("Decision Outcome Uncertain", outcome);
        }
        catch (HostException ex) when (ex.Kind == HostFailure.Failed)
        {
            RecordDecision($"FAILED, MAY HAVE PARTLY APPLIED · {app.OperationKind} · {app.TaskTitle} · Host operation {ex.OperationId}: {ex.Message}");
            Warn("Decision Failed", ex.Message);
        }
        catch (HostException ex)
        {
            RecordDecision($"REFUSED BY HOST · {app.OperationKind} · {app.TaskTitle}: {ex.Message}");
            Warn(approve ? "Approval Refused" : "Denial Refused", ex.Message);
        }
        catch (OperationCanceledException) { }
        finally
        {
            inspected.Remove(app.Key);
            await RefreshAllStateAsync(force: true);
            UpdateApprovalButtons();
        }
    }

    private async void ApproveAction_Click(object sender, RoutedEventArgs e) => await DecideAsync(approve: true);
    private async void DenyAction_Click(object sender, RoutedEventArgs e) => await DecideAsync(approve: false);

    // ==========================================
    // VOICE STUDIO
    // ==========================================

    private JsonElement Voice => lastRoot.ValueKind == JsonValueKind.Object ? lastRoot.JsonObj("voice") : default;

    private async void ToggleVoiceSession_Click(object sender, RoutedEventArgs e)
    {
        if (Voice.JsonBool("open")) await RunCommandAsync("voice.session.close", new { source = "button" }, "Voice Session Error");
        else await RunCommandAsync("voice.session.open", new { mode = "push_to_talk" }, "Voice Session Error");
    }

    private async void VoiceListenStart_Click(object sender, RoutedEventArgs e) =>
        await RunCommandAsync("voice.listen.start", new { source = "button" }, "Listen Failed");

    private async void VoiceListenEnd_Click(object sender, RoutedEventArgs e) =>
        await RunCommandAsync("voice.listen.end", new { turnId = Voice.Json("inputTurnId") ?? Voice.Json("turnId") }, "Listen End Failed");

    private async void VoiceInterrupt_Click(object sender, RoutedEventArgs e) =>
        await RunCommandAsync("voice.interrupt", new { source = "button" }, "Interrupt Failed");

    private async void VoiceMute_Click(object sender, RoutedEventArgs e) =>
        await RunCommandAsync("voice.mute", new { muted = !Voice.JsonBool("muted") }, "Mute Failed");

    // ==========================================
    // PROJECTS & RECONCILIATION
    // ==========================================

    private void BrowseProjectFolder_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog { Title = "Select Project Root Folder" };
        if (dialog.ShowDialog() == true) NewProjectPathInput.Text = dialog.FolderName;
    }

    private async void RegisterProject_Click(object sender, RoutedEventArgs e)
    {
        var path = NewProjectPathInput.Text.Trim();
        if (string.IsNullOrEmpty(path)) return;
        var name = Path.GetFileName(path.TrimEnd('\\', '/'));
        if (string.IsNullOrEmpty(name)) name = "Project";

        JsonElement? res;
        if (Directory.Exists(path))
        {
            res = await RunCommandAsync("project.add", new { path, name, description = "Registered workspace folder" }, "Project Registration Failed");
        }
        else
        {
            // project.create makes a new folder; it needs the owner's explicit yes, never an implied one.
            if (!Confirm("Create New Project?", $"No folder exists at:\n{path}\n\nCreate a new, empty Bunny-owned project named “{name}” in the Host's project folder instead?")) return;
            res = await RunCommandAsync("project.create", new { name, confirmed = true }, "Project Creation Failed");
        }
        if (res != null) NewProjectPathInput.Clear();
    }

    private async void ProposeProjectMission_Click(object sender, RoutedEventArgs e)
    {
        var objective = ProjectMissionObjectiveInput.Text.Trim();
        if (string.IsNullOrEmpty(objective)) return;
        var projectId = (ProjectsList.SelectedItem as ProjectItem)?.Id;
        var res = await RunCommandAsync("mission.create", new { objective, mode = "fast", projectId, localOnly = LocalOnlyCheck.IsChecked == true }, "Proposal Error");
        if (res == null) return;
        ProjectMissionObjectiveInput.Clear();
        SelectTab("Agents");
    }

    private void TaskHistoryList_SelectionChanged(object sender, SelectionChangedEventArgs e) => UpdateHistoryButtons();

    private void UpdateHistoryButtons()
    {
        var uncertain = TaskHistoryList.SelectedItem is TaskRow { Kind: "ptask", State: "UNCERTAIN" };
        ReconcileHappenedButton.IsEnabled = ReconcileNotHappenedButton.IsEnabled = ReconcileAbandonButton.IsEnabled = uncertain;
    }

    private async void ReconcileHappened_Click(object sender, RoutedEventArgs e) => await ReconcileSelectedTask("happened", "You confirm the uncertain action did take effect; the task continues from after it.");
    private async void ReconcileNotHappened_Click(object sender, RoutedEventArgs e) => await ReconcileSelectedTask("not_happened", "You confirm the uncertain action did NOT take effect; the Host may run it again.");
    private async void ReconcileAbandon_Click(object sender, RoutedEventArgs e) => await ReconcileSelectedTask("abandon", "The task is abandoned and nothing more runs.");

    private async Task ReconcileSelectedTask(string decision, string meaning)
    {
        if (TaskHistoryList.SelectedItem is not TaskRow { Kind: "ptask", State: "UNCERTAIN" } row) return;
        if (!Confirm("Reconcile Uncertain Task", $"{row.Title}\n\n{meaning}\n\nContinue?")) return;
        await RunCommandAsync("ptask.reconcile", new { id = row.Id, decision }, "Reconcile Failed");
    }

    // ==========================================
    // LOTUS MEMORY
    // ==========================================

    private async void LotusRemember_Click(object sender, RoutedEventArgs e)
    {
        var key = LotusKeyInput.Text.Trim();
        var val = LotusValueInput.Text.Trim();
        var layer = (LotusLayerCombo.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "central";
        if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(val)) return;
        if (await RunCommandAsync("lotus.remember", new { scope = "central", layer, key, value = val, origin = "user" }, "Memory Save Failed") != null)
        {
            LotusKeyInput.Clear();
            LotusValueInput.Clear();
        }
    }

    private async void LotusRecall_Click(object sender, RoutedEventArgs e)
    {
        var query = LotusSearchInput.Text.Trim();
        if (string.IsNullOrEmpty(query)) return;
        if (await RunCommandAsync("lotus.recall", new { slot = 1, query }, "Recall Failed") is JsonElement res)
        {
            var text = res.TryGetProperty("data", out var d) ? JsonSerializer.Serialize(d, new JsonSerializerOptions { WriteIndented = true }) : "No recall data returned.";
            MessageBox.Show(this, text.Length > 4000 ? text[..4000] + "…" : text, "Lotus Recall", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    private async void LotusForget_Click(object sender, RoutedEventArgs e)
    {
        if (LotusMemoriesList.SelectedItem is LotusMemoryRow mem && Confirm("Forget Memory", $"Forget “{mem.Key}”?"))
            await RunCommandAsync("lotus.forget", new { id = mem.Id }, "Forget Failed");
    }

    // ==========================================
    // MODELS, DEVICES & SETTINGS
    // ==========================================

    private async void DiscoverModels_Click(object sender, RoutedEventArgs e) =>
        await RunCommandAsync("ma4.discover", new { }, "Discovery Failed");

    private async void TestModelConnection_Click(object sender, RoutedEventArgs e)
    {
        if (await RunCommandAsync("intelligence.test", new { }, "Test Failed") is not JsonElement res) return;
        var last = res.JsonObj("snapshot").JsonObj("intelligence").JsonObj("jev").JsonObj("lastTest");
        var message = last.ValueKind != JsonValueKind.Object ? "The Host reported no test result."
            : $"{(last.JsonBool("ok") ? "Connected" : "Not connected")}: {last.Json("detail")}";
        MessageBox.Show(this, message, "TypeSafe (hosted) Connection", MessageBoxButton.OK, last.JsonBool("ok") ? MessageBoxImage.Information : MessageBoxImage.Warning);
    }

    private async void GeneratePairingCode_Click(object sender, RoutedEventArgs e)
    {
        if (await RunCommandAsync("pairing.create", new { }, "Pairing Code Error") is not JsonElement res) return;
        PairingCodeDisplay.Text = res.Json("pairCode") is { Length: > 0 } code
            ? $"{code}   (one use, expires {DateTime.Now.AddMinutes(10):t})"
            : "The Host did not return a pairing code.";
    }

    private async void RevokeDevice_Click(object sender, RoutedEventArgs e)
    {
        if (PairedDevicesList.SelectedItem is not DeviceItem dev || dev.IsRevoked) return;
        if (!Confirm("Revoke Device", $"Revoke {dev.Name}? It loses access immediately and must pair again.")) return;
        await RunCommandAsync("device.revoke", new { id = dev.Id }, "Revoke Failed");
    }

    private async void AutoStopThermal_Click(object sender, RoutedEventArgs e)
    {
        if (applyingSettings || thermalWarn is not (double cpu, double gpu)) return;
        await RunCommandAsync("thermal.configure", new { cpuWarn = cpu, gpuWarn = gpu, autoStop = AutoStopThermalCheck.IsChecked == true }, "Thermal Policy Not Saved");
    }

    private async void ResumeOnStart_Click(object sender, RoutedEventArgs e)
    {
        if (applyingSettings || taskPolicy.ValueKind != JsonValueKind.Object) return;
        var policy = JsonSerializer.Deserialize<Dictionary<string, JsonElement>>(taskPolicy.GetRawText())!;
        var updated = policy.ToDictionary(kv => kv.Key, kv => (object)kv.Value);
        updated["resumeOnStart"] = ResumeOnStartCheck.IsChecked == true;
        await RunCommandAsync("ptask.policy", new { policy = updated }, "Task Policy Not Saved");
    }

    private async void MissionsEnabled_Click(object sender, RoutedEventArgs e)
    {
        if (!applyingSettings) await RunCommandAsync("mission.configure", new { enabled = MissionsEnabledCheck.IsChecked == true }, "Mission Setting Not Saved");
    }

    private bool syncingEdge;

    private void SyncNotchEdgeCombo(string edge)
    {
        syncingEdge = true;
        SettingsNotchEdgeCombo.SelectedItem = SettingsNotchEdgeCombo.Items.OfType<ComboBoxItem>().FirstOrDefault(i => (string)i.Content == edge);
        syncingEdge = false;
    }

    private void NotchEdgeCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (!syncingEdge && notchWindow != null && SettingsNotchEdgeCombo.SelectedItem is ComboBoxItem item)
            notchWindow.ApplyEdgePlacement(item.Content.ToString() ?? "Top");
    }
}
