# Detox CI performance

## Hosted baseline

The comparable baseline is the successful `main` run [37168559096, attempt 2](https://github.com/eunsoogi/orot/actions/runs/37168559096/attempts/2), at `b128021a3330c1f2d432c218ba70f13c86c273e9`. It includes the checkpoint probe added by PR #72. All three required jobs passed. Attempt 1 of the same run failed in the old multi-build workflow during a later CocoaPods install with `ArgumentError - path name contains null byte`; attempt 2 passed. This change reduces the install to one and does not claim to have fixed that error's root cause.

| Hosted measure | Baseline | Candidate |
| --- | ---: | ---: |
| Detox build step | 17m03s | Pending hosted run |
| Detox E2E test step | 15m00s | Pending hosted run |
| Complete Detox job | 33m32s | Pending hosted run |
| Native app builds | 4 Release + 1 Debug | 1 Release + 1 Debug |
| CocoaPods installs | 3 | 1 |
| Detox/Jest invocations | 5 | 2 |
| Workload | 9 tests across 7 suites | 9 tests across 7 suites |

The baseline build log records one shared app build, agent-memory, graph, checkpoint, and OpenAI Debug builds. Its E2E log records the same nine test cases listed below across five Detox invocations. The candidate combines the six Release suites into one app and one invocation, while retaining the OpenAI Debug app and its separate invocation. Hosted candidate timings, cache state, and exact-head required checks will be added after the pull-request run completes.

The baseline Detox job used the `xcode-27-arm64` image, release `20260928.0222.1`, macOS 27.0, Xcode 27.0, and iOS Simulator SDK 27.0. The verified toolchain was Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, CocoaPods 1.17.0, and applesimutils 0.9.12. The pnpm cache was restored. The workflow does not configure a DerivedData cache; the baseline built Detox framework and downloaded the React Native Debug and Release dependency archives on the runner.

## Local candidate evidence

The post-checkpoint local candidate used the same six Release suites and OpenAI Debug suite: 9/9 tests passed across 7 suites in 2 Detox/Jest runs, with no skipped or pending tests. On Xcode 27.0 build 27A266a, iOS SDK 27.0, Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, CocoaPods 1.17.0, and applesimutils 0.9.12, the candidate build took 418.74s real (1371.81s user, 244.71s system), and the E2E step took 213.60s real (18.50s user, 17.15s system). It used one Pods install and the same prebooted, task-created iPhone 18 Pro Simulator for both configurations. Teardown succeeded and the exact device was absent afterward.

These are local measurements, not hosted CI timings. The earlier local baseline at `98a980f` covered only 8 tests across 6 suites and omitted the checkpoint probe, so it is not a valid comparison for this candidate. No local or remote speedup is claimed from those runs. The local candidate's post-build DerivedData directories were 1,348,916 KiB (Release) and 1,734,840 KiB (OpenAI Debug); these are directory sizes after the build, not peak disk use.

## Preserved E2E scenarios and oracles

| Configuration | Scenario | Oracle |
| --- | --- | --- |
| Release | App smoke | Launches in English and still renders the Korean welcome screen. |
| Release | Appointments | Creates, edits, and cancels an appointment that survives process restarts. |
| Release | Encrypted storage: fresh install | Creates encrypted source and evidence records on a fresh install. |
| Release | Encrypted storage: restart | Reopens a source and evidence span after an app process restart. |
| Release | Encrypted storage: migration | Migrates the earlier test schema on a fresh install. |
| Release | Agent memory | Persists, corrects, recalls, and removes Korean memory with its source across an app restart. |
| Release | LangGraph | Invokes and consumes a stateful two-node graph 20 consecutive times. |
| Release | Checkpoint resume | Saves after `increment`, restarts the app, resumes without rerunning the completed node, and checks the result `value=8; nodes=increment,double` plus Unicode checkpoint metadata `환자 기록: café 🌱🩺`. |
| Debug | OpenAI provider synthetic probe | Checks visible-model-only catalog, completion, usage-limit, and cancellation behavior; asserts the real account remains unverified and no synthetic access token is exposed. |

The Release router selects the existing storage, agent-memory, graph, or checkpoint entry from explicit launch settings. Its Jest configuration enumerates all six Release test files. The OpenAI synthetic fixture remains in its separate Debug-only app. No probe semantics or assertions were changed.

## CI changes and verification

The Detox job prepares one dedicated iOS 27 iPhone 18 Pro Simulator before dependency installation, persists its UDID before boot, and passes that exact ID to both configurations. Each `simctl` operation and each lifecycle workflow step has a bound. Cleanup targets only the recorded device, attempts deletion after shutdown errors, and preserves logs. Summary validation requires both the configured six-suite Release run and one-suite OpenAI Debug run, and rejects missing, failed, skipped, pending, or todo tests.

The production app build and standalone OAuth package/Simulator harness checks remain in the separate `iOS Simulator Build` job. Real-account OAuth remains unverified. Peak RSS, CPU time by child process, child-process count, fixture bytes, peak disk usage, and remote DerivedData size remain unmeasured.

Local portable validation passed 45/45 tests, along with lint, typecheck, unit/component tests, the 250-line audit, shell and Node syntax checks, workflow YAML parsing, and `git diff --check`. Hosted required checks on the candidate head are pending. This document will be updated with the hosted candidate run's exact SHA, runner/toolchain/cache state, build/test/job timings, and final check results before handoff.
