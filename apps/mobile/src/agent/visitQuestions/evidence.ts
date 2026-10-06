import type { LocalMemoryHit } from '@orot/agent-runtime';
import { HealthObservationSchema } from '@orot/domain';
import type { RecordRepository, RecordKind } from '@orot/storage';
import type { EvidenceChunk, HybridEvidenceSearchHit } from '@orot/rag';
import type { VisitQuestionEvidenceItem } from './taskContract';

export interface VisitQuestionEvidenceMetadata {
  readonly sourceRecordIds: readonly string[];
  readonly sourceRecordRevisions: readonly {
    readonly sourceId: string;
    readonly revision: string;
  }[];
  readonly sourceDates: readonly {
    readonly sourceId: string;
    readonly date: string;
  }[];
  readonly recordKind?: RecordKind;
  readonly evidenceRecordId?: string;
  readonly evidenceSpanId?: string;
  /** Keeps each reviewed-memory citation tied to the bounded local query that found it. */
  readonly memorySearchQuery?: string;
  readonly healthObservationConflict?: {
    readonly conceptKey: string;
    readonly effectiveAt: string;
    readonly valueFingerprint: string;
  };
}

export const VISIT_QUESTION_RECORD_KINDS: Readonly<
  Record<EvidenceChunk['metadata']['recordType'], RecordKind>
> = {
  appointment: 'appointment',
  encounter: 'encounter',
  health_observation: 'health_observation',
  medication_assertion: 'medication_assertion',
  medication_definition: 'medication_definition',
  dose_event: 'dose_event',
  symptom_entry: 'symptom_entry',
  evidence_span: 'evidence_span',
  transcript_segment: 'transcript_segment',
};

