/** Recorded-history interpretation keeps completed intake distinct from missing observations. */
export const dailyReportHistoryKo = {
  'dailyReport.history.title': '최근 복약·운동 맥락',
  'dailyReport.history.limit':
    '이전 28일의 접근 가능한 기록만 살폈어요. 기록 없는 날의 복용·활동이나 전체 이행률은 알 수 없어요.',
  'dailyReport.history.unnamed': '이 복약 항목',
  'dailyReport.history.medication':
    '{name}의 이전 28일 중 {days}일에 남은 복약 기록을 오늘 기록과 함께 살폈어요.',
  'dailyReport.history.completed':
    '그중 {days}일에는 실제 복용·투여를 완료한 기록이 있어요.',
  'dailyReport.history.missed':
    '{days}일에는 누락·건너뜀이 명시되어 있어요. 복용을 놓치게 되는 상황과 알림·일정을 살펴보고 약사·의료진과 관리 방법을 상의하세요. 과거 누락분을 지금 보충하거나 용량을 임의로 바꾸지 말고, 현재 누락이 있다면 해당 약의 설명서·처방 지침을 따르세요. (NHS SPS 복용 누락 안내)',
  'dailyReport.history.unknown':
    '미기록·상태 불명도 따로 있어 완료나 누락으로 바꾸지 않았어요.',
  'dailyReport.history.doseLimit':
    '한 날에 완료와 누락이 모두 있을 수 있고 전체 예정 회차를 확인한 것이 아니므로 복약 이행률은 계산하지 않았어요. 약효나 증상 변화의 원인도 단정하지 않아요.',
  'dailyReport.history.activity':
    '이전 28일 중 {days}일에 완료된 운동 구간 기록이 있어요.',
  'dailyReport.history.urgentFirst':
    '오늘의 주의 혈압 기록에 대한 응급·재확인 안내를 먼저 따르세요. 운동 계획으로 진료를 미루지 마세요.',
} as const;
