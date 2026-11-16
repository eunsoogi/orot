# 사용자 표시 문자열 현지화 점검

## 기준과 완료 범위

2026-11-15, main `de925d79` 기준 Git 추적 TS, TSX, Swift, Objective-C/C++, plist, strings 파일 전체를 한국어 포함 줄로 조사했다. JavaScript, 문서, 이미지와 기타 확장자는 이번 인벤토리의 대상이 아니다. 이 목록은 문자열의 용도를 판정한 완료 증명이 아니라 후속 검토 인벤토리다. 주석과 임상 매핑, 검색어, 모델 지시를 사용자 표시 문구로 오인해 기계적으로 번역하지 않는다. 사용자 자료는 조사하지 않았다.

앱은 현재 `ko` 한 언어만 지원하며 미지원 기기 locale은 한국어로 fallback한다. 영어 리소스나 언어 선택기를 이 작업에서 새로 도입하지 않는다.

첫 구현은 `apps/mobile/src/providers/selection`과 `apps/mobile/src/voiceSettings`의 사용자 표시 문구 전체를 `i18n/modelSettings.ts`에 모았다. 동의·요금·계정 분리·기기 내 처리/외부 전송 경계와 fallback 금지 문구의 의미를 그대로 유지한다. 버튼, 접근성 이름/힌트, 오류/상태, 모델 설명과 모델 ID 삽입을 포함한다. 실제 동의 절차·키 저장·네트워크 요청·모델 선택은 변경하지 않는다. 제품명과 API 식별자는 번역하지 않는다.

두 번째 구현은 `AppointmentPreparationRoute`와 `AppointmentReminderControls`의 19개 문구를 기존 `appointmentActionsKo.ts`에 통합한다. 잠금 화면 개인정보 안내, 알림 권한/실패 상태, 지원하지 않는 AI 생성 안내를 그대로 유지하며 예약과 알림의 실행 흐름은 변경하지 않는다.

세 번째 구현은 `nextVisitQuestions/copy.ts`와 `encounterReview/strings.ts`의 사용자 표시 110개 문구를 공유 카탈로그로 통합한다. 기존 copy 객체 API와 숫자 삽입 함수는 유지하며, 진단/처방으로 확정하지 않는 안내와 동의 및 검색 결과 미보존 경계를 그대로 유지한다. 임상 알고리즘·프롬프트·원본 자료를 변경하지 않는다.

네 번째 구현은 `evidenceSourceValues.ts`의 표시용 필드/상태 이름과 값 포맷 139개 문구를 카탈로그로 이동한다. 임상 용어의 원래 의미와 미검토/사람 검토/사용자 확인의 구분, 원문값, private identifier 제외, 시간대 포맷을 변경하지 않는다. #946 담당과 파일 범위를 조율했다.

다섯 번째 구현은 `evidenceSourcePresentation.ts`의 46개 고유 표시 문구를 카탈로그로 이동한다. 출처 확인 불가, 이전 AI 생성 답변의 비확정 의료 사실 안내, 사용자가 입력한 병력의 미검토/기준일 불명확 상태를 유지한다. 수동 기록 presentation은 줄 수 제한을 위해 별도 모듈로 분리하며 원문은 바꾸지 않는다. #946 담당과 파일 범위를 조율했다.

후속 구현에서는 알림·날짜 선택·인증 안내·백그라운드 상태의 native 고정 문구와 건강 집계의 고정 표시 이름을 리소스로 이동했다. 저장된 기억 화면의 표시 문구 20개도 기존 카탈로그로 통합하며, 실제 기억 원문·저장/조회 방식·foreground 및 삭제 fence는 변경하지 않는다. 기억을 실제로 불러오지 못하는 현상의 원인이 해결됐다는 뜻은 아니다. 건강 집계의 숫자 삽입 템플릿 8종도 후속으로 카탈로그화했다. 비교 수치의 부호·단위·기록 일수 및 원래 계산/시간대는 그대로 유지한다. 나머지 production 문구는 여전히 조사 대상이다.

최근 후속 배치는 녹음 내보내기 6문구, 저장 요약 기록 22문구, 요약 출처 8문구, 저장 진료 질문 19문구, Realtime 음성 9문구를 기존 카탈로그로 통합했다. 현재 배치는 이전 증상 자료의 삭제 확인·오류·표시 필드와 건강 기록 제목 21문구를 이동한다. 삭제 경고·동의·임상 재확인 의미와 원문 자료, 출처 및 실행 보호 조건은 보존한다. 기존 인벤토리는 최초 조사 시점 자료이며 최신 잔여 개수로 해석하지 않는다.

최근 연구 출처 경고·이벤트 시각·단위 표시 15문구는 카탈로그로 이관했다. 수면 단계·기간 서식·건강 항목 표시명 15문구도 이관했고, 현재 배치는 집계 범위 제한 경고 8문구를 그대로 이관한다. 측정 출처 제한, 수면 분류 제외, 미기록 날짜와 미복용의 구분, 센서 샘플 중복 및 미확인 제한 경고를 보존한다.

후속 분류에서 `manualHistoryEvidence.ts`의 한국어는 저장/모델 근거 직렬화에 해당하므로 단순 표시 이관에서 제외했다. `computedTopicChoices.ts`와 계산 수치 표시 템플릿은 이후 원문·단위·결측 의미를 보존해 40문구를 이관했다. 최초 인벤토리의 줄 수는 현재 잔여량이 아니다.

