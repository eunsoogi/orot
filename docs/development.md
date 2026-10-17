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

GitHub Actions runs this canonical check as the direct `Source LOC policy` job in the `Code Quality` workflow. The required-check contract contains it alongside `Maintained file inventory`, ten `Lint / <surface>` checks, `Format check`, the type/unit/policy-test leaves, and six `Validate / <target>` checks. Repository protection reads each job check directly rather than a workflow summary; check-name changes require an authenticated comparison with the configured protection rules.

## iOS 빌드

```sh
pnpm ios:build
```

이 명령은 CocoaPods 의존성을 설치한 뒤 Simulator용 앱을 빌드합니다. Simulator 빌드에서는 코드 서명을 끕니다.

## iOS 통합 및 UI 검증

`OrotTests` scheme은 앱에서 실행되는 `OrotIntegrationTests`와 실제 화면을 조작하는 `OrotUITests`를 빌드합니다. 테스트 제품은 SDK 27, arm64와 테스트 전용 entry·컴파일 조건를 사용합니다. 기본 제품 빌드에는 테스트 명령 broker가 포함되지 않습니다. 프로필별 조건은 `scripts/ci/ios-test-config.mjs`, 실행할 정확한 test identifier는 `scripts/ci/ios-test-inventory.mjs`가 정의합니다.

Release 제품은 `core`, `speech`, `backup`, `fixtures`, `local-model`에서 공유합니다. Debug 제품은 `provider-data`, `health-import`, `microphone`, `provider-selection`에서 공유합니다. Speech 실행은 iOS 26.2 build 23C54와 iPhone SE 3세대를 사용하고, 나머지 프로필은 iOS 27과 iPhone 18 Pro를 사용합니다. 실행 runtime이 다르더라도 producer의 설정·flags·architecture·toolchain·entry와 제품 무결성이 같아야 공유할 수 있습니다.

GitHub가 제공하는 임시 macOS 러너에서는 checkout 직후, 도구 설치·의존성 복원·빌드·Simulator 준비 전에 독립 단계 `Disable and verify Spotlight`의 공통 bootstrap이 한 번 실행되어 Data 볼륨의 Spotlight 색인을 해제하고 실제 상태를 확인합니다. 명령은 실제 종료와 별도 상태 확인을 기다리고 결과를 `spotlight.log`에 남깁니다. 취소는 권한 경계 안의 supervisor가 소유한 하위 프로세스 그룹만 종료하고 회수합니다. 해제를 확인하지 못하면 해당 작업은 실패합니다. 모든 workflow·재사용 workflow·로컬 composite·matrix 경로는 정책 검사로 확인합니다. 개발용 Mac과 자체 호스팅 러너에서는 이 명령을 실행하지 않으며, Simulator 내부 서비스나 색인 파일을 삭제하지 않습니다.

로컬 Core 검증은 저장소 루트에서 다음 순서로 실행합니다. 기존 제품이나 소유권 파일과 겹치지 않는 경로를 사용하세요.

```sh
node scripts/ci/build-ios-tests.mjs core build/integration-tests-release
node scripts/ci/ios-test-simulator.mjs prepare core build/ios-core-owner.json
node scripts/ci/run-ios-state-persistence-tests.mjs build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/ios-core-owner.json build/ios-core-persistence && \
node scripts/ci/run-ios-fixture-isolation-tests.mjs build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/ios-core-owner.json build/ios-core-isolation && \
node scripts/ci/run-ios-recording-persistence-tests.mjs build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/ios-core-owner.json build/ios-core-recording-persistence && \
OROT_IOS_TEST_SUITE=integration node scripts/ci/run-ios-tests.mjs core build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/ios-core-owner.json build/ios-core-integration.xcresult && \
OROT_IOS_TEST_SUITE=integration node scripts/ci/ios-test-results.mjs core build/ios-core-integration.xcresult build/ios-core-integration-results.json && \
OROT_IOS_TEST_SUITE=ui node scripts/ci/run-ios-tests.mjs core build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.0-arm64.xctestrun build/ios-core-owner.json build/ios-core-ui.xcresult && \
OROT_IOS_TEST_SUITE=ui node scripts/ci/ios-test-results.mjs core build/ios-core-ui.xcresult build/ios-core-ui-results.json
node scripts/ci/ios-test-simulator.mjs cleanup core build/ios-core-owner.json
```

