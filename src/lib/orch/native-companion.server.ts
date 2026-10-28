/** Native companion bridge. The Host remains the authority for device scope, command admission, and revocation. */
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

export async function nativeCompanionCommand(request: Request, deps: Deps): Promise<Response> {
  let access: Access;
  try { access = deps.authorize(request); }
  catch { return Response.json({ error: "Companion connection refused.", code: "GATEWAY_REFUSED" }, { status: 403, headers: { "cache-control": "no-store" } }); }
  if (access.local) return Response.json({ error: "Use the configured HTTPS companion origin." }, { status: 403, headers: { "cache-control": "no-store" } });
  if (!access.token) return Response.json({ error: "Pair this device first.", code: "PAIRING_REQUIRED" }, { status: 401, headers: { "cache-control": "no-store" } });
  let dispatched = false;
  try {
    const port = deps.hostPort();
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Invalid Host port");
    const body = await request.json();
    dispatched = true;
    const upstream = await deps.fetchHost(`http://127.0.0.1:${port}/command`, {
      method: "POST",
      headers: { authorization: `Bearer ${access.token}`, "content-type": "application/json" },
      body: JSON.stringify(body),
      redirect: "error",
      signal: AbortSignal.timeout(10000),
    });
    const result = await upstream.json() as Record<string, unknown>;
    if (upstream.status === 401) return Response.json({ error: "Pair this device again.", code: "AUTH_REQUIRED" }, { status: 401, headers: { "cache-control": "no-store" } });
    if (upstream.status === 429) return Response.json({ error: "Too many requests; try again later.", code: "RATE_LIMITED" }, { status: 429, headers: { "cache-control": "no-store" } });
    if (!upstream.ok) return Response.json({ error: result.error ?? "Command refused.", code: result.code ?? "COMMAND_REFUSED" }, { status: upstream.status, headers: { "cache-control": "no-store" } });
    return Response.json({ schema: "bunny.native.command.v1", ...result }, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    // Once the command was handed to the Host, a lost, late or unreadable answer leaves its outcome unknown (as
    // transportFailure does for the dashboard); only a refused connection proves the Host never received it.
    const refused = (error as { cause?: { code?: string } } | null)?.cause?.code === "ECONNREFUSED";
    if (dispatched && !refused)
      return Response.json({ error: "The Host did not confirm this command; its outcome is unknown. It was not retried.", code: "OUTCOME_UNKNOWN" }, { status: 504, headers: { "cache-control": "no-store" } });
    return Response.json({ error: "Host command unavailable.", code: "HOST_UNREACHABLE" }, { status: 503, headers: { "cache-control": "no-store" } });
  }
}
