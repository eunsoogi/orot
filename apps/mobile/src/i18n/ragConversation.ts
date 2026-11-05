/** Korean catalog entries for the grounded local-record conversation screen. */
export const ragConversationKo = {
  'ragConversation.title': '기록과 대화',
  'ragConversation.placeholder': '기록에 관해 물어보세요',
  'ragConversation.send': '질문하기',
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
} as const;
