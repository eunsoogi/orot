# Detox CI performance

## Hosted baseline

The comparable baseline is the successful `main` run [37168559096, attempt 2](https://github.com/eunsoogi/orot/actions/runs/37168559096/attempts/2), at `b128021a3330c1f2d432c218ba70f13c86c273e9`. It includes the checkpoint probe added by PR #72. All three required jobs passed. Attempt 1 of the same run failed in the old multi-build workflow during a later CocoaPods install with `ArgumentError - path name contains null byte`; attempt 2 passed. This change reduces the install to one and does not claim to have fixed that error's root cause.

| Hosted measure | Baseline | First candidate | Corrected candidate (`6713cd2`) |
| --- | ---: | ---: | ---: |
| Frozen workspace install | 4s | 3m51s | 4s |
| Detox build step | 17m03s | 19m19s | 6m59s |
| Detox E2E test step | 15m00s | 8m34s | 12m47s |
| Complete Detox job | 33m32s | 33m34s | 22m30s |
| Native app builds | 4 Release + 1 Debug | 1 Release + 1 Debug | 1 Release + 1 Debug |
| CocoaPods installs | 3 | 1 | 1 |
| Detox/Jest invocations | 5 | 2 | 2 |
| Workload | 9 tests across 7 suites | 9 tests across 7 suites | 9 tests across 7 suites |

The successful hosted candidate was run 37172401876 at `6e2a34a3fe6670c11500743bab59d7549f6f20d4`. Its three required checks passed. The E2E log records all nine test cases across seven suites in two invocations, and the dedicated Simulator was deleted successfully. Compared with the baseline, the test step is 6m26s shorter, the build step is 2m16s longer, and the complete Detox job is 2s longer. This run therefore does not demonstrate a whole-job speedup.

The corrected hosted candidate was run 37178221372 at `6713cd239c829c91fc38ac9bc502a501f1d2e803`. Quality, iOS Simulator Build, and Detox iOS E2E all passed. Compared with the successful baseline, its Detox build step was 10m04s shorter, its test step was 2m13s shorter, and the complete Detox job was 11m02s shorter (33m32s to 22m30s). This is an observed single-run comparison between separate runner instances, not a controlled experiment or a guarantee of the same improvement on later runs.

Both runs restored the same pnpm cache on the same `xcode-27-arm64` image release and used the same nine-test/seven-suite workload. The corrected candidate used one CocoaPods install, one Release app build, one OpenAI Debug app build, and two Detox/Jest invocations. Its runner snapshot reported 3 logical CPUs and 7,516,192,768 bytes of memory. Internal `/usr/bin/time -l` measurements were 64.52s for CocoaPods, 192.63s for Release (maximum process RSS 834,125,824 bytes), and 160.05s for OpenAI Debug (maximum process RSS 783,040,512 bytes). Both executable architecture checks reported only `arm64`, matching the runner. Xcode timing summaries and build logs were uploaded; the dedicated Simulator was removed successfully.

The native build log command timings were: baseline Release builds 203/186/192/186s and Debug 158s; first candidate Release 638s and Debug 316s. CocoaPods took 62s in the baseline's first build sequence and 190s in the first candidate. The separate production/OAuth job on the first candidate took 65s for CocoaPods and 156s for its Debug app build. These are single-run timings from separate hosted runner instances, not controlled samples.

Both hosted runs used the `xcode-27-arm64` image, release `20260928.0222.1`, macOS 27.0, Xcode 27.0, and iOS Simulator SDK 27.0. The verified toolchain was Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, CocoaPods 1.17.0, and applesimutils 0.9.12. The pnpm cache was restored in both runs; each install log reports 938 packages reused and zero downloaded. Neither workflow configures a DerivedData cache. Both native build logs report cache misses for React Native Debug/Release dependencies and core plus Hermes archives.

GitHub lists the `xcode-27` public-preview runner as 3 CPU/7 GB RAM. Its [image README](https://github.com/actions/runner-images/blob/main/images/macos/xcode-27-arm64-Readme.md#installed-simulators) includes the iOS 27.0 Simulator runtime and iPhone 18 Pro; the workflow installs `applesimutils` separately. This work stays on the existing runner and image.

The first candidate workspace install took 3m51s versus 4s on the baseline. Its `pnpm install` log records 205 slow npm registry responses, and the supply-chain lockfile check took 3m15.8s versus 3.3s on the baseline. A later run on the same cache and workload returned to a 4s install, so the registry delay was transient; it is not evidence that Simulator boot caused it. The first candidate build stage remained 2m16s slower despite three fewer Xcode builds and two fewer CocoaPods installs. Per-build timing and runner resource measurements were not captured, so that increase's cause was unknown.

## Simulator-order diagnostic run

Run [37174832554](https://github.com/eunsoogi/orot/actions/runs/37174832554) used `db2c1846e19503f3651e059d8fc8e003f31a9037`, moving Simulator preparation until after the two app builds. It used the same `xcode-27-arm64` image release and restored pnpm cache as the baseline and first candidate, but a different hosted runner instance.

| Detox job step | Time (UTC) | Duration | Result |
| --- | --- | ---: | --- |
| Frozen workspace install | 03:43:33–03:43:37 | 4s | 938 reused, 0 downloaded |
| Shared Release + OpenAI Debug build | 03:43:39–03:56:37 | 12m58s | Passed |
| Create and boot Simulator | 03:56:37–03:56:50 | 13s | Passed |
| Install applesimutils | 03:56:50–04:03:36 | 6m46s | Passed |
| Wait for Simulator boot | 04:03:36–04:03:40 | 4s | Passed |
| E2E | 04:03:40–04:16:29 | 12m49s | Failed |
| Complete Detox job | 03:42:40–04:17:04 | 34m24s | Failed |

The candidate build was 4m05s shorter than the baseline and 6m21s shorter than the first candidate, but these are single samples from different hosted runner instances and do not isolate the effect of step ordering. The applesimutils stage was not a six-minute download: the wrapper started at 03:57:31, Homebrew tap/clone began at 04:03:20, and tap, trust, bottle, and install completed by 04:03:36. The long gap after Simulator boot is consistent with possible resource contention, but does not prove it.

The E2E failure was one Jest-wide 120s timeout in the fresh-install storage test. The screenshot shows `Storage probe success`; Detox spent about 40.2s in install, 51.2s in `get_app_container`, and 6.9s in `simctl launch` before the expectation started. The test timed out before its normal 30s visibility assertion could finish. Overall, 8/9 test cases passed: Release had 7/8 passing across all six suites, and OpenAI Debug passed 1/1. Simulator deletion and artifact upload succeeded. The test timeout remains 120s, and no test was skipped or retried.

The build log also showed Xcode choosing the first of multiple Simulator destinations and compiling both arm64 and x86_64 objects on the arm64 runner. The next candidate added E2E-only host architecture selection, `xcodebuild -showBuildTimingSummary`, stage wall/CPU/RSS measurements, and a `lipo` architecture check. Production and standalone OAuth builds remain unchanged.

## Host-architecture build correction

Run [37177472365](https://github.com/eunsoogi/orot/actions/runs/37177472365) tested the E2E-only architecture settings on `37bb7b9e472cd60e872dbbc911e7e8775b375cb4`. Quality passed in 1m25s, and the separate production app plus OAuth job passed in 8m35s. The Detox job failed in its Release build after 2m08s: Xcode rejects an explicit `-arch` when the generic Simulator destination already implies an architecture. Simulator setup and E2E did not run, so this attempt is not a performance comparison.

The correction retains the generic Simulator destination and sets `ARCHS` to the detected host architecture with `ONLY_ACTIVE_ARCH=YES`, without passing `-arch`. The build script runs from the repository root, so app executable checks now resolve relative DerivedData paths beneath `apps/mobile` and honor the OpenAI DerivedData override. The build config also exposes a matching Release DerivedData override for local reuse.

The full workflow build command then passed locally from the repository root using the preserved candidate DerivedData directory without cleaning it. CocoaPods exited 0 in 12.54s; Release exited 0 in 121.12s and Debug exited 0 in 96.88s. Both `lipo` checks reported `arm64`, matching the local host. That host had 10 logical CPUs and 32 GiB memory, unlike the hosted runner, and the DerivedData was warm; these local values validate command behavior and architecture selection, not hosted performance.

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

The Detox job builds Release and OpenAI Debug for the host Simulator architecture, then installs applesimutils before creating and booting one dedicated iOS 27 iPhone 18 Pro Simulator. It persists the UDID before boot and passes that exact ID to both configurations. The build log records per-stage wall, user, and system time, peak process RSS, and host CPU/memory snapshots. It also prints Xcode build timing summaries and verifies both app executables contain only the selected architecture. Each `simctl` operation and lifecycle workflow step remains bounded. Cleanup targets only the recorded device, attempts deletion after shutdown errors, and preserves logs. Summary validation requires both the configured six-suite Release run and one-suite OpenAI Debug run, and rejects missing, failed, skipped, pending, or todo tests.

The production app build and standalone OAuth package/Simulator harness checks remain in the separate `iOS Simulator Build` job. Real-account OAuth remains unverified. The updated Detox build logs per-stage process max RSS and host memory snapshots; per-child CPU time, child-process count, fixture bytes, peak disk usage, and remote DerivedData size remain unmeasured.

The first hosted candidate `6e2a34a` passed all three required checks. On diagnostic head `db2c184`, Quality and iOS Simulator Build passed; Detox E2E failed as described above. On `37bb7b9`, Quality and iOS Simulator Build passed; Detox E2E failed during the Release build as described above. The corrected code head `6713cd2` passed all three required checks, including the hosted timing run above. Portable and configuration tests, lint, typecheck, unit/component tests, LOC, shell/Node syntax, workflow YAML parsing, and diff checks also passed locally on that code head. The later documentation-only head `5c83b35` passed all three required checks in run 37179797245; its E2E log reports 9/9 tests across 7 suites with no skips or pending tests, and Simulator deletion succeeded. A strict independent review of that exact head passed without findings. The hosted timing comparison remains anchored to implementation head `6713cd2`; the documentation-only change does not alter its code or workload.
