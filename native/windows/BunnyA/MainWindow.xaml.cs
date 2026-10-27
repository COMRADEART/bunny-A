using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Threading;

namespace BunnyA;

// Preliminary native client: all task changes go through the authenticated Host command boundary.
public partial class MainWindow : Window
{
    private sealed record TaskRow(string Id, string Title, string State)
    {
        public bool CanCancel => State is "VALIDATED" or "AWAITING_APPROVAL" or "QUEUED" or "RUNNING" or "PAUSED" or "RESUMING";
        public override string ToString() => $"{Title}  ·  {State}";
    }
    private sealed record Credentials(int Port, string Token);
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false }) { Timeout = TimeSpan.FromSeconds(5) };
    private readonly DispatcherTimer refreshTimer = new() { Interval = TimeSpan.FromSeconds(3) };
    private readonly CancellationTokenSource lifetime = new();
    private string? hostId, hostEpoch;
    private bool busy, closed, needsReview;

    public MainWindow()
    {
        InitializeComponent();
        refreshTimer.Tick += async (_, _) => { if (!busy && !needsReview) await RefreshAsync(); };
        Loaded += async (_, _) => { await RefreshAsync(); if (!closed) refreshTimer.Start(); };
        Closed += (_, _) => { closed = true; refreshTimer.Stop(); lifetime.Cancel(); client.Dispose(); lifetime.Dispose(); };
    }
    private static async Task<Credentials> ReadCredentialsAsync()
    {
        var path = Environment.GetEnvironmentVariable("BUNNY_HOST_CREDENTIALS_FILE");
        if (string.IsNullOrWhiteSpace(path)) throw new InvalidOperationException("Host credential path is not configured.");
        using var credentials = JsonDocument.Parse(await File.ReadAllTextAsync(path));
        var port = credentials.RootElement.GetProperty("port").GetInt32();
        var token = credentials.RootElement.GetProperty("token").GetString();
        if (port is < 1 or > 65535 || string.IsNullOrWhiteSpace(token)) throw new InvalidOperationException("Host credentials are invalid.");
        return new Credentials(port, token);
    }
    private static HttpRequestMessage Request(HttpMethod method, Credentials credentials, string endpoint)
    {
        var request = new HttpRequestMessage(method, $"http://127.0.0.1:{credentials.Port}{endpoint}");
        request.Headers.Authorization = new AuthenticationHeaderValue("Bearer", credentials.Token);
        return request;
    }
    private static bool ExpectedFailure(Exception ex) => ex is IOException or UnauthorizedAccessException or InvalidOperationException or JsonException or HttpRequestException or TaskCanceledException or KeyNotFoundException or FormatException or ArgumentException or NotSupportedException;
    private void SetBusy(bool value)
    {
        busy = value;
        RefreshButton.IsEnabled = !value;
        CancelButton.IsEnabled = !value && hostId is not null && hostEpoch is not null && Tasks.SelectedItem is TaskRow { CanCancel: true };
    }
    private void Tasks_SelectionChanged(object sender, SelectionChangedEventArgs e) => SetBusy(busy);
    private async void Refresh_Click(object sender, RoutedEventArgs e) { needsReview = false; await RefreshAsync(); }
    private async Task RefreshAsync(bool force = false)
    {
        if (closed || (busy && !force)) return;
        SetBusy(true);
        try
        {
            var credentials = await ReadCredentialsAsync();
            using var request = Request(HttpMethod.Get, credentials, "/state");
            using var response = await client.SendAsync(request, lifetime.Token);
            response.EnsureSuccessStatusCode();
            using var state = JsonDocument.Parse(await response.Content.ReadAsStreamAsync());
            var identity = state.RootElement.GetProperty("hostIdentity");
            var newHostId = identity.GetProperty("hostId").GetString();
            var newEpoch = identity.GetProperty("epoch").GetString();
            if (string.IsNullOrWhiteSpace(newHostId) || string.IsNullOrWhiteSpace(newEpoch)) throw new InvalidOperationException("Host identity is unavailable.");
            if (!state.RootElement.TryGetProperty("persistentTasks", out var persistent) ||
                !persistent.TryGetProperty("schema", out var schema) || schema.ValueKind != JsonValueKind.String || schema.GetString() != "ma4.ptask.snapshot.v1" ||
                !persistent.TryGetProperty("tasks", out var tasks) || tasks.ValueKind != JsonValueKind.Array)
                throw new InvalidOperationException("Host task snapshot is unavailable.");
            var rows = new List<TaskRow>();
            foreach (var task in tasks.EnumerateArray())
            {
                var id = task.GetProperty("id").GetString();
                var title = task.GetProperty("title").GetString();
                var status = task.GetProperty("state").GetString();
                if (string.IsNullOrWhiteSpace(id) || string.IsNullOrWhiteSpace(status)) throw new InvalidOperationException("Invalid task snapshot.");
                rows.Add(new TaskRow(id, title ?? "Task", status));
            }
            if (closed) return;
            var sameHost = hostId == newHostId && hostEpoch == newEpoch;
            var selectedId = sameHost ? (Tasks.SelectedItem as TaskRow)?.Id : null;
            var unchanged = sameHost && (rows.Count == 0
                ? Tasks.Items.Count == 1 && Tasks.Items[0] is string message && message == "No tasks in the current Host snapshot."
                : Tasks.Items.Count == rows.Count && Tasks.Items.Cast<object>().SequenceEqual(rows.Cast<object>()));
            hostId = newHostId; hostEpoch = newEpoch;
            if (!unchanged)
            {
                Tasks.Items.Clear();
                foreach (var row in rows) Tasks.Items.Add(row);
                if (selectedId is not null) Tasks.SelectedItem = rows.Find(row => row.Id == selectedId);
                if (rows.Count == 0) Tasks.Items.Add("No tasks in the current Host snapshot.");
            }
            ConnectionStatus.Text = "Connected to the local Host";
        }
        catch (Exception ex) when (ExpectedFailure(ex))
        {
            if (closed) return;
            hostId = null; hostEpoch = null;
            Tasks.Items.Clear();
            Tasks.Items.Add("Tasks are unavailable until the Host connects.");
            ConnectionStatus.Text = "Host unavailable. Check the workstation connection and try again.";
        }
        finally { if (!closed) SetBusy(false); }
    }
    private async void Cancel_Click(object sender, RoutedEventArgs e)
    {
        if (busy || Tasks.SelectedItem is not TaskRow { CanCancel: true } selected || hostId is null || hostEpoch is null) return;
        var expectedHost = hostId; var expectedEpoch = hostEpoch;
        SetBusy(true);
        try
        {
            var credentials = await ReadCredentialsAsync();
            using var request = Request(HttpMethod.Post, credentials, "/command");
            request.Content = JsonContent.Create(new { action = "ptask.cancel", data = new { id = selected.Id }, expect = new { hostId = expectedHost, epoch = expectedEpoch }, operationId = Guid.NewGuid().ToString() });
            using var response = await client.SendAsync(request, lifetime.Token);
            response.EnsureSuccessStatusCode();
            await RefreshAsync(force: true);
        }
        catch (Exception ex) when (ExpectedFailure(ex))
        {
            if (closed) return;
            // A lost response may mean the Host applied the command. Never retry it automatically.
            needsReview = true;
            hostId = null; hostEpoch = null;
            ConnectionStatus.Text = "Cancellation outcome is unknown or refused. Refresh to inspect the Host before acting again.";
        }
        finally { if (!closed) SetBusy(false); }
    }
}
