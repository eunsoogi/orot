# 개발 안내

Orot은 `apps/mobile`의 iOS 앱과 루트 pnpm workspace로 구성되어 있습니다. 이후 공유 패키지는 `packages/*` 아래에 둡니다.

화면을 구현할 때는 [디자인 시스템](../DESIGN.md)을 참고하세요.

## 개발 환경

| 도구 | 버전 |
| --- | --- |
| macOS | 버전은 진단 및 캐시 식별에 기록하며 고정하지 않음 |
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

GitHub Actions runs this canonical check as the direct `Source LOC policy` job in the `Code Quality` workflow. Branch protection requires it alongside `Maintained file inventory`, ten `Lint / <surface>` checks, `Format check`, the type/unit/policy-test leaves, the production/OAuth `iOS Simulator Build`, and the individual Detox E2E profile leaves. Branch protection reads each job check directly rather than a workflow summary.

## iOS 빌드

```sh
pnpm ios:build
```

이 명령은 CocoaPods 의존성을 설치한 뒤 Simulator용 앱을 빌드합니다. Simulator 빌드에서는 코드 서명을 끕니다.

## 네이티브 통합 및 UI 검증

`OrotTests` scheme은 앱에서 실행되는 `OrotIntegrationTests`와 실제 화면을 조작하는 `OrotUITests`를 빌드합니다. 테스트 제품은 SDK 27, arm64와 테스트 전용 entry·native flags를 사용합니다. 기본 제품 빌드에는 테스트 명령 broker가 포함되지 않습니다. 프로필별 조건은 `scripts/ci/ios-test-config.mjs`, 실행할 정확한 test identifier는 `scripts/ci/ios-test-inventory.mjs`가 정의합니다.

Release 제품은 `core`, `speech`, `backup`, `fixtures`, `local-model`에서 공유합니다. Debug 제품은 `provider-data`, `health-import`, `microphone`, `provider-selection`에서 공유합니다. Speech 실행은 iOS 26.2 build 23C54와 iPhone SE 3세대를 사용하고, 나머지 프로필은 iOS 27과 iPhone 18 Pro를 사용합니다. 실행 runtime이 다르더라도 producer의 설정·flags·architecture·toolchain·entry와 제품 무결성이 같아야 공유할 수 있습니다.

로컬 Core 검증은 저장소 루트에서 다음 순서로 실행합니다. 기존 제품이나 소유권 파일과 겹치지 않는 경로를 사용하세요.

```sh
node scripts/ci/build-ios-tests.mjs core build/native-tests-release
node scripts/ci/ios-test-simulator.mjs prepare core build/native-core-owner.json
node scripts/ci/run-ios-tests.mjs core build/native-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/native-core-owner.json build/native-core.xcresult
node scripts/ci/ios-test-results.mjs core build/native-core.xcresult build/native-core-results.json
node scripts/ci/ios-test-simulator.mjs cleanup core build/native-core-owner.json
```

제품과 의존성을 준비한 뒤 기록된 기기만 부팅합니다. `test-without-building`은 consumer에서 다시 컴파일하지 않습니다. CI는 run·attempt·source와 build input·제품 digest를 검증한 뒤 Simulator를 생성하며, 검증 실패를 빌드나 다른 제품으로 대체하지 않습니다. 실행은 한 destination과 worker를 사용하고 첫 실패·결과 bundle·첨부 자료·단계 시간·resource samples를 보존합니다.

`fixtures`, `health-import`, `microphone`, `provider-selection`은 `run-ios-fixture-tests.mjs`로 실행합니다. 이 helper는 사례마다 소유한 앱과 Keychain을 초기화하고, 각 결과를 검증한 뒤 합성 앱 데이터를 제거합니다. `backup`의 snapshot 단계와 `local-model`의 재실행 단계는 각각 전용 helper의 순서를 따르며, process restart에 필요한 Keychain·자료를 유지합니다. 프로필이 다른 기기나 공유 Core·Speech 컨테이너를 이 helper로 초기화하지 마세요.

