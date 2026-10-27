/** Read-only native companion bridge. The Host remains the authority for device scope and revocation. */
type Access = { local: boolean; token: string | null };
type Deps = {
  authorize(request: Request): Access;
  hostPort(): number;
  fetchHost: typeof fetch;
};
export async function nativeCompanionState(request: Request, deps: Deps): Promise<Response> {
  let access: Access;
  try { access = deps.authorize(request); }
  catch { return Response.json({ error: "Companion connection refused.", code: "GATEWAY_REFUSED" }, { status: 403, headers: { "cache-control": "no-store" } }); }
  if (access.local) return Response.json({ error: "Use the configured HTTPS companion origin." }, { status: 403, headers: { "cache-control": "no-store" } });
  if (!access.token) return Response.json({ error: "Pair this device first.", code: "PAIRING_REQUIRED" }, { status: 401, headers: { "cache-control": "no-store" } });
  try {
    const port = deps.hostPort();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Host port");
    const upstream = await deps.fetchHost(`http://127.0.0.1:${port}/state`, {
      headers: { authorization: `Bearer ${access.token}` }, redirect: "error", signal: AbortSignal.timeout(5000),
    });
    if (upstream.status === 401) return Response.json({ error: "Pair this device again.", code: "AUTH_REQUIRED" }, { status: 401, headers: { "cache-control": "no-store" } });
    if (upstream.status === 429) return Response.json({ error: "Too many requests; try again later.", code: "RATE_LIMITED" }, { status: 429, headers: { "cache-control": "no-store" } });
    if (!upstream.ok) return Response.json({ error: "Host state is unavailable.", code: "HOST_UNAVAILABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
    // The Host returns its device-scoped projection for this device credential. No workstation token is forwarded.
    return Response.json({ schema: "bunny.native.state.v1", snapshot: await upstream.json() }, { headers: { "cache-control": "no-store" } });
  } catch {
    return Response.json({ error: "Host state is unavailable.", code: "HOST_UNREACHABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
