import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { ReviewState } from '@orot/domain';
import type { RecordKind } from '@orot/storage';
import { STRUCTURED_RECORD_KINDS } from '@orot/rag';
import type { EvidenceChunk } from '@orot/rag';
import type {
  LocalHealthEvidenceInventory,
  LocalHealthEvidenceRepository,
} from '../../healthEvidence/localEvidenceRepository';
import type { EvidenceValidationContext } from './evidenceRegistry';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { createPersonalSourceReader } from './personalSourceReader';
import { fingerprint, stableJson } from './evidenceUtils';
import type { StaleEvidenceArtifact } from './localData';

interface RecordShape {
  readonly id: string;
  readonly effectiveAt?: unknown;
  readonly provenance?: {
    readonly origin?: string;
    readonly sourceRecordIds?: readonly string[];
    readonly source?: { readonly system?: string };
  };
  readonly reviewState?: { readonly status?: string };
  readonly unit?: unknown;
}

const CHUNKED_KINDS = new Set<RecordKind>([
  ...STRUCTURED_RECORD_KINDS,
  'evidence_span',
  'transcript_segment',
]);

function key(kind: string, id: string): string {
  return `${kind}\u0000${id}`;
}

function payload(record: RecordShape): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(record).filter(
      ([field]) => !['id', 'provenance', 'reviewState'].includes(field),
    ),
  );
}

function evidenceReviewState(
  record: RecordShape,
): EvidenceReference['reviewState'] {
  if (record.reviewState?.status === 'reviewed') return 'reviewed';
  return record.reviewState ? 'unreviewed' : 'unknown';
}

