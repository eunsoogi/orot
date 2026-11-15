import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import { projectHealthContext } from '../../healthEvidence/healthContext/projection';
import type { HealthContextScope } from '../../healthEvidence/healthContext/scope';
import { t } from '../../i18n';
import type { EvidenceSourceDetailSection } from './evidenceSourcePresentation';
import type { EvidenceSourceDocument } from './evidenceSourceDocument';

/** Keep the privacy label with the restored period source. */
export function presentHealthContextDocument(
  document: Extract<
    EvidenceSourceDocument,
    { sourceKind: 'health_context_period' }
  >,
) {
  return presentHealthContext(
    document.scope,
    document.report,
    document.filterRedacted,
  );
}

const labels: Readonly<Record<string, string>> = {
  'blood pressure systolic': t('healthContextCopy.systolic'),
  'blood pressure diastolic': t('healthContextCopy.diastolic'),
  heart_rate: t('healthContextCopy.heartRate'),
  body_mass: t('healthContextCopy.bodyMass'),
  step_count: t('healthContextCopy.steps'),
  workout_duration: t('healthContextCopy.workoutDuration'),
};
const stages: Readonly<Record<string, string>> = {
  asleepCore: t('healthContextCopy.sleepCore'),
  asleepDeep: t('healthContextCopy.sleepDeep'),
  asleepREM: t('healthContextCopy.sleepREM'),
  asleepUnspecified: t('healthContextCopy.sleepUnspecified'),
  awake: t('healthContextCopy.awake'),
  inBed: t('healthContextCopy.inBed'),
  unsupported: t('healthContextCopy.unsupportedStage'),
};

