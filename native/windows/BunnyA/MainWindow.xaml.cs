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

            // 1. Process Tasks (Persistent Tasks runtime)
            var activeTasks = new List<TaskRow>();
            var historyTasks = new List<TaskRow>();
            var pendingApprovals = new List<PendingApprovalItem>();

            if (root.TryGetProperty("persistentTasks", out var ptasks) &&
                ptasks.TryGetProperty("tasks", out var tasksArr) &&
                tasksArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var task in tasksArr.EnumerateArray())
                {
                    var id = task.GetProperty("id").GetString() ?? "";
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
                            Category: "consequential",
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
            if (root.TryGetProperty("projects", out var proj) &&
                proj.TryGetProperty("projects", out var projArr) &&
                projArr.ValueKind == JsonValueKind.Array)
            {
                var projects = new List<ProjectItem>();
                foreach (var p in projArr.EnumerateArray())
                {
                    var id = p.GetProperty("id").GetString() ?? "";
                    var name = p.GetProperty("name").GetString() ?? id;
                    var path = p.GetProperty("path").GetString() ?? "";
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
            if (root.TryGetProperty("intelligence", out var intel) &&
                intel.TryGetProperty("models", out var modelsArr) &&
                modelsArr.ValueKind == JsonValueKind.Array)
            {
                var models = new List<ModelItem>();
                foreach (var m in modelsArr.EnumerateArray())
                {
                    var id = m.GetProperty("id").GetString() ?? "";
                    var name = m.TryGetProperty("name", out var n) ? n.GetString() ?? id : id;
                    var provider = m.TryGetProperty("provider", out var p) ? p.GetString() ?? "ollama" : "ollama";
                    var avail = m.TryGetProperty("available", out var a) && a.GetBoolean();
                    models.Add(new ModelItem(id, name, provider, avail, false, $"{provider} · {(avail ? "Ready" : "Offline")}"));
                }
                ModelsList.ItemsSource = models;

                if (ChatModelCombo.Items.Count == 0 && models.Count > 0)
                {
                    ChatModelCombo.ItemsSource = models.Select(m => m.Id).ToList();
                    ChatModelCombo.SelectedIndex = 0;
                }
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

    private async void SendPrompt()
    {
        var prompt = PromptInput.Text.Trim();
        if (string.IsNullOrEmpty(prompt) || !hostClient.IsConnected) return;

        PromptInput.Clear();
        SendButton.IsEnabled = false;
        StopButton.IsEnabled = true;

        var userMsg = new ChatMessage(Guid.NewGuid().ToString(), "You", prompt, true, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
        chatMessages.Add(userMsg);
        ChatHistoryList.ItemsSource = chatMessages.ToList();
        ChatHistoryList.ScrollIntoView(userMsg);

        try
        {
            if (selectedSpeakerSlot == 0)
            {
                // Main Bunny submit conversation
                var model = ChatModelCombo.SelectedItem as string;
                var res = await hostClient.SendCommandAsync("submit", new
                {
                    prompt = prompt,
                    mode = "fast",
                    modelOverride = string.IsNullOrEmpty(model) ? null : model
                }, lifetime.Token);

                string responseText = "Task submitted to Bunny Host.";
                if (res.TryGetProperty("task", out var taskObj))
                {
                    activeInferenceTaskId = taskObj.GetProperty("id").GetString();
                    responseText = $"Task {activeInferenceTaskId} started. Monitoring response…";
                }

                var replyMsg = new ChatMessage(Guid.NewGuid().ToString(), "Bunny", responseText, false, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Model: model ?? "Host Default");
                chatMessages.Add(replyMsg);
            }
            else
            {
                // Talk to Personal Agent directly (Gada, Spear, Chakra, Sword)
                var agentName = selectedSpeakerSlot switch
                {
                    1 => "Gada",
                    2 => "Spear",
                    3 => "Vishnu Chakra",
                    4 => "Sword",
                    _ => "Agent"
                };

                var res = await hostClient.SendCommandAsync("personal_agent.converse", new
                {
                    slot = selectedSpeakerSlot,
                    text = prompt
                }, lifetime.Token);

                string replyText = "No response recorded.";
                if (res.TryGetProperty("reply", out var repProp) && repProp.TryGetProperty("text", out var tProp))
                {
                    replyText = tProp.GetString() ?? replyText;
                }

                var replyMsg = new ChatMessage(Guid.NewGuid().ToString(), agentName, replyText, false, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds(), Model: "Host Knowledge Base");
                chatMessages.Add(replyMsg);
            }

            ChatHistoryList.ItemsSource = chatMessages.ToList();
            if (chatMessages.Count > 0) ChatHistoryList.ScrollIntoView(chatMessages[^1]);
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            var errMsg = new ChatMessage(Guid.NewGuid().ToString(), "System", $"[Error] {ex.Message}", false, DateTimeOffset.UtcNow.ToUnixTimeMilliseconds());
            chatMessages.Add(errMsg);
            ChatHistoryList.ItemsSource = chatMessages.ToList();
        }
        finally
        {
            SendButton.IsEnabled = true;
            StopButton.IsEnabled = false;
        }
    }

    private async void StopInference_Click(object sender, RoutedEventArgs e)
    {
        if (activeInferenceTaskId != null)
        {
            try
            {
                await hostClient.SendCommandAsync("stop", new { id = activeInferenceTaskId });
            }
            catch { }
        }
    }

    private void DelegatePrompt_Click(object sender, RoutedEventArgs e)
    {
        var prompt = PromptInput.Text.Trim();
        if (string.IsNullOrEmpty(prompt)) return;
        SelectTab("Projects");
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
    }

    private async void CancelSelectedTask_Click(object sender, RoutedEventArgs e)
    {
        if (ActiveTasksList.SelectedItem is TaskRow row && row.CanCancel)
        {
            try
            {
                await hostClient.SendCommandAsync("ptask.cancel", new { id = row.Id });
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
                await hostClient.SendCommandAsync("action.approve", new
                {
                    id = app.TaskId,
                    actionId = app.ActionId,
                    payloadSha256 = app.PayloadSha256
                });
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
                await hostClient.SendCommandAsync("action.deny", new
                {
                    id = app.TaskId,
                    actionId = app.ActionId
                });
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

            await hostClient.SendCommandAsync("project.create", new { path, name });
            NewProjectPathInput.Clear();
            await RefreshAllStateAsync(force: true);
        }
        catch (Exception ex)
        {
            MessageBox.Show(this, ex.Message, "Project Registration Failed", MessageBoxButton.OK, MessageBoxImage.Warning);
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
