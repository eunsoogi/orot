# Orot

Orot is an iOS-first React Native application in a pnpm workspace. The mobile app lives in `apps/mobile`; future shared packages belong under `packages/*`.

## Local setup

### Pinned toolchain

| Tool | Version |
| --- | --- |
| macOS | 27.0 |
| Node.js | 22.23.2 (`.nvmrc`; React Native requires 22.13 or newer) |
| pnpm | 12.3.4 |
| React Native / React | 0.87.1 / 19.2.3 |
| Jest / React Native Testing Library / test-renderer | 29.7.0 / 14.0.1 / 1.2.0 |
| Detox | 20.51.4 |
| Xcode | 27.0 |
| Ruby / CocoaPods | 4.0.7 / 1.17.0 (Homebrew) |

Install CocoaPods with `brew install cocoapods` if needed. Install an iOS Simulator runtime through Xcode before running the iOS build or Detox tests.

```sh
pnpm install
pnpm lint
pnpm typecheck
pnpm test:unit
pnpm ios:build
```

The iOS build script installs CocoaPods dependencies and disables code signing for Simulator builds. If `xcode-select -p` points to Command Line Tools, set `DEVELOPER_DIR` to the Xcode developer directory for install and iOS commands; for example, `DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer pnpm install`.

## Detox smoke test

```sh
pnpm e2e:build:ios
pnpm e2e:test:ios
```

The E2E test launches the app in an iOS Simulator and checks that the welcome screen renders. The E2E runner and test live under `apps/mobile/e2e`.
