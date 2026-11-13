package com.routeragent.jev;

/** Kept free of android.* so the polling decisions run under plain JVM tests (android/tests/PollPolicyTest). */
final class PollPolicy {
    static final long CHAT_MS = 1500, TASKS_MS = 5000, OTHER_MS = 10000, MAX_BACKOFF_MS = 60_000;
    /** Polling runs only while the screen is visible (onStop cancels it), so someone is watching: retry often. */
    static final long MAX_NETWORK_RETRY_MS = 5_000;
    private int issued, applied;

    /** How often to poll while the screen is visible: faster only while a chat answer is awaited. */
    static long interval(boolean chatPending, boolean tasksTab) { return chatPending ? CHAT_MS : tasksTab ? TASKS_MS : OTHER_MS; }

    /** Backoff after consecutive failures (2, 4, 5, 5 … s), so a restored network is noticed within 5 s; a Host Retry-After is honoured up to 60 s. */
    static long backoff(int consecutiveFailures, long retryAfterMs) {
        if (retryAfterMs > 0) return Math.min(MAX_BACKOFF_MS, retryAfterMs);
        return Math.min(MAX_NETWORK_RETRY_MS, 1000L << Math.max(1, Math.min(consecutiveFailures, 6)));
    }

    /** A number for the next request. */
    int issue() { return ++issued; }

    /** True when a response may be shown: it is not older than one already applied. */
    boolean accept(int generation) {
        if (generation < applied) return false;
        applied = generation;
        return true;
    }
}
