# 개발 안내

Orot은 `apps/mobile`의 iOS 앱과 루트 pnpm workspace로 구성되어 있습니다. 이후 공유 패키지는 `packages/*` 아래에 둡니다.

화면을 구현할 때는 [디자인 시스템](../DESIGN.md)을 참고하세요.

## 개발 환경

| 도구                                                | 버전                                               |
| --------------------------------------------------- | -------------------------------------------------- |
| macOS                                               | 버전은 진단 및 캐시 식별에 기록하며 고정하지 않음  |
| Node.js                                             | 22.23.2 (`.nvmrc`; React Native는 22.13 이상 필요) |
| pnpm                                                | 12.3.4                                             |
| React Native / React                                | 0.87.1 / 19.2.3                                    |
| Jest / React Native Testing Library / test-renderer | 29.7.0 / 14.0.1 / 1.2.0                            |
| Xcode                                               | 27.0                                               |
| Ruby / CocoaPods                                    | 4.0.7 / 1.17.0 (Homebrew)                          |

iOS 빌드와 iOS 테스트를 실행하기 전에 Xcode에서 iOS Simulator 런타임을 설치하세요. CocoaPods가 없다면 `brew install cocoapods`로 설치합니다.

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

GitHub Actions runs this canonical check as the direct `Source LOC policy` job in the `Code Quality` workflow. Branch protection requires it alongside `Maintained file inventory`, ten `Lint / <surface>` checks, `Format check`, the type/unit/policy-test leaves, the production/OAuth `iOS Simulator Build`, and five domain checks backed by complete iOS validation. Branch protection reads each job check directly rather than a workflow summary.

## iOS 빌드

```sh
pnpm ios:build
```

이 명령은 CocoaPods 의존성을 설치한 뒤 Simulator용 앱을 빌드합니다. Simulator 빌드에서는 코드 서명을 끕니다.

## iOS 통합 및 UI 검증

`OrotTests` scheme은 앱에서 실행되는 `OrotIntegrationTests`와 실제 화면을 조작하는 `OrotUITests`를 빌드합니다. 테스트 제품은 SDK 27, arm64와 테스트 전용 entry·컴파일 조건를 사용합니다. 기본 제품 빌드에는 테스트 명령 broker가 포함되지 않습니다. 프로필별 조건은 `scripts/ci/ios-test-config.mjs`, 실행할 정확한 test identifier는 `scripts/ci/ios-test-inventory.mjs`가 정의합니다.

Release 제품은 `core`, `speech`, `backup`, `fixtures`, `local-model`에서 공유합니다. Debug 제품은 `provider-data`, `health-import`, `microphone`, `provider-selection`에서 공유합니다. Speech 실행은 iOS 26.2 build 23C54와 iPhone SE 3세대를 사용하고, 나머지 프로필은 iOS 27과 iPhone 18 Pro를 사용합니다. 실행 runtime이 다르더라도 producer의 설정·flags·architecture·toolchain·entry와 제품 무결성이 같아야 공유할 수 있습니다.

로컬 Core 검증은 저장소 루트에서 다음 순서로 실행합니다. 기존 제품이나 소유권 파일과 겹치지 않는 경로를 사용하세요.

```sh
node scripts/ci/build-ios-tests.mjs core build/integration-tests-release
node scripts/ci/ios-test-simulator.mjs prepare core build/ios-core-owner.json
OROT_IOS_TEST_SUITE=integration node scripts/ci/run-ios-tests.mjs core build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/ios-core-owner.json build/ios-core-integration.xcresult && \
OROT_IOS_TEST_SUITE=integration node scripts/ci/ios-test-results.mjs core build/ios-core-integration.xcresult build/ios-core-integration-results.json && \
OROT_IOS_TEST_SUITE=ui node scripts/ci/run-ios-tests.mjs core build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/ios-core-owner.json build/ios-core-ui.xcresult && \
OROT_IOS_TEST_SUITE=ui node scripts/ci/ios-test-results.mjs core build/ios-core-ui.xcresult build/ios-core-ui-results.json
node scripts/ci/ios-test-simulator.mjs cleanup core build/ios-core-owner.json
```

제품과 의존성을 준비한 뒤 기록된 기기만 부팅합니다. `test-without-building`은 consumer에서 다시 컴파일하지 않습니다. CI는 run·attempt·source와 build input·제품 digest를 검증한 뒤 Simulator를 생성하며, 검증 실패를 빌드나 다른 제품으로 대체하지 않습니다. 실행은 한 destination과 worker를 사용하고 첫 실패·결과 bundle·첨부 자료·단계 시간·resource samples를 보존합니다.