제품과 의존성을 준비한 뒤 기록된 기기만 부팅합니다. hosted 실행은 승인된 runtime을 확인한 뒤 공개 `simctl runtime dyld_shared_cache update <runtime>` 명령이 끝나야 Simulator를 생성·부팅합니다. 선택한 runtime만 대상으로 하며 강제 재생성이나 삭제는 하지 않습니다. 이 준비 시간과 resource samples도 전체 비용에 포함하고, 개발용 Mac과 자체 호스팅 러너에서는 이 단계를 추가하지 않습니다. `test-without-building`은 consumer에서 다시 컴파일하지 않습니다. CI는 run·attempt·source와 build input·제품 digest를 검증한 뒤 Simulator를 생성하며, 검증 실패를 빌드나 다른 제품으로 대체하지 않습니다. 실행은 한 destination과 worker를 사용하고 첫 실패·결과 bundle·첨부 자료·단계 시간·resource samples를 보존합니다.

Speech 자산 준비는 설치를 한 번 요청하고 실제 완료·오류·취소를 기다립니다. 테스트 준비용 180초 제한은 두지 않습니다. 요청 직전과 성공·실패 시점의 공개 `Progress` 수치를 첨부하며, 이 단위를 다운로드 바이트나 설치 성공으로 해석하지 않습니다. 준비 실행 중에는 소유 Simulator의 Orot 진단과 관측된 자산·Speech 프로세스의 공개 로그를 최대 8 MiB까지 보존합니다. 수집기 자체에 90분 상한을 두고 테스트 종료 시 해당 자식 프로세스만 정리합니다. 수집 실패·잘림·종료 확인 실패는 별도로 기록하며 원래 테스트 결과를 바꾸지 않습니다.

테스트 실행은 `-test-timeouts-enabled NO`를 명시하고 사례별 실행 허용 시간을 지정하지 않습니다. UI 조건·native broker·asset 설치·앱 receipt·일반 준비 명령은 실제 결과를 기다립니다. UI의 50ms run-loop 양보와 receipt의 50ms 확인 간격은 관측 주기이며 완료 제한이 아닙니다. receipt를 기다리는 동안 소유권과 `simctl launch`가 반환한 실제 PID의 생존을 확인하고, 다른 PID의 receipt·프로세스 종료·오류는 실패합니다. 끝나지 않은 조건을 성공으로 처리하지 않습니다. Apple 내부 접근성 IPC의 자체 중단·runner crash는 이 정책으로 해결됐다고 해석하지 않습니다.

공통 XCTest 준비·종료 단계는 호스트 소켓 대기를 별도 작업에서 수행해 메인 실행 흐름의 앱 상태 통지를 막지 않습니다. UI fixture 준비는 호스트 응답 뒤에도 XCTest가 `com.orot.mobile`의 `.notRunning` 상태를 직접 관측해야 본문에 진입합니다. 호스트 명령 완료와 XCTest의 상태 반영은 서로 다른 경계입니다. 이 관측에는 경과 시간 제한이나 앱 실행 재시도를 추가하지 않습니다. 실제 XCTest를 사용하는 메인 실행 흐름 회귀 검사는 macOS와 Xcode에서 `node --test scripts/ci/tests/ios-test-fixture-runloop.test.mjs`로 실행합니다. Apple XCTest가 없는 Linux에서는 이 검사만 실행하지 않으며, 현재 iOS 86개 사례의 필수 실행에는 영향을 주지 않습니다.

전체 hosted job의 `timeout-minutes`는 VM 실행·취소·artifact 및 소유 기기 정리를 위한 바깥 경계로 유지합니다. 실패 뒤 선택적으로 수집하는 설치 상태 5초·앱 로그 30초, resource sample 10초, 진단 수집기의 용량·수명과 종료 유예는 보조 관측과 소유 자식 정리만 제한합니다. 이들은 테스트 성공을 만들거나 본문을 재시도하지 않으며 관측 실패는 별도로 남깁니다. 제품의 25초 녹음 자동 종료와 실제 Speech 서비스 취소는 제품 요구사항으로 유지합니다.

녹음 Stop 검증의 `seed`·`route` 진입점은 전용 Simulator 빌드에서 합성 전체 음원만 실제 `AVAudioPlayer`로 반복 재생합니다. 사용자 Stop을 누를 때까지 음원의 짧은 수명에 의존하지 않으며, `resume` 진입점은 같은 저장 파일을 한 번 재생해 자연 종료를 검증합니다. 전용 fixture는 실제 native progress와 종료 Promise를 지속되는 관측 값으로 남깁니다. 정확한 `00:01` 표시는 컴포넌트 검증에서 유지하고, E2E는 실제 재생 위치·명시적 Stop·자연 종료·재시작을 확인합니다.

