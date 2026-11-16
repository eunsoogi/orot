import { dailyReportGuidance } from './dailyReportGuidance';
import { dailyReportSynthesis } from './dailyReportSynthesis';
import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import { t } from '../../i18n';

/** Interpret explicit statuses together, not inferred causes or clinical adherence.
 * All claims stay bound to the immutable snapshot and its deletion lineage. */
export function dailyReportActions(
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
        source.source !== values[index]?.kind ||
        source.recordId !== values[index]?.record.id
      )
        throw new Error('Snapshot source mismatch.');
      return { source: source.source, recordId: source.recordId };
    }),
  });
  const doses = values.flatMap((item, index) =>
    item.kind === 'dose_event' ? [{ record: item.record, index }] : [],
  );
  const result: DailyReportOutput['supportedContext'] = [];
  const missed = doses.filter(
    ({ record }) =>
      record.eventKind === 'missed' ||
      (record.eventKind === 'observed' &&
        record.observationStatus === 'skipped'),
  );
  const taken = doses.filter(
    ({ record }) =>
      ['taken', 'administered'].includes(record.eventKind) ||
      (record.eventKind === 'observed' && record.observationStatus === 'taken'),
  );
  const unknown = doses.filter(
    item => !missed.includes(item) && !taken.includes(item),
  );
  for (const [items, key] of [
    [missed, 'dailyReport.context.doseMissed'],
    [taken, 'dailyReport.context.doseTaken'],
    [unknown, 'dailyReport.context.doseUnknown'],
  ] as const) {
    if (items.length) {
      const doseIds = new Set(items.map(item => item.record.id));
      const linked = values.flatMap((item, index) => {
        if (!sources[index]?.supportingRecordFor?.some(id => doseIds.has(id)))
          return [];
        if (item.kind === 'medication_definition')
          return [{ index, name: item.record.displayText }];
        if (item.kind === 'medication_assertion')
          return [{ index, name: item.record.medicationName }];
        return [];
      });
      const text = linked.length
        ? t('dailyReport.medication.namedAction', {
            names: [...new Set(linked.map(item => item.name))].join(', '),
            text: t(key),
          })
        : t(key);
      result.push(
        claim(text, [
          ...items.map(item => item.index),
          ...linked.map(item => item.index),
        ]),
      );
    }
  }
  const visits = values.flatMap((item, index) =>
    item.kind === 'appointment' && item.record.status !== 'cancelled'
      ? [{ record: item.record, index }]
      : [],
  );
  const symptoms = values.flatMap((item, index) =>
    item.kind === 'symptom_entry' && item.record.status === 'active'
      ? [index]
      : [],
  );
  // Recorded-active symptoms deserve a next step even without an admitted visit.
  // Do not turn missing appointments into proof there is no care plan, or an old
  // active flag into a current assessment. Existing visit advice avoids duplication.
  if (symptoms.length && !visits.length) {
    result.push(claim(t('dailyReport.context.symptomFollowUp'), symptoms));
  }
  if (visits.length) {
    const key = symptoms.length
      ? 'dailyReport.context.visitSymptoms'
      : doses.length
        ? 'dailyReport.context.visitMedication'
        : visits.every(item => item.record.status === 'completed')
          ? 'dailyReport.context.visitCompleted'
          : 'dailyReport.context.visitOnly';
    result.push(
      claim(t(key), [
        ...visits.map(item => item.index),
        ...symptoms,
        ...doses.map(item => item.index),
      ]),
    );
  }
  result.push(claim(t('dailyReport.context.coverage'), [0]));
  return result;
}

/** Keep urgent guidance first, then observed patterns and cross-domain actions. */
export function dailyReportInsights(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  selected: readonly number[],
): DailyReportOutput['supportedContext'] {
  return [
    ...dailyReportGuidance(values, sources),
    ...dailyReportSynthesis(values, sources, selected),
    ...dailyReportActions(values, sources),
  ];
}