Speech 자산 준비는 한 번의 설치 요청과 기존 180초 제한을 유지합니다. 요청 직전과 성공·실패 시점의 공개 `Progress` 수치를 첨부하며, 이 단위를 다운로드 바이트나 설치 성공으로 해석하지 않습니다. 준비 실행 중에는 소유 Simulator의 Orot 진단과 관측된 자산·Speech 프로세스의 공개 로그를 최대 8 MiB까지 보존합니다. 수집기 자체에 90분 상한을 두고 테스트 종료 시 해당 자식 프로세스만 정리합니다. 수집 실패·잘림·종료 확인 실패는 별도로 기록하며 원래 테스트 결과를 바꾸지 않습니다.

테스트 실행 helper는 호출마다 새 UUID를 전달합니다. 테스트 target에만 포함되는 공통 기본 클래스는 현재 사례 이름을 해당 runner의 컨테이너에 기록하고, 정리 단계까지 성공했을 때 지웁니다. 실패나 runner 크래시가 남긴 기록은 같은 호출의 후속 본문을 건너뛰게 합니다. 원래 실패와 미실행 사례는 결과에 남으며, 누락·건너뜀은 기존 결과 검증에서 통과하지 못합니다. runner가 기본 설정에 도달하기 전의 시작 실패는 이 기록으로 차단할 수 없습니다. Core와 Speech의 iOS·UI target은 서로 다른 컨테이너를 쓰므로 앞 target의 검증이 성공해야 다음 target을 실행합니다. Xcode에서 테스트를 직접 실행할 때도 새 `OROT_IOS_TEST_INVOCATION` UUID를 runner 환경에 지정해야 합니다.

`fixtures`, `health-import`, `microphone`, `provider-selection`은 `run-ios-fixture-tests.mjs`로 실행합니다. 이 helper는 사례마다 소유한 앱과 Keychain을 초기화하고, 각 결과를 검증한 뒤 합성 앱 데이터를 제거합니다. `backup`의 snapshot 단계와 `local-model`의 재실행 단계는 각각 전용 helper의 순서를 따르며, process restart에 필요한 Keychain·자료를 유지합니다. 프로필이 다른 기기나 공유 Core·Speech 컨테이너를 이 helper로 초기화하지 마세요.

화면 모드 검증은 XCTest의 공개 기기 API로 모드를 변경하고 실제 읽기 값을 확인합니다. 명시적으로 켠 테스트 진입점은 해당 값을 같은 앱 창에 다시 적용하고, 실제 UIKit trait으로 React Native 테마 알림을 갱신합니다. 테스트마다 분리한 UUID 알림 채널을 사용하며 설정 앱이나 프로세스 재시작은 필요하지 않습니다. 기기·UIKit 창·앱의 실제 `useColorScheme` 값, 창 재적용 방식과 횟수, 앱 스크린샷을 남깁니다. 원래 기기 모드와 창의 override를 복원하고 기존 화면 동작·저장 상태·레이아웃 검증을 수행합니다. 이 보정은 테스트 제품에만 포함되며 OS가 모드를 앱에 자동 전달했다는 증거로 해석하지 않습니다.

마이크 진단은 첫 시스템 권한 응답이 앱의 비활성·활성 전환보다 먼저 도착할 수 있으므로, 권한 허용과 이후 앱 활성화를 모두 확인한 뒤 실제 녹음을 시작합니다. 이미 권한이 결정되어 있고 앱이 활성 상태이면 새 전환을 기다리지 않습니다. 거부나 취소는 한 번만 처리하며, 실제 녹음 중의 중단·파일 정리와 기존 25초 제한은 유지합니다. 이 준비 절차는 테스트 전용 모듈에만 적용합니다.

전체 CI는 Core 목록에 포함된 원래 Hermes 연결 사례를 실행하며, 같은 사례를 별도 UI 준비 단계에서 반복하거나 Device Hub를 추가로 실행하지 않습니다. 연결 사례의 성공은 접근성 준비 완료를 뜻하지 않습니다. UI 검증은 실제 버튼·스크롤 영역·키보드와 시스템 창의 관측 조건을 기다립니다. 합성 Calendar·HealthKit 자료나 계정 응답을 사용한 결과는 실제 개인 자료·계정·물리 기기의 검증과 구분합니다. Apple 모델 준비 실패, 인식 실패와 UI 입력·복귀 실패도 별도로 기록합니다. 기존 집중 진단 경로의 별도 연결 준비 결과는 전체 실행과 구분합니다.

