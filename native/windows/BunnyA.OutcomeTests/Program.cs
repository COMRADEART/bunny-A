// MA5-S1R1: the shipped HostClient against real sockets that fail at chosen points of one command's life.
// A raw TCP endpoint plays the Host so a fault can land exactly after the Host has read the whole command.
// Default: scripted Host. `--real-host <port>` (token in BUNNY_REAL_HOST_TOKEN): the endpoint forwards to a real
// Bunny A Host, so "applied but the answer was lost" is a real execution reconciled from the real ledger.
using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json;
using BunnyA.Models;
using BunnyA.Services;

namespace BunnyA.Models { public sealed record HostCredentials(int Port, string Token); }

namespace BunnyA.OutcomeTests
{
    static class Program
    {
        static int checks, failures;
        static readonly List<object> results = new();
        static readonly string credsPath = Path.Combine(Path.GetTempPath(), $"bunny-s1r1-creds-{Guid.NewGuid():N}.json");
        // Wording that claims non-execution. It may never appear while an outcome is open.
        static readonly string[] Overclaims = { "did not run", "nothing changed", "Nothing was changed", "Nothing was sent", "no effect", "never ran" };

        static void Check(bool ok, string what, List<string> log)
        {
            checks++;
            log.Add((ok ? "PASS " : "FAIL ") + what);
            if (!ok) failures++;
        }

        static void Creds(int port, string token = "s1r1-test-token") =>
            File.WriteAllText(credsPath, JsonSerializer.Serialize(new { port, token }));

        static async Task Scenario(string name, Func<List<string>, Task> body)
        {
            var log = new List<string>();
            try { await body(log); }
            catch (Exception ex) { Check(false, $"unexpected {ex.GetType().Name}: {ex.Message}", log); }
            results.Add(new { scenario = name, checks = log });
            Console.WriteLine($"{(log.Any(l => l.StartsWith("FAIL")) ? "FAIL" : "pass")}  {name}");
            foreach (var l in log) Console.WriteLine($"      {l}");
        }

        /// <summary>Sends one consequential command expecting an uncertain outcome, then asks the Host once.</summary>
        static async Task<(HostException ex, string outcome)> Uncertain(FaultHost h, HostClient hc, List<string> log, CancellationToken resolveToken = default)
        {
            HostException? caught = null;
            var (hostAtSend, epochAtSend) = (hc.HostId, hc.HostEpoch);
            try { await hc.SendCommandAsync("submit", new { prompt = "s1r1", mode = "fast" }); }
            catch (HostException ex) { caught = ex; }
            Check(caught?.Kind == HostFailure.OutcomeUnknown, $"classified OutcomeUnknown (got {caught?.Kind.ToString() ?? "success"})", log);
            Check(caught?.OperationId != null && caught.HostIdAtSend == hostAtSend && caught.EpochAtSend == epochAtSend, "original operation id, Host id and epoch kept", log);
            var outcome = await hc.ResolveOutcomeAsync(caught!, resolveToken);
            log.Add("outcome: " + outcome);
            return (caught!, outcome);
        }

        static void NoReplay(FaultHost h, HostException ex, List<string> log)
        {
            var sends = h.Commands.Count(r => r.OperationId == ex.OperationId);
            var queries = h.StatusQueries.ToList();
            Check(h.Commands.Count() <= 1 && sends <= 1, $"the command was never re-sent (Host received {h.Commands.Count()} command(s))", log);
            Check(queries.All(q => q.Asked == ex.OperationId) && queries.Count <= 1, $"reconciliation asked only about the original operation, at most once ({queries.Count})", log);
        }

        static void Open(string outcome, List<string> log)
        {
            Check(outcome.StartsWith(HostClient.Unconfirmed), "user sees the outcome-unknown message", log);
            Check(!Overclaims.Any(o => outcome.Contains(o, StringComparison.OrdinalIgnoreCase)), "no wording claims it did not run", log);
        }

