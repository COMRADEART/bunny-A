# Native Android companion

Since MA5-S1 the launcher opens `NativeCompanionActivity`, a native Views client. The legacy WebView `MainActivity`
and its notification bridge were removed; the manifest keeps only the old component name, `.MainActivity`, as an
`activity-alias` of the native activity so home-screen icons pinned by earlier versions still resolve after an upgrade.
The compiled app references no `android.webkit` class (checked on `classes.dex` by `scripts/build-android.ps1`).

What it does: HTTPS pairing with a one-time code (address prefilled from the WebView build's saved address), a
supervision list of Missions and persistent tasks with Stop, a count of approvals waiting on Windows, local tool-free
chat with Stop, Host identity and epoch, and self-revocation that erases the Android Keystore key. Approvals, file
changes, shell and tools stay on the Windows workstation; the Host refuses them for a paired phone.

Session protection is unchanged: the device credential is encrypted with an Android Keystore AES-GCM key, the paired
Host identity is pinned on every response, HTTP and redirects are refused, and every command carries the pinned Host id
and the epoch of the view it came from. Failures are classified: revoked or expired access and a changed Host identity
stop polling and ask to pair again; network and Host outages retry with bounded backoff (2 s doubling to 60 s, a Host
`Retry-After` is honoured). The pairing screen is `FLAG_SECURE`.

Updates are HTTP polling while the screen is visible (1.5 s during a chat, 5 s on Tasks, 10 s elsewhere); polling stops
in `onStop` and both worker threads stop in `onDestroy`. Only one state request is in flight; a response older than one
already shown is dropped (`PollPolicy`, tested on the JVM). This is polling, not streaming.

The companion posts no notifications and requests only `INTERNET`.

Qualification: the APK builds and its JVM tests pass on Java 21. No physical device was available, so installation,
upgrade over an installed build, Keystore behaviour on hardware, TalkBack and real network loss remain NOT TESTED.
APKs are signed with a locally generated development key, not the existing companion key; they cannot upgrade an
installation signed with another key.

The build accepts Java 21.0.x at or above the patch in `native-preview-toolchain.json` (`java.minimumPatch`); CI pins
`java.ciPinned`. Tool hashes are verified as before. Public beta remains NO-GO.
