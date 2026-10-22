import {
  factObject,
  finiteFact,
  statisticSourceTime,
  type ComputedFact,
  type StatisticChoice,
} from './computedStatisticChoice';
import { computedQuantityChoices } from './computedQuantityChoices';

const stageLabels: Readonly<Record<string, string>> = {
  asleepCore: '코어 수면',
  asleepDeep: '깊은 수면',
  asleepREM: '렘 수면',
  asleepUnspecified: '단계 미지정 수면',
  awake: '깨어 있음',
  inBed: '침대에 있음',
};

/** Medication identity/use and recorded dose events remain distinct, even when
 * the model emphasizes dose history. Absent events never become missed doses. */
function medicationChoices(source: ComputedFact): StatisticChoice[] {
  if (!Array.isArray(source.medications)) return [];
  return source.medications.flatMap((medication, index) => {
    if (
      !factObject(medication) ||
      typeof medication.name !== 'string' ||
      !medication.name.trim()
    )
      return [];
    const status =
      medication.source === 'current_user_confirmation'
        ? '직접 확인한 현재 복용약'
        : medication.source === 'prescription_record'
          ? '처방 기록'
          : '건강 앱에 등록된 약';
    const counts = [
      finiteFact(medication.taken) ? `복용 완료 ${medication.taken}건` : '',
      finiteFact(medication.skipped) ? `건너뜀 ${medication.skipped}건` : '',
      finiteFact(medication.otherDoseRecords)
        ? `기타 복약 기록 ${medication.otherDoseRecords}건`
        : '',
      finiteFact(medication.daysWithDoseRecords)
        ? `복약 기록 ${medication.daysWithDoseRecords}일`
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const instruction =
      typeof medication.dosageInstruction === 'string'
        ? ` · 기록된 복용 지시: ${medication.dosageInstruction}`
        : '';
    return [
      {
        key: `m${index}`,
        description: `Choose status or dose-history emphasis for medications[${index}]. Both preserve its supplied status and dose counts; neither infers unrecorded use.`,
        texts: {
          status: `${medication.name}: ${status}${counts ? ` · ${counts}` : ''}${instruction}.`,
          dose_history: `${medication.name}: ${counts || '개별 복약 기록 미제공'} · ${status}${instruction}.`,
        },
      },
    ];
  });
}

function sleepChoices(source: ComputedFact): StatisticChoice[] {
  const sleep = source.sleep;
  if (!factObject(sleep) || !finiteFact(sleep.meanRecordedDailyMinutes))
    return [];
  const coverage = finiteFact(sleep.recordedDays)
    ? ` · 기록 ${sleep.recordedDays}일${finiteFact(source.calendarDays) ? ` / ${source.calendarDays}일` : ''}`
    : '';
  const mean = `기록된 날짜의 수면 시간 평균 ${sleep.meanRecordedDailyMinutes}분${coverage}. 날짜별로 겹치는 수면 구간을 합친 값이며 완전한 하룻밤 수면 총량을 뜻하지는 않아요. 기록하지 않은 날짜의 수면은 알 수 없어요.`;
  const stages = factObject(sleep.stageMinutes)
    ? Object.entries(sleep.stageMinutes).flatMap(([stage, minutes]) =>
        finiteFact(minutes)
          ? [`${stageLabels[stage] ?? stage} ${minutes}분`]
          : [],
      )
    : [];
  return [
    {
      key: 'sleep',
      description:
        'Choose the recorded-calendar-day mean alone or with whole-period stage totals. This aggregate does not determine whether complete-night records exist.',
      texts: {
        mean,
        ...(stages.length
          ? {
              mean_and_stages: `${mean} 전체 기간의 단계별 누적 시간: ${stages.join(' · ')}.`,
            }
          : {}),
      },
    },
  ];
}

/** The original bounded symptom entries are quoted, never synthesized or diagnosed. */
function symptomChoices(source: ComputedFact): StatisticChoice[] {
  const symptoms = source.symptoms;
  if (
    !factObject(symptoms) ||
    !finiteFact(symptoms.entryCount) ||
    symptoms.entryCount <= 0
  )
    return [];
  const entries = Array.isArray(symptoms.latest)
    ? symptoms.latest.flatMap(entry =>
        factObject(entry) && typeof entry.description === 'string'
          ? [
              `${statisticSourceTime(entry.effectiveAt, source) ?? '시각 미제공'}: ${entry.description}`,
            ]
          : [],
      )
    : [];
  return [
    {
      key: 'symptoms',
      description:
        'Include recorded symptom coverage and supplied recent entries without inference.',
      texts: {
        recent_entries: `증상 기록 ${symptoms.entryCount}건${finiteFact(symptoms.recordedDays) ? ` · ${symptoms.recordedDays}일` : ''}.${entries.length ? '\n' + entries.join('\n') : ''}`,
      },
    },
  ];
}

export function computedTopicChoices(source: ComputedFact): StatisticChoice[] {
  switch (source.topic) {
    case 'medications':
      return medicationChoices(source);
    case 'measurements':
    case 'activity':
      return computedQuantityChoices(source);
    case 'sleep':
      return sleepChoices(source);
    case 'symptoms':
      return symptomChoices(source);
    default:
      return [];
  }
}
