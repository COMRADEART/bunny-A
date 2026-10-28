package com.routeragent.jev;

/** Polling decisions of the native companion, exercised without Android. */
public final class PollPolicyTest {
    private static int checks;
    private static void check(boolean ok, String what) { if (!ok) throw new AssertionError(what); checks++; }

    public static void main(String[] args) {
        check(PollPolicy.interval(true, false) == 1500, "chat pending polls fastest");
        check(PollPolicy.interval(false, true) == 5000, "tasks tab");
        check(PollPolicy.interval(false, false) == 10000, "other tabs poll slowest");

        long previous = 0;
        for (int failures = 1; failures <= 12; failures++) {
            long delay = PollPolicy.backoff(failures, 0);
            check(delay >= previous && delay <= 60_000, "backoff grows and stays bounded at " + failures);
            previous = delay;
        }
        check(PollPolicy.backoff(1, 0) == 2000, "first retry after 2 s");
        check(PollPolicy.backoff(50, 0) == 60_000, "never more than a minute");
        check(PollPolicy.backoff(1, 7000) == 7000, "Retry-After is honoured");
        check(PollPolicy.backoff(1, 600_000) == 60_000, "Retry-After is still bounded");

        // Two overlapping requests: the newer answer wins even when the older one arrives last.
        PollPolicy p = new PollPolicy();
        int older = p.issue(), newer = p.issue();
        check(p.accept(newer), "newer response applied");
        check(!p.accept(older), "older response arriving late is dropped");
        check(p.accept(p.issue()), "the next request is applied");
        System.out.println("PollPolicyTest: " + checks + " checks passed.");
    }
}