테스트 실행 helper는 호출마다 새 UUID를 전달합니다. 테스트 target에만 포함되는 공통 기본 클래스는 현재 사례 이름을 해당 runner의 컨테이너에 기록하고, 정리 단계까지 성공했을 때 지웁니다. 실패나 runner 크래시가 남긴 기록은 같은 호출의 후속 본문을 건너뛰게 합니다. 원래 실패와 미실행 사례는 결과에 남으며, 누락·건너뜀은 기존 결과 검증에서 통과하지 못합니다. runner가 기본 설정에 도달하기 전의 시작 실패는 이 기록으로 차단할 수 없습니다. Core 통합·UI 검증은 독립 작업으로 실행합니다. Speech는 자산 준비와 native 인식이 성공해야 실제 인식 자료를 사용하는 UI·새 프로세스 readback 단계를 실행합니다. 각 target은 서로 다른 컨테이너를 사용합니다. Xcode에서 테스트를 직접 실행할 때도 새 `OROT_IOS_TEST_INVOCATION` UUID를 runner 환경에 지정해야 합니다.

`fixtures`, `health-import`, `microphone`, `provider-selection`은 `run-ios-fixture-tests.mjs`로 실행합니다. 일반 Release UI 사례는 설치된 제품을 유지하고, React가 시작되기 전에 앱 소유 DB·WAL·SHM·녹음·삭제 대기열·내보내기 사본·Keychain 항목·설정과 권한을 초기화합니다. helper는 실제 부재와 권한 미결정 상태를 읽어 확인하며, 같은 묶음의 다음 사례가 시작할 때 한 번만 초기화합니다. 마지막 사례와 실패 직후에는 바로 정리합니다. 저장소 생성·schema migration·키 수명주기·native permission 사례는 전체 재설치와 Keychain 초기화를 유지합니다. Backup snapshot과 local-model 재실행 단계는 전용 helper의 순서대로 자료를 이어받습니다. 다른 프로필의 기기나 다른 앱을 초기화하지 마세요.

Core의 `state-persistence`는 명시적인 fresh-install 단계에서 실제 SQLCipher 저장소·메모리·UTF-8 checkpoint를 만들고, 세 개의 서로 다른 앱 프로세스에서 복원·노드 재실행 방지·삭제 후 검색 부재를 확인합니다. `isolation`은 실제 DB·파일·키·설정·권한 오염을 넣은 뒤 제거와 외부 sentinel 보존, 새 DB 키 생성을 확인합니다. 두 XCTest 앱 프로세스가 각각 React와 DB를 열기 전에 자기 상태를 초기화하고 같은 프로세스의 전후 영수증을 남깁니다. 별도 초기화 앱 실행의 상태를 다음 프로세스에 넘기지 않습니다. 호스트는 각 XCTest 전에 권한을 초기화하고, 실제 DB 프로세스가 종료된 뒤 파일·Keychain 오염을 한 번 주입합니다. 설정 오염과 외부 설정 sentinel은 초기화를 수행할 네이티브 프로세스가 직접 준비하며, 별도 프로세스의 설정 저장 상태를 전제로 하지 않습니다. 설정은 명시된 소유 키만 지우며 외부 파일·Keychain·설정 sentinel은 보존합니다. 초기화 직후와 React 시작 후의 실제 XCTest 프로세스에서 소유 키의 부재를 각각 확인합니다. `recording-persistence`는 수정 이력·stale evidence·메모리 무효화·삭제와 중단된 export 사본을 두 프로세스에서 확인합니다. 상태를 이어받는 단계 사이에는 초기화하지 않으며, 같은 프로세스이거나 앞 단계의 영수증이 없으면 실패합니다. Speech의 `journey`도 실제 화면 정지·저장과 실제 Apple Speech 연결을 한 번 실행한 뒤 별도 앱 프로세스에서 모든 저장 필드와 네이티브 Speech 요청 수 0을 확인합니다.

