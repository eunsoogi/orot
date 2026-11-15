/** Verbatim aggregation-scope cautions; no clinical interpretation or limitation-code mapping changes. */
export const computedLimitsKo = {
  'computedLimits.measurementLimit':
    '집계할 수 있는 측정 출처 수를 넘어 일부 출처가 제외됐어요. 이 요약은 전체 측정 기록을 포함하지 않아요.',
  'computedLimits.medicationLimit':
    '집계할 수 있는 복용약 목록 수를 넘어 일부 약이 제외됐어요. 이 요약은 전체 복용약 목록을 포함하지 않아요.',
  'computedLimits.unsupportedSleep':
    '해석할 수 없는 수면 분류는 시간 계산에서 제외됐어요. 수면 집계가 일부 기록을 포함하지 않을 수 있어요.',
  'computedLimits.unrecordedUnknown':
    '기록하지 않은 날짜의 값은 알 수 없으며, 0으로 해석하지 않아요.',
  'computedLimits.registrationNotDose':
    '약의 등록이나 현재 복용 확인은 개별 복약 완료 기록과 구분해요.',
  'computedLimits.overlappingSteps':
    '센서별 걸음 샘플은 중복될 수 있어 출처끼리 더하거나 전체 일일 걸음수로 해석할 수 없어요.',
  'computedLimits.doseUnknown':
    '개별 복약 기록이 없는 날짜의 완료 여부는 알 수 없으며, 미복용으로 해석하지 않아요.',
  'computedLimits.unknownScope':
    '이 집계에는 추가적인 범위 제한이 있어요. 근거에서 원본의 집계 범위를 확인해 주세요.',
} as const;
