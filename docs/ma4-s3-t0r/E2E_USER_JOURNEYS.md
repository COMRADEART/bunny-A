# End-to-end journeys

No installed Windows build and no Android device were exercised.

| Journey | Result |
|---|---|
| A First launch, Ollama, folder, first task | **NOT TESTED** |
| B Monitor change to a Windows OS notification, restart, no duplicate | **NOT TESTED** as an installed app. Host ledger dedup is unit-tested. OS toast is unsupported in this shell. |
| C Android pair, notify, pause, disconnect, revoke | **NOT TESTED**. `adb` is absent. |
| D Feedback preview, save, restart, export, clear | **PARTIAL**. File store test covers save, reopen, export, delete, clear. The Settings buttons were not clicked. |
| E Deadline then manager shutdown, natural exit | **PASS** for the harness in `ma4-s3-t0r.test.ts`. Not a packaged Host process. |