화면 모드 검증은 XCTest의 공개 기기 API로 모드를 변경하고 실제 읽기 값을 확인합니다. 명시적으로 켠 테스트 진입점은 해당 값을 같은 앱 창에 다시 적용하고, 실제 UIKit trait으로 React Native 테마 알림을 갱신합니다. 실행기 호출마다 분리한 UUID 알림 채널을 사용하며 설정 앱이나 프로세스 재시작은 필요하지 않습니다. 기기·UIKit 창·앱의 실제 `useColorScheme` 값, 창 재적용 방식과 횟수, 앱 스크린샷을 남깁니다. 원래 기기 모드와 창의 override를 복원하고 기존 화면 동작·저장 상태·레이아웃 검증을 수행합니다. 이 보정은 테스트 제품에만 포함되며 OS가 모드를 앱에 자동 전달했다는 증거로 해석하지 않습니다.

마이크 진단은 첫 시스템 권한 응답이 앱의 비활성·활성 전환보다 먼저 도착할 수 있으므로, 권한 허용과 이후 앱 활성화를 모두 확인한 뒤 실제 녹음을 시작합니다. 이미 권한이 결정되어 있고 앱이 활성 상태이면 새 전환을 기다리지 않습니다. 거부나 취소는 한 번만 처리하며, 실제 녹음 중의 중단·파일 정리와 기존 25초 제한은 유지합니다. 이 준비 절차는 테스트 전용 모듈에만 적용합니다.

전체 CI는 Core 목록에 포함된 원래 Hermes 연결 사례를 실행하며, 같은 사례를 별도 UI 준비 단계에서 반복하거나 Device Hub를 추가로 실행하지 않습니다. 연결 사례의 성공은 접근성 준비 완료를 뜻하지 않습니다. UI 검증은 실제 버튼·스크롤 영역·키보드와 시스템 창의 관측 조건을 기다립니다. 합성 Calendar·HealthKit 자료나 계정 응답을 사용한 결과는 실제 개인 자료·계정·물리 기기의 검증과 구분합니다. Apple 모델 준비 실패, 인식 실패와 UI 입력·복귀 실패도 별도로 기록합니다. 기존 집중 진단 경로의 별도 연결 준비 결과는 전체 실행과 구분합니다.

iOS 선택 검증은 독립된 `E2E Test - Selected` workflow(`e2e-selected.yml`)의 `focus_profile=ios/<profile>`, `focus_scenario_file=apps/mobile/ios/<target>/<class>.swift`, `focus_scenario_name=<target>/<class>/<method>` 입력을 사용합니다. 후보 브랜치를 `--ref`로 지정하고 `focus_pr_number`를 함께 전달하면 workflow의 실제 SHA와 해당 PR의 저장소·브랜치·HEAD가 일치해야 실행합니다. 부분 이름이나 다른 프로필의 사례는 허용하지 않습니다. `backup`과 `local-model`은 상태를 이어받는 단계가 있으므로 각각 해당 클래스 파일과 `focus_scenario_name=all`을 지정해 전체 단계 그룹을 선택합니다. 선택 검증은 재시도 없이 검증된 제품을 사용하고, UI 사례는 별도의 앱 연결 준비를 거칩니다. 선택 결과는 자체 검사로 보고하며 보호된 전체 검증을 충족하지 않습니다.

전체 release dispatch는 Debug 17개, Release 60개, Speech 9개로 총 86개의 서로 다른 관측을 각각 한 번씩 실행하며 별도 선택 사례를 뒤에 추가하지 않습니다. Ready PR은 변경 영향으로 선택한 cohort만 실행합니다. 집중 진단은 `run-ios-focused-tests.sh`를 사용하는 별도 workflow로 유지합니다. Ready PR의 merge checkout과 수동 선택의 PR head 확인은 각각 실제 실행 SHA에 묶이며, 집중 진단의 성공을 전체 실행의 성공으로 집계하지 않습니다.

실제 실행·초기화 driver는 Apple 도구를 호출하기 전에 새 `simctl list -j` 응답의 runtime과 기기 정보를 함께 확인합니다. Simulator를 변경하지 않는 cohort 조정기는 소유권 계약만 확인하며 같은 상태 조회를 중복 실행하지 않습니다. fixture의 초기화·삭제 전 검증 결과를 다음 변경까지 캐시하지 않습니다. Simulator 명령은 시작·종료 시점과 소요 시간·종료 상태를 stderr에 남기며, stdout을 사용하는 기존 호출 결과와 분리합니다. UI 위치는 같은 판정이나 제스처 준비 안에서 한 번 읽고, 다음 판정이나 제스처 뒤에는 다시 관측합니다. 이 변경의 실제 시간 절감 여부는 동일한 검증 범위의 실행 자료로 판단합니다.

