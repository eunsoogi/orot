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
| Xcode                                               | 27.1                                               |
| Ruby / CocoaPods                                    | 4.0.7 / 1.17.0 (Homebrew)                          |

iOS 빌드와 iOS 테스트를 실행하기 전에 Xcode에서 iOS Simulator 런타임을 설치하세요. CocoaPods가 없다면 `brew install cocoapods`로 설치합니다.

`xcode-select -p`가 Command Line Tools 경로를 가리키면 Xcode 개발자 디렉터리를 지정해 의존성을 설치하고 iOS 명령을 실행하세요.

```sh
export DEVELOPER_DIR=/Applications/Xcode_27.1.app/Contents/Developer
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

GitHub Actions runs this canonical check as the direct `Source LOC policy` job in the `Code Quality` workflow. Repository protection requires 16 direct job checks across Code Quality, Unit Test, and Policy Check. The nightly E2E workflow's `Validate / <target>` checks are not required PR checks. Repository protection reads each job check directly rather than a workflow summary; check-name changes require an authenticated comparison with the configured protection rules.

## iOS 빌드

```sh
pnpm ios:build
```

이 명령은 CocoaPods 의존성을 설치한 뒤 Simulator용 앱을 빌드합니다. Simulator 빌드에서는 코드 서명을 끕니다.

## iOS 통합 및 UI 검증

`OrotTests` scheme은 앱에서 실행되는 `OrotIntegrationTests`와 실제 화면을 조작하는 `OrotUITests`를 빌드합니다. 테스트 제품은 SDK 27, arm64와 테스트 전용 entry·컴파일 조건를 사용합니다. 기본 제품 빌드에는 테스트 명령 broker가 포함되지 않습니다. 프로필별 조건은 `scripts/ci/ios-test-config.mjs`, 실행할 정확한 test identifier는 `scripts/ci/ios-test-inventory.mjs`가 정의합니다.

Release 제품은 `core`, `speech`, `backup`, `fixtures`, `local-model`에서 공유합니다. Debug 제품은 `provider-data`, `health-import`, `microphone`, `provider-selection`에서 공유합니다. Speech 실행은 iOS 26.2 build 23C54와 iPhone SE 3세대를 사용하고, 나머지 프로필은 iOS 27과 iPhone 18 Pro를 사용합니다. 실행 runtime이 다르더라도 producer의 설정·flags·architecture·toolchain·entry와 제품 무결성이 같아야 공유할 수 있습니다.

`duo`는 명시적으로 선택하는 별도 Release 프로필입니다. iPhone Duo는 iOS 27.1 이상 런타임이 필요하므로 `iOS-27-1`과 `iPhone-Duo` 식별자를 사용합니다. Xcode와 빌드 SDK는 모두 27.1을 유지하며, 기존 프로필의 기기·런타임·제품 호환 목록과 hosted cohort는 바꾸지 않습니다. Duo 제품은 `ios-test-duo`로 구분하고, 기본 실행 목록은 네이티브 호스트 시작, root/right rail 접근성, Home 요약과 진료 준비 이동, Settings 측정 패널의 다크 모드·가로 회전·큰 글씨와 카테고리 이동 (`OrotUITests/RootNavigationUITests/testSettingsLayoutTracksMeasuredDuoSpaceAndLargeText`), 계정 상태와 선택·인증 복귀 후 탐색 유지 (`OrotUITests/RootNavigationUITests/testSettingsAccountsLayoutTracksMeasuredPanels`), provider 선택이 가로 회전과 측정 패널 재배치 및 확인 후 복귀 뒤에도 유지되는 동작 (`OrotUITests/RootNavigationUITests/testSettingsProviderLayoutTracksMeasuredPanels`), 합성 계정 인증 콜백 복귀 중 창 크기 변경 후에도 선택 상태를 보존하는 동작 (`OrotUITests/ProviderSelectionUITests/testAuthSessionCancellationRouteExitRetryAndCallbackKeepSelectionExplicit`), in-flow 제공자 선택 화면의 측정 Duo 영역 재배치와 사용할 수 없는 제공자 상태 (`OrotUITests/RootNavigationUITests/testProviderSelectionOverlayKeepsUnavailableProviderDisabledAcrossMeasuredDuoReflow`), 백업 상태와 iCloud 복구 안내의 측정 영역 배치·상태 표시·큰 글씨 접근성 (`OrotUITests/RootNavigationUITests/testBackupRecoveryReflowsWithinMeasuredDuoRegionsAndRemainsReachable`), 개인정보 설정의 권한·전송 정보 표시와 추론 동의 영수증 삭제 확인 및 Duo 재배치 (`OrotUITests/SettingsPrivacyDuoUITests/testConsentConfirmationAndClearedStateSurviveDuoReflow`), 네 개 AI 진입점의 측정 콘텐츠 영역 배치와 동의 없는 근거 화면 진입, Duo 기하 브리지와 질문 초안 보존, landscape 전환 중 초안 보존, Schedule 회전 후 선택 확인과 큰 글씨 접근성, 예약 선택 상세 화면의 Duo 영역 재배치 (`OrotUITests/AppointmentsUITests/testAppointmentSelectionDetailsReflowAcrossDuoGeometry`), 진료 분류 화면에서 동의 승인과 실패 시 미저장 동작 (`OrotUITests/AppointmentConsentUITests/testDisclosureBlocksProviderUntilApprovalAndNeverSavesFailedClassification`), Records 허브의 적응형 열과 큰 글씨 접근성, 건강 기록 유형과 기간 선택을 회전 후에도 보존하는 동작 (`OrotUITests/RecordsHubUITests/testHealthRecordTypeAndPeriodSurviveOrientationChanges`), 건강 기록 상세 행·기간과 복약 이력·기간의 Duo 재배치 (`OrotUITests/HealthImportDuoUITests/testHealthRecordPeriodAndRowsSurviveDuoGeometryChanges`, `OrotUITests/HealthImportDuoUITests/testMedicationHistoryAndPeriodSurviveDuoReflow`), 건강 기록에서 통합 가져오기 진입, 건강 연동 설정의 선택과 권한 안내를 다크 모드·가로 회전 후에도 유지하는 동작 (`OrotUITests/HealthImportDuoUITests/testHealthDataSettingsReflowKeepsSelectionAndPermissionDisclosure`), sync status와 복구 상태의 Duo 재배치 (`OrotUITests/SettingsSyncStatusDuoUITests/testSyncStatusAndRecoveryStayInsideDuoRegionsAcrossReflow`), 증상 요약과 가능성 평가의 합성 근거·인용 보존 (`OrotUITests/DiseaseHypothesesDuoUITests/testDuoReflowPreservesSelectedEvidenceAndSummaryActions`), 근거 출처 상세 화면의 Duo 재배치 후 원문·출처와 원래 답변 복귀 상태를 유지하는 동작 (`OrotUITests/EvidenceSourceDuoUITests/testEvidenceSourceDetailsReflowWithoutLosingReturnState`), 선택·진행 상태의 Duo 기하 변화 유지, 큰 글씨 단일 열, 사방 가림과 라이브러리 마지막 행 접근성, Back/Home 이탈 확인, 키보드가 열린 상태의 Save 배치, 대화 작성기와 대기 중 삭제 취소가 Duo 재배치 후에도 유지되는 동작 (`OrotUITests/KeyboardSafeAreaUITests/testConversationOutputComposerAndSwipeUndoAcrossAppearances`), 실제 오디오 공유 시트 닫기와 임시 파일 정리·원본 보존, 녹음 검토 중 창 크기 변화에도 transcript 초안과 선택을 유지하는 동작 (`OrotUITests/RecordingDuoUITests/testRecordingReviewRetainsTranscriptDraftAndSelectionAcrossWindowReflow`), Apple Speech 전사 중 Duo 재배치 후 같은 녹음 원본과 검토 전 초안을 유지하는 동작 (`OrotUITests/AutomaticTranscriptionUITests/testActiveTranscriptionSurvivesDuoReflow`), 선택한 수동 기록 이력이 측정 Duo 영역 재배치 후에도 유지되는 동작 (`OrotUITests/ManualHistoryDuoUITests/testSelectedHistorySurvivesMeasuredDuoReflow`), 상담 녹음의 동의 유지와 창 크기 변화 중 라이브 세션 보존, 수동 진료 입력 초안의 Duo 재배치와 저장·취소·수정 동작 (`OrotUITests/AppointmentConsentUITests/testManualAppointmentRetainsDraftAcrossDuoReflow`)을 확인하는 사례로 구성됩니다.

`duo` 프로필의 기본 실행 인벤토리에는 `scripts/ci/duo-test-inventory.mjs`에 등록된 45개 사례가 포함됩니다. 기존 Settings 자식 화면 여정 (`OrotUITests/RootNavigationUITests/testSettingsKeepsAccountsBackupAndPrivacyOnTheirOwnRoutes`)도 Core와 Duo에 각각 등록해 일반 글자에서 여섯 자식 화면의 실제 콘텐츠 경계와 레일 중심, Back 복귀, 마지막 항목 도달을 확인합니다. 기존 예약 분류·수동 목록·Back 복귀 여정 (`OrotUITests/AppointmentConsentUITests/testManualPageReturnsThroughClassificationAndScheduleToHome`)은 기존 fixtures 등록을 유지하면서 Duo에도 등록해 독립적인 자식 콘텐츠 경계를 확인합니다. 합성 건강 기록 목록·상세·가져오기 진입 경계 사례는 별도의 Duo 등록으로 일반 글자와 접근성 큰 글자에서 확인하며, 실제 가져오기나 권한 요청은 시작하지 않습니다. 합성 근거 원문 사례는 일반 글자에서 가능성 평가와 저장된 원문 선택, Back 복귀의 경계를 별도로 확인하며, 모델 호출이나 회전·키보드 입력을 요구하지 않습니다. Settings와 예약의 경계 검사는 회전·큰 글자 사례와 독립적으로 실행합니다. VoiceOver 사례는 iOS 27의 공개 `XCUIVoiceOverService`로 실제 발화와 루트·Back/Home 탐색 및 활성화를 확인하고, 오류를 그대로 보존하며 원래 켜짐 상태를 복원합니다.

이 인벤토리는 [Settings Duo 등록](https://github.com/eunsoogi/orot/issues/277)의 `bcc2d09bd23c0660058ee516f3b08544b59b99f8`와 선행 Duo 등록, 이후 추가된 수동 진료 초안 보존, 수동 기록 이력 재배치, 질환 요약·가능성 평가, 흐름 내 제공자 선택 회귀를 반영합니다. 실제 등록 목록은 `scripts/ci/duo-test-inventory.mjs`에서 확인하세요. 등록된 테스트 사례만으로 XCUITest 실행이나 성공이 입증되지는 않습니다.

로컬 Duo 검증도 다른 작업과 겹치지 않는 제품 경로와 새 소유권 파일을 사용합니다. 실행 전후의 `simctl list -j` 결과를 별도로 보존해 소유 기기 외의 UDID·기기 유형·런타임·상태가 유지되는지 비교하세요. 준비는 선택한 런타임이 없으면 실패하며 다른 런타임으로 대체하거나 설치하지 않습니다. 검증 중 오류가 나더라도 마지막 cleanup은 실행해 기록된 소유 기기만 종료하고 삭제하세요.

```sh
node scripts/ci/build-ios-tests.mjs duo build/integration-tests-duo
node scripts/ci/ios-test-simulator.mjs prepare duo build/ios-duo-owner.json
node scripts/ci/ios-test-simulator.mjs verify duo build/ios-duo-owner.json
node scripts/ci/run-ios-tests.mjs duo build/integration-tests-duo/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-duo-owner.json build/ios-duo-launch.xcresult
node scripts/ci/ios-test-results.mjs duo build/ios-duo-launch.xcresult build/ios-duo-launch-results.json
node scripts/ci/ios-test-simulator.mjs cleanup duo build/ios-duo-owner.json
```

실제 검증에서는 소유권 파일의 UDID를 지정한 `xcodebuild -showBuildSettings` 결과의 SDK·구성·architecture와 공개 runtime inventory의 식별자·build를 함께 읽어 확인합니다. 프로필 설정이나 단위 테스트만으로 런타임 준비·실행·종료가 확인됐다고 판단하지 않습니다.

CI의 CocoaPods 의존성 준비, `OrotTests` 제품, Production 앱, OAuth 패키지 및 Simulator 빌드는 `scripts/ci/fail-on-warning.mjs`를 거칩니다. 이 도구는 `warning:`, `WARN`, CocoaPods `[!]`, `DVTAssertions: Warning` 기록을 원문 그대로 전달하고, 자식 명령이 0으로 끝나도 발견된 경고로 실패합니다. 현재 저장소는 `AppIntent`와 `AppShortcut`을 선언하지 않습니다. Xcode 27의 `appintentsmetadataprocessor`가 내는 정확한 `Metadata extraction skipped, no AppIntents.framework dependency found` 문구는 문서화된 도구 알림으로 분류해 허용합니다. CocoaPods 설치에서는 고정된 `React-Core-prebuilt`, `ReactNativeDependencies`, `hermes-engine` podspec의 스크립트 단계 알림 세 문구도 각각 정확히 한 번씩 모두 나타날 때만 허용합니다. 이 단계들은 Debug와 Release에 맞는 사전 빌드 아카이브를 선택합니다. 하나라도 빠지거나 중복되거나 문구가 바뀌면, 또는 다른 CocoaPods 알림이나 경고가 나타나면 명령은 실패합니다. 허용된 알림도 로그에 그대로 남으며, 게이트 결과는 전체·허용·차단 경고 수를 따로 기록합니다. 자식 명령의 실패 코드는 유지하며, 취소 신호를 자식에게 전달한 뒤 종료를 기다립니다. 근거와 원시 로그는 [경고 처리 기록](../vendor/patches/warning-dispositions.md)에 있습니다.

`pnpm lint`는 모바일 앱과 패키지 및 저장소 루트의 ESLint 실행에 모두 `--max-warnings 0`을 지정해 경고를 로컬 품질 검사와 CI에서 실패로 처리합니다.

GitHub가 제공하는 임시 macOS 러너에서는 checkout 직후, 도구 설치·의존성 복원·빌드·Simulator 준비 전에 독립 단계 `Disable and verify Spotlight`의 공통 bootstrap이 한 번 실행되어 Data 볼륨의 Spotlight 색인을 해제하고 실제 상태를 확인합니다. 명령은 실제 종료와 별도 상태 확인을 기다리고 결과를 `spotlight.log`에 남깁니다. 취소는 권한 경계 안의 supervisor가 소유한 하위 프로세스 그룹만 종료하고 회수합니다. 해제를 확인하지 못하면 해당 작업은 실패합니다. 모든 workflow·재사용 workflow·로컬 composite·matrix 경로는 정책 검사로 확인합니다. 개발용 Mac과 자체 호스팅 러너에서는 이 명령을 실행하지 않으며, Simulator 내부 서비스나 색인 파일을 삭제하지 않습니다.

로컬 Core 검증은 저장소 루트에서 다음 순서로 실행합니다. 기존 제품이나 소유권 파일과 겹치지 않는 경로를 사용하세요.

```sh
node scripts/ci/build-ios-tests.mjs core build/integration-tests-release
node scripts/ci/ios-test-simulator.mjs prepare core build/ios-core-owner.json
node scripts/ci/run-ios-state-persistence-tests.mjs build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-core-owner.json build/ios-core-persistence && \
node scripts/ci/run-ios-fixture-isolation-tests.mjs build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-core-owner.json build/ios-core-isolation && \
node scripts/ci/run-ios-recording-persistence-tests.mjs build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-core-owner.json build/ios-core-recording-persistence && \
OROT_IOS_TEST_SUITE=integration node scripts/ci/run-ios-tests.mjs core build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-core-owner.json build/ios-core-integration.xcresult && \
OROT_IOS_TEST_SUITE=integration node scripts/ci/ios-test-results.mjs core build/ios-core-integration.xcresult build/ios-core-integration-results.json && \
OROT_IOS_TEST_SUITE=ui node scripts/ci/run-ios-tests.mjs core build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-core-owner.json build/ios-core-ui.xcresult && \
OROT_IOS_TEST_SUITE=ui node scripts/ci/ios-test-results.mjs core build/ios-core-ui.xcresult build/ios-core-ui-results.json
node scripts/ci/ios-test-simulator.mjs cleanup core build/ios-core-owner.json
```

HealthReview의 일곱 화면 여정은 `health-review-ui` 전용 cohort에서 `core` Release 제품과 `ui` suite로 실행합니다. 전체 실행 계획에는 각 사례가 한 번씩 들어갑니다. 각 메서드가 자기 UUID의 요청·관찰 fixture를 만들고 정리하며, fresh-process pending 복원은 한 메서드 안에서 앱을 종료한 뒤 `restore` 모드로 다시 시작합니다. 기존 graph/shared persistence driver의 세 단계와 초기화 경계는 바꾸지 않습니다.

```sh
node scripts/ci/build-ios-tests.mjs core build/integration-tests-health-review
node scripts/ci/ios-test-simulator.mjs prepare-cohort health-review-ui build/ios-health-review-owner.json
PROFILE=core node scripts/ci/run-ios-test-cohort.mjs health-review-ui build/integration-tests-health-review/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-health-review-owner.json build/ios-health-review-results
node scripts/ci/ios-test-simulator.mjs cleanup health-review-ui build/ios-health-review-owner.json
```

실패해도 마지막 cleanup을 실행하고 새 `simctl list -j`로 소유 UDID가 없는지 확인합니다. 이 등록은 실제 빌드·화면 실행·20분 예산 통과의 근거가 아닙니다. provider 응답만 합성하며 App 진입, SQLCipher, graph, safety·consent, citation과 요청 삭제는 production 경로를 사용합니다.

전사 후보 검토의 영속화는 `encounter-review-persistence` 전용 cohort에서 별도로 실행합니다. 기존 state/shared persistence 묶음이 저장한 건강 관찰도 실제 충돌 검사 대상이므로 같은 데이터베이스의 다음 단계로 덧붙이지 않습니다. 다른 작업과 겹치지 않는 제품 경로와 소유권 파일을 사용하세요.

```sh
node scripts/ci/build-ios-tests.mjs core build/integration-tests-encounter-review
node scripts/ci/ios-test-simulator.mjs prepare-cohort encounter-review-persistence build/ios-encounter-review-owner.json
node scripts/ci/run-ios-encounter-review-persistence-tests.mjs build/integration-tests-encounter-review/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-encounter-review-owner.json build/ios-encounter-review-phases
node scripts/ci/ios-test-simulator.mjs cleanup encounter-review-persistence build/ios-encounter-review-owner.json
```

driver는 한 번만 초기화한 뒤 production service/controller로 seed, resume, readback을 세 앱 프로세스에서 실행합니다. JSON attachment 본문의 같은 run UUID·fixture ID·phase와 서로 다른 실제 PID를 대조하며, 복원 snapshot 전체가 seed와 일치하고 추출 호출과 자동 저장이 없음을 확인합니다. 명시적인 저장 뒤 세 번째 프로세스에서 reviewed·derived·unknown-speaker 기록과 정확한 근거를 읽고 자기 source와 연결된 자료만 삭제합니다. 단계 사이에는 초기화하지 않습니다. 어느 단계가 실패해도 소유 Simulator cleanup을 수행하고, 이후 실제 `simctl list -j`에서 기록된 UDID의 부재를 확인해 receipt를 보존하세요. 삭제 또는 부재 확인이 실패하거나 불명확하면 소유권과 실패 기록을 유지하고 다른 기기를 건드리지 않습니다.

집중 실행은 `focus_profile=ios/core`, `focus_scenario_file=scripts/ci/encounter-review-persistence-test-phases.mjs`, `focus_scenario_name=group/encounter-review-persistence`로 전체 세 단계를 선택합니다. 단일 phase 선택은 거부합니다. 네이티브 화면 여정은 기존 `recording-evidence` cohort에 등록된 `EncounterReviewUITests`가 실제 저장 녹음 목록과 navigation을 통해 검토 화면을 엽니다. 합성 모델 응답은 실제 제공자 품질의 근거가 아니며, source 등록·빌드·Simulator 실행·모델 품질의 결과를 각각 구분하세요.

두 보호 Keychain 회귀 검사는 Face ID 등록이 필요한 `authentication` suite에서 실행합니다. 하나는 `interactionNotAllowed`로 UI 없이 조회할 때 보호 항목을 거부하는지 확인하고, 다른 하나는 Keychain 조회가 띄운 Face ID 인증 창에서 일치하는 얼굴을 입력한 뒤 보호 항목 조회를 허용하는지 확인합니다. 로컬에서 아래 명령을 실행할 때는 owner 파일에 기록된 Simulator를 열고 Device 메뉴에서 Face ID 등록을 켠 뒤, prompted 사례에서 일치하는 얼굴을 입력하세요. 같은 Release Core 테스트 제품을 빌드한 뒤 다음과 같이 실행합니다.

```sh
OROT_IOS_TEST_SUITE=authentication node scripts/ci/run-ios-tests.mjs core build/integration-tests-release/Build/Products/OrotTests_iphonesimulator27.1-arm64.xctestrun build/ios-core-owner.json build/ios-core-keychain-auth.xcresult && \
OROT_IOS_TEST_SUITE=authentication node scripts/ci/ios-test-results.mjs core build/ios-core-keychain-auth.xcresult build/ios-core-keychain-auth-results.json
```

전체 Keychain authentication suite는 Full E2E workflow에서 재사용 가능한 `ios-focused.yml` 작업으로 실행합니다. hosted 작업은 Device Hub를 열고 생성된 owner Simulator를 확인한 뒤 Face ID를 등록합니다. 두 보호 쿼리 동안 Device Hub의 `Authorized with Face ID` 입력을 보내며, 창이나 메뉴 조작을 확인할 수 없으면 테스트를 중단합니다. 로컬 명령은 위의 수동 Face ID 절차를 따릅니다.

Keychain authentication은 195개 cohort 관측과 별도로 두 개의 보호 쿼리 결과를 기록합니다. Full receipt는 두 관측, 같은 run·attempt의 테스트 결과 bundle, owner Simulator와 성공한 Face ID 입력 로그를 함께 검증합니다. 해당 task가 소유한 Simulator만 사용하고 owner 파일을 통해 정리하세요. 테스트는 합성 데이터만 저장합니다.

제품과 의존성을 준비한 뒤 기록된 기기만 부팅합니다. hosted 실행은 승인된 runtime을 확인한 뒤 공개 `simctl runtime dyld_shared_cache update <runtime>` 명령이 끝나야 Simulator를 생성·부팅합니다. 선택한 runtime만 대상으로 하며 강제 재생성이나 삭제는 하지 않습니다. 이 준비 시간과 resource samples도 전체 비용에 포함하고, 개발용 Mac과 자체 호스팅 러너에서는 이 단계를 추가하지 않습니다. `test-without-building`은 consumer에서 다시 컴파일하지 않습니다. CI는 run·attempt·source와 build input·제품 digest를 검증한 뒤 Simulator를 생성하며, 검증 실패를 빌드나 다른 제품으로 대체하지 않습니다. 실행은 한 destination과 worker를 사용하고 첫 실패·결과 bundle·첨부 자료·단계 시간·resource samples를 보존합니다.

Speech 자산 준비는 설치를 한 번 요청하고 실제 완료·오류·취소를 기다립니다. 테스트 준비용 180초 제한은 두지 않습니다. 요청 직전과 성공·실패 시점의 공개 `Progress` 수치를 첨부하며, 이 단위를 다운로드 바이트나 설치 성공으로 해석하지 않습니다. 준비 실행 중에는 소유 Simulator의 Orot 진단과 관측된 자산·Speech 프로세스의 공개 로그를 최대 8 MiB까지 보존합니다. 수집기 자체에 90분 상한을 두고 테스트 종료 시 해당 자식 프로세스만 정리합니다. 수집 실패·잘림·종료 확인 실패는 별도로 기록하며 원래 테스트 결과를 바꾸지 않습니다.

UI XCTest는 검증된 소유 Simulator의 `log stream`을 첫 실행 전에 시작해 앱·XCTest runner와 SpringBoard·FrontBoard·RunningBoard의 시작 이벤트를 결과 및 fixture 정리까지 수집합니다. 직접 실행 결과에는 `.lifecycle.log`와 `.lifecycle.log.json`을, fixture 결과에는 `session.xcresult.lifecycle.log`와 `session.xcresult.lifecycle.log.json`을 저장합니다. 로그 본문은 8 MiB 최근 기록으로 제한하고 수집기는 최대 90분 뒤 종료합니다. macOS 기본 개인정보 가림을 유지하며, receipt에는 invocation·기기·테스트·실행 출처와 수집 상태·잘림·정리 상태를 기록합니다. 이벤트가 없으면 `no-events`로 남기며 앱 시작이 정상이라는 뜻은 아닙니다. 실패나 종료 확인 누락도 receipt에 남기고 원래 XCTest 결과는 보존합니다.

Backup runner의 소유 destination 검사가 실패하면 `artifacts/ios-cohort/results/backup-state-failures.jsonl`에 run·attempt·source, phase·시각, owner 검증 상태와 관측 state를 기록합니다. 검증된 UDID만 대상으로 관측 시각 직전 60초의 호스트 `CoreSimulatorService` 로그를 수집하며 기본 개인정보 가림, 3초 실행 제한, 256 KiB 출력 제한, 최대 64개 이벤트를 적용합니다. owner 검증 또는 로그 수집이 불가능하면 identity/state scope 또는 host `unavailable`을 남깁니다. `empty`나 `unavailable`은 정상 상태나 원인을 뜻하지 않습니다. Guest stream receipt, host lifecycle events, collector 종료와 저장소 cleanup은 서로 다른 필드이며 진단은 원래 guard 오류를 바꾸지 않습니다.

테스트 실행은 `-test-timeouts-enabled NO`를 명시하고 사례별 실행 허용 시간을 지정하지 않습니다. UI 조건·native broker·asset 설치·앱 receipt·일반 준비 명령은 실제 결과를 기다립니다. UI의 50ms run-loop 양보와 receipt의 50ms 확인 간격은 관측 주기이며 완료 제한이 아닙니다. receipt 대기 중에는 현재 토큰의 receipt 존재 여부와 `simctl launch`가 반환한 실제 PID의 생존을 반복 확인합니다. receipt를 읽고 검증·삭제하기 직전에는 새 `simctl list -j` 결과로 승인 runtime, 기기 이름·UDID·유형 ID와 `Booted` 상태를 확인하고, 각 Simulator 변경 명령 직전에도 소유권을 새로 확인합니다. 소유권 또는 부팅 손실, 다른 PID의 receipt, 프로세스 종료와 오류는 실패합니다. 끝나지 않은 조건을 성공으로 처리하지 않습니다. Apple 내부 접근성 IPC의 자체 중단·runner crash는 이 정책으로 해결됐다고 해석하지 않습니다.

공통 XCTest 준비·종료 단계는 호스트 소켓 대기를 별도 작업에서 수행해 메인 실행 흐름의 앱 상태 통지를 막지 않습니다. UI fixture 준비는 호스트 응답 뒤에도 XCTest가 `com.orot.mobile`의 `.notRunning` 상태를 직접 관측해야 본문에 진입합니다. 호스트 명령 완료와 XCTest의 상태 반영은 서로 다른 경계입니다. 이 관측에는 경과 시간 제한이나 앱 실행 재시도를 추가하지 않습니다. 실제 XCTest를 사용하는 메인 실행 흐름 회귀 검사는 macOS와 Xcode에서 `node --test scripts/ci/tests/ios-test-fixture-runloop.test.mjs`로 실행합니다. Apple XCTest가 없는 Linux에서는 이 검사만 실행하지 않으며, 현재 iOS 195개 사례의 필수 실행에는 영향을 주지 않습니다.

전체 hosted job의 `timeout-minutes`는 VM 실행·취소·artifact 및 소유 기기 정리를 위한 바깥 경계로 유지합니다. 실패 뒤 선택적으로 수집하는 설치 상태 5초·앱 로그 30초, resource sample 10초, 진단 수집기의 용량·수명과 종료 유예는 보조 관측과 소유 자식 정리만 제한합니다. 이들은 테스트 성공을 만들거나 본문을 재시도하지 않으며 관측 실패는 별도로 남깁니다. 제품의 25초 녹음 자동 종료와 실제 Speech 서비스 취소는 제품 요구사항으로 유지합니다.

녹음 Stop 검증의 `seed`·`route` 진입점은 전용 Simulator 빌드에서 합성 전체 음원만 실제 `AVAudioPlayer`로 반복 재생합니다. 사용자 Stop을 누를 때까지 음원의 짧은 수명에 의존하지 않으며, `resume` 진입점은 같은 저장 파일을 한 번 재생해 자연 종료를 검증합니다. 전용 fixture는 실제 native progress와 종료 Promise를 지속되는 관측 값으로 남깁니다. 정확한 `00:01` 표시는 컴포넌트 검증에서 유지하고, E2E는 실제 재생 위치·명시적 Stop·자연 종료·재시작을 확인합니다.

테스트 실행 helper는 호출마다 새 UUID를 전달합니다. 테스트 target에만 포함되는 공통 기본 클래스는 현재 사례 이름을 해당 runner의 컨테이너에 기록하고, 정리 단계까지 성공했을 때 지웁니다. 실패나 runner 크래시가 남긴 기록은 같은 호출의 후속 본문을 건너뛰게 합니다. 원래 실패와 미실행 사례는 결과에 남으며, 누락·건너뜀은 기존 결과 검증에서 통과하지 못합니다. runner가 기본 설정에 도달하기 전의 시작 실패는 이 기록으로 차단할 수 없습니다. Core 통합·UI 검증은 독립 작업으로 실행합니다. Speech는 자산 준비와 native 인식이 성공해야 실제 인식 자료를 사용하는 UI·새 프로세스 readback 단계를 실행합니다. 각 target은 서로 다른 컨테이너를 사용합니다. Xcode에서 테스트를 직접 실행할 때도 새 `OROT_IOS_TEST_INVOCATION` UUID를 runner 환경에 지정해야 합니다.

`fixtures`, `health-import`, `microphone`, `provider-selection`은 `run-ios-fixture-tests.mjs`로 실행합니다. 일반 Release UI 사례는 설치된 제품을 유지하고, React가 시작되기 전에 앱 소유 DB·WAL·SHM·녹음·삭제 대기열·내보내기 사본·Keychain 항목·설정과 권한을 초기화합니다. helper는 실제 부재와 권한 미결정 상태를 읽어 확인하며, 같은 묶음의 다음 사례가 시작할 때 한 번만 초기화합니다. 마지막 사례와 실패 직후에는 바로 정리합니다. 저장소 생성·schema migration·키 수명주기·native permission 사례는 전체 재설치와 Keychain 초기화를 유지합니다. Backup snapshot과 local-model 재실행 단계는 전용 helper의 순서대로 자료를 이어받습니다. 다른 프로필의 기기나 다른 앱을 초기화하지 마세요.

Core의 `state-persistence`는 명시적인 fresh-install 단계에서 실제 SQLCipher 저장소·메모리·UTF-8 checkpoint를 만들고, 세 개의 서로 다른 앱 프로세스에서 복원·노드 재실행 방지·삭제 후 검색 부재를 확인합니다. `isolation`은 실제 DB·파일·키·설정·권한 오염을 넣은 뒤 제거와 외부 sentinel 보존, 새 DB 키 생성을 확인합니다. 두 XCTest 앱 프로세스가 각각 React와 DB를 열기 전에 자기 상태를 초기화하고 같은 프로세스의 전후 영수증을 남깁니다. 별도 초기화 앱 실행의 상태를 다음 프로세스에 넘기지 않습니다. 호스트는 각 XCTest 전에 권한을 초기화하고, 실제 DB 프로세스가 종료된 뒤 파일·Keychain 오염을 한 번 주입합니다. 설정 오염과 외부 설정 sentinel은 초기화를 수행할 네이티브 프로세스가 직접 준비하며, 별도 프로세스의 설정 저장 상태를 전제로 하지 않습니다. 설정은 명시된 소유 키만 지우며 외부 파일·Keychain·설정 sentinel은 보존합니다. 초기화 직후와 React 시작 후의 실제 XCTest 프로세스에서 소유 키의 부재를 각각 확인합니다. `recording-persistence`는 수정 이력·stale evidence·메모리 무효화·삭제와 중단된 export 사본을 두 프로세스에서 확인합니다. 상태를 이어받는 단계 사이에는 초기화하지 않으며, 같은 프로세스이거나 앞 단계의 영수증이 없으면 실패합니다. Speech의 `journey`도 실제 화면 정지·저장과 실제 Apple Speech 연결을 한 번 실행한 뒤 별도 앱 프로세스에서 모든 저장 필드와 네이티브 Speech 요청 수 0을 확인합니다.

화면 모드 검증은 XCTest의 공개 기기 API로 모드를 변경하고 실제 읽기 값을 확인합니다. 명시적으로 켠 테스트 진입점은 해당 값을 같은 앱 창에 다시 적용하고, 실제 UIKit trait으로 React Native 테마 알림을 갱신합니다. 실행기 호출마다 분리한 UUID 알림 채널을 사용하며 설정 앱이나 프로세스 재시작은 필요하지 않습니다. 기기·UIKit 창·앱의 실제 `useColorScheme` 값, 창 재적용 방식과 횟수, 앱 스크린샷을 남깁니다. 원래 기기 모드와 창의 override를 복원하고 기존 화면 동작·저장 상태·레이아웃 검증을 수행합니다. 이 보정은 테스트 제품에만 포함되며 OS가 모드를 앱에 자동 전달했다는 증거로 해석하지 않습니다.

마이크 진단은 첫 시스템 권한 응답이 앱의 비활성·활성 전환보다 먼저 도착할 수 있으므로, 권한 허용과 이후 앱 활성화를 모두 확인한 뒤 실제 녹음을 시작합니다. 이미 권한이 결정되어 있고 앱이 활성 상태이면 새 전환을 기다리지 않습니다. 거부나 취소는 한 번만 처리하며, 실제 녹음 중의 중단·파일 정리와 기존 25초 제한은 유지합니다. 이 준비 절차는 테스트 전용 모듈에만 적용합니다.

전체 CI는 Core 목록에 포함된 원래 Hermes 연결 사례를 실행하며, 같은 사례를 별도 UI 준비 단계에서 반복하거나 Device Hub를 추가로 실행하지 않습니다. 연결 사례의 성공은 접근성 준비 완료를 뜻하지 않습니다. UI 검증은 실제 버튼·스크롤 영역·키보드와 시스템 창의 관측 조건을 기다립니다. 합성 Calendar·HealthKit 자료나 계정 응답을 사용한 결과는 실제 개인 자료·계정·물리 기기의 검증과 구분합니다. Apple 모델 준비 실패, 인식 실패와 UI 입력·복귀 실패도 별도로 기록합니다. Keychain 인증은 Full E2E 실행의 별도 인증 작업으로 검증합니다.

CI의 공개 E2E 실행은 `main`에서 매일 03:00 KST에 시작하는 nightly Full workflow와 `main`에서 수동으로 시작하는 Full workflow입니다. PR, push, 다른 브랜치의 수동 dispatch는 Mac E2E 실행을 시작하지 않습니다. 단일 사례의 개발 확인은 로컬 명령으로 수행하며, 수동 Full과 집중 결과는 release 증거로 사용할 수 없습니다.

Full E2E의 29개 cohort 계획은 195개의 고유 XCTest 사례를 각각 한 번씩 수행하고 Keychain 인증 사례 두 개를 별도 receipt에 추가합니다. 넓은 프로필 inventory를 합산하면 Debug 33개, Release 156개, Speech 9개로 198개의 관측과 195개의 고유 사례가 됩니다. 세 문서 가져오기 UI 여정은 Debug `health-import`와 Release `fixtures` 양쪽 inventory에 포함되지만 전체 cohort 계획에서는 각각 한 번씩만 실행합니다. PR에서는 Mac E2E runner를 시작하지 않습니다. release 증거는 exact main SHA의 성공한 nightly 실행만 인정합니다.

실제 실행·초기화 driver는 Apple 도구를 호출하기 전에 새 `simctl list -j` 응답의 runtime과 기기 정보를 함께 확인합니다. Simulator를 변경하지 않는 cohort 조정기는 소유권 계약만 확인하며 같은 상태 조회를 중복 실행하지 않습니다. fixture의 초기화·삭제 전 검증 결과를 다음 변경까지 캐시하지 않습니다. Simulator 명령은 시작·종료 시점과 소요 시간·종료 상태를 stderr에 남기며, stdout을 사용하는 기존 호출 결과와 분리합니다. UI 위치는 같은 판정이나 제스처 준비 안에서 한 번 읽고, 다음 판정이나 제스처 뒤에는 다시 관측합니다. 이 변경의 실제 시간 절감 여부는 동일한 검증 범위의 실행 자료로 판단합니다.

테스트의 Foundation Models 호출은 `OROT_TESTS`로 컴파일한 Simulator 제품에서만 mock으로 대체합니다. 정해진 원본 문자열·JSON·스트리밍 snapshot·오류를 SDK 호출 경계에 주입하고, 실제 JavaScript 직렬화·React Native 브리지·스키마 처리·응답 정규화·요청 취소와 앱 workflow를 검증합니다. 지정하지 않은 요청, 다른 요청에 속한 응답, 남은 응답은 실패입니다. 생성 결과의 출처 보존, 스트리밍 완료·취소·재작성 거부, 사용 불가·오류 처리, Calendar 분류·중복 없는 저장·근거가 연결된 질문과 RAG 연결을 확인합니다. RAG의 Europe PMC 조회는 테스트 전용 HTTP 전송 함수가 합성 응답을 반환하며, 실제 서비스의 응답 파싱·근거 매핑·동의·인용 검증을 그대로 실행합니다. 예상하지 않은 검색어·endpoint·추가 데이터·중복 요청은 네트워크로 전달하지 않고 테스트를 실패시킵니다. 결과에는 `literatureExecution=mock`을 기록하며, 통과 결과는 Europe PMC의 실제 가용성을 증명하지 않습니다. 운영 앱은 기존 HTTPS endpoint와 동의 흐름을 유지하고 이 테스트 전용 전송 함수를 사용하지 않습니다.

일반 CI는 호스트 Apple Intelligence 지원·활성화·모델 다운로드나 CLI 약관 동의를 요구하지 않습니다. 결과에는 `modelExecution=mock`, `actualModel=not-run`을 남기며 실제 Apple 모델의 응답 품질이나 추론 실행을 검증했다고 해석하지 않습니다. 제품 빌드의 기본 경로는 실제 Apple SDK를 사용합니다. 빌드 후 앱에 연결된 기호를 검사하여 생산용 제품에는 mock 제어 endpoint가 없고 실제 `LanguageModelSession`이 연결되어 있으며, 테스트 제품에는 반대로 mock만 연결되어 있음을 확인합니다. 실행 인자나 환경 변수로 생산용 앱의 mock을 켤 수 없습니다.

Full E2E graph는 Debug·Release·Production·OAuth 빌드 작업 4개, 기능별 iOS 실행 cohort 29개, OAuth 실행 1개, 마지막에 직렬 실행하는 Keychain authentication 작업으로 구성됩니다. 모든 실행은 호환되는 빌드 산출물만 사용하며 workflow의 macOS concurrency 설정을 공유합니다.

Release 156개 관측과 Speech 9개 관측은 독립 기능 작업 23개에 정확히 한 번씩 배정됩니다. Core UI는 루트 네비게이션·호스트 4개와 녹음 내보내기·전사 근거 및 후보 검토 6개를 독립 작업으로 실행합니다. Navigation은 Features·Routes·Accessibility·Imports, Calendar는 Consent·Appointments·수동 병력 및 문서 가져오기, Questions는 Review·Conversation·Accessibility·Summary·Literature, Recordings는 Controls·Review·Playback으로 나누며 각 XCTest 메서드 안의 모드 변경·재시작·복원·동의 검증은 분리하지 않습니다. 각 작업은 전용 Simulator 하나를 사용합니다. UI fixture 51개는 Navigation·Recordings·Questions·Calendar와 독립된 사례별 초기화를 유지합니다. `run-ios-fixture-tests.mjs`를 사용하는 네 프로필의 독립 UI 사례와 Backup의 독립된 첫 세 사례는 선택한 묶음마다 XCTest 실행기를 한 번 시작합니다. 실행기의 공통 XCTest 준비·종료 경계는 호스트가 먼저 연 loopback 소켓에 사례마다 연결해 기존 초기화·정리를 기다립니다. 세션·요청 UUID가 일치하는 응답만 인정하며, 호스트 종료로 연결이 끊기거나 응답이 잘못되면 실패합니다. 파일 반복 조회나 별도 생존 확인, 고정 대기 제한은 추가하지 않습니다. 앱 재시작이나 assertion은 변경하지 않으며, 첫 실패 뒤의 기존 fail-fast 표식은 후속 준비를 막습니다. 요청·준비·정리 실패와 원본 xcresult의 실패·skip·미실행은 성공으로 처리하지 않습니다. Backup 복원과 local-model 재실행은 실제 데이터 의존이 있어 원래 순서를 유지합니다. Persistence는 저장 상태 3단계와 녹음 자료 2단계를 3개의 새 프로세스로 묶습니다. 첫 설치·키 생성은 첫 프로세스에서 단독 검증하고, 다음 두 프로세스는 서로 다른 UUID를 쓰는 저장 상태와 녹음 자료 검증을 함께 실행합니다. 단계 사이에는 초기화하지 않으며 두 영역의 실제 PID와 원래 판정 결과를 모두 확인합니다. 특정 fixture 묶음은 `focus_profile=ios/fixtures`, `focus_scenario_file=scripts/ci/ios-test-fixture-groups.mjs`, `focus_scenario_name=group/<group>`으로 선택하며, `all`은 UI 52개 전체를 14개 독립 작업으로 선택합니다. 독립 선택 실행의 상태 그룹은 각각 `scripts/ci/state-persistence-test-phases.mjs`와 `group/state-persistence`, `scripts/ci/fixture-isolation-test-phases.mjs`와 `group/isolation`, `scripts/ci/recording-persistence-test-phases.mjs`와 `group/recording-persistence`를 지정합니다. Speech는 `scripts/ci/speech-journey-test-phases.mjs`와 `group/journey`를 지정하며 단일 단계 선택은 허용하지 않습니다.

각 cohort runner는 계획된 task의 실행 모드, suite와 XCTest target을 바탕으로 UI host 준비가 필요한지 판단합니다. UI 작업이 있으면 준비 helper를 한 번 실행하고, 같은 runner process의 이후 UI task에서는 완료 상태만 재사용합니다. 시작 시 기존 `artifacts/ios-cohort/ui-preparation` 디렉터리가 있으면 그 결과를 재사용하지 않고 실패합니다. 이번 실행에서 helper가 만든 host XCTest JSON과 원본 `.xcresult`의 정확한 host 사례가 모두 통과해야 계획된 테스트를 시작합니다. host XCTest 결과와 DeviceHub·Simulator screenshot 자료는 계획된 결과와 분리해 보존합니다.

## 전체 CI와 제품 재사용

Full E2E graph의 각 독립 Mac 작업에는 최대 20분의 GitHub Actions 하드리밋을 적용합니다. Questions의 Conversation은 composer·화면 모드 전환 메서드를, Accessibility는 키보드·큰 글자 및 제목·스와이프 메서드를 완전한 단위로 나누어 실행합니다. 모든 29개 cohort를 실행하고 auth suite를 별도 job으로 마친 뒤 전체 receipt를 검증합니다. 빌드·Simulator 준비·테스트·정리를 포함한 작업 시간이며, 취소나 미실행은 통과로 집계하지 않습니다.

`E2E Test`는 `0 18 * * *` UTC schedule과 수동 `workflow_dispatch`로 실행됩니다. Schedule은 기본 브랜치인 `main`에서 매일 03:00 KST에 Full 검증을 시작하며, 수동 dispatch도 `main`에서만 Full 검증을 시작합니다. PR, main push, 다른 브랜치의 수동 dispatch는 Mac E2E 작업을 시작하지 않습니다. PR의 16개 필수 검사는 Code Quality, Unit Test, Policy Check 범위이며 E2E는 필수 검사에 포함하지 않습니다. release workflow는 대상 main SHA의 성공한 nightly Full 결과만 받아들입니다.

Full E2E의 cohort 및 build job들은 기존 concurrency 그룹 안에서 실행합니다. Keychain authentication job은 네 제품 producer와 29개 cohort executor가 끝난 뒤 실행해 다섯 개 macOS 슬롯 안에서 이어집니다. 이 job이 만든 run·attempt별 focused artifact는 Full receipt에 검증되어 두 Keychain 관측과 실제 Face ID 입력 근거를 기록합니다.

Production 빌드는 기본 entry·flags의 앱, 실제 Apple SDK 연결, 기본 Keychain 설정을 검증합니다. OAuth 빌드는 별도 DerivedData에서 Simulator harness와 macOS XCTest bundle을 컴파일하고 정확한 test inventory·내장 fixture·source·run·attempt·toolchain·digest를 함께 전달합니다. OAuth 실행은 이를 검증한 뒤 별도 VM에서 68개 package 테스트를 컴파일 없이 실행합니다. 실행 결과와 두 빌드 의무는 Linux의 Build 상태가 함께 검증합니다. Production과 OAuth는 Debug·Release producer의 선행 조건이 아니며 모두 최종 통과 조건으로 남습니다. 독립 iOS 컴파일이나 테스트 실패가 완료된 생산용 결과를 지우지 않습니다.

production 캐시는 복원과 저장을 분리합니다. 캐시에 포함되는 기본 앱의 빌드·Apple SDK 연결·Keychain 의무와 manifest 검증이 성공하면 전용 빌드 작업에서 DerivedData·Pods를 저장합니다. 별도로 전달하는 OAuth 제품은 이 캐시에 포함하지 않으며 OAuth 실행 성공은 최종 Build와 전체 집계에서 요구합니다. 앞 단계가 실패하거나 production이 아닌 실행은 저장하지 않고, 정확한 cache key가 이미 있으면 중복 저장하지 않습니다. 이후 테스트 실패는 전체 검증을 실패로 유지합니다. 실제 재사용 여부는 다음 실행의 cache hit, 입력·제품 검증, `app_reusable`과 컴파일 생략을 확인하며 저장·복원 비용도 함께 측정합니다.

cohort의 한 단계나 독립 fixture 사례가 실패하면 원래 로그와 결과를 보존하고 소유한 자료를 정리한 뒤 후속 실행을 중단합니다. 실행하지 않은 cohort 단계는 `not-run`, fixture는 `notRun` 목록에 기록하며 성공으로 집계하지 않습니다. 한 `xcodebuild` 호출 내부에서 여러 사례가 실행되는 경계는 별도이며, 이 스케줄링 중단만으로 모든 사례가 첫 실패 순간에 중단됐다고 주장하지 않습니다. 실패·누락·skip·취소·오래된 결과가 있으면 전체 검증은 실패합니다. Backup restore와 local-model 재실행의 종속 단계는 전용 순서를 유지합니다. Provider 프로필의 8개 원래 테스트도 필수입니다. Foundation Models 관련 네 사례는 명시적인 mock 응답으로 앱·브리지·workflow를 검증합니다. mock 결과를 실제 Apple 모델 실행으로 표시하거나, 실패한 앱 동작을 skip으로 처리하지 않습니다. Speech와 다른 원래 검증의 실제 실행 요구는 유지합니다.

원래 55개 요구사항과 대체 테스트·판정 기준·초기화·비용·실패 이력은 [iOS 검증 목록](ios-validation.md)에 있습니다. Full E2E는 29개 cohort의 195개 관측과 별도의 Keychain 인증 두 사례를 포함합니다. Speech는 asset 준비 1개, 실제 통합 테스트 6개, 화면 저장 1개와 별도 프로세스의 저장 자료 검증 1개를 한 번씩 실행합니다. cohort 결과와 인증 receipt는 동일한 workflow run·attempt로 묶고, 다른 실행 결과를 재사용해 Full 성공으로 처리하지 않습니다.

Release 검증은 해당 workflow가 실행된 정확한 main SHA에 대해 성공한 nightly Full E2E를 요구합니다. main이 앞서 나가면 새 SHA의 nightly 실행이 성공할 때까지 release가 실패합니다. 이전 SHA 또는 이전 attempt 결과를 새 SHA 증거로 재사용하지 않습니다.

## PR 검사와 Full E2E

PR의 정적 분석, 타입 검사, 단위 테스트는 계속 실행하지만 E2E workflow는 시작하지 않습니다. `main`의 E2E는 nightly schedule과 수동 `workflow_dispatch`에서 Full로 실행합니다.

Full E2E 내부의 `Validate /` 결과는 전체 workflow의 성공을 구성하지만 PR branch protection 필수 상태는 아닙니다. 현재 PR 필수 검사 16개는 Code Quality, Unit Test, Policy Check에 속합니다. Full receipt는 29개 cohort와 195개 관측, OAuth 실행, 별도 Keychain 인증 작업의 두 관측 및 Face ID 입력 근거가 모두 성공해야 생성됩니다.

`Code Quality`·`Policy Check`·`Unit Test`는 PR과 main push에서 실행합니다. `E2E Test`는 `main`의 매일 03:00 KST schedule과 수동 `workflow_dispatch`만 사용하며 PR이나 push에서는 시작하지 않습니다. PR에서 E2E 필수 상태를 기다리지 않고, release workflow는 exact target SHA의 성공한 nightly E2E receipt를 요구합니다.

개발 중 특정 사례는 앞의 로컬 Core 검증 명령을 사용합니다. 공개 선택 실행 workflow는 없으며, `ios-focused.yml`은 Full E2E가 Keychain authentication suite를 실행할 때 재사용합니다.

PR 상태 변경과 제목·본문 수정, main push는 E2E를 시작하지 않습니다. `main`의 수동 Full 실행은 동일한 검증 graph를 실행하지만 release 증거가 되지는 않습니다. 실패·누락·취소·오래된 결과가 있으면 nightly Full receipt와 release 검증은 실패하며, 다음 일일 schedule의 exact main SHA 결과를 기다려야 합니다.
