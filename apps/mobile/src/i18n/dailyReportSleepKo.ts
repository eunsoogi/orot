/** Partial observed intervals are not a diagnosis, full-night total or a target. */
export const dailyReportSleepKo = {
  'dailyReport.sleep.shortInterval':
    '수면으로 기록된 구간은 중복을 합쳐 1분 미만이에요.',

  'dailyReport.sleep.duration':
    '수면으로 기록된 구간은 중복을 합쳐 약 {hours}시간 {minutes}분이에요.',
  'dailyReport.sleep.conflict':
    '같은 출처의 깨어 있음과 수면 구간이 겹쳐 수면시간을 확정하지 않았어요.',
  'dailyReport.sleep.noAsleep':
    '수면 상태로 확인된 구간이 없어 수면시간을 계산하지 않았어요. 잠을 자지 않았다는 뜻은 아니에요.',
  'dailyReport.sleep.unknown':
    '알 수 없는 단계나 유효하지 않은 구간은 계산에서 제외했어요.',
  'dailyReport.sleep.context':
    '수면 출처 {source}, {date} ({zone})의 보고서에 포함된 구간: {duration} {unknown} 침대에 있던 시간·깨어 있던 시간은 수면으로 더하지 않았고 다른 출처와 합산하지 않았어요. 날짜 경계와 조회 한도로 밤 전체가 아닐 수 있어 충분한 수면·수면의 질이나 질환 여부를 판단할 수 없어요.',
  'dailyReport.sleep.limitedSources':
    '수면 출처는 최대 세 그룹만 요약했어요. 나머지 기록이 빠질 수 있으며 표시된 시간을 모든 출처의 총 수면시간으로 보지 않았어요.',
} as const;