UI를 처음 실행하기 전 CI는 앱과 Hermes의 기존 native 연결 사례를 별도 bundle에서 한 번 실행합니다. 이 결과는 연결 확인이며 화면의 접근성 준비 완료를 뜻하지 않습니다. UI 검증은 실제 버튼·스크롤 영역·키보드와 시스템 창의 관측 조건을 기다립니다. 합성 Calendar·HealthKit 자료나 계정 응답을 사용한 결과는 실제 개인 자료·계정·물리 기기의 검증과 구분합니다. Apple 모델 준비 실패, 인식 실패와 UI 입력·복귀 실패도 별도로 기록합니다.

네이티브 선택 검증은 기존 E2E workflow의 `focus_profile=native/<profile>`, `focus_scenario_file=apps/mobile/ios/<target>/<class>.swift`, `focus_scenario_name=<target>/<class>/<method>` 입력을 사용합니다. 후보 브랜치를 `--ref`로 지정하고 `focus_pr_number`를 함께 전달하면 workflow의 실제 SHA와 해당 PR의 저장소·브랜치·HEAD가 일치해야 실행합니다. 부분 이름이나 다른 프로필의 사례는 허용하지 않습니다. `backup`과 `local-model`은 상태를 이어받는 단계가 있으므로 각각 해당 클래스 파일과 `focus_scenario_name=all`을 지정해 전체 단계 그룹을 선택합니다. 선택 검증은 재시도 없이 검증된 제품을 사용하고, UI 사례는 별도의 앱 연결 준비를 거칩니다. 성공하더라도 보호된 전체 검증을 충족하지 않습니다.

`provider-data` CI는 Simulator 생성 전에 호스트 Foundation Models SDK의 상태와 한국어 지원 여부를 기록하고 공개 `prewarm`을 한 번 호출합니다. 이는 메모리 준비 요청입니다. Simulator의 모델 사용 가능 상태와 실제 생성 결과는 이어지는 원래 네이티브 사례에서 확인하며, 호스트 관측은 별도 로그로 남깁니다.

## Detox 스모크 테스트

```sh
pnpm e2e:build:ios
pnpm e2e:test:ios
```

Detox는 `.detoxrc.js`에 지정된 iOS Simulator에서 앱을 실행하고 시작 화면이 표시되는지 확인합니다. 러너 설정과 테스트는 `apps/mobile/e2e`에 있습니다.

## Release 및 Speech E2E 앱 재사용

GitHub Actions의 Release UI/storage 및 stateful-data shard는 Release 앱 producer가 준비한 동일한 artifact를 공유합니다. 각 shard는 workflow run과 attempt, 소스 커밋, 프로필별 빌드 설정, Xcode/SDK, 앱 bundle 무결성을 확인한 뒤 앱을 사용합니다. Artifact 확인에 실패하면 해당 shard가 실패하며 앱 빌드 단계는 실행되지 않습니다. 두 shard는 Simulator와 테스트 데이터를 계속 분리해서 사용합니다.

Speech transcription은 별도의 Release 앱 producer와 test consumer를 사용합니다. Consumer는 새 job에서 transcription artifact의 프로필과 무결성을 확인한 뒤 앱을 실행하며, Release artifact를 사용하지 않고 앱을 다시 빌드하지 않습니다. 두 프로필의 native 설정, entitlements, entry point와 DerivedData 경로는 각각 유지됩니다. Speech 실행의 프로세스 및 메모리 샘플을 수집하려면 workflow의 `resource_sampling` 입력을 활성화합니다.

CI는 기존 headless 모드로 전용 Simulator 한 대를 사용합니다. Speech는 iPhone SE 3세대 기기를 생성해 UDID를 기록하고, 앱 artifact와 framework 준비가 끝난 뒤 한 번만 부팅합니다. 현재 Speech의 iOS 26.2 runtime(build 23C54)과 SDK 27을 유지하며, 해당 runner에서 기기 유형과 runtime의 조합이 사용 가능하지 않으면 실패합니다. 실행 ID, 기록된 UDID, runtime과 기기 유형이 일치하지 않아도 부팅하지 않고 실패합니다. 부팅 후 baseline inventory를 기록하며, 앱 artifact manifest에도 runtime·기기 유형·캐시 식별자를 포함해 producer와 consumer의 조건을 비교합니다. 더 작은 기기가 메모리를 줄인다는 보장은 없습니다.

