package com.routeragent.jev;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import javax.net.ssl.SSLHandshakeException;

/**
 * One request to the workstation and what its failure proves. Kept free of android.* and org.json so the classification
 * runs under plain JVM tests against injected network faults (android/tests/HostExchangeTest).
 */
final class HostExchange {
    static final String UNCONFIRMED = "Connection interrupted. Bunny A cannot confirm whether this operation completed. It was not automatically retried. Review the current task and Host state before taking another action.";
    static final String PARTLY_APPLIED = "The operation failed on the workstation and may have partly taken effect. It was not automatically retried. Review the current task and Host state before taking another action.";

    /** What failed, so the screen can say whether to wait, retry or pair again. Messages never carry the credential. */
    static final class Failure extends Exception {
        static final int NETWORK = 1, AUTH = 2, IDENTITY = 3, RATE_LIMITED = 4, REFUSED = 5, UNAVAILABLE = 6, PROTOCOL = 7,
                OUTCOME_UNKNOWN = 8, FAILED = 9;
        final int kind;
        final String code;
        final long retryAfterMs;
        /** The command's own id, kept so its outcome can be looked up; never reused for another send. */
        final String operationId;
        Failure(int kind, String message, String code, long retryAfterMs) { this(kind, message, code, retryAfterMs, null); }
        Failure(int kind, String message, String code, long retryAfterMs, String operationId) {
            super(message); this.kind = kind; this.code = code; this.retryAfterMs = retryAfterMs; this.operationId = operationId;
        }
    }

    static final class Answer {
        final int status;
        final String body;
        Answer(int status, String body) { this.status = status; this.body = body; }
    }

    static Failure unknown(String operationId) { return new Failure(Failure.OUTCOME_UNKNOWN, UNCONFIRMED, null, 0, operationId); }

    /**
     * Sends one body and reads the answer. Only a failure to connect proves nothing was sent: connect() opens TCP and
     * TLS, and the body is written after it. Once writing starts, a lost connection, a timeout or a cut-off answer may
     * follow a Host that already acted, so the outcome is unknown.
     */
    static Answer send(HttpURLConnection c, byte[] body, String operationId) throws Failure {
        c.setDoOutput(true);
        c.setRequestProperty("Content-Type", "application/json");
        // A streamed body cannot be replayed, so the platform HTTP stack never silently re-sends it after a failure.
        c.setFixedLengthStreamingMode(body.length);
        try { c.connect(); }
        catch (SSLHandshakeException e) { throw new Failure(Failure.IDENTITY, "The workstation's HTTPS certificate was not trusted. Nothing was sent.", null, 0); }
        catch (IOException e) { throw new Failure(Failure.NETWORK, "The workstation could not be reached. Nothing was sent.", null, 0); }
        int status;
        try {
            try (OutputStream out = c.getOutputStream()) { out.write(body); }
            status = c.getResponseCode();
        } catch (IOException e) { throw unknown(operationId); }
        if (status >= 200 && status < 300) {
            try { return new Answer(status, read(c.getInputStream())); }
            catch (IOException e) { throw unknown(operationId); }
        }
        String error;
        try { error = read(c.getErrorStream()); } catch (IOException e) { error = ""; }
        return new Answer(status, error);
    }

    /**
     * What a non-2xx answer means. With an operation id it answers a command: a failure the Host records as "failed"
     * may have partly applied, and an unreadable server error proves nothing either way.
     */
    static Failure refusal(int status, String code, String message, long retryAfterMs, String operationId) {
        boolean command = operationId != null;
        if (status == 401) return new Failure(Failure.AUTH, "This phone's access ended (revoked, expired or replaced). Pair it again from Windows.", code, 0);
        if (status == 429) return new Failure(Failure.RATE_LIMITED, "The workstation asked this phone to slow down.", code, Math.max(1000, retryAfterMs));
        if ("HOST_IDENTITY_CHANGED".equals(code)) return new Failure(Failure.IDENTITY, "A different workstation answered. Nothing was changed; pair again if this is expected.", code, 0);
        if (command && ("FAILED".equals(code) || "HOST_UNAVAILABLE".equals(code))) return new Failure(Failure.FAILED, PARTLY_APPLIED, code, 0, operationId);
        if (command && "OPERATION_IN_PROGRESS".equals(code)) return new Failure(Failure.OUTCOME_UNKNOWN, UNCONFIRMED + " The workstation reports it may still be executing.", code, 0, operationId);
        if (command && code == null && status >= 500) return unknown(operationId);
        if (status == 503) return new Failure(Failure.UNAVAILABLE, "The workstation Host is not available right now.", code, 0);
        return new Failure(Failure.REFUSED, message == null || message.isEmpty() ? "The workstation refused this request (HTTP " + status + ")." : message, code, 0, operationId);
    }

    static String read(InputStream in) throws IOException {
        if (in == null) return "";
        try (InputStream body = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[4096]; int n, total = 0;
            while ((n = body.read(buffer)) != -1) { total += n; if (total > 2_000_000) throw new IOException("Response too large."); out.write(buffer, 0, n); }
            return out.toString("UTF-8");
        }
    }
}
