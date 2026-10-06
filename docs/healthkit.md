# HealthKit boundary

## Change contract

- **Requested behavior:** Report whether HealthKit is available, request read access for one named Orot feature only when its caller explicitly asks, expose a reusable native query boundary, and locally import medication, blood-pressure, sleep, and supported quantity observations through their owning feature flows. Never request write access or claim that a read request was granted or denied.
- **Preserved behavior:** Other Orot features remain usable when HealthKit is unavailable, a request cannot be completed, or a query returns no visible samples. Import callers retain source identifiers, available device metadata, and sample timestamps.
- **Non-goals:** Write HealthKit data; add a backend; infer a healthy/normal value from an empty result; merge overlapping sleep samples; or calculate a winning sleep stage or total sleep duration.
- **Material risks:** HealthKit intentionally hides whether read permission was denied. An empty query means no samples are visible to this app for that query and cannot establish whether data is absent from HealthKit. Medication HealthKit APIs require iOS 26 or later. Blood-pressure values use the supported HealthKit query unit in mmHg. Preserve an original amount/unit pair only when a source explicitly supplies an authoritative pair; otherwise store the typed unavailable state and do not infer it from preferred display units or converted values. The iOS 27 Simulator throws when a blood-pressure correlation type is included in the read-authorization set; the boundary excludes it from that set while retaining correlation query selection. Real-device authorization behavior and sample visibility remain unverified. Simulator HealthKit availability is separate from synthetic adapter behavior.
- **Evidence needed:** Requirement-linked TypeScript tests; a native bridge probe using only synthetic fixtures; an actual iOS Simulator availability readback with unsupported capabilities reported honestly; the repository's required checks on the final head; and an independent strict review.

## Authorization model

The public API accepts a feature key, not an arbitrary list of HealthKit types. The native allowlist maps each key to only the types needed by that feature. It passes an empty write set to `requestAuthorization` and never calls `authorizationStatus(for:)`, which reports sharing authorization rather than read authorization.

The authorization request reports `completed` only when HealthKit reports success with no error. A failed request remains an error; it is not labeled as a user cancellation. Request completion still does not establish whether read access was granted, so read authorization is always reported as `notObservable`.

The native allowlist requests the medication definition and dose-event types for medications; the systolic and diastolic component types for blood pressure; the sleep-analysis category for sleep; and one quantity type for heart rate, steps, or body mass. The authorization plan used by the request has an empty write set. The blood-pressure query still selects the correlation type, but its visibility is not established by the Simulator authorization test.

## Query model

Queries require a feature, a sample kind belonging to that feature, a bounded date interval, and a finite result limit. Results describe only the samples visible to the app. An empty result is not labeled as denied, as proof that no health data exists, or as a normal/healthy value. The lower-level native query methods do not persist data or map it into Orot records; feature importers own those operations.

## Sleep import

`syncHealthKitSleep` consumes the anchored `sleep` sample stream in bounded pages. Each page stores normalized `health_observation` records and its opaque HealthKit cursor in the same repository transaction. Retries replay safely from the last committed cursor; changed samples replace their previous observation and deleted sample identifiers remove it. The importer preserves HealthKit source identifiers and names, available source version/product type and device fields, and the absolute sample interval. It does not invent a source-recorded timestamp or treat an unobservable read grant as approved.

Each imported observation keeps its original integer sleep category, start and end timestamps, source metadata, and available device metadata. Known category values also receive a stable label; unknown integer values remain visible with their raw value. Distinct sample IDs remain separate even when their intervals overlap; the app does not merge intervals, select a winning stage, or calculate sleep-duration totals. A bounded query with no visible observations is an empty result (`no data`), not a normal sleep value and not proof that HealthKit access was denied.

Medication concept identifiers are exposed as opaque Base64 secure-coded HealthKit identifiers because HealthKit does not publish a raw string identifier. Consumers must not parse them or treat them as clinical codes. This boundary does not promise that their serialized representation stays stable across operating-system releases.

## Blood-pressure import

`syncHealthKitBloodPressure` requests anchored pages for blood-pressure correlations and commits each page's observations, explicit correlation deletions, and cursor through one `RecordRepository.transaction`. The checkpoint key is `healthkit:bloodPressure:bloodPressure`; the next page is queried only after the prior page transaction succeeds. Replays use correlation-based observation IDs and preserve the first ingestion time. A deletion removes both component observations. If an updated correlation omits a component, its stale row is deleted and no replacement or normal value is invented.

Each observed component becomes a separate `HealthObservation` with its exact HealthKit start/end timestamp strings, source/device provenance, and an unreviewed state. HealthKit's shared snapshot reports the value in a canonical query unit; blood pressure is stored in mmHg. The source's original display unit is not available through HealthKit, so `value.sourceRepresentation` explicitly records that limitation rather than relabeling the normalized value as original. The query boundary does not expose a source creation timestamp, so imported records omit `recordedAt` instead of filling it with local ingestion time.

Before querying, the importer requests feature-scoped HealthKit read authorization. HealthKit does not expose whether a read grant was made, so request completion remains `readAuthorization=notObservable`. The importer does not write HealthKit data.

## Simulator probe

The dedicated probe can be built and run with `pnpm exec detox test --config-path e2e/healthkit-probe.detox.config.js --configuration ios.sim.debug.healthkit-probe` from `apps/mobile`. Its debug-only adapter reports the real `HKHealthStore.isHealthDataAvailable()` result separately, checks every feature's selected native sample type and read plan, and supplies synthetic authorization-completion, sample, empty-query, and medication-definition responses. It does not request real HealthKit access, save HealthKit samples, or prove that real samples are readable. The adapter is compiled only for Debug Simulator builds and is absent from Release and device builds.

