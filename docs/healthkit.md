# HealthKit boundary

> Current XCTest/XCUITest commands are in [development.md](development.md); the [requirement map](ios-validation.md) links the original scenarios to their maintained tests.

## Change contract

- **Requested behavior:** Report whether HealthKit is available, request read access for one named Orot feature or an explicit selected feature batch only when its caller asks, expose a reusable native query boundary, and locally import medication, blood-pressure, sleep, and supported quantity observations through their owning feature flows. Never request write access or claim that a read request was granted or denied.
- **Preserved behavior:** Other Orot features remain usable when HealthKit is unavailable, a request cannot be completed, or a query returns no visible samples. Import callers retain source identifiers, available device metadata, and sample timestamps.
- **Non-goals:** Write HealthKit data; add a backend; infer a healthy/normal value from an empty result; merge overlapping sleep samples; or calculate a winning sleep stage or total sleep duration.
- **Material risks:** HealthKit intentionally hides whether read permission was denied. An empty query means no samples are visible to this app for that query and cannot establish whether data is absent from HealthKit. Medication HealthKit APIs require iOS 26 or later. Blood-pressure values use the supported HealthKit query unit in mmHg. Preserve an original amount/unit pair only when a source explicitly supplies an authoritative pair; otherwise store the typed unavailable state and do not infer it from preferred display units or converted values. The iOS 27 Simulator throws when a blood-pressure correlation type is included in the read-authorization set; the boundary excludes it from that set while retaining correlation query selection. Real-device authorization behavior and sample visibility remain unverified. Simulator HealthKit availability is separate from synthetic adapter behavior.
- **Evidence needed:** Requirement-linked TypeScript tests; a native bridge probe using only synthetic fixtures; an actual iOS Simulator availability readback with unsupported capabilities reported honestly; the repository's required checks on the final head; and an independent strict review.

## Authorization model

The public API accepts feature keys, not arbitrary HealthKit types. The native allowlist maps each key to only the types needed by that feature. A batch unions the selected ordinary read types into one `requestAuthorization` call, then requests per-object medication access separately. A medication-only selection skips ordinary authorization. Requests have an empty write set and never call `authorizationStatus(for:)`, which reports sharing authorization rather than read authorization.

The authorization request reports `completed` only when HealthKit reports success with no error. A failed request remains an error; it is not labeled as a user cancellation. Request completion still does not establish whether read access was granted, so read authorization is always reported as `notObservable`.

Medication consent uses `requestPerObjectReadAuthorization` with the user-annotated medication type. Access to a selected medication includes its dose events; neither medication type is passed to ordinary sample authorization. That API mismatch caused the observed physical-device authorization exception. The per-object API presents a picker on every request, so only explicit Settings consent calls it; launch and foreground synchronization query previously selected features without prompting again. Request sequencing and native type selection have regression coverage, while repaired physical-device consent and repeated-launch behavior still require observation.

Other features request the systolic and diastolic component types for blood pressure, the sleep-analysis category for sleep, and one quantity type for heart rate, steps, or body mass. The blood-pressure query still selects the correlation type, but its visibility is not established by the Simulator authorization test.

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

## Simulator integration and UI checks

The Debug `provider-data` profile runs `HealthIntegrationTests`. Its Simulator-only adapter reports the real `HKHealthStore.isHealthDataAvailable()` result separately, checks each feature's selected sample type and read plan, and supplies synthetic authorization-completion, sample, empty-query and medication-definition responses. It requests no real HealthKit access, writes no HealthKit samples and does not prove that personal samples are readable. The adapter is absent from Release and device builds.

The `health-import` profile uses `HealthImportUITests` and `UnifiedImportUITests` for visible import, encrypted local writes, cursor replay, explicit Calendar confirmation and cancellation. The common-observation case verifies that the batch plan equals the union of supported selected plans for all six HealthKit features. Its summary contains only aggregate counts and durations. A synthetic `authorization_ms` value measures a bridge round trip, not an OS sheet or the user's iPhone delay.

Build and execution commands, including the fresh app and Keychain boundary before each fixture, are in [development.md](development.md). The remaining probe entries and Metro configurations support diagnostic inspection; they are also inputs to the shared test entry, so they are retained after the old runner's removal.

### Blood-pressure persistence

`HealthImportUITests/testSyntheticBloodPressurePersistsAndReplaysAfterProcessRestart` starts with an isolated app, imports a synthetic correlation through the blood-pressure screen and relaunches the app. It compares the stored components, exact timestamps, sources, unavailable original-pair display and fixture cursor, then replays the fixture with zero new writes or cursor advancement and two stored observations. The cursor is compared with a known fixture value; no raw HealthKit anchor is exposed.

The earlier Detox attempt 20 on iOS 27 remains historical process-restart evidence, separate from the maintained XCUITest result. The synthetic path reports `productionQuery=notRun` and `productionSamples=unverified`, with no personal values or HealthKit writes. Canonical pressure values remain in mmHg; preserve an original pair only when the source supplies an authoritative pair, and otherwise retain the unavailable state.

### Sleep normalization

`HealthIntegrationTests/testSyntheticSleepNormalizationAndAnchorResume` uses synthetic category, interval and source fields and checks normalized additions and cursor resumption. Its `source=synthetic` and `realSamples=unverified` fields remain explicit. Importer unit tests separately cover atomic page writes, retry, raw upsert, deletion and retention of overlapping samples with distinct IDs. These checks do not establish access to real sleep samples or physical-device behavior.