테스트의 Foundation Models 호출은 `OROT_TESTS`로 컴파일한 Simulator 제품에서만 mock으로 대체합니다. 정해진 원본 문자열·JSON·스트리밍 snapshot·오류를 SDK 호출 경계에 주입하고, 실제 JavaScript 직렬화·React Native 브리지·스키마 처리·응답 정규화·요청 취소와 앱 workflow를 검증합니다. 지정하지 않은 요청, 다른 요청에 속한 응답, 남은 응답은 실패입니다. 생성 결과의 출처 보존, 스트리밍 완료·취소·재작성 거부, 사용 불가·오류 처리, Calendar 분류·중복 없는 저장·근거가 연결된 질문과 RAG 연결을 확인합니다. RAG의 공개 Europe PMC 조회는 실제 네트워크를 사용하며 모델의 최종 문구는 고정된 테스트 응답입니다.

일반 CI는 호스트 Apple Intelligence 지원·활성화·모델 다운로드나 CLI 약관 동의를 요구하지 않습니다. 결과에는 `modelExecution=mock`, `actualModel=not-run`을 남기며 실제 Apple 모델의 응답 품질이나 추론 실행을 검증했다고 해석하지 않습니다. 제품 빌드의 기본 경로는 실제 Apple SDK를 사용합니다. 빌드 후 앱에 연결된 기호를 검사하여 생산용 제품에는 mock 제어 endpoint가 없고 실제 `LanguageModelSession`이 연결되어 있으며, 테스트 제품에는 반대로 mock만 연결되어 있음을 확인합니다. 실행 인자나 환경 변수로 생산용 앱의 mock을 켤 수 없습니다.

전체 release E2E graph는 Debug·Release·Production·OAuth 빌드 작업 4개와 기능별 iOS 실행 15개, OAuth 실행 1개로 나눕니다. Ready PR은 영향 분석에 선택된 설정과 cohort만 실행합니다. 모든 빌드와 테스트 실행은 별도 VM입니다. Debug의 Provider·Health·Microphone·Selection, Release의 Core·UI·Persistence·Isolation·Backup·Local model·Navigation·Recordings·Questions·Calendar·Speech는 호환되는 빌드 산출물만 기다립니다. 독립 기능 작업 사이에는 의존성을 두지 않습니다. 전체 release graph는 총 20개 Mac 작업과 최대 17개의 동시 실행을 허용하지만, 이는 계정의 실제 동시 실행 한도나 시작 시간을 보장하지 않습니다. 전체·집중 실행은 저장소 단위 동시 실행 제한을 공유하며 같은 그룹의 대기 실행을 최대 100개까지 보존합니다. 대기열이 가득 차면 새 실행이 취소되므로 해당 검사는 성공으로 처리하지 않습니다. 계획·선택·결과 집계는 Ubuntu에서 처리합니다. 각 소비 작업은 제품의 출처·설정·도구·무결성을 실행 전에 검증하며 컴파일하지 않습니다. 실행 helper는 Node 기본 모듈과 저장소에 있는 코드만 사용하므로 소비 VM에서는 앱 의존성을 다시 설치하지 않습니다. 고정 의존성 설치와 번들 생성은 빌드 작업이 담당합니다. 실제 대기·준비·전송·부팅·실행 시간과 총 Mac 사용 시간을 따로 측정합니다.

