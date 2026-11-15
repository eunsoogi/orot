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
- `recording/recordingPersistence.ts`, `recording/recordingScreenSupport.ts`: 기본 녹음 제목은 저장되는 자료 값이다. 기기 언어에 따라 기존 자료의 의미나 제목이 달라지는 변경을 도입하지 않는다.
- `ios/OrotMobile/MedicalDocumentPhotoPicker.swift`: 사진 확장자를 포함한 이름은 파일명·직렬화 경계다. 화면 label과 동일하게 취급하지 않는다.
- `encounterReview/NativeReviewProbe.tsx`, native 합성 캘린더 및 기타 testSupport: 검증 도구·합성 fixture는 production 사용자 표시 범위와 구분한다.

앞선 모델 지시, 임상 판별 정규식, 검색어, 원문 및 저장/모델 근거 직렬화 제외 원칙도 유지한다. 위 항목을 남겼다는 사실만으로 모든 잔여 한국어가 제외 대상이라고 판단하지 않는다. 실제 사용자 노출 고정문구는 파일별로 추가 분류한다.

## 검증과 한계

카탈로그·미지원 locale fallback·보존된 경고·모델 ID interpolation과 조사한 두 디렉터리의 inline 한국어 회귀 검사를 추가했다. 기존 설정/계정/모델 동작 테스트를 함께 검증한다. native UI나 실기기 동작을 검증한 것으로 간주하지 않는다. 아래 나머지 production/native 후보는 후속 작업이며 이 문서나 부분 PR로 전체 현지화가 완료되지 않는다.

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
