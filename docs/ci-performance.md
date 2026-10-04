# Detox CI performance

## Hosted baseline

The comparable baseline is the successful `main` run [37168559096, attempt 2](https://github.com/eunsoogi/orot/actions/runs/37168559096/attempts/2), at `b128021a3330c1f2d432c218ba70f13c86c273e9`. It includes the checkpoint probe added by PR #72. All three required jobs passed. Attempt 1 of the same run failed in the old multi-build workflow during a later CocoaPods install with `ArgumentError - path name contains null byte`; attempt 2 passed. This change reduces the install to one and does not claim to have fixed that error's root cause.

| Hosted measure | Baseline | Candidate |
| --- | ---: | ---: |
| Frozen workspace install | 4s | 3m51s |
| Detox build step | 17m03s | 19m19s |
| Detox E2E test step | 15m00s | 8m34s |
| Complete Detox job | 33m32s | 33m34s |
| Native app builds | 4 Release + 1 Debug | 1 Release + 1 Debug |
| CocoaPods installs | 3 | 1 |
| Detox/Jest invocations | 5 | 2 |
| Workload | 9 tests across 7 suites | 9 tests across 7 suites |

The successful hosted candidate was run 37172401876 at `6e2a34a3fe6670c11500743bab59d7549f6f20d4`. Its three required checks passed. The E2E log records all nine test cases across seven suites in two invocations, and the dedicated Simulator was deleted successfully. Compared with the baseline, the test step is 6m26s shorter, the build step is 2m16s longer, and the complete Detox job is 2s longer. This run therefore does not demonstrate a whole-job speedup.

Both hosted runs used the `xcode-27-arm64` image, release `20260928.0222.1`, macOS 27.0, Xcode 27.0, and iOS Simulator SDK 27.0. The verified toolchain was Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, CocoaPods 1.17.0, and applesimutils 0.9.12. The pnpm cache was restored in both runs; each install log reports 938 packages reused and zero downloaded. Neither workflow configures a DerivedData cache. Both native build logs report cache misses for React Native Debug/Release dependencies and core plus Hermes archives.

The candidate workspace install took 3m51s versus 4s on the baseline. Its `pnpm install` log records 205 slow npm registry responses, and the supply-chain lockfile check took 3m15.8s versus 3.3s on the baseline. This explains most of the install-stage difference; the logs do not establish whether the already-started Simulator contributed. The candidate build stage remains 2m16s slower despite three fewer Xcode builds and two fewer CocoaPods installs. Per-build timings and runner resource measurements were not captured, so the cause of that increase is unknown. The next hosted comparison moves Simulator preparation after the native build to test whether overlapping boot work affected build time; this is a hypothesis, not a measured cause.

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

The Detox job prepares one dedicated iOS 27 iPhone 18 Pro Simulator after the native build, persists its UDID before boot, and passes that exact ID to both configurations. This ordering is being measured against the earlier hosted candidate, which prepared the device before dependency installation. Each `simctl` operation and each lifecycle workflow step has a bound. Cleanup targets only the recorded device, attempts deletion after shutdown errors, and preserves logs. Summary validation requires both the configured six-suite Release run and one-suite OpenAI Debug run, and rejects missing, failed, skipped, pending, or todo tests.

The production app build and standalone OAuth package/Simulator harness checks remain in the separate `iOS Simulator Build` job. Real-account OAuth remains unverified. Peak RSS, CPU time by child process, child-process count, fixture bytes, peak disk usage, and remote DerivedData size remain unmeasured.

Local portable validation passed 45/45 tests, along with lint, typecheck, unit/component tests, the 250-line audit, shell and Node syntax checks, workflow YAML parsing, and `git diff --check`. All required checks passed on the first hosted candidate head `6e2a34a`. The reordered hosted comparison and the final-head independent strict review and required checks remain pending.
