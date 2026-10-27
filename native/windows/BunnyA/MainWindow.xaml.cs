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
    private readonly HostClient hostClient = new();
    private readonly DispatcherTimer refreshTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly CancellationTokenSource lifetime = new();
    private NotchWindow? notchWindow;

    private bool isBusy;
    private bool isClosed;
    private int selectedSpeakerSlot = 0; // 0 = Bunny, 1 = Gada, 2 = Spear, 3 = Chakra, 4 = Sword
    private string? activeInferenceTaskId;
    private readonly List<ChatMessage> chatMessages = new();
    private List<ModelItem> chatModels = new();
    private bool exiting;

    public MainWindow()
    {
        InitializeComponent();

        Loaded += async (_, _) =>
        {
            notchWindow = new NotchWindow(this, hostClient);
            notchWindow.Show();

            refreshTimer.Tick += async (_, _) => { if (!isBusy) await RefreshAllStateAsync(); };
            await RefreshAllStateAsync();
            if (!isClosed) refreshTimer.Start();
        };

        Closing += (_, e) =>
        {
            // Keep app running in tray/notch unless explicitly exiting
            if (exiting) return;
            e.Cancel = true;
            Hide();
        };

        Closed += (_, _) =>
        {
            isClosed = true;
            refreshTimer.Stop();
            lifetime.Cancel();
            hostClient.Dispose();
            lifetime.Dispose();
        };
    }

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
            }
        }
    }

    private void NavButton_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string tabName)
        {
            SelectTab(tabName);
        }
    }

    private void Quit_Click(object sender, RoutedEventArgs e)
    {
        // The only clean exit: closing the window just hides it to the notch.
        exiting = true;
        Application.Current.Shutdown(0);
    }

    private void ToggleNotch_Click(object sender, RoutedEventArgs e)
    {
        if (notchWindow == null)
        {
            notchWindow = new NotchWindow(this, hostClient);
        }

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

    private async void RefreshAll_Click(object sender, RoutedEventArgs e)
    {
        await RefreshAllStateAsync(force: true);
    }

    private async Task RefreshAllStateAsync(bool force = false)
    {
        if (isClosed || (isBusy && !force)) return;
        isBusy = true;

        try
        {
            var stateDoc = await hostClient.GetStateAsync(lifetime.Token);
            var root = stateDoc.RootElement;

            // Connection Capsule
            HostStatusDot.Fill = (SolidColorBrush)FindResource("PositiveBrush");
            HostStatusText.Text = "Connected to Workstation Host";
            HostEpochText.Text = $"Epoch: {hostClient.HostEpoch} · Host ID: {hostClient.HostId?[..Math.Min(8, hostClient.HostId?.Length ?? 0)]}…";

            // Push state snapshot to Notch
            notchWindow?.UpdateSnapshot(root);

            // 1. Process Tasks and Missions
            var activeTasks = new List<TaskRow>();
            var historyTasks = new List<TaskRow>();
            var pendingApprovals = new List<PendingApprovalItem>();

            // 1a. Process Host OrchTasks
            if (root.TryGetProperty("tasks", out var orchTasksArr) && orchTasksArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var task in orchTasksArr.EnumerateArray())
                {
                    var id = task.GetProperty("id").GetString() ?? "";
                    var title = task.TryGetProperty("title", out var tp) ? tp.GetString() ?? "Task" : "Task";
                    var state = task.GetProperty("state").GetString() ?? "UNKNOWN";
                    var provider = task.TryGetProperty("provider", out var prov) ? prov.GetString() : null;
                    var model = task.TryGetProperty("model", out var md) ? md.GetString() : null;
                    var error = task.TryGetProperty("error", out var er) ? er.GetString() : null;
                    var canCancel = state is "queued" or "routing" or "waiting_for_approval" or "running";

                    var row = new TaskRow(id, title, state.ToUpperInvariant(), Model: $"{provider} · {model}", Error: error, CanCancel: canCancel);

                    if (state is "completed" or "failed" or "stopped")
                    {
                        historyTasks.Add(row);
                    }
                    else
                    {
                        activeTasks.Add(row);
                    }

                    if (state == "waiting_for_approval")
                    {
                        pendingApprovals.Add(new PendingApprovalItem(
                            TaskId: id,
                            TaskTitle: title,
                            ActionId: id,
                            OperationKind: "task.approve",
                            Summary: $"Task Model Launch: {title}",
                            PayloadSha256: "-",
                            Category: "task_launch",
                            Reversible: true,
                            ExpiresAt: 0,
                            Scope: task.TryGetProperty("cwd", out var cwd) ? cwd.GetString() ?? "Local" : "Local",
                            ProposedDiff: task.TryGetProperty("prompt", out var pr) ? pr.GetString() ?? "" : "",
                            ExpectedEffects: $"Executes local model inference on {provider ?? "Ollama"}"
                        ));
                    }
                }
            }

            // 1b. Process Host Missions
            if (root.TryGetProperty("missions", out var missionsObj) &&
                missionsObj.TryGetProperty("missions", out var missionsArr) &&
                missionsArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var mission in missionsArr.EnumerateArray())
                {
                    var mId = mission.GetProperty("id").GetString() ?? "";
                    var mTitle = mission.TryGetProperty("title", out var mt) ? mt.GetString() ?? "Mission" : "Mission";
                    var mState = mission.GetProperty("state").GetString() ?? "UNKNOWN";
                    var canCancel = mState is "draft" or "planning" or "waiting_for_approval" or "ready" or "running" or "waiting_for_user" or "verifying";

                    var row = new TaskRow(mId, $"[Mission] {mTitle}", mState.ToUpperInvariant(), Role: "Agent Coordinator", CanCancel: canCancel);

                    if (mState is "completed" or "failed" or "stopped")
                    {
                        historyTasks.Add(row);
                    }
                    else
                    {
                        activeTasks.Add(row);
                    }

                    if (mState == "waiting_for_approval")
                    {
                        pendingApprovals.Add(new PendingApprovalItem(
                            TaskId: mId,
                            TaskTitle: mTitle,
                            ActionId: mId,
                            OperationKind: "mission.approve",
                            Summary: $"Multi-Agent Execution Plan: {mTitle}",
                            PayloadSha256: mission.TryGetProperty("planReference", out var pr) ? pr.GetString() ?? "-" : "-",
                            Category: "agent_plan",
                            Reversible: true,
                            ExpiresAt: 0,
                            Scope: $"Mission {mId} Envelope",
                            ProposedDiff: mission.TryGetProperty("objective", out var obj) ? obj.GetString() ?? "" : "",
                            ExpectedEffects: "Approves autonomous multi-agent plan and begins execution"
                        ));
                    }

                    // Check mission requests for consequential approvals
                    if (mission.TryGetProperty("requests", out var reqsArr) && reqsArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var req in reqsArr.EnumerateArray())
                        {
                            if (req.TryGetProperty("resolvedAt", out var resAt) && resAt.ValueKind != JsonValueKind.Null)
                                continue;

                            var reqId = req.GetProperty("id").GetString() ?? "";
                            var action = req.GetProperty("action").GetString() ?? "operation";
                            var reason = req.TryGetProperty("reason", out var r) ? r.GetString() ?? "" : "";
                            var risk = req.TryGetProperty("risk", out var rk) ? rk.GetString() ?? "WRITE" : "WRITE";

                            string sha256 = "-";
                            string diff = reason;
                            string scope = $"Mission {mId} / Step {(req.TryGetProperty("stepId", out var stp) ? stp.GetString() : "")}";

                            if (req.TryGetProperty("promotion", out var promo) && promo.ValueKind == JsonValueKind.Object)
                            {
                                sha256 = promo.TryGetProperty("contentHash", out var ch) ? ch.GetString() ?? "-" : "-";
                                var dest = promo.TryGetProperty("destination", out var dst) ? dst.GetString() ?? "" : "";
                                diff = $"Staged Destination: {dest}\nSHA-256: {sha256}\n{reason}";
                                scope = $"Promote File: {dest}";
                            }
                            else if (req.TryGetProperty("desktopOperation", out var dOp) && dOp.ValueKind == JsonValueKind.Object)
                            {
                                sha256 = dOp.TryGetProperty("digest", out var dg) ? dg.GetString() ?? "-" : "-";
                                scope = dOp.TryGetProperty("cwd", out var cwd) ? cwd.GetString() ?? scope : scope;
                            }

                            pendingApprovals.Add(new PendingApprovalItem(
                                TaskId: mId,
                                TaskTitle: mTitle,
                                ActionId: reqId,
                                OperationKind: action,
                                Summary: reason,
                                PayloadSha256: sha256,
                                Category: "consequential",
                                Reversible: false,
                                ExpiresAt: 0,
                                Scope: scope,
                                ProposedDiff: diff,
                                ExpectedEffects: $"Consequential {action} ({risk} risk) requiring workstation approval."
                            ));
                        }
                    }
                }
            }

            // 1c. Add persistentTasks if present
            if (root.TryGetProperty("persistentTasks", out var ptasks) &&
                ptasks.TryGetProperty("tasks", out var tasksArr) &&
                tasksArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var task in tasksArr.EnumerateArray())
                {
                    var id = task.GetProperty("id").GetString() ?? "";
                    if (activeTasks.Any(x => x.Id == id) || historyTasks.Any(x => x.Id == id)) continue;

                    var title = task.GetProperty("title").GetString() ?? "Task";
                    var state = task.GetProperty("state").GetString() ?? "UNKNOWN";
                    var canCancel = state is "VALIDATED" or "AWAITING_APPROVAL" or "QUEUED" or "RUNNING" or "PAUSED" or "RESUMING";
                    var canPause = state is "RUNNING" or "RESUMING";
                    var canResume = state is "PAUSED";

                    var row = new TaskRow(id, title, state, CanCancel: canCancel, CanPause: canPause, CanResume: canResume);

                    if (state is "COMPLETED" or "FAILED" or "CANCELLED" or "UNCERTAIN")
                    {
                        historyTasks.Add(row);
                    }
                    else
                    {
                        activeTasks.Add(row);
                    }

                    // Check for pending action approvals
                    if (task.TryGetProperty("pendingAction", out var pending) && pending.ValueKind == JsonValueKind.Object)
                    {
                        var actionId = pending.GetProperty("actionId").GetString() ?? "";
                        var kind = pending.GetProperty("kind").GetString() ?? "";
                        var summary = pending.GetProperty("summary").GetString() ?? "";
                        var sha = pending.GetProperty("payloadSha256").GetString() ?? "";
                        var reversible = pending.TryGetProperty("reversible", out var rev) && rev.GetBoolean();
                        var expiresAt = pending.TryGetProperty("expiresAt", out var exp) ? exp.GetInt64() : 0;

                        pendingApprovals.Add(new PendingApprovalItem(
                            TaskId: id,
                            TaskTitle: title,
                            ActionId: actionId,
                            OperationKind: kind,
                            Summary: summary,
                            PayloadSha256: sha,
                            // Not "consequential": that category answers mission requests via mission.respond.
                            Category: "action",
                            Reversible: reversible,
                            ExpiresAt: expiresAt,
                            Scope: $"Task {id} Envelope",
                            ProposedDiff: summary,
                            ExpectedEffects: "Consequential file/system modifications on workstation"
                        ));
                    }
                }
            }

            // Update Active Tasks List
            ActiveTasksList.ItemsSource = activeTasks;
            TaskHistoryList.ItemsSource = historyTasks;

            // Update Approvals List
            PendingApprovalsList.ItemsSource = pendingApprovals;
            if (pendingApprovals.Count > 0 && PendingApprovalsList.SelectedItem == null)
            {
                PendingApprovalsList.SelectedIndex = 0;
            }

            // 2. Process Personal Agents
            if (root.TryGetProperty("personalAgents", out var pa) &&
                pa.TryGetProperty("slots", out var slotsArr) &&
                slotsArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var s in slotsArr.EnumerateArray())
                {
                    var slotNum = s.GetProperty("slot").GetInt32();
                    var active = s.TryGetProperty("active", out var act) && act.GetBoolean();
                    var stateStr = active ? "WORKING" : "IDLE";

                    switch (slotNum)
                    {
                        case 1:
                            GadaStatusText.Text = stateStr;
                            GadaStatusChip.Background = active ? (SolidColorBrush)FindResource("PositiveBrush") : new SolidColorBrush(Color.FromRgb(38, 52, 80));
                            break;
                        case 2:
                            SpearStatusText.Text = stateStr;
                            SpearStatusChip.Background = active ? (SolidColorBrush)FindResource("PositiveBrush") : new SolidColorBrush(Color.FromRgb(38, 52, 80));
                            break;
                        case 3:
                            ChakraStatusText.Text = stateStr;
                            ChakraStatusChip.Background = active ? (SolidColorBrush)FindResource("PositiveBrush") : new SolidColorBrush(Color.FromRgb(38, 52, 80));
                            break;
                        case 4:
                            SwordStatusText.Text = stateStr;
                            SwordStatusChip.Background = active ? (SolidColorBrush)FindResource("PositiveBrush") : new SolidColorBrush(Color.FromRgb(38, 52, 80));
                            break;
                    }
                }
            }

            // 3. Process Projects
            // /state.projects is an array. Reading it as an object threw here and aborted every later section,
            // leaving the chat model picker empty so chats silently fell back to Host auto-routing (R1R2).
            if (root.TryGetProperty("projects", out var projArr) &&
                projArr.ValueKind == JsonValueKind.Array)
            {
                var projects = new List<ProjectItem>();
                foreach (var p in projArr.EnumerateArray())
                {
                    var id = p.GetProperty("id").GetString() ?? "";
                    var name = p.TryGetProperty("name", out var nm) ? nm.GetString() ?? id : id;
                    var path = p.TryGetProperty("path", out var pth) ? pth.GetString() ?? "" : "";
                    var created = p.TryGetProperty("createdAt", out var cr) ? cr.GetInt64() : 0;
                    projects.Add(new ProjectItem(id, name, path, created, 0));
                }
                ProjectsList.ItemsSource = projects;
            }

            // 4. Process Lotus Memory
            if (root.TryGetProperty("lotus", out var lotus) &&
                lotus.TryGetProperty("memories", out var memArr) &&
                memArr.ValueKind == JsonValueKind.Array)
            {
                var memories = new List<LotusMemoryRow>();
                foreach (var m in memArr.EnumerateArray())
                {
                    var id = m.GetProperty("id").GetString() ?? "";
                    var scope = m.GetProperty("scope").GetString() ?? "";
                    var layer = m.GetProperty("layer").GetString() ?? "";
                    var key = m.GetProperty("key").GetString() ?? "";
                    var val = m.GetProperty("value").GetString() ?? "";
                    var trust = m.GetProperty("trust").GetString() ?? "";
                    var prov = m.GetProperty("provenance").GetString() ?? "";
                    var updated = m.TryGetProperty("updatedAt", out var up) ? up.GetInt64() : 0;
                    memories.Add(new LotusMemoryRow(id, scope, layer, key, val, trust, prov, updated));
                }
                LotusMemoriesList.ItemsSource = memories;
            }

            // 5. Process Models
            var models = new List<ModelItem>();
            if (root.TryGetProperty("intelligence", out var intel) &&
                intel.TryGetProperty("models", out var modelsArr) &&
                modelsArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var m in modelsArr.EnumerateArray())
                {
                    var id = m.GetProperty("id").GetString() ?? "";
                    var name = m.TryGetProperty("name", out var n) ? n.GetString() ?? id : id;
                    var provider = m.TryGetProperty("provider", out var p) ? p.GetString() ?? "ollama" : "ollama";
                    var avail = m.TryGetProperty("available", out var a) && a.GetBoolean();
                    models.Add(new ModelItem(id, name, provider, avail, false, $"{provider} · {(avail ? "Ready" : "Offline")}"));
                }
            }

            if (root.TryGetProperty("providers", out var provArr) && provArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var p in provArr.EnumerateArray())
                {
                    var pId = p.TryGetProperty("id", out var pi) ? pi.GetString() ?? "" : "";
                    if (p.TryGetProperty("models", out var pModels) && pModels.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var pm in pModels.EnumerateArray())
                        {
                            var mName = pm.GetString() ?? "";
                            if (!string.IsNullOrEmpty(mName) && !models.Any(x => x.Id == mName))
                            {
                                models.Add(new ModelItem(mName, mName, pId, true, false, $"{pId} · Ready"));
                            }
                        }
                    }
                }
            }

            ModelsList.ItemsSource = models;

            if (ChatModelCombo.Items.Count == 0 && models.Count > 0)
            {
                // R1R2: default to Host routing; silently pinning models[0] sent chats to whatever listed first.
                chatModels = models;
                ChatModelCombo.ItemsSource = new[] { "Auto" }.Concat(models.Select(m => m.Id)).ToList();
                ChatModelCombo.SelectedIndex = 0;
            }

            // 6. Process Paired Devices
            if (root.TryGetProperty("devices", out var devArr) && devArr.ValueKind == JsonValueKind.Array)
            {
                var devices = new List<DeviceItem>();
                foreach (var d in devArr.EnumerateArray())
                {
                    var id = d.GetProperty("id").GetString() ?? "";
                    var name = d.GetProperty("name").GetString() ?? "Companion Phone";
                    var pairedAt = d.TryGetProperty("paired_at", out var pt) ? pt.GetInt64() : 0;
                    var revoked = d.TryGetProperty("revoked_at", out var rv) && rv.ValueKind != JsonValueKind.Null;
                    devices.Add(new DeviceItem(id, name, pairedAt, revoked));
                }
                PairedDevicesList.ItemsSource = devices;
            }

            // 7. Process Voice
            if (root.TryGetProperty("voice", out var voice) && voice.ValueKind == JsonValueKind.Object)
            {
                var isListening = voice.TryGetProperty("listening", out var vl) && vl.GetBoolean();
                var isMuted = voice.TryGetProperty("muted", out var vm) && vm.GetBoolean();
                VoiceMuteButton.Content = isMuted ? "Unmute Mic" : "Mute Mic";
                ListenStartButton.IsEnabled = !isListening;
                ListenEndButton.IsEnabled = isListening;
            }
        }
        catch (Exception ex)
        {
            HostStatusDot.Fill = (SolidColorBrush)FindResource("NegativeBrush");
            HostStatusText.Text = "Host Connection Lost";
            HostEpochText.Text = ex.Message;
        }
        finally
        {
            isBusy = false;
        }
    }

    // ==========================================
    // CHAT & CONVERSATION LOGIC (W2)
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

    private void UpdateChatMessage(string id, string text, string status, string? model = null)
    {
        for (int i = 0; i < chatMessages.Count; i++)
        {
            if (chatMessages[i].Id == id)
            {
                chatMessages[i] = chatMessages[i] with
                {
                    Text = text,
                    Status = status,
                    Model = model ?? chatMessages[i].Model
                };
                ChatHistoryList.ItemsSource = chatMessages.ToList();
                ChatHistoryList.ScrollIntoView(chatMessages[i]);
                break;
            }
        }
    }

    private async void SendPrompt()
    {
        var prompt = PromptInput.Text.Trim();
        if (string.IsNullOrEmpty(prompt) || !hostClient.IsConnected) return;

        PromptInput.Clear();
        SendButton.IsEnabled = false;
        StopButton.IsEnabled = true;

        var userMsg = new ChatMessage(Guid.NewGuid().ToString(), "You", prompt, true, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        chatMessages.Add(userMsg);

        var model = ChatModelCombo.SelectedItem as string;
        if (model == "Auto") model = null;
        var selectedProvider = model == null ? null : chatModels.FirstOrDefault(m => m.Id == model)?.Provider;
        var localOnly = LocalOnlyCheck.IsChecked == true;
        var aiMsgId = Guid.NewGuid().ToString();

        if (selectedSpeakerSlot == 0)
        {
            // Main Bunny real Ollama model execution
            var aiMsg = new ChatMessage(
                aiMsgId,
                "Bunny",
                "Submitting task to Host execution engine…",
                false,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Model: string.IsNullOrEmpty(model) ? "Auto" : model,
                Status: "Submitting"
            );
            chatMessages.Add(aiMsg);
            ChatHistoryList.ItemsSource = chatMessages.ToList();
            ChatHistoryList.ScrollIntoView(aiMsg);

            try
            {
                // 1. Submit task to Host
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

                if (!res.TryGetProperty("task", out var taskObj))
                {
                    UpdateChatMessage(aiMsgId, "Host refused task submission without task identity.", "Refused", model);
                    return;
                }

                var taskId = taskObj.GetProperty("id").GetString() ?? "";
                activeInferenceTaskId = taskId;
                var taskState = taskObj.TryGetProperty("state", out var sp) ? sp.GetString() ?? "" : "";

                UpdateChatMessage(aiMsgId, $"Task {taskId[..Math.Min(8, taskId.Length)]}… created. Approving execution…", "Approving", model);

                // 2. Approve execution to launch local model
                if (taskState == "waiting_for_approval")
                {
                    await hostClient.SendCommandAsync("approve", new { id = taskId }, lifetime.Token);
                    UpdateChatMessage(aiMsgId, "Executing local model inference…", "Running", model);
                }

                // 3. Follow real execution progress and retrieve verified model output
                var stopwatch = System.Diagnostics.Stopwatch.StartNew();
                var maxWait = TimeSpan.FromSeconds(120);

                while (!lifetime.Token.IsCancellationRequested && stopwatch.Elapsed < maxWait)
                {
                    await Task.Delay(250, lifetime.Token);

                    var stateDoc = await hostClient.GetStateAsync(lifetime.Token);
                    var root = stateDoc.RootElement;
                    notchWindow?.UpdateSnapshot(root);

                    JsonElement? matchedTask = null;
                    if (root.TryGetProperty("tasks", out var tasksArr) && tasksArr.ValueKind == JsonValueKind.Array)
                    {
                        foreach (var t in tasksArr.EnumerateArray())
                        {
                            if (t.GetProperty("id").GetString() == taskId)
                            {
                                matchedTask = t;
                                break;
                            }
                        }
                    }

                    if (matchedTask.HasValue)
                    {
                        var curState = matchedTask.Value.GetProperty("state").GetString() ?? "";
                        var modelUsed = matchedTask.Value.TryGetProperty("model", out var m) ? m.GetString() : model;
                        var providerUsed = matchedTask.Value.TryGetProperty("provider", out var p) ? p.GetString() : null;

                        // Defence in depth: a pinned local chat never shows an answer from a different provider.
                        if (selectedProvider != null && providerUsed != null && providerUsed != selectedProvider)
                        {
                            await hostClient.SendCommandAsync("stop", new { id = taskId, reason = "Route changed from the selected provider." }, lifetime.Token);
                            UpdateChatMessage(aiMsgId, $"Refused: the Host routed this chat to {providerUsed}, not the selected {selectedProvider}.", "Refused", $"{providerUsed} · {modelUsed}");
                            break;
                        }

                        if (curState == "completed")
                        {
                            var output = matchedTask.Value.TryGetProperty("output", out var o) ? o.GetString() ?? "" : "";
                            string usageInfo = "";
                            if (matchedTask.Value.TryGetProperty("usage", out var u) && u.ValueKind == JsonValueKind.Object)
                            {
                                var inTok = u.TryGetProperty("inputTokens", out var it) ? it.GetInt32() : 0;
                                var outTok = u.TryGetProperty("outputTokens", out var ot) ? ot.GetInt32() : 0;
                                usageInfo = $" · {inTok} in / {outTok} out";
                            }

                            UpdateChatMessage(
                                aiMsgId,
                                string.IsNullOrEmpty(output) ? "(Model completed with empty output)" : output,
                                "Completed",
                                $"{providerUsed} · {modelUsed}{usageInfo}"
                            );
                            break;
                        }
                        else if (curState == "failed")
                        {
                            var err = matchedTask.Value.TryGetProperty("error", out var e) ? e.GetString() : "Task execution failed.";
                            UpdateChatMessage(aiMsgId, $"Inference failed: {err}", "Failed", $"{providerUsed} · {modelUsed}");
                            break;
                        }
                        else if (curState == "stopped")
                        {
                            UpdateChatMessage(aiMsgId, "Task was stopped by user.", "Cancelled", $"{providerUsed} · {modelUsed}");
                            break;
                        }
                        else if (curState == "running")
                        {
                            UpdateChatMessage(aiMsgId, $"Model {modelUsed} generating ({stopwatch.Elapsed.Seconds}s)…", "Generating", $"{providerUsed} · {modelUsed}");
                        }
                    }
                }

                if (stopwatch.Elapsed >= maxWait)
                {
                    UpdateChatMessage(aiMsgId, "Inference timed out waiting for response.", "Timeout", model);
                }
            }
            catch (OperationCanceledException)
            {
                UpdateChatMessage(aiMsgId, "Inference cancelled.", "Cancelled", model);
            }
            catch (Exception ex)
            {
                UpdateChatMessage(aiMsgId, $"Host error: {ex.Message}", "Error", model);
            }
            finally
            {
                activeInferenceTaskId = null;
                SendButton.IsEnabled = true;
                StopButton.IsEnabled = false;
                await RefreshAllStateAsync(force: true);
            }
        }
        else
        {
            // Personal Agent context conversation (Gada, Spear, Chakra, Sword)
            var agentName = selectedSpeakerSlot switch
            {
                1 => "Gada",
                2 => "Spear",
                3 => "Vishnu Chakra",
                4 => "Sword",
                _ => "Agent"
            };

            var aiMsg = new ChatMessage(
                aiMsgId,
                agentName,
                "Consulting personal agent facts…",
                false,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Model: $"Personal Agent (Slot {selectedSpeakerSlot})",
                Status: "Querying"
            );
            chatMessages.Add(aiMsg);
            ChatHistoryList.ItemsSource = chatMessages.ToList();
            ChatHistoryList.ScrollIntoView(aiMsg);

            try
            {
                var res = await hostClient.SendCommandAsync("personal_agent.converse", new
                {
                    slot = selectedSpeakerSlot,
                    text = prompt
                }, lifetime.Token);

                string replyText = "No response recorded.";
                if (res.TryGetProperty("data", out var dataObj) &&
                    dataObj.TryGetProperty("reply", out var repObj) &&
                    repObj.TryGetProperty("text", out var tProp))
                {
                    replyText = tProp.GetString() ?? replyText;
                }
                else if (res.TryGetProperty("reply", out var repProp) && repProp.TryGetProperty("text", out var t2Prop))
                {
                    replyText = t2Prop.GetString() ?? replyText;
                }

                UpdateChatMessage(aiMsgId, replyText, "Answered", $"Personal Agent Context (Slot {selectedSpeakerSlot})");
            }
            catch (Exception ex)
            {
                UpdateChatMessage(aiMsgId, $"Agent error: {ex.Message}", "Error");
            }
            finally
            {
                SendButton.IsEnabled = true;
                StopButton.IsEnabled = false;
                await RefreshAllStateAsync(force: true);
            }
        }
    }

    private async void StopInference_Click(object sender, RoutedEventArgs e)
    {
        if (activeInferenceTaskId != null)
        {
            try
            {
                await hostClient.SendCommandAsync("stop", new
                {
                    id = activeInferenceTaskId,
                    reason = "User cancelled inference from native UI."
                });
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Stop Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    private async void DelegatePrompt_Click(object sender, RoutedEventArgs e)
    {
        var prompt = PromptInput.Text.Trim();
        if (string.IsNullOrEmpty(prompt) || !hostClient.IsConnected) return;

        PromptInput.Clear();
        SendButton.IsEnabled = false;

        try
        {
            var res = await hostClient.SendCommandAsync("mission.create", new
            {
                objective = prompt,
                mode = "fast"
            }, lifetime.Token);

            string missionId = "";
            if (res.TryGetProperty("mission", out var mObj) && mObj.TryGetProperty("id", out var idProp))
            {
                missionId = idProp.GetString() ?? "";
            }

            var replyMsg = new ChatMessage(
                Guid.NewGuid().ToString(),
                "Agent Coordinator",
                $"Multi-agent mission {missionId} created. The Planner Agent is preparing execution steps.\nSwitch to Agent Dashboard to review the plan.",
                false,
                DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(),
                Model: "Planner (Gada/Sword)"
            );
            chatMessages.Add(replyMsg);
            ChatHistoryList.ItemsSource = chatMessages.ToList();

            SelectTab("Agents");
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Agent delegation failed: {ex.Message}", "Delegation Error", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
        finally
        {
            SendButton.IsEnabled = true;
        }
    }

    private void CopyMessage_Click(object sender, RoutedEventArgs e)
    {
        if (sender is Button btn && btn.Tag is string text)
        {
            Clipboard.SetText(text);
        }
    }

    // ==========================================
    // AGENT DASHBOARD & TASKS LOGIC (W3)
    // ==========================================

    private void ActiveTasksList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        var hasSelection = ActiveTasksList.SelectedItem is TaskRow;
        CancelActiveTaskButton.IsEnabled = hasSelection;
        PauseTaskButton.IsEnabled = hasSelection;
        ResumeTaskButton.IsEnabled = hasSelection;
        RunWithAgentsButton.IsEnabled = hasSelection;
    }

    private async void RunWithAgents_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow row)
        {
            try
            {
                await hostClient.SendCommandAsync("mission.approve", new { id = row.Id, start = true });
                await RefreshAllStateAsync(force: true);
                MessageBox.Show(this, $"Mission {row.Id} approved and launched with Agents.", "Agent Workflow Started", MessageBoxButton.OK, MessageBoxImage.Information);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Launch Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
        else
        {
            MessageBox.Show(this, "Select an active mission or task from the list above first.", "Select Task", MessageBoxButton.OK, MessageBoxImage.Information);
        }
    }

    private async void CancelSelectedTask_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow row && row.CanCancel)
        {
            try
            {
                try
                {
                    await hostClient.SendCommandAsync("stop", new { id = row.Id, reason = "User cancelled task from native UI." });
                }
                catch
                {
                    try
                    {
                        await hostClient.SendCommandAsync("mission.stop", new { id = row.Id });
                    }
                    catch
                    {
                        await hostClient.SendCommandAsync("ptask.cancel", new { id = row.Id });
                    }
                }
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Cancellation Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    private async void PauseSelectedTask_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow row && row.CanPause)
        {
            try
            {
                await hostClient.SendCommandAsync("ptask.pause", new { id = row.Id });
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Pause Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    private async void ResumeSelectedTask_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow row && row.CanResume)
        {
            try
            {
                await hostClient.SendCommandAsync("ptask.resume", new { id = row.Id });
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Resume Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    // ==========================================
    // APPROVAL CENTER LOGIC (W4)
    // ==========================================

    private void PendingApprovalsList_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (PendingApprovalsList.SelectedItem is PendingApprovalItem app)
        {
            ApprovalOpKind.Text = $"Operation: {app.OperationKind}";
            ApprovalTaskTitle.Text = $"Task: {app.TaskTitle} ({app.TaskId})";
            ApprovalScopeText.Text = app.Scope;
            ApprovalPayloadShaText.Text = app.PayloadSha256;
            ApprovalEffectsText.Text = app.ExpectedEffects;
            ApprovalDiffText.Text = app.ProposedDiff;
        }
        else
        {
            ApprovalOpKind.Text = "Operation: -";
            ApprovalTaskTitle.Text = "No pending approval selected.";
            ApprovalScopeText.Text = "-";
            ApprovalPayloadShaText.Text = "-";
            ApprovalEffectsText.Text = "-";
            ApprovalDiffText.Text = "Select an approval request to inspect.";
        }
    }

    private async void ApproveAction_Click(object sender, RoutedEventArgs e)
    {
        if (PendingApprovalsList.SelectedItem is PendingApprovalItem app)
        {
            try
            {
                if (app.OperationKind == "mission.approve")
                {
                    await hostClient.SendCommandAsync("mission.approve", new { id = app.TaskId, start = true });
                }
                else if (app.OperationKind == "task.approve")
                {
                    await hostClient.SendCommandAsync("approve", new { id = app.TaskId });
                }
                else if (app.Category == "consequential")
                {
                    await hostClient.SendCommandAsync("mission.respond", new
                    {
                        requestId = app.ActionId,
                        decision = "allow_once"
                    });
                }
                else
                {
                    await hostClient.SendCommandAsync("action.approve", new
                    {
                        id = app.TaskId,
                        actionId = app.ActionId,
                        payloadSha256 = app.PayloadSha256
                    });
                }

                MessageBox.Show(this, "Consequential action approved and released to Host execution engine.", "Action Approved", MessageBoxButton.OK, MessageBoxImage.Information);
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, $"Approval Refused: {ex.Message}", "Approval Failed", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }

    private async void DenyAction_Click(object sender, RoutedEventArgs e)
    {
        if (PendingApprovalsList.SelectedItem is PendingApprovalItem app)
        {
            try
            {
                if (app.OperationKind == "mission.approve")
                {
                    await hostClient.SendCommandAsync("mission.stop", new { id = app.TaskId });
                }
                else if (app.OperationKind == "task.approve")
                {
                    await hostClient.SendCommandAsync("stop", new { id = app.TaskId, reason = "User denied task approval." });
                }
                else if (app.Category == "consequential")
                {
                    await hostClient.SendCommandAsync("mission.respond", new
                    {
                        requestId = app.ActionId,
                        decision = "deny"
                    });
                }
                else
                {
                    await hostClient.SendCommandAsync("action.deny", new
                    {
                        id = app.TaskId,
                        actionId = app.ActionId
                    });
                }

                MessageBox.Show(this, "Consequential action denied. The task will safely fail closed.", "Action Denied", MessageBoxButton.OK, MessageBoxImage.Information);
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, $"Denial Refused: {ex.Message}", "Deny Failed", MessageBoxButton.OK, MessageBoxImage.Error);
            }
        }
    }

    // ==========================================
    // VOICE STUDIO LOGIC (W6)
    // ==========================================

    private async void ToggleVoiceSession_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await hostClient.SendCommandAsync("voice.session.open", new { mode = "push_to_talk" });
            VoiceTranscriptBox.AppendText("\n[Voice Session Opened] Ready for microphone capture.\n");
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Voice Session Error", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void VoiceListenStart_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await hostClient.SendCommandAsync("voice.listen.start", new { source = "button" });
            VoiceTranscriptBox.AppendText("\n[Listening Started] Speaking now…\n");
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Listen Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void VoiceListenEnd_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await hostClient.SendCommandAsync("voice.listen.end", new { });
            VoiceTranscriptBox.AppendText("\n[Listening Ended] Processing audio transcription with whisper.cpp…\n");
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Listen End Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void VoiceInterrupt_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await hostClient.SendCommandAsync("voice.interrupt", new { source = "button" });
            VoiceTranscriptBox.AppendText("\n[Barge-In Interrupt] Audio playback ducked/stopped immediately.\n");
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Interrupt Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void VoiceMute_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var isMuted = VoiceMuteButton.Content.ToString() == "Unmute Mic";
            await hostClient.SendCommandAsync("voice.mute", new { muted = !isMuted });
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Mute Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    // ==========================================
    // PROJECTS & RECONCILIATION LOGIC
    // ==========================================

    private void BrowseProjectFolder_Click(object sender, RoutedEventArgs e)
    {
        var dialog = new Microsoft.Win32.OpenFolderDialog
        {
            Title = "Select Project Root Folder"
        };
        if (dialog.ShowDialog() == true)
        {
            NewProjectPathInput.Text = dialog.FolderName;
        }
    }

    private async void RegisterProject_Click(object sender, RoutedEventArgs e)
    {
        var path = NewProjectPathInput.Text.Trim();
        if (string.IsNullOrEmpty(path)) return;

        try
        {
            var name = Path.GetFileName(path);
            if (string.IsNullOrEmpty(name)) name = "Project";

            if (Directory.Exists(path))
            {
                await hostClient.SendCommandAsync("project.add", new { path, name, description = "Registered workspace folder" });
            }
            else
            {
                await hostClient.SendCommandAsync("project.create", new { name, confirmed = true });
            }

            NewProjectPathInput.Clear();
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Project Registration Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void ProposeProjectMission_Click(object sender, RoutedEventArgs e)
    {
        var objective = ProjectMissionObjectiveInput.Text.Trim();
        if (string.IsNullOrEmpty(objective) || !hostClient.IsConnected) return;

        string? projectId = null;
        if (ProjectsList.SelectedItem is ProjectItem proj)
        {
            projectId = proj.Id;
        }

        try
        {
            var res = await hostClient.SendCommandAsync("mission.create", new
            {
                objective,
                mode = "fast",
                projectId
            }, lifetime.Token);

            ProjectMissionObjectiveInput.Clear();
            SelectTab("Agents");
            await RefreshAllStateAsync(force: true);
            MessageBox.Show(this, "Multi-agent mission plan proposed. Review the steps in the Agent Dashboard and select 'Run with Agents'.", "Plan Proposed", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, $"Plan proposal failed: {ex.Message}", "Proposal Error", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void ReconcileHappened_Click(object sender, RoutedEventArgs e) => await ReconcileSelectedTask("happened");
    private async void ReconcileNotHappened_Click(object sender, RoutedEventArgs e) => await ReconcileSelectedTask("not_happened");
    private async void ReconcileAbandon_Click(object sender, RoutedEventArgs e) => await ReconcileSelectedTask("abandon");

    private async Task ReconcileSelectedTask(string decision)
    {
        if (TaskHistoryList.SelectedItem is TaskRow row)
        {
            try
            {
                await hostClient.SendCommandAsync("ptask.reconcile", new { id = row.Id, decision });
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Reconcile Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    // ==========================================
    // LOTUS MEMORY LOGIC
    // ==========================================

    private async void LotusRemember_Click(object sender, RoutedEventArgs e)
    {
        var key = LotusKeyInput.Text.Trim();
        var val = LotusValueInput.Text.Trim();
        var layer = (LotusLayerCombo.SelectedItem as ComboBoxItem)?.Content?.ToString() ?? "central";

        if (string.IsNullOrEmpty(key) || string.IsNullOrEmpty(val)) return;

        try
        {
            await hostClient.SendCommandAsync("lotus.remember", new
            {
                scope = "central",
                layer,
                key,
                value = val,
                origin = "user"
            });

            LotusKeyInput.Clear();
            LotusValueInput.Clear();
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Memory Save Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void LotusRecall_Click(object sender, RoutedEventArgs e)
    {
        var query = LotusSearchInput.Text.Trim();
        if (string.IsNullOrEmpty(query)) return;

        try
        {
            var res = await hostClient.SendCommandAsync("lotus.recall", new { slot = 1, query });
            MessageBox.Show(this, $"Recall result: {res.GetRawText()}", "Lotus Recall", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Recall Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void LotusForget_Click(object sender, RoutedEventArgs e)
    {
        if (LotusMemoriesList.SelectedItem is LotusMemoryRow mem)
        {
            try
            {
                await hostClient.SendCommandAsync("lotus.forget", new { id = mem.Id });
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Forget Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    // ==========================================
    // MODELS, DEVICES & SETTINGS LOGIC
    // ==========================================

    private async void DiscoverModels_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await hostClient.SendCommandAsync("ma4.discover", new { });
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Discovery Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void TestModelConnection_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            await hostClient.SendCommandAsync("intelligence.test", new { });
            MessageBox.Show(this, "Local Ollama model connection verified successfully.", "Model Connection", MessageBoxButton.OK, MessageBoxImage.Information);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Test Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void GeneratePairingCode_Click(object sender, RoutedEventArgs e)
    {
        try
        {
            var res = await hostClient.SendCommandAsync("pairing.create", new { });
            if (res.TryGetProperty("pairCode", out var codeProp))
            {
                var code = codeProp.GetString();
                PairingCodeDisplay.Text = code;
            }
            else
            {
                PairingCodeDisplay.Text = "Code generated. Check host console.";
            }
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Pairing Code Error", MessageBoxButton.OK, MessageBoxImage.Warning);
        }
    }

    private async void RevokeDevice_Click(object sender, RoutedEventArgs e)
    {
        if (PairedDevicesList.SelectedItem is DeviceItem dev)
        {
            try
            {
                await hostClient.SendCommandAsync("device.revoke", new { id = dev.Id });
                MessageBox.Show(this, $"Device {dev.Name} has been revoked.", "Device Revoked", MessageBoxButton.OK, MessageBoxImage.Information);
                await RefreshAllStateAsync(force: true);
            }
            catch (Exception ex)
            {
                MessageBox.Show(this, ex.Message, "Revoke Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
            }
        }
    }

    private void NotchEdgeCombo_SelectionChanged(object sender, SelectionChangedEventArgs e)
    {
        if (notchWindow != null && SettingsNotchEdgeCombo.SelectedItem is ComboBoxItem item)
        {
            notchWindow.ApplyEdgePlacement(item.Content.ToString() ?? "Top");
        }
    }
}
