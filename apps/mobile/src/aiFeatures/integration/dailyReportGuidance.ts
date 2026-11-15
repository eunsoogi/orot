import { t } from '../../i18n';
import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import {
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
} from './dailyReportFacts';

/** Bounded educational interpretation, not a diagnosis or a model-authored claim.
 * See docs/daily-report-guidance.md for reviewed reference boundaries. Individual
 * readings are never paired across timestamps/devices or treated as daily means. */
export function dailyReportGuidance(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
): DailyReportOutput['supportedContext'] {
  if (!values.length) return [];
  const claim = (text: string, indexes: number[]) => ({
    text,
    sourceReferences: indexes.map(index => {
      const source = sources[index];
      if (
        !source ||
        source.recordId !== values[index]?.record.id ||
        source.source !== values[index]?.kind
      )
        throw new Error('Snapshot source mismatch.');
      return { source: source.source, recordId: source.recordId };
    }),
  });
  const blocked = new Set([
    ...conflictingDailyReportIndexes(values),
    ...incomparableDailyReportIndexes(values),
  ]);
  // A cuff reading can span seconds. Unlike interval step totals, that duration
  // does not invalidate its pressure or suppress urgent verification guidance.
  const bloodPressure = reportBloodPressureReadings(values);
  const result: DailyReportOutput['supportedContext'] = [];
  // Even a conflicting severe reading deserves verification, not suppression or
  // reassurance. Never infer absence of urgent symptoms from missing symptom rows.
  const severe = bloodPressure.filter(
    x => x.amount >= (x.systolic ? 180 : 120),
  );
  if (severe.length) {
    result.push(
      claim(
        t('dailyGuidance.severePressure'),
        severe.map(x => x.index),
      ),
    );
  } else {
    const elevated = bloodPressure.filter(
      x => !blocked.has(x.index) && x.amount >= (x.systolic ? 135 : 85),
    );
    if (elevated.length)
      result.push(
        claim(
          t('dailyGuidance.elevatedPressure'),
          elevated.map(x => x.index),
        ),
      );
  }
  const activity = values.flatMap((item, index) =>
    item.kind === 'health_observation' &&
    (item.record.concept === 'step_count' || item.record.workout)
      ? [index]
      : [],
  );
  if (activity.length && !severe.length) {
    const hasWorkout = activity.some(
      index =>
        values[index]?.kind === 'health_observation' &&
        values[index].record.workout,
    );
    result.push(
      claim(
        hasWorkout
          ? t('dailyGuidance.recordedWorkout')
          : t('dailyGuidance.stepsWithoutWorkout'),
        activity,
      ),
    );
  }
  return result;
}

/** Shared numeric safety boundary; measurement intervals do not erase high readings. */
export function reportBloodPressureReadings(
  values: readonly LocalHealthEvidenceRecord[],
) {
  return values.flatMap((item, index) => {
    if (
      item.kind !== 'health_observation' ||
      item.record.observationKind !== 'measurement' ||
      item.record.value.kind !== 'quantity'
    )
      return [];
    const { record } = item;
    if (
      record.value.kind !== 'quantity' ||
      record.value.unit !== 'mmHg' ||
      !Number.isFinite(record.value.amount) ||
      record.value.amount <= 0
    )
      return [];
    const systolic = [
      'blood_pressure_systolic',
      'blood pressure systolic',
    ].includes(record.concept);
    const diastolic = [
      'blood_pressure_diastolic',
      'blood pressure diastolic',
    ].includes(record.concept);
    return systolic || diastolic
      ? [{ index, amount: record.value.amount, systolic }]
      : [];
  });
}

export function hasSevereReportBloodPressure(
  values: readonly LocalHealthEvidenceRecord[],
) {
  return reportBloodPressureReadings(values).some(
    item => item.amount >= (item.systolic ? 180 : 120),
  );
}
