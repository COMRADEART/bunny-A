# Android notification evidence

## Implemented

`BunnyNotifications` is a `JavascriptInterface` named `BunnyNotify` with one post method. It accepts only `id`, `title`, `body`, and `category`. The page URL must be the same origin as the paired Host (`ServerAddress.sameOrigin`). `POST_NOTIFICATIONS` is in the manifest. API 33+ permission is checked before `NotificationManager.notify`. A channel `bunny-a-host` is created. The tap target opens `MainActivity`. There is no Firebase relay.

The web client posts only after `notification.decide` returns deliver. Offline, the WebView does not receive a new Host event, so it does not invent a completion notice.

## Not qualified

`adb` is not installed in this environment. No device was attached. The Java sources were not compiled with an Android SDK. A Java compile or a manifest diff is not a delivery pass.

Gate T0R-G6: **PARTIAL** (source and bridge contract; contract tested in `parseAndroidBridgeMessage`).  
Gate T0R-G7: **NOT TESTED**.
