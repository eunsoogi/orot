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
  'dailySynthesis.same':
    '첫 기록과 마지막 기록이 모두 {value0} {value1}였어요. 중간 값까지 일정했다는 뜻은 아니에요.',
  'dailySynthesis.changed':
    '첫 기록 {value0} {value1}에서 마지막 기록 {value2} {value3}로 {value4}.',
  'dailySynthesis.notClinical':
    '오늘 {value0}은 {value1} 측정 조건과 평소 기준이 없어 건강이 좋아지거나 나빠졌다는 의미로 해석하지 않았어요.',
  'dailySynthesis.single':
    '오늘 {value0}은 {value1} {value2}로 기록되어 있어요. 비교할 다른 시점의 값이 없어 하루 동안의 변화는 알 수 없어요.',
  'dailySynthesis.collapse': '근거 기록 접기',
  'dailySynthesis.expand': '근거 기록 보기',
} as const;
