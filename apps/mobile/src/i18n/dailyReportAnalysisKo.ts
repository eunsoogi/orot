/** Section titles describe evidence roles, never an overall normal/abnormal verdict. */
export const dailyReportAnalysisKo = {
  'dailyReport.analysis.ongoingCoverage':
    '증상 자료에는 이전에 시작되어 지속 중으로 기록된 항목도 포함돼요. 오늘 새로 발생한 증상 수나 현재 상태 확인을 뜻하지 않아요.',

  'dailyReport.analysis.activeSymptoms':
    '확인한 기록에는 {symptoms} 증상이 지속 중 상태로 남아 있어요. 이전에 시작된 기록도 포함하며 오늘 새로 발생했다는 뜻은 아니에요.',

  'dailyReport.analysis.sampling':
    '자료 종류별 용량 한도 안에서 최근 기록과 지표·출처별 표본을 골랐고, 매우 높은 혈압은 먼저 포함했어요. 빠진 기록이 있으며 하루 전체의 분포나 정상 여부를 뜻하지 않아요.',

  'dailyReport.analysis.model': '기록을 종합한 AI 해석과 실천 안내',
  'dailyReport.analysis.generated': 'AI 해석: {text}',
  'dailyReport.analysis.modelCaution':
    '아래 해석은 AI가 연결한 내용으로, 인용이 있어도 의학적 정확성이 보장되는 것은 아니에요. 진단이나 약 변경의 근거로 삼지 말고 위의 안전 안내와 원본 기록을 함께 확인해 주세요.',

  'dailyReport.analysis.scope':
    '이 보고서는 오늘 확인한 기록을 해석하고, 비교 가능한 과거 기록이 있을 때 함께 살펴봐요. 먼저 확인할 내용과 실천 안내부터 읽어 주세요. 빠진 기록과 개인 상황이 있어 건강 전체의 정상 여부나 진단을 확정하는 보고서는 아니에요.',
  'dailyReport.analysis.priority': '먼저 확인할 건강 신호와 실천',
  'dailyReport.analysis.actions': '복약과 진료에서 챙길 일',
  'dailyReport.analysis.history': '평소 기록과 함께 본 변화',
  'dailyReport.analysis.patterns': '오늘 기록의 흐름과 해석 한계',
  'dailyReport.analysis.limits': '이 보고서로 판단할 수 없는 부분',
  'dailyReport.analysis.plans': '캘린더에서 참고할 계획',
} as const;
