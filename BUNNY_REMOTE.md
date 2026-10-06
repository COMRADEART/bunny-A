# Bunny-A remote connection

The approved Cloudflare connection is active. **Phone** in Bunny Island displays its current HTTPS address. The present quick-tunnel address is temporary; Bunny-A reads it from private runtime state rather than embedding it in the application. Pairing, approval and device revocation continue to apply to every remote connection.

## Stable hostname configuration

The tunnel manager already supports a named tunnel. Activation requires a Cloudflare account and a domain configured with Cloudflare DNS. Neither has been supplied for this installation. The existing temporary connection remains available. [Cloudflare setup requirements and commands](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/create-local-tunnel/).

For the account owner or installer, use the verified `cloudflared.exe` in `.bunny-a/tools/` to authenticate and create the tunnel:

```powershell
.\.bunny-a\tools\cloudflared.exe tunnel login
.\.bunny-a\tools\cloudflared.exe tunnel create bunny-a
.\.bunny-a\tools\cloudflared.exe tunnel route dns <TUNNEL-UUID> bunny.example.com
```

Replace the example domain and UUID with the account's actual values. Save a private Cloudflare configuration, such as `C:\Users\you\.cloudflared\bunny-a.yml`:

```yaml
tunnel: <TUNNEL-UUID>
credentials-file: C:\Users\you\.cloudflared\<TUNNEL-UUID>.json
ingress:
  - hostname: bunny.example.com
    service: http://127.0.0.1:8084
  - service: http_status:404
```

The final rule rejects unmatched hostnames. Validate the configuration before activation. [Cloudflare configuration and validation](https://developers.cloudflare.com/tunnel/features/locally-managed-tunnels/configuration-file/).

```powershell
.\.bunny-a\tools\cloudflared.exe tunnel --config C:\Users\you\.cloudflared\bunny-a.yml ingress validate
```

Save `.bunny-a/tunnel.json` with these Bunny-A settings:

```json
{
  "mode": "named",
  "hostname": "bunny.example.com",
  "config": "C:\\Users\\you\\.cloudflared\\bunny-a.yml"
}
```

## Activation and verification

The running manager reads settings when starting a tunnel. A settings change requires a controlled restart of that manager. Before stopping anything, corroborate the recorded manager PID with its current process command line pointing to this checkout's `scripts/bunny-tunnel.mjs`, and corroborate the child executable and parent PID. Never terminate a process solely from an old PID file. Stop only those verified tunnel processes, then invoke `scripts/start-bunny-remote.ps1`; the Host, task processes and Island stay running.

Bunny-A publishes the configured hostname after Cloudflare reports a registered connection. Verify the public companion loads, an unpaired device cannot read workstation data, pairing succeeds, a harmless approved task completes, and revocation denies access again. Existing cookies belong to the old origin, so phones must pair at the new hostname.

Keep the tunnel credentials and account certificate private. They belong outside release archives and source control. Publish only the gateway; keep the Host API private. Named mode has not been activated or tested against a real account/domain here. The laptop still needs to be awake; this configuration does not provide Android background push or wake the computer.

## Temporary tunnel recovery

Quick-tunnel addresses can expire. The manager retries when its child exits, but a child can keep retrying an invalid tunnel without exiting. In that case, identity-check the recorded child and stop only that tunnel child; its manager starts a new tunnel and updates **Phone**. This is a limitation of the current temporary connection, not a stable-hostname guarantee.

Since Gate T6R, the installed manager also detects a degraded child itself and restarts it without waiting for a person: it watches the child's edge registrations (no registered connection sustained, the recorded churn signature, or public health failures through the published address) and, within its bounded three-attempt budget, stops the degraded child and starts a new one, updating **Phone** with the new address. A gateway fault on this computer is never mistaken for a tunnel fault, and if the manager finds a stale publication from a dead worker it clears it, so **Phone** never points at a dead hostname. The manual procedure above remains the fallback for the rare case the manager exhausts its attempt budget and reports that relaunch is required.
