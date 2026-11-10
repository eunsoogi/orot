import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceQueries';
import type { DailyReportSourceRecord } from '@orot/domain';
import { compareTimestamps } from '@orot/domain';
import { stableJson } from './evidenceUtils';

/** Keep differing same-instant measurements together, without deciding which source is correct. */
export function conflictingDailyReportIndexes(
  values: readonly LocalHealthEvidenceRecord[],
) {
  return comparedDailyReportIndexes(values, false);
}

/** Distinct units at the same instant are incomparable without an explicit conversion. */
export function incomparableDailyReportIndexes(
  values: readonly LocalHealthEvidenceRecord[],
) {
  return comparedDailyReportIndexes(values, true);
}

function comparedDailyReportIndexes(
  values: readonly LocalHealthEvidenceRecord[],
  incomparable: boolean,
) {
  const groups = new Map<
    string,
    { index: number; value: string; at: string; unit: string }[]
  >();
  values.forEach((item, index) => {
    if (
      item.kind !== 'health_observation' ||
      item.record.observationKind !== 'measurement'
    )
      return;
    const key = item.record.concept.toLowerCase();
    const group = groups.get(key) ?? [];
    group.push({
      index,
      value: stableJson(item.record.value),
      at: item.record.effectiveAt,
      unit:
        item.record.value.kind === 'quantity'
          ? item.record.value.unit
          : item.record.value.kind,
    });
    groups.set(key, group);
  });
  return [...groups.values()].flatMap(group =>
    group
      .filter(item =>
        group.some(
          other =>
            compareTimestamps(item.at, other.at) === 0 &&
            (incomparable
              ? item.unit !== other.unit
              : item.unit === other.unit && item.value !== other.value),
        ),
      )
      .map(item => item.index),
  );
}

/** Render only stored fields; the model may select facts but cannot author medical claims. */
export function dailyReportFacts(
  values: readonly LocalHealthEvidenceRecord[],
  sources: readonly DailyReportSourceRecord[],
) {
  if (values.length !== sources.length)
    throw new Error('Snapshot sources do not match values.');
  return values.map((item, index) => {
    const source = sources[index]!;
    if (item.kind !== source.source || item.record.id !== source.recordId)
      throw new Error('Snapshot source mismatch.');
    const record = item.record;
    let detail: string;
    if (item.kind === 'health_observation') {
      const value = item.record.value;
      const rendered =
        value.kind === 'quantity'
          ? `${value.amount} ${value.unit}`
          : value.kind === 'text'
            ? value.text
            : String(value.value);
      detail = `${item.record.concept}: ${rendered}`;
    } else if (item.kind === 'symptom_entry') {
      detail = `증상: ${item.record.description}${item.record.severity === undefined ? '' : ` (정도 ${item.record.severity}/10)`}, 상태: ${item.record.status}`;
    } else if (item.kind === 'dose_event') {
      detail = `복약 기록: ${item.record.eventKind}${item.record.eventKind === 'observed' ? `, 상태: ${item.record.observationStatus}` : ''}${item.record.dose ? `, 용량: ${item.record.dose.amount ?? ''} ${item.record.dose.unit}` : ''}`;
    } else throw new Error('Unsupported daily report record.');
    const provenance = record.provenance.source;
    const sourceName =
      provenance?.sourceName ?? provenance?.system ?? record.provenance.origin;
    const time = source.occurrence.endExclusive
      ? `${source.occurrence.startInclusive}–${source.occurrence.endExclusive}`
      : source.occurrence.startInclusive;
    return {
      text: `${detail} · 시각: ${time} · 출처: ${sourceName} (${record.provenance.origin})`,
      modelText: `${detail} · 시각: ${time} · 기록 출처 유형: ${record.provenance.origin}`,
      sourceReferences: [{ source: source.source, recordId: source.recordId }],
    };
  });
}
