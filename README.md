# Bunny A

A local-first AI workstation for Windows, with a native Android companion.

- **Runs on your PC.** Local models through Ollama; cloud models only if you add a key. No telemetry leaves the device.
- **You approve what matters.** Consequential actions wait in the Approval Center on your PC with exact grants, side effects, and recovery rules.
- **Your phone as a remote.** Pair the native Android app with a one-time code to follow tasks and send prompts over HTTPS.

## Architecture

Bunny A is split into three surfaces backed by a single local Host process:

```text
+-----------------------------------+      HTTPS (paired device)      +-------------------------+
|   Windows Client (BunnyA.exe)     |                                 |   Android Companion     |
|   WPF (.NET 8) + Glass Notch      |                                 |   Native (INTERNET only)|
+-----------------+-----------------+                                 +------------+------------+
                  | 127.0.0.1 (authenticated HTTP + /events)                       |
                  v                                                                v
+-----------------------------------------------------------------------------------------------+
|                                 Bunny Host (Node.js / TypeScript)                             |
|   Missions Engine · Approval Center · Model Router · Agent Runtime · Voice · Device Pairing   |
|   Web/Mobile UI (TanStack Start + React 19) · Native Owned-Process Helper & Voice Worker      |
+-----------------------------------------------------------------------------------------------+
```

- **Host (`src/lib/bunny-host/`, `src/lib/bunny-missions/`)**: Local-first Node server managing missions, approvals, routing policies, multi-agent lifecycles, SQLite state, voice worker, owned-process containment, and HTTPS device pairing.
- **Windows Client (`native/windows/`)**: Native WPF (.NET 8) desktop application and top-most glass notch talking exclusively to `127.0.0.1`. See [native/windows/README.md](native/windows/README.md).
- **Web UI (`src/components/island/`, `src/routes/`)**: TanStack Start + React 19 interface served by the Host and used by the browser/remote view.
- **Android Companion (`android/`)**: Native companion app with no WebView and only the `INTERNET` permission. See [android/README.md](android/README.md).

## Repository Layout

| Path | Description |
|---|---|
| `src/lib/bunny-host/` | Host core: routing, agents, approvals, devices, voice, and co-located tests |
| `src/lib/bunny-missions/` | Mission engine, staging, and remote-authority rules |
| `src/components/island/`, `src/routes/` | Web UI (TanStack Start + React 19) |
| `scripts/` | Development Host launcher, packaging, verification, and CI helpers |
| `native/windows/` | `BunnyA.exe` WPF client and glass notch |
| `native/voice/` | Native voice worker shim and pinned runtime metadata |
| `android/` | Native Android companion and JVM tests (`android/tests/`) |
| `install/` | Release launcher and `release-pin.json` manifests |
| `docs/` | Architecture docs, qualification records (`docs/ux/`, `docs/roadmap/`), and archived milestone reports (`docs/reports/`) |

## Local Development Setup

### Prerequisites

- **Node.js 24+** (with `npm`)
- **Windows 10/11** for native Windows client, process-ownership helper, and full regression suites
- **.NET 8 SDK** (version pinned in [global.json](global.json)) for building `native/windows/`
- **MinGW-w64 GCC** (`gcc` on `PATH` or `BUNNY_NATIVE_CC`) for compiling the Windows owned-process helper (`npm run pretest`)
- **Ollama** (optional) for running local models

### Install & Run

```sh
npm ci
npm run host             # Start the local development Host
npm run dev              # Start the Vite / TanStack Start dev server (revert src/routeTree.gen.ts unless routes changed)
```

### Verification & Builds

```sh
npm run typecheck        # TypeScript check (tsc --noEmit)
npm run lint             # ESLint across the repository
npm run test:ui          # Fast island UI model tests
npm run test:ma4         # MA4 routing, approvals, tool-calling, and workflow tests
npm test                 # Full regression suite (runs pretest native builds first)
npm run build            # Production web build
```

Platform builds (Windows PowerShell):

```powershell
# Windows WPF client & MSIX package
.\native\windows\build.ps1
.\scripts\package-bunny-msix.ps1

# Android companion APK / AAB (runs JVM tests)
.\scripts\build-android.ps1
.\scripts\build-android-aab.ps1
```

> **Note:** When running device or rig tests, isolate state with `BUNNY_HOST_DATA_DIRECTORY` pointing to a scratch folder rather than touching an installed Host's state.

## Install (End Users)

- **Windows 10/11:** Microsoft Store (coming with the public beta).
- **Android 8+:** Google Play (coming with the public beta).

## Help & Policies

- Questions and bugs: https://github.com/COMRADEART/bunny-A/issues
- Security reports: [SECURITY.md](SECURITY.md)
- Privacy: [PRIVACY.md](PRIVACY.md) · License: [LICENSE](LICENSE) · Open-source notices: [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)
- Contributor & agent guide: [AGENTS.md](AGENTS.md)
- Historical milestone & acceptance reports: [docs/reports/](docs/reports/)
