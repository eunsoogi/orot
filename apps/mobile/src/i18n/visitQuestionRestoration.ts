/** Messages for restoring reviewed visit questions and their historical sources. */
export const visitQuestionRestorationKo = {
  'visitQuestions.search.failed':
    '공개 웹검색을 완료하지 못해 검색 결과를 반영하지 않았어요. 다시 시도할 수 있어요.',
  'visitQuestions.search.notConfigured':
    '현재 선택한 AI 설정에서는 공개 웹검색을 연결할 수 없어 검색 결과를 반영하지 않았어요.',
  'visitQuestions.search.unsupported':
    '선택한 AI는 공개 웹검색을 지원하지 않아 검색 결과를 반영하지 않았어요.',
  'visitQuestions.restore.missingSource':
    '질문에 연결된 원문 근거를 찾을 수 없어 저장 목록을 불러오지 못했어요.',
  'visitQuestions.restore.changedGeneratedSource':
    '이전 AI 결과가 바뀌었거나 삭제되어 저장된 질문을 불러오지 못했어요. 다시 생성해 주세요.',
  'visitQuestions.restore.changedList':
    '저장된 질문 목록이 바뀌었어요. 다시 불러와 주세요.',
  'visitQuestions.restore.readerUnavailable':
    '건강 기록을 확인할 수 없어 저장된 질문을 불러오지 못했어요. 다시 시도해 주세요.',
  'visitQuestions.restore.changedHealthContext':
    '건강 기록이 바뀌었거나 근거를 확인할 수 없어 저장된 질문을 불러오지 못했어요. 다시 생성해 주세요.',
  'visitQuestions.restore.staleTranscript':
    '녹취 내용이 수정되어 저장된 질문의 원문 근거를 불러오지 못했어요.',
  'visitQuestions.restore.invalidQuestion':
    '저장된 질문의 정보가 올바르지 않아 불러오지 못했어요.',
  'visitQuestions.restore.retry':
    '저장된 질문을 불러오지 못했어요. 다시 시도해 주세요.',
  'visitQuestions.restore.historicalSourceChanged':
    '생성 당시의 건강 근거가 바뀌었어요. 최신 기록으로 질문을 다시 생성해 주세요.',
  'visitQuestions.generation.unavailable':
    '질문을 준비하지 못했어요. 잠시 후 다시 시도해 주세요.',
} as const;
