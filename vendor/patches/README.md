# Pinned dependency patches

`pnpm-workspace.yaml` registers these 14 patches. `pnpm-lock.yaml` records their
hashes. Frozen installation applies the same source repairs locally and in CI.
The iOS dependency and build fingerprints include this directory.

See [the historical warning dispositions](warning-dispositions.md) for the raw
four-profile baseline, every classified group, and the current evidence limits.

| Package | Version | Repair |
| --- | --- | --- |
| `@op-engineering/op-sqlite` | 18.2.5 | Remove an incorrect SQLite API constant override, initialize failure data, preserve 64-bit export counters, namespace amalgamation macros, and repair range-sensitive integer, declaration, and expression diagnostics. |
| `@react-native/codegen` | 0.87.1 | Omit generated `States.cpp` files when the pinned state template produces no definitions. |
| `@react-navigation/elements` | 2.9.44 | Resolve the web-only `ResizeObserver` through `globalThis` so Hermes does not treat it as an undeclared lexical global. |
| `@react-navigation/native` | 7.5.0 | Resolve the development-tools registry through `globalThis` instead of an undeclared lexical global. |
| `fast-text-encoding` | 1.0.6 | Treat `Buffer` as optional on the selected host and retain the existing UTF-8 fallback when it is absent. |
| `jest-worker` | 29.7.0 | Preserve inherited `NO_COLOR` without injecting a conflicting `FORCE_COLOR`. |
| `metro` | 0.87.1 | Preserve `NO_COLOR` in transformer workers and set Metro's default `FORCE_COLOR` only when `NO_COLOR` is absent. |
| `metro-runtime` | 0.87.1 | Evaluate HMR bundles in global scope, matching the native evaluator and Hermes's supported evaluation semantics. |
| `p-queue` | 6.6.2 | Access interval timers through `globalThis` so Hermes recognizes the globals in LangSmith's bundled queue. |
| `react-devtools-core` | 6.1.5 | Use a Hermes-supported list iterator, remove backend-unreferenced frontend helpers, access browser storage through `globalThis`, and return safely when native hosts lack DOM globals. |
| `react-native` | 0.87.1 | Repair the legacy root-view compatibility declaration, classify prebuilt textual headers, complete required nullability declarations, expose the feature flags used by VirtualizedLists, declare runtime globals actually supplied by React Native or Hermes, and retain existing configuration-switch behavior. Development bundle evaluation uses global scope consistently. |
| `react-native-keychain` | 10.0.0 | Use modern Biometry flags and fresh `LAContext` instances on supported iOS and macOS targets. Retain Security query keys only as a runtime fallback for deployment targets below iOS 11 or macOS 10.13, and for tvOS, whose `LAContext` API lacks those controls. Preserve the legacy accessibility and shared-web-credential contracts. Remove the unused Codegen registration because this version has no `Native*` spec in `src`. |
| `react-native-safe-area-context` | 5.10.1 | Match the generated inset field declaration order. |
| `react-native-screens` | 4.27.0 | Read window state from its scene, match integer formatting, cover the existing None fallback, and compile a debug helper only with its debug caller. |

## Prebuilt React Native artifacts

The React Native patch includes `orot-prebuilt-headers.cjs`. The Podfile invokes
it after installation, and React Native's existing flavor-switch script invokes
it before publishing a replacement Debug or Release framework. It checks the
pinned version and expected declarations, supports repeated application, and
replaces only sandbox headers while preserving read-only modes.

The framework executables and signature files retain their original bytes. The
published 0.87.1 artifact already fails strict resource-signature verification
before these edits. Binary equality therefore proves preservation of the
downloaded executable, while valid upstream resource signing remains unproved.

## Verification and remaining diagnostics

