# Android CSV local receiver fixture

This QA-only app accepts an Android `ACTION_SEND` content URI, reads the actual granted stream, saves `received.csv` and `proof.json` inside its own private data directory, and displays the byte count, SHA-256 and UTF-8 text. It has no network permission and never sends to a contact or external account.

Build on this repository's Windows test host:

```powershell
./tests/ops/build-csv-receiver.ps1
```

The script uses the already installed Android SDK 36 and the verified JDK 17 recorded under `.tmp/toolchains`, and signs with the project's standard Android debug keystore. Outputs stay under project `.tmp`; the script does not install or interact with any emulator.

For this project, installation and extraction are allowed **only on `emulator-5558`**. Confirm the package is absent before installing the fixture. Invoke the ERP application's actual CSV share action; Android grants the receiver temporary read access. Extract the resulting test bytes with an explicitly scoped command, for example `adb -s emulator-5558 exec-out run-as com.manage3d.csvreceiver.qa cat files/received.csv`, preserving binary output. Compare the byte hash and parsed fields with the real server export.

After QA, remove `com.manage3d.csvreceiver.qa` and the separate ERP verification package, and preserve the user's daily app and emulator. Never install this fixture to another emulator or include it in a production build.