Release 60개 관측과 Speech 9개 관측은 위의 독립 기능 작업 11개에 정확히 한 번씩 배정됩니다. 각 작업은 전용 Simulator 하나를 사용합니다. UI fixture 21개는 Navigation·Recordings·Questions·Calendar와 독립된 사례별 초기화를 유지합니다. `run-ios-fixture-tests.mjs`를 사용하는 네 프로필의 독립 UI 사례와 Backup의 독립된 첫 세 사례는 선택한 묶음마다 XCTest 실행기를 한 번 시작합니다. 실행기의 공통 XCTest 준비·종료 경계는 호스트가 먼저 연 loopback 소켓에 사례마다 연결해 기존 초기화·정리를 기다립니다. 세션·요청 UUID가 일치하는 응답만 인정하며, 호스트 종료로 연결이 끊기거나 응답이 잘못되면 실패합니다. 파일 반복 조회나 별도 생존 확인, 고정 대기 제한은 추가하지 않습니다. 앱 재시작이나 assertion은 변경하지 않으며, 첫 실패 뒤의 기존 fail-fast 표식은 후속 준비를 막습니다. 요청·준비·정리 실패와 원본 xcresult의 실패·skip·미실행은 성공으로 처리하지 않습니다. Backup 복원과 local-model 재실행은 실제 데이터 의존이 있어 원래 순서를 유지합니다. Persistence는 저장 상태 3단계와 녹음 자료 2단계를 3개의 새 프로세스로 묶습니다. 첫 설치·키 생성은 첫 프로세스에서 단독 검증하고, 다음 두 프로세스는 서로 다른 UUID를 쓰는 저장 상태와 녹음 자료 검증을 함께 실행합니다. 단계 사이에는 초기화하지 않으며 두 영역의 실제 PID와 원래 판정 결과를 모두 확인합니다. 특정 fixture 묶음은 `focus_profile=ios/fixtures`, `focus_scenario_file=scripts/ci/ios-test-fixture-groups.mjs`, `focus_scenario_name=group/<group>`으로 선택하며, `all`은 UI 21개 전체를 선택합니다. 독립 선택 실행의 상태 그룹은 각각 `scripts/ci/state-persistence-test-phases.mjs`와 `group/state-persistence`, `scripts/ci/fixture-isolation-test-phases.mjs`와 `group/isolation`, `scripts/ci/recording-persistence-test-phases.mjs`와 `group/recording-persistence`를 지정합니다. Speech는 `scripts/ci/speech-journey-test-phases.mjs`와 `group/journey`를 지정하며 단일 단계 선택은 허용하지 않습니다.

## 전체 CI와 제품 재사용

`E2E Test`는 PR의 `opened`·`synchronize`·`reopened`·`ready_for_review`·`converted_to_draft`·`edited` 이벤트에서 Linux 영향 분석을 수행합니다. 초안과 제목·본문만 바꾼 이벤트는 선택 기록을 남기고 Mac runner를 시작하지 않습니다. Ready 전환·재오픈·새 head·base branch 변경은 현재 head를 다시 비교하며, 영향을 받는 cohort가 있을 때만 Mac 작업을 시작합니다. `main` push에는 E2E workflow를 연결하지 않고, release 때 `main`에서 수동 dispatch해 전체 검증 graph를 실행합니다. 전체·선택 CI는 deployment environment를 사용하지 않습니다. GitHub는 workflow 이름과 check 이름을 함께 표시합니다. `E2E Test / Build / Debug`, `E2E Test / Test / Speech`처럼 역할·짧은 대상으로 통일하고, check 이름에 E2E를 다시 붙이지 않습니다. draft·metadata-only 이벤트는 `Deferred /` check 이름을 사용해 보호된 Ready 결과와 분리합니다. 기능별 호출을 명시적 독립 작업으로 선언해 matrix 괄호·내부 파라미터·시간 제한 숫자가 이름에 나타나지 않게 합니다. 집중 진단은 `E2E Test - Selected / iOS /` 아래에서 Plan·Build·Test·Validate 단계와 대상을 표시합니다. Linux에서 경로 선택, 실행 목록 검증, 결과 집계와 필수 상태를 처리합니다. 저장소 밖의 다른 Mac 사용량과 실제 runner 대기는 실행 시 별도로 관측합니다.

전체·선택 entry workflow는 Linux 선택부터 결과 집계까지 같은 저장소 실행 구간을 공유하므로 서로 겹치지 않습니다. 별도 `Cancel superseded CI`는 같은 PR의 이전 head와 재오픈·Ready·초안 전환·base branch 변경 이벤트보다 먼저 시작된 같은 head 실행을 취소합니다. 제목·본문만 바뀐 `edited` 이벤트는 취소하지 않습니다. 이 관리 작업에만 Actions 쓰기 권한을 주며, checkout 없이 정적 코드로 정확한 저장소·workflow·PR·base·head를 다시 확인합니다. 다른 PR·workflow·수동 release 실행·현재 이벤트 뒤에 시작한 run은 제외하고, 실행 identity나 시간 순서가 모호하면 실행을 보존합니다. 현재 실행을 제외한 뒤 이전 run의 attempt까지 다시 확인합니다. 집중 실행 취소는 해당 PR의 별도 그룹으로 한정하며, 실행을 시작할 때도 실제 PR head를 다시 검증합니다.

