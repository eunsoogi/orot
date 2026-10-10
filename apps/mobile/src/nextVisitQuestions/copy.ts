import type { EvidenceCaveat } from './types';

// This screen keeps its Korean copy local because the shared catalog is owned by another task.
export const nextVisitQuestionsCopy = {
  title: '다음 진료 질문',
  introduction: '진료 전에 궁금한 점을 정리해요.',
  clinicalNotice:
    '이 질문은 진단이 아니며, 의학적 판단을 대신하지 않아요. 정확한 답변은 의료진과 상담하세요.',
  appointment: {
    heading: '다음 확정 예약',
    none: '다가오는 확정 캘린더 예약을 찾지 못했어요.',
    noneHelp: '예약 상태와 캘린더 연결을 확인한 뒤 다시 불러와 주세요.',
    loading: '다음 예약을 확인하고 있어요.',
    error: '다음 예약을 불러오지 못했어요.',
    retry: '예약 다시 확인',
    timeUnavailable: '예약 시간을 표시할 수 없어요.',
    fallbackTitle: '캘린더 예약',
    deviceTimeZone: '기기 시간대 기준',
    invalidCalendarTimeZone:
      '캘린더 시간대를 해석하지 못해 기기 시간대로 표시해요.',
  },
  provider: {
    heading: '질문을 만들 AI',
    loading: '저장된 AI 선택을 확인하고 있어요.',
    unselected: 'AI를 선택해 주세요.',
    choose: 'AI 선택 또는 변경',
    unavailable: '선택한 AI를 지금 사용할 수 없어요.',
    error: '저장된 AI 선택을 확인하지 못했어요.',
    retry: 'AI 상태 다시 확인',
    onDevice: '질문 생성은 기기 안에서 처리돼요.',
    remote: '선택한 자료가 선택한 외부 제공자에게 전달될 수 있어요.',
  },
  generation: {
    action: '질문 만들기',
    loading: '현재 자료를 확인하고 질문 후보를 만들고 있어요.',
    cancel: '생성 취소',
    retry: '다시 시도',
    genericError: '질문을 만들지 못했어요. 자료와 AI 상태를 확인해 주세요.',
    invalidResult:
      '질문 후보를 확인할 수 없어 표시하지 않았어요. 다시 시도해 주세요.',
    needsClarification: '현재 자료만으로는 질문을 준비하기 어려워요.',
    refreshRequired:
      '자료가 바뀌었어요. 최신 내용을 확인한 뒤 다시 시도해 주세요.',
    providerUnavailable:
      '선택한 AI를 사용할 수 없어요. 다른 AI를 직접 선택해 주세요.',
    consentRequired: '외부 제공자에게 자료를 보내려면 먼저 동의가 필요해요.',
    unavailable: '질문 추천을 사용할 수 없어요.',
    cancelled: '질문 생성을 취소했어요.',
    providerChanged:
      '선택한 AI가 바뀌어 질문 생성을 멈췄어요. 새 선택으로 다시 시도해 주세요.',
  },
  review: {
    heading: '질문 편집',
    saveHint: '수정한 질문을 이 진료에 저장해요.',
    helper: '질문과 근거를 확인하고, 필요하면 수정한 뒤 저장해 주세요.',
    questionLabel: (number: number) => `질문 ${number}`,
    rationaleLabel: (number: number) => `질문 ${number}의 이유`,
    remove: (number: number) => `질문 ${number} 삭제`,
    moveUp: (number: number) => `질문 ${number} 위로 이동`,
    moveDown: (number: number) => `질문 ${number} 아래로 이동`,
    markImportant: '중요 질문으로 표시',
    markRoutine: '일반 질문으로 표시',
    routine: '일반',
    important: '중요',
    empty: '저장할 질문을 한 개 이상 남겨 주세요.',
    cancel: '검토 취소',
    save: '변경 저장',
    saving: '저장 중…',
    saveError: '질문을 저장하지 못했어요. 수정 내용은 남아 있어요.',
    saved: '검토한 질문을 이 예약에 저장했어요.',
    memoryRetry: '질문은 저장했지만 이전 검토 기록을 갱신하지 못했어요.',
    count: (count: number) => `${count}개 질문`,
  },
  saved: {
    heading: '저장된 질문',
    introduction: '진료 때 물어볼 내용을 모아뒀어요.',
    status: '저장됨',
    loading: '저장된 질문을 불러오고 있어요.',
    error: '저장된 질문을 불러오지 못했어요.',
    empty: '아직 검토해 저장한 질문이 없어요.',
    retry: '저장된 질문 다시 불러오기',
    edit: '질문 편집',
    generateAgain: '새 질문 추천 받기',
  },
  evidence: {
    open: '근거 보기',
    heading: '질문 근거',
    close: '닫기',
    personalRecord: '내 건강 기록',
    reviewedMemory: '이전에 검토한 기록',
    externalMedical: '외부 의학 자료',
    reviewed: '검토된 자료',
    unreviewed: '아직 검토되지 않은 자료',
    unknown: '검토 상태를 확인할 수 없는 자료',
    noDate: '날짜 정보 없음',
  },
} as const;

export const evidenceCaveatCopy: Readonly<Record<EvidenceCaveat, string>> = {
  incomplete_coverage: '일부 자료를 확인하지 못해 놓친 정보가 있을 수 있어요.',
  truncated_results: '확인 가능한 자료가 많아 일부 결과가 생략됐을 수 있어요.',
  conflicting_records:
    '기록에 서로 다른 내용이 있어 질문을 저장하기 전에 확인해 주세요.',
  insufficient_evidence: '현재 확인된 근거가 부족해 질문을 만들지 않았어요.',
  reviewed_memory_unavailable: '이전 검토 기록을 확인하지 못했어요.',
  no_matching_reviewed_memory: '관련된 이전 검토 기록을 찾지 못했어요.',
};
