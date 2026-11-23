# router_agent / JEV installation test

Verified on October 1, 2026. Windows installation is complete. A signed Android
APK is now available in Downloads; see [ANDROID_APK_REPORT.md](ANDROID_APK_REPORT.md).
Physical Android installation and remote access remain unverified: no phone is
connected and the existing remote connection's name or HTTPS address has not
been provided.

## Installed on this computer

- Desktop shortcut: `C:\Users\<user>\Desktop\JEV router_agent.lnk`.
- Download archive: `C:\Users\<user>\Downloads\JEV-Windows-v1.zip` (33.9 MB).
- Installed package: `releases/installed/JEV-Windows-v1`, extracted from the ZIP.
- Includes the production application, launcher, stop helper, Node.js runtime
  and its official license. Launching needs no npm or development server.
- JEV and Ollama remain running. Closing the app window leaves the service running;
  the computer must remain awake for phone access.
- Archive SHA-256: `B586807E534298D0617722F96C41CE49FD8CDDE58F6F74F24089C07D34E8D97B`.

## Verification results

| Check | Result |
| --- | --- |
| Automated tests | 261 passed, 0 failed |
| TypeScript type check | Passed |
| Standard Vercel production build | Passed |
| Standalone Windows production build | Passed |
| Development desktop and mobile render | Passed |
| Packaged desktop and mobile render | Passed; no console errors, page errors or horizontal overflow |
| Standard production render | Passed; no divergence from development |
| ZIP extraction and launch | Passed using the extracted copy and bundled runtime |
| Repeated launcher | Passed; reused the same service process |
| Real Ollama task through the packaged UI | Completed in 55 seconds, returned exactly `JEV_INSTALL_OK` |
| Task history after service restart and browser reload | Completed task retained |
| Android web manifest and icons | JEV name, standalone display, 192px and 512px icons; both icons served successfully |
| Unrecognized hosts and cross-site requests | Rejected in automated tests |
| Android installation and remote task execution | Pending device and remote-connection access |

The first desktop package exposed missing static assets during browser testing.
The final package includes static asset serving and passes the repeated render
checks. Windows build output is isolated from the normal Vercel deployment.
Platform branding, middleware, install tutorial and preview bridge remain intact.

Evidence is in `screenshots/install-dev.json`, `screenshots/install-desktop.json`,
`screenshots/install-web-production.json` and `test-results/install-*.log`.
The desktop and mobile screenshots were visually inspected.

## Android and remote access

Android delivery now includes a native APK with a connection screen and WebView.
The home-screen web app remains an alternative. The installed Windows runtime
provides the manifest and icons required for Chrome's install promotion; remote
access through either option needs a working HTTPS address. See
[Chrome's install criteria](https://web.dev/articles/install-criteria).

The user selected their existing remote connection. No VPN was installed and no
public tunnel or firewall exception was enabled. The service binds to loopback;
only explicitly configured remote origins are accepted. The existing connection
must authenticate access before forwarding to JEV. The app currently has no
account authentication of its own.

To complete the phone setup, identify the existing VPN/tunnel/remote-desktop
product and, if available, its HTTPS app address. A remote-desktop connection
alone displays the Windows app; it does not necessarily provide an installable
Android web address. Physical installation, launch, reconnect after changing
networks and a real remote task still need verification on the phone.

## Remaining product limitations

Ollama is the working execution provider; model weights are not included in the
archive. Codex and Claude are not configured. Tasks and preferences are stored
per browser, so Windows and Android histories will not automatically synchronize.
This version requires a live connection to the host; offline task execution is
not provided. Full project findings remain in `PROJECT_REPORT.md`.
