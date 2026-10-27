using System;
using System.Collections.Generic;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using BunnyA.Models;

namespace BunnyA.Services;

public sealed class HostClient : IDisposable
{
    private readonly HttpClient client = new(new HttpClientHandler { AllowAutoRedirect = false, UseProxy = false })
    {
        Timeout = TimeSpan.FromSeconds(30)
    };

    public string? HostId { get; private set; }
    public string? HostEpoch { get; private set; }
    public bool IsConnected => !string.IsNullOrEmpty(HostId) && !string.IsNullOrEmpty(HostEpoch);



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
            throw new InvalidOperationException("Host credential path is not configured or file not found.");

        using var doc = JsonDocument.Parse(await File.ReadAllTextAsync(path));
        var port = doc.RootElement.GetProperty("port").GetInt32();
        var token = doc.RootElement.GetProperty("token").GetString();
        if (port is < 1 or > 65535 || string.IsNullOrWhiteSpace(token))
            throw new InvalidOperationException("Host credentials in file are invalid.");

        return new HostCredentials(port, token);
    }

    private static HttpRequestMessage CreateRequest(HttpMethod method, HostCredentials creds, string endpoint)
    {
        var req = new HttpRequestMessage(method, $"http://127.0.0.1:{creds.Port}{endpoint}");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", creds.Token);
        return req;
    }

    public async Task<JsonDocument> GetStateAsync(CancellationToken token = default)
    {
        var creds = await ReadCredentialsAsync();
        using var req = CreateRequest(HttpMethod.Get, creds, "/state");
        using var res = await client.SendAsync(req, token);
        res.EnsureSuccessStatusCode();

        var stream = await res.Content.ReadAsStreamAsync(token);
        var doc = await JsonDocument.ParseAsync(stream, cancellationToken: token);

        if (doc.RootElement.TryGetProperty("hostIdentity", out var identity))
        {
            HostId = identity.GetProperty("hostId").GetString();
            HostEpoch = identity.GetProperty("epoch").GetString();
        }

        return doc;
    }

    public async Task<JsonElement> SendCommandAsync(string action, object data, CancellationToken token = default)
    {
        var creds = await ReadCredentialsAsync();
        var expectedHost = HostId;
        var expectedEpoch = HostEpoch;

        var payload = new Dictionary<string, object?>
        {
            ["action"] = action,
            ["data"] = data,
            ["operationId"] = Guid.NewGuid().ToString()
        };

        if (expectedHost != null && expectedEpoch != null)
        {
            payload["expect"] = new { hostId = expectedHost, epoch = expectedEpoch };
        }

        using var req = CreateRequest(HttpMethod.Post, creds, "/command");
        req.Content = JsonContent.Create(payload);

        using var res = await client.SendAsync(req, token);
        if (!res.IsSuccessStatusCode)
        {
            var errBody = await res.Content.ReadAsStringAsync(token);
            try
            {
                using var errDoc = JsonDocument.Parse(errBody);
                if (errDoc.RootElement.TryGetProperty("error", out var errProp))
                {
                    var msg = errProp.GetString() ?? "Command failed.";
                    if (errDoc.RootElement.TryGetProperty("code", out var codeProp))
                    {
                        var code = codeProp.GetString();
                        if (code == "HOST_IDENTITY_CHANGED" || code == "HOST_EPOCH_CHANGED")
                        {
                            InvalidateHost();
                        }
                        throw new InvalidOperationException($"[{code}] {msg}");
                    }
                    throw new InvalidOperationException(msg);
                }
            }
            catch (JsonException) { }
            res.EnsureSuccessStatusCode();
        }

        var stream = await res.Content.ReadAsStreamAsync(token);
        using var doc = await JsonDocument.ParseAsync(stream, cancellationToken: token);
        return doc.RootElement.Clone();
    }

    public void Dispose()
    {
        client.Dispose();
    }
}
