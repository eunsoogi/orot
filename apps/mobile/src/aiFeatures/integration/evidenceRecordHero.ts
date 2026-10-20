import type { LocalHealthEvidenceRecord } from '../../healthEvidence/localEvidenceRepository';
import { fieldLabels, visibleValue } from './evidenceSourceValues';
import { sleepRecordSemantics } from '../../healthkit/sleep/sleepRecordSemantics';

export interface EvidenceRecordHero {
  readonly heading?: string;
  readonly value?: string;
  readonly body?: string;
  readonly at?: string;
  readonly atLabel?: string;
  readonly consumedLabels: readonly string[];
}

/** Projects existing fields only. Never generates a summary, computes a trend, or pairs unlinked measurements. */
export function evidenceRecordHero(
  entry: LocalHealthEvidenceRecord,
): EvidenceRecordHero {
  const record = entry.record as unknown as Record<string, unknown>;
  const consumed = ['effectiveAt'];
  const headingKey = ['concept', 'medicationName', 'title', 'displayText'].find(
    key => typeof record[key] === 'string',
  );
  if (headingKey) consumed.push(headingKey);
  const heading = headingKey
    ? visibleValue(record[headingKey], headingKey)
    : undefined;
  let value: string | undefined;
  let body: string | undefined;
  // Dose quantities belong to their saved event, even when the medication name is a separate linked record.
  if (entry.kind === 'dose_event' && record.dose) {
    value = visibleValue(record.dose, 'dose');
    if (value) consumed.push('dose');
  }
  if (record.value && typeof record.value === 'object') {
    const saved = record.value as Record<string, unknown>;
    if (
      saved.kind === 'quantity' &&
      typeof saved.amount === 'number' &&
      typeof saved.unit === 'string'
    ) {
      const unit =
        record.concept === 'step_count'
          ? '걸음'
          : saved.unit === 'count/min'
            ? '회/분'
            : saved.unit;
      value = `${saved.amount} ${unit}`;
    } else if (saved.kind === 'boolean') value = visibleValue(saved.value);
    else if (saved.kind === 'text')
      body =
        sleepRecordSemantics(record)?.sleepStage ?? visibleValue(saved.text);
    if (value || body) consumed.push('value');
  }
  const bodyKey = [
    'text',
    'description',
    'questionText',
    'summary',
    'note',
  ].find(key => typeof record[key] === 'string');
  if (!body && bodyKey) {
    body = record[bodyKey] as string;
    consumed.push(bodyKey);
  }
  // Duplicate timestamps add no information, while distinct interval ends remain visible.
  if (record.endedAt === record.effectiveAt) consumed.push('endedAt');
  if (record.recordedAt === record.ingestedAt) consumed.push('recordedAt');
  if (entry.kind === 'health_observation') consumed.push('observationKind');
  return {
    heading,
    value,
    body,
    at: visibleValue(record.effectiveAt, 'effectiveAt'),
    // Only the source event time is displayed; imported medication definitions may have none.
    atLabel:
      entry.kind === 'dose_event'
        ? record.eventKind === 'taken' ||
          record.eventKind === 'administered' ||
          record.observationStatus === 'taken'
          ? '복용 발생 시각'
          : '복약 기록 시각'
        : entry.kind === 'health_observation'
          ? record.endedAt && record.endedAt !== record.effectiveAt
            ? '측정 시작 시각'
            : '측정 시각'
          : '발생 시각',
    consumedLabels: consumed
      .map(key => fieldLabels[key])
      .filter((label): label is string => Boolean(label)),
  };
}