function stableJson(value: unknown): string {
  if (value === null || typeof value !== 'object')
    return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map(key => `${JSON.stringify(key)}:${stableJson(record[key])}`)
    .join(',')}}`;
}

function hash32(value: string, seed: number): number {
  let hash = seed;
  for (let index = 0; index < value.length; index += 1) {
    hash = (Math.imul(hash, 31) + value.charCodeAt(index)) % 0x1_0000_0000;
    if (hash < 0) hash += 0x1_0000_0000;
  }
  return hash;
}

/** Fingerprints stay local and let review/save reject evidence whose record payload changed. */
export function localEvidenceFingerprint(value: unknown): string {
  const encoded = stableJson(value);
  const first = hash32(encoded, 0x811c9dc5).toString(16).padStart(8, '0');
  const second = hash32(encoded, 0x9e3779b9).toString(16).padStart(8, '0');
  return `local-v1-${first}${second}`;
}

function healthObservationConflictFact(record: unknown) {
  const parsed = HealthObservationSchema.safeParse(record);
  if (!parsed.success) {
    throw new Error(
      'The current health observation no longer matches its record schema.',
    );
  }
  const observation = parsed.data;
  const value =
    observation.value.kind === 'quantity'
      ? {
          kind: observation.value.kind,
          amount: observation.value.amount,
          unit: observation.value.unit,
        }
      : observation.value;

  return {
    // These fingerprints stay in local metadata; the provider receives only a generic conflict notice.
    conceptKey: localEvidenceFingerprint({
      observationKind: observation.observationKind,
      concept: observation.concept.normalize('NFC').trim().toLowerCase(),
    }),
    effectiveAt: observation.effectiveAt,
    valueFingerprint: localEvidenceFingerprint(value),
  };
}

function reviewState(
  state: EvidenceChunk['metadata']['reviewState']['status'],
): VisitQuestionEvidenceItem['reviewState'] {
  if (state === 'reviewed' || state === 'unreviewed') return state;
  return 'unknown';
}

export function visitQuestionCitationKey(
  item: VisitQuestionEvidenceItem,
): string {
  return [
    item.sourceKind,
    item.sourceId,
    item.sourceRevision,
    item.evidenceId,
    item.evidenceRevision,
  ].join('\u0000');
}

/** Re-reads every linked source record; a missing source invalidates the RAG citation. */
export async function mapRagHitToVisitQuestionEvidence(
  repository: Pick<RecordRepository, 'get'>,
  hit: HybridEvidenceSearchHit,
): Promise<{
  readonly item: VisitQuestionEvidenceItem;
  readonly metadata: VisitQuestionEvidenceMetadata;
}> {
  const chunk = hit.chunk;
  const recordKind = VISIT_QUESTION_RECORD_KINDS[chunk.metadata.recordType];
  const linkedSourceRecordIds = [...new Set(chunk.metadata.sourceRecordIds)];
  const [sourceRecords, evidenceRecord] = await Promise.all([
    Promise.all(
      linkedSourceRecordIds.map(id => repository.get('source_record', id)),
    ),
    repository.get(recordKind, chunk.metadata.evidenceId),
  ]);
  if (!evidenceRecord || sourceRecords.some(record => !record)) {
    throw new Error(
      'RAG evidence or its source records changed while visit questions were being prepared.',
    );
  }

  const sourceRecordRevisions = sourceRecords.map((record, index) => ({
    sourceId: linkedSourceRecordIds[index]!,
    revision: localEvidenceFingerprint(record),
  }));
  const sourceRecordIds = [
    ...new Set([chunk.metadata.sourceId, ...linkedSourceRecordIds]),
  ];
  const date = chunk.metadata.effectiveTime;
  const metadata: VisitQuestionEvidenceMetadata = {
    sourceRecordIds,
    sourceRecordRevisions,
    sourceDates: date ? [{ sourceId: chunk.metadata.sourceId, date }] : [],
    recordKind,
    evidenceRecordId: chunk.metadata.evidenceId,
    ...(recordKind === 'evidence_span'
      ? { evidenceSpanId: chunk.metadata.evidenceId }
      : {}),
    ...(recordKind === 'health_observation'
      ? {
          healthObservationConflict:
            healthObservationConflictFact(evidenceRecord),
        }
      : {}),
  };
  const item: VisitQuestionEvidenceItem = {
    sourceKind: 'personal_record',
    sourceId: chunk.metadata.sourceId,
    sourceRevision: localEvidenceFingerprint(sourceRecordRevisions),
    evidenceId: chunk.metadata.evidenceId,
    evidenceRevision: localEvidenceFingerprint(evidenceRecord),
    locator: chunk.metadata.evidenceLocator,
    effectiveTime: chunk.metadata.effectiveTime,
    reviewState: reviewState(chunk.metadata.reviewState.status),
    content: chunk.text,
  };
  return { item, metadata };
}

export function mapMemoryHitToVisitQuestionEvidence(hit: LocalMemoryHit): {
  readonly item: VisitQuestionEvidenceItem;
  readonly metadata: VisitQuestionEvidenceMetadata;
} | null {
  if (
    !hit.id.trim() ||
    !hit.text.trim() ||
    hit.provenance.sourceIds.length === 0 ||
    (hit.provenance.reviewState !== 'user_confirmed' &&
      hit.provenance.reviewState !== 'human_reviewed')
  ) {
    return null;
  }
  const sourceRecordIds = [...new Set(hit.provenance.sourceIds)];
  const sourceDates = hit.provenance.sourceDates ?? [];
  const revision = localEvidenceFingerprint({
    id: hit.id,
    text: hit.text,
    provenance: hit.provenance,
    createdAt: hit.createdAt,
  });
  return {
    item: {
      sourceKind: 'reviewed_memory',
      sourceId: hit.id,
      sourceRevision: revision,
      evidenceId: hit.id,
      evidenceRevision: revision,
      locator: { kind: 'structured_record', recordId: hit.id },
      effectiveTime: Number.isFinite(hit.createdAt)
        ? new Date(hit.createdAt).toISOString()
        : null,
      reviewState: 'reviewed',
      content: hit.text,
    },
    metadata: { sourceRecordIds, sourceRecordRevisions: [], sourceDates },
  };
}
