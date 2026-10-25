/** Format a source-derived interval once; models need not perform minute/second arithmetic. */
function displayDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const parts = [
    ...(hours ? [`${hours}시간`] : []),
    ...(minutes || hours ? [`${minutes}분`] : []),
    `${rounded % 60}초`,
  ];
  return (seconds === rounded ? '' : '약 ') + parts.join(' ');
}

/** HealthKit sleep values are categorical stages, never hours or a nightly total. */
export function sleepRecordSemantics(record: Record<string, unknown>) {
  const provenance = record.provenance as
    { source?: { system?: string } } | undefined;
  const value = record.value as { kind?: string; text?: string } | undefined;
  if (
    record.concept !== 'HKCategoryTypeIdentifierSleepAnalysis' ||
    provenance?.source?.system !== 'healthkit' ||
    value?.kind !== 'text'
  )
    return undefined;
  // Values follow the installed SDK's HKCategoryValueSleepAnalysis, including legacy unspecified sleep.
  const stages: Record<string, string> = {
    '0': '침대에 있음',
    '1': '수면(단계 미지정)',
    '2': '깨어 있음',
    '3': '코어 수면',
    '4': '깊은 수면',
    '5': '렘 수면',
  };
  const sleepStage = value.text === undefined ? undefined : stages[value.text];
  if (!sleepStage) return undefined;
  const start =
    typeof record.effectiveAt === 'string'
      ? Date.parse(record.effectiveAt)
      : NaN;
  const end =
    typeof record.endedAt === 'string' ? Date.parse(record.endedAt) : NaN;
  return {
    sleepStage,
    intervalScope: 'single_sample_not_nightly_total',
    ...(Number.isFinite(start) && Number.isFinite(end) && end > start
      ? {
          intervalDurationSeconds: (end - start) / 1000,
          intervalDurationDisplay: displayDuration((end - start) / 1000),
        }
      : {}),
  };
}
