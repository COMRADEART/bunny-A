package com.routeragent.jev;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetAddress;
import java.net.ServerSocket;
import java.net.Socket;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * MA5-S1R1: HostExchange (the companion's command transport) against real sockets that fail at chosen points of one
 * request. Plain HTTP on loopback stands in for the transport only; production still opens HTTPS through
 * NativeCompanionClient.open, whose TLS validation this test does not touch. Runs without Android (scripts/build-android.ps1).
 */
public final class HostExchangeTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; System.out.println("  PASS " + what); }

    enum Mode { ANSWER, RESET_MID_BODY, RESET_AFTER_BODY, CLOSE_AFTER_BODY, STALL, CUT_ANSWER }

    /** A scripted workstation: counts every request whose body it read completely, then misbehaves as told. */
    static final class FaultServer implements AutoCloseable {
        final ServerSocket socket = new ServerSocket(0, 50, InetAddress.getLoopbackAddress());
        final AtomicInteger received = new AtomicInteger(), started = new AtomicInteger();
        volatile Mode mode = Mode.ANSWER;
        volatile int status = 200;
        volatile String answer = "{\"ok\":true}";
        final CountDownLatch release = new CountDownLatch(1);

        FaultServer() throws IOException {
            Thread t = new Thread(() -> { while (!socket.isClosed()) try { Socket s = socket.accept(); new Thread(() -> serve(s)).start(); } catch (IOException e) { return; } });
            t.setDaemon(true); t.start();
        }
        int port() { return socket.getLocalPort(); }

        private void serve(Socket s) {
            try (Socket c = s) {
                InputStream in = c.getInputStream();
                for (;;) {
                    String head = readHead(in);
                    if (head == null) return;
                    started.incrementAndGet();
                    int length = 0;
                    for (String line : head.split("\r\n")) if (line.toLowerCase().startsWith("content-length:")) length = Integer.parseInt(line.substring(15).trim());
                    Mode m = head.startsWith("GET ") && mode != Mode.STALL ? Mode.ANSWER : mode;
                    if (m == Mode.RESET_MID_BODY) { readN(in, Math.min(length, 1024)); reset(c); return; }
                    readN(in, length);
                    received.incrementAndGet();
                    OutputStream out = c.getOutputStream();
                    switch (m) {
                        case RESET_AFTER_BODY: reset(c); return;
                        case CLOSE_AFTER_BODY: return; // orderly close, no answer
                        case STALL: release.await(10, TimeUnit.SECONDS); reset(c); return;
                        case CUT_ANSWER: write(out, status, answer, answer.length() + 200); reset(c); return;
                        default: write(out, status, answer, answer.getBytes(StandardCharsets.UTF_8).length);
                    }
                }
            } catch (Exception ignored) { }
        }
        private static void reset(Socket c) { try { c.setSoLinger(true, 0); c.close(); } catch (IOException ignored) { } }
        private static void write(OutputStream out, int status, String body, int announced) throws IOException {
            out.write(("HTTP/1.1 " + status + " X\r\nContent-Type: application/json\r\nContent-Length: " + announced + "\r\n\r\n" + body).getBytes(StandardCharsets.UTF_8));
            out.flush();
        }
        private static String readHead(InputStream in) throws IOException {
            ByteArrayOutputStream b = new ByteArrayOutputStream();
            int x, n = 0;
            while ((x = in.read()) != -1) { b.write(x); n = (x == '\r' || x == '\n') ? n + 1 : 0; if (n == 4) return b.toString("ISO-8859-1"); }
            return null;
        }
        private static void readN(InputStream in, int n) throws IOException {
            byte[] buf = new byte[8192];
            while (n > 0) { int r = in.read(buf, 0, Math.min(buf.length, n)); if (r < 0) throw new IOException("eof"); n -= r; }
        }
        @Override public void close() throws IOException { release.countDown(); socket.close(); }
    }

    private static HttpURLConnection post(int port) throws IOException {
        HttpURLConnection c = (HttpURLConnection) new URL("http://127.0.0.1:" + port + "/api/bunny-native-v1-state").openConnection();
        c.setRequestMethod("POST"); c.setConnectTimeout(2000); c.setReadTimeout(4000);
        return c;
    }
    private static byte[] command(String operationId, int padding) {
        StringBuilder pad = new StringBuilder(); for (int i = 0; i < padding; i++) pad.append('x');
        return ("{\"action\":\"submit\",\"operationId\":\"" + operationId + "\",\"data\":{\"prompt\":\"" + pad + "\"}}").getBytes(StandardCharsets.UTF_8);
    }
    private static HostExchange.Failure sendExpectingFailure(HttpURLConnection c, byte[] body, String operationId) {
        try { HostExchange.send(c, body, operationId); return null; }
        catch (HostExchange.Failure f) { return f; }
        finally { c.disconnect(); }
    }
    private static void uncertain(HostExchange.Failure f, String operationId, String what) {
        check(f != null && f.kind == HostExchange.Failure.OUTCOME_UNKNOWN, what + ": outcome unknown (got " + (f == null ? "success" : f.kind + " " + f.getMessage()) + ")");
        check(operationId.equals(f.operationId), what + ": the original operation id is kept");
        check(f.getMessage().startsWith(HostExchange.UNCONFIRMED) && !f.getMessage().contains("Nothing was sent") && !f.getMessage().contains("not sent"), what + ": conservative message, no claim it was not sent");
    }

    public static void main(String[] args) throws Exception {
        System.out.println("A1 connection failure before dispatch");
        int closedPort; try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getLoopbackAddress())) { closedPort = s.getLocalPort(); }
        HostExchange.Failure f = sendExpectingFailure(post(closedPort), command("a1", 0), "a1");
        check(f != null && f.kind == HostExchange.Failure.NETWORK && f.getMessage().contains("Nothing was sent"), "connection refused is the one case reported as not sent");

        try (FaultServer server = new FaultServer()) {
            System.out.println("A2 connection lost during the request body");
            server.mode = Mode.RESET_MID_BODY;
            String op = UUID.randomUUID().toString();
            uncertain(sendExpectingFailure(post(server.port()), command(op, 4_000_000), op), op, "reset mid-body");
            check(server.received.get() == 0 && server.started.get() == 1, "the server saw the start of the request exactly once and nothing re-sent it");

            System.out.println("A3 answer lost after the server read the whole command");
            for (Mode lost : new Mode[] { Mode.RESET_AFTER_BODY, Mode.CLOSE_AFTER_BODY }) {
                server.received.set(0); server.mode = lost;
                op = UUID.randomUUID().toString();
                uncertain(sendExpectingFailure(post(server.port()), command(op, 10), op), op, lost.name());
                check(server.received.get() == 1, lost + ": the server received the command exactly once (no silent re-send)");
            }

            System.out.println("A4 timeout after the server received the command");
            server.received.set(0); server.mode = Mode.STALL;
            HttpURLConnection slow = post(server.port()); slow.setReadTimeout(300);
            op = UUID.randomUUID().toString();
            uncertain(sendExpectingFailure(slow, command(op, 10), op), op, "read timeout");
            check(server.received.get() == 1, "timed-out command reached the server exactly once");

            System.out.println("A5-A7 Host answers: refusal, identity, epoch");
            server.mode = Mode.ANSWER; server.status = 409;
            server.answer = "{\"code\":\"WORKSTATION_REQUIRED\",\"error\":\"Approval required on Windows Host.\"}";
            HttpURLConnection c = post(server.port());
            HostExchange.Answer a = HostExchange.send(c, command("a5", 0), "a5"); c.disconnect();
            check(a.status == 409 && a.body.equals(server.answer), "a Host refusal arrives intact as an answer, not a transport failure");
            f = HostExchange.refusal(409, "WORKSTATION_REQUIRED", "Approval required on Windows Host.", 0, "a5");
            check(f.kind == HostExchange.Failure.REFUSED && f.getMessage().equals("Approval required on Windows Host."), "refusal shown as the Host worded it");
            f = HostExchange.refusal(409, "HOST_IDENTITY_CHANGED", "This is not the Bunny-A Host this view came from.", 0, "a6");
            check(f.kind == HostExchange.Failure.IDENTITY, "a different Host's refusal ends the session (identity)");
            f = HostExchange.refusal(409, "HOST_EPOCH_CHANGED", "The Host restarted after this view was loaded. Nothing was changed; review the current state.", 0, "a7");
            check(f.kind == HostExchange.Failure.REFUSED && f.getMessage().contains("restarted"), "a changed epoch is the Host's own pre-execution refusal");

            System.out.println("A8 failures that may have partly applied, and unreadable server errors");
            check(HostExchange.refusal(400, "FAILED", "Host command failed.", 0, "a8").kind == HostExchange.Failure.FAILED, "FAILED is 'may have partly applied', not refused");
            check(HostExchange.refusal(503, "HOST_UNAVAILABLE", "Shutting down.", 0, "a8").kind == HostExchange.Failure.FAILED, "HOST_UNAVAILABLE on a command is 'may have partly applied'");
            check(HostExchange.refusal(400, "FAILED", "", 0, "a8").getMessage().equals(HostExchange.PARTLY_APPLIED), "partial-effect wording");
            check(HostExchange.refusal(502, null, "", 0, "a8").kind == HostExchange.Failure.OUTCOME_UNKNOWN, "unreadable 5xx on a command is outcome unknown");
            check(HostExchange.refusal(409, "OPERATION_IN_PROGRESS", "", 0, "a8").kind == HostExchange.Failure.OUTCOME_UNKNOWN, "still in progress is outcome unknown");
            check(HostExchange.refusal(503, null, "", 0, null).kind == HostExchange.Failure.UNAVAILABLE, "for a read, 503 is only 'unavailable'");

            System.out.println("A9 accepted but the answer was cut off");
            server.received.set(0); server.mode = Mode.CUT_ANSWER; server.status = 200; server.answer = "{\"snapshot\":";
            op = UUID.randomUUID().toString();
            uncertain(sendExpectingFailure(post(server.port()), command(op, 10), op), op, "2xx cut off");
            check(server.received.get() == 1, "cut-off command reached the server exactly once");

            System.out.println("A10 back in the foreground: reads resume, the uncertain command is not re-sent");
            server.mode = Mode.ANSWER; server.answer = "{\"schema\":\"bunny.native.state.v1\"}";
            HttpURLConnection get = (HttpURLConnection) new URL("http://127.0.0.1:" + server.port() + "/api/bunny-native-v1-state").openConnection();
            check(get.getResponseCode() == 200, "a fresh state read succeeds after the interrupted command"); get.disconnect();
            check(server.received.get() == 2, "one command plus one read; the command was not sent again");

            System.out.println("A11 Stop while a refresh is stalled");
            server.received.set(0); server.mode = Mode.STALL;
            Thread refresh = new Thread(() -> { try { HttpURLConnection g = (HttpURLConnection) new URL("http://127.0.0.1:" + server.port() + "/api/bunny-native-v1-state").openConnection(); g.setReadTimeout(8000); g.getResponseCode(); } catch (IOException ignored) { } });
            refresh.start();
            for (int i = 0; i < 100 && server.received.get() == 0; i++) Thread.sleep(20);
            server.mode = Mode.ANSWER; server.status = 200; server.answer = "{\"task\":{\"state\":\"STOPPED\"}}";
            c = post(server.port());
            a = HostExchange.send(c, command("stop-1", 0), "stop-1"); c.disconnect();
            check(a.status == 200 && refresh.isAlive(), "Stop is answered on its own connection while the refresh is still stalled");
            check(server.received.get() == 2, "the stalled refresh and exactly one Stop reached the server");
            server.release.countDown(); refresh.join(10_000);
        }
        System.out.println("HostExchangeTest: " + checks + " checks passed.");
    }
}
