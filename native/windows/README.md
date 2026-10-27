# Bunny A Windows native preview

This is an incomplete WPF prototype. It reads a local authenticated Host
snapshot when `BUNNY_HOST_CREDENTIALS_FILE` names an existing Host credentials
file. It does not start or install a Host or launch a browser. It can request
cancellation of a selected task through the Host command
API with the observed Host identity and epoch. It does not yet provide conversation,
task creation, approvals, the notch,
voice, onboarding, tray integration, installation, or update handling.

Build with the .NET SDK 8.0.408 on Windows using `build.ps1`. The optional
`-Dotnet` argument selects the executable for an isolated SDK installation.
The project uses no third-party NuGet packages. Build output is a development
artifact, not a signed or installable release.

The offline state and Refresh button have been observed in an actual WPF window.
A separate run connected to an authenticated disposable Host and displayed its
task snapshot. Selecting Cancel in the WPF window cancelled a controlled test
task; the Host confirmed `CANCELLED`. The Host used an isolated database and a
fixture executor, with no model invocation.
Accessibility and installation/upgrade have not been qualified. Do not replace
the existing Island or launcher with this preview. All consumer release gates
remain open.
