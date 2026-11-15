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
    questions.push(
      '기록에 남아 있는 증상은 지금도 있나요? 언제 시작했고 평소보다 달라졌는지, 일상생활에 어떤 영향을 주는지 알려 주세요. 급하거나 심한 증상은 답변을 기다리지 말고 진료를 받으세요.',
    );
  if (pressure.length)
    questions.push(
      '혈압은 집에서 충분히 쉰 뒤 측정했나요? 같은 조건에서 다시 잰 값, 평소 혈압과 의료진이 정한 목표가 있다면 알려 주세요. 연령·임신 여부·질환에 따라 기준이 달라질 수 있어요.',
    );
  const activity = observations.filter(
    record => record.concept === 'step_count' || record.workout,
  );
  if (activity.length)
    questions.push(
      activity.some(record => record.workout)
        ? '오늘 활동 중 불편한 증상이 있었나요? 평소 활동량과 의료진이 안내한 운동 제한이 있다면 함께 알려 주세요.'
        : '운동 기록이 없더라도 실제로 활동했을 수 있어요. 오늘 어떤 활동을 얼마나 했고, 불편한 증상이나 운동 제한이 있었나요?',
    );
  if (!questions.length)
    questions.push(
      '오늘 가장 걱정되는 몸 상태와 평소와 달라진 점은 무엇인가요? 기록만으로 전체 건강의 정상·이상을 판단하지 않으므로, 측정 상황과 의료진이 알려 준 개인 목표가 있다면 함께 알려 주세요.',
    );
  return questions;
}