        static async Task<(FaultHost, HostClient)> Connected()
        {
            var h = new FaultHost();
            Creds(h.Port);
            var hc = new HostClient();
            await hc.GetStateAsync(); // learns identity and leaves a pooled keep-alive connection, as the app does
            return (h, hc);
        }

        static async Task<int> Main(string[] args)
        {
            Environment.SetEnvironmentVariable("BUNNY_HOST_CREDENTIALS_FILE", credsPath);
            try
            {
                if (args.Length == 2 && args[0] == "--real-host") await RealHost(int.Parse(args[1]));
                else await Scripted();
            }
            finally { File.Delete(credsPath); }
            Console.WriteLine($"OutcomeTests: {checks - failures}/{checks} checks passed, {failures} failed.");
            var outFile = Environment.GetEnvironmentVariable("BUNNY_S1R1_RESULTS");
            if (!string.IsNullOrEmpty(outFile))
                File.WriteAllText(outFile, JsonSerializer.Serialize(new { checks, failures, results }, new JsonSerializerOptions { WriteIndented = true }));
            return failures == 0 && checks > 0 ? 0 : 1;
        }

        static async Task Scripted()
        {
            await Scenario("W1 connection reset after headers, before the body was read", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.DropNextBeforeBody = true;
                    var (ex, outcome) = await Uncertain(h, hc, log);
                    Check(!h.Commands.Any(), "scripted Host never read a command body", log);
                    // Bunny A cannot know where the reset happened, so even this stays open; the ledger says unknown.
                    Open(outcome, log);
                    NoReplay(h, ex, log);
                }
            });

