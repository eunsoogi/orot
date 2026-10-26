import type {
  AgentMemoryKind,
  AgentMemoryProvenance,
  AgentMemoryStorageAdapter,
  PersistedMemoryRecord,
} from '@orot/agent-memory';
import type { EvidenceItem, EvidenceReference } from '@orot/agent-runtime';
import type { EvidenceChunk } from '@orot/rag';
import { LocalEvidenceReferenceRegistry } from './evidenceRegistry';
import { fingerprint } from './evidenceUtils';

interface ValidMemoryMetadata {
  readonly kind: AgentMemoryKind;
  readonly provenance: AgentMemoryProvenance;
}

function validMetadata(value: unknown): ValidMemoryMetadata | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const meta = value as Record<string, unknown>;
  const kind = meta.kind;
  const provenance = meta.provenance;
  if (
    kind !== 'preference' &&
    kind !== 'reviewed_interaction' &&
    kind !== 'task_context'
  ) {
    return undefined;
  }
  if (!provenance || typeof provenance !== 'object') return undefined;
  const valueProvenance = provenance as Record<string, unknown>;
  const sourceIds = valueProvenance.sourceIds;
  const reviewState = valueProvenance.reviewState;
  if (
    !Array.isArray(sourceIds) ||
    sourceIds.some(id => typeof id !== 'string' || id.trim().length === 0) ||
    (reviewState !== 'user_confirmed' && reviewState !== 'human_reviewed')
  ) {
    return undefined;
  }
  const sourceDates = valueProvenance.sourceDates;
  if (
    sourceDates !== undefined &&
    (!Array.isArray(sourceDates) ||
      sourceDates.some(date => {
        if (!date || typeof date !== 'object') return true;
        const item = date as Record<string, unknown>;
        return (
          typeof item.sourceId !== 'string' ||
          typeof item.date !== 'string' ||
          !sourceIds.includes(item.sourceId) ||
          !item.date.trim()
        );
      }))
  ) {
    return undefined;
  }
  return {
    kind,
    provenance: valueProvenance as unknown as AgentMemoryProvenance,
  };
}

/** Registers memory and linked-record IDs before any local text can reach a model payload. */
export function registerMemoryIdentifiers(
  records: readonly PersistedMemoryRecord[],
  registry: LocalEvidenceReferenceRegistry,
): void {
  for (const record of records) {
    if (typeof record.id === 'string') {
      registry.registerSensitiveIdentifier(record.id);
    }
    if (!record.meta || typeof record.meta !== 'object') continue;
    const meta = record.meta as Record<string, unknown>;
    const provenance = meta.provenance;
    if (!provenance || typeof provenance !== 'object') continue;
    const sourceIds = (provenance as Record<string, unknown>).sourceIds;
    if (Array.isArray(sourceIds)) {
      for (const sourceId of sourceIds) {
        if (typeof sourceId === 'string') {
          registry.registerSensitiveIdentifier(sourceId);
        }
      }
    }
  }
}

function persistedSnapshot(record: PersistedMemoryRecord): unknown {
  return {
    id: record.id,
    text: record.text,
    meta: record.meta,
    createdAt: record.createdAt,
    reinforcements: record.reinforcements,
  };
}

function effectiveTime(createdAt: number): string | null {
  if (!Number.isFinite(createdAt) || Math.abs(createdAt) > 8.64e15) return null;
  return new Date(createdAt).toISOString();
}

/** Builds local-search chunks from every valid reviewed memory; malformed metadata remains a coverage gap. */
export async function buildMemoryEvidence(input: {
  readonly records: readonly PersistedMemoryRecord[];
  readonly storage: Pick<AgentMemoryStorageAdapter, 'listRecords'>;
  readonly registry: LocalEvidenceReferenceRegistry;
}): Promise<{
  readonly items: readonly EvidenceItem[];
  readonly chunks: readonly EvidenceChunk[];
  readonly excludedCount: number;
}> {
  let excludedCount = 0;
  const items: EvidenceItem[] = [];
  const chunks: EvidenceChunk[] = [];
  for (const record of input.records) {
    const metadata = validMetadata(record.meta);
    if (!metadata || !record.id.trim() || !record.text.trim()) {
      excludedCount += 1;
      continue;
    }
    const createdAt = effectiveTime(record.createdAt);
    const revision = fingerprint(persistedSnapshot(record));
    const reference: EvidenceReference = {
      sourceKind: 'reviewed_memory',
      sourceId: record.id,
      sourceRevision: fingerprint({
        id: record.id,
        createdAt,
        kind: metadata.kind,
        provenance: metadata.provenance,
      }),
      evidenceId: record.id,
      evidenceRevision: revision,
      locator: {
        kind: 'agent_memory',
        memoryId: record.id,
        sourceIds: [...metadata.provenance.sourceIds],
      },
      effectiveTime: createdAt,
      reviewState: 'reviewed',
    };
    const item = input.registry.add({
      reference,
      content: record.text,
      async readSource(signal) {
        // Reopen the persisted memory on citation tap instead of exposing the generation-time copy.
        if (signal.aborted) return { status: 'unavailable' };
        let currentRecords: readonly PersistedMemoryRecord[];
        try {
          currentRecords = await input.storage.listRecords();
        } catch {
          return { status: 'unavailable' };
        }
        const current = currentRecords.find(
          candidate => candidate.id === record.id,
        );
        if (!current) return { status: 'missing' };
        if (fingerprint(persistedSnapshot(current)) !== revision)
          return { status: 'changed' };
        return signal.aborted
          ? { status: 'unavailable' }
          : {
              status: 'available',
              document: { sourceKind: 'reviewed_memory', record: current },
            };
      },
      async validate(signal) {
        if (signal.aborted) return false;
        const current = (await input.storage.listRecords()).find(
          candidate => candidate.id === record.id,
        );
        return Boolean(
          current &&
          fingerprint(persistedSnapshot(current)) === revision &&
          !signal.aborted,
        );
      },
    });
    items.push(item);
    // App-confirmed memory is still ranked conservatively as ordinary local text.
    chunks.push(
      input.registry.toSearchChunk(item, record.text, { status: 'unreviewed' }),
    );
  }
  return { items, chunks, excludedCount };
}
