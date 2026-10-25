# Notification delivery

## Windows in-app monitor notice

Monitor `Status watch`, id `mon-8d042f4e-9d16-42ee-ab17-1c35acc2f5f3`, state ACTIVE, notify on, JSON field `status`, transition PASS to FAIL, every 1 minute.

The first check at 09:07 PM was an invalid reading. The file had been written with a UTF-8 BOM. After a BOM-free `{"status":"PASS"}`, later checks reported no change.

The file was then set to `{"status":"FAIL"}`. The UI recorded one notice:

- Away line: `1 change found in 12 checks`, later `14 checks` and `16 checks` with the same one change
- Notice: `Status watch Source changed · Sat 09:19 PM` / `Status changed: now "FAIL".`
- Following check at 09:21 PM: `no change`, last change still 09:19 PM

One durable in-app notice. No second notice while the value stayed FAIL. Quiet hours were 22:00–07:00 and the notice was delivered before 22:00, so quiet hours did not hold it.

Classification of the in-app transition notice: **PASS**.

## Windows operating-system delivery

Observed product copy:

> Foreground banners while this window is open. Closing the window stops operating-system delivery. There is no background Windows toast in this build.

Enable called `Notification.requestPermission()` and stored host notification prefs. The page then read `Permission: granted. Host notifications on.` That click did not display an operating-system toast. `nativeNotificationsOptIn` in onboarding remained false.

Background Windows toasts stay **unsupported**. There is no installed, window-closed delivery path in this build, and none was tested. Foreground permission can be granted; a foreground operating-system banner was **NOT TESTED** as a visible toast (permission only).

## Android

No physical device and no ADB. Android display, permission denial, and regrant are **NOT TESTED**. See `ANDROID_HARDWARE_QUALIFICATION.md`.
