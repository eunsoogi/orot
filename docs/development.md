# 개발 안내

Orot은 `apps/mobile`의 iOS 앱과 루트 pnpm workspace로 구성되어 있습니다. 이후 공유 패키지는 `packages/*` 아래에 둡니다.

## 개발 환경

| 도구 | 버전 |
| --- | --- |
| macOS | 27.0 |
| Node.js | 22.23.2 (`.nvmrc`; React Native는 22.13 이상 필요) |
| pnpm | 12.3.4 |
| React Native / React | 0.87.1 / 19.2.3 |
| Jest / React Native Testing Library / test-renderer | 29.7.0 / 14.0.1 / 1.2.0 |
| Detox | 20.51.4 |
| Xcode | 27.0 |
| Ruby / CocoaPods | 4.0.7 / 1.17.0 (Homebrew) |

iOS 빌드와 Detox 테스트를 실행하기 전에 Xcode에서 iOS Simulator 런타임을 설치하세요. CocoaPods가 없다면 `brew install cocoapods`로 설치합니다.

`xcode-select -p`가 Command Line Tools 경로를 가리키면 Xcode 개발자 디렉터리를 지정해 의존성을 설치하고 iOS 명령을 실행하세요.

```sh
export DEVELOPER_DIR=/Applications/Xcode.app/Contents/Developer
```

## 설치 및 검사

저장소 루트에서 의존성을 설치하고 필요한 검사를 실행합니다.

```sh
pnpm install --frozen-lockfile
pnpm quality:setup
pnpm quality:inventory
pnpm lint
pnpm format:check
pnpm typecheck
pnpm test:unit
```

`pnpm format:write`는 검사 대상 파일을 정리합니다. 코드 표면과 제외 근거는 [코드 품질 검사 안내](code-quality.md)에 있습니다.

## Source line policy

Check the changes from this branch's merge base with the latest `main`. The same command with `--all` audits every tracked file and every non-ignored untracked file.

```sh
git fetch origin
node scripts/ci/check-loc.mjs --base "$(git merge-base origin/main HEAD)"
node scripts/ci/check-loc.mjs --all
```

The repository policy is in [`scripts/ci/loc-policy.json`](../scripts/ci/loc-policy.json). It counts physical lines, including comments and blank lines: 250 passes and 251 fails. It includes maintained application and package source, tests, scripts, and executable configuration. Documentation, lockfiles, generated/vendor/build output, binary assets, and serialized Xcode project metadata have explicit exclusion reasons. Unknown changed file types and missing Git history fail the check.

GitHub Actions runs this check on the Linux `Quality` aggregate in workflow `CI`. That required check also fails closed unless both the Linux portable and macOS Apple-tool partitions succeed. The other required checks are `iOS Simulator Build` and `Detox iOS E2E`.

## iOS 빌드

```sh
pnpm ios:build
```

이 명령은 CocoaPods 의존성을 설치한 뒤 Simulator용 앱을 빌드합니다. Simulator 빌드에서는 코드 서명을 끕니다.

## Detox 스모크 테스트

```sh
pnpm e2e:build:ios
pnpm e2e:test:ios
```

Detox는 `.detoxrc.js`에 지정된 iOS Simulator에서 앱을 실행하고 시작 화면이 표시되는지 확인합니다. 러너 설정과 테스트는 `apps/mobile/e2e`에 있습니다.
