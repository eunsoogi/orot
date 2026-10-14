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

전체 CI는 Core 목록에 포함된 원래 Hermes 연결 사례를 실행하며, 같은 사례를 별도 UI 준비 단계에서 반복하거나 Device Hub를 추가로 실행하지 않습니다. 연결 사례의 성공은 접근성 준비 완료를 뜻하지 않습니다. UI 검증은 실제 버튼·스크롤 영역·키보드와 시스템 창의 관측 조건을 기다립니다. 합성 Calendar·HealthKit 자료나 계정 응답을 사용한 결과는 실제 개인 자료·계정·물리 기기의 검증과 구분합니다. Apple 모델 준비 실패, 인식 실패와 UI 입력·복귀 실패도 별도로 기록합니다. 기존 집중 진단 경로의 별도 연결 준비 결과는 전체 실행과 구분합니다.

네이티브 선택 검증은 기존 E2E workflow의 `focus_profile=native/<profile>`, `focus_scenario_file=apps/mobile/ios/<target>/<class>.swift`, `focus_scenario_name=<target>/<class>/<method>` 입력을 사용합니다. 후보 브랜치를 `--ref`로 지정하고 `focus_pr_number`를 함께 전달하면 workflow의 실제 SHA와 해당 PR의 저장소·브랜치·HEAD가 일치해야 실행합니다. 부분 이름이나 다른 프로필의 사례는 허용하지 않습니다. `backup`과 `local-model`은 상태를 이어받는 단계가 있으므로 각각 해당 클래스 파일과 `focus_scenario_name=all`을 지정해 전체 단계 그룹을 선택합니다. 선택 검증은 재시도 없이 검증된 제품을 사용하고, UI 사례는 별도의 앱 연결 준비를 거칩니다. 성공하더라도 보호된 전체 검증을 충족하지 않습니다.

전체 CI의 첫 Debug 작업은 의존성 설치·빌드·제품 다운로드·Simulator 생성 전에 같은 호스트의 Foundation Models 상태와 한국어 지원 여부를 확인합니다. `unsupportedDevice`와 `disabled`에는 준비 대기를 적용하지 않습니다. `available` 또는 `modelNotReady`이면 공개 `prewarm`을 한 번 호출하고, `modelNotReady` 상태에만 최대 30초의 준비 대기를 적용합니다. `prewarm`은 메모리 준비 요청이며 모델 설치나 활성화의 증거가 아닙니다. 이 선행 조건을 통과해도 실제 앱의 원래 생성·취소·검색 assertions가 모두 필요합니다.

같은 초기 단계에서 macOS 27의 공개 `fm --help`, `fm respond --help`와 무해한 프롬프트의 `fm respond`를 각각 한 번 기록합니다. 기본 온디바이스 모델을 사용하고 PCC나 다른 제공자를 선택하지 않습니다. 도움말 호출은 각각 5초, 응답 진단은 30초로 제한하며, Node 준비와 호스트 관측을 포함한 단계 전체에는 2분의 상한을 둡니다. 원래 앱 테스트의 시간 제한은 바꾸지 않습니다. Swift의 원래 availability enum과 CLI의 출력·오류 출력·종료 코드·타임아웃, 진단 전후의 PID·RSS·`vm_stat`·swap을 보존합니다. 알려진 부적격 상태에서도 이 짧은 CLI 진단을 남긴 뒤 빌드를 차단합니다. 명령 누락이나 실패를 성공으로 바꾸지 않으며, CLI 응답 성공도 실제 앱의 Apple Intelligence 테스트를 대체하지 않습니다.

전체 네이티브 CI는 Debug 빌드·검증, production·Release 빌드·검증, 새 러너의 Speech 검증 3개로 총 5개 macOS 작업을 계획합니다. 첫 측정 그래프는 Debug → Release → Speech 1 → 2 → 3 순서로 실행하며, 실패한 선행 작업 뒤에는 새 Mac을 할당하지 않습니다. 전체·집중·별도 Debug 실행은 저장소 단위 동시 실행 제한을 공유합니다. 실행 계획·선택·결과 집계는 Ubuntu에서 처리합니다. Debug와 Release는 빌드한 같은 VM에서 제품 무결성을 검증하므로 실행을 위한 중복 의존성 설치와 업로드·다운로드가 없습니다. Release 제품만 새 Speech 러너로 전달합니다. 생산용 앱과 OAuth 검증의 별도 flags·DerivedData 경로는 유지합니다. 기존 작업 상한과 개별 인식·생성·UI 대기 제한은 늘리지 않습니다. 성공 경로의 총 시간은 실제 측정으로 평가하며, 작업 수 감소나 조기 실패만으로 성능·모델 지원 문제가 해결됐다고 판단하지 않습니다.

