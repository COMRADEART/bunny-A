# Bunny-A installation and phone connection

Bunny-A Host, the production gateway and the approved Cloudflare HTTPS connection are running. A per-user **Bunny-A** Windows login shortcut starts the background components and compact native Island. The large dashboard opens only when you choose **Open workspace**.

> **Status, October 2, 2026:** Bunny-A Host, the **v10** production gateway and the approved Cloudflare connection are running. The terminal M2 task's real-agent execution, Stop isolation, UI reconnect and remote-task evidence passed. The continuation freshly passed all **302 tests**, typecheck, lint (zero errors, two existing warnings) and the production build. Desktop/mobile checks of the actual Windows gateway match development. See the [M2 report](BUNNY_M2_REPORT.md) for evidence and remaining limitations, including the generic web preview's unavailable Host connection.

Quick-tunnel addresses are temporary. **Phone** in Island shows the current address after a restart. The previous address expired on Cloudflare's side on October 1; the connection was recovered and now uses the address below. If recovery requires stopping a tunnel child, first corroborate its current executable and parent process against the saved record; never stop a process solely from a stored PID. [Connection recovery and stable hostname configuration](BUNNY_REMOTE.md).

## Use your phone

1. Open [Bunny-A Phone](https://common-dave-painted-productivity.trycloudflare.com/?companion=1) on your phone. Until a device is paired, the toolbar shows **Not paired** (not "Host offline") and the Phone page asks for the code.
2. On the workstation's Bunny Island, choose **Phone**. It shows the current address and a single-use pairing code.
3. Enter that code on the phone and choose **Pair this device**. Codes expire after ten minutes. A new code replaces the previous unconsumed code.
4. Create a task, review the recommended agent and working folder, then approve it. Tasks run on the workstation. The phone and Island see the same registry and real output.
5. To revoke a device, open the workstation dashboard, select **Phone**, and use **Revoke access** beside that device.

The Android APK is `releases/Bunny-A-Android-v2.apk`. It uses the same HTTPS gateway and pairing flow; no provider credential goes into the APK. Android installation on hardware was not tested because no phone/emulator was connected. The browser companion is verified.

The temporary Cloudflare address can change after the tunnel restarts. **Phone** in the Island shows the new address. Cloudflare documents this as a testing/development tunnel with no uptime guarantee: [Quick Tunnels](https://developers.cloudflare.com/tunnel/get-started/quick-tunnels/). For a permanent hostname, a named tunnel/account or user-controlled HTTPS address is still needed.

The workstation must be awake. Background Android push and automatic wake are not configured. Foreground browser notifications depend on browser support and permission. Unsupported Intel/CPU sensors and unavailable provider quotas are labelled accordingly.

## Files and recovery

- [Current M2 report and acceptance evidence](BUNNY_M2_REPORT.md); [historical takeover report](BUNNY_TAKEOVER.md)
- Windows distribution: [Bunny-A-Windows-v10.zip](releases/Bunny-A-Windows-v10.zip); extract and double-click `Launch-Bunny-A.cmd` for a separate installation. Its Host data is private to that folder. Do not launch a second installation while the current Host owns the workstation address. SHA-256: `814D5C0D832848B500DA7179AB697A4A02AD013121EDE1485A0A600C0F53E9B7`.
- The currently installed login shortcut points to this checkout. Keep it in place if you want that shortcut to keep working.
- The original desktop release, original Android artifact, reports and prior source work remain preserved. The pre-takeover recovery patch/archive are in `artifacts/bunny-takeover/`.
- Private runtime data, tokens, authorized tunnel settings and SQLite history live in `.bunny-a/`; they are ignored by Git and excluded from release archives.

Closing the Island or dashboard leaves the Host and jobs running. An actual Host crash/restart is different: the current CLI adapters cannot reattach lost output pipes, and report that limitation explicitly. No process is stopped solely because a stored PID happens to exist.

## Historical update v8 (October 1, 2026)

At this historical checkpoint, the dashboard came from `releases/Bunny-A-Windows-v8` (zip SHA-256 `3BD092DE11AC45AAC57C9F4084DFFC9D172FD650989F38B79587E7ECFC288330`). The current selection in `.bunny-a/deployment.json` is **v10**. The Host runs from this checkout, and the native Island runs from `install/Bunny-Island.ps1` (the login shortcut runs that file). Previous releases remain on disk for recovery.

What changed:

- **Workspace design.** Large titles that collapse into a translucent toolbar, a bottom tab bar with a More sheet on phones, segmented controls, iOS-style switches, tinted status capsules, a distinct icon for each provider, and a visible "Host offline" or "Not paired" state. Light or dark follows the system until a theme is chosen. The Inter font is bundled with the app, so the dashboard makes no font request to a third party.
- **Native Island.** Rebuilt in the same design language: dark capsule with the provider icons and quota rings, tinted status capsules on tasks, a segmented Fast / Balanced / Deep control, animated expand and collapse, a Route button that stays disabled until a task is typed (Ctrl+Enter routes it), a pairing card that shows the address and one-time code, and graphs with filled areas in the System view. Terminal moved to the footer row. It keeps every control and behavior it had, and it still reads and writes only through the Host.
- **Host security.** Workstation (owner) access now requires the connection itself to come from this machine; a loopback `Host` header alone is no longer enough, which matters when the development server listens on all interfaces. The remote pairing limiter counts failed attempts only, is keyed to the caller's address, never extends a lockout, and has a global cap.
- **Host stability.** A failed background stop is recorded as a `task.stop_failed` event instead of crashing the Host. Streamed output is written in batches of about 300 ms instead of once per token, and the event journal keeps the newest 20,000 events. Recoverable Codex `error` events no longer fail a run that finishes successfully. Memory readings use `MemAvailable` on Linux. The timeout message reports the real limit.

Checks run: typecheck, production build, 281 automated tests (199 + 82); the packaged dashboard on a spare port and then on the live gateway (every view at desktop size and the main tabs at phone size, with no console errors and no horizontal overflow); the phone path through the new tunnel as an unpaired visitor (shows **Not paired**, leaks no workstation data, rejects a wrong pairing code); on a throwaway Host with its own data folder, a real Ollama task that completed and a long generation that was stopped mid-stream and kept its partial output; and 27 scripted checks of the Island's own buttons against that same throwaway Host (route, approve, run to completion, stop, pairing card, integrations, System view, theme, collapse). Not exercised: Android hardware, and an actual phone pairing (it needs a person to enter a code on a device).

Roll back the dashboard by setting `packagePath` in `.bunny-a/deployment.json` back to `...\releases\Bunny-A-Windows-v5`, stopping the gateway (the Node process running `Bunny-Server.mjs`), and running `scripts\start-bunny-gateway.ps1`. The previous Island is `releases/Bunny-A-Windows-v5/Bunny-Island.ps1`; copy it over `install/Bunny-Island.ps1` to restore it. Host changes live in this checkout's source and are rolled back with Git.

## Historical appearance update (v5)

The v5 dashboard and Island introduced an Apple-inspired design: neutral graphite and soft white themes, blue controls, quieter separators, rounded surfaces, segmented task modes and a Bunny-A mark. New browser profiles started in light mode; saved theme choices were preserved. Mobile navigation kept the active tab visible, and pairing inputs avoided iPhone focus zoom. The Android companion loaded the updated web interface from the same secure gateway. Later releases retained and refined that design.

Actual desktop/mobile browser renders and native compact, expanded, system and light views were inspected. Build, typecheck and all 273 existing tests pass. Evidence: `screenshots/bunny-apple-built.json`, `screenshots/bunny-apple-phone.json` and `test-results/bunny-apple-tests.log`.
