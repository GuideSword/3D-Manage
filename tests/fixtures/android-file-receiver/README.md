# Android local file receiver and gesture fixture

QA-only package `com.manage3d.filereceiver.qa`, with no network permission. It accepts a granted `ACTION_SEND` content URI only from `com.anonymous.x3DManage.erp02d3afiles.*` or `com.anonymous.x3DManage.modeldownloadsqa.*`, saves up to 16MiB as private `received.bin`, and records the byte count, SHA-256, MIME type and URI in private `proof.json`. It never sends a file to a contact or external account.

Build on the repository Windows host:

```powershell
./tests/ops/build-file-receiver.ps1
```

The builder uses the installed Android SDK36 and recorded JDK17, signs with the standard project debug keystore, verifies absence of INTERNET permission and writes only below project `.tmp`. It does not install, select or control a device.

Install only on the already approved `emulator-5558`, after matching its saved AndroidID and checking that this fixture package is absent. To update an existing fixture, first compare the installed APK hash against this run's saved receiver installation proof. Never install to another emulator or replace the daily ERP app.

Use the ERP QA app's actual download/share control and select `ERP 文件本地验收`. Extract `files/received.bin` and `files/proof.json` via `adb -s emulator-5558 exec-out run-as com.manage3d.filereceiver.qa cat ...`; capture binary output directly in Python/subprocess, not a PowerShell text pipeline. Compare the bytes/hash with the original test file and real server record.

The separate `GestureInstrumentation` injects pinch or pan only when the active accessibility window belongs to `com.anonymous.x3DManage.erp02d3afiles`. It waits briefly for a non-null root, rejects any other foreground package before sending events, uses coordinates within the QA viewport and launches no activity. With the ERP QA image preview already open:

```powershell
adb -s emulator-5558 shell am instrument -w -e action pinch com.manage3d.filereceiver.qa/.GestureInstrumentation
adb -s emulator-5558 shell am instrument -w -e action pan com.manage3d.filereceiver.qa/.GestureInstrumentation
```

A successful injection alone does not prove a gesture worked: inspect before/after screenshots of a visible test pattern. After QA, remove this owned fixture, the separate ERP QA package, exact owned Downloads files and only this run's reverse mapping; preserve the daily app, emulator and other devices. Do not include either fixture in production artifacts.
