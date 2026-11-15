/** Fixed quantity presentation; source amounts, units, comparisons and sensor boundaries are unchanged. */
export const computedQuantityKo = {
  'computedQuantity.systolic': '수축기 혈압',
  'computedQuantity.diastolic': '이완기 혈압',
  'computedQuantity.heartRate': '심박수',
  'computedQuantity.weight': '체중',
  'computedQuantity.steps': '걸음 수',
  'computedQuantity.stepUnit': '걸음',
  'computedQuantity.sampleMean': '기록일별 센서 샘플 합 평균',
  'computedQuantity.recordedMean': '기록일 평균',
  'computedQuantity.overlap':
    ' 출처별 샘플은 중복될 수 있어 합산하거나 전체 일일 걸음수로 해석할 수 없어요.',
  'computedQuantity.latest': '최근 측정 {amount}{time}',
  'computedQuantity.range': '개별 측정 범위 {minimum} ~ {maximum}',
  'computedQuantity.comparisonCoverage': ' · 각 기록 {previous}일 / {recent}일',
  'computedQuantity.comparison':
    '앞선 7일 평균 {previous} → 최근 7일 평균 {recent} · 차이 {difference}{coverage}',
  'computedQuantity.calendarDays': ' / {days}일',
  'computedQuantity.coverage': '기록 {days}일{calendar}',
  'computedQuantity.samples': '측정 {count}건',
  'computedQuantity.title': '{concept} · 측정 출처 {sensor}',
} as const;
