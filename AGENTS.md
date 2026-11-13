# Bunny A — guide for coding agents

Bunny A is a local-first AI workstation: a Node **Host** on the owner's Windows PC, a native **Windows client**
(WPF, .NET 8) with a glass notch, and a native **Android companion** that pairs with the Host over HTTPS.
Repository: `COMRADEART/bunny-A`; default branch `main` (protected, admins enforced).

## Layout

| Path | What it is |
|---|---|
| `src/lib/bunny-host/` | The Host: missions, agents, routing, approvals, devices, voice. Most tests live beside the code. |
| `src/lib/bunny-missions/` | Mission engine, staging and remote-authority rules. |
| `src/components/island/`, `src/routes/` | Web UI (TanStack Start + React 19) served by the Host and used by the remote view. |
| `scripts/bunny-host.mjs` | Host entry for development (`npm run host`). |
| `native/windows/` | `BunnyA.exe` WPF client and notch; see `native/windows/README.md`. |
| `android/` | Native companion (no WebView, `INTERNET` permission only); JVM tests in `android/tests/`. |
| `install/` | Release launcher, `release-pin.json` (active) and `release-pin.candidate.json`. |
| `releases/` | Built artifacts (MSIX, APK, AAB, zips) and their hashes. |
| `docs/ux/e6r*/` | Current release-qualification records and gate verdicts. |
| `docs/roadmap/` | Product masterplan and owner live rounds. |

## Commands

```sh
npm run typecheck        # tsc --noEmit
npm run lint             # eslint
npm run test:ui          # island UI model tests (fast)
npm test                 # full regression; pretest builds the owned-process helper and voice worker
npm run host             # run a development Host
npm run build            # web build (CI runs this)
```

- Windows client: `native/windows/build.ps1` (pinned SDK in `global.json`); MSIX: `scripts/package-bunny-msix.ps1`.
- Android: `scripts/build-android.ps1` (APK) and `scripts/build-android-aab.ps1` (AAB); both run the JVM tests.
  Release signing of the AAB is a separate, owner-approved step: `scripts/sign-android-aab.ps1`.
- `npm run dev` rewrites `src/routeTree.gen.ts`; revert that file unless routes really changed.

## Rules

1. **Never fabricate evidence.** Attended results (phone, Narrator/TalkBack, microphone, multi-monitor) are recorded
   only from what was actually observed. If a gate was not run, record NOT RUN or BLOCKED.
2. **Owner-held boundaries:** signing certificates and keys, store accounts, promoting `install/release-pin.json`,
   opening a public tunnel, and changing the machine's audio settings all need the owner's explicit go-ahead each time.
3. **Do not touch the owner's installed Host or its state.** Device and rig tests use a disposable Host with
   `BUNNY_HOST_DATA_DIRECTORY` in a scratch folder.
4. **Security posture is product behaviour:** consequential actions go through the Approval Center; the Android app
   stays HTTPS-only with a single permission; no telemetry leaves the device. Changes here need tests.
5. **Merging:** update the branch from `main`, then merge only on that updated commit's green CI run.
6. New non-trivial logic ships with a test next to it, in the style of the surrounding tests.
