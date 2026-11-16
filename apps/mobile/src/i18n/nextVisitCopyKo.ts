/** Korean visit copy. Clarification entries also feed the shared prompt/validation allowlist; preserve exact pairs. */
export const nextVisitCopyKo = {
  'nextVisit.clarification.careOptions.question':
    '치료나 관리가 필요하다면 어떤 선택지가 있고 장단점은 무엇인가요?',
  'nextVisit.clarification.careOptions.rationale':
    '치료가 필요하다고 단정하지 않고 선택 기준을 의료진과 상의할 수 있어요.',
  'nextVisit.clarification.symptomReview.question':
    '증상이 생기거나 달라질 때 어떤 점을 관찰하고 언제 진료를 받아야 하나요?',
  'nextVisit.clarification.symptomReview.rationale':
    '증상이 있다고 단정하지 않고 관찰할 내용과 진료 시점을 물어볼 수 있어요.',
  'nextVisit.clarification.testingPurpose.question':
    '검사가 필요하다면 무엇을 확인하며 결과에 따라 관리 계획이 어떻게 달라지나요?',
  'nextVisit.clarification.testingPurpose.rationale':
    '검사 필요성과 이후 결정에 도움이 되는 정보를 의료진에게 물어볼 수 있어요.',
  'nextVisit.clarification.carePlan.question':
    '이번 진료 뒤 실천할 관리 방법과 다음 상담 시점은 어떻게 정하면 좋을까요?',
  'nextVisit.clarification.carePlan.rationale':
    '구체적인 관리 계획과 추후 상담 시점을 의료진과 함께 정할 수 있어요.',

  'nextVisit.clarification.preparationRecords.question':
    '이번 진료에 가져가면 도움이 될 검사 결과나 기록이 있을까요?',
  'nextVisit.clarification.preparationRecords.rationale':
    '진료에 필요한 자료를 의료진에게 확인할 수 있어요.',
  'nextVisit.clarification.unconfirmedResults.question':
    '확인되지 않은 검사 결과는 어떻게 확인하면 좋을까요?',
  'nextVisit.clarification.unconfirmedResults.rationale':
    '확인할 결과와 확인 방법을 의료진에게 물어볼 수 있어요.',
  'nextVisit.clarification.conflictingRecords.question':
    '기록에 서로 다른 내용이 있다면 어느 자료로 확인하면 좋을까요?',
  'nextVisit.clarification.conflictingRecords.rationale':
    '서로 다른 기록을 확인할 방법을 의료진과 상의할 수 있어요.',
  'nextVisit.clarification.medicationInformation.question':
    '복용하는 약이 있다면 어떤 정보를 준비하면 좋을까요?',
  'nextVisit.clarification.medicationInformation.rationale':
    '약에 관해 필요한 정보를 의료진에게 확인할 수 있어요.',
  'nextVisit.clarification.symptomTiming.question':
    '증상이 있을 때 어떤 내용과 시점을 기록하면 좋을까요?',
  'nextVisit.clarification.symptomTiming.rationale':
    '증상에 관해 준비할 정보를 의료진에게 물어볼 수 있어요.',
  'nextVisit.clarification.visitPreparation.question':
    '진료 전 확인하거나 준비할 내용이 더 있을까요?',
  'nextVisit.clarification.visitPreparation.rationale':
    '진료 준비에 필요한 내용을 의료진에게 확인할 수 있어요.',
  'nextVisit.clarification.followUp.question':
    '진료 이후 어떤 변화가 있으면 다시 상담해야 할까요?',
  'nextVisit.clarification.followUp.rationale':
    '이후 상담이 필요한 상황을 의료진에게 물어볼 수 있어요.',
  'nextVisit.clarification.additionalTesting.question':
    '추가 검사나 확인이 필요한지는 어떻게 결정하나요?',
  'nextVisit.clarification.additionalTesting.rationale':
    '추가 확인을 결정하는 기준을 의료진에게 물어볼 수 있어요.',
  'nextVisit.title': '다음 진료 질문',
  'nextVisit.introduction': '진료 전에 궁금한 점을 정리해요.',
  'nextVisit.clinicalNotice':
    '이 질문은 진단이 아니며, 의학적 판단을 대신하지 않아요. 정확한 답변은 의료진과 상담하세요.',
  'nextVisit.appointment.heading': '다음 확정 예약',
  'nextVisit.appointment.none': '다가오는 확정 캘린더 예약을 찾지 못했어요.',
  'nextVisit.appointment.noneHelp':
    '예약 상태와 캘린더 연결을 확인한 뒤 다시 불러와 주세요.',
  'nextVisit.appointment.loading': '다음 예약을 확인하고 있어요.',
  'nextVisit.appointment.error': '다음 예약을 불러오지 못했어요.',
  'nextVisit.appointment.retry': '예약 다시 확인',
  'nextVisit.appointment.timeUnavailable': '예약 시간을 표시할 수 없어요.',
  'nextVisit.appointment.fallbackTitle': '캘린더 예약',
  'nextVisit.appointment.deviceTimeZone': '기기 시간대 기준',
  'nextVisit.appointment.invalidCalendarTimeZone':
    '캘린더 시간대를 해석하지 못해 기기 시간대로 표시해요.',
  'nextVisit.provider.heading': '질문을 만들 AI',
  'nextVisit.provider.loading': '저장된 AI 선택을 확인하고 있어요.',
  'nextVisit.provider.unselected': 'AI를 선택해 주세요.',
  'nextVisit.provider.choose': 'AI 선택 또는 변경',
  'nextVisit.provider.unavailable': '선택한 AI를 지금 사용할 수 없어요.',
  'nextVisit.provider.error': '저장된 AI 선택을 확인하지 못했어요.',
  'nextVisit.provider.retry': 'AI 상태 다시 확인',
  'nextVisit.provider.onDevice': '질문 생성은 기기 안에서 처리돼요.',
  'nextVisit.provider.remote':
    '선택한 자료가 선택한 외부 제공자에게 전달될 수 있어요.',
  'nextVisit.generation.action': '질문 만들기',
  'nextVisit.generation.loading':
    '현재 자료를 확인하고 질문 후보를 만들고 있어요.',
  'nextVisit.generation.cancel': '생성 취소',
  'nextVisit.generation.retry': '다시 시도',
  'nextVisit.generation.genericError':
    '질문을 만들지 못했어요. 자료와 AI 상태를 확인해 주세요.',
  'nextVisit.generation.invalidResult':
    '질문 후보를 확인할 수 없어 표시하지 않았어요. 다시 시도해 주세요.',
  'nextVisit.generation.needsClarification':
    '현재 자료만으로는 질문을 준비하기 어려워요.',
  'nextVisit.generation.clarificationNextStep':
    '원하면 이번 진료에서 궁금한 점이나 상의할 목표를 더 구체적으로 알려 주세요.',
  'nextVisit.generation.refreshRequired':
    '자료가 바뀌었어요. 최신 내용을 확인한 뒤 다시 시도해 주세요.',
  'nextVisit.generation.providerUnavailable':
    '선택한 AI를 사용할 수 없어요. 다른 AI를 직접 선택해 주세요.',
  'nextVisit.generation.consentRequired':
    '외부 제공자에게 자료를 보내려면 먼저 동의가 필요해요.',
  'nextVisit.generation.unavailable': '질문 추천을 사용할 수 없어요.',
  'nextVisit.generation.cancelled': '질문 생성을 취소했어요.',
  'nextVisit.generation.providerChanged':
    '선택한 AI가 바뀌어 질문 생성을 멈췄어요. 새 선택으로 다시 시도해 주세요.',
  'nextVisit.review.heading': '질문 편집',
  'nextVisit.review.saveHint': '수정한 질문을 이 진료에 저장해요.',
  'nextVisit.review.helper':
    '질문과 근거를 확인하고, 필요하면 수정한 뒤 저장해 주세요.',
  'nextVisit.review.questionLabel': '질문 {number}',
  'nextVisit.review.rationaleLabel': '질문 {number}의 이유',
  'nextVisit.review.remove': '질문 {number} 삭제',
  'nextVisit.review.moveUp': '질문 {number} 위로 이동',
  'nextVisit.review.moveDown': '질문 {number} 아래로 이동',
  'nextVisit.review.markImportant': '중요 질문으로 표시',
  'nextVisit.review.markRoutine': '일반 질문으로 표시',
  'nextVisit.review.routine': '일반',
  'nextVisit.review.important': '중요',
  'nextVisit.review.empty': '저장할 질문을 한 개 이상 남겨 주세요.',
  'nextVisit.review.cancel': '검토 취소',
  'nextVisit.review.save': '변경 저장',
  'nextVisit.review.saving': '저장 중…',
  'nextVisit.review.saveError':
    '질문을 저장하지 못했어요. 수정 내용은 남아 있어요.',
  'nextVisit.review.saved': '검토한 질문을 이 예약에 저장했어요.',
  'nextVisit.review.memoryRetry':
    '질문은 저장했지만 이전 검토 기록을 갱신하지 못했어요.',
  'nextVisit.review.count': '{count}개 질문',
  'nextVisit.saved.heading': '저장된 질문',
  'nextVisit.saved.introduction': '진료 때 물어볼 내용을 모아뒀어요.',
  'nextVisit.saved.status': '저장됨',
  'nextVisit.saved.loading': '저장된 질문을 불러오고 있어요.',
  'nextVisit.saved.error': '저장된 질문을 불러오지 못했어요.',
  'nextVisit.saved.empty': '아직 검토해 저장한 질문이 없어요.',
  'nextVisit.saved.retry': '저장된 질문 다시 불러오기',
  'nextVisit.saved.edit': '질문 편집',
  'nextVisit.saved.generateAgain': '새 질문 추천 받기',
  'nextVisit.evidence.open': '근거 보기',
  'nextVisit.evidence.heading': '질문 근거',
  'nextVisit.evidence.close': '닫기',
  'nextVisit.evidence.personalRecord': '내 건강 기록',
  'nextVisit.evidence.reviewedMemory': '이전에 검토한 기록',
  'nextVisit.evidence.externalMedical': '외부 의학 자료',
  'nextVisit.evidence.reviewed': '검토된 자료',
  'nextVisit.evidence.unreviewed': '아직 검토되지 않은 자료',
  'nextVisit.evidence.unknown': '검토 상태를 확인할 수 없는 자료',
  'nextVisit.evidence.noDate': '날짜 정보 없음',
  'nextVisit.caveat.incomplete_coverage':
    '일부 자료를 확인하지 못해 놓친 정보가 있을 수 있어요.',
  'nextVisit.caveat.truncated_results':
    '확인 가능한 자료가 많아 일부 결과가 생략됐을 수 있어요.',
  'nextVisit.caveat.conflicting_records':
    '기록에 서로 다른 내용이 있어 질문을 저장하기 전에 확인해 주세요.',
  'nextVisit.caveat.insufficient_evidence':
    '현재 확인된 근거가 부족해 질문을 만들지 않았어요.',
  'nextVisit.caveat.reviewed_memory_unavailable':
    '이전 검토 기록을 확인하지 못했어요.',
  'nextVisit.caveat.no_matching_reviewed_memory':
    '관련된 이전 검토 기록을 찾지 못했어요.',
  'nextVisit.caveat.public_search_not_retained':
    '공개 웹검색은 실행됐지만, 검색 결과는 이 질문에 반영하거나 저장하지 않았어요.',
  'nextVisit.caveat.public_search_consent_required':
    '공개 웹검색 동의가 없어 검색 결과를 반영하지 않았어요.',
  'nextVisit.caveat.public_search_empty':
    '공개 웹검색에서 결과를 찾지 못했어요.',
  'nextVisit.caveat.public_search_unavailable':
    '공개 웹검색을 사용할 수 없어 검색 결과를 반영하지 않았어요.',
  'nextVisit.recipient.onDevice': '기기 안의 Apple Intelligence',
  'nextVisit.recipient.chatgpt': '선택한 ChatGPT 계정',
  'nextVisit.selection.required': 'AI를 선택해야 기능을 사용할 수 있어요.',
  'nextVisit.selection.unavailable':
    '선택한 AI를 사용할 수 없어요. 제공자와 모델을 다시 확인해 주세요.',
  'nextVisit.save.sourceChanged':
    '예약이나 원문 근거가 바뀌어 저장하지 못했어요. 최신 내용을 확인해 주세요.',
} as const;