## 후속 분류 경계

2026-11-15 후속 검토에서는 출처 화면, 임상 후보 표시, 일일 보고서, 날짜 접근성, 저장 확인, 탐색 동작 및 native 고정 표시 문구를 추가로 이관했다. 각 변경의 실행 검증 범위와 정확한 head는 해당 PR에 기록한다. 이 진행 기록은 전체 저장소의 모든 문자열 분류가 끝났다는 뜻이 아니다.

다음 문자열은 사용자에게 보일 가능성만으로 카탈로그에 기계적으로 옮기지 않는다.

- `ragConversation/initialResponse.ts`: 기존 한국어 상수는 checkpoint 호환성 테스트용 legacy fixture다. 신규 요청에서 기계적 응답으로 삽입하지 않는 계약과 임상 검증 정규식을 유지한다.
- `aiFeatures/integration/observeLocalSearchFailures.ts`: 한국어 실패 문장은 `coverage.gaps.includes(...)`의 정확 문자열 매칭에 쓰인다. 표시 계층만의 문구가 아니므로 프로토콜의 생산자와 소비자 검토 없이 이동하지 않는다.
- `agent/visitQuestions/clarificationQuestions.ts`: 질문·근거 16문구는 `isKnownClarification`의 정확 일치 허용 목록과 연결된다. 모델 결과 검증 및 저장 경계를 포함하므로 단순 UI 이관에서 제외한다.
- `recording/recordingPersistence.ts`: 기본 녹음 제목은 production에서 저장되는 자료 값이다. 기기 언어에 따라 기존 자료의 의미나 제목이 달라지는 변경을 도입하지 않는다. `recording/recordingScreenSupport.ts`는 `jest.fn`과 합성 savedSource를 제공하는 테스트 fixture이므로 별도로 유지한다.
- `ios/OrotMobile/MedicalDocumentPhotoPicker.swift`: 사진 확장자를 포함한 이름은 파일명·직렬화 경계다. 화면 label과 동일하게 취급하지 않는다.
- `encounterReview/NativeReviewProbe.tsx`, native 합성 캘린더 및 기타 testSupport: 검증 도구·합성 fixture는 production 사용자 표시 범위와 구분한다.

앞선 모델 지시, 임상 판별 정규식, 검색어, 원문 및 저장/모델 근거 직렬화 제외 원칙도 유지한다. 위 항목을 남겼다는 사실만으로 모든 잔여 한국어가 제외 대상이라고 판단하지 않는다. 실제 사용자 노출 고정문구는 파일별로 추가 분류한다.

## 검증과 한계

카탈로그·미지원 locale fallback·보존된 경고·모델 ID interpolation과 조사한 두 디렉터리의 inline 한국어 회귀 검사를 추가했다. 기존 설정/계정/모델 동작 테스트를 함께 검증한다. native UI나 실기기 동작을 검증한 것으로 간주하지 않는다. 아래 나머지 production/native 후보는 후속 작업이며 이 문서나 부분 PR로 전체 현지화가 완료되지 않는다.

## 표시와 저장·프로토콜의 후속 구분

2026-11-15 추가 조사에서 SwiftPM provider 오류와 callback 표시, 요약 기간·불완전 근거 설명, 측정값 선택 결과, 일정 분류 설명을 카탈로그로 이관했다. Europe PMC 검색어별 동의와 로컬 검색 후속 답변도 별도 PR로 검증 중이다. 후속 답변은 대화 기록에 저장될 수 있으므로 비저장 UI라고 설명하지 않는다. 이관 전후 완성 문자열·검색 재개·근거 식별자는 동일하게 보존한다.

- `medicalAppointments/classificationDecision.ts`: wire enum을 검증한 뒤 고정 설명을 추가한다. 화면은 candidate reason을 표시하지만 일정 저장은 재검증한 event snapshot을 사용하며 설명을 저장 결정이나 동의 대상으로 비교하지 않는다.
- `aiFeatures/integration/continueArtifactSearch.ts`: query/cursor/catalog와 coverage가 재개·분기를 결정한다. answer의 한국어 문구를 프로토콜 값으로 비교하지 않지만, 생성된 답변 자체는 대화에 보존될 수 있다.
- `aiFeatures/integration/evidencePayload.ts`: 요청 크기 제한 문구는 coverage gap에 추가되며 정확한 `includes` 검사로 중복을 막는다. 표시 전용으로 취급하지 않는다.
- `aiFeatures/integration/defaultPublicSearch.ts`: 공개 검색 제한 설명은 검증된 결과의 `missingData`에 추가되어 표시·저장된다. 주제 판별 정규식과 함께 남아 있으므로 파일 전체를 단순 UI 이관 대상으로 분류하지 않는다.
- `aiFeatures/integration/publicWebEvidence.ts`: recipient와 locator title은 외부 전송 동의·증거 출처 문맥에 연결된다. source identity를 검토하지 않은 기계적 이동은 하지 않는다.
- `treatmentContext/hypertensionEducation.ts`: 대상 집단 문구는 검토 시각과 함께 공개 근거 locator에 들어가고 전체 reference를 `stableJson`으로 비교한다. 원문·revision의 일부로 보존한다.
- `diseaseHypotheses/appleSummaryRecordSections.ts`: 후속 검토에서 schema는 topic/source ID와 statistic selector를 사용하고 한국어 title은 정규화된 section의 출력 값임을 확인했다. topic key·source ID와 과거 저장 자료를 유지한 채 title 값만 동일하게 이관한다. `summaryOverviewSelections.ts`의 출력 title도 같은 경계다.
- `ios/OrotMobile/Info.plist`의 권한 사용 목적과 앱 이름은 이미 플랫폼 리소스 값이다. 개인정보 관련 동의 내용을 바꾸거나 지원하지 않는 언어를 추가하는 작업과 단순 코드 문자열 정리를 구분한다.
- `packages/provider-openai/ios-spike` 및 package fixture는 OAuth 검증용 harness·합성 자료로 분류한다. shipping provider의 오류 표시 리소스와 별개다.

