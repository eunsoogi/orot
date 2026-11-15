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
  const bloodPressure = values.flatMap((item, index) => {
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
  const result: DailyReportOutput['supportedContext'] = [];
  // Even a conflicting severe reading deserves verification, not suppression or
  // reassurance. Never infer absence of urgent symptoms from missing symptom rows.
  const severe = bloodPressure.filter(
    x => x.amount >= (x.systolic ? 180 : 120),
  );
  if (severe.length) {
    result.push(
      claim(
        '우선 확인할 혈압 기록이 있어요. 수축기 180 또는 이완기 120 mmHg 이상인 값이 기록되어 있어요. 지금 흉통·숨참·등 통증·저림·힘 빠짐·마비·말하기 어려움·시야 변화 같은 새로운 우려 증상이 있으면 재측정을 기다리지 말고 119에 연락하세요. 증상이 없다면 1분 이상 뒤 다시 측정하고 여전히 매우 높으면 즉시 의료진에게 연락하세요. 과거 기록만으로 현재 응급상태를 판정하지는 않아요. (질병관리청·AHA 혈압 안내; 나열한 증상이 전부는 아니에요)',
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
          '혈압은 재확인과 상담이 필요해요. 성인 가정혈압의 참고 기준인 수축기 135 또는 이완기 85 mmHg 이상인 기록이 있어요. 이는 반복 측정한 가정혈압을 평가하는 기준이지 한 번의 수치로 고혈압을 진단하는 기준이 아니에요. 5분간 쉬고 올바른 자세로 측정한 값을 기록해, 반복해서 높으면 의사와 상담하세요. 짠 음식을 줄이고 금연·절주를 실천하되 약은 임의로 변경하지 마세요. 연령·임신·질환·측정 장소에 따라 판단이 달라져요. (질병관리청 고혈압 안내)',
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
          ? '운동 기록이 있어요. 기록된 활동은 건강 관리에 도움이 되는 실천이지만, 일부 기록만으로 오늘 운동량이 충분한지 판단하지 않았어요. 몸 상태와 의료진의 제한에 맞춰 무리하지 않고 이어가세요. (WHO 신체활동 안내)'
          : '걸음 기록은 있지만 이 보고서에서 확인한 운동 기록은 없어요. 실제로 운동을 하지 않았다는 뜻은 아니며 권한·동기화·기록 범위에 따라 빠질 수 있어요. 오늘 아직 활동하지 않았고 불편한 증상이나 운동 제한이 없다면, 가능한 범위에서 가벼운 움직임부터 시작해 보세요. (WHO 신체활동 안내)',
        activity,
      ),
    );
  }
  return result;
}
