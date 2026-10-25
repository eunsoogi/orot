import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceChunk } from '@orot/rag';
import type { RecordKind, StaleTranscriptArtifact } from '@orot/storage';
import type {
  LocalHealthEvidenceInventory,
  LocalHealthEvidenceRecord,
  LocalHealthEvidenceRepository,
} from '../../../healthEvidence/localEvidenceRepository';

const timestamp = '2026-01-02T08:00:00.000Z';

export type StaleEvidenceArtifact = Pick<
  StaleTranscriptArtifact,
  'kind' | 'id'
>;

export const noStaleEvidence = {
  staleArtifacts: [] as readonly StaleEvidenceArtifact[],
  loadCurrentStaleArtifacts: async (): Promise<
    readonly StaleEvidenceArtifact[]
  > => [],
};

export function inventory(
  records: readonly LocalHealthEvidenceRecord[],
): LocalHealthEvidenceInventory {
  const kinds = [...new Set(records.map(record => record.kind))];
  return {
    inventoryComplete: true,
    availableKinds: kinds,
    queriedKinds: kinds,
    unsupportedKinds: [],
    truncatedKinds: [],
    records,
    recordCount: records.length,
  };
}

export function entry(
  kind: RecordKind,
  record: unknown,
): LocalHealthEvidenceRecord {
  return { kind, record } as LocalHealthEvidenceRecord;
}

export function sourceRecord(id: string): LocalHealthEvidenceRecord {
  return entry('source_record', {
    id,
    sourceKind: 'user_note',
    effectiveAt: timestamp,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: { origin: 'user_reported', sourceRecordIds: [] },
    reviewState: { status: 'unreviewed' },
  });
}

export function healthObservation(
  id: string,
  sourceRecordIds: readonly string[],
  amount = 70.5,
): LocalHealthEvidenceRecord {
  return entry('health_observation', {
    id,
    effectiveAt: timestamp,
    recordedAt: timestamp,
    ingestedAt: timestamp,
    provenance: {
      origin: sourceRecordIds.length ? 'imported' : 'user_reported',
      sourceRecordIds: [...sourceRecordIds],
    },
    reviewState: {
      status: 'reviewed',
      reviewerId: 'fixture-reviewer',
      reviewedAt: timestamp,
    },
    observationKind: 'measurement',
    concept: 'weight',
    value: { kind: 'quantity', amount, unit: 'kg' },
  });
}

export function repository(
  records: readonly LocalHealthEvidenceRecord[],
): LocalHealthEvidenceRepository {
  return {
    readRecord: jest.fn(
      async (kind, id) =>
        records.find(record => record.kind === kind && record.record.id === id)
          ?.record ?? null,
    ),
  } as unknown as LocalHealthEvidenceRepository;
}

export function referenceOnly(item: EvidenceItem): EvidenceReference {
  return {
    sourceKind: item.sourceKind,
    sourceId: item.sourceId,
    sourceRevision: item.sourceRevision,
    evidenceId: item.evidenceId,
    evidenceRevision: item.evidenceRevision,
    locator: item.locator,
    effectiveTime: item.effectiveTime,
    ...(item.unit === undefined ? {} : { unit: item.unit }),
    reviewState: item.reviewState,
  };
}

export function structuredChunk(input: {
  readonly id: string;
  readonly recordId: string;
  readonly sourceId: string;
  readonly sourceRecordIds: readonly string[];
  readonly text: string;
}): EvidenceChunk {
  return {
    id: input.id,
    text: input.text,
    metadata: {
      sourceId: input.sourceId,
      sourceRecordIds: [...input.sourceRecordIds],
      evidenceId: input.recordId,
      evidenceLocator: { kind: 'structured_record', recordId: input.recordId },
      effectiveTime: timestamp,
      recordType: 'health_observation',
      reviewState: {
        status: 'reviewed',
        reviewerId: 'fixture-reviewer',
        reviewedAt: timestamp,
      },
    },
  };
}