정규식의 한국어 날짜·단위·임상 판정 표현, 모델 지시, 원문 및 근거 직렬화는 유지한다. 최초 아래 인벤토리는 역사적 조사 목록이며 현재 미완료 파일 수가 아니다. 이 후속 구분도 모든 경로의 전수 완료 선언은 아니다.

## 최신 재점검 범위

2026-11-15, main `64922a11`에 요약 section title 이관 배치를 더한 tree를 재점검했다. 테스트·fixture·리소스를 제외한 `apps/mobile/src` TSX의 한국어 포함 파일은 합성 검증용 `NativeReviewProbe.tsx`뿐이었다. shipping Swift/Objective-C 소스의 잔여 한국어는 사진 `displayName` 직렬화 값이었다. 추가로 Git 추적 JavaScript/JSX/MJS/CJS를 조사했으며 한국어는 `scripts/evaluation`의 합성 provider와 평가 정규식에서 확인했다. 이미지·외부 생성 자료까지 모든 표시를 검증했다는 뜻은 아니다.

`evidenceSearchTool.ts`의 제한·실패 문구는 `EvidenceBatch.coverage.gaps`를 생성하고 요청 byte 제한 계산에도 포함된다. `evidenceSnapshot.ts`의 문구 역시 모델 근거 coverage/gaps이며 표시 전용이 아니다. `dailyReportFacts.ts`의 단위·설명은 `modelText` 직렬화, `savedVisitQuestionGeneratedSources.ts`의 문구는 근거 content, `conversationHealthHistory.ts`의 제목은 저장되는 기록 값이다. 이들을 단순 UI 누락으로 분류해 변경하지 않았다.

이 재점검은 명확한 화면 고정문구의 누락 후보를 좁힌 결과다. 저장·모델·검증 경계의 한국어까지 제거하거나, 지원 언어를 늘리거나, 실제 사용자 자료·기기 화면을 검증한 결과가 아니다. 과거 인벤토리는 계속 역사적 기록으로 유지한다.

## 남아 있는 한국어 포함 소스 인벤토리

테스트/fixture와 기존 리소스는 의도적으로 유지한다. 아래 분류는 경로/역할에 따른 1차 분류이며 실제 사용자 노출 여부와 임상 의미는 후속 파일별 검토가 필요하다. 숫자는 한국어가 있는 물리적 줄 수로 문자열 수가 아니다.

### Existing catalog or copy module (review catalog integration)

- `apps/mobile/src/i18n/aiActivity.ts`: 14
- `apps/mobile/src/i18n/aiFeatures.ts`: 30
- `apps/mobile/src/i18n/appointmentActionsKo.ts`: 11
- `apps/mobile/src/i18n/assistantAppearance.ts`: 31
- `apps/mobile/src/i18n/backupKo.ts`: 15
- `apps/mobile/src/i18n/charts.ts`: 24
- `apps/mobile/src/i18n/conversationToolKo.ts`: 15
- `apps/mobile/src/i18n/dailyReportCoverageKo.ts`: 12
- `apps/mobile/src/i18n/dailyReportFailuresKo.ts`: 8
- `apps/mobile/src/i18n/diseaseHypotheses.ts`: 26
- `apps/mobile/src/i18n/externalMedicalEvidence.ts`: 49
- `apps/mobile/src/i18n/healthRecords.ts`: 74
- `apps/mobile/src/i18n/healthkitBloodPressure.ts`: 38
- `apps/mobile/src/i18n/healthkitCommonObservations.ts`: 20
- `apps/mobile/src/i18n/healthkitSettings.ts`: 175
- `apps/mobile/src/i18n/healthkitUnifiedImport.ts`: 49
- `apps/mobile/src/i18n/ko.ts`: 180
- `apps/mobile/src/i18n/manualHistory.ts`: 65
- `apps/mobile/src/i18n/medicalAppointments.ts`: 118
- `apps/mobile/src/i18n/medicalDocumentDeletion.ts`: 9
- `apps/mobile/src/i18n/medicalDocumentOriginalPhoto.ts`: 15
- `apps/mobile/src/i18n/medicalDocumentSaveErrors.ts`: 3
- `apps/mobile/src/i18n/navigation.ts`: 57
- `apps/mobile/src/i18n/overview.ts`: 47
- `apps/mobile/src/i18n/probeKo.ts`: 41
- `apps/mobile/src/i18n/providerAccounts.ts`: 70
- `apps/mobile/src/i18n/ragConversation.ts`: 162
- `apps/mobile/src/i18n/recordingKo.ts`: 127
- `apps/mobile/src/i18n/replyNotificationKo.ts`: 8
- `apps/mobile/src/i18n/treatmentSafety.ts`: 60
- `apps/mobile/src/i18n/visitQuestionRestoration.ts`: 14
- `apps/mobile/src/i18n/visitQuestions.ts`: 101
- `apps/mobile/src/i18n/voiceConversationKo.ts`: 22

