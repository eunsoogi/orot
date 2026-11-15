import type { DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import {
  doseHistoryKey,
  isRecordedWorkout,
} from '../../healthEvidence/healthContext/dailyReportBehaviorHistory';
import {
  dayFormatter,
  dateKey,
} from '../../healthEvidence/healthContext/calendarDate';
import { t } from '../../i18n';

/** Interpret explicitly recorded history, never fabricate unrecorded doses, inactivity or intensity. */
export function dailyReportBehaviorInsights(
  today: readonly LocalHealthEvidenceRecord[],
  history: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  timeZone: string,
) {
  const formatter = dayFormatter(timeZone);
  const day = (item: LocalHealthEvidenceRecord) =>
    dateKey(formatter, Date.parse(item.record.effectiveAt!));
  const claim = (text: string, items: readonly LocalHealthEvidenceRecord[]) => {
    const keys = new Set(items.map(item => `${item.kind}:${item.record.id}`));
    const sourceReferences = sources
      .filter(source => keys.has(`${source.source}:${source.recordId}`))
      .map(source => ({ source: source.source, recordId: source.recordId }));
    if (sourceReferences.length !== keys.size)
      throw new Error('Historical behavior source mismatch.');
    return { text, modelText: text, sourceReferences };
  };
  const facts: ReturnType<typeof claim>[] = [];
  const keys = [
    ...new Set(
      today.map(doseHistoryKey).filter((key): key is string => Boolean(key)),
    ),
  ];
  for (const key of keys) {
    const prior = history.filter(item => doseHistoryKey(item) === key);
    if (!prior.length) continue;
    const doses = prior.filter(item => item.kind === 'dose_event');
    const completed = doses.filter(
      item =>
        item.record.eventKind === 'taken' ||
        item.record.eventKind === 'administered' ||
        (item.record.eventKind === 'observed' &&
          item.record.observationStatus === 'taken'),
    );
    const missed = doses.filter(
      item =>
        item.record.eventKind === 'missed' ||
        (item.record.eventKind === 'observed' &&
          item.record.observationStatus === 'skipped'),
    );
    const unknown = doses.filter(
      item => !completed.includes(item) && !missed.includes(item),
    );
    const current = today.filter(item => doseHistoryKey(item) === key);
    const ids = new Set(current.map(item => item.record.id));
    const metadata = today.filter(item =>
      sources.some(
        source =>
          source.recordId === item.record.id &&
          source.source === item.kind &&
          source.supportingRecordFor?.some(id => ids.has(id)),
      ),
    );
    const names = metadata.flatMap(item =>
      item.kind === 'medication_definition'
        ? [item.record.displayText]
        : item.kind === 'medication_assertion'
          ? [item.record.medicationName]
          : [],
    );
    const parts = [
      t('dailyReport.history.medication', {
        name:
          [...new Set(names)].join(', ') || t('dailyReport.history.unnamed'),
        days: new Set(prior.map(day)).size,
      }),
    ];
    if (completed.length)
      parts.push(
        t('dailyReport.history.completed', {
          days: new Set(completed.map(day)).size,
        }),
      );
    if (missed.length)
      parts.push(
        t('dailyReport.history.missed', {
          days: new Set(missed.map(day)).size,
        }),
      );
    if (unknown.length) parts.push(t('dailyReport.history.unknown'));
    parts.push(t('dailyReport.history.doseLimit'));
    facts.push(claim(parts.join(' '), [...prior, ...current, ...metadata]));
  }
  const activity = history.filter(isRecordedWorkout);
  if (activity.length) {
    const current = today.filter(isRecordedWorkout);
    // Preserve urgent blood-pressure priority; never add exercise encouragement next to a severe reading.
    const severe = today.filter(
      item =>
        item.kind === 'health_observation' &&
        item.record.value.kind === 'quantity' &&
        item.record.value.unit === 'mmHg' &&
        ((['blood_pressure_systolic', 'blood pressure systolic'].includes(
          item.record.concept,
        ) &&
          item.record.value.amount >= 180) ||
          (['blood_pressure_diastolic', 'blood pressure diastolic'].includes(
            item.record.concept,
          ) &&
            item.record.value.amount >= 120)),
    );
    const text = [
      t('dailyReport.history.activity', {
        days: new Set(activity.map(day)).size,
      }),
      t(
        current.length
          ? 'dailyReport.history.activityToday'
          : 'dailyReport.history.activityNoRecord',
      ),
      severe.length
        ? t('dailyReport.history.urgentFirst')
        : t('dailyReport.history.activityAction'),
    ].join(' ');
    facts.push(claim(text, [...activity, ...current, ...severe]));
  }
  return facts;
}
