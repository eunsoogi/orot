# Testing Policy

## Authority and implementation

This document is the durable source for choosing tests, judging evidence, and
managing local Simulator use. It defines policy, not executable procedures or
run history.

- [Development](docs/development.md) owns the development environment and
  executable build, test, and cleanup procedures.
- [Code quality](docs/code-quality.md) owns quality-check scope and tools.
- [iOS validation coverage](docs/ios-validation.md) preserves requirement
  mappings and revision-scoped coverage evidence.
- [Release verification](docs/releasing.md) owns release acceptance.
- The current runners and exact inventories are implemented in the
  [CI workflows](.github/workflows), [test inventory](scripts/ci/ios-test-inventory.mjs),
  [cohort definitions](scripts/ci/ios-test-cohorts.mjs), and
  [execution plan](scripts/ci/ios-test-execution-plan.mjs).

Contributors MUST follow this policy. A registered test, selected case, green
summary, or historical run is not by itself proof that the required behavior
was executed and passed.

## Choose evidence from the requirement

Behavior changes MUST add or update requirement-linked tests and run the
applicable checks for the changed boundary. Unit, component, and integration
checks are the default when they can faithfully observe the required outcome.
Select the smallest level that can distinguish the expected behavior from the
failure that matters.

- Use unit tests for deterministic JavaScript or TypeScript decisions, parsing,
  state transitions, and other logic that does not require a platform runtime.
- Use component or service integration tests for rendered component contracts,
  callback wiring, and application workflows that those surfaces can observe.
- Use a real database when its transaction, query, or persistence behavior is
  part of the requirement. A mock does not prove a required database outcome.
- Use host-side Swift or adapter tests for behavior that can be observed without
  UIKit or an operating-system service.
- Use XCTest or XCUITest when the acceptance criterion depends on actual UIKit
  geometry or hit targets, native bridge behavior, the operating-system
  keyboard, focus or accessibility, native permission or consent surfaces,
  entitlements, or an operating-system lifecycle boundary, such as protected
  Keychain state across an actual app restart or restore.
- Use a physical device only when the criterion depends on hardware or
  device-specific behavior that a Simulator cannot show.
- Evaluate model quality with the intended model and quality evidence. A mock
  can prove only the explicitly mocked boundary; it MUST NOT be reported as
  actual model execution.

Tests MUST assert observable outcomes, including relevant failure and
cancellation results, ordering, time and time-zone semantics, and preservation
of data. Prefer requirement-linked assertions over trivial getters,
implementation copies, or oversized snapshots. Synthetic data and mocked
services MUST be identified where they limit the claim; they MUST NOT stand in
for real user data, operating-system behavior, or a required external service.

Do not multiply every business state across every appearance, device, and
layout. Add a combination only when it observes a distinct requirement or
failure boundary.

## Preserve coverage when changing tests

Before removing or combining an assertion, map each original assertion to its
replacement, the requirement it protects, the independent source of its
expected result, and the distinct regression that must still fail. A proposed
replacement MUST detect the original faulty behavior before the old assertion
is removed. Otherwise keep the existing assertion and report the smallest
uncovered change.

Preserve native assertions and their surface. A source registration, mocked
component, screenshot, or displayed state MUST NOT replace a required native
result, real hit test, or system interaction. Focused checks prove only their
selected cases.

## Keep execution boundaries distinct

Local development checks, required pull-request checks, selected native
evidence, scheduled Full validation, release acceptance, and physical-device
validation answer different questions. A result from one boundary MUST NOT be
presented as proof for another. The current event triggers, selected checks,
case identifiers, and release gates are defined by the linked workflows,
scripts, and release documentation; verify those sources when describing a
current execution path.

Required CI and release gates remain in force whether or not a local Simulator
run is needed. A skipped or unselected check is not a pass, and a green summary
does not prove that a specific case ran. Confirm the selected identifiers,
execution result, and applicable artifacts at the surface that performed the
work.

The opt-in candidate focused route is described in [development](docs/development.md).
It fails before native allocation when its selection cannot cover the maintained
changed-path impact. Its selected results do not replace Full or release evidence.

## Record evidence and reuse it carefully

For each result used as evidence, record its source revision, environment,
command or workflow run and attempt, inputs, expected and observed outcome,
execution state, and required artifacts and cleanup. Keep the original result
separate from the assessment of whether it applies to the current source.

A passing result MAY be reused only when its relevant source, dependencies,
fixtures, configuration, and environment are unchanged. A relevant change,
prior failure, unresolved risk, or uncertain effect invalidates the affected
proof and requires proportionate revalidation. Unknown impact MUST expand the
check set rather than silently narrowing it.

Do not arbitrarily narrow the required check scope or skip failures. When an
exclusion is necessary, use an approved path restriction and state which files
were omitted.

Preserve the first failure and its diagnostic evidence. Each failure or
evidence gap MUST identify its producing boundary, responsible owner, and next
action. The owner of the changed boundary MUST own its repair. Record
cancellation, failure, unavailable evidence, selected-out work, skipped work,
and work that never started as such. Do not turn those states into success,
suppress an applicable failure, or claim incomplete integration or release
validation has passed. Do not rerun a passing full suite, rebuild an unchanged
product, or add a parallel native journey solely to duplicate meaningful
coverage.

## Preflight and own local Simulator work

Unit, component, and integration checks MUST be preferred whenever they can
faithfully prove the issue-level behavior. Before creating or booting a local
Simulator, building a native test product, or running a native runtime test,
identify the exact unmet acceptance criterion or observed defect. Explain why
proportionate unit, component, integration, static, type, build-only, and
applicable existing runtime evidence cannot prove it, then select the smallest
native observation or test that can. A native compile requirement alone MUST
NOT justify booting a Simulator. An iOS app, UI-related filename, issue
template, or newly added native test alone MUST NOT trigger local Simulator
work.

In orchestrated work, the parent MUST check active owners and host load, then
allocate Simulator devices and heavy native execution. A worker MUST NOT
independently create or boot a device or start heavy native work without that
allocation. On an interactive developer Mac, use one booted device and one
heavy native operation at a time by default; the parent MAY adjust this based
on observed capacity. These local limits MUST NOT change hosted CI scheduling.

Before shutting down or deleting a task-created Simulator, verify its exact
UDID, ownership, and active use. Preserve required results, screenshots, logs,
and build provenance outside the device first. Do not stop or delete a device
still used or reserved by another active task. A transfer MUST name a new
active owner; possible future reuse is not a transfer. At task completion, an
owner MUST shut down and delete task-created devices after preservation unless
ownership was explicitly transferred. Read the Simulator inventory afterward
and confirm each deleted UDID is absent. For child work, the parent MUST perform
or verify this cleanup when accepting the child result.

Use [Development](docs/development.md) for executable Simulator preparation,
run, shutdown, deletion, and inventory commands.

## Separate file-protection security integration

The user-approved E2E scope separates environment-dependent protected-document
store assertions from hosted application E2E. Hosted core retains seven pure
extraction/coordinated-read cases and four picker-completion cases; document
import, saved-original, duplicate and picker recovery user journeys remain.
The original 20 native document methods remain executable separately through
`medical-document-security-validation.mjs` (see Development). No product
protection assertion is removed or relaxed. An explicit false capability on the
actual test directory volume permits an explained XCTest skip. Unknown/error
capability fails, and supported volumes must satisfy the original assertions.
A skipped security case is not a security pass. Hosted Full completeness attests
only its maintained E2E scope, not these separately recorded security results.
Required PR checks and branch protection are unchanged. Security acceptance and
physical-device locked-state evidence must be reported separately.