## Selected HealthKit and EventKit import

Production integration controls now live in Settings. HealthKit selections persist for automatic synchronization, and imported records are available from the Records tab. The separate manual health and blood-pressure import routes are removed. Calendar synchronization runs independently of explicit AI classification; its permission and recovery controls also live in Settings.

The retained combined-import coordinator and its diagnostic harness are described below. They are not a production manual-import screen.

`HealthKitImportScreen` accepts selected HealthKit types and an optional EventKit provider selection in one explicit action. The coordinator requests the selected HealthKit types in one HealthKit batch and requests EventKit access through its separate consent API. It waits for every selected provider request to return before querying either provider. HealthKit and EventKit access states and outcomes remain independent; failure or empty results from one provider do not hide the other provider's results. HealthKit read access remains `notObservable`; the request callback is not a grant result, and an empty query remains an empty visible result.

An EventKit query lists only upcoming candidates in the existing `[now, now + 1 year)` window, capped at 100. The user must select one candidate and explicitly confirm before it is linked to an appointment; candidate lookup alone does not import or save calendar events. Confirmation updates an active appointment for the same event occurrence or creates one, and is measured as local persistence.

Each run emits provider, phase, transition, monotonic offset from the app action, phase duration, and a finite outcome. The measurements contain no wall-clock timestamps, health values, event titles, source identifiers, or raw errors. `permissionRequestInvocation` marks a bridge call; it does not prove that an iOS consent sheet became visible. Authorization API duration can include a consent wait but is not an OS-sheet visibility duration. Record visible-sheet start/end separately when observing the `live` probe.

`UnifiedImportRun.cancel()` waits for an active provider API call to return, then stops before the next query or feature. It cannot dismiss an active iOS consent sheet or interrupt an in-flight provider query or feature import. Identical selections across the same providers share one run, while different selections are queued so consent prompts and anchored writes do not race. A completed or failed run can be explicitly retried.

### Selected HealthKit and EventKit Simulator checks

`UnifiedImportUITests/testSyntheticConsentMeasurementsAndExplicitCalendarConfirmation` runs in the `health-import` profile. It selects all six HealthKit features and EventKit, supplies synthetic HealthKit and Calendar records, and writes only synthetic observations plus the explicitly confirmed appointment into the Simulator's encrypted store. It checks the one-batch request, per-feature outcomes, confirmation and privacy-safe relative-offset/duration fields. The companion cancellation test stops before querying or persisting data and retains the explicit same-selection retry. A coordinator unit test verifies authorization/query ordering.

These synthetic checks do not trigger or observe OS consent sheets. The retained `unifiedImportProbeEntry.tsx` also has an explicit live diagnostic mode for inspecting the production bridges; it is not part of the automated acceptance suite. A manual observation must use a task-owned Simulator without personal calendar data, must not confirm returned events or reset permission settings, and must avoid capturing values, logs, screenshots or video containing personal information. Existing permission decisions may suppress sheets. Record actual visible-sheet intervals separately from the probe's aggregate measurements and `systemSheets=not-captured` result. Simulator results do not establish physical-iPhone timings.

## Apple API references

- [Authorizing access to health data](https://developer.apple.com/documentation/HealthKit/authorizing-access-to-health-data)
- [Protecting user privacy](https://developer.apple.com/documentation/HealthKit/protecting-user-privacy)
- [HKHealthStore.requestAuthorization(toShare:read:completion:)](<https://developer.apple.com/documentation/healthkit/hkhealthstore/requestauthorization(toshare:read:completion:)>)
- [Medication authorization and dose access](https://developer.apple.com/videos/play/wwdc2025/321/)
- [HKSampleQuery](https://developer.apple.com/documentation/healthkit/hksamplequery)
- [HKAnchoredObjectQuery](https://developer.apple.com/documentation/healthkit/hkanchoredobjectquery)
- [HKDeletedObject](https://developer.apple.com/documentation/healthkit/hkdeletedobject)
- [HKCategoryValueSleepAnalysis](https://developer.apple.com/documentation/healthkit/hkcategoryvaluesleepanalysis)
- [HKUserAnnotatedMedicationQueryDescriptor](https://developer.apple.com/documentation/healthkit/hkuserannotatedmedicationquerydescriptor)

The installed Xcode simulator SDK is 27.0. Its HealthKit declarations mark user-annotated medication and medication-dose-event types as available from iOS 26. The Swift sources, HealthKit framework, read-purpose string and HealthKit entitlements are registered in the app target. iPhone builds use the minimal HealthKit entitlement; Simulator builds retain the synthetic team, application and keychain identifiers required by the local probe.

On 2026-10-05, the Debug app built and ran on the iPhone Air iOS 27.0 Simulator, and the dedicated Detox probe passed 1/1. The observed HealthKit availability was `available`; the `medications=supported` result and all record/query outcomes came from the test-only adapter. The probe confirmed `writeTypes=0`, feature-scoped type selection, `readAuthorization=notObservable`, and `realSamples=unverified`. This does not establish a user's read grant or real HealthKit sample access. Device signing and provisioning have not been validated with a real account.
