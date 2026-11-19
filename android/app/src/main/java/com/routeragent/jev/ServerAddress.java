package com.routeragent.jev;

import java.net.Inet4Address;
import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
import java.util.Locale;

/** Remote origins only: never store credentials or connection tokens in URLs. */
public final class ServerAddress {
    private ServerAddress() {}

    public static String normalize(String input) {
        try {
            URI uri = new URI(input.trim());
            String host = uri.getHost();
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || host.isEmpty()
                    || uri.getRawUserInfo() != null || uri.getRawQuery() != null || uri.getRawFragment() != null
                    || (uri.getRawPath() != null && !uri.getRawPath().isEmpty() && !"/".equals(uri.getRawPath()))
                    || uri.getPort() > 65535 || uri.getPort() == 0) {
                throw new IllegalArgumentException("Enter only the HTTPS address, without a path, password or query.");
            }
            host = host.toLowerCase(Locale.ROOT);
            // A bare number, a short or a hex form (https://2130706433) is another spelling of an IP address: only a dotted quad is accepted.
            if (host.matches("(0x[0-9a-f]+|[0-9]+)([.](0x[0-9a-f]+|[0-9]+))*") && !host.matches("[0-9]{1,3}([.][0-9]{1,3}){3}")) {
                throw new IllegalArgumentException("Enter a valid HTTPS address.");
            }
            boolean thisPhone = host.equals("localhost") || host.endsWith(".localhost") || host.startsWith("127.") || host.equals("0.0.0.0");
            if (host.startsWith("[")) {
                // A literal is parsed, never looked up: [::], [::1] and the IPv4-mapped forms of 127.x all mean this phone.
                InetAddress literal = InetAddress.getByName(host.substring(1, host.length() - 1));
                // An IPv4-mapped literal ([::ffff:8.8.8.8]) crashes the platform HTTP stack (AssertionError in its URL parser); use the plain IPv4 form.
                if (literal instanceof Inet4Address) host = literal.getHostAddress();
                thisPhone = literal.isLoopbackAddress() || literal.isAnyLocalAddress();
            }
            if (thisPhone) {
                throw new IllegalArgumentException("Use your computer's remote HTTPS address. Localhost refers to this phone.");
            }
            int port = uri.getPort() == 443 ? -1 : uri.getPort();
            return new URI("https", null, host, port, "/", null, null).toASCIIString();
        } catch (URISyntaxException | UnknownHostException ex) {
            throw new IllegalArgumentException("Enter a valid HTTPS address.");
        }
    }

    public static boolean sameOrigin(String left, String right) {
        try {
            URI a = new URI(left);
            URI b = new URI(right);
            int aPort = a.getPort() == -1 ? 443 : a.getPort();
            int bPort = b.getPort() == -1 ? 443 : b.getPort();
            return "https".equalsIgnoreCase(a.getScheme()) && "https".equalsIgnoreCase(b.getScheme())
                    && a.getHost() != null && a.getHost().equalsIgnoreCase(b.getHost()) && aPort == bPort;
        } catch (URISyntaxException ex) { return false; }
    }
}
