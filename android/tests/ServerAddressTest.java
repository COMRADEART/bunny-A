package com.routeragent.jev;

public final class ServerAddressTest {
    private static void expect(String actual, String expected) {
        if (!actual.equals(expected)) throw new AssertionError(actual + " != " + expected);
    }
    public static void main(String[] args) {
        expect(ServerAddress.normalize(" HTTPS://JEV.EXAMPLE:443/ "), "https://jev.example/");
        expect(ServerAddress.normalize("https://jev.example:8443"), "https://jev.example:8443/");
        expect(ServerAddress.normalize("https://100.64.2.3"), "https://100.64.2.3/");
        expect(ServerAddress.normalize("https://[2001:db8::1]:8443"), "https://[2001:db8::1]:8443/");
        expect(ServerAddress.normalize("https://[::ffff:8.8.8.8]"), "https://8.8.8.8/");
        String[] invalid = { "", "http://jev.example", "javascript:alert(1)", "file:///etc/passwd",
                "https://user:password@jev.example", "https://jev.example/?token=secret", "https://jev.example/#secret",
                "https://jev.example/path", "https://localhost", "https://127.0.0.1", "https://[::1]",
                "https://jev.example:99999", "https://jev.example:0", "https://[::ffff:127.0.0.1]", "https://[::ffff:7f00:1]", "https://[::]", "https://[0:0:0:0:0:0:0:1]",
                "https://2130706433", "https://0x7f000001", "https://127.1", "https://0.0.0.0", "https://jev.example\\@attacker.example" };
        for (String input : invalid) {
            try { ServerAddress.normalize(input); throw new AssertionError("Accepted: " + input); }
            catch (IllegalArgumentException expected) { /* validation refused unsafe or unusable input */ }
        }
        if (!ServerAddress.sameOrigin("https://jev.example/", "https://jev.example:443/tasks")) throw new AssertionError("same origin");
        if (ServerAddress.sameOrigin("https://jev.example/", "https://jev.example.attacker.example/")) throw new AssertionError("lookalike origin");
        if (ServerAddress.sameOrigin("https://jev.example/", "http://jev.example/")) throw new AssertionError("cleartext origin");
        if (ServerAddress.sameOrigin("https://jev.example/", "https://jev.example:8443/")) throw new AssertionError("different port");
        System.out.println("Android connection policy: 31 checks passed.");
    }
}
