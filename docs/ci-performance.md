# Detox CI performance

## Historical cache fingerprint candidate: app-input scope

Run [37291367625](https://github.com/eunsoogi/orot/actions/runs/37291367625) on PR head `43d4ac8` failed before E2E. Quality passed. The production build reported `BUILD SUCCEEDED`, but its manifest rejected the app as `app_architecture_invalid`. Both Detox profiles built `arm64` apps, then rejected their manifests after CocoaPods changed the tracked Xcode project and privacy manifest. E2E and OAuth checks were skipped; both dedicated Simulators were deleted. This remains a retained failure, not cache-reuse evidence.

Run [37303637825](https://github.com/eunsoogi/orot/actions/runs/37303637825) on PR head `0570b36` passed Quality, the production/OAuth checks, and OpenAI Debug (1/1). Release passed 7/8 and failed #74's added navigation assertion, which still expected the manual appointments screen after opening Calendar linking. Base `main` at `5104353` passed [run 37301328402](https://github.com/eunsoogi/orot/actions/runs/37301328402); its existing smoke test checks welcome labels only. Commit `6a30285` updates #74's additional navigation coverage to verify Calendar linking while retaining the dedicated manual CRUD probe. Run 37303637825 remains a failure on the previous head. Both React Native archive caches hit, both DerivedData caches missed, both manifests were written with matching pre/post build fingerprints, and both dedicated Simulators were deleted. The first E2E profile start to aggregate failure took 20m22s; Release app build took 9m40s and its E2E step took 356s.

Run [37306975101](https://github.com/eunsoogi/orot/actions/runs/37306975101) on PR head `f8d1be2` passed all five required jobs, including the production/OAuth build, Release (8/8), OpenAI Debug (1/1), and aggregate; both dedicated Simulators were deleted. The first profile started at 12:04:02Z and the aggregate completed at 12:25:01Z, a 20m59s E2E critical path. Release and Debug jobs took 18m41s and 13m26s. Both React Native archive caches hit; Release DerivedData missed, while OpenAI Debug restored a dependency-compatible cache but invalidated its app target with `build_inputs_changed`. Both manifests were written, so this run proves coverage and cleanup but not app-output reuse.

| Hosted run | Source head | Result |
| ----------- | ----------- | ------ |
| [37291367625](https://github.com/eunsoogi/orot/actions/runs/37291367625) | `43d4ac8` | Quality passed; production manifest rejected; Detox manifests rejected after CocoaPods edits; E2E and OAuth checks skipped; both dedicated Detox Simulators were deleted |
| [37303637825](https://github.com/eunsoogi/orot/actions/runs/37303637825) | `0570b36` | Quality, production/OAuth, and Debug passed; Release 7/8 with stale smoke failure; DerivedData missed; both Simulators were deleted; full E2E path 20m22s |
| [37306975101](https://github.com/eunsoogi/orot/actions/runs/37306975101) | `f8d1be2` | All required jobs passed; 9/9 cases; Release DerivedData missed and Debug app outputs were invalidated; both Simulators were deleted; full E2E path 20m59s |

At the `f8d1be2` revision described by this historical section, each Detox profile restored the React Native archive before the single CocoaPods install, then fingerprinted the tracked CocoaPods integration and full app inputs after installation. Its DerivedData cache was restored only against those post-install fingerprints, so a tracked privacy-manifest or Xcode-project change could not be hidden by normalization. A runner-local snapshot checked the captured inputs again before the manifest was written. Manifest schema 4 recorded the fingerprint-stage baseline and verified install outputs. Production kept its separate source-baseline lookup because that build cache was prepared before its conditional Pods install. The production build also constrained Xcode to the runner architecture and required Node to match that host architecture.

The source correction in `6a30285` passed `pnpm lint`, `pnpm format:check`, `pnpm typecheck`, and `pnpm test:unit` (175 tests), plus the portable CI/release/quality gate suite (100/100), quality inventory, LOC audits, syntax checks, and `git diff --check`. Provenance tests use fixtures and do not replace hosted CocoaPods/build evidence. No local native build, CocoaPods install, or Simulator run was performed.

The sole app-output input changed between cache-bearing head `0570b36` and `f8d1be2` was `apps/mobile/e2e/smoke.test.js`; Jest runs it on Node, and it is not imported by the configured TSX bundle entrypoints. That candidate filtered only host `*.test.js` and `*.e2e.js` files under `apps/mobile/e2e` from app-output fingerprints and retained the bundled entry and app sources. Its focused regression test passed, but hosted cache reuse and timing were unverified. The exact-head required checks on `f8d1be2` passed. The assigned strict reviewer returned `BLOCK R3` for stale historical descriptions, which were corrected in a later candidate. Two consecutive successful same-implementation full paths under ten minutes remained outstanding; no speedup was claimed.

On the `macOS 27.0`, Xcode 27, arm64 runner (3 logical CPUs and 7,516,192,768 bytes of memory), the Release and Debug Xcode build commands took 498.29s and 467.96s real time, with 287.08/61.67s and 115.41/40.05s user/system CPU and peak process RSS of 821,592,064 and 670,056,448 bytes. The E2E commands took 323.02s and 35.13s real time, with peak process RSS of 125,304,832 and 126,091,264 bytes. These command measurements do not represent whole-runner usage. Peak disk use, total runner CPU, child-process count/time, and fixture bytes were not measured.

## Historical cache and Simulator measurements

Pull request run [37248816905, attempt 1](https://github.com/eunsoogi/orot/actions/runs/37248816905/attempts/1) and its same-SHA rerun, [attempt 2](https://github.com/eunsoogi/orot/actions/runs/37248816905/attempts/2), both passed the five required jobs, all nine E2E cases, and dedicated Simulator deletion on `b98df1fbf798abbe9f26ceb25e2670600cda5ce5`. They did not meet the issue's ten-minute critical-path target.

| Measurement                                     | Attempt 1: cold cache | Attempt 2: exact cache hit |
| ----------------------------------------------- | --------------------: | -------------------------: |
| Release Xcode build step                        |                  151s |                       135s |
| Release Simulator boot wait                     |                   90s |                       151s |
| Release E2E workflow step                       |                  394s |                       636s |
| First E2E profile start to aggregate completion |                13m44s |                     19m19s |
| Release E2E cases                               |                   8/8 |                        8/8 |
| OpenAI Debug E2E cases                          |                   1/1 |                        1/1 |

Attempt 1 recorded DerivedData cache misses and saved both profile caches. Attempt 2 restored both with `classification=exact`, matching toolchain and input fingerprints, and successfully wrote both manifests. The warm Release build still ran 29 `CompileC` and 4 `SwiftCompile` tasks (64.501s and 10.582s reported task time) plus 12 script phases (51.328s). The Xcode log does not identify a single changed input responsible for those remaining compile tasks. Its individual compile entries include Pods, generated React Native provider files, and Orot app sources.

Attempt 2's Release boot-wait step took 151s; its log ends with “Device already booted, nothing to do,” which does not explain the elapsed time. The Release E2E step took 636s, while the Detox wrapper reported 582s and Jest 429.578s. The wrapper began at 01:16:20Z and the log recorded the Jest command at 01:18:37.811Z, leaving 137.8s between those points; the first app launch was logged 99.3s later. Those timestamps do not identify the source of the delay. CI installs `applesimutils` in a separate workflow step before Detox starts. Detox 20.51.4's [CLI initializes with `workerId: null`](https://github.com/wix/Detox/blob/20.51.4/detox/local-cli/test.js#L11-L22), which skips worker installation; the Jest environment initializes the worker after Jest starts. That worker installs Detox utility binaries and applies `reinstallApp: true`, uninstalling and reinstalling the configured app ([worker setup](https://github.com/wix/Detox/blob/20.51.4/detox/src/DetoxWorker.js#L189-L201)). The current workflow adds a `detox_trace` input for manually dispatched CI only, enabling built-in trace logging in both E2E profile jobs while ordinary pull-request and push jobs retain `info`. The Release wrapper forwards the selected log level to Detox; executable tests cover explicit `trace`, the default `info`, and rejection of unsupported values. Detox `trace` output includes lifecycle events and timed `RuntimeDevice` calls such as utility installation, app install/uninstall, and launch ([runtime wrappers](https://github.com/wix/Detox/blob/20.51.4/detox/src/devices/runtime/RuntimeDevice.js#L19-L59), [trace helper](https://github.com/wix/Detox/blob/20.51.4/detox/src/utils/traceMethods.js#L1-L11)).

The exact-head pull-request run [37259565780](https://github.com/eunsoogi/orot/actions/runs/37259565780) on `96c2e5bce0c806cef93d65fd081c13c4bf232845` passed Quality, the production/OAuth build, both E2E profiles, and the aggregate. Release passed 8/8 cases and OpenAI Debug passed 1/1; both dedicated Simulators were deleted. Both React Native archive caches hit. The DerivedData caches were classified `dependency-compatible` with `reason=build_inputs_changed`, so the app targets were rebuilt and manifests saved. Release took 13m22s to build, 2s to wait for Simulator boot, and 6m21s for E2E; OpenAI Debug took 10m19s to build, 3s to wait, and 47s for E2E. The earliest profile start to aggregate completion was 23m55s, above the ten-minute target.

The exact-head pull-request run [37265099838](https://github.com/eunsoogi/orot/actions/runs/37265099838) on `1044bffcb1ef8ad95c9fbdc4729ab12d6486c808` passed all five required jobs, all nine E2E cases, the separate production/OAuth checks, and deletion of both dedicated Simulators. Both React Native archive caches hit. DerivedData restored through the native-dependency prefix but was classified `dependency-compatible` with `reason=build_inputs_changed`; native-dependency and toolchain hashes matched, while both app targets rebuilt. Release build / boot wait / E2E were 13m10s / 2s / 365s; OpenAI Debug was 6m25s / 1s / 34s. The earliest profile start to aggregate completion was 23m15s; from the first required job start to aggregate completion it was 27m33s. Both exceed the ten-minute target.

The cache mismatch is explained by the exact input diff since the earlier cached head `96c2e5b`: the only changed files that the app-output fingerprint included were `scripts/ci/detox-cache-fingerprint.mjs` and `scripts/ci/detox-derived-data-cache.mjs`, and their diff added comments only. The other changed files were documentation, repository guidance, or Simulator lifecycle comments and were outside that fingerprint. The workflow logs show matching native-dependency/toolchain hashes and both full fingerprints matching after the build. The current local correction removes workflow and cache-maintenance code from the app-output fingerprint while retaining app/package inputs, effective Detox build configurations, and the actual build script; its regression test passes locally, but this corrected scope has not yet been hosted.

The build command logs report 790.36s real, 179.80s user, 53.95s system, and 664,649,728 bytes peak RSS for Release; OpenAI Debug reports 385.21s real, 90.96s user, 27.52s system, and 604,798,976 bytes peak RSS. The E2E command logs report 35.33s user-plus-system CPU and 125,796,352 bytes peak RSS for Release, and 4.63s CPU and 126,287,872 bytes peak RSS for OpenAI Debug. These are command-level observations, not whole-runner resource totals. Peak disk use, child-process count/time, and fixture bytes were not measured.

The manual trace diagnostic, run [37261353464](https://github.com/eunsoogi/orot/actions/runs/37261353464) on SHA `96c2e5bce0c806cef93d65fd081c13c4bf232845` with `detox_trace=true` and resource sampling off, passed the required jobs, all nine cases, and deletion of both dedicated Simulators. Its earliest profile start to aggregate completion was 20m43s. Both profiles missed the React Native archive and DerivedData caches; DerivedData classification was `miss` (`reason=derived_data_absent`). Each post-build manifest matched the fingerprints and was written. The native build steps took 12m24s for Release and 12m21s for OpenAI Debug, so this run does not measure warm-cache timing.

The trace recorded Detox invoking Jest 23ms after the Release CLI event and 70ms after the OpenAI Debug CLI event. Worker setup took 18.2s in Release and 25.9s in Debug. `installUtilBinaries` took 1ms or less; worker setup included an app install of 10.4s in Release and 12.8s in Debug. The first `launchApp` call began 23.0s after the Release CLI event and 28.1s after the Debug CLI event; the traced calls ended 38.8s and 14.9s later, respectively. The earlier 137.8s interval was not reproduced, and this run does not establish its cause. The trace and its timing are diagnostic, not comparable to ordinary `info` runs.

The Release log records 13 app launches across eight cases. Five are the process restarts asserted by the appointments, agent-memory, checkpoint-resume, and storage-restart scenarios. The fresh-install and migration storage cases uninstall the app, clear Keychain, and reinstall before their probes. The separate process-restart case reuses the fresh case's records and terminates and relaunches the app without another reset. All three storage scenarios remain present.

At that stage, the workflow installed Simulator utilities and prepared each dedicated Simulator before its native build, allowing boot to progress during compilation. The `96c2e5b` pull-request run recorded 2s and 3s boot waits, but its full path was 23m55s. The manual trace diagnostic recorded 0s and 2s waits, but its DerivedData caches missed and its full path was 20m43s. These runs do not isolate the ordering effect or establish a speedup. Two consecutive successful same-implementation critical paths under ten minutes remained outstanding.

## Hosted baseline

The comparable baseline is the successful `main` run [37168559096, attempt 2](https://github.com/eunsoogi/orot/actions/runs/37168559096/attempts/2), at `b128021a3330c1f2d432c218ba70f13c86c273e9`. It includes the checkpoint probe added by PR #72. All three required jobs passed. Attempt 1 of the same run failed in the old multi-build workflow during a later CocoaPods install with `ArgumentError - path name contains null byte`; attempt 2 passed. This change reduces the install to one and does not claim to have fixed that error's root cause.

| Hosted measure           |                Baseline |         First candidate | Corrected candidate (`6713cd2`) |
| ------------------------ | ----------------------: | ----------------------: | ------------------------------: |
| Frozen workspace install |                      4s |                   3m51s |                              4s |
| Detox build step         |                  17m03s |                  19m19s |                           6m59s |
| Detox E2E test step      |                  15m00s |                   8m34s |                          12m47s |
| Complete Detox job       |                  33m32s |                  33m34s |                          22m30s |
| Native app builds        |     4 Release + 1 Debug |     1 Release + 1 Debug |             1 Release + 1 Debug |
| CocoaPods installs       |                       3 |                       1 |                               1 |
| Detox/Jest invocations   |                       5 |                       2 |                               2 |
| Workload                 | 9 tests across 7 suites | 9 tests across 7 suites |         9 tests across 7 suites |

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

| Detox job step                      | Time (UTC)        | Duration | Result                   |
| ----------------------------------- | ----------------- | -------: | ------------------------ |
| Frozen workspace install            | 03:43:33–03:43:37 |       4s | 938 reused, 0 downloaded |
| Shared Release + OpenAI Debug build | 03:43:39–03:56:37 |   12m58s | Passed                   |
| Create and boot Simulator           | 03:56:37–03:56:50 |      13s | Passed                   |
| Install applesimutils               | 03:56:50–04:03:36 |    6m46s | Passed                   |
| Wait for Simulator boot             | 04:03:36–04:03:40 |       4s | Passed                   |
| E2E                                 | 04:03:40–04:16:29 |   12m49s | Failed                   |
| Complete Detox job                  | 03:42:40–04:17:04 |   34m24s | Failed                   |

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

| Configuration | Scenario                         | Oracle                                                                                                                                                                                                    |
| ------------- | -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Release       | App smoke                        | Renders the Korean welcome screen, checks the Korean-labeled home controls, opens Calendar linking, and verifies its Korean title and connect action.                                                       |
| Release       | Appointments                     | Creates, edits, and cancels an appointment that survives process restarts.                                                                                                                                |
| Release       | Encrypted storage: fresh install | Creates encrypted source and evidence records on a fresh install.                                                                                                                                         |
| Release       | Encrypted storage: restart       | Reopens a source and evidence span after an app process restart.                                                                                                                                          |
| Release       | Encrypted storage: migration     | Migrates the earlier test schema on a fresh install.                                                                                                                                                      |
| Release       | Agent memory                     | Persists, corrects, recalls, and removes Korean memory with its source across an app restart.                                                                                                             |
| Release       | LangGraph                        | Invokes and consumes a stateful two-node graph 20 consecutive times.                                                                                                                                      |
| Release       | Checkpoint resume                | Saves after `increment`, restarts the app, resumes without rerunning the completed node, and checks the result `value=8; nodes=increment,double` plus Unicode checkpoint metadata `환자 기록: café 🌱🩺`. |
| Debug         | OpenAI provider synthetic probe  | Checks visible-model-only catalog, completion, usage-limit, and cancellation behavior; asserts the real account remains unverified and no synthetic access token is exposed.                              |

The Release router selects the existing storage, agent-memory, graph, or checkpoint entry from explicit launch settings. The Release Jest wrapper loads the six-file suite manifest in the order above; the OpenAI synthetic fixture remains in its separate Debug-only app. No probe assertions or product semantics were changed.

## Consolidated Release startup and isolation

The Release Detox configuration now states `behavior.init.reinstallApp: true` explicitly. Detox performs this uninstall/install once as the Release runner initializes, and the wrapper clears the iOS Keychain once before the probes begin. The smoke, appointments, and agent-memory probes run before graph/checkpoint routes write other state. Their manual reinstall/Keychain-reset blocks were redundant with the clean runner start; each route now starts a new app process when it needs different launch arguments. The storage fresh-install and migration cases uninstall, clear Keychain, and reinstall; the restart case seeds its records, terminates the app, and relaunches it without another Simulator reset. These lifecycle semantics follow Detox's [configuration behavior](https://wix.github.io/Detox/docs/config/behavior/) and [device API](https://wix.github.io/Detox/docs/api/device).

The summary gate checks the exact six-file Release manifest, one Release wrapper suite with eight cases, and the separate one-case OpenAI Debug suite. It rejects absent runs, missing cases, skips, pending tests, and failures. Both Detox app configurations retain a failure-only screenshot plugin, logs and view hierarchy diagnostics remain enabled, and the CI runner disables continuous video recording.

The previous hosted `1193ab9` run completed all nine cases in about 19m47, but it predates the single Release wrapper and consolidated startup/reset behavior above. The later `e646675` run validated that wrapper but took 26m52 for the Detox job, as recorded above. It does not meet the ten-minute target. The split-profile timing below also exceeds ten minutes. The earlier boot/build-order experiment is recorded below and also misses the target; it does not validate the current working-tree overlap candidate described above.

## Parallel profile startup measurements

The split-profile run [37192379114](https://github.com/eunsoogi/orot/actions/runs/37192379114) passed all required checks on `fbdad21cb055edc9c30cd94d5a0c2731ef667866`. Release passed all eight cases in one suite, and OpenAI Debug passed its one case in one suite. Both profile Simulators were deleted and their artifacts uploaded. The run started at 09:30:33 UTC; the earliest E2E profile job started at 09:30:39, and the fail-closed aggregate finished at 09:43:24. That is 12m51s from run creation, including queue time, or 12m45s from the earliest E2E job. It misses the ten-minute target.

| Profile      |  Pods | Native build | Simulator boot wait | E2E step | Whole profile job |
| ------------ | ----: | -----------: | ------------------: | -------: | ----------------: |
| Release      | 70.5s |       153.1s |                 86s |     358s |            12m37s |
| OpenAI Debug | 75.1s |       138.8s |                118s |     153s |            10m15s |

The Release Detox CLI started at 09:38:13.362 UTC, and Jest assigned the suite at 09:39:24.839, a 71.5s gap. The wrapper had started about 64s before the CLI. Lightweight samples show Simulator wallpaper/background processes using CPU while Node was mostly idle; `vm_stat` showed about 65–73 MiB of free pages, which does not establish swapping or memory pressure. Later `simctl` and `get_app_container` operations also took seconds to tens of seconds. These observations locate delay around Simulator/command startup but do not prove its cause.

## Simulator boot/build overlap attempt

Run [37193964243](https://github.com/eunsoogi/orot/actions/runs/37193964243) at `ef2479954076d5526ad65e69c6055fc874eda77c` passed Quality, the production/OAuth job, both profile jobs, and the fail-closed aggregate. It preserved all nine cases (Release 8/8, OpenAI Debug 1/1), recorded diagnostics, and deleted both dedicated Simulators. The run started at 10:00:29 UTC; the first E2E profile started at 10:00:35 and the aggregate finished at 10:16:34. That is 16m05s including run queue time, or 15m59s from the first profile start. It does not meet the ten-minute target and is 3m14s longer than the preceding split-profile run.

| Profile      | Build workflow step | Pods install | Xcode build | Boot wait after build | E2E step | Whole profile job |
| ------------ | ------------------: | -----------: | ----------: | --------------------: | -------: | ----------------: |
| Release      |              10m33s |      356.00s |     252.18s |                    5s |     224s |            15m48s |
| OpenAI Debug |              12m46s |      474.81s |     270.80s |                    4s |      41s |            14m52s |

Both jobs used `xcode-27` arm64 runners with macOS 27.0, Xcode 27.0, iOS Simulator SDK 27.0, 3 logical CPUs, and 7,516,192,768 bytes of memory. Each frozen pnpm install reused all 938 packages and downloaded none. Both Pods logs report cache misses for React Native dependency/core and Hermes archives; Xcode completed and the app architecture checks reported `arm64`. These logs do not isolate how much of the slow Pods stage came from downloads, storage, or runner conditions. The preceding run also reported the same vendor archive misses but finished Pods in 70.47s/75.07s, so those misses alone do not explain the variation.

That historical run prepared each Simulator before its native build. The subsequent v3-cache workflow on `b98df1f` restored build-before-Simulator setup; its hosted cache evidence and timings are documented below. The later workflow moved Simulator utility installation and preparation before the native build again. The newer hosted runs are summarized above; none meets the ten-minute target or isolates the ordering effect.

## CI changes and verification

At that revision, the workflow ran Release, OpenAI Debug, and Speech Transcription in independent reusable jobs, allowing their builds and test runs to proceed in parallel. Each job installed frozen workspace dependencies, restored its profile-scoped React Native archive, installed Pods once, computed post-install build fingerprints, and restored its isolated DerivedData app product before deciding whether an Xcode build was needed. Release and OpenAI Debug used iOS 27.0 with iPhone 18 Pro; transcription selected the `macos-26` hosted label with Xcode 26.2, iOS 26.2, and iPhone 17 Pro, matching the runtime used by the measured local native probe. At the time, the linked [hosted-runner reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) and [macOS 26 image inventory](https://github.com/actions/runner-images/blob/main/images/macos/macos-26-Readme.md) described the available label, runtime, and device. The transcription cache context included that distinct runtime and device. Each profile installed applesimutils and prepared its dedicated Simulator before the native build, then waited for boot before E2E. The nine-case aggregate required Release 8/8 plus OpenAI Debug 1/1; a separate fail-closed aggregate required the transcription probe 1/1. Both reported separately from the complete required-check interval through transcription and aggregation. Exact DerivedData restores were observed on runs 37407779153 and 37413914168, but neither run met the ten-minute target. All three profiles recorded the exact UDID before boot, passed only that profile's Simulator identity to Detox, collected diagnostics, deleted only that device, and uploaded logs and test artifacts even after failure. Ordinary pull request and push runs used Detox `info` logging and failure-only device logs without process or memory sampling. A manually dispatched `CI` workflow could explicitly enable bounded resource sampling; it was off by default and collected at most four periodic samples per profile, plus the start and end samples. Those requested diagnostic runs included their sampling time and were not comparable to the ordinary workload. The build log recorded per-stage wall, user, and system time, peak process RSS, host CPU/memory snapshots, Xcode timing summaries, and executable architecture checks. Each `simctl` operation and lifecycle workflow step remained bounded.

The React Native archive cache key includes runner OS/architecture, Xcode, SDK, profile, `pnpm-lock.yaml`, and `Podfile.lock`. Each profile-scoped DerivedData cache also keys on those toolchain/profile values and a hash of app/package inputs, effective Detox build configurations, and the actual build script. CI orchestration and cache-maintenance code do not affect the app-output fingerprint. The React Native artifact fingerprint is computed before its archive restore; the full build-input and native-dependency fingerprints are computed after Pods and before DerivedData restore. Each fingerprint output is reused for its cache restore and manifest/save. The fingerprints exclude generated `ios/build*`, Pods, `node_modules`, `.cache`, DerivedData, Simulator, and Keychain paths. Cached paths contain build/dependency outputs only; they exclude Simulator device state, Keychains, E2E records, and authentication state. An exact app-output cache hit skips that profile's native app build only after validating the manifest, app identity, Simulator platform, executable architecture, embedded JavaScript bundle and recorded digests; cache misses and invalidated app outputs take the existing build path. Every configured Detox case, failure diagnostic and Simulator cleanup still runs. `artifacts/detox/native-cache.log` records whether each cache was warm; cache restore and post-job save time are included in the hosted timing. Pull request and push jobs keep Detox `info` logging. A manually dispatched `CI` run may opt into `trace` logging with `detox_trace`; the default remains off. Trace output adds logging overhead, so diagnostic runs do not count toward the timing target. This trace option is separate from the existing process and memory sampling input.

The production app build and standalone OAuth package/Simulator harness checks remain in the separate `iOS Simulator Build` job. Real-account OAuth remains unverified. Hosted split-profile timing and process/memory samples are recorded above. The first cache-enabled run at `d627837` failed before it saved caches, but the later `7a62e0b` cold attempt saved both profile caches and the same-SHA warm attempt restored them with matching fingerprints. The exact-hosted critical paths were 19m39s cold and 13m58s warm, both over the ten-minute target. Local post-build DerivedData sizes were about 1.3 GiB (Release) and 1.7 GiB (OpenAI Debug), so cache transfer overhead remains material. Per-child CPU time, child-process count, fixture bytes, peak disk usage, and remote DerivedData size remain unmeasured.

The first hosted candidate `6e2a34a` passed all three required checks. On diagnostic head `db2c184`, Quality and iOS Simulator Build passed; Detox E2E failed as described above. On `37bb7b9`, Quality and iOS Simulator Build passed; Detox E2E failed during the Release build as described above. The corrected code head `6713cd2` passed all three required checks, including the hosted timing run above. Portable and configuration tests, lint, typecheck, unit/component tests, LOC, shell/Node syntax, workflow YAML parsing, and diff checks also passed locally on that code head. The later documentation-only head `5c83b35` passed all three required checks in run 37179797245; its E2E log reports 9/9 tests across 7 suites with no skips or pending tests, and Simulator deletion succeeded. A strict independent review of that exact head passed without findings. The hosted timing comparison remains anchored to implementation head `6713cd2`; the documentation-only change does not alter its code or workload.

## Cache-key and appointments-screen correction

Run [37196401146](https://github.com/eunsoogi/orot/actions/runs/37196401146) at `d62783732165a049728a0296eb85e9f163ff6d92` passed Quality and the separate production/OAuth build, but the Detox profiles and required aggregate failed. The Release profile passed seven of eight cases; the appointments test timed out waiting for the non-accessible `appointments-probe-ready` wrapper even though its uploaded native hierarchy showed the Korean appointments title, empty state, and add control. OpenAI Debug passed its one case. The profile Simulators were deleted and artifacts uploaded.

The first profile started at 10:45:32 UTC and the fail-closed aggregate completed at 10:56:53, for 11m21s. This misses the ten-minute target. The cache-state logs recorded misses for the React Native and per-profile DerivedData caches. The post-job cache key evaluation failed while expanding broad `hashFiles()` patterns after the build had populated the mobile tree, so the run did not provide cache-save or warm-restore evidence.

The correction computes stable content fingerprints from tracked workflow, lockfile, build-script, app, and package inputs once before cache restore; both cache restore and save use those step outputs. Generated build, dependency, Simulator, and Keychain paths are excluded from the input fingerprint. The appointments probe now renders the actual `AppointmentsScreen` at the root, and Detox waits for its visible title and add control plus the empty-state text; the separate smoke case still checks the welcome screen and locale. Focused cache-fingerprint and routing tests passed 8/8, including verification that the fingerprint command writes its exact values to GitHub's output file. Later hosted runs established the latest-main baseline and exact-key cold-save/warm-restore behavior, but did not meet the ten-minute acceptance; the next section records the current Jest-startup candidate.

## Jest startup scope candidate

The warm `7a62e0b` hosted run still took 13m58s from the first E2E profile start through the fail-closed aggregate. The Release Detox test step took 327s, while Jest reported `Time: 248.857 s`; suite assignment occurred about 100s after the Detox profile wrapper began. These measurements do not isolate Jest discovery or transformation from Detox setup and Simulator operations. On the worktree, the current `apps/mobile/ios/build` contained only 38 files (176 KiB), not the full hosted DerivedData tree, so local enumeration time is not representative of the restored hosted cache.

With Node 22 and the current workspace, `/usr/bin/time -p pnpm --filter @orot/mobile exec jest ... --listTests --runInBand --json` found the same entry in each current/candidate pair: Release `e2e/release-e2e.test.js`; OpenAI Debug `e2e/openai-provider.e2e.js`. Current versus candidate real times were Release 0.39s vs 0.18s and Debug 0.22s vs 0.19s. The Release wrapper still loads its unchanged six-file manifest (eight cases); Debug retains its one case. At the time of this historical Jest experiment, the smoke case checked Welcome-to-Appointments navigation. The current Calendar-integrated smoke case checks Welcome-to-Calendar-linking navigation; manual appointment CRUD remains in its dedicated probe. The candidate applies `roots: [apps/mobile/e2e]` and `transform: {}` only to these Detox Jest invocations. Their test modules are CommonJS and use Detox/Jest APIs without requiring app source or repository manual mocks; app bundling retains `apps/mobile/babel.config.js`. These local sub-second differences are not evidence of a hosted speedup.

The profile-specific Detox wrapper selects the existing Release or OpenAI Debug Detox config and changes only the Jest config path. The Jest candidate preserves each profile's `testMatch`, setup/teardown, reporter, environment, timeout, and worker limit. It is stored under `scripts/ci/`, outside the existing native build fingerprint inputs, so this test-runner-only experiment should retain the exact native cache keys. A hosted run must verify that cache hit, all nine assertions, retained diagnostics, and exact Simulator deletion before any timing conclusion.

Earlier diagnostic heads distinguished lifetime-average CPU in `ps` from a one-second delta CPU sample in `top`, and recorded `vm_stat` page-in/page-out counters plus `vm.swapusage`. These were host observations; they did not apply memory pressure, and direct pressure classification remains unmeasured. The current default CI path does not collect these heavyweight samples.

The hosted Jest-root candidate at `4314a73` passed Quality, the production and OAuth build checks, both Detox profile jobs, and the fail-closed aggregate in run [37204346943](https://github.com/eunsoogi/orot/actions/runs/37204346943). Both profile caches restored with the exact existing fingerprints; the logs report all 9 cases passed with no skips, and both dedicated Simulators were deleted. The earliest profile started at 13:04:59 UTC and the aggregate ended at 13:17:50, for a 12m51s E2E critical path. The separate production/OAuth job completed at 13:18:05; total workflow elapsed time from run creation through the last required job was 13m12s.

On that run, Release took 12m27s: cached app build 2m33s, Simulator boot wait 2m57s, Detox step 5m05s, and Jest reported 273.267s. The Release worker was assigned 37.734s after the Detox CLI started. OpenAI Debug took 12m39s: cached app build 4m18s, Simulator boot wait 3m35s, Detox step 2m03s, and Jest reported 59.664s. The cache logs record `true` for both RN archives and profile DerivedData in both jobs; the fingerprints match the prior warm run. Simulator teardown succeeded in both. As a host observation, Release `top` samples showed no idle CPU and pageouts rose from 744 to 16,388 with no swap; Debug reported 105.31 MiB swap usage and swap-ins. These data do not identify a single cause for the elapsed time. The 12m51s run misses the ten-minute criterion; its timing versus the earlier warm run is not a controlled speed claim because it used different hosted runner instances.

## Hosted Spotlight experiment outcome

Run [37214427788](https://github.com/eunsoogi/orot/actions/runs/37214427788) tested `4dc7a94514a97ddc8c3e986399f40025a3969d9f`. Quality and the production/OAuth iOS build passed. The Release profile and OpenAI Debug profile each passed their E2E cases (8/8 and 1/1), deleted their dedicated Simulators, and uploaded artifacts, but their required jobs failed because the bounded Spotlight step exceeded its three-minute limit; the fail-closed aggregate therefore failed too. The earliest profile started at 15:50:16 UTC and the aggregate ended at 16:07:30, a 17m14s critical path. The Release and Debug profile jobs took 16m16s and 12m59s. The run did not meet the ten-minute target and does not count as a successful candidate run.

Both runner logs show Data indexing enabled before the experiment. Late artifacts show that each runner issued one `sudo -n /usr/bin/mdutil -i off /System/Volumes/Data` command, received exit code 0, and later observed indexing disabled. However, both workflow steps timed out before recording outputs; their `attempted` and `verified` outputs were empty, and the after-experiment CPU sample was absent. That late artifact does not turn either step into a completed bounded observation or a passing workflow. No performance effect is established.

The run also exposed synchronous resource collection after the Detox CLI had finished. In Release, sample 12 began at 16:05:44 UTC, the `top` marker appeared at 16:06:42, and sampling completed at 16:06:45; the Detox CLI had ended at 16:05:57.600. The normal E2E command remained open while that sample completed. The historical candidate removes the Spotlight mutation and its post-E2E assessment, restores Release `info` logging and failure-only device logs, and keeps resource sampling behind a manual boolean input that defaults off with at most four periodic samples per profile. At that time, the smoke scenario retained Korean welcome-screen and Welcome-to-Appointments navigation/title/add-control assertions. These measurements motivate removing the work from ordinary CI; they do not predict the next run's duration.

The local candidate passed the 66-test portable/release suite, lint, typecheck, unit tests, the 361-path LOC audit, workflow YAML parsing, shell and Node syntax checks, and `git diff --check`. Sampling-enabled wrapper tests use inert command stubs so ordinary Quality runs never collect runner process or memory data; authentic sampling remains available only through the explicit manual input. The later hosted run on the PR's previous head is recorded below; it passed coverage and required checks but missed the ten-minute target. No performance improvement is claimed from the Spotlight candidate.

## DerivedData cache v2 candidate

Run [37220492826](https://github.com/eunsoogi/orot/actions/runs/37220492826) passed the required checks at `767eed7f45e29c9a9f5a5a20af728f3991baa362`. Its Release profile passed all eight cases and its OpenAI Debug profile passed its one case; both dedicated Simulators were deleted and the run's Detox artifacts were uploaded. Both React Native and profile DerivedData caches restored with exact keys. This was still the v1 cache implementation and does not validate the local v2 changes described below.

| Profile      | Job duration | Detox build step | Simulator boot wait | E2E step | Result     |
| ------------ | -----------: | ---------------: | ------------------: | -------: | ---------- |
| Release      |       14m03s |            3m19s |               2m55s |    5m24s | 8/8 passed |
| OpenAI Debug |       12m52s |            4m22s |               2m49s |    3m31s | 1/1 passed |

Both profile jobs exceeded the ten-minute limit despite exact cache hits. The first profile job started at 17:26:14 UTC and the fail-closed aggregate completed at 19:03:58 UTC, an elapsed workflow interval of 1h37m44s. The Release job started 1h10m22s after the OpenAI Debug job completed. That interval includes job scheduling delay and is recorded separately from profile execution time; its cause is not established by these timestamps. Jest reported 289.136s for Release and 91.353s for OpenAI Debug within the longer E2E workflow steps.

The v2 candidate adds a second fingerprint for native dependency inputs and a manifest containing the profile, runner/toolchain identity, native dependency fingerprint, and full build-input fingerprint. An exact match preserves all restored build outputs. If native dependencies and toolchain match but other build inputs change, the helper deletes only the app's DerivedData intermediate directory and `.app` product, preserving Pods build outputs. If the native dependency or toolchain identity differs, it invalidates that profile's DerivedData cache. The restore prefix is limited to the matching v2 profile, runner/toolchain, and native dependency fingerprint. Both profiles still run `xcodebuild`, bundle JavaScript, verify executable architecture, and execute the complete suite on every run.

The native dependency fingerprint reads the tracked iOS/build/dependency inputs and the effective Detox build configurations. It ignores formatting-only changes to those configurations and normalizes `ENTRY_FILE` and `FORCE_BUNDLING` values because those affect the app bundle, which is cleared and rebuilt, rather than the reusable Pods outputs. The full build-input fingerprint still changes for those edits and selects a distinct primary cache key. Local manifest/classification tests cover exact, compatible, and incompatible caches, both build configurations, preservation of Pods outputs, local-cleanup refusal, and symlink refusal. The focused cache/profile tests, portable CI/release gate suite, lint, formatting, typecheck, unit tests, LOC audit, syntax checks, and diff checks passed on the worktree. No local native build or Simulator run was performed; those and the timing acceptance remain hosted gates.

## Hosted cache-input drift diagnosis

Run [37244247856](https://github.com/eunsoogi/orot/actions/runs/37244247856) on `8a1917626db3cf81813c187755232699b20aba6e` passed Quality and the separate production/OAuth iOS build. Both Detox profile jobs built their apps but failed closed when writing the post-build cache manifest; Simulator preparation and E2E tests did not start. The fail-closed aggregate failed, so this run provides no nine-scenario or performance result.

The uploaded cache logs identify the mismatch in both profiles: the pre-build native-dependency fingerprint was `bd61eae3158ce5e553f424895c788693e2770ae88dbc79b29ef6d2b6ea7d0325`, while the post-build fingerprint was `570b9d298dcfe717405fd32295ff5354667af39163626d830342365da4afe9e4`, matching the cached manifest. The diagnostics list only `apps/mobile/ios/OrotMobile/PrivacyInfo.xcprivacy` as a tracked build input changed during the run. The build logs place that edit in the CocoaPods stage and show CocoaPods appending aggregated privacy reasons. Both teardown steps ran before any Simulator was prepared and recorded that no dedicated device ID existed; no device was targeted.

The first correction moved the timed Pods stage before both fingerprints and cache restores. Review found two remaining boundary issues: the React Native archives must be restored before Pods can consume them, and Release's old `ios/build` cache root also contains CocoaPods Codegen output under `ios/build/generated/ios`. Restoring or invalidating DerivedData at that shared root could replace or delete Codegen output.

## DerivedData cache v3 structural correction

The v3 cache implementation was hosted on `b98df1f` in run 37248816905. Attempt 1 recorded misses and saved both profile caches; attempt 2 restored both as exact hits. Both attempts passed the five required jobs, all nine E2E cases, and deletion of their dedicated Simulators. This validates v3 cache restore/save behavior on that head. The newer `96c2e5b` results are summarized above; they have not yet established a warm exact restore for its full build fingerprint.

The v3 cache keeps the React Native artifact fingerprint and archive restore before the single Pods installation. It computes the full build-input and native-dependency fingerprints after Pods, so the cache identity reflects CocoaPods' tracked privacy-manifest aggregation. Release and OpenAI Debug use isolated DerivedData roots, `ios/build-detox-release` and `ios/build-detox-openai-provider`; CocoaPods Codegen remains under `ios/build/generated/ios`. The DerivedData cache namespace is v3 so archives produced from the previous shared root are not restored into the isolated roots. The build helper skips only the already-run Pods stage; each profile still executes its native build, JavaScript bundling, architecture check, full E2E suite, diagnostics, and Simulator cleanup.

Local CLI fixtures check that `PODS_TARGET_SRCROOT` Codegen output survives a cold cache, dependency-compatible app-output cleanup, and incompatible-cache invalidation while only the isolated DerivedData root is managed. Fingerprint CLI modes and workflow ordering also have focused tests. The exact-head run `37265099838` passed all nine scenarios, cleanup, and required checks, but rebuilt both apps after the fingerprint included cache-only comments. The local correction now has a regression test for excluding workflow/cache-maintenance edits while retaining actual build-script changes; its hosted cache behavior and timing remain unverified. The ten-minute target still requires two consecutive successful full-workflow runs on the same implementation; no speedup is claimed.

## Filtered fingerprint run before latest-main integration

Run [37311782489](https://github.com/eunsoogi/orot/actions/runs/37311782489) passed all five required jobs on PR head `87b621e14a3eec5d571393ec124de6c940c08fda`. Release passed 8/8 E2E cases, OpenAI Debug passed 1/1, the separate production/OAuth build passed, and both dedicated Detox Simulators were deleted. The first profile started at 13:01:45 UTC and the aggregate completed at 13:19:53 UTC, an 18m08s E2E critical path; this misses the ten-minute target.

| Profile | Job duration | Xcode build command | E2E command elapsed | Result |
| ------- | -----------: | ------------------: | ------------------: | ------ |
| Release | 16m53s | 410.21s | 277s | 8/8 passed |
| OpenAI Debug | 9m52s | 322.23s | 33s | 1/1 passed |

Both React Native artifact caches hit. Both DerivedData caches were classified `dependency-compatible`, but `app_reusable=false` with `reason=build_inputs_changed`: the cached build-input fingerprint was `0b91df42…`, while the filtered fingerprint was `9566d80d…`; the native-dependency and toolchain fingerprints matched. This was the first hosted run after changing the fingerprint to exclude only host-side Detox test modules. Both post-build manifests matched the new fingerprint and were written. This run proves coverage, cleanup, and cache-manifest creation on its recorded head; it does not prove DerivedData app-output reuse or performance acceptance.

After this run, the local PR branch integrated `main` at `8c05b38ee98c450f68fecc711cedc196b84e3cff` in merge commit `abcf46119d6cdc41a95045df48043cd15ff7281c`. That main update adds native Speech Transcription build inputs and a separate transcription E2E profile. The nine-case performance acceptance covers only the Release and OpenAI Debug profiles; the separate transcription profile is not counted among those cases. The combined head still needs its own required CI and cache readback. Because the native inputs changed, the first combined-head cache classification must be observed and is not assumed to be warm. Acceptance still requires two consecutive successful full paths under ten minutes on the same post-integration implementation; no speedup is claimed.

## Combined-head cold-cache run

Run [37319116109](https://github.com/eunsoogi/orot/actions/runs/37319116109) passed all five required checks on `b7669ff2b866f1cc16e4f72a452f6fda487dd38b`, after integrating main at `8c05b38`. Quality completed in 3m01s and the separate production/OAuth build in 7m30s. Release passed 8/8 cases and OpenAI Debug passed 1/1; both dedicated Simulators were deleted.

The first Detox profile started at 13:54:32 UTC and the fail-closed aggregate completed at 14:16:23 UTC, a 21m51s full profile path including profile setup, caches, native builds, tests, diagnostics, cleanup, and aggregation. Release ran 21m42s with a 12m48s native build and 5m45s of E2E tests; OpenAI Debug ran 11m33s with a 7m54s native build and 47s of E2E tests. This misses the ten-minute target and is not one of the two required timing passes.

Both React Native artifact caches hit. Both DerivedData caches were absent (`derived_data_cache_classification=miss`, `app_reusable=false`, `app_reuse_reason=derived_data_absent`). Both profiles wrote manifests matching their pre- and post-build fingerprints, and the post-job cache steps completed. A later run must confirm remote DerivedData restoration before this state can be called warm. Main at `fe80a4e2744e5b64f0a0a45b55c0635f8cd0d3f7` subsequently added Simulator signing defaults and a CI check; that exact integrated head still needs required CI and cache classification.

## Storage reset timeout isolation

Run [37345244910](https://github.com/eunsoogi/orot/actions/runs/37345244910) on the previous PR head `c2caca7` failed the Release profile: five of eight cases passed and all three storage reset cases failed; OpenAI Debug passed 1/1. Both DerivedData caches missed. The first profile started at 17:13:28 UTC and the required aggregate failed at 17:46:40 UTC, a 33m12s path that is not a successful performance measurement.

The earlier main run `37332676393` showed a storage setup call to `device.clearKeychain()` still running after Jest's 120-second timeout. Its delayed completion then overlapped later cases in the same file. The failed cases in run `37345244910` and the main-run timeline do not establish the underlying Simulator Keychain stall cause.

The current candidate keeps an uninstall, Keychain clear, and install for the fresh-install and migration cases. The separate process-restart case reuses the first case's newly written records and only terminates and relaunches the app, avoiding a redundant second reset while retaining all three storage scenarios. A guard marks a reset unsafe when its test finishes while a Detox command remains pending, checks that state after each awaited Simulator command, and blocks later storage cases from using the shared device. Focused contract tests cover the delayed reset and preserve the three separate scenarios.

The first hosted run of the guard and v3 production cache, [37356091385](https://github.com/eunsoogi/orot/actions/runs/37356091385), used PR head `55dc1a6`. The production app job passed in 12m54s, classified its DerivedData cache as a miss (`app_reusable=false`, `reason=derived_data_absent`), wrote a matching manifest, passed the Simulator signing-default and OAuth package checks, built the standalone OAuth Simulator harness, and completed the cache post-step. Release passed 8/8 cases and OpenAI Debug passed 1/1; their Detox test steps took 330s and 37s, and both dedicated Simulators were deleted. The profile jobs took 18m22s and 17m50s. From the first profile job start (18:50:23Z) through fail-closed aggregate completion (19:12:10Z) was 21m47s, above the ten-minute target.

The full run failed Quality: its 102 CI, release, and quality tests had 101 passes and one failure. The remaining failure was a stale assertion that expected one scalar cache path after the workflow changed to a YAML block containing both production DerivedData and Pods. Local commit `d83fc23a` updates that assertion to require both paths and fixes two equivalent regex spellings rejected by lint. The test-only changes preserve the production build fingerprints; the local fingerprint command matched the values recorded by run 37356091385. This run does not prove a warm v3 cache hit or current-head required-check success. The next exact-head run must show `app_reusable=true` while signing, OAuth, all nine E2E cases, and Simulator cleanup pass. Two consecutive successful full paths under ten minutes on one implementation remain required; no speedup or timing acceptance is claimed.

The shared release suite later reproduced the reset deadline on [run 37356347024](https://github.com/eunsoogi/orot/actions/runs/37356347024), head `6b07a20`: uninstall took 21s, Keychain clearing 53s, and app installation 99s, so the default 120s test deadline expired before the reset and probe assertion completed. The current candidate gives only the two fresh-reset cases a four-minute test deadline; the probe visibility wait remains capped at 30s and the process-restart case keeps the shared 120s deadline. The guard latches an unsafe state in `afterEach` when a reset is still pending; later storage cases check that latch before using the shared device. It does not cancel a command already in flight or stop work that continues before `afterEach` runs. In run `37356347024`, installation completed before `afterEach`, so that trace does not show the guard latching or blocking later commands. This separate run does not change PR #75 cache or timing evidence; the new deadline and guard behavior still need hosted verification on the PR head.

## Exact-cache warm rerun

Attempt 2 of [run 37377582489](https://github.com/eunsoogi/orot/actions/runs/37377582489) on head `7f13076` passed the production/OAuth build and Quality. Both Detox profiles restored exact DerivedData manifests (`derived_data_cache_hit=true`, `app_reusable=true`) and skipped the Pods install and app build. OpenAI Debug passed 1/1 and deleted its dedicated Simulator. Release passed 7/8; the manual-appointments test exceeded Jest's 120-second deadline while exercising two app process restarts. Its Detox trace records `simctl terminate` calls lasting 25 and 44 seconds. The trace confirms simulator lifecycle delay, but does not establish a product defect or the underlying host cause. Release deleted its dedicated Simulator after the failure.

The Release profile started at 22:20:37Z and deleted its Simulator at 22:37:17Z, an E2E path of 16m40s. OpenAI Debug started at 22:20:46Z and deleted its Simulator at 22:30:28Z, a 9m42s path. This run failed and does not count toward the timing target.

The previous exact-cache candidate skipped Ruby and CocoaPods on a validated app hit, saving their measured setup time, but its cache fingerprint preceded CocoaPods' tracked Privacy manifest aggregation. The follow-up at that time installed Pods once before computing the full/native fingerprints; Ruby and CocoaPods setup remain in the warm path until hosted timing confirms whether the post-install cache can meet the target. The React Native archive restore remains before Pods, the DerivedData payload remains limited to the manifest and `Build/Products`, and the app build still runs on every cache miss. This is a correctness candidate; no speedup or ten-minute acceptance is claimed until current-head hosted runs supply measurements.

The first hosted run of that change, [37386831002](https://github.com/eunsoogi/orot/actions/runs/37386831002) on `f9f616e`, passed all five required jobs, Release 8/8, OpenAI Debug 1/1, and both Simulator deletions. It was a cold cache seed: both profiles reported `derived_data_cache_hit=false` and `app_reusable=false`, then wrote matching manifests and saved their caches. The first profile started at 23:18:25Z; the later Simulator deletion completed at 23:38:30Z, a 20m05s path. This is not a warm timing pass.

In the cold seed run, `Verify runner toolchain` took 3m00s in OpenAI Debug and 2m06s in Release after each profile requested Simulator boot. The verifier's `simctl list devices available` command is the only device-availability enumeration in that step; the later `bootstatus` wait took one second in each profile. Action logs do not expose command-level durations, so the enumeration was only a hypothesis for the delay.

Intermediate commit `4ff0bab` skipped that enumeration after boot. Its warm-cache run [37391215971](https://github.com/eunsoogi/orot/actions/runs/37391215971) passed all five required checks, restored exact caches in both profiles, passed Release 8/8 and OpenAI Debug 1/1, and deleted both dedicated Simulators. The verifier still took 3m10s in Release and 3m16s in OpenAI Debug. Release started at 23:55:48Z and the last Simulator deletion finished at 00:07:35Z, an 11m47s critical path. This disproves the narrower claim that the device-list command alone caused the slow step; its command-level trace remains unavailable.

That follow-up kept the verifier unchanged and moved it before dedicated Simulator preparation. The ordinary iOS Simulator Build job's verifier took eight seconds on the same hosted runner image without profile Simulator boot underway. Profile preparation still creates the exact model/runtime, and the later boot wait still gates E2E; cache preparation follows the verifier while Simulator startup proceeds. That ordering was later hosted but still missed the ten-minute target. The canceled attempt 2 of seed run 37386831002 never started either profile job; the cancellation reason is not exposed, so it is not a timing observation.

## Integrated-main follow-up: pnpm verification cache and transcription probe

Main advanced from `8e8f559` to `f0ba5ac` with the sleep-import implementation. Run [37401109308](https://github.com/eunsoogi/orot/actions/runs/37401109308) for that main head was still in progress when this update was prepared. The latest completed main observation remains [37393252372](https://github.com/eunsoogi/orot/actions/runs/37393252372) on `8e8f559`: Quality, the production/OAuth Simulator build and the existing nine Detox cases passed, but the cold native-build Detox job took 46m07s. That is not a comparable warm timing pass. PR #75 is now based on `f0ba5ac`; its first integrated candidate was `34a6024`. Run [37403059766](https://github.com/eunsoogi/orot/actions/runs/37403059766) passed Quality and was still running the three native profiles when this update was prepared, so it supplies no completed performance comparison.

The new candidate caches pnpm's `lockfile-verified.jsonl` record separately in the Quality, iOS Simulator Build and reusable Detox profile jobs. Its cache key includes runner OS/architecture, pinned pnpm version, lockfile, workspace policy, `.npmrc` and the root manifest. `PNPM_CONFIG_CACHE_DIR` points pnpm at that record while `PNPM_CONFIG_STORE_DIR` preserves the package store initialized by `setup-node`; the workflow still runs frozen installation. This targets the measured 3m31s lockfile-verification portion of the earlier 4m14.7s Release dependency install. The cache is a performance candidate only until a later hosted run shows a compatible restore and records its actual install duration.

The Detox DerivedData namespace is now v7 and archives the cache manifest plus `Build/Products`, rather than unrelated indexes and intermediate output. An exact cache is reusable only when the existing manifest checks and the app identity, platform, architecture, embedded bundle and digests all match; any miss or invalidation follows the normal build and test path. This reduces the payload while preserving fail-closed cache classification. The required nine-case measurement remains Release 8/8 plus OpenAI Debug 1/1.

The additional `transcription` profile has its own Release app, Simulator, cache and fail-closed 1-case aggregate because its Swift test flag changes native code. The first hosted PR run on `34a6024` passed Quality; its three native profile jobs were still running when this update was prepared. Review found that the clean-environment Detox config opened a different app path than the build and cache, so the local correction now aligns all three at `ios/build-detox-transcription`; the explicit local override documented in `docs/transcription.md` remains available. A fresh exact-head review and hosted verification are still required after this correction.

Report the original nine-case Release+OpenAI timing separately, and also record the complete required-check interval through transcription and aggregation; the separate scenario must not be used to change the nine-case denominator or omitted from the full CI timing. Its fixture adapter is synthetic; the Simulator probe does not establish output from Apple's live speech-recognition service. The corrected integrated worktree passed the frozen install, quality setup and 581-file inventory, lint, format, typecheck, unit tests, and the portable CI/release/quality suite (117/117); both the current-main-base and all-file LOC audits passed. Lint retains three existing bitwise warnings in `packages/rag/src/chunking.ts`. No local iOS build or Simulator run was performed. Hosted cache classification and the two consecutive under-ten-minute nine-case runs remain unproved, so no speedup or timing acceptance is claimed.

## 2026-10-06 transcription architecture-gate follow-up

Run [37404432252](https://github.com/eunsoogi/orot/actions/runs/37404432252) tested the remote PR head `0b529a4`, before the local architecture correction in `80f5bf2`. Quality and the production/OAuth Simulator build passed. Release passed 8/8 cases and OpenAI Debug passed 1/1. The transcription Xcode build completed, but its fail-closed architecture check expected `arm64` and found `x86_64 arm64`; the transcription test was skipped. All three profile jobs completed their dedicated Simulator deletion steps. This was a failed run on the previous head, not validation of `80f5bf2`.

The run began at 02:30:08Z and its final required-check aggregate failed at 03:00:39Z, an interval of 30m31s. The original nine-case path began with OpenAI Debug at 02:31:12Z and ended when Release deleted its Simulator at 03:00:01Z, an interval of 28m49s. The successful Release and OpenAI test steps took 365s and 43s respectively. These timings exceed the ten-minute target and do not count as timing passes.

The profile logs classified Release as a React Native archive hit and a DerivedData miss (`derived_data_absent`, `app_reusable=false`). OpenAI Debug was also a React Native archive hit; its DerivedData restore was `dependency-compatible`, but changed build inputs made the app non-reusable (`build_inputs_changed`). Transcription had a React Native archive miss and a DerivedData miss (`derived_data_absent`). These are the observed cache results for `0b529a4`; cache behavior on the corrected head remains unobserved.

Commit `80f5bf2` adds `ARCHS="$(uname -m)" ONLY_ACTIVE_ARCH=YES` to the transcription build command, matching the host architecture accepted by the existing validator. The focused routing test now checks those arguments. The exact-head strict review returned PASS against base `f0ba5ac`; the affected local suite passed 21/21 and the portable suite passed 117/117. The local root checks and LOC audits also passed, with no local Simulator build. This review and local proof do not establish hosted acceptance: `80f5bf2` still needs a fresh exact-head required-check run, and two consecutive successful original nine-case paths under ten minutes remain required before claiming the timing target.

## 2026-10-06 warm-cache trace and CocoaPods follow-up

Attempt 2 of [run 37407779153](https://github.com/eunsoogi/orot/actions/runs/37407779153) passed Quality, the production/OAuth Simulator build, Release, OpenAI Debug, Speech Transcription, the profile-summary aggregate, and the required Detox aggregate on PR head `b09a870`. Release passed 8/8 original E2E cases, OpenAI Debug passed 1/1, and all three dedicated profile Simulators were deleted. The original nine-case path began when OpenAI Debug started at 03:37:15Z and ended after Release deleted its Simulator at 03:59:13Z: 21m58s. The full required workflow interval was 03:37:07Z–03:59:42Z: 22m35s. Neither interval meets the ten-minute target.

Both original profiles restored exact, validated app caches (`app_reusable=true`) and skipped the Detox app build. Their React Native artifact caches also hit. CocoaPods installation still ran for 256s in Release and 189s in OpenAI Debug. The separate transcription profile ran its own 1/1 fixture-backed UI case and deleted its Simulator; its native speech-recognition result remained unobserved. This run proves those recorded checks and cache classifications only for `b09a870`; it does not prove a speedup or live speech-recognition output.

The Release and OpenAI DerivedData keys used the same runner/toolchain and source fingerprints (`native=c9693eed`, `build=1b6992be`) with their respective profile names. Release restored a 50.1 MB archive in about 4.4s and its manifest-validation step took 15.5s; OpenAI Debug restored a 69.8 MB archive in about 3.5s and validation took 7.2s. Both validations classified the cache as exact and the app as reusable. The workflow began at 03:37:07Z, OpenAI Debug started at 03:37:15Z, and Release started at 03:39:50Z, 2m35s later. These timestamps establish a profile-start gap; the logs do not establish its cause.

At that stage, the local follow-up added a pre-Pods cache for `apps/mobile/ios/Pods`, `apps/mobile/ios/build/generated`, and `~/Library/Caches/CocoaPods`, keyed by the pinned runner/toolchain and source fingerprints. The required `pod install` remained unconditional. The post-Pods fingerprint and fail-closed app-cache validation remained in place so CocoaPods' tracked project and privacy-manifest outputs were checked after installation. That candidate still needed exact-head review and hosted cache-restore and timing evidence; the ten-minute target required two consecutive successful original nine-case paths on one implementation, and no timing acceptance had been claimed.

## 2026-10-06 terminal transcription probe and runtime follow-up

Run [37413914168](https://github.com/eunsoogi/orot/actions/runs/37413914168) on PR head `c690ed8`, before integrating main at `a00549f`, passed Quality and the production/OAuth Simulator build. Release passed 8/8 cases and OpenAI Debug passed 1/1. The transcription profile correctly failed its native speech gate: iOS 27.0 reported `modelInstalled=false` and `provider_unavailable / SPEECH_RECOGNITION_FAILED: Failed to initialize recognizer`. Its synthetic review UI evidence passed separately and was not treated as native transcription output. All three dedicated Simulators were deleted. This remains a failed required-check run.

The original nine-case path began with OpenAI Debug at 04:29:08Z and ended after Release deleted its Simulator at about 04:49:43Z: 20m35s. The complete required workflow ran from 04:29:07Z through aggregate failure at 04:50:47Z: 21m40s. Release, OpenAI Debug, and transcription E2E steps took 355s, 46s, and 112s. Their frozen dependency installs took 6m05s, 4m55s, and 3m56s; CocoaPods installation took 196s, 348s, and 242s. All three React Native archive caches hit and their exact DerivedData app caches validated, while all three CocoaPods intermediate caches missed. These cache hits skipped native app builds, but the recorded critical paths still missed the ten-minute target.

The separate local probe log `/tmp/orot-issue15-detox-final.log` recorded three measured synthetic-audio cases on iOS 26.2 build 23C54 with `dictation_transcriber`, `ko_KR`, and `modelInstalled=true`. That local measurement motivated selecting the supported `macos-26`/Xcode 26.2 image and iPhone 17 Pro only for transcription. It does not replace hosted evidence. The local candidate now requires the final native report to reach `measured` or an explicit unsupported state within a 120-second deadline; a persistent `running` report and an unresponsive report read fail, while cleanup remains reachable. Provider failures remain failures. The cache fingerprint excludes the Node-only transcription helper and its Jest specification but still keys the app bundle on real JavaScript entry and app source changes. Main at `a00549f` is integrated, so its native E5 changes are part of the next candidate's cache inputs.

The integrated candidate's focused cache, Simulator lifecycle, toolchain, and workflow contract suites passed 20/20; the focused helper Jest suite passed 10/10. Root frozen install, quality setup/inventory, lint, format check, typecheck, and unit tests passed. The post-integration LOC audit passed for all 79 current paths, and shell/Node syntax checks passed. No local native build or Simulator run was performed for this candidate. It still needs exact-head hosted checks and a fresh strict review. Two consecutive successful original nine-case paths under ten minutes remain outstanding; no speedup is claimed.

## 2026-10-06 runner toolchain follow-up

Run [37418184430](https://github.com/eunsoogi/orot/actions/runs/37418184430) on PR head `aa5c69a` failed its required checks. Quality and the production/OAuth Simulator build stopped at toolchain preflight because the resolved Simulator defaults were shell-local and did not reach the Node process that reads the available runtimes and devices. The transcription profile also stopped before Simulator preparation: the `macos-26` runner reported macOS `26.6.2`, while the verifier required `26.6.1`. Release passed 8/8 cases and OpenAI Debug passed 1/1, but transcription did not run and the fail-closed aggregate remained failed.

The original nine-case interval began when Release started at 05:22:21Z and ended after its Simulator cleanup at about 05:40:27Z: 18m06s. The complete required workflow ran from 05:22:13Z through the aggregate failure at 05:41:07Z: 18m54s. Release and OpenAI Debug each hit the React Native artifact cache and missed the CocoaPods-intermediate and DerivedData caches, so each rebuilt its app. Their frozen dependency installs took 184s and 206s, Pods installs 250s and 158s, native builds 342s and 334s, and E2E steps 200s and 35s, respectively. The Release and OpenAI Simulators were deleted after their runs. Neither timing interval meets the ten-minute target.

That local candidate exported the resolved Simulator defaults before invoking the Node-based inventory check, accepted the rolling macOS `26.x` family for the `macos-26` label, and passed the verified macOS patch through cache keys, cache-manifest preparation, manifest writing, and diagnostics. Release and OpenAI retained their existing v7 cache namespace and exact `27.0` expectation. The R9 manifest-consumer repair was still local at that point; run 37421411426 did not reach manifest writing for transcription.

## 2026-10-06 integrated-head run 37421411426

Run [37421411426](https://github.com/eunsoogi/orot/actions/runs/37421411426) on PR head `e786bf0` passed Quality, the iOS Simulator Build, Release 8/8, and OpenAI Debug 1/1. The required transcription job failed while compiling the app with Xcode 26.2 because `ResponsesEventNormalizer(requestID:)` was inaccessible from `ChatGPTResponsesClient.swift`; the transcription E2E case did not run. Its DerivedData cache was a miss, and the failed build skipped manifest writing and cache save. This run therefore does not verify the local patch-level manifest-consumer repair.

Release and OpenAI both hit their React Native, CocoaPods, and exact DerivedData app caches, so their native app build steps were skipped. Release E2E ran from 06:10:08Z to 06:16:07Z and passed 8/8; OpenAI Debug ran from 06:09:33Z to 06:10:09Z and passed 1/1. The original nine-case interval began when Release started at 06:00:40Z and ended after its Simulator deletion at 06:16:29Z: 15m49s. The required aggregate failed at 06:16:56Z, 16m16s after the first profile started. The timing target remains unmet, and this failed required run is not a successful timing sample.

## 2026-10-06 integrated-head run 37424257570

Run [37424257570](https://github.com/eunsoogi/orot/actions/runs/37424257570) on PR head `aa0d62a` passed Quality, the production/OAuth Simulator build, Release 8/8, OpenAI Debug 1/1, Speech Transcription, both profile aggregates, and the required Detox aggregate. All three dedicated profile Simulators were deleted. Xcode 26.2 compiled the transcription app successfully, including the explicit `ResponsesEventNormalizer(requestID:)` initializer. The strict exact-head review passed with no blocking findings.

The original-nine profile jobs began at OpenAI Debug 06:32:08Z and Release Simulator cleanup completed at 07:01:22Z: 29m14s. The first original-profile prerequisite, OpenAI's frozen workspace install, began at 06:33:25Z; from that prerequisite through Release cleanup the interval was 27m57s. The full required workflow ran from 06:31:57Z through the final Detox aggregate at 07:01:57Z: 30m00s. OpenAI, transcription, and Release jobs started at 06:32:08Z, 06:35:35Z, and 06:38:33Z, so their observed start offsets were 3m27s and 6m25s. GitHub's job readback did not include `queued_at`; these timestamps show the offsets but not their cause. This run does not meet the ten-minute target.

Release and OpenAI reused their React Native artifact archives but missed both CocoaPods-intermediate and DerivedData caches; transcription missed all three caches. Each profile's pre-build fingerprint matched the post-Pods value. After a successful native app build, its manifest was written and cached. Workspace installs took 272s in Release, 387s in OpenAI, and 100s in transcription; Pods installs took 359s, 233s, and 201s; native builds took 384s, 375s, and 532s. Release's eight cases took 211s, OpenAI's one case 38s, and transcription's one case 144s. The app caches were cold on this head and the successful builds seeded exact app outputs for subsequent runs.

The hosted transcription probe reached terminal `measured` status for three synthetic-audio inputs using `apple-on-device-speech` and `dictation_transcriber` on iOS 26.2. Initial availability reported `modelInstalled=false` with status `available`. The medication-name case did not match (character error rate 0.1875); the number case matched the number but had character error rate 0.4615; the negation case matched after normalization. This is native runtime evidence for those inputs, not a general transcription-accuracy claim.

The Swift-only provider fix changed tracked files under `packages`, which the broad app and native-dependency fingerprints include. The CocoaPods cache key also depended on both broad fingerprints, so it missed despite no package-manager lock or Podfile dependency change. That follow-up gave CocoaPods a dedicated dependency/build-integration fingerprint while preserving broad app fingerprints for DerivedData reuse. It retains the mobile manifest (including FTS5 settings), Podfile and lockfile, package manifests/autolinking metadata, and tracked CocoaPods integration inputs; `pod install` and post-install input verification remain unconditional. Run 37429841253 showed cold v2 misses for Release and OpenAI, then saved the shared Xcode 27 key; its retry later saved a separate Xcode 26.2 transcription key. Attempt 3 measured exact warm-cache restore costs but still missed the time target, as recorded below. No timing acceptance is claimed until two consecutive same-implementation original-nine paths pass under ten minutes.

Main at `f710b1e` is now integrated with `op-sqlite.fts5=true` and its updated `Podfile.lock` checksum. The new fixture models both input changes and verifies that CocoaPods and app-build fingerprints change, while Swift-source-only edits continue to reuse the CocoaPods dependency fingerprint. This is local cache-identity proof; the post-merge hosted run must confirm the actual cache result.

## 2026-10-06 integrated-head run 37429841253

Run [37429841253](https://github.com/eunsoogi/orot/actions/runs/37429841253) on PR head dee9096 completed successfully on attempt 2; attempt 1 remains a failed attempt. Attempt 1 passed Quality, the production/OAuth Simulator build, Release 8/8, and OpenAI Debug 1/1. The Release profile started at 07:30:46Z and deleted its Simulator at 07:52:36Z, an original-nine path of 21m50s. Release and OpenAI workspace installs took 279s and 146s, CocoaPods installs 207s and 242s, native app builds 485s and 340s, and E2E steps 218.5s and 35.2s. This path does not meet the ten-minute target.

Release and OpenAI missed their React Native, CocoaPods-intermediate, and DerivedData caches, then wrote matching app manifests after successful builds. OpenAI saved the shared Xcode 27 CocoaPods key, sized 634,578,194 bytes; Release's concurrent save lost the key reservation. The transcription attempt 1 failed before its CocoaPods step, so it produced no app or transcription result. The attempt 2 retry then missed all three transcription caches, built the app, passed the synthetic transcription E2E, and saved its React Native archive (251,112,497 bytes), CocoaPods cache (546,133,010 bytes), and DerivedData app (90,200,479 bytes). Attempt 3 later measured exact cache restores and is described below.

In attempt 1, Compute React Native artifact fingerprint ran from 07:30:36Z to 07:32:07Z and reported a timeout after its configured one-minute limit. The command was node scripts/ci/detox-cache-fingerprint-cli.mjs --react-native-artifacts-only; it produced no script output before timing out. A bounded local run of the full command took 36ms, and its git ls-files subprocess took 9ms. On attempt 2 the same hosted command completed in five seconds; the same step also passed in the Release and OpenAI jobs and in an earlier transcription run. The timed-out operation inside the first attempt is unknown, so no timeout change was made.

The successful transcription retry reached measured status for three synthetic-audio inputs on iOS 26.2, with initial modelInstalled=false and availability status available. The medication-name case did not match (character error rate 0.1875); the number was recognized but the transcript character error rate was 0.4615; the negation case matched after normalization. This is runtime evidence for those synthetic inputs, not a general accuracy claim. Attempt 2 reran the failed transcription and aggregate jobs while retaining prior successful Release, OpenAI, Quality, and production/OAuth results. The overall workflow passed, but its original-nine measurement remains 21m50s and does not count toward timing acceptance.

### Attempt 3: full warm-cache rerun

Attempt 3 started at 08:29:16Z. The Release and OpenAI profile jobs started at 08:29:28Z, and the final aggregate completed at 08:41:52Z: 12m24s from the first profile-job start, or 12m36s from workflow start. The original-nine path ended after OpenAI deleted its Simulator at 08:41:30Z, 12m02s after the first profile start. Quality, the production/OAuth job, Release (8/8), OpenAI Debug (1/1), transcription, profile-summary validation, and the fail-closed aggregate all passed; every dedicated Simulator was deleted.

All three Detox profiles reported exact React Native, CocoaPods-intermediate, and DerivedData cache hits. Their native app-build steps were skipped after the manifests validated. Release and OpenAI's frozen workspace installs still materialized all 987 packages from the local store with zero downloads and took 3m52s and 6m08s; transcription took 64s. Release's React Native/CocoaPods/DerivedData restores took 14s/72s/7s, followed by a 55s Pods install. OpenAI's restores took 9s/66s/12s, followed by an 85s Pods install. The eight Release assertions took 207s, and the OpenAI assertion took 42s. Transcription ran its synthetic-audio measurement on iOS 26.2 and ended `measured`; its E2E step took 192s. These measurements do not meet the ten-minute target.

Each profile created and boot-requested its dedicated Simulator before the frozen workspace install. By the later Simulator wait step, all three devices were already booted. This run does not isolate whether that overlap caused slower dependency materialization. The next candidate moves the asynchronous boot request after the frozen install, then overlaps boot with framework, cache, and Pods preparation. The lockfile verification, frozen install, single unconditional `pod install`, app-cache invalidation boundaries, E2E cases, diagnostics, and Simulator cleanup remain in place; hosted timing will determine whether the ordering change helps.

## 2026-10-06 framework-cache diagnosis

Run [37441249626](https://github.com/eunsoogi/orot/actions/runs/37441249626) on PR head `6527f39` passed Quality, the production/OAuth Simulator build, all three Detox profiles, both profile aggregates, and the required Detox aggregate. Release passed 8/8 original cases, OpenAI Debug 1/1, and the separate transcription profile 1/1; all three dedicated Simulators were deleted. The original nine-case Release/OpenAI path started with Release at 09:11:35Z and ended when its profile job completed at 09:29:21Z (17m46s); its dedicated Simulator had been deleted at 09:29:09Z (17m34s). The complete required workflow ran from the first job start at 09:11:32Z to the final aggregate at 09:29:34Z (18m02s). Both intervals miss the ten-minute target.

All profiles restored exact React Native, CocoaPods, and DerivedData caches, and skipped their native app builds. The Detox framework-cache steps still took 6m29s in Release, 3m52s in OpenAI Debug, and 2m21s in transcription. The eight Release assertions took 313s; OpenAI Debug took 40s, and transcription took 192s. The GitHub `Wait for dedicated Detox Simulator` steps took 2s in Release, 3s in OpenAI Debug, and 6s in transcription. The latest Release job log starts the framework-cache wrapper at 09:12:57Z, records Detox's first cache-build message at 09:17:40Z, starts archive extraction at 09:19:10Z, and finishes both extractions at 09:19:17Z. The first 4m43s and the following 89s are not attributed to a measured subprocess; the extraction messages themselves span about six seconds. Process, CPU, and disk measurements for that step were not collected.

The local follow-up caches only Detox's `~/Library/Detox/ios/framework` and `~/Library/Detox/ios/xcuitest-runner` output directories. Its exact key includes runner OS and architecture, verified macOS version, a SHA-256 of the complete validated `xcodebuild -version` output, and `pnpm-lock.yaml`; it has no restore-key fallback. Detox derives those internal output directories from its package version and complete Xcode version text. An exact cache hit skips the existing framework-cache command; a miss still runs it. The hit and Xcode fingerprint are recorded with the other native-cache evidence, and the cache action saves a miss only after the profile job succeeds. Local tests cover the full Xcode fingerprint, exact-key/no-prefix workflow contract, cold command path, and artifact recording. This candidate has no hosted cache or timing proof yet; two consecutive successful same-implementation paths under ten minutes remain required.

## 2026-10-06 warm framework-cache rerun

Run [37449664052, attempt 2](https://github.com/eunsoogi/orot/actions/runs/37449664052/attempts/2) reran the full workflow on PR head `61ac1f5`. Quality and the production/OAuth Simulator build passed. Release passed all 8 cases, transcription passed its 1 synthetic runtime case, and all three dedicated Simulators were deleted. OpenAI Debug failed before its E2E at `Compute React Native artifact fingerprint`; the one-minute step timed out without script output, so its E2E and the fail-closed profile aggregates failed. The overall run is unsuccessful and cannot count as a timing sample.

The Release profile started at 10:43:48Z and deleted its Simulator at 10:55:37Z (11m49s). The full run began with the iOS build job at 10:43:45Z and ended at the Detox aggregate at 10:57:05Z (13m20s). Neither interval qualifies for the ten-minute target. Release's exact framework cache restored in 3m32s, its React Native archive in 27s, CocoaPods intermediates in 49s, and DerivedData in about 4s; the app build was skipped and Release E2E took 202s. The transcription framework cache restored in 1m, its React Native archive in 72s, CocoaPods intermediates in 21s, and DerivedData in about 3s; its app build was skipped and E2E took 163s. The OpenAI framework cache also hit and skipped the builder, but its later lockfile fingerprint step timed out. Cache-action and step elapsed times do not identify the runner-side delay; CPU and disk measurements for these restores were not collected.

## 2026-10-06 exact-head fingerprint follow-up

Run [37456059938](https://github.com/eunsoogi/orot/actions/runs/37456059938) on PR head `4d846f3` passed Quality and the production/OAuth Simulator build. Release passed 8/8 cases and transcription passed its 1 synthetic runtime case; all three dedicated Simulators were deleted. OpenAI Debug timed out at `Compute React Native artifact fingerprint` before its E2E, so the profile summaries and required Detox aggregate failed. This unsuccessful run is not a timing sample.

The first profile job started at 11:23:27Z and the Detox aggregate ended at 11:47:29Z (24m02s). Release deleted its Simulator at 11:45:15Z (21m48s from its profile start), and transcription deleted its Simulator at 11:47:01Z (19m19s from its profile start). Both successful profiles restored Detox framework, React Native archive, and CocoaPods caches, but each recorded a DerivedData miss (`derived_data_absent`); the Release and transcription app-build steps took 8m11s and 9m49s. Their E2E steps took 234s and 181s respectively.

The OpenAI fingerprint command produced no script output. Its shell environment was logged at 11:31:04Z and Actions reported the one-minute step timeout at 11:31:41Z. The same local fingerprint command completed in 0.03s, which does not explain the hosted delay. CPU and disk sampling was disabled for this run, so the runner-side cause remains unknown. No speedup or successful timing result is claimed.

## 2026-10-07 pre-Pods profile-cache fast path

At this point, the v8 workflow candidate fingerprinted build inputs and restored the profile DerivedData cache before Detox framework, React Native artifact, Ruby, and CocoaPods preparation. Cache namespace `v8` contained each profile's app products and manifest together with Detox's framework and XCUITest-runner outputs. Manifest schema `5` checked the toolchain and pre-Pods source fingerprints, the built app, both Detox output trees, and tracked CocoaPods integration outputs. Only a fully validated exact manifest reused the app and Detox outputs; changed inputs, missing or corrupt outputs, and older manifests fell back to the existing framework, dependency, and app-build steps. Invalid cached outputs were cleared before fallback.

The frozen workspace install, dedicated Simulator preparation and wait, selected E2E cases, diagnostics, report upload, Simulator deletion, production build, standalone OAuth harness, and fail-closed profile aggregation remained in the workflow. The cache hit skipped repeated native preparation and compilation, but the v8 candidate did not skip Simulator preparation or the E2E run.

The local portable CI/release/quality suite passed 148/148 tests. Required workspace checks, changed-file and all-file LOC checks, and diff whitespace validation passed. These checks validate the local candidate only; the v8/schema-5 path had no completed successful hosted run when this section was first written. Cache classification, cleanup, test counts, required checks, and comparable end-to-end timing remained unverified remotely. No speedup was claimed; acceptance still requires two consecutive successful comparable paths under ten minutes on the same implementation.

## 2026-10-07 production and cache-identity corrections

Run [37493123171](https://github.com/eunsoogi/orot/actions/runs/37493123171) on PR head `501260e` passed Quality but failed the production/OAuth job and two Detox profile jobs. Production manifest writing failed with `detox_framework_root_missing`; the Simulator defaults/OAuth package checks and standalone OAuth harness were skipped. Release and OpenAI Debug each timed out at `Compute stable Detox cache fingerprints` after the configured one-minute limit, without script output. Transcription passed its synthetic 1/1 probe. The full required run took 22m09s and failed, so it is not a successful timing sample. A local replay took 114ms, which does not explain the hosted delay; the operation's runner-side cause remains unknown.

The follow-up candidate uses profile-cache namespace `v9` and manifest schema `6`. Its cache key and manifest include a SHA-256 of the complete validated `xcodebuild -version` output, because Detox's extracted framework path uses that identity. Production app manifests do not require Detox framework or XCUITest-runner outputs, and production cache validation/invalidation no longer inspects or clears those separate artifacts. The fingerprint, prepare, and manifest-write steps have five-minute limits after the one-minute hosted timeouts; its next hosted run must show their actual duration and whether the larger bound resolves the failure.

The new production-without-Detox-artifacts and Xcode-build-change regressions passed with the affected cache/workflow suite (30/30). The first hosted run on this corrected head is recorded below. No speedup is claimed, and the two consecutive successful comparable paths under ten minutes remain outstanding.

The CI already fans out Quality, the production/OAuth Simulator build, and three independent Detox profile jobs; profile-summary and required Detox aggregation run after all three profiles. In run 37493123171, OpenAI Debug and transcription started at 16:07:06Z and 16:07:08Z, while Release started at 16:10:46Z. Release and OpenAI Debug failed in cache fingerprinting before their test steps; transcription missed its app cache, spent 11m06s in the native build, and then ran its 1/1 probe. This failed run does not show that serial scenario execution is the remaining bottleneck. If the corrected exact-cache path still exceeds ten minutes in the E2E step, scenario-level sharding can be measured while retaining all nine oracles, fail-closed aggregation, and the full first-prerequisite-to-cleanup interval.

## 2026-10-07 corrected-cache cold run

Run [37503657957](https://github.com/eunsoogi/orot/actions/runs/37503657957) passed Quality, the production/OAuth Simulator build, Release (8/8 original cases), OpenAI Debug (1/1 original case), Speech Transcription (1/1 separate case), profile-summary validation, and the required Detox aggregate on PR head `5672f1d`. Each dedicated profile Simulator was deleted. This run verifies the production fallback and complete Xcode identity correction on that pre-integration head; it does not verify the later merge of main at `fc1fd84`.

All three profiles hit the Detox framework and CocoaPods-intermediate caches. React Native artifact archives missed, and each DerivedData cache was classified `miss` with `reason=derived_data_absent` and `app_reusable=false`; each successful native build then wrote a matching manifest.

After main was merged at `fc1fd84`, a local `--derived-data-only` fingerprint read on the integrated tree reported build-input SHA `c423a14e` and native-dependency SHA `100f5744` across 590 tracked inputs. Run 37503657957 recorded `1fda1a10` and `a1a48c87` respectively. The old run's app cache therefore does not establish reuse for the integrated sources; this local comparison predicts input drift, while the integrated hosted cache classification remains to be observed.

| Profile | Native app build | E2E step | Result |
| ------- | ---------------: | -------: | ------ |
| Release | 435s | 284s | 8/8 passed |
| OpenAI Debug | 701s | 63s | 1/1 passed |
| Speech Transcription | 591s | 217s | 1/1 passed |

The original nine-case path began with the OpenAI Debug profile at 17:27:24Z and ended after Release deleted its Simulator at 18:01:17Z, an elapsed 33m53s. The full required-workflow interval ran from the first Quality job at 17:27:25Z through the final required aggregate at 18:02:06Z, an elapsed 34m41s. The 14m32s from the first original E2E step to the last original-profile cleanup excludes native builds and setup, so it is not the acceptance interval. Neither measured full interval meets ten minutes; this cold-cache run is not a timing pass and establishes no speedup. Two consecutive successful warm runs on the same integrated implementation remain required.

## 2026-10-07 PR #129 first hosted run

Run [37586928599](https://github.com/eunsoogi/orot/actions/runs/37586928599), attempt 1, succeeded on `a8ac364bfb79707c460a1c494042b1ea04337071` with PR base `500854e5de743ff57a358ab675f794f5af1e53c2`. Quality, production/OAuth, all three Detox profiles, profile-summary validation, and the required `Detox iOS E2E` aggregate passed. The profile logs report Release 8/8 and OpenAI Debug 1/1, preserving the original nine-case count. Speech Transcription passed its separate synthetic 1/1 case; it is additional coverage and does not establish live Apple Speech behavior.

All timestamps below are UTC. GitHub job and step timestamps provide elapsed seconds, including step overhead; they are not the command-only measurements from profile artifacts.

| Profile | Hosted runner | Job | Fingerprint step | Native app build step | E2E step | Dedicated Simulator deletion |
| ------- | ------------- | --: | ---------------: | --------------------: | -------: | ---------------------------: |
| Release | 1000071829 | 975s | 68s | 354s | 196s | 6s |
| OpenAI Debug | 1000071726 | 447s | 69s | skipped | 71s | 14s |
| Speech Transcription | 1000071615 | 603s | 54s | skipped | 281s | 7s |

The profile toolchain checks verified macOS 27.0, Xcode 27.0, iOS Simulator SDK/runtime 27.0, and iPhone 18 Pro for Release and OpenAI Debug. Speech Transcription used macOS 26.6.2, Xcode 26.2, iOS Simulator SDK/runtime 26.2, and iPhone 17 Pro. All three verified Node 22.23.2 and pnpm 12.3.4. A subsequent comparison must retain these per-profile toolchain distinctions instead of comparing the profiles as equivalent runners.

Release classified its DerivedData cache as `miss`, with `reason=derived_data_absent`, and performed the native build. OpenAI Debug and Speech Transcription each classified DerivedData as `exact`, with `reason=manifest_matches`, and skipped the native build. The production job took 341s and its fingerprint step took 1s. Different runners and cache states prevent treating these durations as a controlled before/after comparison.

The full required-workflow interval began with Quality at 08:12:25Z and ended with the required aggregate at 09:23:55Z: **71m30s**. The original nine-case profile interval began with OpenAI Debug at 08:50:09Z and ended with Release Simulator deletion at 09:23:25Z: **33m16s**. Neither interval meets ten minutes. Workflow creation at 07:22:32Z preceded the first required job by 49m53s; creation through aggregate completion took 121m23s. This additional scheduling delay is recorded separately and does not shorten the acceptance interval.

This is one successful hosted run of the implementation, with mixed cache states. It establishes no measured speedup and supplies no qualifying consecutive under-ten-minute pair. Two comparable hosted runs on the same final implementation, including runner/toolchain identity, cache classification, stage and total timing, remain required. Exact-final-head independent strict review and required checks must also be confirmed after any subsequent change. Issue #74 remains open and PR #129 remains Draft; this evidence does not authorize merge.

## 2026-10-07 post-PR #132 main observation

Run [37618963870](https://github.com/eunsoogi/orot/actions/runs/37618963870), attempt 1, was a successful `push` run on main `0cb45603c88ff51dd26d9136daf7606e88df83dd` after PR #132 merged. All eight jobs passed, including Linux quality, the unchanged required `Quality` aggregate, production/OAuth, three Detox profiles, profile-summary validation, and required `Detox iOS E2E`. This observes the new main baseline; it is not a run of PR #129's final implementation or one of its required controlled consecutive samples.

GitHub job/step elapsed times below include step overhead. All timestamps are UTC.

| Profile | Hosted runner | Job | Fingerprint step | CocoaPods installation | Native app build step | E2E step | Diagnostics | Simulator deletion |
| ------- | ------------- | --: | ---------------: | ---------------------: | --------------------: | -------: | ----------: | -----------------: |
| Release | 1000072187 | 1746s | 140s | 264s | 721s | 314s | 7s | 10s |
| OpenAI Debug | 1000072184 | 1621s | 181s | 427s | 567s | 43s | 3s | 7s |
| Speech Transcription | 1000072186 | 1550s | 68s | 148s | 761s | 183s | 4s | 7s |

All three profiles classified DerivedData as `miss`, `reason=derived_data_absent`, `app_reusable=false`, and performed native app builds. Their Detox framework build steps were skipped; a skipped framework build does not establish a reusable app product. Release and OpenAI verified macOS/Xcode/iOS SDK/runtime 27.0 with iPhone 18 Pro, while Speech verified macOS 26.6.2, Xcode/iOS SDK/runtime 26.2 with iPhone 17 Pro. All verified Node 22.23.2 and pnpm 12.3.4. Profile toolchain differences and absent app products must remain explicit in subsequent comparisons.

Production/OAuth ran on runner 1000072183 and passed in 554s. Its DerivedData was also absent: CocoaPods installation took 74s, native app build 182s, OAuth package verification 110s, and standalone OAuth harness build 98s. Linux Quality ran on runner 1000072185, Ubuntu 24.04.5, Node 22.23.2, pnpm 12.3.4, and Ruby 4.0.7. It passed in 304s, including 181s installing pinned quality tools after a quality-tool cache miss; the log confirms cache storage afterward. The required `Quality` aggregate took 11s, profile-summary validation 5s, and required Detox aggregation 3s.

The profile logs report Release 8/8, OpenAI Debug 1/1, and separate synthetic Speech 1/1; all profile diagnostics and dedicated Simulator deletion steps succeeded. This preserves the observed original nine-case count without treating the additional synthetic Speech case as live Apple Speech evidence.

The full required-workflow interval starts at the earliest required prerequisite, Linux Quality at 12:09:05Z, and ends at the required Detox aggregate at 12:38:28Z: **29m23s (1763s)**. Starting at the later `Quality` aggregate would omit required work. Workflow creation at 12:09:03Z precedes that start by 2s; creation through aggregation is 29m25s. This cache-miss main run exceeds ten minutes and establishes no controlled speedup. PR #129 still needs the new baseline integration when its remote execution slot is assigned, two comparable successful hosted runs below ten minutes on the same implementation, and independent strict review plus required checks on its exact final head. The extra performance goal remains distinct from the previously deferred PR #75 release gate. Issue #74 stays open and PR #129 stays Draft; no merge is authorized by this observation.

## 2026-10-07 PR #129 cache-key follow-up

Run [37627630691](https://github.com/eunsoogi/orot/actions/runs/37627630691) completed unsuccessfully on PR head `8bb22837e5d2671f22e37db8c0cd7f626ed6b8a3`. Release passed 8/8 original cases and OpenAI Debug passed 1/1, but Speech Transcription failed during CocoaPods project generation, the profile-summary and required Detox aggregates failed, Quality failed two stale cache-key expectations, and the separate iOS Simulator Build stopped at the macOS preflight (`expected 27.0, got 27.0.1`). The first required job started at 13:19:52Z and the required Detox aggregate ended at 13:48:51Z: **28m59s**. This is a failed run, not a timing pass.

Release used macOS 27.0, Xcode and iOS Simulator SDK 27.0, Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, and CocoaPods 1.17.0. Its new `orot-detox-app-product-v10` cache was a cold miss, so DerivedData was absent and `app_reusable=false`; the 11m58s native app build ran, passed, and saved a 28.7 MB app-product cache. Its fingerprint step took 181s and E2E took 270s. CocoaPods intermediates were an exact cache hit (`d31814567fd95d53d7e7d101f727078ababa6399f9758aa1ea8d2513edf3c22c`, 634,638,974 bytes); the subsequent Pod install completed successfully in 146s. The Release profile job took 28m32s. OpenAI Debug passed in 19m01s. These mixed outcomes and cold app-cache state are not comparable to a warm candidate run.

The local test-only follow-up at `ceea0a7835d1d2b68fae6305a971db6fca070181` updates the two stale `v9` assertions to `v10`. Existing workflow tests still check the cached app bundle and manifest, Detox runtime artifacts, native/build fingerprints, excluded Xcode intermediates, and separation of production and profile DerivedData roots. Frozen install, quality setup and inventory, lint, formatting, typecheck, unit tests, the complete `scripts/ci/tests` suite, LOC, and whitespace checks passed locally. The `v10` correction is now on remote PR head `50f43d59238c81153fcd64962728242464b966d7`. Exact-head run 37638022874 passed Quality Linux and the required Quality aggregate, but Release and OpenAI Debug failed with no runner metadata and zero steps, so full hosted verification remains incomplete.

## CocoaPods null-byte failure: current evidence and scope

The failing PR #129 Speech job hit its CocoaPods cache with input fingerprint `d31814567fd95d53d7e7d101f727078ababa6399f9758aa1ea8d2513edf3c22c` and restored 546,116,710 bytes. It then failed with `ArgumentError - path name contains null byte` while generating the Pods project. The stack ends at CocoaPods 1.17.0 `Pod::Project#group_for_path_in_group`, called by `add_file_reference` from `FileReferencesInstaller`. PR #135 independently reproduced the same stack in Release after a hit on the same fingerprint and 634,638,974-byte cache. The PR #129 Release job had a hit on that same input fingerprint and installed Pods successfully, so cache-hit status is observed but does not establish that the cache caused the failure.

CocoaPods 1.17.0 computes `base_path = common_path(paths)` for local pods whose file structure it preserves, then calls `base_path.realdirpath` while creating Xcode groups ([file-reference installer](https://github.com/CocoaPods/CocoaPods/blob/1.17.0/lib/cocoapods/installer/xcode/pods_project_generator/file_references_installer.rb#L1287-L1309), [project path handling](https://github.com/CocoaPods/CocoaPods/blob/1.17.0/lib/cocoapods/project.rb#L2034-L2050)). Orot's lockfile contains `React-utils`, and `apps/mobile/node_modules/react-native` is a pnpm symlink. Open upstream reports describe the same stack in a pnpm React Native monorepo; one reports a `React-utils/OnScopeExit.h` path beneath a pnpm symlink, but that is another project's report, not this run's observed path ([CocoaPods #12866](https://github.com/CocoaPods/CocoaPods/issues/12866), [CocoaPods #12798](https://github.com/CocoaPods/CocoaPods/issues/12798)).

The Orot logs do not print the failing pod, file-accessor key, `absolute_pathname`, or `base_path`, so the exact path containing the NUL byte remains unknown. The evidence locates the failure at CocoaPods path canonicalization for preserved local-pod groups; it does not prove whether the NUL originates in a path value, the pnpm symlink layout, or a CocoaPods/Ruby interaction. The matching cache fingerprint across success and failure also means cache corruption is not established.

The smallest useful next diagnostic is opt-in logging around the failing file-reference call that records the pod, accessor key, path values with escaped bytes, and group real path, then rethrows the original error. If it confirms the pnpm symlink path pattern, evaluate a narrow compatibility patch that normalizes only that affected path; the `cleanpath` workaround discussed in #12798 is community evidence, not a maintainer fix. Do not add an unconditional path rewrite, dependency downgrade, or retry. The separate diagnosis is tracked in [issue #136](https://github.com/eunsoogi/orot/issues/136); any implementation needs an accepted owner and its own PR. No Podfile/local CocoaPods shim change has been made in #129. The null-byte error was previously observed on PR #129 head `8bb22837e5d2671f22e37db8c0cd7f626ed6b8a3` in run 37627630691. On head `50f43d59238c81153fcd64962728242464b966d7`, the Speech profile CocoaPods installation passed in run 37638022874. Release and OpenAI Debug had no runner metadata or steps in that attempt, so their CocoaPods state is unobserved. The later run 37663394033 passed all three profile jobs on head `801a4b60899672e119c28bd7c2e839f905e341bf`; its per-step CocoaPods logs were not reviewed for this diagnosis, and it ran before the subsequent main updates. The failure remains unexplained; no cache-corruption cause is established.

Issue #74's current body says its earlier time ceiling and two-run requirement are deferred and no longer gate that PR. The active native goal for this task still requires two consecutive successful hosted runs under ten minutes. Keep those criteria separate; this unsuccessful run supplies no under-ten success evidence, and issue #74 remains open.

## 2026-10-07 PR #129 exact-head run 37638022874

Run [37638022874](https://github.com/eunsoogi/orot/actions/runs/37638022874) completed with failure on PR head `50f43d59238c81153fcd64962728242464b966d7` against base `9328ba44a08976b7d1ddb1a64cd9b1a7c89c5057`. The run started at 14:35:48Z and reached terminal status at 15:14:55Z, an elapsed 39m07s.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| Quality Linux | 14:36:23–14:38:46 | 2m23s | passed |
| Quality | 14:38:49–14:39:00 | 11s | passed |
| iOS Simulator Build | 14:37:43–14:43:27 | 5m44s | passed |
| Speech Transcription | 14:44:30–15:04:10 | 19m40s | passed, separate synthetic 1/1 case |
| Release | 14:35:49–15:09:02 | 33m13s | failed; runner fields empty, zero steps |
| OpenAI Debug | 14:35:49–15:09:58 | 34m09s | failed; runner fields empty, zero steps |

The earliest recorded job start to latest job completion was 34m09s. The run-level terminal status followed at 15:14:55Z; GitHub provided no cause for the additional interval or for the two profile-job failures. Their toolchain, cache, and test outcomes are unobserved. This attempt did not run the original eight Release cases or the original OpenAI Debug case, so their nine-case path has no result here.

The Speech job used the `macos-26-arm64` image and verified macOS 26.6.2, Xcode 26.2, iOS Simulator SDK/runtime 26.2, iPhone 17 Pro, Node 22.23.2, and pnpm 12.3.4. Its cache fingerprint step took 54s and recorded build-input fingerprint `a12d6d29d5c55f40913be76a1afb959fb703f0f69660a55b45550c10684a94f2`, native-dependency fingerprint `bfc8ea31623ea91fbc8e3b32ed8445fe465fb8dc57f87280f64d8fc05ef117d8`, and Xcode fingerprint `9fec9509a0037736274232072cadc58613fa6ddcafd55fa0915151df641590d3`. The profile app cache was a miss (`derived_data_absent`, `app_reusable=false`); the native app build took 9m55s, the Detox test step took 2m34s, and the dedicated Simulator was deleted successfully. The `v10` app-product cache was saved after the build. CocoaPods installation and the separate synthetic Speech case passed. The production/OAuth job reused its production DerivedData cache, skipped CocoaPods installation and the native app build, then passed its OAuth checks.

The 19m40s Speech job already exceeds the ten-minute target. This failed attempt is cache-population evidence for the Speech profile, not a timing pass; it provides no successful full-workflow sample. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured in the GitHub job/step readback. No speedup is claimed.

## 2026-10-07 PR #129 exact-head run 37663394033

Run [37663394033](https://github.com/eunsoogi/orot/actions/runs/37663394033) succeeded on PR head `801a4b60899672e119c28bd7c2e839f905e341bf`. Its workflow merge commit was `426b4dfb05e19927b48477e3e03d448aae8366bd` against main `61a70f1`, before main advanced through #138 and #137. The run was created at 17:59:52Z and completed at 18:38:56Z, an elapsed 39m04s.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| Quality Linux | 18:01:57–18:04:28 | 2m31s | passed, 175/175 gate tests |
| Quality | 18:04:30–18:04:40 | 10s | passed |
| iOS Simulator Build | 18:02:03–18:08:45 | 6m42s | passed |
| Speech Transcription | 18:09:01–18:25:33 | 16m32s | passed, separate synthetic 1/1 case |
| OpenAI Debug | 18:15:12–18:37:36 | 22m24s | passed |
| Release | 18:06:18–18:38:41 | 32m23s | passed |
| Require complete profile summaries | 18:38:43–18:38:48 | 5s | passed |
| Detox iOS E2E | 18:38:51–18:38:55 | 4s | passed |

Release reported 12/12 passing cases ([job log](https://github.com/eunsoogi/orot/actions/runs/37663394033/job/112937283244)): the original eight Release cases plus four Safe Area regressions. The earlier 8/8 Release log ([job log](https://github.com/eunsoogi/orot/actions/runs/37586928599/job/112679113129)) contains the same eight original cases. OpenAI Debug reported the ninth original case at 1/1 ([job log](https://github.com/eunsoogi/orot/actions/runs/37663394033/job/112937283100)). Speech Transcription passed its separate synthetic case; it is additional coverage and does not establish live Apple Speech behavior. The profile jobs completed successfully, including their required diagnostics and dedicated Simulator cleanup steps.

Toolchains differed across profiles: Speech used macOS 26.6.2/Xcode 26.2; Release used macOS 27.0/Xcode 27.0; OpenAI Debug used macOS 27.0.1/Xcode 27.0. Their within-run durations are not interchangeable. The successful 39m04s run is functional evidence for head `801a4b6`, not a ten-minute timing pass or latest-main integration proof. It supplies no under-ten sample, and the strict review on `801a4b6` is stale after the later integration. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-07 PR #129 exact-head run 37672055988

Run [37672055988](https://github.com/eunsoogi/orot/actions/runs/37672055988) passed all required jobs on PR head `a529f6bc712da41eb6a2a5f2316891a091632a9e` against base `62a90d394719339881c74713c04a897d0d2feb79`. It was created at 19:07:10Z and completed at 19:57:16Z, 50m06s from creation. The required-job interval, from the first job at 19:07:12Z through the final aggregate at 19:57:16Z, was 50m04s.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| [Quality Linux](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112966016426) | 19:07:12–19:09:04 | 1m52s | passed, 182 gate tests and 570 unit tests |
| [Quality](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112966835177) | 19:09:06–19:09:16 | 10s | passed |
| [iOS Simulator Build](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112966015846) | 19:11:01–19:19:50 | 8m49s | passed, including production and OAuth checks |
| [Release](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112966016425) | 19:22:41–19:48:33 | 25m52s | passed, 12/12 cases |
| [OpenAI Debug](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112966016420) | 19:28:32–19:57:01 | 28m29s | passed, 1/1 case |
| [Speech Transcription](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112966016840) | 19:33:16–19:47:44 | 14m28s | passed, separate synthetic 1/1 case |
| [Require complete profile summaries](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112987551997) | 19:57:04–19:57:10 | 6s | passed |
| [Detox iOS E2E](https://github.com/eunsoogi/orot/actions/runs/37672055988/job/112987611755) | 19:57:12–19:57:16 | 4s | passed |

GitHub job and step timestamps include step overhead. The profile-stage measurements were:

| Profile | Runner | Verified toolchain and device | App cache | Fingerprint | Native app build | Detox tests | Simulator deletion |
| ------- | ------ | ---------------------------- | --------- | ----------: | ---------------: | ---------: | -----------------: |
| Release | 1000072711 | macOS 27.0.1, Xcode/SDK 27.0, iPhone 18 Pro | miss, `derived_data_absent` | 99s | 429s | 405s, 12/12 | 13s |
| OpenAI Debug | 1000072712 | macOS 27.0.1, Xcode/SDK 27.0, iPhone 18 Pro | miss, `derived_data_absent` | 122s | 681s | 63s, 1/1 | 13s |
| Speech Transcription | 1000072715 | macOS 26.6.2, Xcode/SDK 26.2, iPhone 17 Pro | miss, `derived_data_absent` | 45s | 343s | 220s, synthetic 1/1 | 7s |

All three app-product save steps passed after manifest validation and before E2E. GitHub's cache API lists three resulting entries under `refs/pull/129/merge`. The cache fingerprint includes `packages/**`; main commit `b220cba` (#139) changed `packages/agent-runtime`, so these entries do not apply to the newly integrated head and this run does not warm its app cache. The different Speech toolchain also prevents comparing its profile duration directly with Release or OpenAI Debug.

Run 37672055988 is successful functional evidence for head `a529f6b`, including all three profile test results, production/OAuth checks, diagnostics, Simulator cleanup, and the profile-summary and required Detox aggregates. Its 50m04s required-job interval does not meet the under-ten-minute target. The run predates main commit `b220cba`; local integration, the required checks, and strict review must bind the updated head. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured. No speedup is claimed. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-07 PR #129 exact-head run 37680877416

Run [37680877416](https://github.com/eunsoogi/orot/actions/runs/37680877416), attempt 1, succeeded on PR head `06e1a26fc29e659986479b87638d942a2f1d2842` against base `b220cba802dd9bd2997978cfac0736b6bde293b5`. It started at 20:17:28Z and reached terminal status at 20:55:07Z, an elapsed 37m39s. The required-workflow interval, from Quality Linux at 20:17:31Z through the `Detox iOS E2E` aggregate at 20:55:06Z, was **37m35s**.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| [Quality Linux](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/112996280079) | 20:17:31–20:19:26 | 1m55s | passed, including 182 gate tests and 570 unit tests |
| [Quality](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/112997117762) | 20:19:28–20:19:38 | 10s | passed |
| [Speech Transcription](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/112996279833) | 20:21:59–20:35:47 | 13m48s | passed, separate synthetic 1/1 case |
| [OpenAI Debug](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/112996280249) | 20:22:00–20:34:48 | 12m48s | passed, 1/1 case |
| [iOS Simulator Build](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/112996279575) | 20:33:15–20:45:08 | 11m53s | passed, including production and OAuth checks |
| [Release](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/112996280519) | 20:34:56–20:54:52 | 19m56s | passed, 12/12 cases |
| [Require complete profile summaries](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/113012487940) | 20:54:54–20:55:00 | 6s | passed |
| [Detox iOS E2E](https://github.com/eunsoogi/orot/actions/runs/37680877416/job/113012543901) | 20:55:03–20:55:06 | 3s | passed |

GitHub job and step timestamps include step overhead. All three profile cache restores were cold: the app-product cache was missing, the DerivedData helper classified it as `miss` with `reason=derived_data_absent`, and each profile ran its native build. Each manifest write and app-product save step passed before E2E began.

| Profile | Runner | Verified toolchain and device | App / DerivedData cache | Native app build | Simulator wait | Detox tests | Simulator deletion |
| ------- | ------ | ---------------------------- | ---------------------- | ---------------: | --------------: | ----------: | -----------------: |
| Release | 1000072755 | macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro | miss / miss | 355s | 2s | 395s, 12/12 | 11s |
| OpenAI Debug | 1000072747 | macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro | miss / miss | 325s | 1s | 36s, 1/1 | 5s |
| Speech Transcription | 1000072746 | macOS 26.6.2, Xcode/SDK 26.2, iPhone 17 Pro | miss / miss | 407s | 4s | 154s, synthetic 1/1 | 8s |

All profiles verified Node 22.23.2 and pnpm 12.3.4. The original nine cases were Release 8/8 and OpenAI Debug 1/1; the Release total was 12/12 after four Safe Area regression cases were added. Speech Transcription remains a separate synthetic case. The dedicated Simulators were deleted successfully for all three profiles. The required iOS Simulator Build, production/OAuth verification, profile summary validation, and fail-closed aggregate all passed.

During the run, main advanced to `1327929be75222ba7503c2d6a186cc2da0a60dd7` with #123, while the PR run remained based on `b220cba`. The #123 change modifies iOS app and `packages/provider-openai` inputs covered by the Detox cache fingerprints. Therefore the app-product entries saved by this run do not apply to the refreshed main integration; this follows from the changed paths and the fingerprint scope. The local PR branch now includes `1327929` through a normal merge, and its next hosted run must establish the cache state for those inputs.

The successful 37m35s required-workflow interval misses the under-ten-minute target. This cold-cache run establishes functional and cache-population evidence on head `06e1a26`; it does not establish warm-cache reuse or a speedup. Two consecutive successful under-ten-minute runs on the same updated implementation, exact-head strict review, and passing required checks remain outstanding. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-07 PR #129 exact-head run 37688764942

Run [37688764942](https://github.com/eunsoogi/orot/actions/runs/37688764942) completed with failure on PR head `a0536dcec92d2d88f92c88b03cecc778f726f020`, using base `1327929be75222ba7503c2d6a186cc2da0a60dd7`. It started at 21:21:06Z and reached terminal status at 21:37:19Z, an elapsed 16m13s. The required-workflow interval, from Quality Linux at 21:21:09Z through the `Detox iOS E2E` aggregate at 21:37:18Z, was **16m09s**. This failed run is not an under-ten-minute sample.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| [Quality Linux](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113023272354) | 21:21:09–21:23:42 | 2m33s | passed |
| [Quality](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113024317906) | 21:23:44–21:23:57 | 13s | passed |
| [OpenAI Debug](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113023272553) | 21:23:31–21:36:29 | 12m58s | passed, 1/1 case |
| [Speech Transcription](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113023272337) | 21:24:10–21:31:06 | 6m56s | failed during CocoaPods installation; E2E skipped |
| [iOS Simulator Build](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113023272168) | 21:27:00–21:32:30 | 5m30s | passed, including production and OAuth checks |
| [Release](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113023272912) | 21:27:34–21:35:16 | 7m42s | failed during CocoaPods installation; E2E skipped |
| [Require complete profile summaries](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113029499226) | 21:36:31–21:36:37 | 6s | failed because Release and Speech had no completed profile summaries |
| [Detox iOS E2E](https://github.com/eunsoogi/orot/actions/runs/37688764942/job/113029553632) | 21:37:15–21:37:18 | 3s | failed closed because profile workflows were incomplete |

GitHub job and step timestamps include step overhead. All three profile app-product/DerivedData caches missed with `reason=derived_data_absent`; each profile also restored its Detox framework, React Native artifact, and CocoaPods intermediate caches. Speech ran on macOS 26.6.2 with Xcode and Simulator SDK 26.2 on iPhone 17 Pro, while Release and OpenAI Debug ran on macOS 27.0 with Xcode and Simulator SDK 27.0 on iPhone 18 Pro. All three used Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, and CocoaPods 1.17.0. These differing runner/toolchain identities make the profile durations unsuitable as a comparable timing sample.

The Speech CocoaPods step reported `React-CoreModules`, accessor `:source_files`, and `apps/mobile/node_modules/react-native/React/CoreModules/RCTWebSocketModule.h`; Release reported `React-renderercss`, accessor `:source_files`, and `apps/mobile/node_modules/react-native/ReactCommon/react/renderer/css/CSSNumber.h`. Both logs recorded `ArgumentError - path name contains null byte` in CocoaPods project generation. The logs also show cache hits for CocoaPods intermediates, but do not establish that a cache caused either failure. Neither failed profile reached its native app build or E2E tests. Both collected diagnostics, deleted their dedicated Simulators, and uploaded their artifacts.

OpenAI Debug built its app in 313s, wrote the validated DerivedData manifest, saved the app-product cache, and passed its one E2E case in 46s; its profile job still took 12m58s. The separate iOS Simulator Build restored its production DerivedData cache, skipped the production CocoaPods install and app build, and passed the OAuth package checks and standalone harness build. Only OpenAI Debug completed an E2E case in this run, so the nine original scenarios were not fully exercised. The required profile-summary and Detox aggregate checks failed as intended when two profiles lacked results.

This run was based on `1327929` before main advanced to `0c2ec2453076cd8ba04b2daf9b099d72ff2366d5` (#140); PR #129's current base readback still points to `1327929`. The CocoaPods root cause remains unknown and is being investigated in its separately owned follow-up. The #74 change preserves the diagnostic helper and install path. Two consecutive successful comparable under-ten-minute runs, exact-head independent strict review, and passing required checks remain outstanding. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured. No speedup is claimed.

## 2026-10-08 PR #129 cold-cache run 37709667227

Run [37709667227](https://github.com/eunsoogi/orot/actions/runs/37709667227) passed all required checks on PR head `de75034176d1d18d05e4a5faf4795df86cfb96a3` against base `faff64b70028c07a3228ac5a1165245c328e7c72`. It started at 00:48:22Z and completed at 02:00:20Z. The required-workflow interval, from Quality Linux at 00:48:24Z through the `Detox iOS E2E` aggregate at 02:00:19Z, was **71m55s**. This run is functional and cache-population evidence; it is not a timing pass.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| Quality Linux | 00:48:24–00:50:47 | 2m23s | passed |
| Compute shared Detox cache fingerprints | 00:48:24–00:48:37 | 13s | passed |
| Quality | 00:50:50–00:51:02 | 12s | passed |
| iOS Simulator Build | 01:12:18–01:19:02 | 6m44s | passed; production app cache reused, OAuth checks and standalone harness passed |
| Speech Transcription | 01:13:54–01:36:30 | 22m36s | passed; separate synthetic 1/1 case |
| OpenAI Debug | 01:21:07–01:38:31 | 17m24s | passed, 1/1 original case |
| Release | 01:36:40–02:00:07 | 23m27s | passed, 12/12 cases |
| Require complete profile summaries | 02:00:09–02:00:15 | 6s | passed |
| Detox iOS E2E | 02:00:17–02:00:19 | 2s | passed |

The Release and OpenAI Debug profiles passed the original nine cases (Release 8/8 plus four additional Release regressions, OpenAI Debug 1/1). Speech Transcription passed its separate synthetic case. Each profile collected Simulator diagnostics, deleted its dedicated Simulator, and uploaded reports and logs. The workflow-level required names remained `Quality`, `iOS Simulator Build`, and `Detox iOS E2E`.

| Profile | Runner and verified environment | App-product cache | Native app build | Detox step | Simulator deletion |
| ------- | ------------------------------ | ---------------- | ---------------: | ----------: | -----------------: |
| Speech Transcription | `1000072965`, macOS 26.6.2, Xcode/SDK 26.2, iPhone 17 Pro | miss, `derived_data_absent` | 694s | 205s, synthetic 1/1 | 9s |
| OpenAI Debug | `1000072972`, macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro | miss, `derived_data_absent` | 371s | 42s, 1/1 | 15s |
| Release | `1000072979`, macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro | miss, `derived_data_absent` | 451s | 294s, 12/12 | 5s |

All three Detox profiles verified Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, and CocoaPods 1.17.0. Their app-product caches were absent, so all profiles rebuilt and saved a validated product before E2E. The build-input fingerprint was `581982ea8b09df78d9b4b430d28f4474f1b6b14b3c56515ead4b57ac29aa1950` and the native-dependency fingerprint was `98e08ea178d5eaf65ea3b6f74cb415c3204ad743f6b873f752c32d0848a98f1f`. The production app cache was an exact validated hit. Speech used the macOS 26 runner image while Release and OpenAI Debug used the macOS 27 image, so their durations should not be treated as directly interchangeable.

The first Detox profile started 25m30s after Quality Linux. Release started 48m16s after Quality Linux, and the required aggregate ended 71m55s after it. This interval exceeds the ten-minute target; the run establishes no speedup. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured.

## Generated-output path discovery regression

Separate run [37712005945](https://github.com/eunsoogi/orot/actions/runs/37712005945) on branch `eunsoogi/issue-32-next-visit-questions`, head `8c797af8be2a6c0d947d161ec32dc4019749b9b6`, failed after its native build with `spawnSync git ENOBUFS` while the cache helper enumerated current inputs. This is an adjacent consumer failure, not a #74 performance sample. The local regression test creates 5,000 long tracked and 5,000 long untracked paths under an iOS generated build directory: the previous discovery path failed with `ENOBUFS`; the current pathspec exclusions pass for both hashed inputs and changed-input discovery. The fix excludes generated trees in Git pathspecs before Node buffers those paths, while retaining the post-enumeration filter as a defensive check.

Run 37709667227 predates the generated-output path exclusion fix and is old-head cache-population evidence only. Run 37718160048 on the integrated head passed shared fingerprinting and all three manifest writes, but it missed every profile app cache and exceeded the timing target. Two consecutive successful comparable under-ten-minute runs, strict review, and required checks on the eventual exact final head remain outstanding. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-08 integrated-head cache-population run 37718160048

Run [37718160048](https://github.com/eunsoogi/orot/actions/runs/37718160048), attempt 1, passed on PR head `2afd4d7ee45dd987068b44e522b750178582fd16` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. It started at 02:30:01Z. The required-workflow interval, from Quality Linux at 02:30:04Z through the `Detox iOS E2E` aggregate at 03:04:29Z, was **34m25s**. This run verifies the integrated head and populates its profile app-product caches; it is not a timing pass.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| Quality Linux | 02:30:04–02:32:32 | 2m28s | passed |
| Compute shared Detox cache fingerprints | 02:30:04–02:30:15 | 11s | passed; generated-output path exclusions did not reproduce the adjacent ENOBUFS failure |
| iOS Simulator Build | 02:30:10–02:37:22 | 7m12s | production app cache reused; production CocoaPods install and app build skipped; OAuth package and standalone harness passed |
| OpenAI Debug | 02:30:23–02:46:39 | 16m16s | passed, 1/1 case |
| Speech Transcription | 02:31:10–02:47:28 | 16m18s | passed, separate synthetic 1/1 case |
| Release | 02:32:55–03:04:15 | 31m20s | passed, 13/13 cases |
| Quality | 02:32:34–02:32:44 | 10s | passed |
| Require complete profile summaries | 03:04:17–03:04:23 | 6s | passed |
| Detox iOS E2E | 03:04:25–03:04:29 | 4s | passed |

The 13 Release cases include the nine originally named for #74 and subsequent cases integrated from main; OpenAI Debug retains its separate one-case native fixture probe. Speech remains an additional synthetic profile, not live recognition evidence. Every profile wrote a validated cache manifest before E2E, passed its tests, collected Simulator diagnostics, deleted its dedicated Simulator, and uploaded reports and logs. The shared cache scan and three manifest writes passed on the head containing the generated-output exclusion fix.

| Profile | Runner and toolchain | App / DerivedData cache | Other cache results | Build app step | Detox step | Simulator deletion |
| ------- | ------------------- | ---------------------- | ------------------- | -------------: | ----------: | -----------------: |
| Release | `1000073003`, macOS 27.0.1, Xcode/SDK 27.0, iPhone 18 Pro | miss / `derived_data_absent` | Detox framework miss; React Native artifacts and CocoaPods intermediates hit | 11m28s | 8m16s, 13/13 | 10s |
| OpenAI Debug | `1000073000`, macOS 27.0.1, Xcode/SDK 27.0, iPhone 18 Pro | miss / `derived_data_absent` | Detox framework and CocoaPods intermediates missed; React Native artifacts hit | 5m26s | 37s, 1/1 | 6s |
| Speech Transcription | `1000073001`, macOS 26.6.2, Xcode/SDK 26.2, iPhone 17 Pro | miss / `derived_data_absent` | Detox framework, React Native artifacts, and CocoaPods intermediates hit | 7m16s | 3m14s, synthetic 1/1 | 7s |

All profiles verified Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, and CocoaPods 1.17.0. The Release and OpenAI profiles used the same macOS/Xcode generation but had different cache input fingerprints; Speech used a separate macOS/Xcode generation. The build-input fingerprint was `0eed33f80a6cb0604f4f1d9b72a392e82d8a9ab9a5fb4726b694633c706ea8e1`; the native-dependency fingerprint was `21371121647f715eef5a47e6b0fa896760a803df766edf75a0587ce79b135df0`. Each profile wrote and saved its validated app-product cache after its miss. These current-head cache entries must be confirmed as hits in later hosted runs before they can support a warm-cache timing sample.

The full interval exceeds ten minutes by 24m25s. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured as whole-runner values. This run establishes exact-head functional and required-check evidence plus cache-population evidence, but no speedup. Two consecutive successful comparable under-ten-minute runs, independent strict review on the final exact head, and its passing required checks remain outstanding. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-08 profile app-cache population run 37721540124

Run [37721540124](https://github.com/eunsoogi/orot/actions/runs/37721540124), attempt 1, passed on PR head `be260e57b724b3e3be8d7a03459c2a771ef0d58e` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. The required-workflow interval, from Quality Linux at 03:11:33Z through the `Detox iOS E2E` aggregate at 03:42:36Z, was **31m03s**. This is not a timing pass.

| Job | Runner | Recorded interval (UTC) | Result |
| --- | ------ | ---------------------- | ------ |
| [Quality Linux](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113130079397) | 1000073014 | 03:11:33–03:13:52 | passed |
| [Compute shared Detox cache fingerprints](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113130079424) | 1000073015 | 03:11:33–03:11:45 | passed; generated-output path exclusions did not reproduce the adjacent ENOBUFS failure |
| [iOS Simulator Build](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113130079185) | 1000073013 | 03:11:40–03:20:59 | passed; production app cache reused, CocoaPods install and app build skipped, Simulator defaults and OAuth package/harness checks passed |
| [OpenAI Debug](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113130139790) | 1000073018 | 03:19:11–03:36:39 | passed, 1/1 case |
| [Release](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113130139755) | 1000073019 | 03:21:07–03:42:23 | passed, 13/13 cases |
| [Speech Transcription](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113130139793) | 1000073020 | 03:28:37–03:39:50 | passed, separate synthetic 1/1 case |
| [Quality](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113130674827) | 1000073017 | 03:13:54–03:14:05 | passed |
| [Require complete profile summaries](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113137848505) | 1000073023 | 03:42:25–03:42:31 | passed |
| [Detox iOS E2E](https://github.com/eunsoogi/orot/actions/runs/37721540124/job/113137882822) | 1000073024 | 03:42:33–03:42:36 | passed |

| Profile | Verified runner/toolchain | App / DerivedData cache | Build app step | Detox step | Simulator deletion |
| ------- | ------------------------ | ---------------------- | -------------: | ----------: | -----------------: |
| Release | macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro | miss / `derived_data_absent` | 7m43s | 5m33s, 13/13 | 6s |
| OpenAI Debug | macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro | miss / `derived_data_absent` | 5m47s | 40s, 1/1 | 6s |
| Speech Transcription | macOS 26.6.2, Xcode/SDK 26.2, iPhone 17 Pro | exact hit / reusable | skipped | 3m50s, synthetic 1/1 | 7s |

All three profiles verified Node 22.23.2 and pnpm 12.3.4. Release and OpenAI Debug also verified Ruby 4.0.7 and CocoaPods 1.17.0. The production app cache was reused and both OAuth checks passed. Each Detox profile recorded cache state and diagnostics, passed its tests, deleted its dedicated Simulator, and uploaded its report/log artifacts. The Release and OpenAI Debug DerivedData caches were absent on this macOS 27.0 key, so both profiles built and saved validated app products; GitHub's cache API now lists those entries for `refs/pull/129/merge`. Speech reused its exact macOS 26.6.2 app product. The build-input fingerprint was `0eed33f80a6cb0604f4f1d9b72a392e82d8a9ab9a5fb4726b694633c706ea8e1`; the native-dependency fingerprint was `21371121647f715eef5a47e6b0fa896760a803df766edf75a0587ce79b135df0`.

Runner assignment for the profile jobs was staggered: OpenAI Debug started 7m38s after Quality Linux and Release started 9m34s after it; Speech Transcription started 17m04s after. This run adds successful exact-head functional and check evidence and populates current macOS 27.0 profile app caches, but the 31m03s interval establishes no speedup. CPU, peak RSS, disk use, and whole-runner child-process counts were not measured. Two consecutive successful comparable under-ten-minute runs and an independent strict review on the eventual exact final head remain outstanding. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-08 exact-cache profile run 37724568242

Run [37724568242](https://github.com/eunsoogi/orot/actions/runs/37724568242), attempt 1, passed all checks on PR head `ea2aa64b27f813bbf20b93f75d000c3db27e80fe` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. Quality Linux began at 03:49:51Z and the `Detox iOS E2E` aggregate completed at 04:00:35Z: **10m44s**, 44 seconds over the target. The run does not count as an under-ten-minute pass.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| Quality Linux | 03:49:51–03:52:07 | 2m16s | passed |
| Compute shared Detox cache fingerprints | 03:49:51–03:50:02 | 11s | passed |
| iOS Simulator Build | 03:49:55–03:54:35 | 4m40s | passed; production app cache reused and OAuth checks passed |
| Quality | 03:52:10–03:52:21 | 11s | passed |
| Release | 03:50:08–04:00:22 | 10m14s | passed, 13/13 cases |
| OpenAI Debug | 03:50:11–03:59:42 | 9m31s | passed, 1/1 case |
| Speech Transcription | 03:50:11–03:58:07 | 7m56s | passed, separate synthetic 1/1 case |
| Require complete profile summaries | 04:00:24–04:00:28 | 4s | passed |
| Detox iOS E2E | 04:00:32–04:00:35 | 3s | passed |

The three profile app caches were exact hits with build fingerprint `0eed33f80a6cb0604f4f1d9b72a392e82d8a9ab9a5fb4726b694633c706ea8e1` and native-dependency fingerprint `21371121647f715eef5a47e6b0fa896760a803df766edf75a0587ce79b135df0`. App builds were skipped. All profiles used Node 22.23.2 and pnpm 12.3.4. Release ran on runner `1000073029` with macOS 27.0, Xcode/SDK 27.0, and iPhone 18 Pro; OpenAI Debug used runner `1000073030` with the same toolchain and device. Speech used runner `1000073028` with macOS 26.6.2, Xcode/SDK 26.2, and iPhone 17 Pro.

| Profile | App-cache restore | Archive size | Cache preparation | Detox test time |
| ------- | ----------------: | -----------: | ----------------: | --------------: |
| Release | 2m56s | 28,818,744 bytes | 38s | 315.709s, 13/13 |
| OpenAI Debug | 5m45s | 37,771,165 bytes | 24s | 61.139s, 1/1 |
| Speech Transcription | 2m41s | 28,351,316 bytes | 30s | 173.892s, synthetic 1/1 |

The app-cache logs show `gtar`/`unzstd` extraction taking about 80s for Release, 84s for OpenAI Debug, and 14s for Speech; these are observations from this attempt, not an isolated benchmark. Each profile completed diagnostics, dedicated Simulator deletion, artifact upload, and summary validation. The fail-closed aggregate passed. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured. Exact cache hits and green checks do not establish a speedup; this run misses the timing target and provides no qualifying sample. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-08 shared-fingerprint candidate run 37726693213

Run [37726693213](https://github.com/eunsoogi/orot/actions/runs/37726693213), attempt 1, passed all jobs on PR head `f5d1d4791dd86928d4eac0b9038ba137cb961548` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. Quality Linux started at 04:16:28Z and the `Detox iOS E2E` aggregate completed at 04:31:23Z: **14m55s**. The run is not a timing pass.

| Job | Recorded interval (UTC) | Duration | Result |
| --- | ---------------------- | -------: | ------ |
| Quality Linux | 04:16:28–04:19:00 | 2m32s | passed |
| Compute shared Detox cache fingerprints | 04:16:28–04:16:36 | 8s | passed |
| iOS Simulator Build | 04:16:31–04:21:17 | 4m46s | production app cache reused; app build skipped; Simulator defaults and OAuth package/harness checks passed |
| OpenAI Debug | 04:16:43–04:22:17 | 5m34s | passed, 1/1 case |
| Speech Transcription | 04:16:46–04:23:56 | 7m10s | passed, separate synthetic 1/1 case |
| Release | 04:16:48–04:31:08 | 14m20s | passed, 13/13 cases |
| Quality | 04:19:02–04:19:13 | 11s | passed |
| Require complete profile summaries | 04:31:11–04:31:19 | 8s | passed |
| Detox iOS E2E | 04:31:20–04:31:23 | 3s | passed |

All three profile jobs logged `fingerprint_source=shared`, an exact DerivedData manifest classification, and `app_reusable=true`; app builds were skipped. They used build-input fingerprint `0eed33f80a6cb0604f4f1d9b72a392e82d8a9ab9a5fb4726b694633c706ea8e1` and native-dependency fingerprint `21371121647f715eef5a47e6b0fa896760a803df766edf75a0587ce79b135df0`. The production app cache was reused, and OAuth package and standalone Simulator harness checks passed.

| Profile | Runner and verified environment | App-cache restore | Cache preparation | Detox result | Simulator deletion |
| ------- | ------------------------------ | ----------------: | ---------------: | -----------: | -----------------: |
| Release | `1000073038`, macOS 27.0.1, Xcode/SDK 27.0, iPhone 18 Pro | 2m48s, exact hit | 11s | 448.967s, 13/13 | 20s |
| OpenAI Debug | `1000073037`, macOS 27.0.1, Xcode/SDK 27.0, iPhone 18 Pro | 2m32s, exact hit | 33s | 37.146s, 1/1 | 15s |
| Speech Transcription | `1000073039`, macOS 26.6.2, Xcode/SDK 26.2, iPhone 17 Pro | 2m15s, exact hit | 16s | 149.296s, synthetic 1/1 | 6s |

Each profile also collected Simulator diagnostics and uploaded its logs and reports. The fail-closed profile-summary validator and aggregate passed. The Release Detox step alone took 7m29s, compared with 5m16s in the prior exact-cache attempt 37724568242; those are separate runs and do not establish a controlled speed comparison. Although shared fingerprint reuse was observed, the complete required interval grew from 10m44s to 14m55s. This candidate therefore demonstrates no under-ten-minute result or end-to-end speedup. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-08 single-CLI Release worker failure 37731203928

Run [37731203928](https://github.com/eunsoogi/orot/actions/runs/37731203928), attempt 1, failed on PR head `c3bc11c0db2c2c911e8b5e62372faba46c0fdc89` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. Quality Linux began at 05:12:24Z and the required `Detox iOS E2E` aggregate failed at 06:12:05Z: **59m41s**. This run does not meet the ten-minute target.

| Job | Runner and interval (UTC) | Result |
| --- | ------------------------ | ------ |
| Quality Linux | 1000073061, 05:12:24–05:14:01 | passed |
| Compute shared Detox cache fingerprints | 1000073060, 05:12:24–05:12:37 | passed |
| iOS Simulator Build | 1000073059, 05:12:28–05:18:46 | passed; production app build and standalone OAuth checks passed |
| Release | 1000073062, 05:12:43–06:11:55 | failed after 59m12s; DerivedData cache miss |
| OpenAI Debug | 1000073063, 05:12:45–05:30:52 | passed, 1/1 case |
| Speech Transcription | 1000073064, 05:12:44–05:29:29 | passed, separate synthetic 1/1 case |
| Quality | 1000073065, 05:14:03–05:14:14 | passed |
| Require complete profile summaries | 1000073074, 06:11:57–06:12:00 | failed closed |
| Detox iOS E2E | 1000073075, 06:12:02–06:12:05 | failed closed |

The Release Simulator app build took 6m07s (05:19:33–05:25:40Z). Its Detox test step ran 45m13s (05:25:48–06:11:01Z) and reached the 45-minute workflow timeout. The test log records Detox `proper-lockfile` error `ECOMPROMISED` at 05:28:06Z and `DETOX_PROFILE_END profile=release status=1 elapsed_seconds=493` at 05:34:01Z; worker processes continued writing output after the controller failed, and the storage Jest teardown later timed out. Release Simulator diagnostics failed, but the dedicated Simulator deletion and artifact upload succeeded. The per-profile summary validator and required aggregate rejected the failed Release result.

This was a three-Jest-worker configuration under one Detox CLI, not three independently launched Detox processes. It is a failed functional run, not a performance sample. The `ECOMPROMISED` event and lingering worker output are observations; they do not prove that Simulator cloning caused the lock error or that process cleanup alone resolves it.

## 2026-10-08 explicit-process Release sharding candidate

The PR candidate keeps the eight-file Release inventory and all 13 current cases, including the original nine. It assigns the ordered wrappers to case counts of 5, 5, and 3. After the base Simulator is recorded, CI creates and boots two additional profile-matched Simulators and records each identity before boot so the always-run teardown can clean up after a setup failure. Each wrapper then runs in a separate Detox CLI process, selects one Jest worker, and receives one explicit Simulator UDID. The runner owns each process group, stops orphan descendants after the controller exits, and stops sibling groups when a shard fails. The profile summary gate checks every wrapper's exact case and suite totals before publishing 13 passing cases. Diagnostics and teardown continue to verify only devices matching the dedicated profile runtime and device type.

Local verification of the initial candidate passed the full maintained-code lint and format checks, typecheck, unit suite, 183 CI script tests, and both changed-file and all-file line-count checks. These checks do not execute Detox or boot native Simulators. Its first hosted result is recorded below. The previous serial Release run 37726693213 took 14m55s from Quality Linux through the aggregate, and the single-CLI three-worker attempt 37731203928 failed after 59m41s. No speedup or under-ten-minute result is claimed.

## 2026-10-08 explicit-process Release sharding first hosted run 37742292689

Run [37742292689](https://github.com/eunsoogi/orot/actions/runs/37742292689), attempt 1, failed on PR head `fcd1494af5940256f7fab0d397a06376ee617c5d` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. Quality Linux started at 07:15:16Z and the required `Detox iOS E2E` aggregate failed at 08:05:58Z: **50m42s**. This is a failed run, not a timing sample.

| Job | Runner and interval (UTC) | Result |
| --- | ------------------------ | ------ |
| Quality Linux | 1000073082, 07:15:16–07:16:10 | failed in two Linux timer fixtures; other quality checks were skipped |
| Compute shared Detox cache fingerprints | 1000073083, 07:15:16–07:15:28 | passed |
| iOS Simulator Build | 1000073081, 07:15:21–07:23:37 | passed, including production build and OAuth checks |
| Speech Transcription | 1000073088, 07:21:52–07:42:27 | passed, separate synthetic 1/1 case |
| Release | 1000073094, 07:32:15–08:05:42 | failed after 33m27s; no Release E2E cases ran |
| OpenAI Debug | 1000073099, 07:41:45–07:52:42 | passed, 1/1 case |
| Quality | 1000073085, 07:16:13–07:16:25 | failed closed on the Linux quality result |
| Require complete profile summaries | 1000073112, 08:05:44–08:05:51 | failed closed |
| Detox iOS E2E | 1000073113, 08:05:54–08:05:58 | failed closed |

Release used runner `1000073094`, macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro, Node 22.23.2, and pnpm 12.3.4. Its DerivedData restore was dependency-compatible but not reusable because `build_inputs_changed`; the app rebuilt from 07:43:13Z to 07:57:29Z (14m16s). The worker-preparation step then failed after 2m40s: the artifact records that the data Simulator's `simctl bootstatus` exceeded the preparation script's 120,000ms per-command limit. Both worker IDs had been recorded before boot. E2E was skipped, diagnostics failed, and the always-run teardown deleted the dedicated base Simulator and both worker Simulators; artifact upload succeeded. The profile summary validator and required aggregate rejected the missing Release result.

Quality Linux's two failures came from shell fixtures inheriting `GITHUB_ACTIONS=true` and selecting a Darwin-only timer on Linux. The following working tree made those fixtures select the portable timer, and the full CI/release/quality script suite passed 205/205 locally. It also changed the Release worker boot default from 120,000ms to 900,000ms, matching the existing base-Simulator boot wait; the workflow step still caps total worker preparation at ten minutes. A focused test observed the old 120,000ms default before the change and 900,000ms afterward. These local results did not show that hosted Simulator boot would finish within the workflow budget or that the pipeline met the timing target. The next hosted run 37749283692 exercises both fixes: Quality Linux passes, but the larger worker-preparation step still fails during Simulator data migration. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured.

## 2026-10-08 explicit-process Release sharding second hosted run 37749283692

Run [37749283692](https://github.com/eunsoogi/orot/actions/runs/37749283692), attempt 1, failed on PR head `81db4d24d1ed497ac3304bef77cc32d09c13427a` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. Quality Linux started at 08:21:24Z and the required `Detox iOS E2E` aggregate failed at 10:14:10Z: **1h52m46s**. This is not a timing sample.

| Job | Runner and interval (UTC) | Result |
| --- | ------------------------ | ------ |
| Quality Linux | 1000073122, 08:21:24–08:23:43 | passed |
| Compute shared Detox cache fingerprints | 1000073123, 08:21:26–08:21:37 | passed |
| iOS Simulator Build | 1000073127, 08:34:49–08:44:38 | passed, including production app and standalone OAuth checks |
| Speech Transcription | 1000073130, 08:40:06–08:49:14 | passed, separate synthetic 1/1 case |
| OpenAI Debug | 1000073145, 09:11:44–09:36:05 | passed, 1/1 case |
| Release | 1000073159, 09:32:04–10:13:53 | failed before Release E2E started |
| Quality | 1000073124, 08:23:46–08:23:57 | passed |
| Require complete profile summaries | 1000073183, 10:13:56–10:14:03 | failed closed |
| Detox iOS E2E | 1000073184, 10:14:06–10:14:10 | failed closed |

Release used macOS 27.0, Xcode/SDK 27.0, iPhone 18 Pro, Node 22.23.2, and pnpm 12.3.4. The app DerivedData cache was absent, so the Release app built from 09:43:48Z to 09:58:20Z (14m32s) and the current product cache was saved. The separate Detox-framework, React Native artifact, and CocoaPods caches hit. The 900,000ms per-command Simulator limit did not prevent the worker-preparation step from reaching its ten-minute workflow cap: preparation began at 09:58:31Z and failed at 10:08:56Z. The artifact log shows the first worker already booted and the second waiting on `PassbookDataMigrator` for 5m49s. No Release E2E case ran. Diagnostics could not validate worker assignments; the always-run teardown deleted the dedicated base and both recorded workers, and artifact upload succeeded. The profile summary validator and required aggregate rejected the missing Release result. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured.

The worker-preparation failure follows the blank-device `simctl create` path: an additional worker spent most of the step in first-boot data migration while the already-prepared base was ready. The next local candidate changes only this CI setup path to clone the profile-matched base for the two independent worker devices. The candidate test verifies that each clone uses the recorded base and receives a unique recorded identity before boot; the existing teardown tests still cover deletion of the recorded devices. These tests do not prove clone startup time or real Simulator isolation. The local Xcode `simctl help clone` exposes the command syntax; this host did not create or boot a clone. A hosted run must verify actual clone output, boot behavior, per-worker execution, diagnostics, and cleanup before any performance conclusion.

The candidate's current DerivedData build-input fingerprint remains `202107558af83c61bfa31c26b5f3a3f81b9ea579433e08df56a7d1f618b7e176`, matching run 37749283692; its host-only Simulator-preparation script and Node test do not enter the app build fingerprint. This supports reusing the app cache populated by run 37749283692 if the runner cache is available, but does not prove cache availability or a timing result. The candidate currently has focused setup tests 2/2, full local lint, format, typecheck, unit, CI/release/quality script tests 205/205, changed-file LOC 51/51, all-file LOC 905/905, and `git diff --check` passing. It has no hosted result yet. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-08 explicit-process Release clone failure 37765440903

Run [37765440903](https://github.com/eunsoogi/orot/actions/runs/37765440903) failed on PR head `df4d40aef350beac28b0b58bab9229bae5df638b` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. Quality Linux started at 10:44:22Z and the `Detox iOS E2E` aggregate failed at 13:11:48Z, an interval of **2h27m26s**. This is not a timing sample.

Release used macOS 27.0, Xcode/SDK 27.0, and iPhone 18 Pro. Its app DerivedData cache was absent; the app built successfully in 10m04s. Worker preparation then failed before Release E2E because `simctl clone` returned CoreSimulator error 405 while the dedicated base Simulator was still booted. No worker clones were created. The fail-closed diagnostics and summary validator rejected the missing Release result, the required aggregate failed, and teardown deleted the dedicated base. Quality Linux, Quality, iOS Simulator Build, OpenAI Debug (1/1), and Speech Transcription (synthetic 1/1) passed. CPU, peak RSS, disk use, child-process count/time, and fixture bytes were not measured.

Commit `8b586dd2c425275bd2ce7bde1323641c8280226b` corrected the clone precondition: after capturing the baseline it shuts down only the dedicated base, records clone IDs before boot, then boots and verifies the base and clones. Run 37784626091 below exercised that correction but does not establish a performance result.

## 2026-10-08 three-Simulator Release run 37784626091

Run [37784626091](https://github.com/eunsoogi/orot/actions/runs/37784626091) failed on PR head `8b586dd2c425275bd2ce7bde1323641c8280226b` against base `673c13bc61644dab2f59712baa7fb122bec2bdc5`. Quality Linux started at 13:28:36Z and the required `Detox iOS E2E` aggregate failed at 14:35:46Z: **1h07m10s**. The Release job ran 46m51s; its app build took 10m10s, worker-Simulator preparation 7m28s, and Detox test step 14m09s. This failed run is not a timing sample.

Release used macOS 27.0, Xcode/SDK 27.0, iOS 27.0, iPhone 18 Pro, Node 22.23.2, and pnpm 12.3.4. The app DerivedData cache was absent (`derived_data_absent`); a validated manifest was written after the build. The three Release shards launched on the dedicated base plus two clones. The UI shard ended with exit 1 after its smoke test timed out waiting 30s for `calendar-title` text `캘린더 연결` and the recording safe-area case reported 120s `beforeEach`/`afterEach` hook timeouts. The shard summary was 2 failed and 3 passed tests in 816.026s. The data and storage sibling shards were stopped with exit 128 after the UI shard failed, so their cases did not complete. Release diagnostics, the profile-summary validator, and the required aggregate failed closed. OpenAI Debug (1/1) and Speech Transcription (synthetic 1/1) passed; Quality Linux, Quality, iOS Simulator Build, and shared cache fingerprinting passed.

The sharding command's time record reported 843.90s real, 11.41s user, 11.12s system, and maximum resident size 126,517,248 bytes; this is a command-level observation, not an aggregate runner measurement. Whole-runner CPU/RSS, disk use, child-process count/time, and fixture bytes were not measured. Three active Release Simulators are a plausible source of contention, but this run does not establish that cause; the Calendar title timeout also remains unexplained. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 two-Simulator Release candidate

The local candidate at `c88ca153910e28d592a4dfe408463a797f8f6123`, integrated with `origin/main` `708a46f320c4946a3dfe4d7c4e27d46537975836` in merge commit `4f00445d359f9ad436ccb26d4a20ce0831b21447`, reduces Release concurrency to two active Simulator apps. The UI wrapper runs on the prepared base; one cloned data worker runs the ordered appointment, memory, graph, checkpoint, and storage probes. The redundant storage wrapper is removed, while the profile summary and aggregate still require two wrappers and all 13 current Release cases, including the original nine scenarios and security assertions. Production/OAuth checks, dedicated-device diagnostics and cleanup, fail-closed aggregation, and required check names are unchanged.

The merged candidate includes current `main` changes to smoke setup and the storage migration-reopen assertion. The two-wrapper and 13-case checks are covered by the CI script tests. On this worktree, `pnpm install --frozen-lockfile`, `pnpm quality:setup`, `pnpm quality:inventory` (953 maintained files), `pnpm lint` (zero errors and two unrelated `no-void` warnings in `apps/mobile/src/backup/BackupStatusRecovery.tsx`), `pnpm format:check`, `pnpm typecheck`, and `pnpm test:unit` (all package suites passed) succeeded. The CI/release/quality script suite passed 206/206; the changed-path LOC check passed 50 paths, `--all` passed 1,002 paths, and `git diff --check` passed. These local checks do not execute Detox or boot native Simulators. The next exact-head hosted run must verify the two-Simulator setup, all 13 cases, diagnostics, cleanup, and full required-path timing. The three-Simulator failure above motivates this resource-limiting candidate but does not prove that Simulator contention caused its failures or that the candidate meets the ten-minute target. Two consecutive comparable hosted successes under ten minutes on one implementation, plus passing required checks and independent strict review on the exact final head, remain outstanding. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 two-Simulator Release run 37801397427

Run [37801397427](https://github.com/eunsoogi/orot/actions/runs/37801397427) failed on PR head `bdfd27452607489b7ad48f4e8282375ec8575507` against base `708a46f320c4946a3dfe4d7c4e27d46537975836`. Quality Linux started at 15:31:15Z and the required `Detox iOS E2E` aggregate failed at 16:17:26Z: **46m11s**. The run is not a timing sample.

Release used macOS 27.0, Xcode/SDK 27.0, iOS 27.0, and iPhone 18 Pro. The app DerivedData cache was absent; the app build ran 15:51:25–16:01:18Z (9m53s). The base and one data-worker Simulator were prepared, and both Release wrappers started on their assigned devices. The UI wrapper passed 5/5 cases. The data wrapper passed 7/8; the manual-appointments case timed out while reopening the app after its final cancellation. Its screenshot showed the storage-opening screen. Simulator logs also recorded slow termination/relaunch behavior, but the exact cause of the final timeout is unresolved. Diagnostics, exact deletion of the base and one worker Simulator, and artifact upload passed. The profile-summary validator and required aggregate failed closed.

The same artifact records a separate setup cost before E2E: with `reinstallApp=true`, Detox attempted to terminate/uninstall an app that was absent from the newly prepared worker. The first termination attempt took about 194 seconds and a retry brought the call to about 221 seconds total. The current local candidate limits this change to the CI-only fresh-worker mode: Detox skips its automatic reinstall, while each Release wrapper clears Keychain and explicitly installs the built app before its tests. Local regression coverage checks the normal local reinstall setting and this fresh-worker installation path. The subsequent run on `35cadc6` exercised that installation path but failed while starting the first manual-appointments scenario; see the next section. The local follow-up now avoids a redundant termination on that first launch and keeps both explicit process restarts. It has not yet been validated on a hosted Simulator or shown to meet the ten-minute target. CPU, whole-runner peak RSS, disk use, child-process count/time, and fixture bytes were not measured. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 two-Simulator Release run 37815946148

Run [37815946148](https://github.com/eunsoogi/orot/actions/runs/37815946148) failed on PR head `35cadc65353a868832a14a32dec2b23ac396cc72` against base `708a46f320c4946a3dfe4d7c4e27d46537975836`. Quality Linux started at 17:24:40Z and the required `Detox iOS E2E` aggregate completed at 18:38:09Z: **73m29s**. This is a failed run, not a timing sample.

The run used Xcode/SDK 27.0, iOS 27.0, and iPhone 18 Pro for Release. Its UI shard passed 5/5; the ordered data shard failed all 8 cases. The first manual-appointments scenario exceeded Jest's 120-second test limit while awaiting its initial `device.launchApp` call, and no successful app-launch event for that worker appears before the timeout. Later cleanup/recovery output reported a missing app container and Simulator launch errors; these later errors do not establish the initial timeout's OS-level cause. The log's `info` level does not identify which low-level command inside the launch call was still pending. Dedicated Simulator deletion and artifact upload succeeded, while profile-summary validation and the required aggregate failed closed.

Detox 20.51.4's `RuntimeDevice.launchApp` awaits `terminateApp()` before calling the Simulator launch driver when `newInstance: true`. The Release data wrapper had just installed the app on a fresh worker before the first scenario. The local follow-up changes only that first launch to `newInstance: false`; the scenario still explicitly terminates and relaunches twice to verify persistence after edits and cancellation. Its focused harness first failed on the old `newInstance: true` call and then passed with the new call order. The harness does not execute Detox or a Simulator; the next exact-head hosted run must establish whether this removes the observed startup failure. The earlier failure during the final relaunch on run 37801397427 remains a distinct unresolved observation. CPU, whole-runner peak RSS, disk use, child-process count/time, and fixture bytes were not measured. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 two-Simulator Release run 37828364243

Run [37828364243](https://github.com/eunsoogi/orot/actions/runs/37828364243) failed on PR head `5f242c9446bcdb2b4918d6a931455238232e0e41` against base `cb9e0bed0f487bc8d6d952a57b768125346b1c3f`. Quality Linux started at 18:58:11Z and the required `Detox iOS E2E` aggregate failed at 20:38:54Z: **1h40m43s**. This is a failed run, not a timing sample.

| Job | Runner and interval (UTC) | Result |
| --- | ------------------------ | ------ |
| Quality Linux | 1000073459, 18:58:11–19:00:53 | passed in 2m42s |
| Compute shared Detox cache fingerprints | 1000073460, 18:58:16–18:58:26 | passed in 10s |
| iOS Simulator Build | 1000073471, 19:14:21–19:20:44 | passed in 6m23s, including production and OAuth checks |
| OpenAI Debug | 1000073480, 19:23:15–19:40:14 | passed 1/1 in 16m59s |
| Speech Transcription | 1000073500, 20:12:50–20:30:30 | passed 1/1 synthetic case in 17m40s |
| Release | 1000073498, 20:02:31–20:38:40 | failed in 36m09s |
| Quality | 1000073461, 19:00:56–19:01:09 | passed in 13s |
| Require complete profile summaries | 1000073517, 20:38:43–20:38:47 | failed closed |
| Detox iOS E2E | 1000073518, 20:38:49–20:38:54 | failed closed |

The Release job was created at 18:58:27Z and did not start until 20:02:31Z (64m04s later); the scheduling cause is unknown. It ran on macOS 27.0, Xcode/SDK 27.0, iOS 27.0, iPhone 18 Pro. Speech used macOS 26.6.2, Xcode/SDK 26.2, iOS 26.2, and iPhone 17 Pro, so its toolchain and runtime are not fully comparable with Release/OpenAI.

Release cache and stage observations: the app DerivedData cache was not reusable (`derived_data_absent`); restoring the profile app product took 1m56s and preparing the restored DerivedData took 2m08s. Detox framework, React Native artifact, CocoaPods, Node, and pnpm caches recorded hits. The Release app rebuilt in 9m04s and its validated app product/manifest save succeeded. The dedicated-Simulator wait step took 3s, worker-Simulator preparation took 3m41s, and the Detox test step took 12m22s. Log collection took 10s, dedicated base/worker deletion 23s, and artifact upload 6s.

Both Release shards started at 20:25:32Z on the prepared base and one cloned data Simulator. The data shard completed only 6/8 cases: the first manual-appointments `device.launchApp({newInstance: false})` issued `simctl launch` at 20:26:30Z and had not returned by Jest's 120-second timeout at 20:28:24Z. Its screenshot showed a black startup spinner. The following issue-40 launch with `newInstance: true` also timed out at 120 seconds; later launch/process activity appeared after the timeout, and Detox reported that it could not connect at 20:32:10Z. The UI shard logged welcome and safe-area failures, then exited 128 without a complete Jest summary. Its incomplete output cannot be treated as a case count. The summary validator and required aggregate rejected the failed/missing Release result.

Dedicated Simulator log collection, deletion, and artifact upload succeeded; artifact `11577960841` contains the test log, Simulator logs, screenshots, and Detox trace. `OROT_DETOX_RESOURCE_SAMPLING` was false, so CPU/RSS/process samples are unavailable. The logs establish app-start and Detox-connection failures across both wrappers, but do not isolate app startup, Simulator scheduling/concurrency, or the Detox connection path as root cause. The `newInstance: false` first-launch change did not resolve the observed startup timeout and this run establishes neither a speedup nor the ten-minute target. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 stale-head diagnostic run 37843075193

Run [37843075193](https://github.com/eunsoogi/orot/actions/runs/37843075193) was a `workflow_dispatch` run on the old PR branch head `5f242c9446bcdb2b4918d6a931455238232e0e41`; it did not execute the current one-Simulator candidate and is not a qualifying PR timing run. Quality Linux started at 20:55:45Z and the required `Detox iOS E2E` aggregate failed at 21:57:13Z: **61m28s**. This is a failed diagnostic run, not a timing sample.

| Job | Runner and interval (UTC) | Result |
| --- | ------------------------ | ------ |
| Compute shared Detox cache fingerprints | 1000073529, 20:55:44–20:55:56 | passed in 12s |
| Quality Linux | 1000073530, 20:55:45–20:58:19 | passed in 2m34s |
| iOS Simulator Build | 1000073550, 21:26:46–21:36:26 | passed in 9m40s |
| OpenAI Debug | 1000073545, 21:15:40–21:35:34 | passed 1/1 in 19m54s |
| Speech Transcription | 1000073551, 21:32:44–21:57:01 | passed 1/1 synthetic case in 24m17s |
| Release | 1000073546, 21:16:12–21:52:38 | failed in 36m26s |
| Quality | 1000073532, 20:58:21–20:58:34 | passed in 13s |
| Require complete profile summaries | 1000073565, 21:57:03–21:57:08 | failed closed |
| Detox iOS E2E | 1000073566, 21:57:10–21:57:13 | failed closed |

Release ran on macOS 27.0.1 with Xcode/SDK 27.0, iOS 27.0, and iPhone 18 Pro; Node was 22.23.2 and pnpm was 12.3.4. The app-product and Detox CocoaPods cache keys missed. Node/pnpm, lockfile-verification, Detox-framework, and React Native artifact caches hit. The app build took 11m02s, worker-Simulator preparation 3m48s, the Detox test step 10m19s, log collection 7s, dedicated Simulator deletion 10s, and artifact upload 3s.

The UI shard passed 5/5; the data shard passed 6/8. During the first manual-appointments case, Detox issued `simctl launch` for `newInstance: false` at 21:43:15Z; Jest timed out the test at 21:45:14Z without a recorded completion for that launch before the timeout. The following issue-40 launch with `newInstance: true` also reached Jest's 120-second timeout. Later launch activity appears in the log, so this does not establish an OS-level cause. Dedicated Simulator diagnostics, deletion, and artifact upload succeeded; the profile-summary validator and required aggregate rejected the failed Release result. Artifact `11581027788` contains the run evidence. `OROT_DETOX_RESOURCE_SAMPLING` was false, so CPU/RSS/process samples are unavailable. The repeated launch timeout leaves the root cause unresolved and proves neither a speedup nor the ten-minute goal. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 one-Simulator Release run 37854558660

Run [37854558660](https://github.com/eunsoogi/orot/actions/runs/37854558660) passed every required check on PR head `2135b2e89ec97f68aab79f7e00dd75f19357c6e3` against base `b91fa2219f8820aa415ec9829024f4b822ae66ea`. Quality Linux started at 22:37:35Z and the required `Detox iOS E2E` aggregate completed at 23:20:08Z: **42m33s** from the first required job; the workflow ran 43m24s from creation at 22:36:45Z. The run succeeded functionally but exceeded the active ten-minute target and is not a qualifying timing sample.

| Job | Runner | Interval (UTC) | Result |
| --- | --- | --- | --- |
| Quality Linux | 1000073589 | 22:37:35–22:40:13 | passed in 2m38s |
| Compute shared Detox cache fingerprints | 1000073588 | 22:37:00–22:37:12 | passed in 12s |
| iOS Simulator Build | 1000073600 (`xcode-27`) | 22:55:34–23:09:15 | passed in 13m41s, including production and standalone OAuth checks |
| OpenAI Debug E2E | 1000073595 (`xcode-27`) | 22:46:49–23:07:32 | passed in 20m43s; 1/1 case |
| Release E2E | 1000073596 (`xcode-27`) | 22:47:03–23:15:53 | passed in 28m50s; 13/13 cases in one suite |
| Speech Transcription E2E | 1000073601 (`macos-26`) | 23:00:03–23:19:35 | passed in 19m32s; 1/1 case |
| Require complete profile summaries | 1000073612 | 23:19:57–23:20:02 | passed |
| Detox iOS E2E | 1000073613 | 23:20:04–23:20:08 | passed |

Release, OpenAI, and Speech ran with Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, CocoaPods 1.17.0, and applesimutils 0.9.12. The Release and OpenAI runners used macOS 27.0.1, Xcode/SDK 27.0, iOS 27.0, and iPhone 18 Pro; Speech used macOS 26.6.2, Xcode/SDK 26.2, iOS 26.2, and iPhone 17 Pro. Their runner labels and runtimes differ, so this run alone cannot establish a comparable timing pair.

The production app and all three profile app-product DerivedData caches missed with `derived_data_absent`. Detox framework and React Native artifact caches hit for all profiles; the Detox CocoaPods cache missed for Release and OpenAI and hit for Speech. The profile app-product cache save steps completed for Release, OpenAI, and Speech. Node and pnpm lockfile-verification caches hit. The production app build took 5m26s; the Release app build took 8m46s with a 7m57s test step; OpenAI's app build took 8m16s with a 56s test step; Speech's app build took 8m48s with a 4m43s test step. The logs show these stage durations, but do not isolate the full-workflow delay to cache restoration, runner scheduling, or Simulator execution.

Dedicated Simulator preparation, diagnostics, teardown, summary validation, and artifact upload all passed. Artifacts are `11583616768` (Quality Linux), `11583759597` (iOS build), `11584901535` (OpenAI), `11584927459` (Release), and `11585525404` (Speech). Resource sampling was disabled, so CPU, peak RSS, disk, and process metrics were not collected. This run provides one functional pass, zero under-ten-minute passes, and no evidence for two consecutive qualifying runs. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 one-Simulator Release run 37860510902

Run [37860510902](https://github.com/eunsoogi/orot/actions/runs/37860510902) passed all nine required jobs on PR head `7348d5e411d4dec6d1b8f8de53dfbf2c03568399` against base `bc00b1eff2d9a8429d11bc4b75cd6d8eba5be717`. Quality Linux started at 23:38:05Z and the required `Detox iOS E2E` aggregate completed at 00:19:15Z: **41m10s**. The workflow ran 41m12s from creation at 23:38:03Z. This is a functional pass, not a qualifying under-ten-minute run.

| Job | Runner | Interval (UTC) | Result |
| --- | --- | --- | --- |
| Quality Linux | 1000073618 | 23:38:05–23:40:44 | passed in 2m39s |
| Compute shared Detox cache fingerprints | 1000073616 | 23:38:05–23:38:14 | passed in 9s |
| iOS Simulator Build | 1000073617 (`xcode-27-arm64`) | 23:38:09–23:46:13 | passed in 8m04s, including production and standalone OAuth checks |
| OpenAI Debug E2E | 1000073619 (`xcode-27-arm64`) | 23:38:21–23:45:07 | passed 1/1 in 6m46s |
| Speech Transcription E2E | 1000073621 (`macos-26-arm64`) | 23:38:20–23:48:13 | passed 1/1 synthetic case in 9m53s |
| Release E2E | 1000073620 (`xcode-27-arm64`) | 23:38:24–00:19:01 | passed in 40m37s; 13/13 cases in one suite |
| Quality | 1000073622 | 23:40:46–23:40:58 | passed in 12s |
| Require complete profile summaries | 1000073629 | 00:19:04–00:19:10 | passed in 6s |
| Detox iOS E2E | 1000073630 | 00:19:12–00:19:15 | passed in 3s |

Release used macOS 27.0, Xcode/SDK/iOS 27.0, iPhone 18 Pro, Node 22.23.2, and pnpm 12.3.4. The app-product cache missed with `derived_data_absent`; Detox framework, React Native artifact, CocoaPods, and pnpm verification caches hit. Restoring and preparing Release DerivedData took 3m48s and 2m27s; CocoaPods installation took 2m32s; the app build took 15m55s. The profile saved its validated app product after the build. This run's macOS 27.0 cache key did not match the earlier Release product saved by run 37854558660 on macOS 27.0.1; the cache key and manifest retain the full macOS version. These runs do not show a same-key cache miss or prove cross-patch restore compatibility.

The Release test step ran 00:06:37–00:18:19Z: 701s wrapper time and 694.606s Jest time. All 13 cases passed. Their durations sum to 513.480s, leaving 181.126s of Jest suite overhead. The two Safe Area cases that require startup probes each performed a default launch followed by a configured launch, with about 10.9s and 11.5s between launch-completion markers. The fresh-storage case began at 00:15:25Z and logged its app launch at 00:16:36Z, 70.5s later; the legacy-migration case began at 00:17:02Z and logged its first launch at 00:18:03Z, 61.1s later. Each case also ran `installFreshApp()` before launching. The artifact does not separate install, Keychain, and app-launch time, so those full intervals are not attributed to one command.

The Release Simulator was already booted before E2E. One `app is busy` observation occurred during the blood-pressure Safe Area case; no retry was logged. The command-level resource sample reports 701.28s real time, 33.99s user, 32.41s system, and 133,595,136 bytes maximum RSS; whole-runner CPU, disk, child-process count/time, and fixture bytes were not measured. Production/OAuth, profile checks, dedicated Simulator diagnostics and deletion, summaries, aggregate, and artifact upload passed. Artifacts are `11586957766` (Release, 514,197 bytes), `11586042346` (OpenAI, 26,999 bytes), and `11586383331` (Speech, 556,666 bytes). OpenAI and Speech restored matching app products and skipped native app builds; their runner/runtime versions differ from Release. Issue #74 remains open and PR #129 remains Draft.

## 2026-10-09 PR #129 run 37869216193

Run [37869216193](https://github.com/eunsoogi/orot/actions/runs/37869216193) used PR head `981d2305d019e990fd2cf53da873cbb0415160bf` against base `bc00b1eff2d9a8429d11bc4b75cd6d8eba5be717`. The workflow was created at 01:19:27Z, Quality Linux started at 01:19:29Z, and the final required `Detox iOS E2E` aggregate completed at 02:07:35Z: **48m08s** from workflow creation and **48m06s** from the first required job. The run failed and is not a qualifying timing result.

| Job | Interval (UTC) | Result |
| --- | --- | --- |
| Quality Linux | 01:19:29–01:21:43 | passed in 2m14s |
| Compute shared Detox cache fingerprints | 01:19:29–01:19:38 | passed in 9s |
| iOS Simulator Build | 01:29:20–01:37:33 | passed in 8m13s, including production and standalone OAuth checks |
| Release Detox E2E | 01:20:16–01:49:39 | passed 13/13 in 29m23s |
| OpenAI Debug E2E | 01:37:42–02:07:13 | passed 1/1 in 29m31s |
| Speech Transcription E2E | 01:37:05–02:07:20 | failed in 30m15s |
| Quality | 01:21:45–01:21:56 | passed in 11s |
| Require complete profile summaries | 02:07:22–02:07:31 | failed closed because the Speech job failed |
| Detox iOS E2E | 02:07:33–02:07:35 | failed closed because the required profile result was incomplete |

Release used macOS 27.0, Xcode/SDK/iOS 27.0, iPhone 18 Pro, Node 22.23.2, and pnpm 12.3.4. Its Detox framework, React Native artifact, and CocoaPods caches hit, but the DerivedData app cache was `dependency-compatible` with `app_reusable=false` and `reason=build_inputs_changed`. The native-dependency and toolchain fingerprints matched; the cached app-input fingerprint was `df51abc734693ef21102bc6e4dcdc7f956e2dc10a9ccc686b1117a436cb858f9` and the expected fingerprint was `d66ab17548edfbc54049470b0036d2522ec9efdda2c92c04aefce08a619290ae`. The Release app build step took 12m56s.

The Release E2E wrapper took 457.35s real time and Jest reported 453.382s; all 13 registered cases passed. Case durations sum to 368.902s, leaving 84.480s of Jest suite overhead. The command-level sample reports 25.10s user time, 23.62s system time, 133,890,048 bytes maximum RSS, and no swaps. These are command-level measurements, not whole-runner totals. The artifact logs show 20 app-launch completion messages and one app-busy report; they do not isolate the elapsed setup interval or that busy observation to a single operation.

Speech used macOS 26.6.2, Xcode/SDK/iOS 26.2, iPhone 17 Pro, Node 22.23.2, and pnpm 12.3.4. Its sole E2E test failed because the native Korean speech probe remained `running` and did not reach a terminal result within 120,000ms. The Simulator log reported the Dictation Transcriber asset as supported and `model_installed=false`; this does not establish why the probe remained pending. The dedicated Simulator teardown and artifact upload completed. The required summary and aggregate rejected the missing Speech result rather than publishing a partial pass.

After this run, the local candidate adds `apps/mobile/e2e/release-e2e-suite-files.js` to the host-only Detox inputs excluded from the production app fingerprint. The file controls Jest inventory and sharding but is not bundled by Metro; a local regression test first reproduced the cache-key drift and then passed with this exclusion. That correction was not present in run 378692 and has not yet been verified by a hosted cache classification. The run's Speech failure also remains a required-check failure until a later hosted run passes it; its cause is not inferred from this artifact. No run on this head meets the ten-minute target, and no consecutive qualifying pair exists. Issue #74 remains open and PR #129 remains Draft.
