import { t } from '../../i18n';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';

/** Ask for missing interpretation context without treating unknown information as
 * a negative finding. Answers are not invented or sent to a new provider here;
 * a later report revision must use its existing consent and source validation. */
export function dailyReportQuestions(
  values: readonly LocalHealthEvidenceRecord[],
): string[] {
  if (!values.length) return [];
  const observations = values.flatMap(item =>
    item.kind === 'health_observation' ? [item.record] : [],
  );
  const pressure = observations.filter(record =>
    [
      'blood_pressure_systolic',
      'blood_pressure_diastolic',
      'blood pressure systolic',
      'blood pressure diastolic',
    ].includes(record.concept),
  );
  // Match the existing severe-pressure verification boundary, including cuff
  // intervals. A question must never turn emergency advice into a chat prerequisite.
  const severe = pressure.some(record => {
    const value = record.value;
    const systolic = record.concept.endsWith('systolic');
    return (
      value.kind === 'quantity' &&
      value.unit === 'mmHg' &&
      Number.isFinite(value.amount) &&
      value.amount >= (systolic ? 180 : 120)
    );
  });
  if (severe) return [];
  const questions: string[] = [];
  if (
    values.some(
      item => item.kind === 'symptom_entry' && item.record.status === 'active',
    )
  )
    questions.push(t('dailyReport.question.activeSymptoms'));
  if (pressure.length) questions.push(t('dailyReport.question.bloodPressure'));
  const activity = observations.filter(
    record => record.concept === 'step_count' || record.workout,
  );
  if (activity.length)
    questions.push(
      activity.some(record => record.workout)
        ? t('dailyReport.question.recordedActivity')
        : t('dailyReport.question.missingActivity'),
    );
  if (!questions.length)
    questions.push(t('dailyReport.question.generalContext'));
  return questions;
}
