# Phone architecture

Delivery is the existing responsive web dashboard, with the existing one-time pairing code and per-device credential. The Windows Host retains AgentRuntime, MissionManager, TaskManager, routing, provider execution, journal, Project paths and artifact verification. The phone contains presentation and synchronization state only.

Host authority is enforced before gateway projection. A persistent Host UUID and a per-process epoch distinguish reconnect from replacement. The browser pins only the non-secret Host UUID. SSE carries invalidation signals; canonical authenticated snapshots supply state. No client-side work engine or offline mutation queue was introduced.

Test delivery used a real disposable Windows Host and built gateway. A test-only loopback adapter seeded a real independently paired cookie and translated its browser HTTP origin into the configured HTTPS connector origin. It is SIMULATED enrollment/transport, not a physical-phone HTTPS pairing demonstration. A separate Node TLS client validated the fixture certificate explicitly; certificate trust failed closed without that CA. No public connector was activated.