Before the additional `p-queue` and Metro patches, the 12-patch candidate passed
`pnpm install --frozen-lockfile`, repository quality and unit checks, focused
patch regressions, and the SQLCipher and Keychain host regressions. On
2026-10-18, clean local Debug and Release test-product builds, a Production app
build, and OAuth package and harness builds returned success from base
`732191f299c0735d5ee816391323f52872fec807`. Those logs contain 7 Debug, 10
Release, and 9 Production warning diagnostics; OAuth package and harness logs
contain none. Duplicate compiler source excerpts are excluded from those
counts. A separate clean `OrotMobile` Release app build also succeeded from the
same base before the `p-queue` patch. It emitted nine RNScreens category
notices, two Hermes timer-global warnings from `p-queue`, the #204-owned
unknown-enum warning, the App Intents metadata-extractor notice
`Metadata extraction skipped, no AppIntents.framework dependency found`, and
the app bundle script-phase warning. The source tree has no
`AppIntent` or `AppShortcut` declarations, so retain this tool notice for a
target without App Intents integration. Its bundling step also printed a Node warning that
`NO_COLOR` was ignored because `FORCE_COLOR` was set. Metro 0.87.1's `WorkerFarm`
source supplies `FORCE_COLOR` to transformer workers even when `NO_COLOR` is
inherited. The Metro patch preserves the default color override only when
`NO_COLOR` is absent. Both new patch files apply to isolated copies of their
pinned sources. The WorkerFarm regression reproduces the conflict on the
installed source; an isolated patched-worker run preserves `NO_COLOR` and
retains Metro's default color override when it is absent. The 14-patch frozen
install passed. A current readback confirms all 14 patch file hashes match the
workspace mapping, root lock and installed lock. The focused warning suite passed 21/21, including the new
bundle-phase regression. A clean Release test-product build from this install,
completed before the later bundle-phase edit, succeeded with 13 diagnostics: nine
RNScreens category notices, three App Intents metadata notices, and one app
bundle-phase notice. It emitted no p-queue timer-global or Metro
color-environment warning. The candidate now marks the app bundle phase
`alwaysOutOfDate = 1` while leaving its output list empty; the configuration
regression file passed 6/6 and `plutil -lint` passes. At PR head `f553e4af`, a
clean `OrotMobile` Release app build with Xcode 27.0, arm64, and `-jobs 2`
succeeded. The bundle phase ran Metro from `index.js` and produced
`Orot.app/main.jsbundle` (7,592,545 bytes). The raw log contains 12 literal
`warning:` lines, representing 11 diagnostics after excluding one repeated
Swift source excerpt: nine RNScreens category notices, one #204-owned
unknown-enum warning, and one App Intents metadata-extraction warning. The
p-queue timer-global warning, Metro `NO_COLOR`/`FORCE_COLOR` warning, and
bundle-phase no-output warning did not appear. Xcode reports the bundle phase as
a note that it runs each build because dependency analysis is unchecked. The
app build does not cover Core UI runtime behavior. The Debug log has an
unexplained `error:` message even though its xcodebuild invocation returned 0;
it is not a warning and remains unresolved.

Core Simulator state persistence passed 3/3, fixture isolation 2/2, recording
persistence 2/2, and Core integration 18/18. The latter includes the new
`RecordingMeteringBoundaryTests` cases. The selected Core UI suite did not
complete: its recording-export test waits for a background row that the current
test harness does not seed after relaunch. The unmerged #204 Draft changes the
export harness and UI test to pass that row's source ID and keep the row
visible. This #201 candidate does not modify those #204-owned files; rerun the
UI case after that integration. The UI invocation was interrupted and has no
usable result bundle, so it is not a pass.

The Debug React Native framework executables and available signature files
match the pinned Debug archive byte-for-byte. The Release flavor switch also
completed: all three installed Release framework executable slices and the
installed signature match the pinned Release archive. The successful
`OrotMobile` Release app build used the Release framework after that switch and
preceded the new `p-queue` and Metro patches. The upstream React Native archive already
fails strict resource-signature verification before these edits, so this work
does not claim upstream signature validity.
`scripts/tests/sqlcipher-counter-host.sh` checks that the configured private
heap size reaches the wide wipe helper intact and exercises SQLCipher values
above the 32-bit range; it needs a C compiler and OpenSSL available through
`pkg-config`.

