# Native daily reminder observation procedure

This is a preparation for a later allocated run, not an execution result. The
run must use one integrated revision after the loading-state work, including the
registered daily reminder tests and the parent's verified common test product.
The test in `DailyReminderDeliveryUITests` observes a system banner and a tap;
it does not count model calls or transfers. The test product uses synthetic
Apple model responses and cannot establish actual Apple Intelligence inference.

## Preflight and scheduling

1. The parent checks active owners and host load, allocates a disposable
   Simulator and database, and records the owner file, UDID, runtime, build
   product provenance, exact revision and clean source state. Use no personal
   records or real provider credentials. Verify the owner with
   `node scripts/ci/ios-test-simulator.mjs verify core <owner-file>` before
   each device-changing operation. Do not use another owner's device.
2. Ensure the common product actually includes
   `OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner`.
   The source in this branch alone does not register it. Complete the repository
   UI host preparation and preserve its separate result before the journey.
3. Start with a disposable installation. The UI test uses the existing native
   navigation helper to open the normal app Settings screen, selects a time
   three minutes ahead in its Korean picker, saves, and explicitly allows the
   real system notification prompt if it appears. It checks the saved status
   against the chosen local hour and minute. The picker must expose distinct
   Korean period, hour, and minute wheels; an unknown accessibility structure
   fails instead of selecting guessed controls. The test does not change the OS
   clock, inject a notification, or substitute a fixture for delivery.
4. Record the device timezone, chosen time, settings status, and actual prompt
   or already-authorized state. Each invocation schedules a new near-future
   time, so it does not rely on a previously prepared preference surviving a
   runner reinstall. The separate `DailyReminderSystemCenterTests` uses an
   isolated preference suite and removes its own request; run it after granting
   permission, not as a substitute for this UI journey.

## Warm and cold observations

Use a distinct result bundle for each mode; each invocation schedules its own
future reminder. With the parent-supplied product and owner paths, the existing
runner accepts an explicit case selection. For example, after setting the
shell variables `RUN_FILE`, `OWNER_FILE` and `RESULT_BUNDLE` to the verified
paths, the warm run is:

```sh
TEST_RUNNER_OROT_DAILY_REMINDER_DELIVERY_TEST=YES \
TEST_RUNNER_OROT_DAILY_REMINDER_DELIVERY_MODE=warm \
node scripts/ci/run-ios-tests.mjs core "$RUN_FILE" "$OWNER_FILE" "$RESULT_BUNDLE" \
  OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner
```

For cold, use a new result path and set the mode to `cold`. Confirm in the test
runner that these opt-in values arrived;
a skipped test is not a pass. The test backgrounds the running app in warm mode
and terminates it in cold mode, waits for the real SpringBoard banner, taps it,
and checks the report preparation screen. Preserve its scheduled-state,
banner, and preparation screenshots and accessibility attachments. A visible
banner or scheduled status alone is not proof of a successful tap and route.

After the runner finishes, use a new `RESULT_JSON` path and the same selected
identifier to verify the exact first execution:

```sh
node scripts/ci/ios-test-results.mjs core "$RESULT_BUNDLE" "$RESULT_JSON" \
  OrotUITests/DailyReminderDeliveryUITests/testScheduledDailyReminderOpensPreparationFromSystemBanner
```

Preserve the raw xcresult,
runner log, lifecycle diagnostics, selected identifier, mode, source SHA,
product and environment. Record permission refusal, missing delivery, missing
or non-hittable banner, interrupted waiting, failed navigation, skip, or a
runner reset as the observed failure or unverified state. Do not increase
timeouts, add sleeps, or silently retry. The operating system does not promise
delivery at the chosen minute; expiry of the intended observation is not a
pass. After preserving evidence, the owner cleans up only its allocated
Simulator and confirms its UDID is absent according to `TEST.md`.

## Model and transfer observation remains separate

Neither prepared XCTest exposes a complete counter for model calls or
health-data transmission. A near-future scheduling pass, an empty provider
selection, an unavailable model, no visible output, or a zero in one mock cannot
prove either count is zero. Until an integrated test-only observer covers and
reports the actual boundaries, mark both observations unverified.

The integration owner should bind a run ID and phase to privacy-safe counters
at the Apple model bridge, the selected remote model bridge and each applicable
health-data transfer path. Capture counts before and after settings, delivery,
tap and report opening, without recording payloads or health text. Include
attempts that fail or are cancelled, and distinguish model invocation from
network transmission. Observe from process startup through each phase; cold
launch needs a cross-process receipt that cannot be reset before readback.
Independently verify counter coverage and exercise a synthetic positive control
so a disconnected observer cannot report a false zero. Apple Simulator mock
observations are synthetic and must not be reported as real model inference.

An explicit request to generate from conversation is a different action from
merely entering conversation or opening a saved report. Test reuse and any
explicit generation separately with the same saved artifact; do not impose the
zero-call assertion on an authorized generation. Preserve the existing
encrypted report persistence tests owned by the report presentation work.
