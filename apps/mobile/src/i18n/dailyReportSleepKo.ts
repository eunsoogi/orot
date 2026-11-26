/** Partial observed intervals are not a diagnosis, full-night total or a target. */
export const dailyReportSleepKo = {
  'dailyReport.activity.recordedWorkout': '기록된 운동: {count}회',
  'dailyReport.activity.emptyWorkout': '기록된 운동: 0회',
  'dailyReport.activity.emptySleep': '수면 기록이 없어요.',
  'dailyReport.sleep.shortInterval':
    '수면으로 기록된 구간은 중복을 합쳐 1분 미만이에요.',

  'dailyReport.sleep.duration':
    '기록된 수면 시간은 {hours}시간 {minutes}분이에요.',
  'dailyReport.sleep.conflict':
    '같은 출처의 깨어 있음과 수면 구간이 겹쳐 수면시간을 확정하지 않았어요.',
  'dailyReport.sleep.noAsleep': '잠든 구간은 기록되지 않았어요.',
  'dailyReport.sleep.unknown':
    '알 수 없는 단계나 유효하지 않은 구간은 계산에서 제외했어요.',
  'dailyReport.sleep.context':
    '{duration} 수면 출처 {source} · {date} ({zone})의 보고서 구간. {unknown}',
  'dailyReport.sleep.limitedSources':
    '수면 출처가 세 곳을 넘어 일부 출처만 표시했어요.',
} as const;
