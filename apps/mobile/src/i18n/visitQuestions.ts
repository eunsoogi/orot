// App-authored visit-question UI copy; prompts and persisted memory keep separate contracts.
export const visitQuestionsKo = {
  'visitQuestions.review.title': '다음 진료에서 물어볼 내용',
  'visitQuestions.review.memory.available':
    '이전에 검토한 진료 메모를 함께 확인했어요.',
  'visitQuestions.review.memory.none': '관련된 이전 검토 메모를 찾지 못했어요.',
  'visitQuestions.review.memory.unavailable':
    '이전 검토 메모를 불러오지 못했어요. 다른 기록과 전사 자료를 확인해 주세요.',
  'visitQuestions.review.empty': '저장할 질문을 하나 이상 남겨 주세요.',
  'visitQuestions.review.actions.cancel': '취소',
  'visitQuestions.review.actions.saving': '저장 중…',
  'visitQuestions.review.actions.confirm': '검토 완료하고 저장',
  'visitQuestions.review.question.number': '질문 {number}',
  'visitQuestions.review.question.moveUp': '질문 {number} 위로 이동',
  'visitQuestions.review.question.moveDown': '질문 {number} 아래로 이동',
  'visitQuestions.review.question.remove': '질문 {number} 삭제',
  'visitQuestions.review.question.label': '질문 {number}',
  'visitQuestions.review.question.rationale': '질문 {number} 이유',
  'visitQuestions.review.question.priorityLabel': '질문 {number} 우선순위',
  'visitQuestions.review.question.moveUpAction': '위로',
  'visitQuestions.review.question.moveDownAction': '아래로',
  'visitQuestions.review.question.removeAction': '삭제',
  'visitQuestions.review.question.priority.important': '중요 질문',
  'visitQuestions.review.question.priority.routine': '일반 질문',
  'visitQuestions.review.question.priorityStatus': '{status} · 우선순위 변경',
  'visitQuestions.review.evidence.heading': '근거',
  'visitQuestions.review.evidence.source.reviewedMemory': '이전 검토 메모',
  'visitQuestions.review.evidence.source.personalRecord': '건강 기록',
  'visitQuestions.workflow.providerUnavailable':
    '선택한 AI 제공자를 사용할 수 없어요.',
  'visitQuestions.workflow.consent.accountRequired':
    '선택한 계정을 확인한 뒤 외부 AI 전송 동의를 받을 수 있어요.',
  'visitQuestions.workflow.insufficientEvidenceBudget':
    '추가로 확인할 자료를 위한 여유가 부족해요. 자료를 다시 준비해 주세요.',
  'visitQuestions.workflowResults.failure.needsClarification':
    '질문을 뒷받침할 기록이 충분하지 않거나 기록 사이에 차이가 있어요. 의료진에게 확인할 내용을 알려 주세요.',
  'visitQuestions.workflowResults.failure.staleEvidence':
    '진료 일정이나 기록이 바뀌었어요. 최신 자료로 질문을 다시 준비해 주세요.',
  'visitQuestions.workflowResults.failure.invalidOutput':
    '근거와 내용을 안전하게 확인할 수 없어 질문을 준비하지 못했어요. 다시 시도해 주세요.',
  'visitQuestions.workflowResults.failure.budgetExceeded':
    '허용된 범위 안에서 질문에 필요한 자료를 충분히 확인하지 못했어요.',
  'visitQuestions.workflowResults.failure.unavailable':
    '선택한 AI 제공자에서 질문을 준비하지 못했어요. 연결 상태를 확인하고 다시 시도해 주세요.',
  'visitQuestions.workflowResults.consentRequired':
    '선택한 외부 AI 제공자에게 예약 맥락과 근거를 보내려면 먼저 동의가 필요해요.',
  'visitQuestions.presentation.noEvidence':
    '질문 근거를 다시 확인할 수 없어 제안을 새로 준비해야 해요.',
  'visitQuestions.presentation.staleEvidence':
    '진료 일정이나 기록이 바뀌었어요. 최신 자료로 질문을 다시 준비해 주세요.',
  'visitQuestions.validation.conflictingRecords':
    '저장된 기록 사이에 차이가 있어 질문을 만들기 전에 어떤 내용이 맞는지 확인이 필요해요.',
  'visitQuestions.validation.noEvidence':
    '질문을 뒷받침할 수 있는 기록을 찾지 못했어요. 어떤 내용을 진료에서 확인하고 싶은지 알려 주세요.',
  'visitQuestions.validation.unverifiedDateOrValue':
    '질문에 기록에서 확인되지 않는 날짜나 수치가 들어 있어 근거를 다시 확인해야 해요.',
} as const;
