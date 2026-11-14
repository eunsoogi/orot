import { voiceConversationKo } from './voiceConversationKo';

/** Korean catalog entries for the grounded local-record conversation screen. */
export const ragConversationKo = {
  ...voiceConversationKo,
  'ragConversation.title': '기록과 대화',
  'ragConversation.placeholder': '기록에 관해 물어보세요',
  'ragConversation.send': '질문하기',
  'ragConversation.photo.select': '사진 첨부',
  'ragConversation.photo.selectHint': '한 번에 사진 한 장을 선택해요.',
  'ragConversation.photo.remove': '첨부 사진 제거',
  'ragConversation.photo.preview': '첨부할 사진 미리보기',
  'ragConversation.photo.message': '첨부한 사진',
  'ragConversation.photo.preparing': '사진을 준비하고 있어요.',
  'ragConversation.photo.transferring':
    '사진을 안전하게 전송할 준비를 하고 있어요.',
  'ragConversation.photo.error':
    '사진을 준비하지 못했어요. 다시 선택해 주세요.',
  'ragConversation.photo.unavailable':
    '사진을 보낼 준비가 되지 않았어요. 다시 시도하거나 사진을 제거해 주세요.',
  'ragConversation.photo.unsupported':
    '사진을 준비할 수 없어요. HEIC, JPEG 또는 PNG 사진을 다시 선택해 주세요.',
  'ragConversation.photo.empty':
    '사진에서 글자를 찾지 못했어요. 글자가 잘 보이는 사진을 선택해 주세요.',
  'ragConversation.photo.protection':
    '사진을 안전하게 보관할 수 없어요. 기기 상태를 확인하고 다시 시도해 주세요.',
  'ragConversation.photo.pickerUnavailable':
    '사진 선택기를 사용할 수 없어요. 잠시 후 다시 시도해 주세요.',
  'ragConversation.photo.retryCleanup': '임시 사진 정리 다시 시도',
  'ragConversation.photo.cleanupFailed':
    '이전 임시 사진을 정리하지 못했어요. 다시 시도해 주세요.',
  'ragConversation.photo.ocrDisclosure':
    '사진에서 추출한 글자를 보내요. 사진 자체는 보내지 않아요.',
  'ragConversation.photo.consentTitle':
    '{provider}에서 사진의 글자를 처리해요.',
  'ragConversation.photo.consentDestination':
    '모델: {model}\n처리 대상: {recipient}',
  'ragConversation.photo.consentRemote':
    '추출한 글자가 선택한 서비스로 전송돼요. 사진 원본은 보내지 않아요.',
  'ragConversation.photo.consentLocal':
    '추출한 글자를 이 기기에서 처리해요. 사진 원본은 보내지 않아요.',
  'ragConversation.photo.consentApprove': '동의하고 계속',
  'ragConversation.photo.consentCancel': '취소',
  'ragConversation.sessions': '대화 목록',
  'ragConversation.newConversation': '새 대화',
  'ragConversation.transmissionNotice':
    '필요하면 동의를 받고 공개 웹자료와 의학 문헌도 찾아요.',
  'ragConversation.disclaimer': 'AI 답변은 진료를 대신하지 않아요.',
  'ragConversation.loading': '저장된 근거를 확인하고 있어요.',
  'ragConversation.progressAnswer': '답변을 작성하고 있어요.',
  'ragConversation.progressRevisedAnswer': '답변을 다듬고 있어요.',
  'ragConversation.progressResearch': '추가 근거를 살펴보고 있어요.',
  'ragConversation.progressLocalSearch': '기록에서 근거를 찾고 있어요.',
  'ragConversation.progressExternalSearch': '공개 자료를 찾아보고 있어요.',
  'ragConversation.progressEvidenceComplete':
    '근거를 확인했어요. 답변을 정리하고 있어요.',
  'ragConversation.progressEvidenceFailed': '근거를 확인하지 못했어요.',
  'ragConversation.progressEvidenceCancelled': '근거 확인을 취소했어요.',
  'ragConversation.progressCancelled': '답변 생성을 중지했어요.',
  'ragConversation.progressInterrupted':
    '답변 생성이 중단됐어요. 다시 보내기 전에 내용을 확인해 주세요.',
  'ragConversation.previewSaveFailed':
    '일부 답변을 저장하지 못해 중단 후 복원되지 않을 수 있어요.',
  'ragConversation.noEvidence':
    '이 질문에 답할 만한 저장된 근거를 찾지 못했어요.',
  'ragConversation.insufficient':
    '근거가 부족하거나 서로 맞지 않아 답을 만들지 않았어요.',
  'ragConversation.unavailable':
    '답변을 만들지 못했어요. 잠시 후 다시 시도해 주세요.',
  'ragConversation.failureAuthentication':
    '선택한 AI 서비스의 계정 연결을 확인한 뒤 다시 시도해 주세요.',
  'ragConversation.failureRateLimited':
    'AI 서비스가 요청을 잠시 제한했어요. 잠시 후 다시 시도해 주세요.',
  'ragConversation.failureProviderConfiguration':
    '선택한 AI 서비스 설정을 확인하거나 다른 제공자를 선택해 주세요.',
  'ragConversation.failureProviderRefused':
    '선택한 AI 서비스가 이 요청에 답하지 않았어요. 질문을 바꿔 다시 시도해 주세요.',
  'ragConversation.failureProviderUnavailable':
    '선택한 AI 서비스를 사용할 수 없어요. 계정이나 연결 상태를 확인한 뒤 다시 시도해 주세요.',
  'ragConversation.failureConsentRequired':
    '이 요청에 필요한 처리 동의를 확인한 뒤 다시 시도해 주세요.',
  'ragConversation.failureCancelled':
    '답변 생성을 중지했어요. 초안을 다시 보내면 이어서 시도할 수 있어요.',
  'ragConversation.failureRetrieval':
    '저장된 기록을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.',
  'ragConversation.failureValidation':
    '답변을 확인하지 못해 표시하지 않았어요. 질문을 바꾸거나 다시 시도해 주세요.',
  'ragConversation.failureStaleEvidence':
    '기록이 변경되어 답변을 확인하지 못했어요. 다시 시도해 주세요.',
  'ragConversation.failureVisitNoAppointment':
    '진료 예약을 확인할 수 없어요. 홈에서 예약을 선택하고 다시 시작해 주세요.',
  'ragConversation.failureVisitSavedUnavailable':
    '저장된 진료 질문을 확인하지 못했어요. 다시 불러온 뒤 시도해 주세요.',
  'ragConversation.failureBudget':
    '질문을 한 번에 처리하지 못했어요. 질문을 나누어 다시 시도해 주세요.',
  'ragConversation.availability.empty':
    '앱에 저장된 범위에서 건강 기록이 확인되지 않았어요.',
  'ragConversation.availability.categories':
    '앱에 저장된 기록 종류: {categories}.',
  'ragConversation.availability.noKinds': '현재 확인된 기록 종류는 없어요.',
  'ragConversation.availability.partial':
    '일부 저장 범위만 확인했어요. 전체 범위는 확인하지 못했어요.',
  'ragConversation.availability.syncComplete':
    '마지막으로 기록된 자동 동기화 상태는 완료예요.',
  'ragConversation.availability.syncRetryable':
    '마지막으로 기록된 자동 동기화 상태는 다시 시도가 필요해요.',
  'ragConversation.availability.syncUnknown':
    '마지막 자동 동기화 상태는 확인할 수 없어요.',
  'ragConversation.availability.scope':
    '이 결과는 앱에 저장된 범위만 설명하며 Apple Health 전체 데이터나 읽기 권한을 확인한 것은 아니에요.',
  'ragConversation.availability.category.sourceRecord': '가져온 자료',
  'ragConversation.availability.category.evidenceSpan': '문서 근거',
  'ragConversation.availability.category.encounter': '진료 기록',
  'ragConversation.availability.category.healthObservation': '건강 측정',
  'ragConversation.availability.category.symptomEntry': '증상 기록',
  'ragConversation.availability.category.medicationDefinition': '복용약 정보',
  'ragConversation.availability.category.medicationAssertion': '복용 상태 기록',
  'ragConversation.availability.category.doseEvent': '복용 기록',
  'ragConversation.availability.category.appointment': '진료 예약',
  'ragConversation.availability.category.visitQuestion': '진료 질문',
  'ragConversation.availability.category.visitQuestionRecord': '진료 질문 답변',
  'ragConversation.availability.category.visitBrief': '진료 준비 요약',
  'ragConversation.availability.category.transcriptSegment': '녹음 전사',
  'ragConversation.availability.category.manualHistory':
    '수기로 작성한 건강 이력',
  'ragConversation.speakerUser': '나',
  'ragConversation.savedPartial': '일부만 생성되어 저장된 답변이에요.',
  'ragConversation.source': '원문 근거 열기 · {sourceId}',
  'ragConversation.tool.name.health': '건강 기록 확인',
  'ragConversation.tool.name.records': '개인 기록 검색',
  'ragConversation.tool.name.memory': '확인된 기억 검색',
  'ragConversation.tool.name.summaries': '저장된 요약 검색',
  'ragConversation.tool.name.conversations': '이전 대화 검색',
  'ragConversation.tool.name.research': '저장된 조사 검색',
  'ragConversation.tool.name.recordSource': '기록 원문 확인',
  'ragConversation.tool.name.memorySource': '기억 원문 확인',
  'ragConversation.tool.name.web': '웹 검색',
  'ragConversation.tool.name.literature': '의학 문헌 검색',
  'ragConversation.tool.name.unknown': '도구 활동',
  'ragConversation.tool.group': '도구 활동 {count}개',
  'ragConversation.tool.status.started': '진행 중',
  'ragConversation.tool.status.completed': '완료',
  'ragConversation.tool.status.failed': '실패',
  'ragConversation.tool.status.cancelled': '취소됨',
  'ragConversation.tool.status.interrupted': '중단됨',
  'ragConversation.tool.expandHint': '도구 호출 세부 정보 표시',
  'ragConversation.tool.collapseHint': '도구 호출 세부 정보 숨기기',
  'ragConversation.tool.input': '입력 요약',
  'ragConversation.tool.result': '결과 요약',
  'ragConversation.tool.sources': '출처',
  'ragConversation.tool.resultCount': '참고 자료 {count}개',
  'ragConversation.tool.resultUnavailable': '결과 요약을 사용할 수 없어요.',
  'ragConversation.tool.sourcesUnavailable': '연결된 출처가 없어요.',
  'ragConversation.tool.openSource': '원문 출처 확인',
  'ragConversation.tool.verifyingSource': '출처를 확인하고 있어요.',
  'ragConversation.tool.openWebSource': '웹 출처 열기 · {title}',
  'ragConversation.tool.sourceUnavailable':
    '저장된 출처를 다시 확인할 수 없어 열지 않았어요.',
  'ragConversation.tool.sourceKind.personalRecord': '개인 기록',
  'ragConversation.tool.sourceKind.reviewedMemory': '검토한 메모',
  'ragConversation.tool.sourceKind.generatedArtifact': '저장된 AI 결과',
  'ragConversation.tool.sourceKind.externalMedical': '공개 의학 문헌',
  'ragConversation.sourceKind.healthRecord': '건강 기록',
  'ragConversation.sourceKind.previousAiOutput': '이전 AI 결과',
  'ragConversation.history.today': '오늘',
  'ragConversation.history.yesterday': '어제',
  'ragConversation.history.savedOutputsTitle': '저장된 AI 결과',
  'ragConversation.history.savedAnalysis': '저장된 요약과 가능성',
  'ragConversation.history.savedAnalysisDescription':
    '저장된 요약과 가능성을 다시 살펴봐요.',
  'ragConversation.history.savedVisitQuestions': '저장된 진료 질문',
  'ragConversation.history.savedVisitQuestionsDescription':
    '저장된 진료 질문을 다시 살펴봐요.',
  'ragConversation.history.savedOutputOpenHint':
    '저장된 내용만 열어요. 새 AI 요청은 시작하지 않아요.',
  'ragConversation.history.title': '대화 기록',
  'ragConversation.history.newConversation': '새 대화',
  'ragConversation.history.count': '{count}개의 대화',
  'ragConversation.history.deleteAction': '삭제',
  'ragConversation.history.deleted': '대화를 삭제했어요.',
  'ragConversation.history.undoDelete': '실행 취소',
  'ragConversation.history.previewTitle': '대화 미리보기',
  'ragConversation.history.previewEmpty': '이 대화에는 아직 메시지가 없어요.',
  'ragConversation.history.retryRestore': '대화 다시 불러오기',
  'ragConversation.history.restoreFailed': '저장된 대화를 불러오지 못했어요.',
  'ragConversation.conversation.continuationAvailable':
    '더 이전 결과를 계속 찾아볼 수 있어요.',
  'ragConversation.conversation.continuationNoMatch':
    '아직 일치하는 결과를 찾지 못했어요. 더 이전 결과를 계속 찾아볼 수 있어요.',
  'ragConversation.conversation.historicalArtifactNotice':
    '이전에 생성된 AI 결과를 찾았어요. 아래 출처에서 생성 시각, 불확실성과 현재 출처 상태를 확인해 주세요. 독립적으로 확인된 의료 사실은 아니에요.',
  'ragConversation.conversation.healthSummary.generated':
    '건강 기록을 요약했어요.',
  'ragConversation.conversation.savedSummaryUnavailable':
    '저장된 요약을 확인할 수 없어요.',
  'ragConversation.conversation.savedVisitQuestionsUnavailable':
    '저장된 진료 질문을 다시 불러올 수 없어요. 예약과 질문 목록을 확인해 주세요.',
  'ragConversation.conversation.sourceOpenFailed':
    '출처를 열지 못했어요. 다시 시도해 주세요.',
  'ragConversation.conversation.retrySave': '답변 저장 다시 시도',
  'ragConversation.conversation.unsavedAnswersRemain':
    '저장하지 못한 답변이 남아 있어요.',
  'ragConversation.conversation.answerSaveFailed': '답변을 저장하지 못했어요.',
  'ragConversation.conversation.answerSaveSourceUnavailable':
    '원본을 확인할 수 없어 답변을 저장하지 못했어요.',
  'ragConversation.conversation.answerSaveRetry':
    '답변을 저장하지 못했어요. 다시 시도해 주세요.',
  'ragConversation.conversation.answerSaveSourceChanged':
    '원본이 변경되어 답변을 저장할 수 없어요.',
  'ragConversation.conversation.deleteFailed':
    '대화를 삭제하지 못했어요. 다시 시도해 주세요.',
  'ragConversation.conversation.restoreFailed':
    '대화를 복원하지 못했어요. 다시 시도해 주세요.',
  'ragConversation.conversation.toolActivitySaveFailed':
    '도구 실행 기록을 저장하지 못했어요.',
  'ragConversation.conversation.linkEvidenceSource':
    '원문 근거 열기 · {title}{provenance}{date}',
  'ragConversation.conversation.moreEvidence': '근거 {count}개 더 보기',
  'ragConversation.conversation.healthSummary.title': '건강 기록 요약',
  'ragConversation.conversation.healthSummary.dateRange':
    '{from} 이상 · {to} 미만 ({timeZone})',
  'ragConversation.conversation.healthSummary.prescriptionReview':
    '이 요약의 처방 여부 표현은 다시 확인이 필요해요. 약의 일정 등록만으로 처방 여부를 알 수는 없어요.',
  'ragConversation.conversation.healthSummary.sleepCountReview':
    '이 요약의 수면 횟수 표현은 다시 확인이 필요해요. 수면 단계 값은 횟수가 아니에요.',
  'ragConversation.conversation.healthSummary.sleepDurationReview':
    '이 요약의 수면 구간 길이는 원문과 맞지 않을 수 있어요. 원문의 시작·종료 시각을 확인해 주세요.',
  'ragConversation.conversation.healthSummary.stepCountReview':
    '이 요약의 걸음 수 단위는 다시 확인이 필요해요. 걸음 수를 횟수로 읽지 않도록 원문을 확인해 주세요.',
  'ragConversation.conversation.healthSummary.sourceChanged':
    '원본이 변경된 이전 요약',
  'ragConversation.conversation.healthSummary.saved': '저장됨',
  'ragConversation.conversation.healthSummary.sourceUnavailable':
    '원본을 확인하지 못해 저장하지 못했어요.',
  'ragConversation.conversation.healthSummary.saveFailed': '저장하지 못했어요.',
  'ragConversation.conversation.healthSummary.saveStatusUnknown':
    '저장 상태를 확인할 수 없어요.',
  'ragConversation.conversation.healthSummary.retrySave': '저장 다시 시도',
  'ragConversation.mixed.directComparisonUnavailable':
    '기록과 문헌의 직접적인 비교는 확인하지 못했어요.',
  'ragConversation.mixed.recordComparisonUnavailable':
    '기록과의 비교는 확인하지 못했어요.',
  'ragConversation.mixed.literatureAndComparisonUnavailable':
    '요청하신 문헌은 확인하지 못했고 기록과의 비교도 확인하지 못했어요.',
  'ragConversation.literature.requestEvidenceUnavailable':
    '문헌 질문에 대한 근거를 확인하지 못했어요.',
  'ragConversation.literature.statisticsSourceMismatch':
    '문헌의 통계와 출처가 일치하는지 확인하지 못했어요.',
  'ragConversation.literature.explanationSourceMismatch':
    '문헌의 설명과 출처가 일치하는지 확인하지 못했어요.',
  'ragConversation.literature.recordSourceText': '기록 원문: {span}',
  'ragConversation.literature.historicalRankedEvidence':
    '원문 기록 당시의 내용을 관련도가 높은 일부 기록에서 정리했어요. 전체 복용 목록이나 병력을 빠짐없이 확인한 결과는 아니에요.',
  'ragConversation.literature.historicalEvidence':
    '원문 기록 당시의 내용을 바탕으로 한 답변이에요.',
} as const;