### Native source or system string (manual localization review)

- `apps/mobile/ios/Navigation/ConversationHistoryView.swift`: 1
- `apps/mobile/ios/Navigation/GlassIconButton.swift`: 1
- `apps/mobile/ios/Navigation/NavigationGlassButton.swift`: 1
- `apps/mobile/ios/OrotMobile/Info.plist`: 7
- `apps/mobile/ios/OrotMobile/ManualHistoryDateSheet.swift`: 6
- `apps/mobile/ios/OrotMobile/MedicalDocumentPhotoPicker.swift`: 1
- `apps/mobile/ios/OrotMobile/OpenAIProviderAuthCoordinator.swift`: 6
- `apps/mobile/ios/OrotMobile/OpenAIProviderAuthSession.swift`: 3
- `apps/mobile/ios/OrotMobile/OpenAIProviderModule.swift`: 2
- `apps/mobile/ios/OrotMobile/ReminderCopy.strings`: 3
- `apps/mobile/ios/OrotMobile/ReplyNotificationService.swift`: 2
- `apps/mobile/ios/OrotMobile/SyntheticCalendarTestModule.swift`: 2
- `packages/provider-openai/Sources/OpenAIProvider/LoopbackCallbackServer.swift`: 5
- `packages/provider-openai/Sources/OpenAIProvider/OAuthTypes.swift`: 22
- `scripts/ci/tests/fixtures/ios-encounter-input-observation-control.swift`: 1

### Remaining production display/semantic candidate (manual review)

