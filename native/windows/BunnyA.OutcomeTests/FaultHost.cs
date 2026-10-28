// MA5-S1R1: a raw TCP endpoint that plays the Bunny A Host for one command, so a fault can land at an exact point:
// before the body is read, after the whole command was read, mid-answer, or never answered.
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using BunnyA.Services;

namespace BunnyA.OutcomeTests
{
    sealed record Req(string Method, string Path, string Body, string? Auth)
    {
        JsonElement Json => Body.Length > 0 ? JsonDocument.Parse(Body).RootElement : default;
        public string? Action => Json.Json("action");
        public string? OperationId => Json.Json("operationId");
        public string? Asked => Json.JsonObj("data").Json("operationId");
    }

    abstract record Reply;
    sealed record Answer(int Status, string Body) : Reply;
    sealed record Drop : Reply;                       // the whole request was read; the connection is reset with no answer
    sealed record CutBody(int Status, string Part) : Reply; // a status line and part of the answer, then a reset
    sealed record Stall : Reply;                      // read, then never answered

    sealed class FaultHost : IDisposable
    {
        readonly TcpListener listener = new(IPAddress.Loopback, 0);
        readonly CancellationTokenSource stop = new();
        readonly List<TcpClient> open = new();
        public int Port => ((IPEndPoint)listener.LocalEndpoint).Port;
        public string HostId = "host-A", Epoch = "epoch-1";
        public readonly Dictionary<string, string> Ledger = new();
        public readonly List<Req> Received = new();
        /// <summary>Reset the next command after its headers, before its body has been read.</summary>
        public bool DropNextBeforeBody;
        public Func<Req, Task<Reply>>? OnCommand;
        public Func<Req, Task<Reply>>? OnStatus;
        public Func<Req, Task<Reply>>? OnState;

        public IEnumerable<Req> Commands => Received.Where(r => r.Path == "/command" && r.Action != "operation.status");
        public IEnumerable<Req> StatusQueries => Received.Where(r => r.Action == "operation.status");

        public FaultHost() { listener.Start(); _ = AcceptAsync(); }

        async Task AcceptAsync()
        {
            while (!stop.IsCancellationRequested)
            {
                TcpClient c;
                try { c = await listener.AcceptTcpClientAsync(stop.Token); } catch { return; }
                lock (open) open.Add(c);
                _ = ServeAsync(c);
            }
        }

        static void Reset(TcpClient c) { try { c.Client.LingerState = new LingerOption(true, 0); c.Close(); } catch { } }

        async Task ServeAsync(TcpClient c)
        {
            var s = c.GetStream();
            try
            {
                for (;;) // keep-alive: several requests may share one connection, as HttpClient pools them
                {
                    var head = await ReadHeadAsync(s);
                    if (head == null) { c.Close(); return; }
                    var lines = head.Split("\r\n");
                    var parts = lines[0].Split(' ');
                    var headers = lines.Skip(1).Where(l => l.Contains(':')).ToDictionary(l => l[..l.IndexOf(':')].Trim().ToLowerInvariant(), l => l[(l.IndexOf(':') + 1)..].Trim());
                    if (parts[1] == "/command" && DropNextBeforeBody) { DropNextBeforeBody = false; Reset(c); return; }
                    var body = await ReadBodyAsync(s, headers);
                    var req = new Req(parts[0], parts[1], body, headers.GetValueOrDefault("authorization"));
                    lock (Received) Received.Add(req);
                    var reply = req.Path == "/state" ? await (OnState ?? DefaultState)(req)
                        : req.Action == "operation.status" ? await (OnStatus ?? DefaultStatus)(req)
                        : await (OnCommand ?? DefaultCommand)(req);
                    switch (reply)
                    {
                        case Answer a: await WriteAsync(s, a.Status, a.Body, a.Body); break;
                        case CutBody cut: await WriteAsync(s, cut.Status, cut.Part + new string(' ', 200), cut.Part); Reset(c); return;
                        case Drop: Reset(c); return;
                        case Stall: try { await s.ReadAsync(new byte[1], stop.Token); } catch { } Reset(c); return;
                    }
                }
            }
            catch { Reset(c); }
        }

        static async Task<string?> ReadHeadAsync(NetworkStream s)
        {
            var buf = new List<byte>();
            var one = new byte[1];
            while (true)
            {
                if (await s.ReadAsync(one) == 0) return buf.Count == 0 ? null : throw new IOException("closed mid-head");
                buf.Add(one[0]);
                if (buf.Count >= 4 && buf[^4] == '\r' && buf[^3] == '\n' && buf[^2] == '\r' && buf[^1] == '\n')
                    return Encoding.ASCII.GetString(buf.ToArray(), 0, buf.Count - 4);
            }
        }

        static async Task<string> ReadLineAsync(NetworkStream s)
        {
            var sb = new StringBuilder();
            var one = new byte[1];
            while (await s.ReadAsync(one) == 1) { if (one[0] == '\n') break; if (one[0] != '\r') sb.Append((char)one[0]); }
            return sb.ToString();
        }

        static async Task<string> ReadBodyAsync(NetworkStream s, Dictionary<string, string> headers)
        {
            var body = new MemoryStream();
            if (headers.TryGetValue("content-length", out var len))
            {
                var buf = new byte[int.Parse(len)];
                await s.ReadExactlyAsync(buf);
                body.Write(buf);
            }
            else if (headers.GetValueOrDefault("transfer-encoding")?.Contains("chunked") == true)
            {
                for (;;)
                {
                    var size = Convert.ToInt32((await ReadLineAsync(s)).Split(';')[0], 16);
                    if (size == 0) { while ((await ReadLineAsync(s)).Length > 0) { } break; }
                    var buf = new byte[size];
                    await s.ReadExactlyAsync(buf);
                    body.Write(buf);
                    await ReadLineAsync(s);
                }
            }
            return Encoding.UTF8.GetString(body.ToArray());
        }

        static async Task WriteAsync(NetworkStream s, int status, string announced, string sent)
        {
            var bytes = Encoding.UTF8.GetBytes(sent);
            var head = $"HTTP/1.1 {status} X\r\nContent-Type: application/json\r\nContent-Length: {Encoding.UTF8.GetByteCount(announced)}\r\n\r\n";
            await s.WriteAsync(Encoding.ASCII.GetBytes(head));
            await s.WriteAsync(bytes);
            await s.FlushAsync();
        }

        Task<Reply> DefaultState(Req _) =>
            Task.FromResult<Reply>(new Answer(200, JsonSerializer.Serialize(new { hostIdentity = new { hostId = HostId, epoch = Epoch }, cursor = 0, tasks = Array.Empty<object>() })));

        Task<Reply> DefaultStatus(Req r) => Task.FromResult<Reply>(new Answer(200, JsonSerializer.Serialize(new
        {
            data = new { operationId = r.Asked, state = Ledger.GetValueOrDefault(r.Asked ?? "", "unknown"), epoch = Epoch }
        })));

        Task<Reply> DefaultCommand(Req r)
        {
            Ledger[r.OperationId!] = "applied";
            return Task.FromResult<Reply>(new Answer(200, JsonSerializer.Serialize(new { snapshot = new { }, operation = new { id = r.OperationId, state = "applied", replayed = false } })));
        }

        public void Dispose()
        {
            stop.Cancel();
            listener.Stop();
            lock (open) foreach (var c in open) Reset(c);
        }
    }
}
