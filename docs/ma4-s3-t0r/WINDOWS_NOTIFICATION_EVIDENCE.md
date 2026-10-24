# Windows notification evidence

## What is wired

`notification.decide` loads the event by sequence. A sequence that is not in the journal returns `forged_or_unknown_event`. Title and body come from the stored detail, then `sanitizeNotificationText`. Prefs, categories, quiet hours, and a per-audience ledger live in the Host `settings` table. The client may show a banner only when the Host returns `deliver: true`.

Foreground path when `Notification.permission === "granted"`: `new Notification(...)`.

## What was not observed

This repository has no Windows AppUserModelID toast activator. `WINDOWS_NOTIFICATION_CAPABILITY.osToast` is `false` and `windowClosedDelivery` is `false`. A closed or backgrounded window does not get an operating-system toast. That is a limitation of this shell, not a claim that the browser API is a background notification.

No installed Bunny-A window was driven for a real toast. Gate T0R-G5 is **NOT TESTED** for a visible Windows toast and **FAIL** for background delivery: the shell cannot do it.

Restart dedup is the Host ledger (`native_notification_ledger_v1:workstation`). The unit test delivered once and suppressed the second claim. A restart of a real desktop process was not performed.