- `apps/mobile/e2e/aiFeatureVisitQuestionsProbeEntry.tsx`: 14
- `apps/mobile/e2e/aiFeatureVisitQuestionsSyntheticEvidence.ts`: 1
- `apps/mobile/e2e/aiScaleMeasurements.ts`: 2
- `apps/mobile/e2e/aiScaleSeed.ts`: 2
- `apps/mobile/e2e/appleFoundationModelsProbe.ts`: 5
- `apps/mobile/e2e/appleFoundationModelsProbeValidation.ts`: 2
- `apps/mobile/e2e/appleModelMockBridgeProbe.ts`: 9
- `apps/mobile/e2e/appleWorkflowProbe.ts`: 4
- `apps/mobile/e2e/chartFoundationEntry.tsx`: 14
- `apps/mobile/e2e/checkpointPersistenceOperation.ts`: 1
- `apps/mobile/e2e/checkpointProbeEntry.tsx`: 1
- `apps/mobile/e2e/conversationVisualProbeEntry.tsx`: 1
- `apps/mobile/e2e/dailyReportVisualProbeEntry.tsx`: 3
- `apps/mobile/e2e/encounterPersistenceOperation.ts`: 1
- `apps/mobile/e2e/evidenceSourceDuoConversationRunner.ts`: 2
- `apps/mobile/e2e/healthContextPersistenceTestOperation.ts`: 1
- `apps/mobile/e2e/hybridRetrievalProbe.ts`: 4
- `apps/mobile/e2e/localE5CancellationProbe.ts`: 1
- `apps/mobile/e2e/localE5EmbeddingProbe.ts`: 11
- `apps/mobile/e2e/medicalAppointmentNavigationProbeEntry.tsx`: 1
- `apps/mobile/e2e/nextVisitQuestionsProbe.tsx`: 9
- `apps/mobile/e2e/openaiProviderProbe.tsx`: 6
- `apps/mobile/e2e/performanceDataEntry.tsx`: 4
- `apps/mobile/e2e/performanceEvidenceProbe.ts`: 1
- `apps/mobile/e2e/performanceRagDiagnostics.ts`: 1
- `apps/mobile/e2e/performanceVisitEvidenceProbe.ts`: 1
- `apps/mobile/e2e/recordingPersistenceTestOperation.ts`: 2
- `apps/mobile/e2e/standardAdaptersOpenAIProbe.ts`: 2
- `apps/mobile/e2e/storePersistenceMutation.ts`: 1
- `apps/mobile/e2e/storeWorkflowProbe.ts`: 1
- `apps/mobile/e2e/storeWorkflowProvider.ts`: 5
- `apps/mobile/e2e/summaryVisualProbeEntry.tsx`: 7
- `apps/mobile/e2e/svgFoundationEntry.tsx`: 4
- `apps/mobile/e2e/transcription/automaticRecapSyntheticProvider.ts`: 6
- `apps/mobile/e2e/transcription/transcriptDeletionProbeSupport.ts`: 1
- `apps/mobile/e2e/transcription/transcriptEvidenceProbeSupport.ts`: 1
- `apps/mobile/e2e/unifiedImportProbeCopy.ts`: 16
- `apps/mobile/e2e/visitGenerationVisualState.ts`: 2
- `apps/mobile/e2e/visitQuestionsProbe.tsx`: 10
- `apps/mobile/e2e/visitQuestionsProbeEntry.tsx`: 1
- `apps/mobile/src/agent/visitQuestions/clarificationResponse.ts`: 3
- `apps/mobile/src/agent/visitQuestions/persistenceRecords.ts`: 1
- `apps/mobile/src/agent/visitQuestions/questionFactPrecision.ts`: 2
- `apps/mobile/src/agent/visitQuestions/questionFacts.ts`: 6
- `apps/mobile/src/agent/visitQuestions/visitContext.ts`: 1
- `apps/mobile/src/agent/visitQuestions/workflow.ts`: 1
- `apps/mobile/src/aiFeatures/integration/ArtifactSourceLinks.tsx`: 5
- `apps/mobile/src/aiFeatures/integration/EvidenceSourceDetailScreen.tsx`: 3
- `apps/mobile/src/aiFeatures/integration/EvidenceSourceSections.tsx`: 1
- `apps/mobile/src/aiFeatures/integration/continueArtifactSearch.ts`: 5
- `apps/mobile/src/aiFeatures/integration/conversationPhotoEvidence.ts`: 1
- `apps/mobile/src/aiFeatures/integration/conversationPhotoService.ts`: 1
- `apps/mobile/src/aiFeatures/integration/dailyReportFacts.ts`: 3
- `apps/mobile/src/aiFeatures/integration/evidencePayload.ts`: 1
- `apps/mobile/src/aiFeatures/integration/evidenceRecordHero.ts`: 7
- `apps/mobile/src/aiFeatures/integration/evidenceSearchTool.ts`: 3
- `apps/mobile/src/aiFeatures/integration/evidenceSnapshot.ts`: 2
- `apps/mobile/src/aiFeatures/integration/externalConversationEvidence.ts`: 4
- `apps/mobile/src/aiFeatures/integration/featureServices.ts`: 3
- `apps/mobile/src/aiFeatures/integration/healthContextPresentation.ts`: 57
- `apps/mobile/src/aiFeatures/integration/healthSourceSemantics.ts`: 8
- `apps/mobile/src/aiFeatures/integration/manualHistoryEvidence.ts`: 10
- `apps/mobile/src/aiFeatures/integration/observeLocalSearchFailures.ts`: 1
- `apps/mobile/src/aiFeatures/integration/provider.ts`: 4
- `apps/mobile/src/aiFeatures/integration/publicWebEvidence.ts`: 2
- `apps/mobile/src/aiFeatures/integration/researchSourcePresentation.ts`: 8
- `apps/mobile/src/aiFeatures/integration/savedVisitQuestionGeneratedSources.ts`: 1
- `apps/mobile/src/aiFeatures/integration/savedVisitQuestionNotice.ts`: 10
- `apps/mobile/src/aiFeatures/integration/useNextVisitQuestionsRoute.ts`: 1
- `apps/mobile/src/calendar/CalendarAccessibleDates.tsx`: 1
- `apps/mobile/src/diseaseHypotheses/ConversationSummaryHistory.tsx`: 7
- `apps/mobile/src/diseaseHypotheses/DiseaseEvidenceLinks.tsx`: 6
- `apps/mobile/src/diseaseHypotheses/DiseaseHypothesesScreen.tsx`: 2
- `apps/mobile/src/diseaseHypotheses/DiseaseHypothesesScreenOutput.tsx`: 2
- `apps/mobile/src/diseaseHypotheses/SavedSummaryHistory.tsx`: 20
- `apps/mobile/src/diseaseHypotheses/SummaryHeader.tsx`: 1
- `apps/mobile/src/diseaseHypotheses/SummaryHistoryScreen.tsx`: 1
- `apps/mobile/src/diseaseHypotheses/appleSummaryRecordSections.ts`: 5
- `apps/mobile/src/diseaseHypotheses/clinicalClaimGuard.ts`: 7
- `apps/mobile/src/diseaseHypotheses/computedQuantityChoices.ts`: 17
- `apps/mobile/src/diseaseHypotheses/computedStatisticChoice.ts`: 1
- `apps/mobile/src/diseaseHypotheses/computedSummaryLimitations.ts`: 8
- `apps/mobile/src/diseaseHypotheses/computedTopicChoices.ts`: 21
- `apps/mobile/src/diseaseHypotheses/summaryConcreteFacts.ts`: 2
- `apps/mobile/src/diseaseHypotheses/summaryFactValidation.ts`: 7
- `apps/mobile/src/diseaseHypotheses/summaryLanguage.ts`: 1
- `apps/mobile/src/diseaseHypotheses/summaryOverviewConcepts.ts`: 8
- `apps/mobile/src/diseaseHypotheses/summaryOverviewSelections.ts`: 4
- `apps/mobile/src/diseaseHypotheses/summaryPartialEvidence.ts`: 1
- `apps/mobile/src/diseaseHypotheses/summaryPartialValidation.ts`: 1
- `apps/mobile/src/diseaseHypotheses/summaryPeriodDuration.ts`: 1
- `apps/mobile/src/diseaseHypotheses/summarySleepDuration.ts`: 1
- `apps/mobile/src/diseaseHypotheses/summaryStatisticRoles.ts`: 8
- `apps/mobile/src/diseaseHypotheses/summaryUncertainty.ts`: 1
- `apps/mobile/src/diseaseHypotheses/taskTestSupport.ts`: 6
- `apps/mobile/src/encounterReview/CandidatePanel.tsx`: 5
- `apps/mobile/src/encounterReview/NativeReviewProbe.tsx`: 5
- `apps/mobile/src/externalMedicalEvidence/PublicWebSourceLinks.tsx`: 5
- `apps/mobile/src/healthkit/HealthRecordsDetailHeader.tsx`: 1
- `apps/mobile/src/healthkit/HealthRecordsDetailScreen.tsx`: 1
- `apps/mobile/src/healthkit/HealthRecordsMedicationCategoryCard.tsx`: 1
- `apps/mobile/src/healthkit/HealthRecordsMedicationDetailScreen.tsx`: 1
- `apps/mobile/src/healthkit/sleep/sleepRecordSemantics.ts`: 10
- `apps/mobile/src/healthkit/unifiedImport/EventKitSourceCard.tsx`: 1
- `apps/mobile/src/healthkit/unifiedImport/HealthKitProviderCard.tsx`: 3
- `apps/mobile/src/manualHistory/conversationHistoryIntent.ts`: 5
- `apps/mobile/src/medicalAppointments/MedicalAppointmentReviewView.tsx`: 1
- `apps/mobile/src/medicalAppointments/classificationDecision.ts`: 3
- `apps/mobile/src/memory/SavedMemoryBrowser.tsx`: 21
- `apps/mobile/src/memory/agentMemoryRagProbe.ts`: 2
- `apps/mobile/src/navigation/NavigationBarHost.tsx`: 2
- `apps/mobile/src/navigation/NavigationBottomPageActions.tsx`: 2
- `apps/mobile/src/navigation/navigationActionDescriptor.ts`: 2
- `apps/mobile/src/navigation/useBottomActionMenu.ts`: 1
- `apps/mobile/src/nextVisitQuestions/QuestionCard.tsx`: 9
- `apps/mobile/src/nextVisitQuestions/SourceEvidenceSheet.tsx`: 1
- `apps/mobile/src/ragConversation/artifactContinuation.ts`: 1
- `apps/mobile/src/ragConversation/availabilityIntent.ts`: 1
- `apps/mobile/src/ragConversation/clinicalClaimValidation.ts`: 3
- `apps/mobile/src/ragConversation/confirmHistorySave.ts`: 3
- `apps/mobile/src/ragConversation/conversationEntryContext.ts`: 1
- `apps/mobile/src/ragConversation/conversationHistoryPayload.ts`: 1
- `apps/mobile/src/ragConversation/initialResponse.ts`: 2
- `apps/mobile/src/ragConversation/literatureIntent.ts`: 4
- `apps/mobile/src/recording/recordingExportService.ts`: 5
- `apps/mobile/src/recording/recordingPersistence.ts`: 1
- `apps/mobile/src/recording/recordingScreenSupport.ts`: 1
- `apps/mobile/src/routes/LegacySymptomData.tsx`: 19
- `apps/mobile/src/routes/RecordsRecentTimeline.ts`: 1
- `apps/mobile/src/routes/overview/metricLoader.ts`: 2
- `apps/mobile/src/storage/conversationHealthHistory.ts`: 1
- `apps/mobile/src/transcription/accuracyEvaluation.ts`: 2
- `apps/mobile/src/treatmentContext/hypertensionEducation.ts`: 1
- `apps/mobile/src/treatmentContext/treatmentSafetyBoundary.ts`: 1
- `apps/mobile/src/voiceConversation/RealtimeConversationVoiceEntry.tsx`: 7
- `apps/mobile/src/voiceConversation/VoiceConversationScreen.tsx`: 1
- `apps/mobile/test-helpers/overviewGeneratorHarness.tsx`: 3

