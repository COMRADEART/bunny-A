# Transport security

Remote cookie access requires the exact configured HTTPS origin and an actual TCP loopback connector. Host/Origin/X-Forwarded headers alone never establish device or workstation identity. Unauthorized Origin/CSRF, anonymous SSE, raw insecure gateway access, unknown cookies, wrong Host identity and stale epoch were refused in disposable protocol checks. Cookies are HttpOnly, Secure and SameSite Strict; security headers prevent framing and referrer leakage. The direct Host also independently redacts device state and SSE.

The trusted connector must terminate real HTTPS. Local loopback HTTP has a workstation-only contract. Node accepted the fixture self-signed certificate only with its explicit CA and rejected it without trust; browser warnings were not bypassed and OS trust was not changed. Public HTTPS, a real connector/tunnel, separate-network routing, physical-phone certificate trust: NOT TESTED.

The production tunnel was not enabled, installed, restarted or reconfigured. No firewall or Startup changes were made.
