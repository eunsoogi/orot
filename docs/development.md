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
| Xcode | 27.0 |
| Ruby / CocoaPods | 4.0.7 / 1.17.0 (Homebrew) |

iOS 빌드와 네이티브 테스트를 실행하기 전에 Xcode에서 iOS Simulator 런타임을 설치하세요. CocoaPods가 없다면 `brew install cocoapods`로 설치합니다.

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

GitHub Actions runs this canonical check as the direct `Source LOC policy` job in the `Code Quality` workflow. Branch protection requires it alongside `Maintained file inventory`, ten `Lint / <surface>` checks, `Format check`, the type/unit/policy-test leaves, the production/OAuth `iOS Simulator Build`, and five compatibility E2E leaves backed by complete native validation. Branch protection reads each job check directly rather than a workflow summary.

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

전체 네이티브 CI는 macOS 작업 5개로 구성합니다. Release·Debug 제품 빌드 2개와 일반 Release·Speech·Debug 실행 3개이며, 의존 관계상 한 실행에서 동시에 진행하는 macOS 작업은 최대 3개입니다. 실행 계획·선택·결과 집계는 Ubuntu에서 처리합니다. 생산용 앱과 OAuth 검증은 Release producer에서 별도 flags와 DerivedData 경로를 사용합니다. 계정 전체의 macOS 동시 실행 한도 5개를 고려해 다른 실행과의 중복도 확인합니다. 작업별 200·90·180분 한도는 기존 프로필 작업 한도를 합한 값이며, 개별 인식·생성·UI 대기 제한을 늘리지 않습니다. 총 작업 시간과 안정성 개선은 실제 실행 결과로 판단합니다.

Fixtures 22개는 `navigation`, `recordings`, `questions`, `calendar` 네 묶음으로 실행합니다. 일반 Release 실행 작업 한 개에서 같은 검증된 제품과 한 번 부팅한 전용 Simulator를 공유하며, 각 사례의 앱 컨테이너 초기화·삭제와 기존 제한 시간은 유지합니다. 전체 검증에는 네 묶음이 모두 필요합니다. 특정 묶음은 `focus_profile=native/fixtures`, `focus_scenario_file=scripts/ci/ios-test-fixture-groups.mjs`, `focus_scenario_name=group/<group>`으로 선택하며, `all`은 원래 22개 전체를 선택합니다. 분할에 따른 준비·대기 시간과 총 작업량은 실제 실행 결과로 비교합니다.

## 전체 CI와 제품 재사용

`E2E Test`는 PR 변경과 `main` push에서 네이티브 검증 graph를 자동으로 준비합니다. 초안 PR도 Mac 할당 전에 Linux 계획 작업의 `native-ci-admin-approval` 환경에서 관리자 승인을 기다립니다. 저장소 설정의 필수 검토자는 `eunsoogi`이며 관리자 우회는 허용하지 않습니다. 승인 없이 실행되거나 단순히 환경 이름만 존재하는 상태를 승인 완료로 간주하지 않습니다. Mac 작업은 Release producer, Debug producer, 일반 Release 실행, Speech 실행, Debug 실행의 5개이며 선행 관계상 최대 3개가 겹칩니다. Linux에서 경로 선택, 실행 목록 검증, 결과 집계와 필수 상태를 처리합니다. 다른 workflow의 Mac 사용량까지 합친 저장소 전체 동시 실행 수는 별도 운영 조건입니다.

Release producer는 기본 production 앱과 별도 OAuth harness를 각각 다른 flags·DerivedData로 먼저 검증하고, 같은 작업에서 네이티브 Release 제품을 만듭니다. 완료된 production·기본 Keychain·OAuth 검증은 현재 run·attempt·head의 결과 파일로 Linux 상태에 전달합니다. 뒤의 네이티브 컴파일이나 테스트 실패가 production 성공 기록을 지우지 않습니다. production 캐시는 실제 도구 버전·빌드 입력·CocoaPods 생성물·앱 digest를 확인하며, 네이티브 테스트 제품은 같은 실행의 검증된 artifact로 전달합니다.

독립 그룹은 실패 후에도 첫 시도의 결과를 수집합니다. 실패·누락·skip·취소·오래된 결과가 있으면 전체 검증은 실패합니다. Backup restore와 local-model 재실행의 종속 단계는 전용 순서를 유지합니다. Provider 프로필의 8개 원래 테스트도 필수입니다. `unsupportedDevice`가 남거나 실제 Apple Intelligence 테스트가 통과하지 못하면 머지하지 않습니다. 지원하지 않는 환경의 실패를 availability 성공, 스킵, 합성 응답, 대체 제공자나 별도 로컬 결과로 대체하지 않습니다.

원래 55개 요구사항과 대체 테스트, 과거 관측의 범위는 [네이티브 검증 목록](native-validation.md)에 있습니다. 같은 최종 head의 전체 Actions 결과와 새 runner에서의 실제 Speech·UI 3회 결과를 별도로 확보해야 합니다. 테스트 수 감소, fixture 결과나 선택 실행 하나로 안정성·속도·전체 완료를 주장하지 않습니다.

## 초안 PR과 집중 검증

초안 PR은 정적 검사와 단위 테스트를 자동으로 실행하며, 전체 네이티브 실행은 관리자 승인 전까지 대기합니다. 승인 거절·미승인·취소·미실행을 성공으로 처리하지 않습니다. 승인 후 실제 전체 검증이 성공해야 초안의 실행 보류 조건을 해제할 수 있으며, 최종 검증 전에는 PR을 초안으로 유지합니다. 선택 실행도 전체 필수 상태를 통과시키지 않습니다. 기존 보호 상태의 정확한 이름은 `scripts/release/ci-required-jobs.mjs`에 유지되며, 이름의 Detox 표기는 호환 목적이고 실행기는 XCTest/XCUITest입니다.

현재 후보 브랜치에서 원래 네이티브 사례 하나를 선택하려면 정확한 Swift 파일과 XCTest identifier를 지정합니다. PR 번호·저장소·열린 상태·base와 현재 head를 검증한 뒤 제품을 준비하고, 그 제품의 무결성을 확인한 consumer만 실행합니다.

```sh
gh workflow run e2e-test.yml --ref <PR-branch> \
  -f focus_pr_number=<PR-number> \
  -f focus_profile=native/fixtures \
  -f focus_scenario_file=apps/mobile/ios/OrotUITests/RootNavigationUITests.swift \
  -f focus_scenario_name=OrotUITests/RootNavigationUITests/testAiFeatureSafeAreaNativeActionsAndCancelledThenCompletedEdgeBack
```

선택 실행은 같은 승인 환경을 거친 뒤 Mac producer와 consumer 2개를 사용하고 선택·정확한 결과 검증은 Linux에서 처리합니다. 실패한 첫 시도와 원시 결과를 보존하고 원인이 확인된 변경 후에만 재실행합니다. 수동 입력은 집중 진단용이며 전체 검증을 시작하거나 충족하지 않습니다. 전체 검증은 후보 PR 변경으로 자동 생성된 실행을 관리자가 승인합니다. 최종 검증이 불완전하면 PR은 초안을 유지합니다.
