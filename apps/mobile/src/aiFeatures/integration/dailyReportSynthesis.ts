import { t } from '../../i18n';
import type { DailyReportOutput, DailyReportSourceRecord } from '@orot/domain';
import { compareTimestamps } from '@orot/domain';
import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import {
  conflictingDailyReportIndexes,
  incomparableDailyReportIndexes,
} from './dailyReportFacts';

import { stableJson } from './evidenceUtils';
import { visibleValue } from './evidenceSourceValues';

type Claim = DailyReportOutput['supportedContext'][number];

/** Summarize observed daily patterns, not medical meaning. No reference ranges or
 * causal/diagnostic conclusions can be inferred from a day's incomplete sample.
 * The existing model selects highlights; only deterministic, cited synthesis is
 * allowed to add statements beyond their verbatim source descriptions. */
export function dailyReportSynthesis(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
  selected: readonly number[],
): Claim[] {
  if (!values.length) return [];
  if (values.length !== sources.length)
    throw new Error('Snapshot source mismatch.');
  const claim = (text: string, indexes: readonly number[]): Claim => ({
    text,
    sourceReferences: [...new Set(indexes)].map(index => {
      const source = sources[index]!;
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
  const result: Claim[] = [];
  const symptoms = values.flatMap((item, index) =>
    item.kind === 'symptom_entry' ? [{ record: item.record, index }] : [],
  );
  if (symptoms.length) {
    const active = symptoms.filter(item => item.record.status === 'active');
    const resolved = symptoms.filter(item => item.record.status === 'resolved');
    const descriptions = (items: typeof symptoms) =>
      items
        .slice(0, 3)
        .map(item => `‘${item.record.description}’`)
        .join(', ');
    result.push(
      claim(
        [
          active.length
            ? t('dailyReport.analysis.activeSymptoms', {
                symptoms: descriptions(active),
              })
            : '',
          resolved.length
            ? t('dailySynthesis.resolved', { value0: descriptions(resolved) })
            : '',
          t('dailySynthesis.currentUnknown'),
        ]
          .filter(Boolean)
          .join(' '),
        symptoms.map(item => item.index),
      ),
    );
  }
  const groups = new Map<
    string,
    {
      index: number;
      amount: number;
      at: string;
      unit: string;
      concept: string;
      pointMeasurement: boolean;
    }[]
  >();
  for (const [index, item] of values.entries()) {
    if (
      item.kind !== 'health_observation' ||
      item.record.value.kind !== 'quantity' ||
      item.record.observationKind !== 'measurement'
    )
      continue;
    const { record } = item;
    if (record.value.kind !== 'quantity') continue;
    // Compare only the same metric, unit and source. Do not sum overlapping
    // wearables, cumulative samples, or compare incompatible measurement methods.
    const key = stableJson([
      record.concept,
      record.value.unit,
      record.provenance.origin,
      record.provenance.source,
      // Imported samples without stable source identity cannot establish a
      // same-source comparison merely because their display names match.
      record.provenance.origin === 'imported' &&
      !record.provenance.source?.sourceIdentifier
        ? record.id
        : undefined,
    ]);
    const group = groups.get(key) ?? [];
    group.push({
      index,
      amount: record.value.amount,
      unit:
        record.concept === 'step_count'
          ? t('dailySynthesis.steps')
          : record.value.unit === 'count/min'
            ? t('dailySynthesis.perMinute')
            : record.value.unit,
      at: record.effectiveAt,
      concept: visibleValue(record.concept, 'concept') ?? record.concept,
      // Interval totals and cumulative quantities (steps, energy, sleep) are
      // not comparable point readings, even with equal units and provenance.
      pointMeasurement:
        (!record.endedAt ||
          compareTimestamps(record.endedAt, record.effectiveAt) === 0) &&
        [
          'heart_rate',
          'resting_heart_rate',
          'body_mass',
          'weight',
          'blood_pressure_systolic',
          'blood_pressure_diastolic',
          'blood pressure systolic',
          'blood pressure diastolic',
          'body_temperature',
          'blood_glucose',
          'oxygen_saturation',
        ].includes(record.concept),
    });
    groups.set(key, group);
  }
  const ranked = [...groups.values()].sort(
    (a, b) =>
      Number(b.some(x => selected.includes(x.index))) -
      Number(a.some(x => selected.includes(x.index))),
  );
  for (const group of ranked.slice(0, 3)) {
    group.sort((a, b) => compareTimestamps(a.at, b.at));
    const first = group[0]!;
    const last = group[group.length - 1]!;
    const indexes = group.map(item => item.index);
    if (indexes.some(index => blocked.has(index))) {
      result.push(
        claim(t('dailySynthesis.conflicting', { value0: first.concept }), [
          ...new Set([
            ...indexes,
            ...[...blocked].filter(index => {
              const item = values[index];
              return (
                item?.kind === 'health_observation' &&
                visibleValue(item.record.concept, 'concept') === first.concept
              );
            }),
          ]),
        ]),
      );
    } else if (!group.every(item => item.pointMeasurement)) {
      result.push(
        claim(t('dailySynthesis.interval', { value0: first.concept }), indexes),
      );
    } else if (
      first.at !== last.at &&
      compareTimestamps(first.at, last.at) !== 0
    ) {
      const valuesText =
        first.amount === last.amount
          ? t('dailySynthesis.same', {
              value0: first.amount,
              value1: first.unit,
            })
          : t('dailySynthesis.changed', {
              value0: first.amount,
              value1: first.unit,
              value2: last.amount,
              value3: last.unit,
              value4:
                last.amount > first.amount
                  ? t('dailySynthesis.increased')
                  : t('dailySynthesis.decreased'),
            });
      result.push(
        claim(
          t('dailySynthesis.notClinical', {
            value0: first.concept,
            value1: valuesText,
          }),
          [first.index, last.index],
        ),
      );
    } else {
      result.push(
        claim(
          t('dailySynthesis.single', {
            value0: first.concept,
            value1: first.amount,
            value2: first.unit,
          }),
          [first.index],
        ),
      );
    }
  }
  if (!result.length)
    result.push(
      claim(t('dailySynthesis.insufficient'), selected.length ? selected : [0]),
    );
  return result;
}