The SQLCipher patch changes individual sites and adds wide-arithmetic regressions;
the final build must establish which conversions remain and each remaining
conversion needs a source-level range proof. The Keychain patch retains the
deprecated `AccessibleAlways` value and shared-web-credential API because changing
their behavior or result would break compatibility. Only the `AccessibleAlways`
compatibility reference has a localized compiler diagnostic exception, and the
host regression checks that an adjacent deprecated reference still fails under
`-Werror=deprecated-declarations`.

Orot builds only iOS (minimum 15.1). Its tvOS compatibility branch retains the
deprecated Security query keys because tvOS lacks the corresponding `LAContext`
controls. Those warnings are unsuppressed and outside the iOS build inventory.

The root-view compatibility hook is retained and marked deprecated. The clean
Debug, Release, and Production logs contain no matching warning, and the
synthetic prebuilt-header regression confirms that the compatibility
declaration remains present.

The 51 empty-archive notices in historical run 38827436342 are now mapped to
their source files. Thirty-two are empty iOS translation units: six generated
Codegen `States.cpp` files, three Keychain spec outputs, 22 Android-only or
gamma-disabled RNScreens sources, and one Android-only safe-area-context state
source. At pinned upstream commit `4b4e22c`, Keychain's `src` tree has no
Codegen spec: [`src/index.ts`](https://github.com/oblador/react-native-keychain/blob/4b4e22cb3d6064c9bd7b897ba63bdba18baca84f/src/index.ts) calls the legacy `NativeModules` bridge, [`KeychainModule`](https://github.com/oblador/react-native-keychain/blob/4b4e22cb3d6064c9bd7b897ba63bdba18baca84f/android/src/main/java/com/oblador/keychain/KeychainModule.kt) extends `ReactContextBaseJavaModule`, [`KeychainPackage`](https://github.com/oblador/react-native-keychain/blob/4b4e22cb3d6064c9bd7b897ba63bdba18baca84f/android/src/main/java/com/oblador/keychain/KeychainPackage.kt) uses `ReactPackage`, and the [iOS manager header](https://github.com/oblador/react-native-keychain/blob/4b4e22cb3d6064c9bd7b897ba63bdba18baca84f/ios/RNKeychainManager/RNKeychainManager.h) conforms to `RCTBridgeModule`. The Keychain patch removes the unused `codegenConfig` metadata that registers those empty specs; it leaves the Android native module and package sources unchanged. The Codegen, Keychain, RNScreens, and safe-area patches omit the diagnosed empty inputs from generation or the iOS pod source list.

The other 19 notices refer to nine Objective-C category implementation files,
repeated as five Debug, nine Release, and five Production warnings. Orot's
Debug and Release app configurations set `-ObjC`, and the historical Production
link command contains it. Apple's
[QA1490](https://developer.apple.com/library/archive/qa/qa1490/_index.html)
explains that this flag loads static-library members that implement categories.
Keep these objects so their category methods remain available. The clean
candidate builds emit no empty-unit warning and reproduce the 5/9/5 category
notices. This source disposition does not establish category runtime behavior;
that evidence remains pending.

The four downloaded logs reproduce the issue's 1,518 selected occurrences and
38 groups when the classifier includes primary `warning:` diagnostics, Metro
`WARN` lines, Xcode DVT notices, and CocoaPods script-phase notices, while
excluding repeated Objective-C and Swift source excerpts. The raw logs have
1,514 `warning:` lines because they include those excerpts. The inventory
separates 1,455 primary `warning:` diagnostics, four Metro `WARN` messages, 50
DVT notices, and nine CocoaPods notices. These totals describe run 38827436342 at its historical
head; they are not current candidate build evidence.

When changing a patch or package version, regenerate its pnpm lock entry and
verify fresh installation, affected behavior and clean native compilation. A
prebuilt-header change also needs original-versus-patched executable hashes and
actual Debug/Release switching evidence.