`resource_sampling`을 활성화한 Speech 실행에서는 toolchain 준비부터 종료까지 호스트 프로세스 RSS, `vm_stat`와 swap을 별도 로그로 수집합니다. 테스트 구간의 기존 리소스 샘플도 유지합니다. RSS에는 공유 메모리와 다른 호스트 프로세스가 포함되므로 Simulator의 private footprint나 연속 peak로 해석하지 않습니다. 부팅 로그에는 부팅 전후 메모리 상태가 남습니다. 로그와 실제 테스트 결과를 함께 비교하며, 시스템 서비스, 권한, 한국어 모델 설치와 테스트 제한 시간은 유지합니다. Release의 대표 화면 크기와 부팅 순서도 유지합니다.

경량 실행 후보인 [simless](https://github.com/abacusai/simless)는 SwiftUI 앱을 Mac의 Designed for iPad 환경에서 실행하는 도구입니다. 현재 React Native workspace의 Detox 실행을 대체하지 못하며, 도구 자체도 키보드, 시스템 권한 UI와 share sheet를 검증하지 않는다고 명시합니다. 따라서 해당 검증이 필요한 이 프로젝트의 E2E에서는 Apple Simulator를 사용합니다. [Apple의 Simulator 소개](https://developer.apple.com/videos/play/wwdc2019/418/)와 현재 runner의 `simctl help boot`, `simctl help shutdown`에 있는 전용 기기 부팅·종료 명령으로 준비 순서를 조정합니다. 더 작은 기기 모델의 효과는 실제 측정 없이 가정하지 않습니다.

## 초안 PR과 집중 E2E 검증

초안 PR 업데이트에서는 정적 검사와 단위 테스트를 실행하고, 전체 iOS/E2E 필수 check는 초안 상태를 분명히 표시하며 Simulator 빌드와 프로필 실행을 건너뜁니다. PR을 검토 준비 상태로 바꾸거나 이후 커밋을 올리면 변경 경로에 맞는 필수 검증이 실행됩니다. 초안 또는 집중 실행의 결과는 병합에 필요한 전체 검증을 대신하지 않습니다.

한 E2E 실패를 재현할 때는 기본 브랜치에 있는 `E2E Test` workflow를 PR branch에서 수동 실행하고 `focus_pr_number`, `focus_profile`, `focus_scenario_file`, `focus_scenario_name`을 지정합니다. 실행 전에 PR이 열려 있고 `main`을 대상으로 하며, 같은 저장소와 현재 branch/SHA를 가리키는지 확인합니다. 집중 실행은 해당 테스트 하나만 실행하고 프로세스·메모리 샘플을 수집합니다. Release와 Speech는 각자 별도의 앱 producer를 사용합니다.

```sh
gh workflow run e2e-test.yml --ref <PR-branch> \
  -f focus_pr_number=<PR-number> \
  -f focus_profile=release \
  -f focus_scenario_file=release-e2e-data.test.js \
  -f focus_scenario_name='creates, edits, and cancels an appointment that survives process restarts'
```

포커스 실행은 원인을 분리하는 진단용이며 보호된 전체 E2E check를 통과 처리하지 않습니다. 실패한 테스트는 먼저 이 방식으로 분리해 로그와 원인을 확인하고, 수정 후 새 커밋에서 PR의 전체 필수 검증 결과를 확인합니다. 원인이 확인되지 않으면 같은 전체 실행을 반복하거나 제한 시간을 늘리지 말고, 실패한 Actions 실행과 단계, 현재 커밋, 관련 로그와 샘플을 함께 기록해 원인 조사를 이어갑니다.
