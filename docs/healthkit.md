# HealthKit boundary

## Change contract

- **Requested behavior:** Report whether HealthKit is available, request read access for one named Orot feature or an explicit selected feature batch only when its caller asks, expose a reusable native query boundary, and locally import medication, blood-pressure, sleep, and supported quantity observations through their owning feature flows. Never request write access or claim that a read request was granted or denied.
- **Preserved behavior:** Other Orot features remain usable when HealthKit is unavailable, a request cannot be completed, or a query returns no visible samples. Import callers retain source identifiers, available device metadata, and sample timestamps.
- **Non-goals:** Write HealthKit data; add a backend; infer a healthy/normal value from an empty result; merge overlapping sleep samples; or calculate a winning sleep stage or total sleep duration.
- **Material risks:** HealthKit intentionally hides whether read permission was denied. An empty query means no samples are visible to this app for that query and cannot establish whether data is absent from HealthKit. Medication HealthKit APIs require iOS 26 or later. Blood-pressure values use the supported HealthKit query unit in mmHg. Preserve an original amount/unit pair only when a source explicitly supplies an authoritative pair; otherwise store the typed unavailable state and do not infer it from preferred display units or converted values. The iOS 27 Simulator throws when a blood-pressure correlation type is included in the read-authorization set; the boundary excludes it from that set while retaining correlation query selection. Real-device authorization behavior and sample visibility remain unverified. Simulator HealthKit availability is separate from synthetic adapter behavior.
- **Evidence needed:** Requirement-linked TypeScript tests; a native bridge probe using only synthetic fixtures; an actual iOS Simulator availability readback with unsupported capabilities reported honestly; the repository's required checks on the final head; and an independent strict review.

## Authorization model

The public API accepts feature keys, not arbitrary HealthKit types. The native allowlist maps each key to only the types needed by that feature; a batch unions only the selected features' read sets and makes one `requestAuthorization` call. It passes an empty write set and never calls `authorizationStatus(for:)`, which reports sharing authorization rather than read authorization.

The authorization request reports `completed` only when HealthKit reports success with no error. A failed request remains an error; it is not labeled as a user cancellation. Request completion still does not establish whether read access was granted, so read authorization is always reported as `notObservable`.

The native allowlist requests the medication definition and dose-event types for medications; the systolic and diastolic component types for blood pressure; the sleep-analysis category for sleep; and one quantity type for heart rate, steps, or body mass. The authorization plan used by the request has an empty write set. The blood-pressure query still selects the correlation type, but its visibility is not established by the Simulator authorization test.

The common-observation importer requests the selected heart-rate, step-count, and body-mass features together before starting any anchored query or local transaction. Unsupported selected features remain separate outcomes, while a native request failure stops the import before query or storage work. Concurrent identical imports for one repository share the in-flight operation; a completed or failed operation is removed so an explicit retry can run. Standalone feature flows retain the single-feature request method.

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

The common-observation flow has a separate probe configured with `e2e/common-observations-probe.detox.config.js` and `e2e/common-observations-probe.e2e.js`. It prepares a multi-feature synthetic fixture, verifies that the native batch plan equals the union of the supported selected plans for all six HealthKit features, then checks the visible common-observation import, encrypted local transactions, and cursor replay. The summary includes only request/query/transaction counts and aggregate durations for the first import and replay. Because authorization completion comes from the synthetic adapter, `authorization_ms` is only the local bridge round trip; it does not measure a real OS permission sheet or the user's iPhone delay. This HealthKit-only probe has no following EventKit prompt to time, and the two systems' consent screens remain independent.

After installing dependencies and syncing iOS Pods from the repository root, set a dedicated Simulator UDID, DerivedData path, and unused Metro port. For example, from `apps/mobile`:

```sh
export OROT_COMMON_OBSERVATIONS_SIMULATOR_UDID="replace-with-dedicated-simulator-uuid"
export OROT_COMMON_OBSERVATIONS_DERIVED_DATA_PATH="/tmp/orot-common-observations-unique-run"
export OROT_COMMON_OBSERVATIONS_METRO_PORT=8220
pnpm exec react-native start \
  --config e2e/common-observations-probe.metro.config.js \
  --port "$OROT_COMMON_OBSERVATIONS_METRO_PORT"
```

In a second terminal from `apps/mobile`, run the probe on that same Simulator:

```sh
pnpm exec detox build --config-path e2e/common-observations-probe.detox.config.js \
  --configuration ios.sim.debug.common-observations
pnpm exec detox test --config-path e2e/common-observations-probe.detox.config.js \
  --configuration ios.sim.debug.common-observations --headless --no-start --cleanup
```

The result reports `source=synthetic`; its phase durations contain no feature names, source identifiers, sample IDs, or values. The simulator and synthetic timings do not verify the reported real-device delay, real read access, user cancellation UX, or Calendar/EventKit prompting.

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

The current probe starts from a fresh install, imports one synthetic correlation through the visible blood-pressure screen into the app's SQLCipher-backed repository, and terminates and relaunches the app. It reads both saved components and the stored fixture cursor after restart, compares each exact timestamp, source, and unavailable original-pair display with the pre-restart values, then replays the same fixture and asserts zero upserts/deletions, no cursor advance, and two stored observations. The probe reports `sqlCipher=available`; the cursor display is only a comparison to the known synthetic fixture value and never exposes a raw HealthKit anchor.