export function buildPersonalEvidence(input: {
  readonly inventory: LocalHealthEvidenceInventory;
  readonly persistedChunks: readonly EvidenceChunk[];
  readonly loadCurrentPersistedChunks: () => Promise<readonly EvidenceChunk[]>;
  readonly staleArtifacts: readonly StaleEvidenceArtifact[];
  readonly loadCurrentStaleArtifacts: () => Promise<
    readonly StaleEvidenceArtifact[]
  >;
  readonly repository: LocalHealthEvidenceRepository;
  readonly registry: LocalEvidenceReferenceRegistry;
}): {
  readonly items: readonly EvidenceItem[];
  readonly chunks: readonly EvidenceChunk[];
} {
  // Provenance IDs can name transcript segments or other records, so retain each ID's kind.
  const recordsById = new Map<
    string,
    LocalHealthEvidenceInventory['records'][number][]
  >();
  for (const entry of input.inventory.records) {
    const matches = recordsById.get(entry.record.id) ?? [];
    matches.push(entry);
    recordsById.set(entry.record.id, matches);
  }
  const persistedByRecord = new Map(
    input.persistedChunks.map(chunk => [
      key(chunk.metadata.recordType, chunk.metadata.evidenceId),
      chunk,
    ]),
  );
  const staleArtifactKeys = new Set(
    input.staleArtifacts.map(artifact => key(artifact.kind, artifact.id)),
  );
  for (const entry of input.inventory.records) {
    input.registry.registerSensitiveIdentifier(entry.record.id);
    for (const sourceId of entry.record.provenance.sourceRecordIds) {
      input.registry.registerSensitiveIdentifier(sourceId);
    }
  }

  const items: EvidenceItem[] = [];
  const chunks: EvidenceChunk[] = [];
  for (const entry of input.inventory.records) {
    if (entry.kind === 'source_record') continue;
    const record = entry.record as RecordShape;
    if (staleArtifactKeys.has(key(entry.kind, record.id))) continue;
    const persisted = persistedByRecord.get(key(entry.kind, record.id));
    // Persisted chunk generation is the stale-artifact filter for records with RAG support.
    if (CHUNKED_KINDS.has(entry.kind) && !persisted) continue;
    const linkedIds = record.provenance?.sourceRecordIds ?? [];
    const sourceId = persisted?.metadata.sourceId ?? linkedIds[0] ?? record.id;
    const sourceCandidates = recordsById.get(sourceId) ?? [];
    const sourceEntry =
      sourceCandidates.find(candidate => candidate.kind === 'source_record') ??
      (sourceCandidates.length === 1 ? sourceCandidates[0] : undefined);
    // Recheck the citation's selected source even when it is not in the row's provenance list.
    const sourceIdsToValidate = [...new Set([...linkedIds, sourceId])];
    const recordFingerprint = fingerprint(entry.record);
    const reference: EvidenceReference = {
      sourceKind: 'personal_record',
      sourceId,
      sourceRevision: fingerprint(sourceEntry?.record ?? { id: sourceId }),
      evidenceId: record.id,
      evidenceRevision: recordFingerprint,
      locator: persisted?.metadata.evidenceLocator ?? {
        kind: 'local_record',
        recordKind: entry.kind,
        recordId: record.id,
        sourceRecordIds: [...linkedIds],
      },
      effectiveTime:
        typeof record.effectiveAt === 'string' ? record.effectiveAt : null,
      ...(typeof record.unit === 'string' ? { unit: record.unit } : {}),
      reviewState: evidenceReviewState(record),
    };
    const content =
      persisted?.text ?? `${entry.kind}: ${stableJson(payload(record))}`;
    const readSource = createPersonalSourceReader({
      record: entry,
      recordFingerprint,
      sourceIds: sourceIdsToValidate,
      recordsById,
      repository: input.repository,
      externalHealthKitIds: record.provenance?.source?.system === 'healthkit',
    });
    const item = input.registry.add({
      reference,
      content,
      readSource,
      async validate(signal, context: EvidenceValidationContext) {
        if (signal.aborted) return false;
        const current = await input.repository.readRecord(
          entry.kind,
          record.id,
          signal,
        );
        if (!current || fingerprint(current) !== recordFingerprint)
          return false;
        if (persisted) {
          const currentChunks = await context.once(
            input.loadCurrentPersistedChunks,
            input.loadCurrentPersistedChunks,
          );
          const currentChunk = currentChunks.find(
            chunk => chunk.id === persisted.id,
          );
          // Rebuilds catch both changed content and transcript revisions that supersede an unchanged row.
          if (
            !currentChunk ||
            stableJson(currentChunk) !== stableJson(persisted)
          )
            return false;
        }
        for (const sourceRecordId of sourceIdsToValidate) {
          const candidates = recordsById.get(sourceRecordId) ?? [];
          // IDs are only locally unique per table; exclude only this exact kind-and-ID pair.
          const dependencies = candidates.filter(
            candidate =>
              candidate.kind !== entry.kind ||
              candidate.record.id !== record.id,
          );
          if (dependencies.length === 0) {
            const isSelfReference = candidates.some(
              candidate =>
                candidate.kind === entry.kind &&
                candidate.record.id === record.id,
            );
            if (isSelfReference) continue;
          }
          // HealthKit sample and concept IDs are external identities, not SQLCipher row IDs.
          if (
            dependencies.length === 0 &&
            candidates.length === 0 &&
            record.provenance?.source?.system === 'healthkit'
          ) {
            continue;
          }
          if (dependencies.length !== 1) return false;
          const expected = dependencies[0];
          if (!expected) return false;
          const currentSource = await input.repository.readRecord(
            expected.kind,
            sourceRecordId,
            signal,
          );
          if (
            !currentSource ||
            fingerprint(currentSource) !== fingerprint(expected.record)
          ) {
            return false;
          }
        }
        if (record.provenance?.origin === 'derived') {
          const currentStaleKeys = await context.once(
            input.loadCurrentStaleArtifacts,
            async () =>
              new Set(
                (await input.loadCurrentStaleArtifacts()).map(artifact =>
                  key(artifact.kind, artifact.id),
                ),
              ),
          );
          if (currentStaleKeys.has(key(entry.kind, record.id))) return false;
        }
        return !signal.aborted;
      },
    });
    items.push(item);
    chunks.push(
      input.registry.toSearchChunk(
        item,
        content,
        record.reviewState as ReviewState,
        persisted?.metadata.recordType ?? 'evidence_span',
        persisted?.id,
      ),
    );
  }
  return { items, chunks };
}
