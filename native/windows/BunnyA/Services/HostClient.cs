using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Net.Sockets;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using BunnyA.Models;

namespace BunnyA.Services;

public enum HostFailure { CredentialsMissing, CredentialsInvalid, Unreachable, Timeout, AuthRejected, IdentityChanged, EpochChanged, Refused, Malformed, OutcomeUnknown, Failed }

/// <summary>
/// A classified Host failure. OutcomeUnknown means a command may have run; Failed means the Host reports it failed part-way
/// and it may have partly taken effect. Nothing is ever retried for the caller.
/// </summary>
public sealed class HostException : Exception
{
    public HostFailure Kind { get; }
    public string? Code { get; }
    public string? OperationId { get; }
    public string? EpochAtSend { get; }
    public string? HostIdAtSend { get; }
    public HostException(HostFailure kind, string message, string? code = null, string? operationId = null, string? epochAtSend = null, Exception? inner = null, string? hostIdAtSend = null)
        : base(message, inner) { Kind = kind; Code = code; OperationId = operationId; EpochAtSend = epochAtSend; HostIdAtSend = hostIdAtSend; }
}

public sealed class HostClient : IDisposable
{
    private static readonly TimeSpan StateTimeout = TimeSpan.FromSeconds(10);
    private static readonly TimeSpan CommandTimeout = TimeSpan.FromSeconds(30);
    // The Host writes a heartbeat every 15 s; three missed beats mean the stream is dead.
    private static readonly TimeSpan StreamSilence = TimeSpan.FromSeconds(45);

    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
    {
        Timeout = Timeout.InfiniteTimeSpan
    };

    /// <summary>Shown whenever a command's outcome cannot be established; never replaced by a guess either way.</summary>
    public const string Unconfirmed = "Connection interrupted. Bunny A cannot confirm whether this operation completed. It was not automatically retried. Review the current task and Host state before taking another action.";
    public const string PartlyApplied = "The operation failed on the Host and may have partly taken effect. It was not automatically retried. Review the current task and Host state before taking another action.";

    public string? HostId { get; private set; }
    public string? HostEpoch { get; private set; }
    public long Cursor { get; private set; }
    public bool EventsConnected { get; private set; }
    public bool IsConnected => !string.IsNullOrEmpty(HostId) && !string.IsNullOrEmpty(HostEpoch);

    /// <summary>Raised (on the caller's context) when a fresh snapshot comes from a different Host or a later epoch.</summary>
    public event Action<bool /*identityChanged*/>? HostChanged;

    public void InvalidateHost()
    {
        HostId = null;
        HostEpoch = null;
    }

    public static async Task<HostCredentials> ReadCredentialsAsync()
    {
        string? path = Environment.GetEnvironmentVariable("BUNNY_HOST_CREDENTIALS_FILE");
        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
        {
            var appData = Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData);
            var defaultPath = Path.Combine(appData, "bunny-a", "host-credentials.json");
            if (File.Exists(defaultPath)) path = defaultPath;
            else
            {
                var userHome = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
                var fallback = Path.Combine(userHome, ".bunny", "host-credentials.json");
                if (File.Exists(fallback)) path = fallback;
            }
        }

        if (string.IsNullOrWhiteSpace(path) || !File.Exists(path))
            throw new HostException(HostFailure.CredentialsMissing, "No Host credentials found. Start the Bunny A Host on this workstation.");

