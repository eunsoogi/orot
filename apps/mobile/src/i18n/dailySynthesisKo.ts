/** Verbatim daily-report display copy; source selection, comparisons and clinical uncertainty remain unchanged. */
export const dailySynthesisKo = {
  'dailySynthesis.currentUnknown':
    '기록 이후의 현재 상태나 원인은 이 보고서만으로 확인할 수 없어요.',
  'dailySynthesis.steps': '걸음',
  'dailySynthesis.perMinute': '회/분',
  'dailySynthesis.increased': '높아졌어요',
  'dailySynthesis.decreased': '낮아졌어요',
  'dailySynthesis.insufficient':
    '오늘 남긴 기록만으로는 몸 상태나 하루 동안의 변화를 판단하기 어려워요. 아래 기록을 참고하되, 기록이 없는 것을 증상이나 문제가 없다는 뜻으로 보지 않았어요.',
  'dailySynthesis.resolved': '{value0} 증상은 해소된 것으로 기록되어 있어요.',
  'dailySynthesis.conflicting':
    '{value0} 기록에 같은 시각의 서로 다른 값 또는 단위가 있어 오늘의 변화 방향을 판단하지 않았어요. 원본 기록을 함께 확인해 주세요.',
  'dailySynthesis.interval':
    '오늘 {value0} 기록은 구간 또는 누적 측정일 수 있어 첫 값과 마지막 값을 비교해 증가·감소로 해석하지 않았어요. 측정 구간과 원본 값을 아래 기록에서 함께 확인해 주세요.',
  'dailySynthesis.same': '첫 기록과 마지막 기록은 같았어요: {value0} {value1}.',
  'dailySynthesis.changed':
    '첫 기록은 {value0} {value1}, 마지막 기록은 {value2} {value3}. 두 기록을 비교하면 {value4}.',
  'dailySynthesis.notClinical': '오늘 {value0} 기록을 비교했어요. {value1}',
  'dailySynthesis.single': '오늘 기록된 {value0}: {value1} {value2}.',
  'dailySynthesis.collapse': '근거 기록 접기',
  'dailySynthesis.expand': '근거 기록 보기',
} as const;