### Semantic, query or model-instruction boundary (manual review before changing)

- `apps/mobile/src/agent/visitQuestions/clarificationQuestions.ts`: 16
- `apps/mobile/src/agent/visitQuestions/periodQuestionFacts.ts`: 9
- `apps/mobile/src/aiFeatures/integration/dailyReportSynthesis.ts`: 12
- `apps/mobile/src/aiFeatures/integration/defaultPublicSearch.ts`: 23
- `apps/mobile/src/healthEvidence/evidenceCandidateScope.ts`: 93

### Test, fixture or development surface (retain)

797개 파일은 synthetic fixture, 테스트 assertion 또는 개발 전용 화면으로 분류해 유지했다. 사용자 표시 현지화 완료 개수에 포함하지 않는다.

## 공개 검색 제한 안내 후속 이관

2026-11-16, main `78f03ce8`에서 기존 연결 PR과 잔여 TSX/TS 인벤토리를 다시 확인했다. `defaultPublicSearch.ts`의 세 고정 안내는 `status`로 선택되며 문자열 자체를 동의 판단, 검색어, source identity 또는 분기 키로 비교하지 않는다. `annotatePublicSearchLimit`의 `missingData`와 `finishRagConversation`의 최종 답변에 들어가 표시·저장될 수 있으므로 비저장 UI라고 분류하지 않는다. 이번 좁은 배치는 세 안내의 원문을 기존 한국어 카탈로그로 이동하며, 비슷한 진료 질문 안내의 “않았어요”로 바꾸지 않고 기존 “못했어요”를 유지한다.

