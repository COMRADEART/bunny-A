# Android voice capability

No Android voice adapter was added. The Windows voice worker is not part of the Android app. Full duplex on Android is **not tested** and is not a pass.

## What the app is

`android/` is a WebView companion (`com.routeragent.jev`, versionName 2.1). It stores a server origin and loads the Host over HTTPS. There is no claim that this process captures or plays a duplex session.

## Manifest and WebView

| Capability | This tree |
| --- | --- |
| `INTERNET` | Declared |
| `POST_NOTIFICATIONS` | Declared |
| `RECORD_AUDIO` | Not declared |
| `MODIFY_AUDIO_SETTINGS` | Not declared |
| WebChrome `onPermissionRequest` | Not implemented |
| JavaScript bridge for audio | Not present. `BunnyNotify` is the existing notification hook |
| Cleartext | Disabled |
| Invalid certificates | Cancelled |

A page inside the WebView could still call browser microphone APIs. This app does not grant that permission, and this milestone did not add a grant. No physical Android device was attached, so WebView `getUserMedia` was not tried.

## Hardware prerequisite before any later adapter

A separately authorized adapter would need a user-visible capture grant, a way to show capture is live, a tested echo path on that device, and a Host session that still owns authorization. Until those exist, Android voice stays a remote view of the Windows Host.
