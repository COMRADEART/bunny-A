using System;
using System.IO;
using System.Text.Json;
using System.Windows;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Media.Imaging;
using BunnyA.Models;
using BunnyA.Services;

namespace BunnyA;

public partial class NotchWindow : Window
{
    private string currentEdge = "Top";
    private readonly MainWindow mainWindow;
    private readonly HostClient hostClient;

    public string CurrentEdge => currentEdge;

    public NotchWindow(MainWindow owner, HostClient client)
    {
        InitializeComponent();
        mainWindow = owner;
        hostClient = client;

        var config = ConfigService.Load();
        currentEdge = config.NotchEdge;
        ApplyEdgePlacement(currentEdge);

        Loaded += (_, _) => ApplyEdgePlacement(currentEdge);
    }

    public void ApplyEdgePlacement(string edge)
    {
        currentEdge = edge;
        var workArea = SystemParameters.WorkArea;

        if (edge is "Top" or "Bottom")
        {
            HorizontalLayout.Visibility = Visibility.Visible;
            VerticalLayout.Visibility = Visibility.Collapsed;
            NotchBorder.CornerRadius = new CornerRadius(24);

            Left = workArea.Left + (workArea.Width - Math.Max(ActualWidth, 420)) / 2;
            Top = edge == "Top" ? workArea.Top : workArea.Bottom - Math.Max(ActualHeight, 60);
        }
        else // "Left" or "Right"
        {
            HorizontalLayout.Visibility = Visibility.Collapsed;
            VerticalLayout.Visibility = Visibility.Visible;
            NotchBorder.CornerRadius = new CornerRadius(20);

            Top = workArea.Top + (workArea.Height - Math.Max(ActualHeight, 220)) / 2;
            Left = edge == "Left" ? workArea.Left : workArea.Right - Math.Max(ActualWidth, 60);
        }

        var config = ConfigService.Load();
        ConfigService.Save(config with { NotchEdge = currentEdge });
    }

    public void UpdateSnapshot(JsonElement root)
    {
        try
        {
            // Update active tasks & quick stop
            string? activeTitle = null;
            string? activeState = null;
            bool canCancel = false;
            string? activeId = null;
            bool hasApproval = false;

            if (root.TryGetProperty("persistentTasks", out var ptasks) &&
                ptasks.TryGetProperty("tasks", out var tasksArr) &&
                tasksArr.ValueKind == JsonValueKind.Array)
            {
                foreach (var t in tasksArr.EnumerateArray())
                {
                    var state = t.GetProperty("state").GetString() ?? "";
                    if (state is "AWAITING_APPROVAL")
                    {
                        hasApproval = true;
                    }
                    if (state is "RUNNING" or "PLANNING" or "WORKING" or "TESTING" or "RESUMING" or "AWAITING_APPROVAL")
                    {
                        activeTitle = t.GetProperty("title").GetString();
                        activeState = state;
                        activeId = t.GetProperty("id").GetString();
                        canCancel = true;
                        break;
                    }
                }
            }

            // Update text & quick stop
            if (activeTitle != null)
            {
                NotchTitle.Text = $"Bunny A · {activeState}";
                NotchSubtitle.Text = activeTitle;
                QuickStopButton.Visibility = canCancel ? Visibility.Visible : Visibility.Collapsed;
                QuickStopButton.Tag = activeId;
            }
            else
            {
                NotchTitle.Text = "Bunny A · Idle";
                NotchSubtitle.Text = "4 agents standing by";
                QuickStopButton.Visibility = Visibility.Collapsed;
            }

            ApprovalBadge.Visibility = hasApproval ? Visibility.Visible : Visibility.Collapsed;

            // Update voice state
            if (root.TryGetProperty("voice", out var voice) && voice.ValueKind == JsonValueKind.Object)
            {
                var isListening = voice.TryGetProperty("listening", out var l) && l.GetBoolean();
                var isSpeaking = voice.TryGetProperty("speaking", out var s) && s.GetBoolean();
                var isMuted = voice.TryGetProperty("muted", out var m) && m.GetBoolean();

                if (isListening)
                {
                    VoiceStatusText.Text = "🔴 Listening…";
                    VoicePill.Background = new SolidColorBrush(Color.FromRgb(53, 80, 214));
                    BunnyAvatar.Source = new BitmapImage(new Uri("pack://application:,,,/Assets/characters/bunny.listening.png"));
                }
                else if (isSpeaking)
                {
                    VoiceStatusText.Text = "🔊 Speaking…";
                    VoicePill.Background = new SolidColorBrush(Color.FromRgb(109, 79, 224));
                    BunnyAvatar.Source = new BitmapImage(new Uri("pack://application:,,,/Assets/characters/bunny.speaking.png"));
                }
                else if (isMuted)
                {
                    VoiceStatusText.Text = "🔇 Muted";
                    VoicePill.Background = new SolidColorBrush(Color.FromRgb(32, 38, 54));
                    BunnyAvatar.Source = new BitmapImage(new Uri("pack://application:,,,/Assets/characters/bunny.sleeping.png"));
                }
                else
                {
                    VoiceStatusText.Text = "🎙️ Voice";
                    VoicePill.Background = new SolidColorBrush(Color.FromRgb(28, 36, 56));
                    BunnyAvatar.Source = new BitmapImage(new Uri("pack://application:,,,/Assets/characters/bunny.idle.png"));
                }
            }
        }
        catch { }
    }

    private void Window_MouseLeftButtonDown(object sender, MouseButtonEventArgs e)
    {
        if (e.ClickCount == 2)
        {
            OpenWindow();
            return;
        }
        DragMove();
    }

    private void OpenWindow_Click(object sender, RoutedEventArgs e) => OpenWindow();

    private void OpenWindow()
    {
        mainWindow.Show();
        mainWindow.WindowState = WindowState.Normal;
        mainWindow.Activate();
    }

    private void DockEdge_Click(object sender, RoutedEventArgs e)
    {
        var nextEdge = currentEdge switch
        {
            "Top" => "Right",
            "Right" => "Bottom",
            "Bottom" => "Left",
            _ => "Top"
        };
        ApplyEdgePlacement(nextEdge);
    }

    private void ApprovalBadge_Click(object sender, MouseButtonEventArgs e)
    {
        OpenWindow();
        mainWindow.SelectTab("Approvals");
    }

    private void VoicePill_Click(object sender, MouseButtonEventArgs e)
    {
        OpenWindow();
        mainWindow.SelectTab("Voice");
    }

    private async void QuickStop_Click(object sender, RoutedEventArgs e)
    {
        if (QuickStopButton.Tag is string taskId && !string.IsNullOrEmpty(taskId))
        {
            try
            {
                await hostClient.SendCommandAsync("ptask.cancel", new { id = taskId });
                QuickStopButton.Visibility = Visibility.Collapsed;
            }
            catch { }
        }
    }
}
