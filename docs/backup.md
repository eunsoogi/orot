# iCloud device backup and restore

Orot uses Apple's **iCloud device backup and restore** for a point-in-time copy of app data. This is not CloudKit or live synchronization: iCloud Backup takes periodic snapshots, and restoring an older snapshot can bring back data deleted after that snapshot. Orot cannot start, schedule, or observe completion of the operating system's backup.

The in-app readiness check verifies only local prerequisites: permanent recording files retain complete file protection and are not excluded from device backup; the SQLCipher database opens and passes a read query; and its existing Keychain key is readable with a restore-compatible accessibility class. A `ready` result means those local checks passed. It does not mean that an iCloud backup ran, completed, contains the latest changes, or can be restored on another device.

## What is retained

| Data | Local storage and restore policy |
| --- | --- |
| Health, symptom, medication, appointment, encounter, source, evidence, transcript, question, and visit-brief records | Stored in the encrypted `orot-secure.db` database under the iOS Library directory. Restore the stored values, stable IDs, provenance, revisions, and relationships as saved; do not silently regenerate user-reviewed content. |
| Calendar data retained by Orot | The selected event identifier and event snapshot are part of the saved appointment record. EventKit's live calendar contents and permission grant remain managed by iOS and may need to be checked or linked again. |
| HealthKit imports and sync checkpoints | Orot's imported records and local checkpoints are in the encrypted database. HealthKit access is system-managed; ask for permission again when iOS requires it and make any reimport an explicit app workflow. |
| Permanent consultation recordings | UUID-named `.m4a` and `.caf` files live in `Application Support/Recordings`. Keep complete file protection and set `isExcludedFromBackup` to `false`. On preparation, migrate existing recording files and read back both attributes. Their UUID matches the `audio_recording` source record and transcript references. |
| Transcript revisions and evidence links | Stored in the encrypted database with audio ranges, source IDs, engine/runtime provenance, correction history, and stale-artifact state. Keep the saved revisions; do not replace them with a new transcription during restore. |
| RAG evidence and vectors | Rebuild text chunks from saved sources, evidence spans, structured records, and current transcript revisions. Embedding vectors and their model/tokenizer hashes are persisted in the encrypted database and reused only when identity checks match. The temporary full-text search table is recreated for each query; missing or incompatible vectors can be regenerated from retained records. |
| Agent memory and workflow state | Serialized memory, removed-source tombstones, and workflow checkpoints use the same encrypted database. The in-memory ranking engine is reconstructed from those saved rows when it opens. Keep tombstones that exist in the restored snapshot so deleted source-linked memories are not reloaded from that snapshot. |
| Provider choice and authentication | The provider selection and OpenAI credentials use `ThisDeviceOnly` Keychain items. They are not moved to a different device by this backup design. Select a provider again if needed and sign in again; never copy OAuth tokens into ordinary app data. |
| Temporary transcription and sharing files | Transcription input/conversion files in `Caches` and short-lived share/export copies remain excluded from device backup and are deleted after processing or sharing. Speech and embedding model assets in `Caches` are downloaded again when needed. |

The SQLCipher database and recordings are app data, not server data. Orot does not add CloudKit synchronization or a paid Orot storage service for this feature. The user still needs an Apple Account with iCloud Backup enabled and enough iCloud storage for Apple's backup to complete.

## Key and recording migration

Before a future device backup, the app migrates the database key's Keychain accessibility from `kSecAttrAccessibleWhenUnlockedThisDeviceOnly` to `kSecAttrAccessibleWhenUnlocked`. The update preserves the exact key bytes used by SQLCipher and keeps the key unavailable while the device is locked. A separate device-only initialization marker permits retrying an interrupted first database creation with the same key; that marker is not restored to another device and cannot authorize creating a replacement for a missing restored database. The app reads the key item back and verifies both its value format and accessibility. [Apple documents the unlocked-only Keychain class](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlocked) and the separate `ThisDeviceOnly` class [here](https://developer.apple.com/documentation/security/ksecattraccessiblewhenunlockedthisdeviceonly).

