# HealthKit boundary

## Change contract

- **Requested behavior:** Report whether HealthKit is available, request read access for one named Orot feature only when its caller explicitly asks, and expose a reusable native query boundary. Medication and blood-pressure importers use anchored changes only when called by their owning feature flow. Never request write access or claim that a read request was granted or denied.
- **Preserved behavior:** Other Orot features remain usable when HealthKit is unavailable, a request cannot be completed, or a query returns no visible samples. Import callers retain source identifiers and sample timestamps from query results.
- **Non-goals:** Import or synchronize sleep, heart-rate, step-count, or body-mass records; write HealthKit data; add a backend; or infer a healthy/normal value from an empty result.
- **Material risks:** HealthKit intentionally hides whether read permission was denied. An empty query can mean no samples are visible to this app and cannot establish whether data is absent. Medication HealthKit APIs require iOS 26 or later. HealthKit normalizes pressure quantities to the Orot query unit and does not expose each entry's original display value/unit; imported observations retain mmHg values and record the source representation as unavailable. The iOS 27 Simulator throws when a blood-pressure correlation type is included in the read-authorization set; the boundary excludes it from that set while retaining correlation query selection. Real-device authorization behavior and correlation sample visibility remain unverified. Simulator HealthKit availability is a separate runtime fact from the synthetic test adapter.
- **Evidence needed:** Requirement-linked TypeScript tests; a native bridge probe using only synthetic fixtures; an actual iOS Simulator availability readback with unsupported capabilities reported honestly; the repository's required checks on the final head; and an independent strict review.

## Authorization model

The public API accepts a feature key, not an arbitrary list of HealthKit types. The native allowlist maps each key to only the types needed by that feature. It passes an empty write set to `requestAuthorization` and never calls `authorizationStatus(for:)`, which reports sharing authorization rather than read authorization.

The authorization request reports `completed` only when HealthKit reports success with no error. A failed request remains an error; it is not labeled as a user cancellation. Request completion still does not establish whether read access was granted, so read authorization is always reported as `notObservable`.

The native allowlist requests the medication definition and dose-event types for medications; the systolic and diastolic component types for blood pressure; the sleep-analysis category for sleep; and one quantity type for heart rate, steps, or body mass. The authorization plan used by the request has an empty write set. The blood-pressure query still selects the correlation type, but its visibility is not established by the Simulator authorization test.

## Query model

Queries require a feature, a sample kind belonging to that feature, a bounded date interval, and a finite result limit. Results describe only the samples visible to the app. An empty result is not labeled as denied, as proof that no health data exists, or as a normal/healthy value. The native query methods do not persist data or map it into Orot records; feature importers own those operations.

Medication concept identifiers are exposed as opaque Base64 secure-coded HealthKit identifiers because HealthKit does not publish a raw string identifier. Consumers must not parse them or treat them as clinical codes. This boundary does not promise that their serialized representation stays stable across operating-system releases.

## Blood-pressure import

`syncHealthKitBloodPressure` requests anchored pages for blood-pressure correlations and commits each page's observations, explicit correlation deletions, and cursor through one `RecordRepository.transaction`. The checkpoint key is `healthkit:bloodPressure:bloodPressure`; the next page is queried only after the prior page transaction succeeds. Replays use correlation-based observation IDs and preserve the first ingestion time. A deletion removes both component observations. If an updated correlation omits a component, its stale row is deleted and no replacement or normal value is invented.

Each observed component becomes a separate `HealthObservation` with its exact HealthKit start/end timestamp strings, source/device provenance, and an unreviewed state. HealthKit's shared snapshot reports the value in a canonical query unit; blood pressure is stored in mmHg. The source's original display unit is not available through HealthKit, so `value.sourceRepresentation` explicitly records that limitation rather than relabeling the normalized value as original. The query boundary does not expose a source creation timestamp, so imported records omit `recordedAt` instead of filling it with local ingestion time.

The importer reports `readAuthorization=notObservable` through the query result contract. Callers remain responsible for requesting feature-scoped authorization before import. The importer does not write HealthKit data.

## Simulator probe

The dedicated probe can be built and run with `pnpm exec detox test --config-path e2e/healthkit-probe.detox.config.js --configuration ios.sim.debug.healthkit-probe` from `apps/mobile`. Its debug-only adapter reports the real `HKHealthStore.isHealthDataAvailable()` result separately, checks every feature's selected native sample type and read plan, and supplies synthetic authorization-completion, sample, empty-query, and medication-definition responses. It does not request real HealthKit access, save HealthKit samples, or prove that real samples are readable. The adapter is compiled only for Debug Simulator builds and is absent from Release and device builds.

The iOS Simulator cannot establish real device data availability, a user's read grant, or the contents of the user's HealthKit store. The probe logs real HealthKit availability and labels all record responses as synthetic; it does not claim physical-device or real-sample verification.

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

This probe runs the production blood-pressure importer against the native synthetic anchored-change fixture and an in-memory repository adapter. It verifies both component values, replay behavior, and `notObservable` authorization while keeping production queries unrun and personal values withheld. It does not establish real HealthKit sample visibility or durable SQLCipher persistence.

## Apple API references

- [Authorizing access to health data](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)
- [Protecting user privacy](https://developer.apple.com/documentation/HealthKit/protecting-user-privacy)
- [HKHealthStore.requestAuthorization(toShare:read:completion:)](<https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization(toshare:read:completion:)>)
- [HKSampleQuery](https://developer.apple.com/documentation/healthkit/hksamplequery)
- [HKUserAnnotatedMedicationQueryDescriptor](https://developer.apple.com/documentation/healthkit/hkuserannotatedmedicationquerydescriptor)

The installed Xcode simulator SDK is 27.0. Its HealthKit declarations mark user-annotated medication and medication-dose-event types as available from iOS 26. The Swift sources, HealthKit framework, read-purpose string and HealthKit entitlements are registered in the app target. iPhone builds use the minimal HealthKit entitlement; Simulator builds retain the synthetic team, application and keychain identifiers required by the local probe.

On 2026-10-05, the Debug app built and ran on the iPhone Air iOS 27.0 Simulator, and the dedicated Detox probe passed 1/1. The observed HealthKit availability was `available`; the `medications=supported` result and all record/query outcomes came from the test-only adapter. The probe confirmed `writeTypes=0`, feature-scoped type selection, `readAuthorization=notObservable`, and `realSamples=unverified`. This does not establish a user's read grant or real HealthKit sample access. Device signing and provisioning have not been validated with a real account.
