# HealthKit boundary

## Change contract

- **Requested behavior:** Report whether HealthKit is available, request read access for one named Orot feature only when its caller explicitly asks, and expose a reusable native query boundary. Never request write access or claim that a read request was granted or denied.
- **Preserved behavior:** Other Orot features remain usable when HealthKit is unavailable, a request cannot be completed, or a query returns no visible samples. Import callers retain source identifiers and timestamps from query results.
- **Non-goals:** Import or synchronize medication, blood-pressure, sleep, heart-rate, step-count, or body-mass records; map them to Orot domain records; write HealthKit data; add a backend; or infer a healthy/normal value from an empty result.
- **Material risks:** HealthKit intentionally hides whether read permission was denied. An empty query can mean no samples are visible to this app and cannot establish whether data is absent. Medication HealthKit APIs require iOS 26 or later. Simulator HealthKit availability is a separate runtime fact from the synthetic test adapter.
- **Evidence needed:** Requirement-linked TypeScript tests; a native bridge probe using only synthetic fixtures; an actual iOS Simulator availability readback with unsupported capabilities reported honestly; the repository's required checks on the final head; and an independent strict review.

## Authorization model

The public API accepts a feature key, not an arbitrary list of HealthKit types. The native allowlist maps each key to only the types needed by that feature. It passes an empty write set to `requestAuthorization` and never calls `authorizationStatus(for:)`, which reports sharing authorization rather than read authorization.

The authorization request reports `completed` only when HealthKit reports success with no error. A failed request remains an error; it is not labeled as a user cancellation. Request completion still does not establish whether read access was granted, so read authorization is always reported as `notObservable`.

The native allowlist requests the medication definition and dose-event types for medications; the blood-pressure correlation and its systolic and diastolic component types for blood pressure; the sleep-analysis category for sleep; and one quantity type for heart rate, steps, or body mass. The authorization plan used by the request has an empty write set.

## Query model

Queries require a feature, a sample kind belonging to that feature, a bounded date interval, and a finite result limit. Results describe only the samples visible to the app. An empty result is not labeled as denied, as proof that no health data exists, or as a normal/healthy value. Query code does not persist data or map it into Orot records.

Medication concept identifiers are exposed as opaque Base64 secure-coded HealthKit identifiers because HealthKit does not publish a raw string identifier. Consumers must not parse them or treat them as clinical codes. This boundary does not promise that their serialized representation stays stable across operating-system releases.

## Simulator probe

The dedicated probe can be built and run with `pnpm exec detox test --config-path e2e/healthkit-probe.detox.config.js --configuration ios.sim.debug.healthkit-probe` from `apps/mobile`. Its debug-only adapter reports the real `HKHealthStore.isHealthDataAvailable()` result separately, checks every feature's selected native sample type and read plan, and supplies synthetic authorization-completion, sample, empty-query, and medication-definition responses. It does not request real HealthKit access, save HealthKit samples, or prove that real samples are readable. The adapter is compiled only for Debug Simulator builds and is absent from Release and device builds.

The iOS Simulator cannot establish real device data availability, a user's read grant, or the contents of the user's HealthKit store. The probe logs real HealthKit availability and labels all record responses as synthetic; it does not claim physical-device or real-sample verification.

## Apple API references

- [Authorizing access to health data](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)
- [Protecting user privacy](https://developer.apple.com/documentation/HealthKit/protecting-user-privacy)
- [HKHealthStore.requestAuthorization(toShare:read:completion:)](https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization(toshare:read:completion:))
- [HKSampleQuery](https://developer.apple.com/documentation/healthkit/hksamplequery)
- [HKUserAnnotatedMedicationQueryDescriptor](https://developer.apple.com/documentation/healthkit/hkuserannotatedmedicationquerydescriptor)

The installed Xcode simulator SDK is 27.0. Its HealthKit declarations mark user-annotated medication and medication-dose-event types as available from iOS 26. The Swift sources, HealthKit framework, read-purpose string and Simulator entitlement are registered in the app target. The project currently applies that entitlement only to Simulator builds; it has no iPhone-device HealthKit entitlement. Apple requires the HealthKit capability and entitlement for an app target to access HealthKit, so device access remains incomplete until its signing configuration is added. Native compilation and Simulator execution have not yet been completed.