iOS 선택 검증은 기존 E2E workflow의 `focus_profile=ios/<profile>`, `focus_scenario_file=apps/mobile/ios/<target>/<class>.swift`, `focus_scenario_name=<target>/<class>/<method>` 입력을 사용합니다. 후보 브랜치를 `--ref`로 지정하고 `focus_pr_number`를 함께 전달하면 workflow의 실제 SHA와 해당 PR의 저장소·브랜치·HEAD가 일치해야 실행합니다. 부분 이름이나 다른 프로필의 사례는 허용하지 않습니다. `backup`과 `local-model`은 상태를 이어받는 단계가 있으므로 각각 해당 클래스 파일과 `focus_scenario_name=all`을 지정해 전체 단계 그룹을 선택합니다. 선택 검증은 재시도 없이 검증된 제품을 사용하고, UI 사례는 별도의 앱 연결 준비를 거칩니다. 성공하더라도 보호된 전체 검증을 충족하지 않습니다.

자동 전체 실행도 Debug와 Release의 원래 사례가 모두 성공한 뒤 각각 통합 사례 하나와 UI 사례 하나를 정확히 선택해 추가 실행합니다. 선택 검증과 같은 `run-ios-focused-tests.sh`를 사용하고, 이미 검증한 제품과 부팅한 소유 Simulator를 재사용합니다. 원래 전체 관측 100개와 추가 선택 관측 2개를 별도로 보존하며, 추가 빌드·부팅·Mac 작업은 없습니다. Linux 집계는 두 선택의 정확한 identifier와 제품의 source·run·attempt·configuration을 확인합니다. 전체 실행이나 추가 선택 중 하나가 실패하면 필수 검증도 실패합니다. 자동 PR의 merge checkout과 수동 선택의 PR head 확인은 각각 실제 실행 SHA에 묶입니다.

Simulator 소유권은 각 검증 호출에서 새 `simctl list -j` 응답의 runtime과 기기 정보를 함께 확인합니다. fixture의 초기화·삭제 전 검증 결과를 다음 변경까지 캐시하지 않습니다. Simulator 명령은 시작·종료 시점과 소요 시간·종료 상태를 stderr에 남기며, stdout을 사용하는 기존 호출 결과와 분리합니다. UI 위치는 같은 판정이나 제스처 준비 안에서 한 번 읽고, 다음 판정이나 제스처 뒤에는 다시 관측합니다. 이 변경의 실제 시간 절감 여부는 동일한 검증 범위의 실행 자료로 판단합니다.

테스트의 Foundation Models 호출은 `OROT_TESTS`로 컴파일한 Simulator 제품에서만 mock으로 대체합니다. 정해진 원본 문자열·JSON·스트리밍 snapshot·오류를 SDK 호출 경계에 주입하고, 실제 JavaScript 직렬화·React Native 브리지·스키마 처리·응답 정규화·요청 취소와 앱 workflow를 검증합니다. 지정하지 않은 요청, 다른 요청에 속한 응답, 남은 응답은 실패입니다. 생성 결과의 출처 보존, 스트리밍 완료·취소·재작성 거부, 사용 불가·오류 처리, Calendar 분류·중복 없는 저장·근거가 연결된 질문과 RAG 연결을 확인합니다. RAG의 공개 Europe PMC 조회는 실제 네트워크를 사용하며 모델의 최종 문구는 고정된 테스트 응답입니다.

일반 CI는 호스트 Apple Intelligence 지원·활성화·모델 다운로드나 CLI 약관 동의를 요구하지 않습니다. 결과에는 `modelExecution=mock`, `actualModel=not-run`을 남기며 실제 Apple 모델의 응답 품질이나 추론 실행을 검증했다고 해석하지 않습니다. 제품 빌드의 기본 경로는 실제 Apple SDK를 사용합니다. 빌드 후 앱에 연결된 기호를 검사하여 생산용 제품에는 mock 제어 endpoint가 없고 실제 `LanguageModelSession`이 연결되어 있으며, 테스트 제품에는 반대로 mock만 연결되어 있음을 확인합니다. 실행 인자나 환경 변수로 생산용 앱의 mock을 켤 수 없습니다.