/** Show calculated facts and their calendar scope directly; there is no model-written replacement for the original data. */
export function presentHealthContext(
  scope: HealthContextScope,
  report: HealthContextReport,
  filterRedacted = false,
): readonly EvidenceSourceDetailSection[] {
  const projected = projectHealthContext(report);
  const result: EvidenceSourceDetailSection[] = [
    {
      title: t('healthContextCopy.aggregatePeriod'),
      rows: [
        {
          label: t('healthContextCopy.period'),
          value: `${report.days[0]?.date} ~ ${report.days.at(-1)?.date}`,
        },
        {
          label: t('healthContextCopy.timeZone'),
          value: scope.window.timeZone,
        },
        ...(filterRedacted
          ? [
              {
                label: t('aiFeatures.healthContext.searchFilter'),
                value: t('aiFeatures.healthContext.searchFilterRedacted'),
              },
            ]
          : []),
        ...(projected.partialDates.length
          ? [
              {
                label: t('healthContextCopy.partialDay'),
                value: projected.partialDates.join(', '),
              },
            ]
          : []),
      ],
    },
  ];
  for (const [index, series] of projected.quantities.entries()) {
    const step =
      series.concept === 'step_count' || series.concept === 'workout_duration';
    const mean = step
      ? series.meanRecordedDailySampleSum
      : series.meanOfRecordedDailyMeans;
    result.push({
      title: `${labels[series.concept] ?? series.concept} · 측정 출처 ${index + 1}`,
      rows: [
        {
          label: t('healthContextCopy.recordedDays'),
          value: `${series.recordedDays}일 / ${projected.calendarDays}일`,
        },
        {
          label: t('healthContextCopy.sampleCount'),
          value: `${series.sampleCount}건`,
        },
        {
          label: step
            ? t('healthContextCopy.meanDailySampleSum')
            : t('healthContextCopy.meanDailyMeans'),
          value: `${mean} ${series.unit}`,
        },
        {
          label: t('healthContextCopy.sampleRange'),
          value: `${series.minimumSample} ~ ${series.maximumSample} ${series.unit}`,
        },
        ...(series.latest
          ? [
              {
                label: t('healthContextCopy.latestMeasurement'),
                value: `${series.latest.amount} ${series.unit} · ${new Date(series.latest.occurredAt).toLocaleString('ko-KR', { timeZone: scope.window.timeZone })}`,
              },
            ]
          : []),
        ...(series.comparison.difference !== null
          ? [
              {
                label: t('healthContextCopy.comparisonWeek'),
                value: `${series.comparison.difference > 0 ? '+' : ''}${series.comparison.difference} ${series.unit} · 기록 ${series.comparison.previousRecordedDays}일 / ${series.comparison.recentRecordedDays}일`,
              },
            ]
          : []),
        ...(step
          ? [
              {
                label: t('healthContextCopy.aggregationBasis'),
                value: t('healthContextCopy.sampleSumNotice'),
              },
            ]
          : []),
      ],
    });
  }
  for (const medication of report.doseHistory ? [] : report.medications)
    result.push({
      title: medication.name,
      rows: [
        {
          label: t('healthContextCopy.informationKind'),
          value:
            medication.source === 'healthkit_registration'
              ? t('healthContextCopy.registeredMedication')
              : medication.source === 'current_user_confirmation'
                ? t('healthContextCopy.confirmedMedication')
                : t('healthContextCopy.prescription'),
        },
        ...(medication.dosageInstruction
          ? [
              {
                label: t('healthContextCopy.dosageInstruction'),
                value: medication.dosageInstruction,
              },
            ]
          : []),
        {
          label: t('healthContextCopy.doseRecords'),
          value: `복용 ${medication.taken}건 · 건너뜀 ${medication.skipped}건 · 기타 ${medication.otherDoseRecords}건`,
        },
        {
          label: t('healthContextCopy.daysWithDoseRecords'),
          value: `${medication.daysWithDoseRecords}일`,
        },
        {
          label: t('healthContextCopy.interpretation'),
          value: t('healthContextCopy.missingDoseNotice'),
        },
      ],
    });
  for (const dose of report.doseHistory?.records ?? [])
    result.push({
      title: dose.medicationName ?? t('healthContextCopy.unknownMedication'),
      rows: [
        {
          label: t('healthContextCopy.recordedAt'),
          value: new Date(dose.effectiveAt).toLocaleString('ko-KR', {
            timeZone: scope.window.timeZone,
          }),
        },
        ...(dose.scheduledAt
          ? [
              {
                label: t('healthContextCopy.scheduledAt'),
                value: new Date(dose.scheduledAt).toLocaleString('ko-KR', {
                  timeZone: scope.window.timeZone,
                }),
              },
            ]
          : []),
        {
          label: t('healthContextCopy.status'),
          value: dose.observationStatus ?? dose.eventKind,
        },
        ...(dose.dose
          ? [
              {
                label: t('healthContextCopy.recordedAmount'),
                value: `${dose.dose.amount ?? ''} ${dose.dose.unit}`.trim(),
              },
            ]
          : []),
      ],
    });
  if (scope.topic === 'sleep')
    result.push({
      title: t('healthContextCopy.sleepRecords'),
      rows: [
        {
          label: t('healthContextCopy.recordedDays'),
          value: `${projected.sleep.recordedDays}일 / ${projected.calendarDays}일`,
        },
        {
          label: t('healthContextCopy.meanSleepMinutes'),
          value:
            projected.sleep.meanRecordedDailyMinutes === null
              ? t('healthContextCopy.noCalculation')
              : `${projected.sleep.meanRecordedDailyMinutes}분`,
        },
        ...Object.entries(projected.sleep.stageMinutes).map(
          ([stage, minutes]) => ({
            label: stages[stage] ?? stage,
            value: `${minutes}분`,
          }),
        ),
        {
          label: t('healthContextCopy.aggregationBasis'),
          value: t('healthContextCopy.sleepOverlapNotice'),
        },
      ],
    });
  if (scope.topic === 'symptoms')
    result.push({
      title: t('healthContextCopy.symptomRecords'),
      rows: [
        {
          label: t('healthContextCopy.periodRecords'),
          value: `${report.symptoms.entryCount}건 · ${report.symptoms.recordedDays}일`,
        },
        ...report.symptoms.latest.map(entry => ({
          label: new Date(entry.effectiveAt).toLocaleString('ko-KR', {
            timeZone: scope.window.timeZone,
          }),
          value: entry.description,
        })),
      ],
    });
  return result;
}
