import { stages } from './healthContextDisplay';
import { presentHealthQuantities } from './healthQuantityPresentation';
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
  result.push(...presentHealthQuantities(projected, scope));
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
          value: t('healthContextCopy.doseCounts', {
            taken: medication.taken,
            skipped: medication.skipped,
            other: medication.otherDoseRecords,
          }),
        },
        {
          label: t('healthContextCopy.daysWithDoseRecords'),
          value: t('healthContextCopy.daysValue', {
            days: medication.daysWithDoseRecords,
          }),
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
          value: t('healthContextCopy.daysRatio', {
            recorded: projected.sleep.recordedDays,
            total: projected.calendarDays,
          }),
        },
        {
          label: t('healthContextCopy.meanSleepMinutes'),
          value:
            projected.sleep.meanRecordedDailyMinutes === null
              ? t('healthContextCopy.noCalculation')
              : t('healthContextCopy.minutesValue', {
                  minutes: projected.sleep.meanRecordedDailyMinutes,
                }),
        },
        ...Object.entries(projected.sleep.stageMinutes).map(
          ([stage, minutes]) => ({
            label: stages[stage] ?? stage,
            value: t('healthContextCopy.minutesValue', { minutes }),
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
          value: t('healthContextCopy.symptomCounts', {
            count: report.symptoms.entryCount,
            days: report.symptoms.recordedDays,
          }),
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