공개 topic 정규식, 검색어 제한, 동의와 취소, 호출 예산, 기존 불확실성 및 원본 자료는 변경하지 않는다. 한국어 외 locale의 fallback과 기존 저장 문자열도 유지한다. 모델 지시, 정확 일치 허용 목록, 프로토콜·저장 값 및 합성 fixture의 잔여 한국어는 기존 분류 경계를 따른다. 이 후속 검토는 전체 저장소·이미지·실기기의 현지화 완료를 뜻하지 않는다.

## 검증 허용 목록과 공유하는 진료 확인 질문

2026-11-16, main `31832858`에서 앞서 기계적 이관을 제외했던 `clarificationQuestions.ts`의 실제 소비자를 추가 검토했다. 여덟 질문·이유 쌍은 `taskContract`에서 모델에 제공되고 `taskValidation`의 `isKnownClarification`이 정확한 쌍으로 검증하며, 검토 화면과 저장 결과에도 쓰인다. 이번 이관은 원문 16개를 기존 한국어 카탈로그로 옮기되 같은 단일 `clarificationQuestions` 객체를 모든 소비자가 계속 사용하도록 한다. 임상 질문을 번역·재작성하거나 허용 조합을 늘리지 않는다.

기존 순서와 전체 문자열의 정확한 동등성, 다른 이유와의 교차 조합 및 공백 변경 거부, 미지원 locale의 동일 한국어 fallback을 회귀 검사한다. 미완·상충 근거의 질문 검증, 동의·workflow, 저장·복원 및 사람이 검토한 기존 질문 동작도 관련 기존 검증으로 확인한다. 과거 저장 내용의 migration이나 새 언어를 도입하지 않으며, 나머지 모델 지시·프로토콜·임상 정규식·원문 자료를 표시 카탈로그로 기계 이동하지 않는다. 전수 audit 완료는 여전히 주장하지 않는다.

현재 목록의 `t()`는 모듈 초기화 시 평가되고 앱은 한국어만 지원한다. 기존 저장 질문·이유의 원문 쌍은 고정 회귀 fixture로 검증한다. 향후 새 언어나 실행 중 locale 전환을 도입할 경우 현재 번역 목록으로 과거 저장값의 허용 여부를 다시 정하지 않도록, 버전이 있는 허용 목록과 저장 호환성 정책을 별도로 설계·검증해야 한다. 이번 변경은 그런 전환을 구현하거나 승인하지 않는다.

## 새 녹음 원본 제목과 잔여 경계 재검토

2026-11-16 main `4e3d074f`에서 mobile `src`의 TS/TSX와 iOS 및 shared packages의 TS/TSX/Swift/Objective-C 한국어 출현 파일을 재검색했다. `recordingPersistence.ts`의 새 원본 제목은 기존 `recording.title`과 정확히 같으며 신규 저장 때만 같은 카탈로그 값을 사용하도록 이관한다. 기존 저장·사용자 편집 제목은 재시도나 누락된 녹음 길이 보완에서도 덮어쓰지 않는다. 한국어 외 locale도 기존 한국어 제목으로 fallback한다. 저장 제목을 향후 언어 변경 시 일괄 재작성하는 정책은 도입하지 않는다.

잔여 출현은 다음처럼 분리해 유지한다.

- `recordingScreenSupport.ts`는 이름과 달리 `jest.fn`을 쓰는 합성 테스트 지원 코드다. fixture 원문을 카탈로그 참조로 바꿔 회귀 검증을 약화하지 않는다.
- `observeLocalSearchFailures.ts`의 로컬 검색 실패 문구는 `coverage.gaps.includes`의 정확 비교 값이다. 표시 문자열로 기계 이관하지 않는다.
- `featureServices`, `conversationEntryContext`, 사진 OCR의 신규·복원 경로, 진료 질문 workflow와 저장 질문의 모델 문맥은 모델 요청·근거 payload다. 프롬프트와 저장 재개 호환성을 따로 검토해야 한다.
- 임상 주장·수치·기간·복약·의도 정규식과 evidence 검색어는 입력 인식 및 검증 경계다. 임상 의미나 허용 입력을 변경하지 않는다.
- native `MedicalDocumentPhotoPicker.swift`의 `사진.<확장자>`는 첨부 파일 metadata 기본값이다. JS 카탈로그만 바꾸어 해결되는 화면 문구가 아니므로 별도 native 저장·복원 경계 검토가 남는다. provider iOS spike와 synthetic calendar/probe는 개발·합성 표면이다.

이 검색은 원문 포함 파일을 찾는 source audit이며 전체 이미지·native UI·실모델 및 동적 생성 문자열의 현지화 완료 증거가 아니다. 부모 이슈는 열린 상태로 유지한다.

## 신규 사진 첨부 기본 표시 이름

