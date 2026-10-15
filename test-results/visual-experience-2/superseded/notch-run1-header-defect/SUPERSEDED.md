# Superseded: native Notch matrix run 1

115/115 runs passed every receipt check, yet the screenshots (see `sheets/`) show the defect those checks could not see:
on every light-palette theme the header's status text ("Ready") and icons were light-on-light. Cause: the Notch header
(`DockPanel x:Name="Header"`) carries local brushes tuned for the always-black T13 glass body, which shadow the window
palette that `Set-BunnyTheme` remaps.

Fix (source): `install/Bunny-Island.Visual.ps1` `Set-BunnyTheme` now gives a themed body's header the theme's validated ink and
restores the accepted T13 header brushes for glass and Windows High Contrast; regression assertion in
`scripts/island-theme.test.mjs`. Driver change (evidence): `harness/notch/run-notch.ps1` now records the status text's
actual foreground and fails a run below 4.5:1 against the body fill (`statusReadable`). Probe after the fix:
`gate-f/probe2/` (clay 14.37:1, brutalism 19.8:1, glass 14.8:1, cyberpunk 17.06:1). The full matrix was re-run into `notch/`.
