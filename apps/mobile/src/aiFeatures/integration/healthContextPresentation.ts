import type { HealthContextReport } from '../../healthEvidence/healthContext/types';
import { projectHealthContext } from '../../healthEvidence/healthContext/projection';
import type { HealthContextScope } from '../../healthEvidence/healthContext/scope';
import type { EvidenceSourceDetailSection } from './evidenceSourcePresentation';

const labels: Readonly<Record<string, string>> = {
  'blood pressure systolic': '수축기 혈압',
  'blood pressure diastolic': '이완기 혈압',
  heart_rate: '심박수',
  body_mass: '체중',
  step_count: '걸음 수',
};
const stages: Readonly<Record<string, string>> = {
  asleepCore: '코어 수면',
  asleepDeep: '깊은 수면',
  asleepREM: '렘 수면',
  asleepUnspecified: '단계 미지정 수면',
  awake: '깨어 있음',
  inBed: '침대에 있음',
  unsupported: '해석할 수 없는 단계',
};

/** Show calculated facts and their calendar scope directly; there is no model-written replacement for the original data. */
export function presentHealthContext(
  scope: HealthContextScope,
  report: HealthContextReport,
): readonly EvidenceSourceDetailSection[] {
  const projected = projectHealthContext(report);
  const result: EvidenceSourceDetailSection[] = [
    {
      title: '집계 기간',
      rows: [
        {
          label: '기간',
          value: `${report.days[0]?.date} ~ ${report.days.at(-1)?.date}`,
        },
        { label: '시간대', value: scope.window.timeZone },
        ...(projected.partialDates.length
          ? [
              {
                label: '하루 중 일부만 포함',
                value: projected.partialDates.join(', '),
              },
            ]
          : []),
      ],
    },
  ];
  for (const [index, series] of projected.quantities.entries()) {
    const step = series.concept === 'step_count';
    const mean = step
      ? series.meanRecordedDailySampleSum
      : series.meanOfRecordedDailyMeans;
    result.push({
      title: `${labels[series.concept] ?? series.concept} · 측정 출처 ${index + 1}`,
      rows: [
        {
          label: '기록 일수',
          value: `${series.recordedDays}일 / ${projected.calendarDays}일`,
        },
        { label: '측정 건수', value: `${series.sampleCount}건` },
        {
          label: step
            ? '기록된 날짜의 일별 샘플 합 평균'
            : '기록된 날짜의 일평균 평균',
          value: `${mean} ${series.unit}`,
        },
        {
          label: '개별 측정 범위',
          value: `${series.minimumSample} ~ ${series.maximumSample} ${series.unit}`,
        },
        ...(series.latest
          ? [
              {
                label: '최근 측정',
                value: `${series.latest.amount} ${series.unit} · ${new Date(series.latest.occurredAt).toLocaleString('ko-KR', { timeZone: scope.window.timeZone })}`,
              },
            ]
          : []),
        ...(series.comparison.difference !== null
          ? [
              {
                label: '앞선 7일 대비 최근 7일',
                value: `${series.comparison.difference > 0 ? '+' : ''}${series.comparison.difference} ${series.unit} · 기록 ${series.comparison.previousRecordedDays}일 / ${series.comparison.recentRecordedDays}일`,
              },
            ]
          : []),
        ...(step
          ? [
              {
                label: '집계 기준',
                value:
                  '출처별 샘플 합이에요. 중복될 수 있어 출처끼리 합산하거나 건강 앱의 일일 총합으로 볼 수 없어요.',
              },
            ]
          : []),
      ],
    });
  }
  for (const medication of report.medications)
    result.push({
      title: medication.name,
      rows: [
        {
          label: '정보 구분',
          value:
            medication.source === 'healthkit_registration'
              ? '건강 앱에 등록된 약'
              : medication.source === 'current_user_confirmation'
                ? '직접 확인한 현재 복용약'
                : '처방 기록',
        },
        ...(medication.dosageInstruction
          ? [{ label: '복용 지시', value: medication.dosageInstruction }]
          : []),
        {
          label: '기간 내 복용 기록',
          value: `복용 ${medication.taken}건 · 건너뜀 ${medication.skipped}건 · 기타 ${medication.otherDoseRecords}건`,
        },
        {
          label: '복용 기록이 있는 날',
          value: `${medication.daysWithDoseRecords}일`,
        },
        {
          label: '해석',
          value: '기록이 없는 날의 복용 여부는 추정하지 않아요.',
        },
      ],
    });
  if (scope.topic === 'sleep')
    result.push({
      title: '수면 기록',
      rows: [
        {
          label: '기록 일수',
          value: `${projected.sleep.recordedDays}일 / ${projected.calendarDays}일`,
        },
        {
          label: '기록된 날짜의 수면 시간 평균',
          value:
            projected.sleep.meanRecordedDailyMinutes === null
              ? '계산할 기록 없음'
              : `${projected.sleep.meanRecordedDailyMinutes}분`,
        },
        ...Object.entries(projected.sleep.stageMinutes).map(
          ([stage, minutes]) => ({
            label: stages[stage] ?? stage,
            value: `${minutes}분`,
          }),
        ),
        {
          label: '집계 기준',
          value:
            '날짜별로 겹치는 수면 구간을 합쳤어요. 하루 전체나 한밤의 완전한 수면 기록을 뜻하지는 않아요.',
        },
      ],
    });
  if (scope.topic === 'symptoms')
    result.push({
      title: '증상 기록',
      rows: [
        {
          label: '기간 내 기록',
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