전체 iOS CI 한 번은 Debug 빌드·검증, production·Release 빌드·검증, 새 러너의 Speech 검증을 각각 한 번씩 실행하는 총 3개 macOS 작업입니다. Debug와 Release는 독립 VM에서 동시에 실행할 수 있으며 최대 동시 Mac은 2개입니다. 두 작업이 모두 성공해야 Speech 작업을 할당합니다. 각 작업은 첫 실패에서 다음 사례를 중단하고 진단을 보존합니다. 한 작업이 실패해도 이미 시작한 독립 작업의 비용은 발생할 수 있으며, 그 뒤의 Speech 작업은 할당하지 않습니다. 전체·집중 실행은 저장소 단위 동시 실행 제한을 공유합니다. 실행 계획·선택·결과 집계는 Ubuntu에서 처리합니다. Debug와 Release는 빌드한 같은 VM에서 제품 무결성을 검증하므로 실행을 위한 중복 의존성 설치와 업로드·다운로드가 없습니다. Release 제품만 새 Speech 러너로 전달합니다. 생산용 앱과 OAuth 검증의 별도 flags·DerivedData 경로는 유지합니다. 기존 작업 상한과 개별 인식·생성·UI 대기 제한은 늘리지 않습니다. 성공 경로의 총 시간은 실제 측정으로 평가하며, 작업 수 감소나 조기 실패만으로 성능·모델 지원 문제가 해결됐다고 판단하지 않습니다.

Fixtures 22개는 `navigation`, `recordings`, `questions`, `calendar` 네 묶음으로 실행합니다. 일반 Release 실행 작업 한 개에서 같은 검증된 제품과 한 번 부팅한 전용 Simulator를 공유하며, 각 사례의 앱 컨테이너 초기화·삭제와 기존 제한 시간은 유지합니다. 전체 검증에는 네 묶음이 모두 필요합니다. 특정 묶음은 `focus_profile=ios/fixtures`, `focus_scenario_file=scripts/ci/ios-test-fixture-groups.mjs`, `focus_scenario_name=group/<group>`으로 선택하며, `all`은 원래 22개 전체를 선택합니다. 분할에 따른 준비·대기 시간과 총 작업량은 실제 실행 결과로 비교합니다.

## 전체 CI와 제품 재사용

`E2E Test`는 PR 변경과 `main` push에서 iOS 검증 graph를 자동으로 준비합니다. 초안 PR도 Mac 할당 전에 Linux 계획 작업의 `ios-ci-admin-approval` 환경에서 관리자 승인을 기다립니다. 저장소 설정의 필수 검토자는 `eunsoogi`이며 관리자 우회는 허용하지 않습니다. 승인 없이 실행되거나 단순히 환경 이름만 존재하는 상태를 승인 완료로 간주하지 않습니다. 계획된 Mac 작업은 총 3개이며 Debug와 Release를 독립 VM에서 병렬 실행한 뒤 두 작업이 모두 성공하면 Speech를 한 번 실행합니다. 같은 PR의 초안 상태 변경도 이전 실행을 중복 유지하지 않습니다. Linux에서 경로 선택, 실행 목록 검증, 결과 집계와 필수 상태를 처리합니다. 저장소 밖의 다른 Mac 사용량은 실제 실행 시 별도로 관측합니다.

Release producer는 기본 production 앱과 별도 OAuth harness를 각각 다른 flags·DerivedData로 먼저 검증하고, 같은 작업에서 iOS Release 제품을 만듭니다. 완료된 production·기본 Keychain·OAuth 검증은 현재 run·attempt·head의 결과 파일로 Linux 상태에 전달합니다. 뒤의 iOS 컴파일이나 테스트 실패가 production 성공 기록을 지우지 않습니다. production 캐시는 실제 도구 버전·빌드 입력·CocoaPods 생성물·앱 digest를 확인하며, iOS 테스트 제품은 같은 실행의 검증된 artifact로 전달합니다.

cohort의 한 단계나 독립 fixture 사례가 실패하면 원래 로그와 결과를 보존하고 소유한 자료를 정리한 뒤 후속 실행을 중단합니다. 실행하지 않은 cohort 단계는 `not-run`, fixture는 `notRun` 목록에 기록하며 성공으로 집계하지 않습니다. 한 `xcodebuild` 호출 내부에서 여러 사례가 실행되는 경계는 별도이며, 이 스케줄링 중단만으로 모든 사례가 첫 실패 순간에 중단됐다고 주장하지 않습니다. 실패·누락·skip·취소·오래된 결과가 있으면 전체 검증은 실패합니다. Backup restore와 local-model 재실행의 종속 단계는 전용 순서를 유지합니다. Provider 프로필의 8개 원래 테스트도 필수입니다. Foundation Models 관련 네 사례는 명시적인 mock 응답으로 앱·브리지·workflow를 검증합니다. mock 결과를 실제 Apple 모델 실행으로 표시하거나, 실패한 앱 동작을 skip으로 처리하지 않습니다. Speech와 다른 원래 검증의 실제 실행 요구는 유지합니다.