2026-11-16 main `158bbbb5`에서 일반 production TSX의 잔여 한국어는 확인되지 않았으며, TS의 모델 지시·정규식·정확 비교·합성 fixture와 진행 중인 보고서 경계는 유지했다. 별도 native 잔여인 `MedicalDocumentPhotoPicker.swift`의 신규 사진 첨부 표시 이름만 기존 `NativeInterfaceCopy` 기본 문자열 테이블로 옮긴다. `사진.%@`에 기존 jpg/heic/png 확장자를 보간하므로 기존 결과 바이트를 유지한다. 한국어 단일 기본 테이블이며 다른 언어 리소스는 추가하지 않는다.

이 이름은 검토 화면에 표시되고 저장 시 source title이 될 수 있다. 실제 보호 파일명은 기존 UUID와 확장자이며 변경하지 않는다. 문서 선택기의 원본 파일명, 이미 저장된 제목, OCR 원문·hash·preview·동의·삭제·중복 재시도는 바꾸지 않는다. 클라우드 리소스/소스 동등성 및 합성 저장 회귀와 실제 UIKit/Bundle 런타임 증거를 구분하며, 이 배치로 전체 동적·모델 생성 문자열 현지화 완료를 주장하지 않는다.

## 공개 검색 수신자·출처 이름 후속 점검

2026-11-16, main `4ce63bf4`의 Git 추적 TS/TSX, Swift, Objective-C/C++, JS/JSX/MJS/CJS, plist, strings 4,726개 파일을 한국어 출현 기준으로 재검색했다. 1,062개 파일에 한국어가 있었으며 이는 미번역 UI 개수가 아니다. 카탈로그·플랫폼 리소스, 합성 fixture·assertion, 모델 지시, 임상/의도 정규식, 저장·직렬화 계약을 구분했다. shipping TSX의 카탈로그 밖 잔여 출현은 합성 검증 화면과 테스트이며, native 고정 UI 문구는 기존 `.strings` 및 권한 목적 `Info.plist`에 있었다. 이미지나 외부 생성 콘텐츠, 실제 사용자 기록은 이 코드 조사에 포함하지 않았다.

`publicWebEvidence.ts`의 두 표시 문자열은 이전 예외 목록에 남아 있었다. 이번에는 호출 경계를 검토하고 기존 카탈로그에 새 `publicSearchRecipient`와 `publicSearchSourceTitle` 키를 추가해 옮겼다. 전자는 실제 동의 수신자 문자열이고 후자는 저장될 수 있는 locator title이므로 장식용 UI라고 취급하지 않는다. 현재 단일 한국어 카탈로그에서 직렬화 결과를 정확히 유지하며 provider/model ID, source ID, 조회 시각·revision, 질의와 동의 payload, 취소·기한·검색 호출은 바꾸지 않는다. 기존 저장 출처를 다시 쓰거나 새 언어를 도입하지 않는다.

합성 회귀는 한국어와 미지원 `en-US`, `ja-JP`, `fr-FR`에서 동일 수신자/locator title, 중괄호가 포함된 계정 이름의 그대로 삽입, provider/model identity와 한 번의 검색 호출을 검사한다. 기존 동의 거절·취소·요청 범위 회귀는 별도로 유지한다. 번역 결과를 assertion의 expected 값으로 재사용하지 않고 기존 한국어 원문을 고정 기대값으로 둔다.

그 밖의 출현은 자동 제거하지 않는다. `initialResponse.ts`는 versioned checkpoint 호환 문구이고, `periodQuestionFacts`·summary 사실/언어 검사는 단위와 임상 검증 계약이다. evidence payload/snapshot/search의 gap 문구는 모델 직렬화·byte budget에 영향을 주며, 사진/병력/진료 질문 evidence 문구와 건강기록 제목은 저장 또는 모델 근거다. `dailyReportFacts` 단위 표현은 별도 #946 표시 개선의 소유 범위로 남긴다. 이 배치는 그런 계약을 무검증으로 바꾸지 않으며 모든 화면·자료의 현지화 완료를 주장하지 않는다.

## 직접 JSX 표시 문구 회귀 방지

2026-11-16 main `d476c1e6` 재점검에서 shipping TSX의 직접 한국어 표시 문구는 기존 카탈로그로 이관된 상태였다. 일반 TS의 임상·의도 정규식, 모델 검색어, 버전 체크포인트 및 저장·직렬화 문구는 표시 전용이라고 판단하지 않아 그대로 보존했다.

`scripts/quality/ui-copy-audit.mjs`는 TypeScript AST로 직접 JSX 텍스트와 title, label, accessibilityLabel, accessibilityHint, placeholder, message, status, pipeline 속성의 문자열·템플릿을 검사한다. 주석·정규식·이벤트 콜백을 기계적으로 번역하지 않는다. 테스트·카탈로그 디렉터리 및 정확한 개발 전용 `NativeReviewProbe.tsx` 경로만 제외하며, 임의의 Probe 이름 파일은 제외하지 않는다. 앱 src의 TSX 변경은 기존 policy test gate를 실행해 이 검사를 누락하지 않는다.

이 검사는 간접 변수·동적 생성 문구, TS 직렬화, native 리소스, 이미지 및 실제 모델 출력의 완전한 현지화를 증명하지 않는다. 한국어 단일 카탈로그와 미지원 locale fallback, 보간·동의·임상 의미 및 기존 사용자 자료는 변경하지 않는다. 부모 이슈의 수동 경계 감사는 계속 필요하다.
