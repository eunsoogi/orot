/** Keeps retry guidance distinct for each daily-report failure boundary. */
export const dailyReportFailuresKo = {
  'dailyReport.failure.sourceRead':
    '이 날짜의 기록을 읽지 못했어요. 기록을 확인한 뒤 다시 요약해 주세요.',
  'dailyReport.failure.sourceUnavailable':
    '이 날짜에서 보고서에 사용할 기록을 찾지 못했어요. 기록 상태를 확인한 뒤 다시 요약해 주세요.',
  'dailyReport.failure.dayChanged':
    '오늘 날짜가 바뀌어 보고서를 시작하지 못했어요. 오늘을 선택하고 다시 요약해 주세요.',
  'dailyReport.failure.provider':
    '선택한 AI 요청을 완료하지 못했어요. 제공자와 모델을 확인한 뒤 다시 요약해 주세요.',
  'dailyReport.failure.consent':
    '선택한 외부 AI 요청이 승인되지 않았어요. 요청을 확인하고 동의한 뒤 다시 요약해 주세요.',
  'dailyReport.failure.validation':
    'AI 응답을 확인할 수 없어 저장하지 않았어요. 선택한 모델을 확인한 뒤 다시 요약해 주세요.',
  'dailyReport.failure.persistence':
    '이번 보고서를 저장하지 못했어요. 다시 요약하면 새로 만들어 저장해요.',
  'dailyReport.failure.persistencePrevious':
    '이번 보고서를 저장하지 못했어요. 이전에 저장한 보고서는 유지돼요. 다시 요약하면 새로 만들어 저장해요.',
};