원래 55개 요구사항과 대체 테스트, 과거 관측의 범위는 [iOS 검증 목록](ios-validation.md)에 있습니다. 한 전체 실행은 Debug 17개, Release 50개, Speech 11개 관측을 포함합니다. Speech는 별도 asset 준비, 실제 통합 테스트 6개, 원래 UI 4개를 한 번씩 실행합니다. Linux 집계는 현재 head·run·attempt에 속한 세 cohort의 완전한 결과를 요구합니다. 원시 artifact와 결과 파일도 run·attempt별로 분리하며 다른 실행의 성공을 재사용해 통과시키지 않습니다.

#198의 세 차례 수락 표본은 같은 최종 후보에서 전체 CI를 각각 한 번씩 실행해 얻습니다. 최초 자동 전체 실행이 성공하면 관리자가 해당 실행의 모든 작업을 `gh run rerun <run-id> --repo eunsoogi/orot`으로 두 차례 더 실행하고 각 환경 승인을 처리합니다. 각 실행이 끝난 뒤 다음 실행을 시작하며, `--failed`나 특정 job 재실행은 전체 수락 표본으로 세지 않습니다. [GitHub의 전체 재실행](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/re-run-workflows-and-jobs?tool=cli)은 원래 SHA와 ref를 유지합니다. 후보 head와 실제 checkout, run·attempt, 전체 결과를 매번 확인하고 첫 실패와 이전 attempt를 보존합니다. 실패를 가리기 위한 자동 재시도는 두지 않으며, 실패 원인을 수정해 후보가 바뀌면 이전 성공을 새 후보의 표본으로 세지 않습니다. 세 번의 전체 성공은 초기 수락 표본이며 실패가 없다는 통계적 보장은 아닙니다.

## 초안 PR과 집중 검증

초안 PR은 정적 검사와 단위 테스트를 자동으로 실행하며, 전체 iOS 실행은 관리자 승인 전까지 대기합니다. 승인 거절·미승인·취소·미실행을 성공으로 처리하지 않습니다. 승인 후 실제 전체 검증이 성공해야 초안의 실행 보류 조건을 해제할 수 있으며, 최종 검증 전에는 PR을 초안으로 유지합니다. 선택 실행도 전체 필수 상태를 통과시키지 않습니다. 보호 상태의 정확한 이름은 `scripts/release/ci-required-jobs.mjs`에서 관리합니다. iOS 상태는 `iOS validation /` 아래의 Release UI and storage, Stateful data, Provider and capability, Speech transcription, Visit questions 다섯 개이며, 모두 동일한 전체 검증 결과를 요구합니다. 상태 이름을 바꿀 때는 실제 생성된 이름과 저장소 보호 설정의 22개 필수 검사를 함께 확인합니다.

현재 후보 브랜치에서 원래 iOS 사례 하나를 선택하려면 정확한 Swift 파일과 XCTest identifier를 지정합니다. PR 번호·저장소·열린 상태·base와 현재 head를 검증한 뒤 제품을 준비하고, 그 제품의 무결성을 확인한 consumer만 실행합니다.

```sh
gh workflow run e2e-test.yml --ref <PR-branch> \
  -f focus_pr_number=<PR-number> \
  -f focus_profile=ios/fixtures \
  -f focus_scenario_file=apps/mobile/ios/OrotUITests/RootNavigationUITests.swift \
  -f focus_scenario_name=OrotUITests/RootNavigationUITests/testAiFeatureSafeAreaActionsAndCancelledThenCompletedEdgeBack
```

선택 실행은 전체 CI와 별도 경로이며 같은 승인 환경을 거친 뒤 Mac producer와 consumer 2개를 사용하고 선택·정확한 결과 검증은 Linux에서 처리합니다. 전체 CI 말미에 같은 사례를 추가로 반복하지 않습니다. 실패한 첫 시도와 원시 결과를 보존하고 원인이 확인된 변경 후에만 재실행합니다. 수동 입력은 집중 진단용이며 전체 검증을 시작하거나 충족하지 않습니다. 전체 검증은 후보 PR 변경으로 자동 생성된 실행을 관리자가 승인합니다. 최종 검증이 불완전하면 PR은 초안을 유지합니다.