Production 빌드는 기본 entry·flags의 앱, 실제 Apple SDK 연결, 기본 Keychain 설정을 검증합니다. OAuth 빌드는 별도 DerivedData에서 Simulator harness와 macOS XCTest bundle을 컴파일하고 정확한 test inventory·내장 fixture·source·run·attempt·toolchain·digest를 함께 전달합니다. OAuth 실행은 이를 검증한 뒤 별도 VM에서 68개 package 테스트를 컴파일 없이 실행합니다. 실행 결과와 두 빌드 의무는 Linux의 Build 상태가 함께 검증합니다. Production과 OAuth는 Debug·Release producer의 선행 조건이 아니며 모두 최종 통과 조건으로 남습니다. 독립 iOS 컴파일이나 테스트 실패가 완료된 생산용 결과를 지우지 않습니다.

production 캐시는 복원과 저장을 분리합니다. 캐시에 포함되는 기본 앱의 빌드·Apple SDK 연결·Keychain 의무와 manifest 검증이 성공하면 전용 빌드 작업에서 DerivedData·Pods를 저장합니다. 별도로 전달하는 OAuth 제품은 이 캐시에 포함하지 않으며 OAuth 실행 성공은 최종 Build와 전체 집계에서 요구합니다. 앞 단계가 실패하거나 production이 아닌 실행은 저장하지 않고, 정확한 cache key가 이미 있으면 중복 저장하지 않습니다. 이후 테스트 실패는 전체 검증을 실패로 유지합니다. 실제 재사용 여부는 다음 실행의 cache hit, 입력·제품 검증, `app_reusable`과 컴파일 생략을 확인하며 저장·복원 비용도 함께 측정합니다.

cohort의 한 단계나 독립 fixture 사례가 실패하면 원래 로그와 결과를 보존하고 소유한 자료를 정리한 뒤 후속 실행을 중단합니다. 실행하지 않은 cohort 단계는 `not-run`, fixture는 `notRun` 목록에 기록하며 성공으로 집계하지 않습니다. 한 `xcodebuild` 호출 내부에서 여러 사례가 실행되는 경계는 별도이며, 이 스케줄링 중단만으로 모든 사례가 첫 실패 순간에 중단됐다고 주장하지 않습니다. 실패·누락·skip·취소·오래된 결과가 있으면 전체 검증은 실패합니다. Backup restore와 local-model 재실행의 종속 단계는 전용 순서를 유지합니다. Provider 프로필의 8개 원래 테스트도 필수입니다. Foundation Models 관련 네 사례는 명시적인 mock 응답으로 앱·브리지·workflow를 검증합니다. mock 결과를 실제 Apple 모델 실행으로 표시하거나, 실패한 앱 동작을 skip으로 처리하지 않습니다. Speech와 다른 원래 검증의 실제 실행 요구는 유지합니다.

원래 55개 요구사항과 대체 테스트·판정 기준·초기화·비용·실패 이력은 [iOS 검증 목록](ios-validation.md)에 있습니다. 전체 release 검증은 Debug 17개, Release 60개, Speech 9개 관측을 포함합니다. Speech는 asset 준비 1개, 실제 통합 테스트 6개, 화면 저장 1개와 별도 프로세스의 저장 자료 검증 1개를 한 번씩 실행합니다. Ready PR은 변경 영향 분석이 고른 완전한 cohort만 실행하며 선택하지 않은 cohort도 결과에 명시합니다. Linux 집계는 현재 head·run·attempt의 각 선택 cohort 보고서를 확인하고, 전체 release dispatch에서는 15개 cohort와 86개 관측 및 네 빌드·OAuth 실행을 요구합니다. 원시 artifact와 결과 파일도 run·attempt별로 분리하며 다른 실행의 성공을 재사용해 통과시키지 않습니다.

#198의 수락에는 최종 후보에서 전체 CI 한 번의 성공이 필요합니다. 각 관측은 해당 실행 안에서 한 번 수행하며, 세 번의 성공을 모으기 위한 추가 전체 실행이나 Speech 반복은 하지 않습니다. 후보 head와 실제 checkout, run·attempt, 전체 결과와 첫 실패를 보존합니다. 실패 원인을 수정해 후보가 바뀌면 변경된 후보에 필요한 검증을 수행하며 이전 성공을 새 후보의 결과로 사용하지 않습니다. 실패한 작업만 재실행하거나 focused 결과로 전체 검증을 대신하지 않습니다. 한 번의 성공이 장기적인 안정성을 통계적으로 보장하지는 않습니다.

## 초안 PR과 집중 검증