            await Scenario("W2 command applied, answer lost (reset after the Host read it)", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "applied"; return Task.FromResult<Reply>(new Drop()); };
                    var (ex, outcome) = await Uncertain(h, hc, log);
                    Check(h.Commands.Count() == 1, "the Host received the command exactly once", log);
                    Check(outcome.StartsWith("The Host confirms this operation was applied"), "reconciled to applied from the Host ledger", log);
                    NoReplay(h, ex, log);
                }
            });

            await Scenario("W3 command refused by the Host", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = r =>
                    {
                        h.Ledger[r.OperationId!] = "refused";
                        return Task.FromResult<Reply>(new Answer(409, JsonSerializer.Serialize(new { error = "Approval required on Windows Host.", code = "WORKSTATION_REQUIRED", operation = new { id = r.OperationId, state = "refused", replayed = false } })));
                    };
                    HostException? got = null;
                    try { await hc.SendCommandAsync("approve", new { id = "t1" }); } catch (HostException ex) { got = ex; }
                    Check(got?.Kind == HostFailure.Refused && got.Message == "Approval required on Windows Host.", "direct refusal shown as the Host worded it", log);
                    // Same refusal, but the answer was lost: the ledger settles it.
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "refused"; return Task.FromResult<Reply>(new Drop()); };
                    h.Received.Clear();
                    var (ex2, outcome) = await Uncertain(h, hc, log);
                    Check(outcome.StartsWith("The Host confirms this operation was refused"), "lost refusal reconciled to refused", log);
                    NoReplay(h, ex2, log);
                }
            });

            await Scenario("W4 command failed after a partial effect", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = r =>
                    {
                        h.Ledger[r.OperationId!] = "failed";
                        return Task.FromResult<Reply>(new Answer(400, JsonSerializer.Serialize(new { error = "Host command failed. Inspect operation state before retrying.", code = "FAILED", operation = new { id = r.OperationId, state = "failed", replayed = false } })));
                    };
                    HostException? got = null;
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { got = ex; }
                    Check(got?.Kind == HostFailure.Failed, $"a FAILED answer is Failed, not Refused (got {got?.Kind})", log);
                    Check(got?.Message.Contains("may have partly taken effect") == true && !Overclaims.Any(o => got.Message.Contains(o, StringComparison.OrdinalIgnoreCase)), "says it may have partly taken effect", log);
                    HostException? unavailable = null;
                    h.OnCommand = r => Task.FromResult<Reply>(new Answer(503, JsonSerializer.Serialize(new { error = "The Host is shutting down.", code = "HOST_UNAVAILABLE", operation = new { id = r.OperationId, state = "failed", replayed = false } })));
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { unavailable = ex; }
                    Check(unavailable?.Kind == HostFailure.Failed, "HOST_UNAVAILABLE mid-command is Failed as the Host records it", log);
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "failed"; return Task.FromResult<Reply>(new Drop()); };
                    h.Received.Clear();
                    var (ex2, outcome) = await Uncertain(h, hc, log);
                    Check(outcome.StartsWith(HostClient.PartlyApplied), "lost failure reconciled to 'may have partly taken effect'", log);
                    Check(!outcome.Contains("refused") && !Overclaims.Any(o => outcome.Contains(o, StringComparison.OrdinalIgnoreCase)), "never described as refused or without effect", log);
                    NoReplay(h, ex2, log);
                }
            });

            await Scenario("W5 operation still in progress", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "in_progress"; return Task.FromResult<Reply>(new Drop()); };
                    var (ex, outcome) = await Uncertain(h, hc, log);
                    Open(outcome, log);
                    Check(outcome.Contains("may still be executing"), "says it may still be executing", log);
                    NoReplay(h, ex, log);
                }
            });

            await Scenario("W6 ledger answers unknown", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = _ => Task.FromResult<Reply>(new Drop()); // received, nothing recorded
                    var (ex, outcome) = await Uncertain(h, hc, log);
                    Open(outcome, log);
                    Check(outcome.Contains("no record it can match"), "unknown is reported as unknown, not as non-execution", log);
                    NoReplay(h, ex, log);
                }
            });

            await Scenario("W7 ledger entry expired before reconciliation", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "applied"; return Task.FromResult<Reply>(new Drop()); };
                    h.OnStatus = r => { h.Ledger.Remove(r.Asked!); return Task.FromResult<Reply>(new Answer(200, JsonSerializer.Serialize(new { data = new { operationId = r.Asked, state = "unknown", epoch = h.Epoch } }))); };
                    var (ex, outcome) = await Uncertain(h, hc, log);
                    Open(outcome, log);
                    NoReplay(h, ex, log);
                }
            });

            await Scenario("W8 Host restarted before reconciliation (new epoch)", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "applied"; h.Epoch = "epoch-2"; h.Ledger.Clear(); return Task.FromResult<Reply>(new Drop()); };
                    HostException? caught = null;
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { caught = ex; }
                    var outcome = await hc.ResolveOutcomeAsync(caught!);
                    log.Add("outcome: " + outcome);
                    Check(caught?.EpochAtSend == "epoch-1", "epoch at send preserved", log);
                    Open(outcome, log);
                    Check(outcome.Contains("restarted"), "says the Host restarted", log);
                    Check(!h.StatusQueries.Any(), "the new epoch's ledger was not asked about the old epoch's operation", log);
                    NoReplay(h, caught!, log);
                }
            });

            await Scenario("W9 a different Host answers reconciliation", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    h.OnCommand = r => { h.HostId = "host-B"; return Task.FromResult<Reply>(new Drop()); };
                    HostException? caught = null;
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { caught = ex; }
                    var outcome = await hc.ResolveOutcomeAsync(caught!);
                    log.Add("outcome: " + outcome);
                    Check(caught?.HostIdAtSend == "host-A", "Host identity at send preserved", log);
                    Open(outcome, log);
                    Check(outcome.Contains("different Host"), "says a different Host answers", log);
                    Check(!h.StatusQueries.Any(), "the different Host was not asked", log);
                    NoReplay(h, caught!, log);
                }
            });

            await Scenario("W10 malformed answers", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    // 200 with an unreadable body: accepted, outcome unknown.
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "applied"; return Task.FromResult<Reply>(new Answer(200, "<html>proxy</html>")); };
                    HostException? got = null;
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { got = ex; }
                    Check(got?.Kind == HostFailure.OutcomeUnknown, "unreadable 2xx answer is OutcomeUnknown", log);
                    // Answer cut off mid-body.
                    h.OnCommand = r => Task.FromResult<Reply>(new CutBody(200, "{\"snapshot\":"));
                    got = null;
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { got = ex; }
                    Check(got?.Kind == HostFailure.OutcomeUnknown, "answer cut off mid-body is OutcomeUnknown", log);
                    // Unreadable 5xx: not a refusal.
                    h.OnCommand = r => Task.FromResult<Reply>(new Answer(502, "bad gateway"));
                    got = null;
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { got = ex; }
                    Check(got?.Kind == HostFailure.OutcomeUnknown, "unreadable 5xx is OutcomeUnknown, not Refused", log);
                    // Operation-status replies that do not answer about this operation.
                    foreach (var (label, reply) in new (string, Func<Req, string>)[]
                    {
                        ("non-JSON", _ => "nope"),
                        ("state missing", r => JsonSerializer.Serialize(new { data = new { operationId = r.Asked, epoch = h.Epoch } })),
                        ("state not a string", r => JsonSerializer.Serialize(new { data = new { operationId = r.Asked, state = 1, epoch = h.Epoch } })),
                        ("unrecognised state", r => JsonSerializer.Serialize(new { data = new { operationId = r.Asked, state = "done", epoch = h.Epoch } })),
                        ("another operation's record", r => JsonSerializer.Serialize(new { data = new { operationId = "someone-else", state = "applied", epoch = h.Epoch } })),
                        ("another epoch's record", r => JsonSerializer.Serialize(new { data = new { operationId = r.Asked, state = "applied", epoch = "epoch-0" } })),
                    })
                    {
                        h.Received.Clear();
                        h.OnCommand = _ => Task.FromResult<Reply>(new Drop());
                        h.OnStatus = r => Task.FromResult<Reply>(new Answer(200, reply(r)));
                        var sub = new List<string>();
                        var (ex, outcome) = await Uncertain(h, hc, sub);
                        Open(outcome, sub);
                        NoReplay(h, ex, sub);
                        foreach (var l in sub) log.Add($"[{label}] {l}");
                    }
                }
            });

            await Scenario("W11 user cancellation", async log =>
            {
                var (h, hc) = await Connected();
                using (h) using (hc)
                {
                    using (var already = new CancellationTokenSource())
                    {
                        already.Cancel();
                        var cancelledBeforeSend = false;
                        try { await hc.SendCommandAsync("submit", new { prompt = "x" }, already.Token); }
                        catch (OperationCanceledException) { cancelledBeforeSend = true; }
                        Check(cancelledBeforeSend && !h.Commands.Any(), "cancelled before sending: nothing reached the Host", log);
                    }
                    h.OnCommand = r => { h.Ledger[r.OperationId!] = "in_progress"; return Task.FromResult<Reply>(new Stall()); };
                    using var cts = new CancellationTokenSource();
                    HostException? caught = null;
                    var send = hc.SendCommandAsync("submit", new { prompt = "x" }, cts.Token);
                    for (var i = 0; i < 100 && !h.Commands.Any(); i++) await Task.Delay(20);
                    cts.Cancel();
                    try { await send; } catch (HostException ex) { caught = ex; }
                    Check(h.Commands.Count() == 1, "the Host had received the command when the user cancelled", log);
                    Check(caught?.Kind == HostFailure.OutcomeUnknown, $"cancellation after sending is OutcomeUnknown, not 'cancelled' (got {caught?.Kind.ToString() ?? "no HostException"})", log);
                    var outcome = await hc.ResolveOutcomeAsync(caught!, cts.Token);
                    log.Add("outcome: " + outcome);
                    Open(outcome, log);
                    NoReplay(h, caught!, log);
                }
            });

            await Scenario("W12 connection refused before dispatch; no duplicate after reconnect", async log =>
            {
                var (h, hc) = await Connected();
                using (hc)
                {
                    var port = h.Port;
                    h.Dispose(); // the Host process is gone; the pooled connection is dead
                    HostException? got = null;
                    try { await hc.SendCommandAsync("submit", new { prompt = "x" }); } catch (HostException ex) { got = ex; }
                    Check(got?.Kind == HostFailure.Unreachable && got.Message.Contains("Nothing was sent"), $"connection refused is the one 'Nothing was sent' case (got {got?.Kind}: {got?.Message})", log);
                }
                // A Host that resets the first command's answer, then comes back: the app reconnects for state and
                // reconciliation only. The first command reaches the Host once; nothing re-sends it.
                var (h2, hc2) = await Connected();
                using (h2) using (hc2)
                {
                    h2.OnCommand = r => { h2.Ledger[r.OperationId!] = "applied"; return Task.FromResult<Reply>(new Drop()); };
                    var (ex, outcome) = await Uncertain(h2, hc2, log);
                    await hc2.GetStateAsync();
                    await hc2.GetStateAsync();
                    Check(h2.Commands.Count() == 1 && h2.Commands.Single().OperationId == ex.OperationId, "exactly one copy of the command after reconnecting", log);
                    NoReplay(h2, ex, log);
                }
            });
        }

        static async Task RealHost(int upstreamPort)
        {
            var token = Environment.GetEnvironmentVariable("BUNNY_REAL_HOST_TOKEN") ?? throw new InvalidOperationException("BUNNY_REAL_HOST_TOKEN");
            using var upstream = new HttpClient(new SocketsHttpHandler { PooledConnectionLifetime = TimeSpan.Zero }) { BaseAddress = new Uri($"http://127.0.0.1:{upstreamPort}") };
            async Task<Answer> Forward(Req r)
            {
                using var msg = new HttpRequestMessage(new HttpMethod(r.Method), r.Path);
                if (r.Auth != null) msg.Headers.TryAddWithoutValidation("Authorization", r.Auth);
                if (r.Method == "POST") msg.Content = new StringContent(r.Body, Encoding.UTF8, "application/json");
                using var res = await upstream.SendAsync(msg);
                return new Answer((int)res.StatusCode, await res.Content.ReadAsStringAsync());
            }
            async Task<int> Tasks()
            {
                using var msg = new HttpRequestMessage(HttpMethod.Get, "/state");
                msg.Headers.TryAddWithoutValidation("Authorization", $"Bearer {token}");
                using var res = await upstream.SendAsync(msg);
                using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
                return doc.RootElement.GetProperty("tasks").GetArrayLength();
            }

            await Scenario("R1 real Host: submit applied, answer lost, reconciled from the real ledger", async log =>
            {
                using var h = new FaultHost();
                h.OnState = async r => await Forward(r);
                h.OnStatus = async r => await Forward(r);
                h.OnCommand = async r => { var applied = await Forward(r); log.Add($"real Host answered HTTP {applied.Status} before the reset"); return new Drop(); };
                Creds(h.Port, token);
                using var hc = new HostClient();
                await hc.GetStateAsync();
                var before = await Tasks();
                var (ex, outcome) = await Uncertain(h, hc, log);
                var after = await Tasks();
                Check(after == before + 1, $"the real Host created exactly one task ({before} -> {after})", log);
                Check(outcome.StartsWith("The Host confirms this operation was applied"), "reconciled to applied from the real Host's ledger", log);
                await hc.GetStateAsync();
                Check(await Tasks() == after, "no second task after reconnecting", log);
                NoReplay(h, ex, log);
            });

            await Scenario("R2 real Host: an operation it never received stays unknown", async log =>
            {
                using var h = new FaultHost();
                h.OnState = async r => await Forward(r);
                h.OnStatus = async r => await Forward(r);
                Creds(h.Port, token);
                using var hc = new HostClient();
                await hc.GetStateAsync();
                var neverSent = new HostException(HostFailure.OutcomeUnknown, HostClient.Unconfirmed, operationId: Guid.NewGuid().ToString(), epochAtSend: hc.HostEpoch, hostIdAtSend: hc.HostId);
                var outcome = await hc.ResolveOutcomeAsync(neverSent);
                log.Add("outcome: " + outcome);
                Open(outcome, log);
                Check(outcome.Contains("no record it can match"), "real Host's 'unknown' is shown as unknown", log);
            });
        }
    }
}