Fixtures 22개는 `navigation`, `recordings`, `questions`, `calendar` 네 묶음으로 실행합니다. 일반 Release 실행 작업 한 개에서 같은 검증된 제품과 한 번 부팅한 전용 Simulator를 공유하며, 각 사례의 앱 컨테이너 초기화·삭제와 기존 제한 시간은 유지합니다. 전체 검증에는 네 묶음이 모두 필요합니다. 특정 묶음은 `focus_profile=native/fixtures`, `focus_scenario_file=scripts/ci/ios-test-fixture-groups.mjs`, `focus_scenario_name=group/<group>`으로 선택하며, `all`은 원래 22개 전체를 선택합니다. 분할에 따른 준비·대기 시간과 총 작업량은 실제 실행 결과로 비교합니다.

## 전체 CI와 제품 재사용

`E2E Test`는 PR 변경과 `main` push에서 네이티브 검증 graph를 자동으로 준비합니다. 초안 PR도 Mac 할당 전에 Linux 계획 작업의 `native-ci-admin-approval` 환경에서 관리자 승인을 기다립니다. 저장소 설정의 필수 검토자는 `eunsoogi`이며 관리자 우회는 허용하지 않습니다. 승인 없이 실행되거나 단순히 환경 이름만 존재하는 상태를 승인 완료로 간주하지 않습니다. 계획된 Mac 작업은 총 5개이며 현재 그래프에서는 하나씩 실행합니다. 같은 PR의 초안 상태 변경도 이전 실행을 중복 유지하지 않습니다. Linux에서 경로 선택, 실행 목록 검증, 결과 집계와 필수 상태를 처리합니다. 저장소 밖의 다른 Mac 사용량은 실제 실행 시 별도로 관측합니다.

Release producer는 기본 production 앱과 별도 OAuth harness를 각각 다른 flags·DerivedData로 먼저 검증하고, 같은 작업에서 네이티브 Release 제품을 만듭니다. 완료된 production·기본 Keychain·OAuth 검증은 현재 run·attempt·head의 결과 파일로 Linux 상태에 전달합니다. 뒤의 네이티브 컴파일이나 테스트 실패가 production 성공 기록을 지우지 않습니다. production 캐시는 실제 도구 버전·빌드 입력·CocoaPods 생성물·앱 digest를 확인하며, 네이티브 테스트 제품은 같은 실행의 검증된 artifact로 전달합니다.

cohort의 한 단계나 독립 fixture 사례가 실패하면 원래 로그와 결과를 보존하고 소유한 자료를 정리한 뒤 후속 실행을 중단합니다. 실행하지 않은 cohort 단계는 `not-run`, fixture는 `notRun` 목록에 기록하며 성공으로 집계하지 않습니다. 한 `xcodebuild` 호출 내부에서 여러 사례가 실행되는 경계는 별도이며, 이 스케줄링 중단만으로 모든 사례가 첫 실패 순간에 중단됐다고 주장하지 않습니다. 실패·누락·skip·취소·오래된 결과가 있으면 전체 검증은 실패합니다. Backup restore와 local-model 재실행의 종속 단계는 전용 순서를 유지합니다. Provider 프로필의 8개 원래 테스트도 필수입니다. `unsupportedDevice`가 남거나 실제 Apple Intelligence 테스트가 통과하지 못하면 머지하지 않습니다. 지원하지 않는 환경의 실패를 availability 성공, 스킵, 합성 응답, 대체 제공자나 별도 로컬 결과로 대체하지 않습니다.

원래 55개 요구사항과 대체 테스트, 과거 관측의 범위는 [네이티브 검증 목록](native-validation.md)에 있습니다. 전체 자동 CI는 같은 최종 head의 Speech 검증을 새 hosted runner에서 최대 3회 순차 실행합니다. 첫 검증은 기존 Speech cohort이며, 성공한 경우에만 두 번째 검증을 실행하고 두 번째도 성공해야 세 번째를 실행합니다. 각 검증은 실제 native 6개, 원래 UI 4개와 별도 asset 준비를 실행합니다. 첫 실패는 그대로 실패로 보존하고 후속 검증은 실패한 선행 조건으로 미실행 상태를 남깁니다. `first`, `second`, `third` 결과와 원시 artifact를 구분하며, Linux 집계는 같은 head·run·attempt의 완전한 결과 3개를 모두 요구합니다. 세 번의 성공은 초기 수락 표본이며 실패가 없다는 통계적 보장은 아닙니다. 테스트 수 감소, fixture 결과나 선택 실행 하나로 안정성·속도·전체 완료를 주장하지 않습니다.

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
