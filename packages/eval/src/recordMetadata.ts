import type { EvidenceSpan, RecordMetadata, SourceRecord } from '@orot/domain';

export type RecordOrigin = RecordMetadata['provenance']['origin'];
export function metadata(
  id: string,
  effectiveAt: string,
  origin: RecordOrigin,
  sourceRecordIds: string[] = [],
  recordedAt = effectiveAt,
  ingestedAt = recordedAt,
): RecordMetadata {
  return {
    id,
    effectiveAt,
    recordedAt,
    ingestedAt,
    provenance: { origin, sourceRecordIds },
    reviewState: { status: 'unreviewed' },
  };
}

export function sourceRecord(
  id: string,
  sourceKind: SourceRecord['sourceKind'],
  title: string,
  effectiveAt: string,
  origin: RecordOrigin,
  recordedAt = effectiveAt,
  ingestedAt = recordedAt,
): SourceRecord {
  return {
    ...metadata(id, effectiveAt, origin, [], recordedAt, ingestedAt),
    sourceKind,
    title,
  };
}

export function evidenceSpan(
  id: string,
  sourceRecordId: string,
  effectiveAt: string,
  text: string,
): EvidenceSpan {
  return {
    ...metadata(id, effectiveAt, 'derived', [sourceRecordId], '2030-05-10T12:00:00Z'),
    sourceRecordId,
    text,
  };
}
