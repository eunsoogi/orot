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

The serial profile-consolidation run [37188563022](https://github.com/eunsoogi/orot/actions/runs/37188563022) passed all three required checks at `e646675762abbd7dbec78263191f893697ea1fb7` and retained all nine scenarios. Its Detox job took 26m52s (08:20:04–08:46:56 UTC), so it did not meet the issue's ten-minute end-to-end target. The native build step took 9m22s, including one CocoaPods install (108.86s), one Release build (250.19s), and one OpenAI Debug build (201.78s). Simulator boot wait was 2m25s, and the test step took 12m46s. The same dedicated Simulator was reused for both configurations and deleted successfully.

That run's Release Detox command began at 08:33:48.693 UTC, and Jest assigned the Release suite at 08:38:17.486 UTC, a 4m28.793s startup gap. The first app launch followed at 08:39:11 and the first smoke assertion at 08:39:18. Release Jest reported 658.262s. The run did not capture process or memory samples during this interval, so its cause is unresolved; earlier Simulator boot alone is not evidence that the gap will shrink. The next candidate adds trace logging and lightweight process/VM sampling so the delay can be decomposed from observed runner data.

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

The Release router selects the existing storage, agent-memory, graph, or checkpoint entry from explicit launch settings. The Release Jest wrapper loads the six-file suite manifest in the order above; the OpenAI synthetic fixture remains in its separate Debug-only app. No probe assertions or product semantics were changed.

## Consolidated Release startup and isolation

The Release Detox configuration now states `behavior.init.reinstallApp: true` explicitly. Detox performs this uninstall/install once as the Release runner initializes, and the wrapper clears the iOS Keychain once before the probes begin. The smoke, appointments, and agent-memory probes run before graph/checkpoint routes write other state. Their manual reinstall/Keychain-reset blocks were redundant with the clean runner start; each route now starts a new app process when it needs different launch arguments. Storage continues to uninstall, clear Keychain, and reinstall for each of its three fresh-install, restart, and migration cases. These lifecycle semantics follow Detox's [configuration behavior](https://wix.github.io/Detox/docs/config/behavior/) and [device API](https://wix.github.io/Detox/docs/api/device).

The summary gate checks the exact six-file Release manifest, one Release wrapper suite with eight cases, and the separate one-case OpenAI Debug suite. It rejects absent runs, missing cases, skips, pending tests, and failures. Both Detox app configurations retain a failure-only screenshot plugin, logs and view hierarchy diagnostics remain enabled, and the CI runner disables continuous video recording.

The previous hosted `1193ab9` run completed all nine cases in about 19m47, but it predates the single Release wrapper and consolidated startup/reset behavior above. The later `e646675` run validated that wrapper but took 26m52 for the Detox job, as recorded above. It does not meet the ten-minute target. The split-profile timing below also exceeds ten minutes. A later boot/build-overlap attempt is recorded below and also misses the target; the current workflow order builds before preparing the Simulator.

## Parallel profile startup measurements

The split-profile run [37192379114](https://github.com/eunsoogi/orot/actions/runs/37192379114) passed all required checks on `fbdad21cb055edc9c30cd94d5a0c2731ef667866`. Release passed all eight cases in one suite, and OpenAI Debug passed its one case in one suite. Both profile Simulators were deleted and their artifacts uploaded. The run started at 09:30:33 UTC; the earliest E2E profile job started at 09:30:39, and the fail-closed aggregate finished at 09:43:24. That is 12m51s from run creation, including queue time, or 12m45s from the earliest E2E job. It misses the ten-minute target.

| Profile | Pods | Native build | Simulator boot wait | E2E step | Whole profile job |
| --- | ---: | ---: | ---: | ---: | ---: |
| Release | 70.5s | 153.1s | 86s | 358s | 12m37s |
| OpenAI Debug | 75.1s | 138.8s | 118s | 153s | 10m15s |

The Release Detox CLI started at 09:38:13.362 UTC, and Jest assigned the suite at 09:39:24.839, a 71.5s gap. The wrapper had started about 64s before the CLI. Lightweight samples show Simulator wallpaper/background processes using CPU while Node was mostly idle; `vm_stat` showed about 65–73 MiB of free pages, which does not establish swapping or memory pressure. Later `simctl` and `get_app_container` operations also took seconds to tens of seconds. These observations locate delay around Simulator/command startup but do not prove its cause.

## Simulator boot/build overlap attempt

Run [37193964243](https://github.com/eunsoogi/orot/actions/runs/37193964243) at `ef2479954076d5526ad65e69c6055fc874eda77c` passed Quality, the production/OAuth job, both profile jobs, and the fail-closed aggregate. It preserved all nine cases (Release 8/8, OpenAI Debug 1/1), recorded diagnostics, and deleted both dedicated Simulators. The run started at 10:00:29 UTC; the first E2E profile started at 10:00:35 and the aggregate finished at 10:16:34. That is 16m05s including run queue time, or 15m59s from the first profile start. It does not meet the ten-minute target and is 3m14s longer than the preceding split-profile run.

| Profile | Build workflow step | Pods install | Xcode build | Boot wait after build | E2E step | Whole profile job |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Release | 10m33s | 356.00s | 252.18s | 5s | 224s | 15m48s |
| OpenAI Debug | 12m46s | 474.81s | 270.80s | 4s | 41s | 14m52s |

Both jobs used `xcode-27` arm64 runners with macOS 27.0, Xcode 27.0, iOS Simulator SDK 27.0, 3 logical CPUs, and 7,516,192,768 bytes of memory. Each frozen pnpm install reused all 938 packages and downloaded none. Both Pods logs report cache misses for React Native dependency/core and Hermes archives; Xcode completed and the app architecture checks reported `arm64`. These logs do not isolate how much of the slow Pods stage came from downloads, storage, or runner conditions. The preceding run also reported the same vendor archive misses but finished Pods in 70.47s/75.07s, so those misses alone do not explain the variation.

This run prepared each Simulator before its native build. The workflow has returned to building the app before installing Simulator utilities and preparing the device; the next candidate measures dependency and per-profile DerivedData caches with that order restored. No speedup or causal attribution is claimed from this overlap attempt.

## CI changes and verification

The workflow runs Release and OpenAI Debug in separate reusable jobs, allowing their builds and test runs to proceed independently. Each job installs frozen workspace dependencies, restores its profile-scoped React Native artifact and DerivedData caches, and still runs the full Pods install and native build. It then installs applesimutils and creates one dedicated iOS 27 iPhone 18 Pro Simulator. The current ordering builds the app before Simulator setup, waits for boot before E2E, records the exact UDID before boot, passes only that profile's Simulator identity to Detox, collects diagnostics, deletes only that device, and uploads logs and test artifacts even after failure. The required `Detox iOS E2E` check is a fail-closed aggregate: it requires both child jobs to succeed and their validated outputs to report all eight Release cases and the one OpenAI Debug case. The Release run records Detox trace output, successful-run device logs, and 15-second process CPU/RSS samples with periodic `vm_stat` snapshots to help explain its startup interval. The build log continues to record per-stage wall, user, and system time, peak process RSS, host CPU/memory snapshots, Xcode timing summaries, and executable architecture checks. Each `simctl` operation and lifecycle workflow step remains bounded.

The React Native archive cache key includes runner OS/architecture, Xcode, SDK, profile, `pnpm-lock.yaml`, and `Podfile.lock`. Separate Release and OpenAI Debug DerivedData caches also key on those toolchain/profile values and a hash of the workflow, lockfiles, mobile app, workspace packages, and build script. The candidate computes these hashes once from tracked inputs before restoring caches and reuses the same outputs for restore and save. It excludes generated `ios/build*`, Pods, `node_modules`, `.cache`, DerivedData, Simulator, and Keychain paths from the input fingerprint. Cached paths contain build/dependency outputs only; they exclude Simulator device state, Keychains, E2E records, and authentication state. Cache hits do not skip the build, JavaScript bundle generation, executable architecture verification, or any test. `artifacts/detox/native-cache.log` records whether each cache was warm; cache restore and post-job save time are included in the hosted timing.

The production app build and standalone OAuth package/Simulator harness checks remain in the separate `iOS Simulator Build` job. Real-account OAuth remains unverified. Hosted split-profile timing and process/memory samples are recorded above. The first cache-enabled run at `d627837` failed before it saved caches, but the later `7a62e0b` cold attempt saved both profile caches and the same-SHA warm attempt restored them with matching fingerprints. The exact-hosted critical paths were 19m39s cold and 13m58s warm, both over the ten-minute target. Local post-build DerivedData sizes were about 1.3 GiB (Release) and 1.7 GiB (OpenAI Debug), so cache transfer overhead remains material. Per-child CPU time, child-process count, fixture bytes, peak disk usage, and remote DerivedData size remain unmeasured.

The first hosted candidate `6e2a34a` passed all three required checks. On diagnostic head `db2c184`, Quality and iOS Simulator Build passed; Detox E2E failed as described above. On `37bb7b9`, Quality and iOS Simulator Build passed; Detox E2E failed during the Release build as described above. The corrected code head `6713cd2` passed all three required checks, including the hosted timing run above. Portable and configuration tests, lint, typecheck, unit/component tests, LOC, shell/Node syntax, workflow YAML parsing, and diff checks also passed locally on that code head. The later documentation-only head `5c83b35` passed all three required checks in run 37179797245; its E2E log reports 9/9 tests across 7 suites with no skips or pending tests, and Simulator deletion succeeded. A strict independent review of that exact head passed without findings. The hosted timing comparison remains anchored to implementation head `6713cd2`; the documentation-only change does not alter its code or workload.

## Cache-key and appointments-screen correction

Run [37196401146](https://github.com/eunsoogi/orot/actions/runs/37196401146) at `d62783732165a049728a0296eb85e9f163ff6d92` passed Quality and the separate production/OAuth build, but the Detox profiles and required aggregate failed. The Release profile passed seven of eight cases; the appointments test timed out waiting for the non-accessible `appointments-probe-ready` wrapper even though its uploaded native hierarchy showed the Korean appointments title, empty state, and add control. OpenAI Debug passed its one case. The profile Simulators were deleted and artifacts uploaded.

The first profile started at 10:45:32 UTC and the fail-closed aggregate completed at 10:56:53, for 11m21s. This misses the ten-minute target. The cache-state logs recorded misses for the React Native and per-profile DerivedData caches. The post-job cache key evaluation failed while expanding broad `hashFiles()` patterns after the build had populated the mobile tree, so the run did not provide cache-save or warm-restore evidence.

The correction computes stable content fingerprints from tracked workflow, lockfile, build-script, app, and package inputs once before cache restore; both cache restore and save use those step outputs. Generated build, dependency, Simulator, and Keychain paths are excluded from the input fingerprint. The appointments probe now renders the actual `AppointmentsScreen` at the root, and Detox waits for its visible title and add control plus the empty-state text; the separate smoke case still checks the welcome screen and locale. Focused cache-fingerprint and routing tests passed 8/8, including verification that the fingerprint command writes its exact values to GitHub's output file. Later hosted runs established the latest-main baseline and exact-key cold-save/warm-restore behavior, but did not meet the ten-minute acceptance; the next section records the current Jest-startup candidate.

## Jest startup scope candidate

The warm `7a62e0b` hosted run still took 13m58s from the first E2E profile start through the fail-closed aggregate. The Release Detox test step took 327s, while Jest reported `Time: 248.857 s`; suite assignment occurred about 100s after the Detox profile wrapper began. These measurements do not isolate Jest discovery or transformation from Detox setup and Simulator operations. On the worktree, the current `apps/mobile/ios/build` contained only 38 files (176 KiB), not the full hosted DerivedData tree, so local enumeration time is not representative of the restored hosted cache.

With Node 22 and the current workspace, `/usr/bin/time -p pnpm --filter @orot/mobile exec jest ... --listTests --runInBand --json` found the same entry in each current/candidate pair: Release `e2e/release-e2e.test.js`; OpenAI Debug `e2e/openai-provider.e2e.js`. Current versus candidate real times were Release 0.39s vs 0.18s and Debug 0.22s vs 0.19s. The Release wrapper still loads its unchanged six-file manifest (eight cases); Debug retains its one case. The candidate applies `roots: [apps/mobile/e2e]` and `transform: {}` only to these Detox Jest invocations. Their test modules are CommonJS and use Detox/Jest APIs without requiring app source or repository manual mocks; app bundling retains `apps/mobile/babel.config.js`. These local sub-second differences are not evidence of a hosted speedup.

The profile-specific Detox wrapper selects the existing Release or OpenAI Debug Detox config and changes only the Jest config path. The Jest candidate preserves each profile's `testMatch`, setup/teardown, reporter, environment, timeout, and worker limit. It is stored under `scripts/ci/`, outside the existing native build fingerprint inputs, so this test-runner-only experiment should retain the exact native cache keys. A hosted run must verify that cache hit, all nine assertions, retained diagnostics, and exact Simulator deletion before any timing conclusion.

Release resource samples now distinguish lifetime-average CPU in `ps` from a one-second delta CPU sample in `top`, and record full `vm_stat` page-in/page-out/swap counters plus `vm.swapusage` at the start, end, and periodic checkpoints. These are host observations; the script does not apply memory pressure, and direct pressure classification remains unmeasured. The hosted candidate timing, actual Jest assignment interval, and cleanup result are pending.