초안 PR도 정적 검사와 단위 테스트를 실행하지만 E2E 선택 기록만 남기고 Mac test runner를 시작하지 않습니다. 초안이나 제목·본문만 수정한 이벤트는 `Deferred /` 상태 이름을 사용해 보호된 Ready PR 결과를 덮어쓰지 않습니다. Ready 전환, Ready PR의 새 head, 재오픈, base branch 변경은 현재 head의 영향 분석을 다시 실행하며 제목·본문 수정은 native E2E를 시작하지 않습니다. unknown·shared 변경은 모든 cohort로 확장하고, 선택된 결과가 실패·누락·취소되면 관련 보호 상태가 실패합니다. 선택되지 않은 cohort와 실제 실행한 cohort는 selection 및 result artifact에 분리해 기록합니다.

보호 상태의 정확한 이름은 `scripts/release/ci-required-jobs.mjs`에서 관리합니다. iOS 필수 상태는 `Validate /` 아래의 Build·UI·Storage·Provider·Speech·Questions 여섯 개입니다. Build는 production 검증을, 관련 도메인 상태는 자기 영향 범위에 포함된 cohort의 집계 결과를 확인합니다. main push에서는 전체 E2E를 반복하지 않으며 release 시 `E2E Test`를 `main`에서 직접 dispatch해 전체 inventory를 검증합니다. `e2e-selected.yml`은 계속 수동 진단용이며 release 증거로 사용할 수 없습니다. 상태 이름을 바꿀 때는 실제 생성된 이름과 저장소 보호 설정의 22개 필수 검사를 함께 확인합니다.

`Code Quality`·`Policy Check`·`Unit Test`는 PR의 `opened`·`synchronize`·`reopened`와 `main` push에서 실행하며 ready·draft 상태 전환만으로 새 실행을 시작하지 않습니다. `E2E Test`는 위 PR 이벤트와 main의 release dispatch에서 별도로 실행합니다. draft 전환은 `Deferred /` 이름으로 선택 결정만 기록하고, ready 전환은 현재 head의 선택 결과를 실행합니다. stale-run 관리 작업은 재검증을 시작하는 ready·reopen·base 변경·draft 전환에 앞서 시작된 같은 PR의 이전 실행을 정리하며, 제목·본문만 수정한 이벤트는 기존 실행을 취소하지 않습니다.

현재 후보 브랜치에서 원래 iOS 사례 하나를 선택하려면 정확한 Swift 파일과 XCTest identifier를 지정합니다. PR 번호·저장소·열린 상태·브랜치·현재 head를 검증한 뒤 제품을 준비하고, 그 제품의 무결성을 확인한 consumer만 실행합니다. 최초 도입 시에는 수동 workflow의 [기본 브랜치 등록 요건](https://docs.github.com/en/actions/how-tos/manage-workflow-runs/manually-run-a-workflow)을 먼저 확인합니다. PR 브랜치에 새 파일이 있다는 사실만으로 수동 진입점이 준비됐다고 판단하지 않습니다.

```sh
gh workflow run e2e-selected.yml --ref <PR-branch> \
  -f focus_pr_number=<PR-number> \
  -f focus_profile=ios/fixtures \
  -f focus_scenario_file=apps/mobile/ios/OrotUITests/RootNavigationUITests.swift \
  -f focus_scenario_name=OrotUITests/RootNavigationUITests/testAiFeatureSafeAreaActionsAndCancelledThenCompletedEdgeBack
```

선택 실행은 전체·영향 기반 PR E2E와 별도 진단 경로이며 관리자 승인 없이 Mac producer와 consumer 2개를 사용하고 선택·정확한 결과 검증은 Linux에서 처리합니다. 전체 release 검증 말미에 같은 사례를 추가로 반복하지 않습니다. 실패한 첫 시도와 원시 결과를 보존하고 원인이 확인된 변경 후에만 재실행합니다. `e2e-test.yml`의 `workflow_dispatch`는 `main`에서 전체 inventory와 보호 상태를 검증하는 release entry입니다. `e2e-selected.yml`은 특정 사례를 수동 실행하는 진단 entry로 유지합니다. 집중 실행의 성공·실패·skip·취소는 자체 검사에만 남고 전체 필수 `Validate /` 검사 여섯 개를 생성하지 않습니다. 따라서 같은 SHA의 전체 검사 결과를 덮지 않으며, 집중 실행만 있는 SHA는 전체 검증을 충족하지 못합니다. Ready PR은 현재 head에서 영향 분석에 선택된 cohort를 실행하고, 최종 release 검증은 `main`에서 전체 dispatch로 시작합니다. 최종 검증이 불완전하면 PR은 초안을 유지합니다.