Opening or preparing the permanent recording directory migrates existing UUID-named recordings: it reapplies complete file protection, clears backup exclusion, and verifies the result. Temporary transcription and sharing directories are outside this migration. The database uses OP-SQLite's iOS Library location; [OP-SQLite documents that location](https://op-engineering.github.io/op-sqlite/docs/configuration/). Apple's app data guidance describes backup eligibility for persistent app files and the different treatment of caches and temporary files ([data for iCloud Backup](https://developer.apple.com/documentation/foundation/optimizing-your-app-s-data-for-icloud-backup), [using the file system effectively](https://developer.apple.com/documentation/foundation/using-the-file-system-effectively)).

If the main database is absent but a WAL, shared-memory, or journal sidecar remains, Orot treats the files as a partial restore regardless of whether a key exists. It does not generate a key or open the sidecar as a fresh database. If an existing key is present but the database is absent, Orot also stops unless a device-only marker confirms that first-run database creation was interrupted; in that one case it retries with the same saved key. Missing restored data never triggers key rotation or empty-database replacement. A locked device or a failed Keychain/file-attribute readback leaves preparation unavailable; unlock the device and retry. A backup created before this migration cannot be repaired retroactively. Prepare the data on the original device, then let iOS make a later backup.

## Checking backup and restore

Use **Settings > [your name] > iCloud > iCloud Backup** to turn on device backup and review the latest successful backup. To check that Orot is included or resolve storage problems, see Apple's [app-selection and storage-management steps](https://support.apple.com/en-us/108922) and [backup troubleshooting steps](https://support.apple.com/en-us/102563). Those status and completion details belong to iOS; Orot does not display them as app-reported completion. See [Apple's iCloud Backup overview](https://support.apple.com/en-us/108770).

If iCloud is unavailable, storage is insufficient, or a backup is incomplete, the app can still report local eligibility but cannot diagnose or fix that operating-system state. After restoring, unlock the device and open Orot so it can read the restored database and key. If a database is present without its key, the app stops before opening it and asks for recovery instead of showing a new empty database. If a backup is restored from before a deletion, records in that snapshot may reappear; iCloud device backup does not propagate later deletions between snapshots. Tombstones protect only deletions already represented in the snapshot being restored.

Restore eligibility has not been verified with a real Apple Account, an iCloud backup, or a new physical device. Unit tests and Simulator builds can verify app logic and synthetic file metadata only; they are not evidence that Apple's backup completed or that a real restore succeeded.

## Local synthetic Simulator probe

The dedicated Detox probe checks app behavior and a synthetic app-container snapshot. It does not verify iCloud backup completion, Apple Account transfer, or restore to a physical device. Run it only on the assigned isolated Simulator with its assigned UDID and a separate DerivedData directory. The [backup Detox configuration](../apps/mobile/e2e/backup.detox.config.js) requires `OROT_BACKUP_SIMULATOR_UDID` and `OROT_BACKUP_DERIVED_DATA_PATH` to be set before both commands.

From the repository root, build and run the probe with:

```sh
pnpm --filter @orot/mobile exec detox build --config-path ./e2e/backup.detox.config.js --configuration ios.sim.release.backup
pnpm --filter @orot/mobile exec detox test --config-path ./e2e/backup.detox.config.js --configuration ios.sim.release.backup
```

The suite covers process restart and tombstones, migration of a legacy backup-excluded recording, key-migration rollback and retry, and restoring a synthetic app-container snapshot with recording relationships. Treat its output as local app-logic evidence only; use the physical-device procedure below to verify an actual iCloud backup and restore.

## Preparing a real-device restore verification

Use a dedicated new or spare test iPhone and test data that contains no personal health information. Do not erase a primary phone or use a personal Apple Account without explicit authorization. Apple's [manual iCloud backup steps](https://support.apple.com/en-us/108366) require Wi-Fi to remain connected until backup finishes; the iPhone guide explains that restore starts from Setup Assistant on a new or newly erased device ([restore from iCloud](https://support.apple.com/guide/iphone/restore-all-content-from-a-backup-iph1624229a/27/ios/27)). Apple also notes that apps and other content can continue restoring in the background after setup ([restore progress details](https://support.apple.com/en-us/118105)).

1. On the source iPhone, record the device model, iOS version, Orot version/build, and non-sensitive IDs for two synthetic fixtures: a recording with its linked source and transcript that should restore, and a source with linked memory/search data that you delete before backup. Confirm the first fixture is readable and linked, and record the delete action for the second. The manual backup in the next step must happen after this deletion so the selected snapshot includes it. Do not claim that a tombstone row was observed unless the test surface exposes it.
2. In **Settings > [your name] > iCloud > Storage or Manage Account Storage > Backups > [this device]**, check Orot's per-app backup setting. On the dedicated test phone, ensure Orot is included before the manual backup and record the visible setting. If Orot is not listed or the setting cannot be inspected, mark it `Unobservable` instead of inferring inclusion. Return to **iCloud Backup**, choose **Back Up Now**, and stay on Wi-Fi until it finishes. Record the iOS-reported last-backup date and time. This timestamp is the evidence of OS backup completion; Orot's local `ready` result is not. See Apple's [iCloud storage management steps](https://support.apple.com/en-us/108922).
3. On a dedicated new or newly erased target iPhone, use Setup Assistant to restore from that iCloud backup, signing in to the Apple Account that contains the selected backup. Record the selected backup timestamp and target device/iOS version. Keep the target on Wi-Fi and power while iOS restores its content. Record when the initial restore progress completes; apps and other content can continue restoring in the background for hours or days.
4. Wait until Orot is installed and its backup restore has settled before judging its data. If Orot is still downloading or the restore status is unclear, record the check as `Pending` or `Unobservable`. Once ready, record the restored app version/build and local recovery/readiness state. Verify the recording fixture retains its IDs and source/transcript relationship and that its permanent file opens. Reopen or rebuild the normal search and memory state, then verify the fixture deleted before backup remains absent. Attempt same-ID reimport only through a supported app path; if none is available, record it as `Not run` and keep the separate storage regression evidence distinct. Record provider reauthentication and live Calendar or HealthKit permission/link checks separately; the appointment snapshot remains ordinary restored database data, while credentials and OS-managed grants may need to be re-established.
5. Save only redacted screenshots and a result table containing the run ID, source/target models and iOS versions, Orot builds, selected/last-backup timestamps, and pass/fail for database opening, key recovery, recording readability, and source/transcript linkage. Do not capture Apple Account identifiers, real health data, audio, or credentials.

Report this as evidence for the tested snapshot only. If that snapshot predates a deletion, restored data may return; the result does not prove cross-snapshot deletion synchronization. A real-device run is still pending until these observations are collected from Apple's completed backup and a physical-device restore.

### Run record template

Use a synthetic fixture. Mark checks `Pending` while iOS or Orot is still restoring, and use `Not run` or `Unobservable` when evidence is unavailable; do not infer a pass from local readiness.

| Run details | Record |
| --- | --- |
| Run ID | |
| Source iPhone model / iOS / Orot build | |
| iOS-reported last successful backup timestamp and timezone | |
| Orot listed and included in the selected device backup (`Unobservable` if unavailable) | |
| Target iPhone model / iOS / restored Orot build | |
| Selected backup timestamp | |
| Initial iOS restore complete / Orot app and data restore settled | |

| Check | Expected observation | Outcome / redacted evidence reference |
| --- | --- | --- |
| Database and key | Existing encrypted database opens after unlock without replacement by an empty database | |
| Recording and relationships | Local readiness passes on both devices; when diagnostic attributes are exposed, protection is complete and backup exclusion is false; the synthetic recording opens and source/transcript IDs and links match the fixture | |
| Deletion and reconstruction | Fixture deleted before the selected backup remains absent after restore and normal search/memory reconstruction; do not infer a tombstone row unless exposed by the test surface | |
| Same-ID reimport | A supported app path rejects reimport of the deleted fixture ID; if no such path is available, record `Not run` and cite the separate storage regression | |
| Provider and OS permissions | Provider sign-in, Calendar link, and HealthKit permission are recorded separately from restored database data | |

Keep this record free of Apple Account identifiers, real health data, audio, and credentials. A record with any `Pending`, `Not run`, or `Unobservable` row is preparation evidence, not a successful restore result.