        try
        {
            using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(path));
            var port = doc.RootElement.GetProperty("port").GetInt32();
            var token = doc.RootElement.GetProperty("token").GetString();
            if (port is < 1 or > 65535 || string.IsNullOrWhiteSpace(token))
                throw new HostException(HostFailure.CredentialsInvalid, "The Host credentials file is invalid.");
            return new HostCredentials(port, token);
        }
        catch (HostException) { throw; }
        catch (Exception ex) when (ex is JsonException or KeyNotFoundException or InvalidOperationException or FormatException or IOException)
        {
            // The message never quotes the file: it holds the workstation credential.
            throw new HostException(HostFailure.CredentialsInvalid, "The Host credentials file is unreadable or invalid.");
        }
    }

    private static HttpRequestMessage CreateRequest(HttpMethod method, HostCredentials creds, string endpoint)
    {
        var req = new HttpRequestMessage(method, $"http://127.0.0.1:{creds.Port}{endpoint}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", creds.Token);
        return req;
    }

    private static bool Refused(HttpRequestException ex) =>
        ex.InnerException is SocketException { SocketErrorCode: SocketError.ConnectionRefused };

    public async Task<JsonElement> GetStateAsync(CancellationToken token = default)
    {
        var creds = await ReadCredentialsAsync();
        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(StateTimeout);
        using var req = CreateRequest(HttpMethod.Get, creds, "/state");
        JsonElement root;
        try
        {
            using var res = await client.SendAsync(req, timeout.Token);
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                throw new HostException(HostFailure.AuthRejected, "The Host rejected this workstation's credential. If the Host restarted, it will be re-read on the next refresh.");
            if (!res.IsSuccessStatusCode)
                throw new HostException(HostFailure.Refused, $"The Host returned HTTP {(int)res.StatusCode} for its state.");
            using var doc = await JsonDocument.ParseAsync(await res.Content.ReadAsStreamAsync(timeout.Token), cancellationToken: timeout.Token);
            root = doc.RootElement.Clone();
        }
        catch (OperationCanceledException) when (!token.IsCancellationRequested)
        {
            throw new HostException(HostFailure.Timeout, "The Host did not answer within 10 seconds.");
        }
        catch (HttpRequestException ex)
        {
            throw new HostException(HostFailure.Unreachable, Refused(ex) ? "The Host is not running." : "The Host connection failed.", inner: ex);
        }
        catch (JsonException ex)
        {
            throw new HostException(HostFailure.Malformed, "The Host sent a malformed state.", inner: ex);
        }

        // A snapshot without identity cannot bind commands; it never becomes the view a command is checked against.
        if (!root.TryGetProperty("hostIdentity", out var identity) || identity.ValueKind != JsonValueKind.Object ||
            identity.Json("hostId") is not { Length: > 0 } id || identity.Json("epoch") is not { Length: > 0 } epoch)
            throw new HostException(HostFailure.Malformed, "The Host state has no identity; nothing will be sent to it.");

        var changed = HostId != null && (HostId != id || HostEpoch != epoch);
        var identityChanged = HostId != null && HostId != id;
        HostId = id;
        HostEpoch = epoch;
        if (root.TryGetProperty("cursor", out var c) && c.TryGetInt64(out var cursor) && cursor >= 0) Cursor = cursor;
        if (changed) HostChanged?.Invoke(identityChanged);
        return root;
    }

    /// <summary>
    /// Sends one command bound to the observed Host identity and epoch with its own operation id. It is never retried:
    /// a dropped connection after sending surfaces as OutcomeUnknown and the caller asks <see cref="ResolveOutcomeAsync"/>.
    /// </summary>
    public async Task<JsonElement> SendCommandAsync(string action, object data, CancellationToken token = default, TimeSpan? commandTimeout = null)
    {
        var expectedHost = HostId;
        var expectedEpoch = HostEpoch;
        if (expectedHost == null || expectedEpoch == null)
            throw new HostException(HostFailure.Unreachable, "Not connected to the Host. Nothing was sent; wait for the connection and review the current state.");
        var creds = await ReadCredentialsAsync();
        var operationId = Guid.NewGuid().ToString();

        var payload = new Dictionary<string, object?>
        {
            ["action"] = action,
            ["data"] = data,
            ["operationId"] = operationId,
            ["expect"] = new { hostId = expectedHost, epoch = expectedEpoch }
        };

        using var timeout = CancellationTokenSource.CreateLinkedTokenSource(token);
        timeout.CancelAfter(commandTimeout ?? CommandTimeout);
        using var req = CreateRequest(HttpMethod.Post, creds, "/command");
        req.Content = JsonContent.Create(payload);

        HostException Uncertain(Exception? inner) =>
            new(HostFailure.OutcomeUnknown, Unconfirmed, operationId: operationId, epochAtSend: expectedEpoch, inner: inner, hostIdAtSend: expectedHost);

        // Cancelled before anything left this process: truly not sent. Any later cancellation may follow the request.
        token.ThrowIfCancellationRequested();
        HttpResponseMessage res;
        try
        {
            res = await client.SendAsync(req, timeout.Token);
        }
        catch (HttpRequestException ex) when (Refused(ex))
        {
            throw new HostException(HostFailure.Unreachable, "The Host is not running. Nothing was sent.", inner: ex);
        }
        catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException)
        {
            throw Uncertain(ex);
        }

        using (res)
        {
            string body;
            try { body = await res.Content.ReadAsStringAsync(timeout.Token); }
            catch (Exception ex) when (ex is HttpRequestException or OperationCanceledException or IOException)
            {
                // The status line arrived but the answer did not; a non-2xx status is still not proof of no effect.
                throw Uncertain(ex);
            }

            JsonElement root;
            try
            {
                using var doc = JsonDocument.Parse(body);
                root = doc.RootElement.Clone();
            }
            catch (JsonException ex)
            {
                if (res.IsSuccessStatusCode || (int)res.StatusCode >= 500) throw Uncertain(ex);
                throw new HostException(HostFailure.Refused, $"The Host refused the request (HTTP {(int)res.StatusCode}).");
            }

            if (res.IsSuccessStatusCode) return root;

            var code = root.Json("code");
            var message = root.Json("error") ?? "The Host refused the request.";
            if (res.StatusCode == System.Net.HttpStatusCode.Unauthorized)
                throw new HostException(HostFailure.AuthRejected, "The Host rejected this workstation's credential. Nothing was changed.", code);
            if (code is "HOST_IDENTITY_CHANGED" or "HOST_EPOCH_CHANGED")
            {
                InvalidateHost();
                throw new HostException(code == "HOST_IDENTITY_CHANGED" ? HostFailure.IdentityChanged : HostFailure.EpochChanged, message, code);
            }
            // The Host records these as "failed": the command may have partly applied before it stopped.
            if (code is "FAILED" or "HOST_UNAVAILABLE" || root.JsonObj("operation").Json("state") == "failed")
                throw new HostException(HostFailure.Failed, $"{PartlyApplied} (Host: {message})", code, operationId, expectedEpoch, hostIdAtSend: expectedHost);
            // A replayed or still-running operation id is the Host's ledger speaking, not a fresh refusal.
            if (code == "OPERATION_IN_PROGRESS")
                throw new HostException(HostFailure.OutcomeUnknown, $"{Unconfirmed} The Host reports it may still be executing.", code, operationId, expectedEpoch, hostIdAtSend: expectedHost);
            throw new HostException(HostFailure.Refused, message, code);
        }
    }

    /// <summary>
    /// Asks the Host, once and with the original operation id, what it recorded for an uncertain command; the command itself
    /// is never re-sent. The ledger lives in Host memory and is per epoch, so only the same Host in the same epoch can answer,
    /// and only "applied" and "refused" settle the outcome. Everything else keeps it explicitly unknown.
    /// </summary>
    public async Task<string> ResolveOutcomeAsync(HostException uncertain, CancellationToken token = default)
    {
        if (uncertain.Kind != HostFailure.OutcomeUnknown || uncertain.OperationId == null) return uncertain.Message;
        var op = $"(operation {uncertain.OperationId})";
        try
        {
            await GetStateAsync(token);
            if (uncertain.HostIdAtSend == null || HostId != uncertain.HostIdAtSend)
                return $"{Unconfirmed} A different Host answers now, so it was not asked about this operation {op}.";
            if (HostEpoch != uncertain.EpochAtSend)
                return $"{Unconfirmed} The Host restarted since, and its operation record does not survive a restart {op}.";
            var data = (await SendCommandAsync("operation.status", new { operationId = uncertain.OperationId }, token)).JsonObj("data");
            // An answer about another operation or another epoch is not an answer about this one.
            var state = data.Json("operationId") == uncertain.OperationId && data.Json("epoch") == uncertain.EpochAtSend ? data.Json("state") : null;
            return state switch
            {
                "applied" => $"The Host confirms this operation was applied {op}.",
                "refused" => $"The Host confirms this operation was refused {op}." + (data.Json("error") is { Length: > 0 } why ? $" {why}" : ""),
                "failed" => $"{PartlyApplied} {op}",
                "in_progress" => $"{Unconfirmed} The Host reports it may still be executing {op}.",
                "unknown" => $"{Unconfirmed} The Host has no record it can match to this operation; the record may have expired or the request may never have arrived {op}.",
                _ => $"{Unconfirmed} The Host's operation record could not be read {op}.",
            };
        }
        catch (HostException)
        {
            return $"{Unconfirmed} The Host cannot be asked right now {op}.";
        }
        catch (OperationCanceledException)
        {
            return $"{Unconfirmed} Checking was cancelled {op}.";
        }
    }

    /// <summary>
    /// Follows the Host's authenticated activity stream and calls <paramref name="onActivity"/> for each journal event
    /// (a wake-up signal; the snapshot stays the source of truth). Reconnects with bounded backoff until cancelled.
    /// </summary>
    public async Task RunEventStreamAsync(Action onActivity, CancellationToken token)
    {
        var backoff = TimeSpan.FromSeconds(2);
        while (!token.IsCancellationRequested)
        {
            try
            {
                if (!IsConnected) throw new HostException(HostFailure.Unreachable, "Waiting for a snapshot.");
                var creds = await ReadCredentialsAsync();
                using var req = CreateRequest(HttpMethod.Get, creds, $"/events?after={Cursor}");
                req.Headers.Accept.Add(new MediaTypeWithQualityHeaderValue("text/event-stream"));
                using var res = await client.SendAsync(req, HttpCompletionOption.ResponseHeadersRead, token);
                res.EnsureSuccessStatusCode();
                using var reader = new StreamReader(await res.Content.ReadAsStreamAsync(token));
                EventsConnected = true;
                backoff = TimeSpan.FromSeconds(2);
                while (!token.IsCancellationRequested)
                {
                    using var silence = CancellationTokenSource.CreateLinkedTokenSource(token);
                    silence.CancelAfter(StreamSilence);
                    var line = await reader.ReadLineAsync(silence.Token);
                    if (line == null) break;
                    if (line.StartsWith("id: ", StringComparison.Ordinal) && long.TryParse(line.AsSpan(4), out var seq) && seq > Cursor) Cursor = seq;
                    else if (line.StartsWith("data: ", StringComparison.Ordinal)) onActivity();
                }
            }
            catch (OperationCanceledException) when (token.IsCancellationRequested) { break; }
            catch (Exception) { /* Polling covers the gap; the loop reconnects below. */ }
            EventsConnected = false;
            try { await Task.Delay(backoff, token); } catch (OperationCanceledException) { break; }
            backoff = TimeSpan.FromSeconds(Math.Min(30, backoff.TotalSeconds * 2));
        }
        EventsConnected = false;
    }

    public void Dispose()
    {
        client.Dispose();
    }
}

public static class JsonRead
{
    /// <summary>A string property, or null when absent or of another kind. Never throws on Host data.</summary>
    public static string? Json(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.String ? v.GetString() : null;
    public static long JsonLong(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Number && v.TryGetInt64(out var n) ? n : 0;
    public static bool JsonBool(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.True;
    public static JsonElement JsonObj(this JsonElement e, string name) =>
        e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Object ? v : default;
    public static IEnumerable<JsonElement> JsonArr(this JsonElement e, string name)
    {
        if (e.ValueKind == JsonValueKind.Object && e.TryGetProperty(name, out var v) && v.ValueKind == JsonValueKind.Array)
            foreach (var item in v.EnumerateArray()) if (item.ValueKind == JsonValueKind.Object || item.ValueKind == JsonValueKind.String) yield return item;
    }
}
