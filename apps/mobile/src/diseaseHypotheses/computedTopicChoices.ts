import { t } from '../i18n';
import {
  factObject,
  finiteFact,
  statisticSourceTime,
  type ComputedFact,
  type StatisticChoice,
} from './computedStatisticChoice';
import { computedQuantityChoices } from './computedQuantityChoices';

const stageLabels: Readonly<Record<string, string>> = {
  asleepCore: t('computedTopic.coreSleep'),
  asleepDeep: t('computedTopic.deepSleep'),
  asleepREM: t('computedTopic.remSleep'),
  asleepUnspecified: t('computedTopic.unspecifiedSleep'),
  awake: t('computedTopic.awake'),
  inBed: t('computedTopic.inBed'),
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
        ? t('computedTopic.confirmedMedication')
        : medication.source === 'prescription_record'
          ? t('computedTopic.prescription')
          : t('computedTopic.registeredMedication');
    const counts = [
      finiteFact(medication.taken)
        ? t('computedTopic.taken', { count: medication.taken })
        : '',
      finiteFact(medication.skipped)
        ? t('computedTopic.skipped', { count: medication.skipped })
        : '',
      finiteFact(medication.otherDoseRecords)
        ? t('computedTopic.otherDoses', { count: medication.otherDoseRecords })
        : '',
      finiteFact(medication.daysWithDoseRecords)
        ? t('computedTopic.doseDays', { days: medication.daysWithDoseRecords })
        : '',
    ]
      .filter(Boolean)
      .join(' · ');
    const instruction =
      typeof medication.dosageInstruction === 'string'
        ? t('computedTopic.instruction', {
            instruction: medication.dosageInstruction,
          })
        : '';
    return [
      {
        key: `m${index}`,
        description: `Choose status or dose-history emphasis for medications[${index}]. Both preserve its supplied status and dose counts; neither infers unrecorded use.`,
        texts: {
          status: `${medication.name}: ${status}${counts ? ` · ${counts}` : ''}${instruction}.`,
          dose_history: `${medication.name}: ${counts || t('computedTopic.noDoseRecords')} · ${status}${instruction}.`,
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
    ? t('computedTopic.coverage', {
        days: sleep.recordedDays,
        calendar: finiteFact(source.calendarDays)
          ? t('computedTopic.calendarDays', { days: source.calendarDays })
          : '',
      })
    : '';
  const mean = t('computedTopic.sleepMean', {
    minutes: sleep.meanRecordedDailyMinutes,
    coverage,
  });
  const stages = factObject(sleep.stageMinutes)
    ? Object.entries(sleep.stageMinutes).flatMap(([stage, minutes]) =>
        finiteFact(minutes)
          ? [
              t('computedTopic.stageMinutes', {
                stage: stageLabels[stage] ?? stage,
                minutes,
              }),
            ]
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
              mean_and_stages: t('computedTopic.meanStages', {
                mean,
                stages: stages.join(' · '),
              }),
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
              `${statisticSourceTime(entry.effectiveAt, source) ?? t('computedTopic.noTime')}: ${entry.description}`,
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
        recent_entries: t('computedTopic.symptomEntries', {
          count: symptoms.entryCount,
          coverage: finiteFact(symptoms.recordedDays)
            ? t('computedTopic.symptomDays', { days: symptoms.recordedDays })
            : '',
          entries: entries.length ? '\n' + entries.join('\n') : '',
        }),
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
