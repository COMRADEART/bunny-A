package com.routeragent.jev;

import com.routeragent.jev.ModelDownload.Progress;
import com.routeragent.jev.ModelDownload.Result;
import com.sun.net.httpserver.HttpServer;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.InetSocketAddress;
import java.net.URL;
import java.nio.file.Files;
import java.security.MessageDigest;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.Random;

/** Resumable model download against a real loopback HTTP server (Range, 200 restart, 416, checksum, cancel, no credentials). */
public final class ModelDownloadTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; }
    interface Body { void run() throws Exception; }
    private static void checkThrows(Body body, String messagePart) {
        try { body.run(); } catch (Exception e) { check(String.valueOf(e.getMessage()).contains(messagePart), "message mentions " + messagePart + ": " + e.getMessage()); return; }
        throw new AssertionError("expected a failure mentioning " + messagePart);
    }

    static final byte[] blob = new byte[300_000];
    static String hash;
    static volatile String lastRange;
    static volatile boolean honourRange = true;
    static final List<String> headerNames = new ArrayList<>();
    static String url;

    static boolean sawHeader(String name) { synchronized (headerNames) { for (String h : headerNames) if (h.equalsIgnoreCase(name)) return true; } return false; }

    static final Progress quiet = new Progress() { public void at(long done, long total) {} public boolean cancelled() { return false; } };

    static Result run(File dir) throws IOException { return run(dir, hash, quiet); }
    static Result run(File dir, String sha) throws IOException { return run(dir, sha, quiet); }
    static Result run(File dir, String sha, Progress progress) throws IOException {
        return ModelDownload.run(u -> (HttpURLConnection) new URL(u).openConnection(), url, dir, blob.length, sha, progress);
    }
    static File dir() throws IOException { return Files.createTempDirectory("bunny-download").toFile(); }
    static byte[] read(File f) throws IOException { return Files.readAllBytes(f.toPath()); }
    static void prewrite(File dir, int n) throws IOException {
        File part = ModelFile.partial(dir);
        part.getParentFile().mkdirs();
        try (FileOutputStream out = new FileOutputStream(part)) { out.write(blob, 0, n); }
    }

    public static void main(String[] args) throws Exception {
        new Random(42).nextBytes(blob);
        StringBuilder hex = new StringBuilder();
        for (byte b : MessageDigest.getInstance("SHA-256").digest(blob)) hex.append(String.format("%02x", b));
        hash = hex.toString();

        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/model", exchange -> {
            synchronized (headerNames) { headerNames.addAll(exchange.getRequestHeaders().keySet()); }
            String range = exchange.getRequestHeaders().getFirst("Range");
            lastRange = range;
            int from = 0;
            if (honourRange && range != null && range.startsWith("bytes=")) from = Integer.parseInt(range.substring(6, range.indexOf('-')));
            if (from >= blob.length) { exchange.sendResponseHeaders(416, -1); exchange.close(); return; }
            if (from > 0) exchange.getResponseHeaders().set("Content-Range", "bytes " + from + "-" + (blob.length - 1) + "/" + blob.length);
            exchange.sendResponseHeaders(from > 0 ? 206 : 200, blob.length - from);
            try (OutputStream out = exchange.getResponseBody()) { out.write(blob, from, blob.length - from); }
        });
        server.start();
        url = "http://127.0.0.1:" + server.getAddress().getPort() + "/model";
        try {
            File dir = dir();
            check(run(dir) == Result.DONE && Arrays.equals(read(ModelFile.path(dir)), blob) && !ModelFile.partial(dir).exists(), "fullDownload");

            File dir2 = dir();
            prewrite(dir2, 100_000);
            check(run(dir2) == Result.DONE && "bytes=100000-".equals(lastRange) && Arrays.equals(read(ModelFile.path(dir2)), blob), "resumesWithRange");

            File dir3 = dir();
            prewrite(dir3, 100_000);
            honourRange = false;
            check(run(dir3) == Result.DONE && Arrays.equals(read(ModelFile.path(dir3)), blob), "200 restarts from zero");
            honourRange = true;

            File dir4 = dir();
            prewrite(dir4, blob.length);
            check(run(dir4) == Result.DONE && Arrays.equals(read(ModelFile.path(dir4)), blob), "416 with a complete part verifies and finishes");

            File dir5 = dir();
            String wrongHash = hash.substring(0, 63) + (hash.charAt(63) == '0' ? '1' : '0');
            checkThrows(() -> run(dir5, wrongHash), "checksum");
            check(!ModelFile.partial(dir5).exists() && !ModelFile.path(dir5).exists(), "wrongHashIsDeleted");

            File dir6 = dir();
            final int[] calls = {0};
            Progress cancelAfterFirst = new Progress() {
                public void at(long done, long total) { calls[0]++; check(total == blob.length && done > 0 && done <= total, "progress counts bytes"); }
                public boolean cancelled() { return calls[0] > 0; }
            };
            check(run(dir6, hash, cancelAfterFirst) == Result.CANCELLED && ModelFile.partial(dir6).length() > 0 && !ModelFile.path(dir6).exists(), "cancel keeps the part");
            check(run(dir6) == Result.DONE && Arrays.equals(read(ModelFile.path(dir6)), blob), "a cancelled download resumes to the right bytes");

            check(!sawHeader("Cookie") && !sawHeader("Authorization"), "sendsNoCredentials");
        } finally { server.stop(0); }
        System.out.println("ModelDownloadTest: " + checks + " checks passed");
    }
}
