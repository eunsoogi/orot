# Detox CI performance

## Problem

The Detox workflow built three Release app variants and one Debug OpenAI probe app, installed Pods twice, and started four Jest/Detox runs. The Release variants differed by JavaScript entry file while using the same native build settings, so Swift Crypto and other native targets were compiled again in separate DerivedData directories.

## Evidence

The comparable hosted baseline is successful run `37162652878`, attempt 2, at `98a980f89ada92ff71e311108f5a9a03fcb70b5a`. Its `Detox iOS E2E` job used the `xcode-27-arm64` image release `20260928.0222.1`, macOS 27.0 build 26A428, and verified Xcode/iOS SDK 27.0, Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, CocoaPods 1.17.0, and applesimutils 0.9.12. The pnpm cache restored successfully; the workflow does not configure a DerivedData cache.

| Hosted baseline measure | Value |
| --- | ---: |
| Native build workflow step, including two Pods installs | 14m57s |
| Detox E2E test workflow step | 10m30s |
| Complete Detox job | 26m58s |
| App builds | 3 Release + 1 Debug |
| Pods installs | 2 |
| Jest/Detox runs | 4 |
| Coverage | 8/8 tests, 6 suites, no skipped or pending tests |

The successful hosted test groups were app/storage (5 tests, 3 suites), agent memory (1/1), graph (1/1), and the OpenAI synthetic Debug probe (1/1). OAuth against a real account remains unverified. Attempt 1 of run `37162652878` failed during the second `pod install` with CocoaPods `ArgumentError - path name contains null byte`; attempt 2 succeeded. This change runs one Pods install and does not claim to fix that error's root cause.

The local baseline was measured before source edits at `98a980f89ada92ff71e311108f5a9a03fcb70b5a`, using Xcode 27.0 build 27A266a, iOS Simulator 27.0, Node 22.23.2, pnpm 12.3.4, Ruby 4.0.7, CocoaPods 1.17.0, and applesimutils 0.9.12. With the same dedicated iPhone 18 Pro Simulator prebooted, `pnpm e2e:build:ios` took 409.77s real (2063.74s user, 313.44s system), and `scripts/ci/run-test-suite.sh e2e ...` took 141.62s real (13.82s user, 12.37s system). The pnpm store was warm (937 reused, 0 downloaded); all four DerivedData directories were absent before this run. Local test results were 8/8 across 6 suites and 4 Jest runs. Remote CPU, peak RSS, disk, child-process count/time, and fixture bytes were not measured. Local peak RSS, child-process count/time, and fixture bytes were not measured.

The local candidate was measured on the same host and toolchain, from an uncommitted worktree based on `98a980f89ada92ff71e311108f5a9a03fcb70b5a`. Its pnpm store was warm, and both candidate DerivedData directories were absent before the build. The same dedicated iPhone 18 Pro / iOS 27.0 Simulator was booted before the build and already booted before both test invocations.

| Local stage | Baseline | Candidate | Change |
| --- | ---: | ---: | ---: |
| Native build wall time | 409.77s | 209.70s | 48.8% lower |
| Detox E2E wall time | 141.62s | 135.31s | 4.5% lower |
| Sum of measured build and test stages | 551.39s | 345.01s | 37.4% lower |
| Post-build DerivedData size | 5,736,240 KiB | 3,059,396 KiB | 46.7% lower |
| App builds / Pods installs | 3 Release + 1 Debug / 2 | 1 Release + 1 Debug / 1 | — |
| Jest/Detox runs / coverage | 4 / 8 tests, 6 suites | 2 / 8 tests, 6 suites | No skips or pending tests |

The stage sum excludes dependency installation, Simulator preparation, and other workflow work. DerivedData figures are post-build directory sizes, not peak disk usage. These local measurements show the candidate's local behavior; they are not hosted CI evidence and do not satisfy the remote comparison criterion. The measured candidate source tree is committed as `df050e6`; equivalent hosted-run timings, runner image, and cache state remain pending. OAuth against a real account remains unverified. Peak RSS, child-process count/time, and fixture bytes remain unmeasured locally and remotely.

## Smallest improvement

One Release router selects the existing app, storage, agent-memory, or graph entry at runtime. The existing storage and memory launch arguments continue to select their probe; the graph test now passes an explicit route selector. One Release Jest configuration runs all five Release test files together. The OpenAI synthetic fixture remains in its Debug-only app and runs in one separate Detox invocation.

The workflow creates and boots one named iPhone 18 Pro Simulator before dependency installation, waits for it after both app builds, passes that exact UDID to the Release and Debug configurations, captures its logs, and deletes only that device. The Release and Debug app builds share one Pods install. The production app build and standalone OAuth package and Simulator harness checks remain in the separate `iOS Simulator Build` job.

## Verification

The CI summary guard requires one nonempty Release Jest summary and one nonempty OpenAI Debug Jest summary; it rejects missing or skipped results. Portable checks cover entry selection, explicit Release test inventory, per-run aggregation, both Detox invocations, fail-closed Simulator selection, and scoped Simulator teardown.

Hosted candidate timing and exact baseline/candidate SHA comparison remain pending until the candidate completes on the pull request's hosted runner.