The current process-restart evidence is Detox attempt 20 on a dedicated iOS 27 Simulator. Attempt 16 remains historical evidence from its earlier source revision and is superseded for this claim. This probe still does not query real HealthKit samples: `productionQuery=notRun`, `productionSamples=unverified`, and personal values are withheld. It performs no HealthKit writes or physical-device validation. The imported canonical pressure values are in mmHg; preserve an original pair only when the source explicitly provides an authoritative pair, and otherwise store and display the unavailable state.

### Sleep probe

Issue #19 has a dedicated sleep probe. From `apps/mobile`, build it with `pnpm exec detox build --config-path ./e2e/sleep-import-probe.detox.config.js --configuration ios.sim.debug.sleep-import-probe`, then run `pnpm exec detox test --config-path ./e2e/sleep-import-probe.detox.config.js --configuration ios.sim.debug.sleep-import-probe --headless --no-start --cleanup`. Set `OROT_SLEEP_IMPORT_DERIVED_DATA_PATH` and `OROT_SLEEP_IMPORT_SIMULATOR_UDID` to isolate the build and simulator. `--no-start` keeps Metro from replacing the embedded probe entry, and omitting `--reuse` ensures Detox installs the configured app rather than launching another probe left on the simulator. The Debug-only adapter returns synthetic sleep samples; the probe checks the native category, interval, and source fields, normalizes the anchored addition, and verifies cursor resumption. It reports `source=synthetic` and `realSamples=unverified`; it does not establish real sample access or exercise persistence/deletion through the simulator database. Focused importer tests cover atomic page writes, retry, raw upsert, deletion, and retention of overlapping samples with distinct IDs. Issue #19 does not require a physical-device run for 0.1.0.

## Selected HealthKit and EventKit import

`HealthKitImportScreen` accepts selected HealthKit types and an optional EventKit provider selection in one explicit action. The coordinator requests the selected HealthKit types in one HealthKit batch and requests EventKit access through its separate consent API. It waits for every selected provider request to return before querying either provider. HealthKit and EventKit access states and outcomes remain independent; failure or empty results from one provider do not hide the other provider's results. HealthKit read access remains `notObservable`; the request callback is not a grant result, and an empty query remains an empty visible result.

An EventKit query lists only upcoming candidates in the existing `[now, now + 1 year)` window, capped at 100. The user must select one candidate and explicitly confirm before it is linked to an appointment; candidate lookup alone does not import or save calendar events. Confirmation updates an active appointment for the same event occurrence or creates one, and is measured as local persistence.

Each run emits provider, phase, transition, monotonic offset from the app action, phase duration, and a finite outcome. The measurements contain no wall-clock timestamps, health values, event titles, source identifiers, or raw errors. `permissionRequestInvocation` marks a bridge call; it does not prove that an iOS consent sheet became visible. Authorization API duration can include a consent wait but is not an OS-sheet visibility duration. Record visible-sheet start/end separately when observing the `live` probe.

`UnifiedImportRun.cancel()` waits for an active provider API call to return, then stops before the next query or feature. It cannot dismiss an active iOS consent sheet or interrupt an in-flight provider query or feature import. Identical selections across the same providers share one run, while different selections are queued so consent prompts and anchored writes do not race. A completed or failed run can be explicitly retried.

### HealthKit import Simulator probe

Run the deterministic synthetic path from `apps/mobile` on a dedicated, task-assigned iOS Simulator:

```sh
export OROT_UNIFIED_IMPORT_SIMULATOR_UDID="ASSIGNED_SIMULATOR_UDID"
export OROT_UNIFIED_IMPORT_DERIVED_DATA_PATH=ios/build-unified-import-probe
pnpm exec detox build --config-path ./e2e/unified-import-probe.detox.config.js --configuration ios.sim.debug.unified-import-probe
pnpm exec detox test --config-path ./e2e/unified-import-probe.detox.config.js --configuration ios.sim.debug.unified-import-probe --headless --no-start --cleanup
```

The automated run selects all six HealthKit features and EventKit, uses the synthetic HealthKit adapter and a synthetic calendar candidate, and writes only synthetic health observations plus the one explicitly confirmed synthetic appointment into the simulator's encrypted local store. It checks the one-batch HealthKit request, both-provider authorization-before-query ordering, per-feature outcomes, candidate confirmation, and privacy-safe relative offsets and durations. It does not trigger or observe OS consent sheets or use personal HealthKit or Calendar data. The Detox setup uninstalls the app and clears the simulator keychain; use only the assigned Simulator.

To inspect the production HealthKit bridge interactively, run the same Detox test with `OROT_UNIFIED_IMPORT_PROBE_MODE=live` and without `--headless` on the assigned Simulator. It selects heart rate and steps, then waits for the HealthKit request and terminal import state. This mode does not prepare a HealthKit fixture, alter permissions, or reset device settings; an already-decided permission may suppress a system sheet. Observe and time the actual system sheet separately from the bridge measurements shown by the screen. Simulator evidence does not establish behavior on the user's physical iPhone; no real-device timing should be inferred from the synthetic Detox run.

The dedicated Jest config gives the synthetic case five minutes to cover its 240-second terminal-state wait and setup/assertion margin, and the live case eleven minutes to cover its 600-second consent wait and margin. Detox's four-minute `setupTimeout` applies only while setting up the suite; it does not extend a running Jest test. These are test deadlines, not observed consent durations.

```sh
OROT_UNIFIED_IMPORT_PROBE_MODE=live pnpm exec detox test --config-path ./e2e/unified-import-probe.detox.config.js --configuration ios.sim.debug.unified-import-probe --no-start --cleanup
```

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
