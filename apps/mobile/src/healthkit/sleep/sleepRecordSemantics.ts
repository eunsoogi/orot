import { t } from '../../i18n';

/** Format a source-derived interval once; models need not perform minute/second arithmetic. */
function displayDuration(seconds: number) {
  const rounded = Math.round(seconds);
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const parts = [
    ...(hours ? [t('healthSemantic.hours', { hours })] : []),
    ...(minutes || hours ? [t('healthSemantic.minutes', { minutes })] : []),
    t('healthSemantic.seconds', { seconds: rounded % 60 }),
  ];
  return (
    (seconds === rounded ? '' : t('healthSemantic.approximately')) +
    parts.join(' ')
  );
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
    '0': t('healthSemantic.inBed'),
    '1': t('healthSemantic.unspecifiedSleep'),
    '2': t('healthSemantic.awake'),
    '3': t('healthSemantic.coreSleep'),
    '4': t('healthSemantic.deepSleep'),
    '5': t('healthSemantic.remSleep'),
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