The iOS Simulator cannot establish real device data availability, a user's read grant, or the contents of the user's HealthKit store. The probe logs real HealthKit availability and labels all record responses as synthetic; it does not claim physical-device or real-sample verification.

### Blood-pressure probe

After installing workspace dependencies and synchronizing iOS Pods from the repository root, create a task-owned Simulator and choose unique DerivedData and artifact paths plus a free Metro port (the example uses 8222):

```sh
pnpm install --frozen-lockfile
pnpm --filter @orot/mobile ios:pods
```

From `apps/mobile`, set the same simulator, DerivedData path, and port in both terminals:

```sh
export OROT_BLOOD_PRESSURE_SIMULATOR_UDID="replace-with-dedicated-simulator-uuid"
export OROT_BLOOD_PRESSURE_DERIVED_DATA_PATH="/tmp/orot-blood-pressure-unique-run"
export OROT_BLOOD_PRESSURE_METRO_PORT=8222
export OROT_BLOOD_PRESSURE_ARTIFACTS_DIR="/tmp/orot-blood-pressure-unique-run-artifacts"
```

Keep the probe-configured Metro server running in one terminal:

```sh
pnpm exec react-native start \
  --config e2e/blood-pressure-probe.metro.config.js \
  --port "$OROT_BLOOD_PRESSURE_METRO_PORT"
```

Build the probe app and run its Detox test from the other terminal:

```sh
pnpm exec detox build --config-path e2e/blood-pressure-probe.detox.config.js \
  --configuration ios.sim.debug.blood-pressure-probe
pnpm exec detox test --config-path e2e/blood-pressure-probe.detox.config.js \
  --configuration ios.sim.debug.blood-pressure-probe --headless \
  --artifacts-location "$OROT_BLOOD_PRESSURE_ARTIFACTS_DIR"
```

The current probe starts from a fresh install, imports one synthetic correlation through the visible blood-pressure screen, and reads the resulting observations through the app's local observation loader. It checks the displayed systolic/diastolic values, time, source, unavailable original pair, and `readAuthorization=notObservable`; its log reports `sqlCipher=available`. This flow does not replay changes, inspect the stored cursor, or restart the app to verify persistence across process restarts. Focused blood-pressure tests cover replay, deletion, and cursor transactions.

Attempt 16 separately verified encrypted row and cursor readback after a process restart on its earlier source revision. The blood-pressure authorization code and native storage build inputs changed afterward, so that run is historical evidence and does not establish process-restart persistence for the current revision. The current probe does not query real HealthKit samples: `productionQuery=notRun`, `productionSamples=unverified`, and personal values are withheld. It performs no HealthKit writes. The imported canonical pressure values are in mmHg; preserve an original pair only when the source explicitly provides an authoritative pair, and otherwise store and display the unavailable state.

### Sleep probe

Issue #19 has a dedicated sleep probe. From `apps/mobile`, build it with `pnpm exec detox build --config-path ./e2e/sleep-import-probe.detox.config.js --configuration ios.sim.debug.sleep-import-probe`, then run `pnpm exec detox test --config-path ./e2e/sleep-import-probe.detox.config.js --configuration ios.sim.debug.sleep-import-probe --headless --no-start --cleanup`. Set `OROT_SLEEP_IMPORT_DERIVED_DATA_PATH` and `OROT_SLEEP_IMPORT_SIMULATOR_UDID` to isolate the build and simulator. `--no-start` keeps Metro from replacing the embedded probe entry, and omitting `--reuse` ensures Detox installs the configured app rather than launching another probe left on the simulator. The Debug-only adapter returns synthetic sleep samples; the probe checks the native category, interval, and source fields, normalizes the anchored addition, and verifies cursor resumption. It reports `source=synthetic` and `realSamples=unverified`; it does not establish real sample access or exercise persistence/deletion through the simulator database. Focused importer tests cover atomic page writes, retry, raw upsert, deletion, and retention of overlapping samples with distinct IDs. Issue #19 does not require a physical-device run for 0.1.0.

## Apple API references

- [Authorizing access to health data](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)
- [Protecting user privacy](https://developer.apple.com/documentation/HealthKit/protecting-user-privacy)
- [HKHealthStore.requestAuthorization(toShare:read:completion:)](<https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization(toshare:read:completion:)>)
- [HKSampleQuery](https://developer.apple.com/documentation/healthkit/hksamplequery)
- [HKAnchoredObjectQuery](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
- [HKDeletedObject](https://developer.apple.com/documentation/healthkit/hkdeletedobject)
- [HKCategoryValueSleepAnalysis](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)
- [HKUserAnnotatedMedicationQueryDescriptor](https://developer.apple.com/documentation/healthkit/hkuserannotatedmedicationquerydescriptor)

The installed Xcode simulator SDK is 27.0. Its HealthKit declarations mark user-annotated medication and medication-dose-event types as available from iOS 26. The Swift sources, HealthKit framework, read-purpose string and HealthKit entitlements are registered in the app target. iPhone builds use the minimal HealthKit entitlement; Simulator builds retain the synthetic team, application and keychain identifiers required by the local probe.

On 2026-10-05, the Debug app built and ran on the iPhone Air iOS 27.0 Simulator, and the dedicated Detox probe passed 1/1. The observed HealthKit availability was `available`; the `medications=supported` result and all record/query outcomes came from the test-only adapter. The probe confirmed `writeTypes=0`, feature-scoped type selection, `readAuthorization=notObservable`, and `realSamples=unverified`. This does not establish a user's read grant or real HealthKit sample access. Device signing and provisioning have not been validated with a real account.
